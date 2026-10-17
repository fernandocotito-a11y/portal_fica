/* ============================================================================
   attendanceService.js — Asistencia, tardanzas e inasistencias (Supabase)
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2, dateInMonth } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];

export const ATTENDANCE_TYPES = [
  { value: 'normal', label: 'Asistencia normal' },
  { value: 'falta', label: 'Falta / Inasistencia' },
  { value: 'descanso_medico', label: 'Descanso médico' },
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'licencia', label: 'Licencia' },
];

function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    date: r.date || '',
    entry: r.entry || '',
    exit: r.exit_time || '',
    tardinessMinutes: num(r.tardiness_minutes),
    extraMinutes: num(r.extra_minutes),
    type: r.type || 'normal',
    withPay: r.with_pay !== false,
    note: r.note || '',
  };
}

export const attendanceService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_attendance').select('*').eq('company_id', cid).order('date');
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    const all = cache.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return employeeId ? all.filter((r) => r.employeeId === employeeId) : all;
  },
  getById(id) {
    return cache.find((r) => r.id === id) || null;
  },

  async create(data) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: data.employeeId,
      date: data.date || null,
      entry: data.entry || null,
      exit_time: data.exit || null,
      tardiness_minutes: Math.max(0, Math.round(num(data.tardinessMinutes))),
      extra_minutes: Math.max(0, Math.round(num(data.extraMinutes))),
      type: data.type || 'normal',
      with_pay: data.withPay !== false,
      note: data.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_attendance').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },
  async update(id, patch) {
    const merged = { ...(this.getById(id) || {}), ...patch };
    const row = {
      employee_id: merged.employeeId || null,
      date: merged.date || null,
      entry: merged.entry || null,
      exit_time: merged.exit || null,
      tardiness_minutes: Math.max(0, Math.round(num(merged.tardinessMinutes))),
      extra_minutes: Math.max(0, Math.round(num(merged.extraMinutes))),
      type: merged.type || 'normal',
      with_pay: merged.withPay !== false,
      note: merged.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_attendance').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    const i = cache.findIndex((r) => r.id === id);
    if (i >= 0) cache[i] = rec;
    return rec;
  },
  async remove(id) {
    const { error } = await supabase.from('payroll_attendance').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((r) => r.id !== id);
  },

  /* ------------------------------- Cálculos ------------------------------ */
  descuentoPorMinuto(baseSalary) {
    return num(baseSalary) / 30 / 8 / 60;
  },
  descuentoTardanza(baseSalary, minutos) {
    return round2((num(baseSalary) / 30 / 8 / 60) * num(minutos));
  },
  descuentoPorDia(baseSalary) {
    return round2(num(baseSalary) / 30);
  },
  summarize(employeeId, year, month, baseSalary) {
    const recs = this.list(employeeId).filter((r) => dateInMonth(r.date, year, month));
    let tardinessMinutes = 0;
    let extraMinutes = 0;
    let absentWithPay = 0;
    let absentWithoutPay = 0;
    recs.forEach((r) => {
      tardinessMinutes += num(r.tardinessMinutes);
      extraMinutes += num(r.extraMinutes);
      if (r.type === 'falta' || r.type === 'descanso_medico' || r.type === 'licencia') {
        if (r.withPay) absentWithPay += 1;
        else absentWithoutPay += 1;
      }
    });
    const tardinessDiscount = this.descuentoTardanza(baseSalary, tardinessMinutes);
    const absenceDiscount = round2(this.descuentoPorDia(baseSalary) * absentWithoutPay);
    return {
      records: recs,
      tardinessMinutes,
      extraMinutes,
      absentWithPay,
      absentWithoutPay,
      tardinessDiscount,
      absenceDiscount,
      totalDiscount: round2(tardinessDiscount + absenceDiscount),
    };
  },
};
