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
    if (!emp.startDate) return 6;
    const [sy, sm] = String(emp.startDate).slice(0, 10).split('-').map(Number);
    if (!sy || !sm) return 6;
    if (sy < year) return 6;
    if (sy > year) return 0;
    if (semestre === 'julio') return sm > 6 ? 0 : 7 - sm; // ene=6 … jun=1
    // diciembre (jul-dic): si empezó antes de julio, el semestre es completo
    return sm <= 6 ? 6 : 13 - sm; // jul=6 … dic=1
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

  /** Días de permisos sin goce de haber en el período CTS. */
  unpaidDays(emp, year, periodo) {
    let d = 0;
    for (const { year: y, month: m } of this.semesterMonths(year, periodo)) {
      d += attendanceService.summarize(emp.id, y, m, emp.baseSalary).absentWithoutPay;
    }
    return d;
  },

  /** Días computables de CTS = 180 − permisos sin goce de haber. */
  ctsDiasComputables(emp, year, periodo) {
    return Math.max(0, 180 - this.unpaidDays(emp, year, periodo));
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
