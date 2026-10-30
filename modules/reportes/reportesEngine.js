/* ============================================================================
   reportesEngine.js — Motor puro de Reportes Gerenciales
   ----------------------------------------------------------------------------
   Consolida, para una o varias empresas, la información de:
     · Compras y ventas (bases e IGV)
     · Retenciones y percepciones
     · Planilla (colaboradores, costo bruto y aportes)
     · Declaraciones SUNAT (IGV / Renta RMT) usando el mismo motor del PDT 621

   No hace I/O. Recibe filas ya descargadas de Supabase y devuelve un modelo
   listo para las tres pestañas del reporte:
     1) Dashboard
     2) Comparativo tributario
     3) Simulación de facturación intercompany

   La planilla de períodos cerrados usa la foto guardada (emp + calc). En
   períodos abiertos se estima con el sueldo base y los conceptos registrados,
   para no alterar ni recalcular la planilla oficial de cada empresa.
   ========================================================================== */

import {
  baseGravadaOf, baseNoGravadaOf, igvOf,
} from '../compras/comprasConfig.js';
import {
  round2, recalculateAnnualTimeline, annualTotals,
} from '../declaraciones/declaracionesEngine.js';
import { vencimientoFor } from '../declaraciones/cronogramaService.js';
import { getRmv } from '../payroll/payrollConfig.js';

const VENCIMIENTO_DIA = { 0: 15, 1: 16, 2: 17, 3: 18, 4: 19, 5: 20, 6: 21, 7: 22, 8: 23, 9: 24 };

function rucLastDigit(ruc) {
  const digits = String(ruc || '').replace(/\D/g, '');
  return digits ? Number(digits.slice(-1)) : 0;
}

/** Vencimiento del cronograma oficial o, si no existe, regla histórica. */
function defaultVencimiento(year, month, ruc) {
  const official = vencimientoFor(year, month, ruc);
  if (official) return official;
  const day = VENCIMIENTO_DIA[rucLastDigit(ruc)] || 15;
  const d = new Date(Number(year), Number(month), day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Factor para llevar un comprobante a soles. El SIRE ya viene solarizado. */
function penFactor(rec) {
  if (String(rec?.source || '') === 'sire') return 1;
  if (String(rec?.currency || 'PEN').toUpperCase() === 'PEN') return 1;
  const own = Number(rec?.exchange_rate || 0);
  return own > 1 ? own : 1;
}

/** ¿El colaborador está activo dentro del período? (misma regla que Planillas) */
export function activeInMonth(emp, year, month) {
  const ym = Number(year) * 100 + Number(month);
  const start = String(emp?.start_date || emp?.startDate || '').slice(0, 10);
  if (start) {
    const [sy, sm] = start.split('-').map(Number);
    if (sy && sm && sy * 100 + sm > ym) return false;
  }
  const cese = String(emp?.cese || '').slice(0, 10);
  if (cese) {
    const [cy, cm, cd] = cese.split('-').map(Number);
    if (cy && cm) {
      const cym = cy * 100 + cm;
      if (cym < ym) return false;
      if (cym === ym && cd === 1) return false;
    }
  }
  return true;
}

/** Resumen de un grupo de comprobantes (mismas reglas que Compras/Ventas). */
export function summarizeTaxRows(rows, kind) {
  const s = {
    count: 0, base: 0, baseGravada: 0, baseNoGravada: 0,
    igv: 0, total: 0, exonerated: 0, unaffected: 0,
  };
  for (const rec of rows || []) {
    const rate = penFactor(rec);
    const baseGravada = baseGravadaOf(rec, kind);
    const baseNoGravada = baseNoGravadaOf(rec, kind);
    s.count += 1;
    s.baseGravada += baseGravada * rate;
    s.baseNoGravada += baseNoGravada * rate;
    s.base += (baseGravada + baseNoGravada) * rate;
    s.igv += igvOf(rec, kind) * rate;
    s.total += Number(rec.total || 0) * rate;
    s.exonerated += Number(rec.exonerated || 0) * rate;
    s.unaffected += Number(rec.unaffected || 0) * rate;
  }
  Object.keys(s).forEach((k) => {
    if (typeof s[k] === 'number') s[k] = round2(s[k]);
  });
  return s;
}

function indexTaxRows(rows) {
  const map = new Map(); // companyId -> period -> { venta: [], compra: [] }
  for (const row of rows || []) {
    const cid = row.company_id;
    if (!cid) continue;
    if (!map.has(cid)) map.set(cid, new Map());
    const byPeriod = map.get(cid);
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, { venta: [], compra: [] });
    const bucket = byPeriod.get(row.period);
    if (row.kind === 'venta' || row.kind === 'compra') bucket[row.kind].push(row);
  }
  return map;
}

function indexRetentionRows(rows) {
  const map = new Map(); // companyId -> period -> rows
  for (const row of rows || []) {
    const cid = row.company_id;
    if (!cid) continue;
    if (!map.has(cid)) map.set(cid, new Map());
    const byPeriod = map.get(cid);
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, []);
    byPeriod.get(row.period).push(row);
  }
  return map;
}

