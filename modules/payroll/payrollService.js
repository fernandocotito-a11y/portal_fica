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
import { activeCompanyId } from './payrollScope.js';
import { afpRatesService } from './afpRatesService.js';
import { TASAS, RENTA_5TA, AFP_BASE, getUit, getRmv, monthlyCommission } from './payrollConfig.js';

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

/** Calcula una fila de planilla. */
export function calcRow(emp, inputs = {}, year, month) {
  const uit = getUit(year);
  const rmv = getRmv(year);

  const days = clamp(num(inputs.days, 30), 0, 30);
  const basico = round2(num(emp.baseSalary) * (days / 30));
  const asigFamiliar = emp.asignacionFamiliar ? round2(rmv * TASAS.asignacionFamiliar) : 0;
  const vacaciones = round2(num(inputs.vacation));
  const bonificaciones = round2(num(inputs.bonuses));
  const totalBruto = round2(basico + asigFamiliar + vacaciones + bonificaciones);

  const remAsegurable = round2(basico + asigFamiliar);

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

  const gratProyectada = round2((month <= 7 ? remAsegurable : 0) + remAsegurable);
  const renta5ta = taxService
    .calcRetencionMensual({
      remuneracionMensual: remAsegurable,
      mes: month,
      year,
      gratificacionesProyectadas: gratProyectada,
      bonifExtraordinaria: round2(gratProyectada * TASAS.essalud),
      retencionesAnteriores: num(inputs.retencionesAnteriores),
    })
    .retencionMes;

  const tardanzas = round2(num(inputs.tardanzas));
  const prestamos = round2(num(inputs.loans));
  const totalRetenciones = round2(pension + renta5ta + tardanzas + prestamos);

  const essalud = round2(remAsegurable * TASAS.essalud);
  const vidaLey = round2(num(inputs.vidaLey));
  const totalAportes = round2(essalud + vidaLey);

  const neto = round2(totalBruto - totalRetenciones);

  return {
    days,
    basico,
    asigFamiliar,
    vacaciones,
    bonificaciones,
    totalBruto,
    remAsegurable,
    pension,
    pensionLabel,
    renta5ta,
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
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  if (emp.startDate) {
    const s = new Date(emp.startDate);
    if (s > end) return false;
  }
  if (emp.cese) {
    const c = new Date(emp.cese);
    if (c < start) return false;
  }
  return true;
}

/** Suma totales de un conjunto de filas. */
export function sumTotals(rows) {
  const keys = ['basico', 'asigFamiliar', 'vacaciones', 'bonificaciones', 'totalBruto', 'pension', 'renta5ta', 'tardanzas', 'prestamos', 'totalRetenciones', 'essalud', 'vidaLey', 'totalAportes', 'neto'];
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
