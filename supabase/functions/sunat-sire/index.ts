// ============================================================================
// FICA Portal — Edge Function "sunat-sire"
// ----------------------------------------------------------------------------
// Conecta con el Servicio Web API del SIRE de SUNAT para descargar la propuesta
// del Registro de Compras (RCE) o Ventas (RVIE) de un período, usando las
// credenciales guardadas por empresa en public.sunat_credentials (solo service
// role). La Clave SOL nunca llega al navegador.
//
// Acciones (método POST, JSON body):
//   { action: "status" }                          -> { configured, masked }
//   { action: "save", clientId, clientSecret, username, password, companyId }
//   { action: "descargar", kind: "compra"|"venta", period: "YYYYMM", companyId }
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const TOKEN_URL = (clientId: string) =>
  `https://api-seguridad.sunat.gob.pe/v1/clientessol/${clientId}/oauth2/token/`;
const SIRE_BASE = "https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros";
const SCOPE = "https://api-sire.sunat.gob.pe";

interface Credentials {
  client_id: string;
  client_secret: string;
  username: string;
  password: string;
}

/** URL del servicio "descargar propuesta" (compras 5.34 / ventas 5.18). */
function propuestaUrl(kind: string, period: string): string {
  return kind === "venta"
    ? `${SIRE_BASE}/rvie/propuesta/web/propuesta/${period}/exportapropuesta`
    : `${SIRE_BASE}/rce/propuesta/web/propuesta/${period}/exportacioncomprobantepropuesta`;
}

