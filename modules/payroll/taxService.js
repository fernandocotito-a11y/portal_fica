/* ============================================================================
   taxService.js — Renta de 5ª Categoría (Art. 53° TUO LIR / Art. 40° Reglamento)
   ----------------------------------------------------------------------------
   Liquidación del Impuesto a la Renta de Quinta Categoría:
     1. UIT configurable (mapa por año, sin valores fijos → payrollConfig.UIT).
     2. Deducción de ley: 7 UIT (Art. 46°) + deducción adicional opcional (hasta 3 UIT).
     3. Escala legal progresiva acumulativa por tramos marginales (8/14/17/20/30%),
        sin bases negativas.
     4. Proyección de la Renta Bruta Anual y retención mensual con divisores
        normativos (regularización con las retenciones acumuladas).
   ========================================================================== */

import { num, round2 } from './payrollUtils.js';
import { getUit } from './payrollConfig.js';

/* Deducción de ley fija (Art. 46° LIR): 7 UIT anuales. */
export const DEDUCCION_UIT = 7;

/* Deducción adicional máxima por gastos sustentados (opcional). */
export const DEDUCCION_ADICIONAL_MAX_UIT = 3;

/**
 * Escala legal progresiva (Art. 53° LIR).
 * `amplitud` = ancho del tramo en UIT. `desde` = límite inferior (en UIT).
 */
export const TRAMOS_5TA = [
  { tramo: 1, desde: 0, hasta: 5, amplitud: 5, tasa: 0.08 },
  { tramo: 2, desde: 5, hasta: 20, amplitud: 15, tasa: 0.14 },
  { tramo: 3, desde: 20, hasta: 35, amplitud: 15, tasa: 0.17 },
  { tramo: 4, desde: 35, hasta: 45, amplitud: 10, tasa: 0.2 },
  { tramo: 5, desde: 45, hasta: Infinity, amplitud: Infinity, tasa: 0.3 },
];

/** Divisores normativos de regularización por mes (Art. 40° Reglamento). */
export const DIVISORES_5TA = {
  1: 12, 2: 12, 3: 12,
  4: 9,
  5: 8, 6: 8, 7: 8,
  8: 5,
  9: 4, 10: 4, 11: 4,
  12: 1,
};

/** Divisor normativo del mes (1-12). */
export function divisorMes(mes) {
  const m = Math.min(Math.max(Math.round(num(mes, 1)), 1), 12);
  return DIVISORES_5TA[m] ?? 12;
}

/** UIT del año (mapa configurable). */
export function uitDelAnio(year) {
  return getUit(year);
}

/**
 * Desglose del impuesto anual por tramos (bases imponibles independientes).
 * @returns {Array} [{ tramo, base, tasa, impuesto }]  (nunca bases negativas)
 */
export function detalleImpuestoAnual(rni, uit) {
  const r = Math.max(0, num(rni));
  const u = num(uit);
  const hijos = {
    1: Math.min(r, 5 * u),
    2: Math.max(0, Math.min(r - 5 * u, 15 * u)),
    3: Math.max(0, Math.min(r - 20 * u, 15 * u)),
    4: Math.max(0, Math.min(r - 35 * u, 10 * u)),
    5: Math.max(0, r - 45 * u),
  };
  return TRAMOS_5TA.map((t) => ({
    tramo: t.tramo,
    base: round2(hijos[t.tramo]),
    tasa: t.tasa,
    impuesto: round2(hijos[t.tramo] * t.tasa),
  }));
}

/** Impuesto anual total sobre la Renta Neta Imponible (RNI). */
export function impuestoAnual(rni, uit) {
  if (num(rni) <= 0) return 0; // RNI <= 0 → impuesto 0
  return round2(detalleImpuestoAnual(rni, uit).reduce((s, t) => s + t.impuesto, 0));
}

/**
 * Proyecta la Renta Bruta Anual (Art. 40°):
 *   Remuneraciones Percibidas Acumuladas
 *   + (Remuneración Mensual × Meses Restantes)
 *   + Gratificaciones Proyectadas (Julio y Diciembre)
 */
export function proyectarRentaBrutaAnual({ remuneracionesAcumuladas = 0, remuneracionMensual = 0, mes = 1, gratificacionesProyectadas = 0 }) {
  const m = Math.min(Math.max(Math.round(num(mes, 1)), 1), 12);
  const mesesRestantes = 12 - m + 1;
  return round2(
    num(remuneracionesAcumuladas) + num(remuneracionMensual) * mesesRestantes + num(gratificacionesProyectadas)
  );
}

