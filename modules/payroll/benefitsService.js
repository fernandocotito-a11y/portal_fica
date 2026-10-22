/* ============================================================================
   benefitsService.js — CTS y Gratificaciones (beneficios sociales)
   ----------------------------------------------------------------------------
   Todo se calcula automáticamente:
   - Gratificación (julio / diciembre): meses completos según la fecha de inicio.
   - Bono extraordinario: EsSalud 9% / EPS 6.75% (atributo `salud` del trabajador).
   - CTS (mayo / noviembre): días computables = 180 − permisos sin goce de haber.
   ========================================================================== */

import { num, round2, clamp } from './payrollUtils.js';
import { getRmv, TASAS } from './payrollConfig.js';
import { attendanceService } from './attendanceService.js';

const pad2 = (n) => String(n).padStart(2, '0');
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthStartIso = (year, month) => `${year}-${pad2(month)}-01`;
const monthEndIso = (year, month) => `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`;

function isoParts(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  return year && month && day ? { year, month, day } : null;
}

/** Días calendario inclusivos entre dos fechas ISO. */
function daysInclusive(fromISO, toISO) {
  const a = Date.parse(`${String(fromISO).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toISO).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Meses calendario COMPLETOS entre dos fechas ISO (inclusive). */
function completeMonths(startISO, endISO) {
  const start = isoParts(startISO);
  const end = isoParts(endISO);
  if (!start || !end || startISO > endISO) return 0;
  let count = 0;
  let { year, month } = start;
  while (year * 100 + month <= end.year * 100 + end.month) {
    if (monthStartIso(year, month) >= startISO && monthEndIso(year, month) <= endISO) count += 1;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return count;
}

export const BENEFIT_BONOS = [
  { value: 'ESSALUD', label: 'EsSalud (9%)' },
  { value: 'EPS', label: 'EPS (6.75%)' },
];

export const benefitsService = {
  /** Asignación familiar = 10% de la RMV (si aplica). */
  asignacionFamiliar(emp, year) {
    return emp.asignacionFamiliar ? round2(getRmv(year) * TASAS.asignacionFamiliar) : 0;
  },

  /** Base computable de gratificación = básico + asignación familiar. */
  gratificacionBase(emp, year) {
    return round2(num(emp.baseSalary) + this.asignacionFamiliar(emp, year));
  },

  /**
   * Meses completos del semestre según la fecha de inicio.
   * @param {string} semestre 'julio' (ene-jun) | 'diciembre' (jul-dic)
   */
  gratificacionMeses(emp, year, semestre) {
    const periodStart = semestre === 'julio' ? `${year}-01-01` : `${year}-07-01`;
    const periodEnd = semestre === 'julio' ? `${year}-06-30` : `${year}-12-31`;
    const startDate = String(emp.startDate || '').slice(0, 10);
    const cese = String(emp.cese || '').slice(0, 10);
    const from = startDate && startDate > periodStart ? startDate : periodStart;
    const to = cese && cese < periodEnd ? cese : periodEnd;
    if (from > to) return 0;
    return clamp(completeMonths(from, to), 0, 6);
  },

  /** Gratificación de un semestre (auto: meses + bono según salud). */
  calcGratificacion(emp, { year, semestre = 'diciembre', factor = 1, salud = null } = {}) {
    const base = this.gratificacionBase(emp, year);
    const meses = clamp(this.gratificacionMeses(emp, year, semestre), 0, 6);
    const monto = round2((base / 6) * meses * num(factor, 1));
    const s = salud || emp.salud || 'ESSALUD';
    const tasaBono = s === 'EPS' ? 0.0675 : 0.09;
    const bonificacion = round2(monto * tasaBono);
    return { base, semestre, mesesCompletos: meses, monto, tasaBono, bonificacion, total: round2(monto + bonificacion) };
  },

  /** Meses del período CTS. @param periodo 'mayo' (nov-abr) | 'noviembre' (may-oct). */
  semesterMonths(year, periodo) {
    if (periodo === 'noviembre') {
      const arr = [];
      for (let m = 5; m <= 10; m++) arr.push({ year, month: m });
      return arr;
    }
    return [
      { year: year - 1, month: 11 },
      { year: year - 1, month: 12 },
      { year, month: 1 },
      { year, month: 2 },
      { year, month: 3 },
      { year, month: 4 },
    ];
  },

  /** Rango calendario del período CTS (depósito de mayo / noviembre). */
  ctsRange(year, periodo) {
    return periodo === 'noviembre'
      ? { start: `${year}-05-01`, end: `${year}-10-31` }
      : { start: `${year - 1}-11-01`, end: `${year}-04-30` };
  },

  /** Días sin goce de haber dentro de un rango ISO (inclusive). */
  unpaidDaysInRange(emp, fromISO, toISO) {
    let days = 0;
    attendanceService.list(emp.id).forEach((r) => {
      const date = String(r.date || '').slice(0, 10);
      if (!date || date < fromISO || date > toISO) return;
      if (r.withPay === false && ['falta', 'descanso_medico', 'licencia'].includes(r.type)) days += 1;
    });
    return days;
  },

  /** Días de permisos sin goce de haber en el período CTS. */
  unpaidDays(emp, year, periodo) {
    const range = this.ctsRange(year, periodo);
    return this.unpaidDaysInRange(emp, range.start, range.end);
  },

  /**
   * Días computables de CTS = días del período dentro de la relación laboral
   * (máximo 180) − permisos sin goce de haber. Así un trabajador que ingresó a
   * mitad del semestre no recibe CTS por meses en los que aún no trabajaba.
   */
  ctsDiasComputables(emp, year, periodo) {
    const range = this.ctsRange(year, periodo);
    const startDate = String(emp.startDate || '').slice(0, 10);
    const cese = String(emp.cese || '').slice(0, 10);
    const from = startDate && startDate > range.start ? startDate : range.start;
    const to = cese && cese < range.end ? cese : range.end;
    if (from > to) return 0;
    const days = Math.min(180, daysInclusive(from, to));
    const unpaid = this.unpaidDaysInRange(emp, from, to);
    return Math.max(0, days - unpaid);
  },

  /** CTS de un período (auto: días computables según asistencias). */
  calcCts(emp, { year, periodo = 'noviembre', factor = 1, hasCts = true } = {}) {
    const asig = this.asignacionFamiliar(emp, year);
    const gratiRef = round2(num(emp.baseSalary) + asig);
    const sexto = round2(gratiRef / 6);
    const base = round2(num(emp.baseSalary) + asig + sexto);
    const dias = this.ctsDiasComputables(emp, year, periodo);
    if (!hasCts) return { base, sexto, diasComputables: dias, monto: 0, hasCts: false };
    const monto = round2((base / 360) * dias * num(factor, 1));
    return { base, sexto, diasComputables: dias, monto, hasCts: true };
  },
};
