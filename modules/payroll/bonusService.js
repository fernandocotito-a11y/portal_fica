/* ============================================================================
   bonusService.js — Bonificaciones / ingresos adicionales (Supabase)
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];

function map(r) {
  return { id: r.id, employeeId: r.employee_id, year: r.year, month: r.month, tipo: r.tipo || 'regular', concepto: r.concepto || '', monto: num(r.monto) };
}

export const bonusService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_bonuses').select('*').eq('company_id', cid);
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    return employeeId ? cache.filter((b) => b.employeeId === employeeId) : cache.slice();
  },
  forMonth(employeeId, year, month) {
    return cache.filter((b) => b.employeeId === employeeId && b.year === year && b.month === month);
  },
  /** Suma de bonificaciones REGULARES (afectas a pensiones/EsSalud). */
  sumRegular(employeeId, year, month) {
    return round2(
      this.forMonth(employeeId, year, month)
        .filter((b) => b.tipo !== 'extraordinaria')
        .reduce((s, b) => s + num(b.monto), 0)
    );
  },
  /** Suma de bonificaciones EXTRAORDINARIAS (no afectas). */
  sumExtraordinaria(employeeId, year, month) {
    return round2(
      this.forMonth(employeeId, year, month)
        .filter((b) => b.tipo === 'extraordinaria')
        .reduce((s, b) => s + num(b.monto), 0)
    );
  },

  async create(data) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: data.employeeId,
      year: data.year,
      month: data.month,
      tipo: data.tipo || 'regular',
      concepto: data.concepto || null,
      monto: num(data.monto),
    };
    const { data: saved, error } = await supabase.from('payroll_bonuses').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },
  async update(id, patch) {
    const merged = { ...(cache.find((b) => b.id === id) || {}), ...patch };
    const row = {
      year: num(merged.year),
      month: num(merged.month),
      tipo: merged.tipo || 'regular',
      concepto: merged.concepto || null,
      monto: num(merged.monto),
    };
    const { data: saved, error } = await supabase.from('payroll_bonuses').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    const i = cache.findIndex((b) => b.id === id);
    if (i >= 0) cache[i] = rec;
    return rec;
  },
  async remove(id) {
    const { error } = await supabase.from('payroll_bonuses').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((b) => b.id !== id);
  },
};
