/* ============================================================================
   benefitsService.js — CTS y Gratificaciones (beneficios sociales)
   ----------------------------------------------------------------------------
   - Gratificación (julio / diciembre):
       base       = sueldo básico + asignación familiar (si aplica)
       monto      = (base / 6) * meses completos trabajados
       bonif.     = 9% (Ley 29351 - EsSalud) o 6.75% (si tiene EPS)
   - CTS (mayo / noviembre):
       base       = básico + asignación familiar + (1/6 de la última gratificación)
       monto      = (base / 360) * días computables (habitualmente 180)
   ========================================================================== */

import { num, round2, clamp } from './payrollUtils.js';
import { getRmv, TASAS } from './payrollConfig.js';

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
   * Gratificación semestral.
   * @param {Object} opts { year, mesesCompletos (0-6), tipoBono ('ESSALUD'|'EPS') }
   */
  calcGratificacion(emp, { year, mesesCompletos = 6, tipoBono = 'ESSALUD', factor = 1 } = {}) {
    const base = this.gratificacionBase(emp, year);
    const meses = clamp(num(mesesCompletos, 6), 0, 6);
    const monto = round2((base / 6) * meses * num(factor, 1));
    const tasaBono = tipoBono === 'EPS' ? 0.0675 : 0.09;
    const bonificacion = round2(monto * tasaBono);
    return {
      base,
      mesesCompletos: meses,
      monto,
      tasaBono,
      bonificacion,
      total: round2(monto + bonificacion),
    };
  },

  /**
   * CTS semestral (mayo / noviembre).
   * @param {Object} opts { year, diasComputables (180), ultimaGratificacion }
   */
  calcCts(emp, { year, diasComputables = 180, ultimaGratificacion = null, factor = 1, hasCts = true } = {}) {
    const asig = this.asignacionFamiliar(emp, year);
    const gratiRef = ultimaGratificacion == null ? round2(num(emp.baseSalary) + asig) : num(ultimaGratificacion);
    const sexto = round2(gratiRef / 6);
    const base = round2(num(emp.baseSalary) + asig + sexto);
    if (!hasCts) return { base, sexto, diasComputables: num(diasComputables, 180), monto: 0, hasCts: false };
    const monto = round2((base / 360) * num(diasComputables, 180) * num(factor, 1));
    return { base, sexto, diasComputables: num(diasComputables, 180), monto, hasCts: true };
  },
};
