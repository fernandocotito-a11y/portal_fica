// ============================================================================
// FICA Portal — Edge Function "sbs-rates"
// ----------------------------------------------------------------------------
// Consulta la web de la SBS (comisiones y primas de AFP) del lado del servidor
// (evita el problema de CORS) y devuelve el período + las 4 filas de AFP.
// auth: 'user' -> solo usuarios autenticados del portal.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const SBS_URL =
  "https://www.sbs.gob.pe/app/spp/empleadores/comisiones_spp/paginas/comision_prima.aspx";
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

export default {
  fetch: withSupabase({ auth: "user" }, async () => {
    try {
      const res = await fetch(SBS_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FICAPortal/1.0)" },
      });
      const html = await res.text();
      const periodMatch = html.match(/id="lblMes1"[^>]*>\s*([\d]{4}-[\d]{2})/);
      const rows = parseSbs(html);
      if (rows.length === 0) {
        return Response.json({ error: "No se pudieron leer los datos de la SBS." }, { status: 502 });
      }
      return Response.json({ period: periodMatch ? periodMatch[1] : null, rows });
    } catch (e) {
      return Response.json({ error: String(e?.message || e) }, { status: 502 });
    }
  }),
};