/**
 * Retención del mes (Art. 40°):
 *   Retención del mes m = (Impuesto Anual Proyectado − Retenciones Acumuladas) / Divisor(m)
 * @param {Object} p
 *   remuneracionMensual       remuneración afecta del mes
 *   remuneracionesAcumuladas  percibido en meses anteriores (default 0)
 *   mes                       1-12
 *   year                      para obtener la UIT
 *   gratificacionesProyectadas (julio + diciembre)
 *   bonifExtraordinaria       opcional (bono 9%); default 0
 *   retencionesAcumuladas     retenciones ya efectuadas hasta el mes anterior
 *   deduccionAdicionalUIT     UIT adicionales por gastos (hasta 3)
 *   uit                       UIT explícita (si no, se toma del año)
 */
export function retencionMensual({
  remuneracionMensual,
  remuneracionesAcumuladas = 0,
  mes,
  year,
  gratificacionesProyectadas = 0,
  bonifExtraordinaria = 0,
  retencionesAcumuladas = 0,
  deduccionAdicionalUIT = 0,
  uit = null,
} = {}) {
  const u = uit == null ? uitDelAnio(year) : num(uit);
  const m = Math.min(Math.max(Math.round(num(mes, 1)), 1), 12);
  const mesesRestantes = 12 - m + 1;

  const rentaBruta = round2(
    proyectarRentaBrutaAnual({ remuneracionesAcumuladas, remuneracionMensual, mes: m, gratificacionesProyectadas }) +
      num(bonifExtraordinaria)
  );
  const deduccion = round2((DEDUCCION_UIT + num(deduccionAdicionalUIT)) * u);
  const rni = Math.max(0, round2(rentaBruta - deduccion));
  const impuestoAnualProyectado = impuestoAnual(rni, u);
  const divisor = divisorMes(m);

  let retencionMes = round2((impuestoAnualProyectado - num(retencionesAcumuladas)) / divisor);
  if (retencionMes < 0) retencionMes = 0;

  return {
    uit: u,
    mes: m,
    mesesRestantes,
    rentaBruta,
    deduccion,
    rni,
    impuestoAnualProyectado,
    divisor,
    retencionesAcumuladas: num(retencionesAcumuladas),
    retencionMes,
  };
}

/**
 * Caso de prueba / validación (datos de referencia):
 *   UIT = 5 350 · RNI = 132 710 → impuesto anual = 17 745.70
 */
export function validarEscala({ uit = 5350, rni = 132710 } = {}) {
  const tramos = detalleImpuestoAnual(rni, uit);
  const total = round2(tramos.reduce((s, t) => s + t.impuesto, 0));
  return { uit, rni, tramos, total };
}

/* ---------------------------------------------------------------------------
   Fachada (compatibilidad con el resto del módulo)
   -------------------------------------------------------------------------- */
export const taxService = {
  factorForMonth: divisorMes,
  divisorMes,
  impuestoAnual,
  detalleImpuestoAnual,
  proyectarRentaBrutaAnual,
  retencionMensual,
  validarEscala,

  /** Compatibilidad: recibe los nombres anteriores y devuelve el mismo shape. */
  calcRetencionMensual({
    remuneracionMensual,
    mes,
    year,
    gratificacionesProyectadas = 0,
    bonifExtraordinaria = 0,
    acumuladoAnterior = null,
    retencionesAnteriores = 0,
    deduccionAdicionalUIT = 0,
    remuneracionesAcumuladas = null,
    retencionesAcumuladas = 0,
  } = {}) {
    const m = Math.min(Math.max(Math.round(num(mes, 1)), 1), 12);
    const sueldo = num(remuneracionMensual);
    const acumulado =
      remuneracionesAcumuladas != null
        ? num(remuneracionesAcumuladas)
        : acumuladoAnterior == null
        ? round2(sueldo * (m - 1))
        : num(acumuladoAnterior);

    const r = retencionMensual({
      remuneracionMensual: sueldo,
      remuneracionesAcumuladas: acumulado,
      mes: m,
      year,
      gratificacionesProyectadas,
      bonifExtraordinaria,
      retencionesAcumuladas: num(retencionesAcumuladas) || num(retencionesAnteriores),
      deduccionAdicionalUIT,
    });
    return {
      uit: r.uit,
      mesesRestantes: r.mesesRestantes,
      proyectado: round2(sueldo * r.mesesRestantes),
      acumulado: round2(acumulado),
      gratificacionesProyectadas: round2(num(gratificacionesProyectadas)),
      bonifExtraordinaria: round2(num(bonifExtraordinaria)),
      rentaBruta: r.rentaBruta,
      deduccion: r.deduccion,
      rentaNeta: r.rni,
      impuestoAnualProyectado: r.impuestoAnualProyectado,
      factor: r.divisor,
      retencionMes: r.retencionMes,
    };
  },
};
