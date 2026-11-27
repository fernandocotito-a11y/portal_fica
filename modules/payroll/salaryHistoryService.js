/* ============================================================================
   salaryHistoryService.js — Sueldo vigente por mes (historial de aumentos)
   ----------------------------------------------------------------------------
   `payroll_employees.base_salary` es el sueldo BASE/inicial. Los aumentos se
   guardan en `payroll_salary_history` con el mes desde el que rigen, de modo
   que enero-marzo siga calculándose con el sueldo antiguo y abril en adelante
   con el nuevo, aunque el cambio se registre después.

   El resolver es sincrónico (lee caché); las altas/bajas son asíncronas y
   respetan el bloqueo global de planilla cerrada.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';
import { assertPeriodOpen } from './periodLock.js';

let historyCache = [];

function keyOf(year, month) {
  return Number(year) * 12 + Number(month);
}

function mapRow(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    year: Number(r.year),
    month: Number(r.month),
    baseSalary: num(r.base_salary),
    createdAt: r.created_at,
  };
}

export const salaryHistoryService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      historyCache = [];
      return;
    }
    const { data, error } = await supabase
      .from('payroll_salary_history')
      .select('*')
      .eq('company_id', cid)
      .order('year')
      .order('month');
    if (error) {
      // Si aún no se ejecutó la migración, seguimos con el sueldo base.
      if (/relation|does not exist|column|schema cache/i.test(error.message)) {
        historyCache = [];
        return;
      }
      throw new Error(error.message);
    }
    historyCache = (data || []).map(mapRow);
  },

  forEmployee(employeeId) {
    return historyCache
      .filter((r) => r.employeeId === employeeId)
      .slice()
      .sort((a, b) => keyOf(a.year, a.month) - keyOf(b.year, b.month));
  },

  /** Sueldo vigente en un mes: último cambio <= mes, o el sueldo base si no hay. */
  get(employee, year, month) {
    if (!employee) return 0;
    const target = keyOf(year, month);
    const vigentes = this.forEmployee(employee.id).filter((r) => keyOf(r.year, r.month) <= target);
    if (!vigentes.length) return round2(num(employee.baseSalary));
    return round2(num(vigentes[vigentes.length - 1].baseSalary));
  },

  /** Promedio de sueldos vigentes de una lista de meses [{year, month}]. */
  average(employee, months) {
    const list = months || [];
    if (!list.length) return round2(num(employee?.baseSalary));
    const total = list.reduce((s, m) => s + this.get(employee, m.year, m.month), 0);
    return round2(total / list.length);
  },

  /** Registra o reemplaza el cambio de sueldo desde un mes. */
  async add(employeeId, { year, month, baseSalary }) {
    const y = Number(year);
    const m = Number(month);
    if (!employeeId) throw new Error('Selecciona un colaborador.');
    if (!y || !m || m < 1 || m > 12) throw new Error('Indica un mes y año válidos.');
    const sueldo = round2(num(baseSalary));
    if (!(sueldo > 0)) throw new Error('Ingresa un sueldo válido.');
    assertPeriodOpen(y, m);
    const cid = activeCompanyId();
    if (!cid) throw new Error('No hay empresa activa.');
    const { data, error } = await supabase.from('payroll_salary_history').upsert({
      company_id: cid,
      employee_id: employeeId,
      year: y,
      month: m,
      base_salary: sueldo,
    }, { onConflict: 'company_id,employee_id,year,month' }).select().single();
    if (error) throw new Error(error.message);
    const row = mapRow(data);
    const i = historyCache.findIndex((r) => r.id === row.id);
    if (i >= 0) historyCache[i] = row;
    else historyCache.push(row);
    return row;
  },

  async remove(id) {
    const row = historyCache.find((r) => r.id === id);
    if (!row) return;
    assertPeriodOpen(row.year, row.month);
    const { error } = await supabase.from('payroll_salary_history').delete().eq('id', id);
    if (error) throw new Error(error.message);
    historyCache = historyCache.filter((r) => r.id !== id);
  },
};

/** Atajo para los motores que necesitan el sueldo del mes que están calculando. */
export function getBaseSalary(employee, year, month) {
  return salaryHistoryService.get(employee, year, month);
}
