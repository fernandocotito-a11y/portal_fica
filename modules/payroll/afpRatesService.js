/* ============================================================================
   afpRatesService.js — Parámetros AFP por mes (SBS) + importación automática
   ----------------------------------------------------------------------------
   Los porcentajes de AFP (comisión flujo/saldo, prima, aporte obligatorio y
   Remuneración Máxima Asegurable) los publica la SBS cada mes. Se guardan en la
   tabla global `afp_rates` y se pueden importar desde la web de la SBS.
   ========================================================================== */

import { supabase, SUPABASE_ANON_KEY } from '../../js/supabase.js';
import { num } from './payrollUtils.js';
import { AFP_BASE, AFP_REM_MAX_ASEGURABLE } from './payrollConfig.js';

const AFPS = ['HABITAT', 'INTEGRA', 'PRIMA', 'PROFUTURO'];
const SBS_FUNCTION_URL = 'https://kiogxgcrexgpgumfpgnq.supabase.co/functions/v1/smooth-task';

let cache = {}; // 'YYYY-MM' -> [ { afp, comisionFlujo, ... } ]

/** Valores base (fallback cuando no hay datos guardados del mes). */
function baseRows() {
  return AFP_BASE.map((b) => ({ ...b, aporteObligatorio: 0.1, remMaxAsegurable: AFP_REM_MAX_ASEGURABLE }));
}

function pct(s) {
  const n = parseFloat(String(s).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n / 100 : 0;
}
function numPe(s) {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Parsea el HTML de la SBS y devuelve las 4 filas de AFP. */
function parseSbs(html) {
  const rows = [];
  const chunks = String(html).split('JER_filaContenido');
  for (const chunk of chunks) {
    const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
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

export const afpRatesService = {
  async refresh() {
    const { data } = await supabase.from('afp_rates').select('*');
    cache = {};
    (data || []).forEach((r) => {
      const k = `${r.year}-${String(r.month).padStart(2, '0')}`;
      if (!cache[k]) cache[k] = [];
      cache[k].push({
        afp: r.afp,
        comisionFlujo: num(r.comision_flujo),
        comisionSaldo: num(r.comision_saldo),
        primaSeguro: num(r.prima_seguro),
        aporteObligatorio: num(r.aporte_obligatorio),
        remMaxAsegurable: num(r.rem_max_asegurable),
      });
    });
  },

  /** Filas de AFP del mes (guardadas o valores base). */
  forMonth(year, month) {
    const k = `${year}-${String(month).padStart(2, '0')}`;
    return cache[k] && cache[k].length ? cache[k] : baseRows();
  },

  /** Parámetros de una AFP concreta. */
  get(year, month, afp) {
    const list = this.forMonth(year, month);
    return list.find((r) => r.afp === String(afp || '').toUpperCase()) || list[0];
  },

  /** Guarda las 4 filas de un mes. */
  async saveMonth(year, month, rows) {
    const payload = rows.map((r) => ({
      year,
      month,
      afp: r.afp,
      comision_flujo: num(r.comisionFlujo),
      comision_saldo: num(r.comisionSaldo),
      prima_seguro: num(r.primaSeguro),
      aporte_obligatorio: num(r.aporteObligatorio),
      rem_max_asegurable: num(r.remMaxAsegurable),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('afp_rates').upsert(payload, { onConflict: 'year,month,afp' });
    if (error) throw new Error(error.message);
    await this.refresh();
  },

  /** ¿Hay datos guardados para el mes? */
  hasData(year, month) {
    const k = `${year}-${String(month).padStart(2, '0')}`;
    return !!(cache[k] && cache[k].length);
  },

  /**
   * Importa los parámetros vigentes desde la web de la SBS a través de la Edge
   * Function `sbs-rates` (que consulta la SBS del lado del servidor).
   */
  async fetchFromSBS() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No hay sesión activa.');
    const res = await fetch(SBS_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.rows || json.rows.length === 0) {
      throw new Error(json.error || 'No se pudo consultar la SBS (verifica la Edge Function "sbs-rates").');
    }
    return { period: json.period, rows: json.rows };
  },
};