/** Obtiene el token OAuth2 de SUNAT. */
async function getToken(creds: Credentials): Promise<string> {
  const res = await fetch(TOKEN_URL(creds.client_id), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      username: creds.username,
      password: creds.password,
      scope: SCOPE,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SUNAT token (${res.status}): ${text.slice(0, 300)}`);
  let data: any;
  try { data = JSON.parse(text); } catch { data = {}; }
  const token = data.access_token || data.token || data.id_token;
  if (!token) throw new Error(`SUNAT token sin access_token: ${text.slice(0, 300)}`);
  return String(token);
}

async function sunatJson(url: string, token: string, method = "POST"): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  if (!res.ok) {
    const msg = data.message || data.mensaje || data.error || text.slice(0, 300);
    throw new Error(`SUNAT (${res.status}): ${msg}`);
  }
  return data;
}

/** Descarga la propuesta y devuelve { fileName, base64, kind, period }. */
async function descargarPropuesta(creds: Credentials, kind: string, period: string) {
  const token = await getToken(creds);

  // 1) Generar ticket de la propuesta.
  const params = new URLSearchParams({ codTipoArchivo: "CSV", codOrigenEnvio: "1" });
  const propUrl = `${propuestaUrl(kind, period)}?${params.toString()}`;
  const prop = await sunatJson(propUrl, token);
  const numTicket = prop.numTicket ?? prop.num_ticket ?? prop.numeroTicket ?? prop.ticket;
  if (!numTicket) {
    throw new Error(`SUNAT no devolvió ticket de propuesta: ${JSON.stringify(prop).slice(0, 300)}`);
  }

  // 2) Esperar a que el proceso termine (consulta de estado).
  //    Nota: la URL exacta de "consultar estado" / "descargar archivo" puede
  //    variar según el manual oficial; se ajusta en la primera prueba real.
  let archivo: any = null;
  for (let i = 0; i < 15; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const estado = await sunatJson(
      `${SIRE_BASE}/rce/ticket/web/consultar?numTicket=${encodeURIComponent(String(numTicket))}`,
      token,
      "GET"
    );
    const terminado = estado.terminado ?? estado.codEstadoProceso === "01";
    if (terminado) {
      archivo = estado;
      break;
    }
    if (estado.expirado) throw new Error("El ticket de SUNAT expiró sin completarse.");
  }
  if (!archivo) throw new Error("SUNAT no terminó de generar la propuesta. Reintenta en unos minutos.");

  // 3) Descargar el archivo (ZIP en base64).
  const download = await sunatJson(
    `${SIRE_BASE}/rce/archivo/web/descargar?numTicket=${encodeURIComponent(String(numTicket))}`,
    token,
    "GET"
  );
  const item = Array.isArray(download) ? download[0] : download;
  const base64 = item?.archivoBase64 ?? item?.base64 ?? item?.data ?? download.archivoBase64;
  if (!base64) throw new Error(`SUNAT no devolvió el archivo: ${JSON.stringify(download).slice(0, 300)}`);

  return {
    fileName: item?.nombreZip ?? item?.nombreTxt ?? `sire-${period}-${kind}.zip`,
    base64: String(base64),
    kind,
    period,
  };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const callerId = ctx.userClaims?.id;
      if (!callerId) return Response.json({ error: "No autorizado" }, { status: 401 });

      const { data: profile } = await ctx.supabase
        .from("profiles")
        .select("role, companies")
        .eq("id", callerId)
        .single();
      if (!profile) return Response.json({ error: "No autorizado" }, { status: 403 });
      const isSuper = profile.role === "superadmin";

      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }
      const action = String(body.action || "");

      if (action === "status") {
        const companyId = String(body.companyId || "");
        if (!companyId) return Response.json({ error: "Falta empresa" }, { status: 400 });
        const { data: cred } = await ctx.supabaseAdmin
          .from("sunat_credentials")
          .select("client_id")
          .eq("company_id", companyId)
          .maybeSingle();
        return Response.json({
          configured: !!cred,
          masked: cred ? maskClientId(cred.client_id) : null,
        });
      }

      if (action === "save") {
        if (!isSuper) return Response.json({ error: "Solo el superadmin puede configurar SUNAT" }, { status: 403 });
        const companyId = String(body.companyId || "");
        const clientId = String(body.clientId || "").trim();
        const clientSecret = String(body.clientSecret || "").trim();
        const username = String(body.username || "").trim();
        const password = String(body.password || "").trim();
        if (!companyId || !clientId || !clientSecret || !username || !password) {
          return Response.json({ error: "Completa todas las credenciales" }, { status: 400 });
        }
        await ctx.supabaseAdmin.from("sunat_credentials").upsert({
          company_id: companyId,
          client_id: clientId,
          client_secret: clientSecret,
          username,
          password,
        });
        return Response.json({ ok: true });
      }

      if (action === "descargar") {
        const companyId = String(body.companyId || "");
        const kind = String(body.kind || "compra");
        const period = String(body.period || "").replace(/\D/g, "").slice(0, 6);
        if (!companyId) return Response.json({ error: "Falta empresa" }, { status: 400 });
        if (!/^\d{6}$/.test(period)) return Response.json({ error: "Período inválido (YYYYMM)" }, { status: 400 });
        if (!["compra", "venta"].includes(kind)) return Response.json({ error: "Tipo inválido" }, { status: 400 });

        // Cualquier usuario autenticado de la empresa puede descargar.
        const companies: string[] = Array.isArray(profile.companies) ? profile.companies : [];
        if (!isSuper && !companies.includes(companyId)) {
          return Response.json({ error: "No autorizado para esta empresa" }, { status: 403 });
        }

        const { data: cred } = await ctx.supabaseAdmin
          .from("sunat_credentials")
          .select("client_id, client_secret, username, password")
          .eq("company_id", companyId)
          .maybeSingle();
        if (!cred) return Response.json({ error: "SUNAT no está configurado para esta empresa" }, { status: 400 });

        const result = await descargarPropuesta(cred as Credentials, kind, period);
        return Response.json({ ok: true, ...result });
      }

      return Response.json({ error: "Acción desconocida" }, { status: 400 });
    } catch (e) {
      return Response.json({ error: String(e?.message || e) }, { status: 502 });
    }
  }),
};

function maskClientId(id: string): string {
  const s = String(id || "");
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
