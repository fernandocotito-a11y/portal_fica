// ============================================================================
// FICA Portal — Edge Function "smooth-task" (importa parámetros AFP desde la SBS)
// ----------------------------------------------------------------------------
// Consulta la web de la SBS del lado del servidor (evita CORS) y devuelve el
// período + las 4 filas de AFP. Sigue redirecciones manualmente conservando
// cookies para evitar bucles de redirección.
// auth: 'user' -> solo usuarios autenticados del portal.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const SBS_URL =
  "https://www.sbs.gob.pe/app/spp/empleadores/comisiones_spp/paginas/comision_prima.aspx";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const AFPS = ["HABITAT", "INTEGRA", "PRIMA", "PROFUTURO"];

function pct(s: string): number {
  const n = parseFloat(String(s).replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) ? n / 100 : 0;
}
function numPe(s: string): number {
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseSbs(html: string) {
  const rows: unknown[] = [];
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

/** Descarga la página de la SBS siguiendo redirecciones y conservando cookies. */
async function fetchSbsHtml() {
  let url = SBS_URL;
  let cookie = "";
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-PE,es;q=0.9",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const first = setCookie.split(";")[0];
      cookie = cookie ? `${cookie}; ${first}` : first;
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { html: await res.text(), status: res.status };
      url = new URL(loc, url).toString();
      continue;
    }
    return { html: await res.text(), status: res.status };
  }
  throw new Error("Demasiadas redirecciones al consultar la SBS.");
}

export default {
  fetch: withSupabase({ auth: "user" }, async () => {
    try {
      const { html, status } = await fetchSbsHtml();
      const rows = parseSbs(html);
      const periodMatch = html.match(/id="lblMes1"[^>]*>\s*([\d]{4}-[\d]{2})/);
      if (rows.length === 0) {
        return Response.json(
          { error: `La SBS respondió ${status}, pero no se pudo interpretar la tabla.` },
          { status: 502 }
        );
      }
      return Response.json({ period: periodMatch ? periodMatch[1] : null, rows });
    } catch (e) {
      return Response.json({ error: String(e?.message || e) }, { status: 502 });
    }
  }),
};
