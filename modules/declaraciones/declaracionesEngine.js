/* ============================================================================
   declaracionesEngine.js — Motor de cálculo de Liquidación IGV / Renta (FV 621)
   ----------------------------------------------------------------------------
   Funciones PURAS (sin I/O). Reciben los importes ya extraídos por el servicio
   y aplican la normativa SUNAT (PDT 621).

   El IGV y las bases se toman DIRECTAMENTE de los registros SIRE (ya
   solarizados y con los centavos reales), no se recalculan como base × 0.18,
   para coincidir exactamente con el PDT.

   Determinación en cascada (casillas 140/145/184/171/168/179/176):
     1) Saldo a favor de IGV del periodo anterior (casilla 145)
     2) Percepciones del periodo + saldo anterior (171 + 168)  -> 164
     3) Retenciones del periodo + saldo anterior (179 + 176)   -> 165
   Renta mensual RMT: ingresos netos acumulados vs 300 UIT (1.0% / 1.5%).

   Interés moratorio (casilla 187/319): se calcula automáticamente con los días
   de atraso entre la fecha de vencimiento y la fecha real de declaración
   (o la fecha de hoy si aún no se declaró), a la TIM diaria del 0.04%.
   Se puede reemplazar por un importe manual (interesManual = true).
   ========================================================================== */

