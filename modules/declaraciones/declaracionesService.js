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
import { baseGravadaOf, igvOf, isSolarized } from '../compras/comprasConfig.js';
import { exchangeRateService } from '../compras/exchangeRateService.js';
import {
  round2, uitFor,
  recalculateAnnualTimeline, annualTotals,
} from './declaracionesEngine.js';
import {
  vencimientoFor, descargarCronograma, cronogramaStatus,
} from './cronogramaService.js';

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

/* Cronograma SUNAT (respaldo): si no hay cronograma oficial para el ejercicio,
   se estima el día según el último dígito del RUC (0→15, 1→16, …, 9→24). */
const VENCIMIENTO_DIA = { 0: 15, 1: 16, 2: 17, 3: 18, 4: 19, 5: 20, 6: 21, 7: 22, 8: 23, 9: 24 };

function rucLastDigit(ruc) {
  const digits = String(ruc || '').replace(/\D/g, '');
  return digits ? Number(digits.slice(-1)) : 0;
}

/** Fecha de vencimiento por defecto (YYYY-MM-DD) para un periodo.
 *  Usa el cronograma oficial SUNAT (descargado o incluido) y, si no existe,
 *  estima con la regla histórica. */
export function defaultVencimiento(year, month, ruc) {
  const official = vencimientoFor(year, month, ruc);
  if (official) return official;
  const day = VENCIMIENTO_DIA[rucLastDigit(ruc)] || 15;
  // month es 1-based: new Date(año, mes, día) cae en el mes siguiente.
  const d = new Date(Number(year), Number(month), day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Tipo de cambio a soles para el detalle de IGV. */
function penRate(rec) {
  if (isSolarized(rec)) return 1;
  if (String(rec.currency || 'PEN').toUpperCase() === 'PEN') return 1;
  const own = Number(rec.exchange_rate || 0);
  if (own > 1) return own;
  return Number(exchangeRateService.rateFor(rec.issue_date, rec.currency)?.rate || 0) || 1;
}

/** Clasifica la tasa de IGV de un comprobante (18%, 10% u otra). */
function rateBucket(rate) {
  if (!(rate > 0)) return '0%';
  if (Math.abs(rate - 0.18) < 0.005) return '18%';
  if (Math.abs(rate - 0.10) < 0.005) return '10%';
  return `${(rate * 100).toFixed(2)}%`;
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

/** Borra el vencimiento guardado de los periodos indicados para que vuelvan
 *  a seguir el cronograma oficial. */
async function clearStoredVencimientos(companyId, year, months) {
  if (!months.length) return;
  if (mode === 'local') {
    const key = periodsKey(companyId);
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    const yearMap = raw[year] || {};
    for (const mes of months) {
      if (yearMap[mes]) yearMap[mes].fecha_vencimiento = null;
    }
    raw[year] = yearMap;
    localStorage.setItem(key, JSON.stringify(raw));
    return;
  }
  const { error } = await supabase
    .from('tax_declaration_periods')
    .update({ fecha_vencimiento: null })
    .eq('company_id', companyId)
    .eq('anio', Number(year))
    .in('mes', months);
  if (error) throw new Error(error.message);
}

export const declaracionesService = {
  get mode() { return mode; },
  get lastError() { return lastError; },

  /** Calcula y cachea el año completo. */
  async refresh(year) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    const company = authService.activeCompany() || {};
    await detectMode();
    await taxService.refresh();
    await retencionService.refresh();

    const balances = await loadBalances(companyId, year);
    const overrides = await loadOverrides(companyId, year);

    const sourceMonths = [];
    for (let m = 1; m <= 12; m += 1) {
      const src = extractSourceMonth(year, m);
      const ov = overrides[m] || {};
      src.pagosPrevios = Number(ov.pagos_previos || 0);
      src.pagosPreviosRenta = Number(ov.pagos_previos_renta || 0);
      src.fechaVencimiento = ov.fecha_vencimiento || defaultVencimiento(year, m, company.ruc);
      src.fechaDeclaracion = ov.fecha_declaracion || '';
      src.interesManual = !!ov.interes_manual;
      src.intereses = Number(ov.intereses || 0);
      src.interesesRenta = Number(ov.intereses_renta || 0);
      src.estado = ov.estado || 'pendiente';
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

  /**
   * Desglose del IGV de un periodo por tasa (18% / 10% / otras).
   * Sirve para verificar cómo se compone el IGV de compras o ventas.
   */
  igvDetail(kind, period) {
    const rows = taxService.list(kind, { period });
    const detail = [];
    const groups = new Map();
    for (const r of rows) {
      const rate = penRate(r);
      const base = round2(baseGravadaOf(r, kind) * rate);
      const igv = round2(igvOf(r) * rate);
      if (base === 0 && igv === 0) continue;
      const bucket = rateBucket(base > 0 ? igv / base : 0);
      detail.push({
        id: r.id,
        issue_date: r.issue_date,
        doc_type: r.doc_type,
        series: r.series,
        number: r.number,
        counterparty_name: r.counterparty_name,
        base,
        igv,
        bucket,
      });
      const g = groups.get(bucket) || { bucket, count: 0, base: 0, igv: 0 };
      g.count += 1;
      g.base += base;
      g.igv += igv;
      groups.set(bucket, g);
    }
    const grouped = [...groups.values()]
      .map((g) => ({ ...g, base: round2(g.base), igv: round2(g.igv) }))
      .sort((a, b) => b.base - a.base);
    return { rows: detail.sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || ''))), groups: grouped };
  },

  /** Estado del cronograma de vencimientos del ejercicio. */
  cronograma(year) {
    return cronogramaStatus(year);
  },

  /**
   * Descarga el cronograma oficial de SUNAT y lo aplica.
   * Solo limpia los vencimientos guardados que coincidían con el cronograma
   * anterior (es decir, los que nunca se ajustaron a mano).
   */
  async syncCronograma(year) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    const company = authService.activeCompany() || {};
    const previous = {};
    for (let m = 1; m <= 12; m += 1) previous[m] = defaultVencimiento(year, m, company.ruc);

    const data = await descargarCronograma(year);

    await detectMode();
    const overrides = await loadOverrides(companyId, year);
    const automatic = [];
    for (let m = 1; m <= 12; m += 1) {
      const stored = overrides[m]?.fecha_vencimiento;
      if (stored && stored === previous[m]) automatic.push(m);
    }
    await clearStoredVencimientos(companyId, year, automatic);

    await this.refresh(year);
    return { data, updated: automatic.length };
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

  /** Ajuste manual de un periodo (fechas de control, pagos previos, estado). */
  async savePeriod(year, mes, patch) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const dateOrNull = (value) => {
      const v = String(value || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    };
    const row = {
      company_id: companyId,
      anio: Number(year),
      mes: Number(mes),
      pagos_previos: round2(patch.pagos_previos || 0),
      intereses: round2(patch.intereses || 0),
      pagos_previos_renta: round2(patch.pagos_previos_renta || 0),
      intereses_renta: round2(patch.intereses_renta || 0),
      fecha_declaracion: dateOrNull(patch.fecha_declaracion),
      fecha_vencimiento: dateOrNull(patch.fecha_vencimiento),
      interes_manual: !!patch.interes_manual,
      estado: patch.estado || 'pendiente',
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
