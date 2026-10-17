/* ============================================================================
   vacationService.js — Control de vacaciones (Supabase)
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2, dateInMonth } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];
const DIAS_LEGALES = 30;

function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    period: r.period || '',
    daysTaken: num(r.days_taken),
    dateFrom: r.date_from || '',
    dateTo: r.date_to || '',
    monthYear: r.month_year || '',
    note: r.note || '',
  };
}

export function periodOfYear(year) {
  return `${year}-${year + 1}`;
}

export const vacationService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_vacations').select('*').eq('company_id', cid);
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    return employeeId ? cache.filter((r) => r.employeeId === employeeId) : cache.slice();
  },

  async create(data) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: data.employeeId,
      period: data.period || null,
      days_taken: num(data.daysTaken),
      date_from: data.dateFrom || null,
      date_to: data.dateTo || null,
      month_year: data.monthYear || null,
      note: data.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_vacations').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },
  async update(id, patch) {
    const merged = { ...(this.list().find((r) => r.id === id) || {}), ...patch };
    const row = {
      period: merged.period || null,
      days_taken: num(merged.daysTaken),
      date_from: merged.dateFrom || null,
      date_to: merged.dateTo || null,
      month_year: merged.monthYear || null,
      note: merged.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_vacations').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    const i = cache.findIndex((r) => r.id === id);
    if (i >= 0) cache[i] = rec;
    return rec;
  },
  async remove(id) {
    const { error } = await supabase.from('payroll_vacations').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((r) => r.id !== id);
  },

  dailyRate(baseSalary) {
    return round2(num(baseSalary) / 30);
  },
  takenInPeriod(employeeId, period) {
    return round2(this.list(employeeId).filter((r) => r.period === period).reduce((s, r) => s + num(r.daysTaken), 0));
  },
  balance(employeeId, period, baseDays = DIAS_LEGALES) {
    const taken = this.takenInPeriod(employeeId, period);
    const base = num(baseDays, DIAS_LEGALES);
    return { period, base, taken, pending: round2(Math.max(0, base - taken)) };
  },

  /** Acumulación de vacaciones por antigüedad (según baseDays del régimen). */
  accrual(employeeId, baseDays = DIAS_LEGALES, today = new Date()) {
    const emp = this._emp(employeeId);
    if (!emp || !emp.startDate) {
      const taken0 = round2(this.list(employeeId).reduce((s, r) => s + num(r.daysTaken), 0));
      return { months: 0, accrued: 0, taken: taken0, pending: round2(Math.max(0, -taken0)), base: num(baseDays, DIAS_LEGALES) };
    }
    const start = new Date(emp.startDate);
    const months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    const accrued = round2((Math.max(0, months) / 12) * num(baseDays, DIAS_LEGALES));
    const taken = round2(this.list(employeeId).reduce((s, r) => s + num(r.daysTaken), 0));
    return { months, accrued, taken, pending: round2(Math.max(0, accrued - taken)), base: num(baseDays, DIAS_LEGALES) };
  },

  _emp(employeeId) {
    // Evita dependencia circular: se inyecta desde el servicio de planilla.
    return this._employeeGetter ? this._employeeGetter(employeeId) : null;
  },
  setEmployeeGetter(fn) {
    this._employeeGetter = fn;
  },
  takenInMonth(employeeId, year, month) {
    return round2(
      this.list(employeeId)
        .filter((r) => this._inMonth(r, year, month))
        .reduce((s, r) => s + num(r.daysTaken), 0)
    );
  },
  _inMonth(rec, year, month) {
    if (rec.monthYear) return rec.monthYear === `${year}-${String(month).padStart(2, '0')}`;
    return dateInMonth(rec.dateFrom, year, month) || dateInMonth(rec.dateTo, year, month);
  },
};
