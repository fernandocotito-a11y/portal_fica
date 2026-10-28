/* ============================================================================
   declaracionesEngine.js — Motor de cálculo de Liquidación IGV / Renta (FV 621)
   ----------------------------------------------------------------------------
   Funciones PURAS (sin I/O). Reciben los importes ya extraídos por el servicio
   y aplican la normativa SUNAT:

     - IGV Ventas  = base18 * 0.18 + base10 * 0.10   (16% IGV + 2% IPM)
     - IGV Compras = base18 * 0.18 + base10 * 0.10   (crédito fiscal)
     - Determinación con cascada de arrastre:
         1) Saldo a favor de IGV del periodo anterior (casilla 178)
         2) Percepciones del periodo + saldo anterior (171 + 168)  -> 164
         3) Retenciones del periodo + saldo anterior (179 + 176)   -> 165
     - Renta mensual RMT: ingresos netos acumulados vs 300 UIT (1.0% / 1.5%).
   ========================================================================== */

export const RATE_18 = 0.18;
export const RATE_10 = 0.10;
export const LIMIT_UIT = 300;
export const TASA_1 = 0.01;   // hasta 300 UIT
export const TASA_2 = 0.015;  // por encima de 300 UIT

/** UIT por ejercicio (S/). */
export const UIT_DEFAULTS = { 2024: 5150, 2025: 5350, 2026: 5400, 2027: 5650 };

/** Redondeo tributario a 2 decimales. */
export function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function uitFor(year) {
  return UIT_DEFAULTS[Number(year)] || 5400;
}

/**
 * Calcula la liquidación de un periodo.
 *
 * @param {object} periodData
 *   { anio, mes,
 *     base18V, igv18V, base10V, igv10V,      // ventas
 *     base18C, igv18C, base10C, igv10C,      // compras
 *     percepcionesMes, retencionesMes,
 *     ventasNetasMes,                        // para renta RMT
 *     pagosPrevios = 0, intereses = 0 }
 * @param {object} previousPeriodState
 *   { saldoIgvFavor, percepcionesNoAplicadas, retencionesNoAplicadas, ventasAcumuladas }
 * @param {object} config
 *   { uit, coeficienteRenta }
 * @returns {object} resultado del mes con `nextState` para encadenar.
 */
export function calculatePeriodTaxes(periodData, previousPeriodState, config = {}) {
  const prev = previousPeriodState || {
    saldoIgvFavor: 0,
    percepcionesNoAplicadas: 0,
    retencionesNoAplicadas: 0,
    ventasAcumuladas: 0,
  };
  const anio = Number(periodData.anio || 0);
  const mes = Number(periodData.mes || 0);
  const uit = Number(config.uit) || uitFor(anio);

  /* --- IGV --- */
  const igv18V = round2(periodData.igv18V);
  const igv10V = round2(periodData.igv10V);
  const igv18C = round2(periodData.igv18C);
  const igv10C = round2(periodData.igv10C);
  const base18V = round2(periodData.base18V);
  const base10V = round2(periodData.base10V);
  const base18C = round2(periodData.base18C);
  const base10C = round2(periodData.base10C);

  const igvVentas = round2(igv18V + igv10V);
  const igvCompras = round2(igv18C + igv10C);
  const preliminar = round2(igvVentas - igvCompras);

  // Cascada de arrastre de créditos.
  let resto;
  let saldoFavorPeriodo;
  if (preliminar >= 0) {
    const despuesSaldoAnt = round2(preliminar - prev.saldoIgvFavor);
    if (despuesSaldoAnt >= 0) {
      resto = despuesSaldoAnt;
      saldoFavorPeriodo = 0;
    } else {
      resto = 0;
      saldoFavorPeriodo = round2(-despuesSaldoAnt);
    }
  } else {
    resto = 0;
    saldoFavorPeriodo = round2(prev.saldoIgvFavor + -preliminar);
  }

  const percepDisp = round2((periodData.percepcionesMes || 0) + prev.percepcionesNoAplicadas);
  const percepAplic = round2(Math.min(percepDisp, resto));
  resto = round2(resto - percepAplic);
  const percepNoAplic = round2(percepDisp - percepAplic);

  const retenDisp = round2((periodData.retencionesMes || 0) + prev.retencionesNoAplicadas);
  const retenAplic = round2(Math.min(retenDisp, resto));
  resto = round2(resto - retenAplic);
  const retenNoAplic = round2(retenDisp - retenAplic);

  const igvPorPagar = round2(Math.max(0, resto));

  /* --- Renta mensual (RMT) --- */
  const ventasNetasMes = round2(periodData.ventasNetasMes || 0);
  const ventasAcumuladas = round2(prev.ventasAcumuladas + ventasNetasMes);
  let tasaRenta = TASA_1;
  if (ventasAcumuladas > LIMIT_UIT * uit) {
    const coef = Number(config.coeficienteRenta || 0);
    tasaRenta = Math.max(TASA_2, coef);
  }
  const rentaPagar = round2(ventasNetasMes * tasaRenta);

  /* --- Totales --- */
  const pagosPrevios = round2(periodData.pagosPrevios || 0);
  const intereses = round2(periodData.intereses || 0);
  const subtotal = round2(igvPorPagar + rentaPagar);
  const totalAPagar = round2(Math.max(0, subtotal - pagosPrevios) + intereses);

  const nextState = {
    saldoIgvFavor: saldoFavorPeriodo,
    percepcionesNoAplicadas: percepNoAplic,
    retencionesNoAplicadas: retenNoAplic,
    ventasAcumuladas,
  };

  return {
    anio,
    mes,
    period: `${anio}${String(mes).padStart(2, '0')}`,

    base18V, igv18V, base10V, igv10V,
    base18C, igv18C, base10C, igv10C,
    igvVentas, igvCompras, preliminar,

    saldoIgvAnterior: round2(prev.saldoIgvFavor),
    saldoFavorPeriodo,
    percepcionesMes: round2(periodData.percepcionesMes || 0),
    percepcionesAnterior: round2(prev.percepcionesNoAplicadas),
    percepcionesNoAplicadas: percepNoAplic,
    percepDisp, percepAplic, percepNoAplic,
    retencionesMes: round2(periodData.retencionesMes || 0),
    retencionesAnterior: round2(prev.retencionesNoAplicadas),
    retencionesNoAplicadas: retenNoAplic,
    retenDisp, retenAplic, retenNoAplic,
    igvPorPagar,

    ventasNetasMes,
    ventasAcumuladas,
    uit,
    tasaRenta,
    rentaPagar,

    pagosPrevios,
    intereses,
    totalAPagar,
    estado: periodData.estado || 'calculado',

    nextState,
  };
}