function sumRetention(rows, kind) {
  return round2((rows || [])
    .filter((r) => r.kind === kind)
    .reduce((acc, r) => acc + Number(r.monto_retenido || 0), 0));
}

function estimatePayroll(employees, periodRow, year, month, today) {
  const active = (employees || []).filter((e) => e.active !== false && activeInMonth(e, year, month));
  let headcount = active.length;
  const rows = periodRow?.rows && typeof periodRow.rows === 'object' ? periodRow.rows : {};
  const values = Object.values(rows);
  const isSnapshot = values.length > 0 && values.every((v) => v && v.emp && v.calc);
  let gross = 0;
  let net = 0;
  let employer = 0;
  let hasPeriodData = !!periodRow;
  let estimated = false;
  let closed = !!periodRow?.closed;

  if (isSnapshot) {
    let snapshotHeadcount = 0;
    for (const item of values) {
      const calc = item.calc || {};
      gross += Number(calc.totalBruto || 0) + Number(calc.gratificacionPagada || 0);
      net += Number(calc.netoTotal || 0);
      employer += Number(calc.totalAportes || 0);
      if (item.emp && !calc.fueraPeriodo) snapshotHeadcount += 1;
    }
    headcount = snapshotHeadcount;
    closed = true;
    hasPeriodData = true;
  } else {
    const currentYm = today.getFullYear() * 100 + (today.getMonth() + 1);
    const isFuture = Number(year) * 100 + Number(month) > currentYm;
    const rmv = getRmv(year);
    // Solo se estima un período que la empresa ya abrió en Planillas. Así el
    // dashboard no inventa planillas de meses que aún no se procesaron.
    if (!isFuture && periodRow) {
      for (const emp of active) {
        const inp = rows[emp.id] || {};
        if (Object.keys(inp).length) hasPeriodData = true;
        const days = inp.days != null ? Number(inp.days) : 30;
        const basic = round2(Number(emp.base_salary || 0) * (Math.max(0, Math.min(30, days)) / 30));
        const asig = emp.asignacion_familiar ? round2(rmv * 0.1) : 0;
        const vacation = round2(Number(inp.vacation || 0));
        const bonuses = round2(Number(inp.bonuses || 0));
        const overtime = round2(Number(inp.overtime || 0));
        const gratPaid = round2(Number(inp.gratificacionPagada || 0));
        const grossRow = round2(basic + asig + vacation + bonuses + overtime + gratPaid);
        const affect = round2(basic + asig + vacation + Number(inp.bonusesAfectas || 0) + overtime);
        gross += grossRow;
        employer += round2(affect * 0.09);
        // En períodos abiertos no se guarda el neto calculado; se estima
        // descontando una referencia de pensión y Renta 5ta sólo si existe.
        const pension = emp.pension_type === 'ONP' ? round2(affect * 0.13) : 0;
        net += round2(grossRow - pension);
      }
      estimated = headcount > 0;
    }
  }

  const cost = round2(gross + employer);
  return {
    headcount,
    gross: round2(gross),
    net: round2(net),
    employer: round2(employer),
    cost,
    estimated,
    closed,
    hasPeriodData,
    isSnapshot,
  };
}

