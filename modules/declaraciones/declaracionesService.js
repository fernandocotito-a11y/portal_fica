/* ============================================================================
   declaracionesService.js — Liquidación IGV / Renta mensual (FV 621)
   ----------------------------------------------------------------------------
   Consolida los módulos de Compras/Ventas (taxService), Retenciones/Percepciones
   (retencionService) y aplica el motor de cálculo (declaracionesEngine). Guarda
   en Supabase los saldos iniciales y los ajustes manuales por periodo; los
   importes calculados se recalculan siempre desde la fuente para no quedar
   desincronizados.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { taxService } from '../compras/taxService.js';
import { retencionService } from '../retencion/retencionService.js';
import {
  round2, uitFor,
  recalculateAnnualTimeline, annualTotals,
} from './declaracionesEngine.js';

let mode = 'unknown';
let checked = false;
let lastError = '';
let cache = null; // { year, balances, overrides, timeline, mode }

function cid() {
  const company = authService.activeCompany();
  return company ? company.id : null;
}

function nowIso() {
  return new Date().toISOString();
}

function isMissingTable(err) {
  const msg = String(err?.message || err || '');
  return /could not find the table|schema cache|does not exist|no existe la tabla/i.test(msg);
}

async function detectMode() {
  if (checked) return mode;
  checked = true;
  try {
    const [r1, r2] = await Promise.all([
      supabase.from('declaraciones_balances').select('id').limit(1),
      supabase.from('tax_declaration_periods').select('id').limit(1),
    ]);
    const err = r1.error || r2.error;
    if (err && isMissingTable(err)) {
      mode = 'local';
      lastError = err.message;
    } else if (err) {
      checked = false;
      throw new Error(err.message);
    } else {
      mode = 'remote';
    }
  } catch (err) {
    if (isMissingTable(err)) {
      mode = 'local';
      lastError = err.message;
    } else {
      checked = false;
      throw err;
    }
  }
  return mode;
}

function balancesKey(companyId) {
  return `fica.declaraciones.balances.${companyId}`;
}
function periodsKey(companyId) {
  return `fica.declaraciones.periods.${companyId}`;
}

/** Extrae los importes del mes desde los módulos fuente. */
function extractSourceMonth(year, month) {
  const period = `${year}${String(month).padStart(2, '0')}`;
  const ventas = taxService.summary('venta', period);
  const compras = taxService.summary('compra', period);
  const percepcionesMes = retencionService.summary('percepcion', period).retenido;
  const retencionesMes = retencionService.summary('retencion', period).retenido;
  // "Ingresos netos" (ventas netas) para la renta RMT = base gravada del mes,
  // igual que el PDT 621 (casilla 301 = base gravada neta de descuentos).
  const ventasNetasMes = round2(ventas.baseGravada || 0);

  return {
    anio: year,
    mes: month,
    igvVentas: round2(ventas.igv || 0),
    igvCompras: round2(compras.igv || 0),
    baseGravadaV: round2(ventas.baseGravada || 0),
    baseGravadaC: round2(compras.baseGravada || 0),
    baseNoGravadaV: round2(ventas.baseNoGravada || 0),
    baseNoGravadaC: round2(compras.baseNoGravada || 0),
    percepcionesMes,
    retencionesMes,
    ventasNetasMes,
    pagosPrevios: 0,
    intereses: 0,
    pagosPreviosRenta: 0,
    interesesRenta: 0,
    estado: 'calculado',
  };
}

function emptyBalances(year) {
  return {
    anio: Number(year),
    saldo_igv_anterior: 0,
    percepciones_ant: 0,
    retenciones_ant: 0,
    uit: uitFor(year),
    coeficiente_renta: 0,
    is_manual_initial_balance: false,
  };
}

async function loadBalances(companyId, year) {
  if (mode === 'local') {
    try {
      const raw = JSON.parse(localStorage.getItem(balancesKey(companyId)) || '{}');
      const row = raw[year] || null;
      return row ? { ...emptyBalances(year), ...row } : emptyBalances(year);
    } catch {
      return emptyBalances(year);
    }
  }
  const { data } = await supabase
    .from('declaraciones_balances')
    .select('*')
    .eq('company_id', companyId)
    .eq('anio', year)
    .maybeSingle();
  return data ? { ...emptyBalances(year), ...data } : emptyBalances(year);
}

