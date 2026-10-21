/* ============================================================================
   payrollService.js — Colaboradores y períodos de planilla (Supabase)
   ----------------------------------------------------------------------------
   Datos aislados por EMPRESA (company_id). Los getters son síncronos (leen un
   caché cargado con refresh()); las mutaciones son asíncronas.
   Incluye el motor de cálculo (calcRow, Renta 5ta, totales).
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { taxService } from './taxService.js';
import { activeCompanyId, activeCompany } from './payrollScope.js';
import { afpRatesService } from './afpRatesService.js';
import { attendanceService } from './attendanceService.js';
import { vacationService } from './vacationService.js';
import { bonusService } from './bonusService.js';
import { paymentService } from './paymentService.js';
import { gratificacionService } from './gratificacionService.js';
import { loanService } from './loanService.js';
import { TASAS, RENTA_5TA, AFP_BASE, getUit, getRmv, monthlyCommission, laborRules } from './payrollConfig.js';

/* ------------------------------------------------------------ caché en memoria */
let employeesCache = [];
let periodsCache = {}; // 'YYYY-MM' -> { closed, rows }

function mapEmployee(r) {
  return {
    id: r.id,
    code: r.code || '',
    docType: r.doc_type || 'DNI',
    docNumber: r.doc_number || '',
    name: r.name || '',
    startDate: r.start_date || '',
    position: r.position || '',
    baseSalary: num(r.base_salary),
    pensionType: r.pension_type || 'ONP',
    afp: r.afp || null,
    commissionType: r.commission_type || 'flujo',
    cuspp: r.cuspp || '',
    bankName: r.bank_name || '',
    bankAccount: r.bank_account || '',
    bankCci: r.bank_cci || '',
    contractType: r.contract_type || 'indeterminado',
    contractEnd: r.contract_end || '',
    cese: r.cese || '',
    salud: r.salud || 'ESSALUD',
    asignacionFamiliar: !!r.asignacion_familiar,
    active: r.active !== false,
    createdAt: r.created_at,
  };
}

function toEmployeeRow(d) {
  return {
    company_id: activeCompanyId(),
    code: d.code || null,
    doc_type: d.docType || 'DNI',
    doc_number: d.docNumber || null,
    name: d.name,
    start_date: d.startDate || null,
    position: d.position || null,
    base_salary: num(d.baseSalary),
    pension_type: d.pensionType || 'ONP',
    afp: d.pensionType === 'AFP' ? d.afp || 'HABITAT' : null,
    commission_type: d.pensionType === 'AFP' ? d.commissionType || 'flujo' : null,
    cuspp: d.pensionType === 'AFP' ? d.cuspp || null : null,
    bank_name: d.bankName || null,
    bank_account: d.bankAccount || null,
    bank_cci: d.bankCci || null,
    contract_type: d.contractType || 'indeterminado',
    contract_end: d.contractType === 'plazo_fijo' ? d.contractEnd || null : null,
    cese: d.cese || null,
    salud: d.salud || 'ESSALUD',
    asignacion_familiar: !!d.asignacionFamiliar,
    active: d.active !== false,
  };
}