/** Construye el modelo de una empresa para el ejercicio. */
export function buildCompanyReport(company, raw, year) {
  const y = Number(year);
  const taxIndex = indexTaxRows(raw.taxRows || []).get(company.id) || new Map();
  const retIndex = indexRetentionRows(raw.retentionRows || []).get(company.id) || new Map();
  const employees = raw.employees || [];
  const periods = raw.periods || [];
  const declRows = raw.declRows || [];
  const periodByMonth = new Map(periods.map((p) => [Number(p.month), p]));
  const declByMonth = new Map(declRows.map((p) => [Number(p.mes), p]));
  const balances = raw.balances || {};

  const initial = {
    saldoIgvFavor: Number(balances.saldo_igv_anterior || 0),
    percepcionesNoAplicadas: Number(balances.percepciones_ant || 0),
    retencionesNoAplicadas: Number(balances.retenciones_ant || 0),
  };
  const config = {
    uit: Number(balances.uit || 0),
    coeficienteRenta: Number(balances.coeficiente_renta || 0),
  };

  const today = new Date();
  const sourceMonths = [];
  const monthlyExtras = [];

  for (let month = 1; month <= 12; month += 1) {
    const period = `${y}${String(month).padStart(2, '0')}`;
    const tax = taxIndex.get(period) || { venta: [], compra: [] };
    const ventas = summarizeTaxRows(tax.venta, 'venta');
    const compras = summarizeTaxRows(tax.compra, 'compra');
    const retentionRows = retIndex.get(period) || [];
    const percepcionesMes = sumRetention(retentionRows, 'percepcion');
    const retencionesMes = sumRetention(retentionRows, 'retencion');
    const payroll = estimatePayroll(employees, periodByMonth.get(month), y, month, today);

    const ov = declByMonth.get(month) || {};
    const fechaVencimiento = ov.fecha_vencimiento || defaultVencimiento(y, month, company.ruc);
    const src = {
      anio: y,
      mes: month,
      igvVentas: ventas.igv,
      igvCompras: compras.igv,
      baseGravadaV: ventas.baseGravada,
      baseGravadaC: compras.baseGravada,
      baseNoGravadaV: ventas.baseNoGravada,
      baseNoGravadaC: compras.baseNoGravada,
      percepcionesMes,
      retencionesMes,
      ventasNetasMes: ventas.baseGravada,
      pagosPrevios: Number(ov.pagos_previos || 0),
      pagosPreviosRenta: Number(ov.pagos_previos_renta || 0),
      fechaVencimiento,
      fechaDeclaracion: ov.fecha_declaracion || '',
      interesManual: !!ov.interes_manual,
      intereses: Number(ov.intereses || 0),
      interesesRenta: Number(ov.intereses_renta || 0),
      estado: ov.estado || 'pendiente',
    };
    sourceMonths.push(src);
    monthlyExtras.push({ ventas, compras, payroll, percepcionesMes, retencionesMes });
  }

  const timeline = recalculateAnnualTimeline(sourceMonths, initial, config);
  const months = timeline.months.map((m, i) => ({
    ...m,
    payroll: monthlyExtras[i].payroll,
    ventasSummary: monthlyExtras[i].ventas,
    comprasSummary: monthlyExtras[i].compras,
  }));

  const totals = annualTotals(months);
  totals.ventasBase = round2(months.reduce((s, m) => s + m.ventasSummary.baseGravada, 0));
  totals.comprasBase = round2(months.reduce((s, m) => s + m.comprasSummary.baseGravada, 0));
  totals.ventasTotal = round2(months.reduce((s, m) => s + m.ventasSummary.total, 0));
  totals.comprasTotal = round2(months.reduce((s, m) => s + m.comprasSummary.total, 0));
  totals.payrollCost = round2(months.reduce((s, m) => s + m.payroll.cost, 0));
  totals.payrollGross = round2(months.reduce((s, m) => s + m.payroll.gross, 0));
  totals.retenciones = round2(months.reduce((s, m) => s + m.retencionesMes, 0));
  totals.percepciones = round2(months.reduce((s, m) => s + m.percepcionesMes, 0));
  totals.igvNeto = round2(totals.igvVentas - totals.igvCompras);

  const currentMonth = y === today.getFullYear() ? today.getMonth() + 1 : 12;
  const currentPayroll = months[currentMonth - 1]?.payroll || { headcount: 0, cost: 0 };
  const activeNow = employees.filter((e) => e.active !== false && activeInMonth(e, y, currentMonth)).length;
  const lastWithData = [...months].reverse().find((m) => (
    m.ventasSummary.base > 0 || m.comprasSummary.base > 0
    || m.retencionesMes > 0 || m.percepcionesMes > 0 || m.payroll.cost > 0
  ));
  const lastDataMonth = lastWithData ? lastWithData.mes : 0;
  const withData = months.filter((m) => (
    m.ventasSummary.base > 0 || m.comprasSummary.base > 0
    || m.retencionesMes > 0 || m.percepcionesMes > 0 || m.payroll.cost > 0
  ));
  const pending = withData.filter((m) => m.estado !== 'declarado').length;
  const declared = withData.filter((m) => m.estado === 'declarado').length;

  return {
    id: company.id,
    name: company.name || 'Empresa',
    ruc: company.ruc || '',
    regimen: company.regimen_tributario || '',
    agenteRetencion: !!company.agente_retencion,
    agentePercepcion: !!company.agente_percepcion,
    sourceMonths,
    initial,
    config,
    timeline,
    months,
    totals,
    balances,
    employees: {
      total: employees.length,
      active: activeNow,
      current: currentPayroll.headcount,
    },
    lastDataMonth,
    pending,
    declared,
    hasData: withData.length > 0,
    warnings: [],
  };
}

