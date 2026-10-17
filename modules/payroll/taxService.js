/* ============================================================================
   taxService.js — Renta de 5ª Categoría (algoritmo SUNAT de retención mensual)
   ----------------------------------------------------------------------------
   Procedimiento legal (proyección anual):
     1. Proyectar remuneraciones ordinarias desde el mes actual a diciembre.
     2. Sumar gratificaciones ordinarias de julio y diciembre + bono 9%.
     3. Sumar pagos acumulados percibidos en meses anteriores del ejercicio.
     4. Renta bruta proyectada − 7 UIT (y deducciones adicionales).
     5. Escala progresiva acumulativa (8/14/17/20/30%).
     6. Dividir entre el factor del mes y restar retenciones anteriores.
   ========================================================================== */

import { num, round2 } from './payrollUtils.js';
import { getUit, RENTA_5TA } from './payrollConfig.js';

/* Factor del mes (para repartir la retención a lo largo del año). */
export const MONTH_FACTOR = {
  1: 12, 2: 12, 3: 12,
  4: 9,
  5: 8, 6: 8, 7: 8,
  8: 5,
  9: 4, 10: 4, 11: 4,
  12: 1,
};

export const taxService = {
  factorForMonth(month) {
    return MONTH_FACTOR[month] ?? 12;
  },

  /** Impuesto anual según la escala progresiva acumulativa. */
  impuestoAnual(rentaNeta, uit) {
    let tax = 0;
    let prev = 0;
    for (const t of RENTA_5TA.tramos) {
      const limite = t.hastaUIT === Infinity ? Infinity : t.hastaUIT * uit;
      if (rentaNeta > prev) tax += (Math.min(rentaNeta, limite) - prev) * t.tasa;
      prev = limite;
      if (rentaNeta <= limite) break;
    }
    return round2(tax);
  },

  /**
   * Retención mensual proyectada de Renta de 5ª.
   * @param {Object} p
   *   remuneracionMensual     remuneración afecta del mes
   *   mes                     mes actual (1-12)
   *   year
   *   gratificacionesProyectadas  gratificaciones por venir (jul/dic)
   *   bonifExtraordinaria     bono 9% de esas gratificaciones
   *   acumuladoAnterior       percibido en meses previos (default: sueldo*(mes-1))
   *   retencionesAnteriores   retenciones ya aplicadas en el año
   *   deduccionAdicionalUIT   UIT adicionales (ej. hasta 3 UIT por gastos)
   */
  calcRetencionMensual({
    remuneracionMensual,
    mes,
    year,
    gratificacionesProyectadas = 0,
    bonifExtraordinaria = 0,
    acumuladoAnterior = null,
    retencionesAnteriores = 0,
    deduccionAdicionalUIT = 0,
  }) {
    const uit = getUit(year);
    const sueldo = num(remuneracionMensual);
    const m = Math.min(Math.max(Math.round(num(mes, 1)), 1), 12);
    const mesesRestantes = 12 - m + 1;

    const proyectado = round2(sueldo * mesesRestantes);
    const acumulado = acumuladoAnterior == null ? round2(sueldo * (m - 1)) : num(acumuladoAnterior);

    const rentaBruta = round2(proyectado + acumulado + num(gratificacionesProyectadas) + num(bonifExtraordinaria));
    const deduccion = round2((RENTA_5TA.deduccionUIT + num(deduccionAdicionalUIT)) * uit);
    const rentaNeta = Math.max(0, round2(rentaBruta - deduccion));

    const impuestoAnualProyectado = this.impuestoAnual(rentaNeta, uit);
    const factor = this.factorForMonth(m);

    let retencionMes = round2(impuestoAnualProyectado / factor - num(retencionesAnteriores));
    if (retencionMes < 0) retencionMes = 0;

    return {
      uit,
      mesesRestantes,
      proyectado,
      acumulado,
      gratificacionesProyectadas: round2(num(gratificacionesProyectadas)),
      bonifExtraordinaria: round2(num(bonifExtraordinaria)),
      rentaBruta,
      deduccion,
      rentaNeta,
      impuestoAnualProyectado,
      factor,
      retencionMes,
    };
  },
};