/* ------------------------------------------------------ utilidades de cálculo */
function numOr(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/** Renta de 5ª: estimación simple (anual / 12). */
export function calcRenta5taMensual(annualRem, uit) {
  const base = Math.max(0, annualRem - RENTA_5TA.deduccionUIT * uit);
  let tax = 0;
  let prev = 0;
  for (const t of RENTA_5TA.tramos) {
    const limite = t.hastaUIT === Infinity ? Infinity : t.hastaUIT * uit;
    if (base > prev) tax += (Math.min(base, limite) - prev) * t.tasa;
    prev = limite;
    if (base <= limite) break;
  }
  return round2(tax / 12);
}

/** Parámetros AFP del período. */
export function getAfpParams(year, month, afp) {
  const r = afpRatesService.get(year, month, afp);
  return {
    year,
    month,
    afp: r.afp,
    comisionFlujo: r.comisionFlujo,
    comisionSaldo: r.comisionSaldo,
    primaSeguro: r.primaSeguro,
    aporteObligatorio: r.aporteObligatorio,
    remMaxAsegurable: r.remMaxAsegurable,
  };
}

/** Factor de beneficios del régimen laboral de la empresa activa (MYPE = 50%). */
function benefitFactor() {
  const c = activeCompany();
  return laborRules(c && c.regimen_laboral).benefitFactor;
}

/** Cálculo interno de una fila (con las acumuladas del año ya resueltas). */
function computeRow(emp, inputs = {}, year, month, retAcum = 0, remAcum = 0, gratAcum = 0) {
  const uit = getUit(year);
  const rmv = getRmv(year);

  const days = clamp(num(inputs.days, 30), 0, 30);
  const basico = round2(num(emp.baseSalary) * (days / 30));
  const asigFamiliar = emp.asignacionFamiliar ? round2(rmv * TASAS.asignacionFamiliar) : 0;
  const vacaciones = round2(num(inputs.vacation));
  const bonificaciones = round2(num(inputs.bonuses));
  const bonifAfectas = round2(num(inputs.bonusesAfectas));
  const totalBruto = round2(basico + asigFamiliar + vacaciones + bonificaciones);

  // Base afecta (pensiones, EsSalud y Renta 5ta): básico + asig. familiar + vacaciones + bonif. REGULARES.
  // La bonificación extraordinaria NO es afecta (no entra aquí).
  const remAsegurable = round2(basico + asigFamiliar + vacaciones + bonifAfectas);

  let pension = 0;
  let pensionLabel = '—';
  if (emp.pensionType === 'ONP') {
    pension = round2(remAsegurable * TASAS.onp);
    pensionLabel = 'ONP 13%';
  } else if (emp.pensionType === 'AFP') {
    const p = getAfpParams(year, month, emp.afp);
    const baseAfp = Math.min(remAsegurable, num(p.remMaxAsegurable, remAsegurable));
    const comision = monthlyCommission(emp.commissionType, p);
    pension = round2(baseAfp * (p.aporteObligatorio + comision + p.primaSeguro));
    pensionLabel = `AFP ${emp.afp || ''} · ${emp.commissionType === 'mixta' ? 'mixta' : 'flujo'}`.trim();
  }

  // Renta de 5ª — proyección anual (Art. 40°):
  //   · Se proyecta con la remuneración mensual COMPLETA (básico + asignación
  //     familiar), no con el básico prorrateado por vacaciones o faltas: los
  //     meses futuros se pagan completos. Las vacaciones y bonos del mes se
  //     suman UNA SOLA VEZ en la parte acumulada (no se anualizan).
  //   · Gratificaciones (julio + diciembre) sobre la remuneración computable,
  //     con el factor del régimen laboral (microempresa = 50%).
  const factor = benefitFactor();
  // Remuneración mensual recurrente completa (sin prorrateo por vacaciones ni
  // faltas): sirve para proyectar los meses futuros. Las vacaciones y bonos
  // del mes se suman UNA SOLA VEZ en la parte acumulada.
  const remuneracionRecurrente = round2(num(emp.baseSalary) + asigFamiliar);
  const gratBase = round2(num(inputs.gratificacion, basico + asigFamiliar + vacaciones) * factor);
  const gratProyectada = round2(gratBase * (month <= 7 ? 2 : 1));
  const gratTotal = round2(gratAcum + gratProyectada);
  const detalle5ta = taxService.retencionMensual({
    remuneracionMensual: remuneracionRecurrente,
    // Acumulado real (meses anteriores + mes actual) menos la base recurrente
    // del mes, que ya se incluye en la proyección de meses restantes.
    remuneracionesAcumuladas: round2(remAcum + gratAcum + remAsegurable - remuneracionRecurrente),
    mes: month,
    year,
    gratificacionesProyectadas: gratProyectada,
    bonifExtraordinaria: round2(gratTotal * TASAS.essalud),
    retencionesAcumuladas: retAcum, // regularización: retenido en meses anteriores
  });
  const renta5ta = detalle5ta.retencionMes;

  const tardanzas = round2(num(inputs.tardanzas));
  const prestamos = round2(num(inputs.loans));
  const totalRetenciones = round2(pension + renta5ta + tardanzas + prestamos);

  const essalud = round2(remAsegurable * TASAS.essalud);
  const vidaLey = round2(num(inputs.vidaLey));
  const totalAportes = round2(essalud + vidaLey);

  const gratificacionPagada = round2(num(inputs.gratificacionPagada));
  const neto = round2(totalBruto - totalRetenciones);
  const netoTotal = round2(neto + gratificacionPagada);

  return {
    days,
    basico,
    asigFamiliar,
    vacaciones,
    bonificaciones,
    bonifAfectas,
    totalBruto,
    remAsegurable,
    gratificacion: gratBase,
    gratificacionPagada,
    netoTotal,
    pension,
    pensionLabel,
    renta5ta,
    detalle5ta,
    tardanzas,
    prestamos,
    totalRetenciones,
    essalud,
    vidaLey,
    totalAportes,
    neto,
  };
}

/** Suma totales de un conjunto de filas. */
/** ¿El colaborador está activo dentro del período (por fecha de inicio/cese)? */
export function inPeriod(emp, year, month) {
  const ym = year * 100 + month;
  const start = String(emp.startDate || '').slice(0, 10);
  if (start) {
    const [sy, sm] = start.split('-').map(Number);
    if (sy && sm && sy * 100 + sm > ym) return false;
  }
  const cese = String(emp.cese || '').slice(0, 10);
  if (cese) {
    const [cy, cm, cd] = cese.split('-').map(Number);
    if (cy && cm) {
      const cym = cy * 100 + cm;
      if (cym < ym) return false;
      // Si el cese es el día 1, el colaborador ya no labora ese mes.
      if (cym === ym && cd === 1) return false;
    }
  }
  return true;
}

/**
 * Deriva los conceptos de un mes desde los controles (asistencia, vacaciones,
 * bonificaciones y pagos/adelantos). Todo automático (no se ingresa a mano).
 */
export function deriveMonthInputs(emp, year, month) {
  const att = attendanceService.summarize(emp.id, year, month, emp.baseSalary);
  // Mes comercial de 30 días: si el descanso cubre todo el mes calendario (31 días),
  // se pagan como máximo 30 días para no exceder la remuneración mensual.
  const vacDays = Math.min(30, vacationService.takenInMonth(emp.id, year, month));
  const days = Math.min(30, Math.max(0, 30 - att.absentWithoutPay - vacDays));
  const vacation = round2(vacDays * (emp.baseSalary / 30));
  const bAfectas = bonusService.sumRegular(emp.id, year, month);
  const bExtra = bonusService.sumExtraordinaria(emp.id, year, month);
  const gratif = gratificacionService.sumFor(emp.id, year, month);
  const basico = round2(num(emp.baseSalary) * (days / 30));
  const asigFamiliar = emp.asignacionFamiliar ? round2(getRmv(year) * TASAS.asignacionFamiliar) : 0;
  return {
    days,
    vacation,
    bonuses: round2(bAfectas + bExtra),
    bonusesAfectas: bAfectas,
    gratificacionPagada: gratif, // gratificación registrada (campo aparte, suma al neto)
    gratificacion: round2(basico + asigFamiliar + vacation), // remuneración computable (julio/diciembre; incluye vacaciones)
    tardanzas: att.tardinessDiscount,
    loans: round2(paymentService.sumDeductionsFor(emp.id, year, month) + loanService.sumCuotaFor(emp.id, year, month)),
    vidaLey: 0,
  };
}

/**
 * Acumulados del año (remuneraciones y retenciones) hasta el mes ANTERIOR,
 * recalculados secuencialmente para que la regularización sea exacta.
 */
function yearContext(emp, year, month) {
  let retAcum = 0;
  let remAcum = 0;
  let gratAcum = 0;
  for (let mm = 1; mm < month; mm++) {
    if (!inPeriod(emp, year, mm)) continue;
    const inputs = deriveMonthInputs(emp, year, mm);
    const row = computeRow(emp, inputs, year, mm, retAcum, remAcum, gratAcum);
    retAcum = round2(retAcum + row.renta5ta);
    remAcum = round2(remAcum + row.remAsegurable);
    if (mm === 7) gratAcum = round2(gratAcum + num(inputs.gratificacion) * benefitFactor()); // gratificación de julio (con factor del régimen)
  }
  return { retAcum, remAcum, gratAcum };
}

/**
 * Calcula una fila de planilla. La Renta 5ta se regulariza restando las
 * retenciones ya efectuadas en los meses anteriores del mismo ejercicio.
 */
export function calcRow(emp, inputs = {}, year, month) {
  const { retAcum, remAcum, gratAcum } = yearContext(emp, year, month);
  return computeRow(emp, inputs, year, month, retAcum, remAcum, gratAcum);
}

/** Suma totales de un conjunto de filas. */
export function sumTotals(rows) {
  const keys = ['basico', 'asigFamiliar', 'vacaciones', 'bonificaciones', 'totalBruto', 'pension', 'renta5ta', 'tardanzas', 'prestamos', 'totalRetenciones', 'essalud', 'vidaLey', 'totalAportes', 'neto', 'gratificacionPagada', 'netoTotal'];
  const acc = {};
  keys.forEach((k) => (acc[k] = 0));
  rows.forEach((r) => keys.forEach((k) => (acc[k] = round2(acc[k] + num(r[k])))));
  return acc;
}

/* =============================================================== SERVICIO === */
export const payrollService = {
  /** Recarga colaboradores y períodos desde Supabase. */
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      employeesCache = [];
      periodsCache = {};
      return;
    }
    const [emp, per] = await Promise.all([
      supabase.from('payroll_employees').select('*').eq('company_id', cid).order('name'),
      supabase.from('payroll_periods').select('*').eq('company_id', cid),
    ]);
    if (!emp.error) employeesCache = (emp.data || []).map(mapEmployee);
    periodsCache = {};
    (per.data || []).forEach((p) => {
      periodsCache[`${p.year}-${String(p.month).padStart(2, '0')}`] = { closed: !!p.closed, rows: p.rows || {} };
    });
  },

  listEmployees() {
    return employeesCache.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  getEmployee(id) {
    return employeesCache.find((e) => e.id === id) || null;
  },

  /** Deriva los conceptos de un mes (asistencia, vacaciones, bonos, pagos). */
  deriveMonthInputs,

  async createEmployee(data) {
    const { data: row, error } = await supabase.from('payroll_employees').insert(toEmployeeRow(data)).select().single();
    if (error) throw new Error(error.message);
    const emp = mapEmployee(row);
    employeesCache.push(emp);
    return emp;
  },
  async updateEmployee(id, patch) {
    const current = this.getEmployee(id) || {};
    const merged = { ...current, ...patch };
    const { data: row, error } = await supabase.from('payroll_employees').update(toEmployeeRow(merged)).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const emp = mapEmployee(row);
    const i = employeesCache.findIndex((e) => e.id === id);
    if (i >= 0) employeesCache[i] = emp;
    return emp;
  },
  async removeEmployee(id) {
    const { error } = await supabase.from('payroll_employees').delete().eq('id', id);
    if (error) throw new Error(error.message);
    employeesCache = employeesCache.filter((e) => e.id !== id);
  },

  /* ------------------------------ Períodos ------------------------------ */
  periodKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
  },
  getPeriodInputs(year, month) {
    return periodsCache[this.periodKey(year, month)] || { closed: false, rows: {} };
  },
  listPeriods() {
    return periodsCache;
  },
  isPeriodClosed(year, month) {
    return !!this.getPeriodInputs(year, month).closed;
  },
  async savePeriodInputs(year, month, rows, closed = false) {
    const cid = activeCompanyId();
    const key = this.periodKey(year, month);
    periodsCache[key] = { closed, rows };
    const { error } = await supabase
      .from('payroll_periods')
      .upsert({ company_id: cid, year, month, closed, rows, updated_at: new Date().toISOString() }, { onConflict: 'company_id,year,month' });
    if (error) throw new Error(error.message);
  },
  async closePeriod(year, month, rows) {
    await this.savePeriodInputs(year, month, rows, true);
  },
};