/** Posición tributaria de una empresa en un mes o acumulada al mes. */
export function companyPosition(companyReport, month, mode = 'month') {
  const m = Math.max(1, Math.min(12, Number(month) || 1));
  const months = companyReport?.months || [];
  const current = months[m - 1] || {};
  const isYtd = mode === 'ytd';
  const slice = isYtd ? months.slice(0, m) : [current];
  const sum = (fn) => round2(slice.reduce((acc, row) => acc + Number(fn(row) || 0), 0));

  const igvVentas = sum((r) => r.igvVentas);
  const igvCompras = sum((r) => r.igvCompras);
  const baseVentas = sum((r) => r.ventasSummary?.baseGravada ?? r.baseGravadaV ?? 0);
  const baseCompras = sum((r) => r.comprasSummary?.baseGravada ?? r.baseGravadaC ?? 0);
  const percepciones = sum((r) => r.percepcionesMes);
  const retenciones = sum((r) => r.retencionesMes);
  const percepAplic = sum((r) => r.percepAplic);
  const retenAplic = sum((r) => r.retenAplic);
  const igvPorPagar = sum((r) => r.igvPorPagar);
  const renta = sum((r) => r.rentaPagar);
  const intereses = round2(sum((r) => r.intereses) + sum((r) => r.interesesRenta));
  const total = sum((r) => r.igvRegularizar + r.rentaRegularizar);
  const saldoAnterior = isYtd
    ? Number(months[0]?.saldoIgvAnterior || 0)
    : Number(current.saldoIgvAnterior || 0);
  const saldoFavor = Number(current.saldoFavorPeriodo || 0);
  const noAplicado = round2(Number(current.percepNoAplic || 0) + Number(current.retenNoAplic || 0));
  const creditAvailable = round2(saldoFavor + noAplicado);
  const payrollCost = sum((r) => r.payroll?.cost || 0);
  const payrollHeadcount = Number(current.payroll?.headcount || 0);
  const payroll = { cost: payrollCost, headcount: payrollHeadcount };
  const hasData = baseVentas > 0 || baseCompras > 0 || igvVentas > 0
    || igvCompras > 0 || percepciones > 0 || retenciones > 0 || payroll.cost > 0;

  return {
    igvVentas,
    igvCompras,
    igvNeto: round2(igvVentas - igvCompras),
    baseVentas,
    baseCompras,
    percepciones,
    retenciones,
    percepAplic,
    retenAplic,
    igvPorPagar,
    saldoAnterior,
    saldoFavor,
    noAplicado,
    creditAvailable,
    renta,
    intereses,
    total,
    payroll,
    hasData,
    estado: current.estado || 'pendiente',
    diasAtraso: Number(current.diasAtraso || 0),
    fechaVencimiento: current.fechaVencimiento || '',
    fechaDeclaracion: current.fechaDeclaracion || '',
  };
}

/** Recalcula una empresa añadiendo una factura intercompany en un mes. */
export function simulateInvoice(companyReport, { month, kind, base, igv }) {
  const m = Math.max(1, Math.min(12, Number(month) || 1));
  const amount = round2(base || 0);
  const tax = round2(igv || 0);
  const source = companyReport.sourceMonths.map((row) => ({ ...row }));
  const row = source[m - 1];
  if (kind === 'venta') {
    row.baseGravadaV = round2(row.baseGravadaV + amount);
    row.ventasNetasMes = round2(row.ventasNetasMes + amount);
    row.igvVentas = round2(row.igvVentas + tax);
  } else {
    row.baseGravadaC = round2(row.baseGravadaC + amount);
    row.igvCompras = round2(row.igvCompras + tax);
  }
  const timeline = recalculateAnnualTimeline(source, companyReport.initial, companyReport.config);
  const totals = annualTotals(timeline.months);
  totals.ventasBase = round2(timeline.months.reduce((s, r) => s + (r.baseGravadaV || 0), 0));
  totals.comprasBase = round2(timeline.months.reduce((s, r) => s + (r.baseGravadaC || 0), 0));
  return {
    timeline,
    totals,
    month: timeline.months[m - 1],
  };
}

/** Suma de posiciones de varias empresas. */
export function sumPositions(rows) {
  const keys = [
    'igvVentas', 'igvCompras', 'igvNeto', 'baseVentas', 'baseCompras',
    'percepciones', 'retenciones', 'percepAplic', 'retenAplic',
    'igvPorPagar', 'saldoAnterior', 'saldoFavor', 'noAplicado',
    'creditAvailable', 'renta', 'intereses', 'total',
  ];
  const out = {};
  keys.forEach((k) => { out[k] = round2(rows.reduce((s, r) => s + Number(r[k] || 0), 0)); });
  out.payroll = {
    cost: round2(rows.reduce((s, r) => s + Number(r.payroll?.cost || 0), 0)),
    headcount: rows.reduce((s, r) => s + Number(r.payroll?.headcount || 0), 0),
  };
  out.hasData = rows.some((r) => r.hasData);
  return out;
}
