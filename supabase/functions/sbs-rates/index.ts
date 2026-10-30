// ============================================================================
// FICA Portal — Edge Function "sbs-rates" (importa parámetros AFP desde la SBS)
// ----------------------------------------------------------------------------
// Consulta la web de la SBS (evita CORS) y devuelve el período + las 4 filas AFP.
// Usa Deno.serve, sin dependencias externas, para desplegar en cualquier versión
// del runtime de Supabase. Incluye manejo de CORS (OPTIONS) para evitar
// "Failed to fetch" desde el navegador.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SBS_URL =
  "https://www.sbs.gob.pe/app/spp/empleadores/comisiones_spp/paginas/comision_prima.aspx";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const AFPS = ["HABITAT", "INTEGRA", "PRIMA", "PROFUTURO"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function pct(s: string): number {
  const n = parseFloat(String(s).replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) ? n / 100 : 0;
}
function numPe(s: string): number {
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseSbs(html: string) {
  const rows: {
    afp: string;
    comisionFlujo: number;
    comisionSaldo: number;
    primaSeguro: number;
    aporteObligatorio: number;
    remMaxAsegurable: number;
  }[] = [];
  for (const chunk of html.split("JER_filaContenido")) {
    const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim()
    );
    if (tds.length >= 6) {
      const afp = tds[0].toUpperCase();
      if (AFPS.includes(afp)) {
        rows.push({
          afp,
          comisionFlujo: pct(tds[1]),
          comisionSaldo: pct(tds[2]),
          primaSeguro: pct(tds[3]),
          aporteObligatorio: pct(tds[4]),
          remMaxAsegurable: numPe(tds[5]),
        });
      }
    }
  }
  return rows;
}

const baseHeaders = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-PE,es;q=0.9",
};

async function fetchSbsHtml() {
  // Intento 1: seguir redirecciones automáticamente
  try {
    const res = await fetch(SBS_URL, { headers: baseHeaders });
    const html = await res.text();
    if (html.includes("JER_filaContenido")) {
      return { html, status: res.status, finalUrl: res.url, mode: "auto" };
    }
  } catch (_e) {
    /* continuar al intento 2 */
  }

  // Intento 2: redirecciones manuales conservando cookies
  let url = SBS_URL;
  let cookie = "";
  let last = { html: "", status: 0, finalUrl: url, mode: "manual" };
  for (let i = 0; i < 12; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { ...baseHeaders, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const sc = res.headers.get("set-cookie");
    if (sc) {
      const first = sc.split(";")[0];
      cookie = cookie ? `${cookie}; ${first}` : first;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      url = new URL(loc, url).toString();
      continue;
    }
    const html = await res.text();
    last = { html, status: res.status, finalUrl: url, mode: "manual" };
    if (html.includes("JER_filaContenido")) return last;
    break;
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  try {
    const { html, status, finalUrl, mode } = await fetchSbsHtml();
    const rows = parseSbs(html);
    const periodMatch = html.match(/id="lblMes1"[^>]*>\s*([\d]{4}-[\d]{2})/);
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            `No se pudo leer la tabla. status=${status} modo=${mode} final=${finalUrl} ` +
            `len=${html.length} JER=${html.includes("JER_filaContenido")} HABITAT=${html.includes("HABITAT")} ` +
            `head=${html.slice(0, 160).replace(/\s+/g, " ")}`,
        }),
        { status: 502, headers: CORS_HEADERS }
      );
    }
    return new Response(
      JSON.stringify({ period: periodMatch ? periodMatch[1] : null, rows }),
      { headers: CORS_HEADERS }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 502, headers: CORS_HEADERS }
    );
  }
});