/**
 * Recalcula el año completo (Enero → Diciembre) en cascada.
 *
 * @param {object[]} sourceMonths 12 `periodData` (uno por mes, ordenados).
 * @param {object} initialBalances { saldoIgvFavor, percepcionesNoAplicadas, retencionesNoAplicadas }
 * @param {object} config { uit, coeficienteRenta }
 */
export function recalculateAnnualTimeline(sourceMonths, initialBalances = {}, config = {}) {
  let prev = {
    saldoIgvFavor: round2(initialBalances.saldoIgvFavor || 0),
    percepcionesNoAplicadas: round2(initialBalances.percepcionesNoAplicadas || 0),
    retencionesNoAplicadas: round2(initialBalances.retencionesNoAplicadas || 0),
    ventasAcumuladas: 0,
  };

  const months = [];
  for (const m of sourceMonths) {
    const r = calculatePeriodTaxes(m, prev, config);
    months.push(r);
    prev = r.nextState;
  }

  return { months, finalState: prev };
}

/** Totales anuales para la fila "TOTAL" de la matriz. */
export function annualTotals(months) {
  const t = {
    igvVentas: 0, igvCompras: 0, igvPorPagar: 0, saldoFavorPeriodo: 0,
    percepAplic: 0, retenAplic: 0, rentaPagar: 0, totalAPagar: 0,
    ventasNetas: 0, base18V: 0, base10V: 0, base18C: 0, base10C: 0,
  };
  for (const m of months) {
    t.igvVentas = round2(t.igvVentas + m.igvVentas);
    t.igvCompras = round2(t.igvCompras + m.igvCompras);
    t.igvPorPagar = round2(t.igvPorPagar + m.igvPorPagar);
    t.saldoFavorPeriodo = round2(t.saldoFavorPeriodo + m.saldoFavorPeriodo);
    t.percepAplic = round2(t.percepAplic + m.percepAplic);
    t.retenAplic = round2(t.retenAplic + m.retenAplic);
    t.rentaPagar = round2(t.rentaPagar + m.rentaPagar);
    t.totalAPagar = round2(t.totalAPagar + m.totalAPagar);
    t.ventasNetas = round2(t.ventasNetas + m.ventasNetasMes);
    t.base18V = round2(t.base18V + m.base18V);
    t.base10V = round2(t.base10V + m.base10V);
    t.base18C = round2(t.base18C + m.base18C);
    t.base10C = round2(t.base10C + m.base10C);
  }
  return t;
}