export const LIMIT_UIT = 300;
export const TASA_1 = 0.01;   // hasta 300 UIT
export const TASA_2 = 0.015;  // por encima de 300 UIT
export const TIM_DIARIO = 0.0004; // 0.04% de interés moratorio diario

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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Días calendario entre dos fechas ISO (YYYY-MM-DD). */
function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00`);
  const b = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Calcula la liquidación de un periodo.
 *
 * @param {object} periodData
 *   { anio, mes,
 *     igvVentas, igvCompras,                    // IGV real de SIRE
 *     baseGravadaV, baseGravadaC,               // bases gravadas
 *     baseNoGravadaV, baseNoGravadaC,           // bases no gravadas (informativo)
 *     percepcionesMes, retencionesMes,
 *     ventasNetasMes,                           // ingresos netos (renta RMT)
 *     pagosPrevios = 0,
 *     pagosPreviosRenta = 0,
 *     fechaVencimiento = '',                    // YYYY-MM-DD (cronograma SUNAT)
 *     fechaDeclaracion = '',                    // YYYY-MM-DD real (vacío = sin declarar)
 *     tasaInteresDiaria = TIM_DIARIO,           // 0.04% por defecto
 *     interesManual = false,                    // true = usar intereses / interesesRenta
 *     intereses = 0, interesesRenta = 0,
 *     estado = 'pendiente' }
 * @param {object} previousPeriodState
 *   { saldoIgvFavor, percepcionesNoAplicadas, retencionesNoAplicadas, ventasAcumuladas }
 * @param {object} config { uit, coeficienteRenta }
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
  const coeficienteRenta = Number(config.coeficienteRenta || 0);

  /* --- IGV (valores reales de SIRE) --- */
  const igvVentas = round2(periodData.igvVentas || 0);
  const igvCompras = round2(periodData.igvCompras || 0);
  const baseGravadaV = round2(periodData.baseGravadaV || 0);
  const baseGravadaC = round2(periodData.baseGravadaC || 0);
  const baseNoGravadaV = round2(periodData.baseNoGravadaV || 0);
  const baseNoGravadaC = round2(periodData.baseNoGravadaC || 0);
  const preliminar = round2(igvVentas - igvCompras);

  const saldoIgvAnterior = round2(prev.saldoIgvFavor);
  // Saldo tras aplicar el crédito fiscal anterior (puede ser negativo = a favor).
  const igvNeto = round2(preliminar - saldoIgvAnterior);

  // Cascada de arrastre de créditos.
  let resto;
  let saldoFavorPeriodo;
  if (preliminar >= 0) {
    const despuesSaldoAnt = round2(preliminar - saldoIgvAnterior);
    if (despuesSaldoAnt >= 0) {
      resto = despuesSaldoAnt;
      saldoFavorPeriodo = 0;
    } else {
      resto = 0;
      saldoFavorPeriodo = round2(-despuesSaldoAnt);
    }
  } else {
    resto = 0;
    saldoFavorPeriodo = round2(saldoIgvAnterior + -preliminar);
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
  const saldoDespuesPercepciones = round2(Math.max(0, igvNeto - percepAplic));

  /* --- Renta mensual (RMT) --- */
  const ventasNetasMes = round2(periodData.ventasNetasMes || 0);
  const ventasAcumuladas = round2(prev.ventasAcumuladas + ventasNetasMes);
  let tasaRenta = TASA_1;
  if (ventasAcumuladas > LIMIT_UIT * uit) {
    tasaRenta = Math.max(TASA_2, coeficienteRenta);
  }
  const rentaPagar = round2(ventasNetasMes * tasaRenta);

  /* --- Totales IGV / Renta --- */
  const pagosPrevios = round2(periodData.pagosPrevios || 0);
  const pagosPreviosRenta = round2(periodData.pagosPreviosRenta || 0);

  // Interés moratorio: días de atraso entre vencimiento y declaración real
  // (o hoy si aún no se declaró). TIM 0.04% diario por defecto.
  const tasaInteres = Number(periodData.tasaInteresDiaria || 0) || TIM_DIARIO;
  const fechaVencimiento = String(periodData.fechaVencimiento || '');
  const fechaDeclaracion = String(periodData.fechaDeclaracion || '');
  const fechaEfectiva = fechaDeclaracion || todayIso();
  const diasAtraso = fechaVencimiento ? Math.max(0, daysBetween(fechaVencimiento, fechaEfectiva)) : 0;
  const interesesAuto = round2(igvPorPagar * tasaInteres * diasAtraso);
  const interesesRentaAuto = round2(rentaPagar * tasaInteres * diasAtraso);

  const interesManual = periodData.interesManual === true;
  const intereses = interesManual ? round2(periodData.intereses || 0) : interesesAuto;
  const interesesRenta = interesManual ? round2(periodData.interesesRenta || 0) : interesesRentaAuto;

  const igvTotal = round2(igvPorPagar + intereses);
  const igvRegularizar = round2(Math.max(0, igvTotal - pagosPrevios));
  const rentaTotal = round2(rentaPagar + interesesRenta);
  const rentaRegularizar = round2(Math.max(0, rentaTotal - pagosPreviosRenta));
  const totalAPagar = round2(igvRegularizar + rentaRegularizar);

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

    igvVentas, igvCompras,
    baseGravadaV, baseGravadaC,
    baseNoGravadaV, baseNoGravadaC,
    preliminar,

    saldoIgvAnterior,
    igvNeto,
    saldoFavorPeriodo,
    percepcionesMes: round2(periodData.percepcionesMes || 0),
    percepcionesAnterior: round2(prev.percepcionesNoAplicadas),
    percepcionesNoAplicadas: percepNoAplic,
    percepDisp, percepAplic, percepNoAplic,
    retencionesMes: round2(periodData.retencionesMes || 0),
    retencionesAnterior: round2(prev.retencionesNoAplicadas),
    retencionesNoAplicadas: retenNoAplic,
    retenDisp, retenAplic, retenNoAplic,
    saldoDespuesPercepciones,
    igvPorPagar,

    ventasNetasMes,
    ventasAcumuladas,
    uit,
    coeficienteRenta,
    tasaRenta,
    rentaPagar,

    pagosPrevios,
    intereses,
    pagosPreviosRenta,
    interesesRenta,
    igvTotal,
    igvRegularizar,
    rentaTotal,
    rentaRegularizar,
    totalAPagar,
    fechaVencimiento,
    fechaDeclaracion,
    tasaInteres,
    diasAtraso,
    interesesAuto,
    interesesRentaAuto,
    interesManual,
    estado: periodData.estado || 'pendiente',

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
    ventasNetas: 0, intereses: 0, interesesRenta: 0,
    pagosPrevios: 0, pagosPreviosRenta: 0,
    igvTotal: 0, igvRegularizar: 0, rentaTotal: 0, rentaRegularizar: 0,
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
    t.intereses = round2(t.intereses + m.intereses);
    t.interesesRenta = round2(t.interesesRenta + m.interesesRenta);
    t.pagosPrevios = round2(t.pagosPrevios + m.pagosPrevios);
    t.pagosPreviosRenta = round2(t.pagosPreviosRenta + m.pagosPreviosRenta);
    t.igvTotal = round2(t.igvTotal + m.igvTotal);
    t.igvRegularizar = round2(t.igvRegularizar + m.igvRegularizar);
    t.rentaTotal = round2(t.rentaTotal + m.rentaTotal);
    t.rentaRegularizar = round2(t.rentaRegularizar + m.rentaRegularizar);
  }
  return t;
}