async function loadOverrides(companyId, year) {
  if (mode === 'local') {
    try {
      const raw = JSON.parse(localStorage.getItem(periodsKey(companyId)) || '{}');
      return raw[year] || {};
    } catch {
      return {};
    }
  }
  const { data } = await supabase
    .from('tax_declaration_periods')
    .select('*')
    .eq('company_id', companyId)
    .eq('anio', year);
  const map = {};
  for (const row of data || []) map[row.mes] = row;
  return map;
}

export const declaracionesService = {
  get mode() { return mode; },
  get lastError() { return lastError; },

  /** Calcula y cachea el año completo. */
  async refresh(year) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    await taxService.refresh();
    await retencionService.refresh();

    const balances = await loadBalances(companyId, year);
    const overrides = await loadOverrides(companyId, year);

    const sourceMonths = [];
    for (let m = 1; m <= 12; m += 1) {
      const src = extractSourceMonth(year, m);
      const ov = overrides[m];
      if (ov) {
        src.pagosPrevios = Number(ov.pagos_previos || 0);
        src.intereses = Number(ov.intereses || 0);
        src.pagosPreviosRenta = Number(ov.pagos_previos_renta || 0);
        src.interesesRenta = Number(ov.intereses_renta || 0);
        src.estado = ov.estado || 'calculado';
      }
      sourceMonths.push(src);
    }

    const initial = {
      saldoIgvFavor: Number(balances.saldo_igv_anterior || 0),
      percepcionesNoAplicadas: Number(balances.percepciones_ant || 0),
      retencionesNoAplicadas: Number(balances.retenciones_ant || 0),
    };
    const config = {
      uit: Number(balances.uit || 0),
      coeficienteRenta: Number(balances.coeficiente_renta || 0),
    };

    const timeline = recalculateAnnualTimeline(sourceMonths, initial, config);
    cache = {
      year: Number(year),
      balances,
      overrides,
      timeline,
      totals: annualTotals(timeline.months),
      mode,
    };
    return cache;
  },

  /** Devuelve el último timeline cacheado (null si aún no se calculó). */
  current() {
    return cache;
  },

  /** Saldos iniciales / configuración del ejercicio. */
  async saveBalances(year, patch) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const row = {
      company_id: companyId,
      anio: Number(year),
      saldo_igv_anterior: round2(patch.saldo_igv_anterior || 0),
      percepciones_ant: round2(patch.percepciones_ant || 0),
      retenciones_ant: round2(patch.retenciones_ant || 0),
      uit: Number(patch.uit || 0) || uitFor(year),
      coeficiente_renta: Number(patch.coeficiente_renta || 0),
      is_manual_initial_balance: !!patch.is_manual_initial_balance,
      updated_at: nowIso(),
    };
    if (mode === 'local') {
      const key = balancesKey(companyId);
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      raw[year] = row;
      localStorage.setItem(key, JSON.stringify(raw));
    } else {
      const { error } = await supabase.from('declaraciones_balances').upsert(row);
      if (error) throw new Error(error.message);
    }
    await this.refresh(year);
    return cache;
  },

  /** Ajuste manual de un periodo (pagos previos, intereses, estado). */
  async savePeriod(year, mes, patch) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const row = {
      company_id: companyId,
      anio: Number(year),
      mes: Number(mes),
      pagos_previos: round2(patch.pagos_previos || 0),
      intereses: round2(patch.intereses || 0),
      pagos_previos_renta: round2(patch.pagos_previos_renta || 0),
      intereses_renta: round2(patch.intereses_renta || 0),
      estado: patch.estado || 'calculado',
      updated_at: nowIso(),
    };
    if (mode === 'local') {
      const key = periodsKey(companyId);
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      const yearMap = raw[year] || {};
      yearMap[mes] = row;
      raw[year] = yearMap;
      localStorage.setItem(key, JSON.stringify(raw));
    } else {
      const { error } = await supabase.from('tax_declaration_periods').upsert(row);
      if (error) throw new Error(error.message);
    }
    await this.refresh(year);
    return cache;
  },
};
