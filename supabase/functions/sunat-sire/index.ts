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
//   { action: "cronograma", year }                -> { ok, months, source }
//   { action: "descargar", kind: "compra"|"venta", period: "YYYYMM", companyId }
// ============================================================================
// El import de tipos de JSR (@supabase/functions-js) es opcional y hacía
// fallar el bundle cuando jsr.io no responde; se omite a propósito.
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

const COD_LIBRO: Record<string, string> = { compra: "080000", venta: "140000" };
const TICKET_ATTEMPTS = 25;
const TICKET_DELAY_MS = 3000;
const TICKET_TIMEOUT_S = Math.round((TICKET_ATTEMPTS * TICKET_DELAY_MS) / 1000);

/** URL del servicio "descargar propuesta" (compras 5.34 / ventas 5.18). */
function propuestaUrl(kind: string, period: string): string {
  // 0 = TXT. El ZIP resultante contiene un .txt separado por "|".
  // codOrigenEnvio=2 = servicio web (en compras es obligatorio; en ventas también
  // lo usa la implementación verificada).
  if (kind === "venta") {
    return `${SIRE_BASE}/rvie/propuesta/web/propuesta/${period}/exportapropuesta?codTipoArchivo=0&codOrigenEnvio=2`;
  }
  return `${SIRE_BASE}/rce/propuesta/web/propuesta/${period}/exportacioncomprobantepropuesta?codTipoArchivo=0&codOrigenEnvio=2`;
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

async function sunatJson(url: string, token: string, method = "GET"): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  if (!res.ok) {
    const msg = data.msg || data.message || data.mensaje || data.error || text.slice(0, 300);
    const detail = Array.isArray(data.errors)
      ? ` · ${data.errors.map((e: any) => e?.msg || e).join("; ")}`
      : "";
    throw new Error(`SUNAT (${res.status}): ${msg}${detail}`);
  }
  return data;
}

