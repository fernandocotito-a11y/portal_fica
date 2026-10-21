/* ============================================================================
   vacationService.js — Control de vacaciones (Supabase)
   ----------------------------------------------------------------------------
   Reglas implementadas:
     · El derecho se genera por AÑOS COMPLETOS: 30 días (régimen general) o
       15 días (pequeña empresa / microempresa). No hay acumulación fraccionada.
     · A los 6 meses del período se habilita un adelanto: la mitad del derecho
       anual (15 días general / 7 días MYPE), tal como se toma en la práctica.
     · El período es el RÉCORD VACACIONAL (ej. 2025-2026) y se elige de una
       lista generada desde la fecha de ingreso.
     · Los días se calculan desde el rango de fechas (inclusive) y se prorratean
       por mes para que la planilla refleje la remuneración vacacional y el
       básico de cada mes cuando el descanso cruza de un mes a otro.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];
const DIAS_LEGALES = 30;

/* --------------------------------------------------------------- utilidades */
function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    period: r.period || '',
    daysTaken: Math.round(num(r.days_taken)),
    dateFrom: r.date_from || '',
    dateTo: r.date_to || '',
    monthYear: r.month_year || '',
    note: r.note || '',
  };
}

/** Parsea 'YYYY-MM-DD' sin desfase UTC. */
function parseISO(iso) {
  const s = String(iso || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}
function isoOf(p) {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
function toUTC(p) {
  return Date.UTC(p.y, p.m - 1, p.d);
}
function maxP(a, b) {
  return toUTC(a) >= toUTC(b) ? a : b;
}
function minP(a, b) {
  return toUTC(a) <= toUTC(b) ? a : b;
}
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function daysInclusive(a, b) {
  return Math.max(0, Math.round((toUTC(b) - toUTC(a)) / 86400000) + 1);
}
function dayBefore(p) {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function addYearsClamped(p, n) {
  const y = p.y + n;
  const maxDay = daysInMonth(y, p.m);
  return { y, m: p.m, d: Math.min(p.d, maxDay) };
}
/** Meses completos entre dos fechas. */
function monthsBetween(a, b) {
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(0, months);
}
/** Años completos de servicio (con aniversario ajustado a fin de mes). */
function completedYears(a, b) {
  let years = b.y - a.y;
  if (years < 0) return 0;
  const anniv = addYearsClamped(a, years);
  if (toUTC(anniv) > toUTC(b)) years -= 1;
  return Math.max(0, years);
}
/** Convierte Date o ISO a partes {y,m,d} sin desfase. */
function partsOf(value) {
  if (typeof value === 'string') return parseISO(value);
  if (value instanceof Date) {
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

export function periodOfYear(year) {
  return `${year}-${year + 1}`;
}

export const vacationService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_vacations').select('*').eq('company_id', cid);
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    return employeeId ? cache.filter((r) => r.employeeId === employeeId) : cache.slice();
  },

  async create(data) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: data.employeeId,
      period: data.period || null,
      days_taken: Math.round(num(data.daysTaken)),
      date_from: data.dateFrom || null,
      date_to: data.dateTo || null,
      month_year: data.monthYear || null,
      note: data.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_vacations').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },
  async update(id, patch) {
    const merged = { ...(this.list().find((r) => r.id === id) || {}), ...patch };
    const row = {
      employee_id: merged.employeeId || null,
      period: merged.period || null,
      days_taken: Math.round(num(merged.daysTaken)),
      date_from: merged.dateFrom || null,
      date_to: merged.dateTo || null,
      month_year: merged.monthYear || null,
      note: merged.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_vacations').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    const i = cache.findIndex((r) => r.id === id);
    if (i >= 0) cache[i] = rec;
    return rec;
  },
  async remove(id) {
    const { error } = await supabase.from('payroll_vacations').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((r) => r.id !== id);
  },

  /* ------------------------------ Períodos -------------------------------- */
  /**
   * Períodos (récords vacacionales) desde el ingreso hasta el período actual.
   * Devuelve el más reciente primero.
   * @param {Object} employee  Colaborador con startDate.
   * @param {Date|string} today  Fecha de corte (por defecto hoy).
   */
  periodsFor(employee, today = new Date()) {
    const start = parseISO(employee && employee.startDate);
    const t = partsOf(today);
    if (!start || !t) return [];

    let idx = t.y - start.y;
    const anniv = addYearsClamped(start, idx);
    if (toUTC(anniv) > toUTC(t)) idx -= 1;
    idx = Math.max(0, idx);

    const out = [];
    for (let i = 0; i <= idx; i += 1) {
      const ps = addYearsClamped(start, i);
      const next = addYearsClamped(start, i + 1);
      const pe = dayBefore(next);
      out.push({
        index: i,
        value: `${ps.y}-${next.y}`,
        label: `${ps.y}-${next.y}`,
        start: isoOf(ps),
        end: isoOf(pe),
        complete: toUTC(t) > toUTC(pe),
        current: toUTC(t) >= toUTC(ps) && toUTC(t) <= toUTC(pe),
        monthsElapsed: monthsBetween(ps, minP(t, pe)),
      });
    }
    return out.reverse();
  },

  /** Derecho del período: 30/15 si está completo; mitad si está en curso con 6 meses. */
  entitlementFor(period, baseDays = DIAS_LEGALES) {
    if (!period) return 0;
    const base = num(baseDays, DIAS_LEGALES);
    if (period.complete) return base;
    if (period.current && period.monthsElapsed >= 6) return Math.floor(base / 2);
    return 0;
  },

  /** Mapa período -> días gozados (usa el período explícito o la fecha de inicio). */
  _takenMap(employeeId, periods, untilISO = null) {
    const map = new Map();
    this.list(employeeId).forEach((r) => {
      if (untilISO && r.dateFrom && r.dateFrom > untilISO) return;
      const days = Math.round(num(r.daysTaken));
      if (!days) return;
      let p = periods.find((x) => x.value === r.period);
      if (!p && r.dateFrom) p = periods.find((x) => r.dateFrom >= x.start && r.dateFrom <= x.end);
      if (p) map.set(p.value, (map.get(p.value) || 0) + days);
    });
    return map;
  },

  /**
   * Saldo integral de un colaborador (enteros).
   * @returns {{years:number, months:number, accrued:number, taken:number,
   *            pending:number, base:number, advance:number, periods:Array, current:Object|null}}
   */
  balanceFor(employee, baseDays = DIAS_LEGALES, today = new Date()) {
    const base = num(baseDays, DIAS_LEGALES);
    const periods = this.periodsFor(employee, today);
    const takenMap = this._takenMap(employee.id, periods);

    let accrued = 0;
    periods.forEach((p) => {
      p.entitlement = this.entitlementFor(p, base);
      p.taken = takenMap.get(p.value) || 0;
      p.pending = Math.max(0, p.entitlement - p.taken);
      accrued += p.entitlement;
    });

    const allTaken = Math.round(
      this.list(employee.id).reduce((s, r) => s + Math.round(num(r.daysTaken)), 0)
    );
    const start = parseISO(employee.startDate);
    const t = partsOf(today);

    return {
      years: start && t ? completedYears(start, t) : 0,
      months: start && t ? monthsBetween(start, t) : 0,
      accrued,
      taken: allTaken,
      pending: Math.max(0, accrued - allTaken),
      base,
      advance: Math.floor(base / 2),
      periods,
      current: periods.find((p) => p.current) || null,
    };
  },

  /** Compatibilidad con el estado de cuenta y reportes. */
  accrual(employeeId, baseDays = DIAS_LEGALES, today = new Date()) {
    const emp = this._emp(employeeId);
    if (!emp || !emp.startDate) {
      const taken = Math.round(
        this.list(employeeId).reduce((s, r) => s + Math.round(num(r.daysTaken)), 0)
      );
      return {
        years: 0,
        months: 0,
        accrued: 0,
        taken,
        pending: 0,
        base: num(baseDays, DIAS_LEGALES),
        advance: Math.floor(num(baseDays, DIAS_LEGALES) / 2),
        periods: [],
        current: null,
      };
    }
    return this.balanceFor(emp, baseDays, today);
  },

  /** Días disponibles del período (descontando lo ya gozado). */
  availableForPeriod(employee, periodValue, baseDays = DIAS_LEGALES, excludeId = null) {
    const periods = this.periodsFor(employee);
    const p = periods.find((x) => x.value === periodValue);
    if (!p) return 0;
    const entitlement = this.entitlementFor(p, baseDays);
    const taken = this.list(employee.id)
      .filter((r) => r.id !== excludeId)
      .filter((r) => (r.period ? r.period === periodValue : r.dateFrom >= p.start && r.dateFrom <= p.end))
      .reduce((s, r) => s + Math.round(num(r.daysTaken)), 0);
    return Math.max(0, entitlement - taken);
  },

  /** Días de un rango inclusive (días calendario). */
  daysInRange(fromISO, toISO) {
    const a = parseISO(fromISO);
    const b = parseISO(toISO);
    if (!a || !b || toUTC(a) > toUTC(b)) return 0;
    return daysInclusive(a, b);
  },

  /** Reparte un rango de vacaciones por mes: [{ year, month, days }]. */
  splitByMonth(fromISO, toISO) {
    const from = parseISO(fromISO);
    const to = parseISO(toISO);
    if (!from || !to || toUTC(from) > toUTC(to)) return [];
    const out = [];
    let cur = { y: from.y, m: from.m, d: 1 };
    while (toUTC(cur) <= toUTC(to)) {
      const monthEnd = { y: cur.y, m: cur.m, d: daysInMonth(cur.y, cur.m) };
      const a = maxP(from, cur);
      const b = minP(to, monthEnd);
      if (toUTC(a) <= toUTC(b)) {
        out.push({ year: cur.y, month: cur.m, days: daysInclusive(a, b) });
      }
      cur = cur.m === 12 ? { y: cur.y + 1, m: 1, d: 1 } : { y: cur.y, m: cur.m + 1, d: 1 };
    }
    return out;
  },

  /**
   * Días de vacaciones que caen en un mes concreto (para planilla).
   * Si el registro no tiene fechas, usa el mes/año antiguo como respaldo.
   */
  takenInMonth(employeeId, year, month) {
    const mStart = { y: year, m: month, d: 1 };
    const mEnd = { y: year, m: month, d: daysInMonth(year, month) };
    return this.list(employeeId).reduce((sum, r) => {
      const from = parseISO(r.dateFrom);
      const to = parseISO(r.dateTo);
      if (from && to) {
        const a = maxP(from, mStart);
        const b = minP(to, mEnd);
        return sum + (toUTC(a) <= toUTC(b) ? daysInclusive(a, b) : 0);
      }
      if (r.monthYear === `${year}-${String(month).padStart(2, '0')}`) {
        return sum + Math.round(num(r.daysTaken));
      }
      return sum;
    }, 0);
  },

  /** Días gozados de un período (por el campo período). */
  takenInPeriod(employeeId, period) {
    return this.list(employeeId)
      .filter((r) => r.period === period)
      .reduce((s, r) => s + Math.round(num(r.daysTaken)), 0);
  },

  /**
   * Vista de vacaciones para una LIQUIDACIÓN (cese):
   *   · pendientes = suma de períodos completos no gozados.
   *   · truncas = proporcional del período en curso menos lo ya gozado en él.
   *   · Si el descanso del período en curso excede la trunca, el exceso
   *     descuenta del pendiente (no se paga dos veces).
   */
  accrualAtCese(employee, ceseISO, baseDays = DIAS_LEGALES) {
    const cese = parseISO(ceseISO);
    const start = parseISO(employee && employee.startDate);
    const base = num(baseDays, DIAS_LEGALES);
    if (!start || !cese || toUTC(start) > toUTC(cese)) {
      return { years: 0, pending: 0, truncated: 0, currentTaken: 0, taken: 0, periods: [] };
    }

    const periods = this.periodsFor(employee, ceseISO);
    const takenMap = this._takenMap(employee.id, periods, isoOf(cese));
    let pending = 0;
    let currentTaken = 0;
    periods.forEach((p) => {
      const taken = takenMap.get(p.value) || 0;
      if (toUTC(parseISO(p.end)) < toUTC(cese)) {
        pending += Math.max(0, base - taken);
      } else {
        currentTaken += taken;
      }
    });

    const years = completedYears(start, cese);
    const anniv = addYearsClamped(start, years);
    let months = (cese.y - anniv.y) * 12 + (cese.m - anniv.m);
    let days = cese.d - anniv.d;
    if (days < 0) {
      months -= 1;
      days += 30;
    }
    months = Math.max(0, months);
    days = Math.max(0, days);
    const truncas = Math.min(base, (months / 12) * base + (days / 360) * base);
    const netCurrent = round2(truncas - currentTaken);
    let truncated = Math.max(0, netCurrent);
    if (netCurrent < 0) pending = Math.max(0, pending + netCurrent);
    if (pending < 0) pending = 0;

    const takenAll = Math.round(
      this.list(employee.id)
        .filter((r) => !r.dateFrom || r.dateFrom <= isoOf(cese))
        .reduce((s, r) => s + Math.round(num(r.daysTaken)), 0)
    );

    return {
      years,
      pending: Math.round(pending),
      truncated: round2(truncated),
      truncasOriginal: round2(truncas),
      currentTaken,
      taken: takenAll,
      periods,
    };
  },

  _emp(employeeId) {
    // Evita dependencia circular: se inyecta desde el servicio de planilla.
    return this._employeeGetter ? this._employeeGetter(employeeId) : null;
  },
  setEmployeeGetter(fn) {
    this._employeeGetter = fn;
  },
};
