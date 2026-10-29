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

  /* --- Detalle completo del Formulario Virtual 621 ---------------------
     El PDT tiene dos columnas (Base y Tributo). Las casillas 101/103/131
     y 108/111/115/117/178 son Tributo (IGV), no Renta. Los descuentos y
     notas de crédito se muestran aparte en 102/103, tal como en el PDT. */
  const pv = periodData.pdtVentas || {};
  const pc = periodData.pdtCompras || {};
  const hasPv = Object.keys(pv).length > 0;
  const hasPc = Object.keys(pc).length > 0;

  const c100 = round2(pv.c100 ?? (hasPv ? 0 : baseGravadaV));
  const c101 = round2(pv.c101 ?? (hasPv ? 0 : igvVentas));
  const c102 = round2(pv.c102 || 0);
  const c103 = round2(pv.c103 || 0);
  const c105 = round2(pv.c105 ?? 0);
  const c106 = round2(pv.c106 || 0);
  const c109 = round2(pv.c109 || 0);
  const c112 = round2(pv.c112 || 0);
  const c127 = round2(pv.c127 || 0);
  const c131 = round2(c101 - c103);

  const c107 = round2(pc.c107 ?? (hasPc ? 0 : baseGravadaC));
  const c108 = round2(pc.c108 ?? (hasPc ? 0 : igvCompras));
  const c110 = round2(pc.c110 || 0);
  const c111 = round2(pc.c111 || 0);
  const c113 = round2(pc.c113 || 0);
  const c114 = round2(pc.c114 || 0);
  const c115 = round2(pc.c115 || 0);
  const c116 = round2(pc.c116 || 0);
  const c117 = round2(pc.c117 || 0);
  const c119 = round2(pc.c119 || 0);
  const c120 = round2(pc.c120 || 0);
  const c122 = round2(pc.c122 || 0);
  const c172 = round2(pc.c172 || 0);
  const c169 = round2(pc.c169 || 0);
  const c178 = round2(c108 + c111 + c115 + c117);

  const c140 = round2(c131 - c178 - c172 - c169);
  const c145 = saldoIgvAnterior;
  const c184 = round2(c140 - c145);
  const c171 = round2(periodData.percepcionesMes || 0);
  const c168 = round2(prev.percepcionesNoAplicadas);
  const c164 = percepNoAplic;
  const c179 = round2(periodData.retencionesMes || 0);
  const c176 = round2(prev.retencionesNoAplicadas);
  const c165 = retenNoAplic;
  const c681 = round2(c184 - (c171 + c168 + c179 + c176));
  const c185 = pagosPrevios;
  const c187 = intereses;
  const c188 = round2(c681 - c185 + c187);
  const c189 = round2(Math.max(0, c188));

  const c301 = ventasNetasMes;
  const c312 = rentaPagar;
  const c380 = coeficienteRenta;
  const c315 = tasaRenta;
  const c302 = rentaPagar;
  const c303 = round2(periodData.saldoFavorRentaAnterior || 0);
  const c304 = round2(c302 - c303);
  const c326 = round2(periodData.retencionesRentaMes || 0);
  const c327 = round2(periodData.retencionesRentaAnterior || 0);
  const c305 = round2(periodData.compensacionExportador || 0);
  const c328 = round2(periodData.itan || 0);
  const c306 = round2(periodData.otrosCreditosRenta || 0);
  const c682 = round2(c304 - (c326 + c327 + c305 + c328 + c306));
  const c317 = pagosPreviosRenta;
  const c319 = interesesRenta;
  const c324 = round2(c682 - c317 + c319);
  const c307 = round2(Math.max(0, c324));

  const pdt = {
    ventas: { c100, c101, c102, c103, c105, c106, c109, c112, c127, c131 },
    compras: { c107, c108, c110, c111, c113, c114, c115, c116, c117, c119, c120, c122, c172, c169, c178 },
    igv: {
      c140, c145, c184, c171, c168, c164, c179, c176, c165,
      c681, c185, c187, c188, c189,
    },
    renta: {
      c301, c312, c380, c315, c302, c303, c304,
      c326, c327, c305, c328, c306, c682, c317, c319, c324, c307,
    },
  };

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
    pdt,
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
