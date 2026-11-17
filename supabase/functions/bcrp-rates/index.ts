// ============================================================================
// FICA Portal — Edge Function "bcrp-rates" (tipo de cambio automático)
// ----------------------------------------------------------------------------
// Consulta la API del BCRP desde el servidor (la API no envía cabeceras CORS,
// así que el navegador no puede llamarla directamente) y devuelve las tasas
// del mes pedido.
//
// Serie PD04639PD = "SBS Compra" y PD04640PD = "SBS Venta", las oficiales
// usadas por SUNAT para Compras y Ventas.
//
// Uso:
//   GET /functions/v1/bcrp-rates?year=2026&month=11
//   POST /functions/v1/bcrp-rates  { "year": 2026, "month": 11 }
//
// Respuesta: el JSON original del BCRP ({ config, periods }), que el portal
// normaliza con parseBcrpPayload().
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SERIES = "PD04639PD-PD04640PD";
const BCRP_BASE = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function monthRange(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  // Consultar desde 15 días antes para arrastrar el tipo de cambio oficial
  // si el primer día del mes cae sábado, domingo o feriado (regla SUNAT).
  const prevDate = new Date(Date.UTC(year, month - 1, 1));
  prevDate.setUTCDate(prevDate.getUTCDate() - 15);
  return {
    start: prevDate.toISOString().slice(0, 10),
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const url = new URL(req.url);
    let year = Number(url.searchParams.get("year"));
    let month = Number(url.searchParams.get("month"));

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (!year) year = Number(body?.year);
        if (!month) month = Number(body?.month);
      } catch {
        /* cuerpo vacío o inválido: se usan los parámetros de la URL */
      }
    }

    const now = new Date();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) year = now.getUTCFullYear();
    if (!Number.isInteger(month) || month < 1 || month > 12) month = now.getUTCMonth() + 1;

    const { start, end } = monthRange(year, month);
    const target = `${BCRP_BASE}/${SERIES}/json/${start}/${end}/ing`;

    const res = await fetch(target, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; FICA-Portal/1.0)",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      return json({ error: `BCRP respondió HTTP ${res.status}`, detail: text.slice(0, 200) }, 502);
    }

    let payload: unknown;
    try {
      let clean = text.trim();
      const firstBrace = clean.indexOf("{");
      const lastBrace = clean.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        clean = clean.substring(firstBrace, lastBrace + 1);
      }
      payload = JSON.parse(clean);
    } catch {
      return json({ error: "El BCRP no devolvió JSON válido.", detail: text.slice(0, 200) }, 502);
    }

    return json(payload);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 502);
  }
});