/** Descarga la propuesta y devuelve { fileName, base64, kind, period, ticket }. */
async function descargarPropuesta(creds: Credentials, kind: string, period: string) {
  const token = await getToken(creds);
  const codLibro = COD_LIBRO[kind] || COD_LIBRO.compra;

  // 1) Generar ticket de la propuesta (GET, no POST).
  const prop = await sunatJson(propuestaUrl(kind, period), token, "GET");
  const numTicket = prop.numTicket ?? prop.num_ticket ?? prop.numeroTicket ?? prop.ticket;
  if (!numTicket) {
    throw new Error(`SUNAT no devolvió ticket de propuesta: ${JSON.stringify(prop).slice(0, 300)}`);
  }

  // 2) Consultar el estado del ticket hasta que termine (06 = Terminado).
  //    La consulta es por período: perIni/perFin son obligatorios.
  let estado: any = null;
  for (let i = 0; i < TICKET_ATTEMPTS; i += 1) {
    await new Promise((r) => setTimeout(r, TICKET_DELAY_MS));
    let r: any;
    try {
      r = await sunatJson(
        `${SIRE_BASE}/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets`
          + `?perIni=${period}&perFin=${period}&page=1&perPage=50`
          + `&numTicket=${encodeURIComponent(String(numTicket))}`,
        token,
        "GET"
      );
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      // 401/403 = token inválido: no tiene sentido seguir. El resto suele ser
      // que el ticket todavía no está indexado; se reintenta.
      if (msg.includes("(401)") || msg.includes("(403)")) throw e;
      continue;
    }
    const registros = Array.isArray(r.registros) ? r.registros : [];
    const match = registros.find((x: any) => String(x.numTicket) === String(numTicket)) || registros[0];
    if (match) {
      const cod = String(match.codEstadoProceso || "");
      if (cod === "06") { estado = match; break; }
      if (["07", "08", "10"].includes(cod)) {
        throw new Error(
          `SUNAT no pudo generar la propuesta (${cod}): ${match.desEstadoProceso || "sin detalle"}`
        );
      }
    }
  }
  if (!estado) {
    throw new Error(
      `SUNAT no terminó de generar la propuesta en ${TICKET_TIMEOUT_S} s. Ticket ${numTicket}. Reintenta en unos minutos.`
    );
  }

  // 3) Descargar el archivo generado (ZIP binario, no JSON).
  const archivo = (Array.isArray(estado.archivoReporte) ? estado.archivoReporte[0] : null)
    || (Array.isArray(estado.detalleTicket) ? estado.detalleTicket[0] : null);
  const nomArchivoReporte = archivo?.nomArchivoReporte || estado.nomArchivoReporte;
  const codTipoArchivoReporte =
    archivo?.codTipoAchivoReporte ?? archivo?.codTipoArchivoReporte ?? estado.codTipoArchivoReporte ?? "00";
  const codProceso = estado.codProceso || "10"; // 10 = exportar propuesta
  if (!nomArchivoReporte) {
    throw new Error(`SUNAT no devolvió el nombre del archivo: ${JSON.stringify(estado).slice(0, 300)}`);
  }

  const downloadUrl = new URL(`${SIRE_BASE}/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte`);
  downloadUrl.searchParams.set("nomArchivoReporte", String(nomArchivoReporte));
  downloadUrl.searchParams.set("codTipoArchivoReporte", String(codTipoArchivoReporte));
  downloadUrl.searchParams.set("codLibro", codLibro);
  downloadUrl.searchParams.set("perTributario", period);
  downloadUrl.searchParams.set("codProceso", String(codProceso));
  downloadUrl.searchParams.set("numTicket", String(numTicket));

  const res = await fetch(downloadUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/zip, application/octet-stream, */*",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SUNAT descarga (${res.status}): ${t.slice(0, 300)}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new Error("SUNAT devolvió un archivo vacío.");

  return {
    fileName: String(nomArchivoReporte),
    base64: toBase64(bytes),
    kind,
    period,
    ticket: String(numTicket),
  };
}

/** Uint8Array -> base64 sin desbordar la pila en archivos grandes. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ------------------------- Cronograma de vencimientos ---------------------- */

const MESES_ABBR: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, oct: 10, nov: 11, dic: 12,
};
const GRUPOS_CRONO = ["0", "1", "2-3", "4-5", "6-7", "8-9", "bc"];

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Extrae los vencimientos de la tabla publicada por SUNAT. */
function parseCronograma(html: string, year: number) {
  const months: Array<{ mes: number; dates: Record<string, string> }> = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html))) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((c) => stripHtml(c[1]));
    if (cells.length < GRUPOS_CRONO.length + 1) continue;
    const head = normalizeText(cells[0]).match(/^([a-z]{3})-(\d{4})$/);
    if (!head) continue;
    const periodMonth = MESES_ABBR[head[1]];
    const periodYear = Number(head[2]);
    if (!periodMonth || periodYear !== year) continue;

    const dates: Record<string, string> = {};
    for (let i = 0; i < GRUPOS_CRONO.length; i += 1) {
      const cell = normalizeText(cells[i + 1] || "");
      const dm = cell.match(/^(\d{1,2})\s+([a-z]{3})(?:\s+(\d{4}))?$/);
      if (!dm) { dates[GRUPOS_CRONO[i]] = ""; continue; }
      const day = Number(dm[1]);
      const month = MESES_ABBR[dm[2]];
      if (!month) { dates[GRUPOS_CRONO[i]] = ""; continue; }
      const explicitYear = dm[3] ? Number(dm[3]) : 0;
      const deadlineYear = explicitYear || (month < periodMonth ? periodYear + 1 : periodYear);
      dates[GRUPOS_CRONO[i]] =
        `${deadlineYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    months.push({ mes: periodMonth, dates });
  }
  return months.sort((a, b) => a.mes - b.mes);
}

async function fetchCronograma(year: number) {
  const url = `https://www.sunat.gob.pe/orientacion/cronogramas/${year}/cObligacionMensual${year}.html`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FICA-Portal/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`SUNAT respondió ${res.status} para el cronograma ${year}.`);
  const html = await res.text();
  const months = parseCronograma(html, year);
  if (!months.length) {
    throw new Error(`No se pudo interpretar el cronograma ${year} publicado por SUNAT.`);
  }
  return { months, source: url };
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

      if (action === "test") {
        if (!isSuper) return Response.json({ error: "Solo el superadmin puede probar la conexión" }, { status: 403 });
        const companyId = String(body.companyId || "");
        if (!companyId) return Response.json({ error: "Falta empresa" }, { status: 400 });

        const { data: cred } = await ctx.supabaseAdmin
          .from("sunat_credentials")
          .select("client_id, client_secret, username, password")
          .eq("company_id", companyId)
          .maybeSingle();
        if (!cred) {
          return Response.json({ ok: false, error: "No hay credenciales guardadas para esta empresa." });
        }

        const username = String(cred.username || "");
        try {
          const token = await getToken(cred as Credentials);
          return Response.json({
            ok: true,
            message: "Token obtenido. El client_id, client_secret, usuario y Clave SOL son válidos.",
            clientId: maskClientId(cred.client_id),
            username: maskUser(username),
            usernameLength: username.length,
            tokenPreview: `${token.slice(0, 10)}…`,
          });
        } catch (e) {
          const msg = String((e as Error)?.message || e);
          return Response.json({
            ok: false,
            error: msg,
            clientId: maskClientId(cred.client_id),
            username: maskUser(username),
            usernameLength: username.length,
            hint: hintForTokenError(msg, username.length),
          });
        }
      }

      if (action === "cronograma") {
        const year = Number(body.year);
        if (!Number.isInteger(year) || year < 2020 || year > 2100) {
          return Response.json({ error: "Ejercicio inválido" }, { status: 400 });
        }
        try {
          const { months, source } = await fetchCronograma(year);
          return Response.json({ ok: true, year, source, fetchedAt: new Date().toISOString(), months });
        } catch (e) {
          const msg = String((e as Error)?.message || e);
          return Response.json({ ok: false, error: msg }, { status: 502 });
        }
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

function maskUser(u: string): string {
  const s = String(u || "");
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 4)}••••${s.slice(-2)}`;
}

function hintForTokenError(msg: string, len: number): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid_client") || m.includes("client authentication") || m.includes("unauthorized_client")) {
    return "El client_id o client_secret no coinciden. Vuelve a copiar el ID y la Clave exactos de la aplicación en SUNAT.";
  }
  if (m.includes("invalid_scope") || m.includes("scope")) {
    return "La credencial no tiene habilitado el servicio SIRE. Revisa la aplicación en SUNAT o consulta con tu proveedor de facturación.";
  }
  if (m.includes("autenticacion del usuario") || m.includes("access_denied")) {
    if (len <= 11) {
      return "Estás enviando SOLO el RUC (11 caracteres). Si usas un usuario secundario, el formato debe ser RUC + usuario, pegado y sin espacio (ej. 20601705657FACTURAONLINE). Si usas el usuario principal, revisa que la Clave SOL sea la correcta.";
    }
    return "Estás enviando RUC + usuario. Verifica que ese usuario exista en SOL, que esté habilitado y que la Clave SOL sea la de ESE usuario (no la del principal).";
  }
  return "Revisa los 4 datos con SUNAT (usuario, clave SOL, client_id y client_secret).";
}
