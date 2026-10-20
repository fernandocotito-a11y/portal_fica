/* ============================================================================
   paymentService.js — Control de pagos, adelantos y préstamos (Supabase)
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];

export const PAYMENT_TYPES = [
  { value: 'adelanto', label: 'Adelanto (anticipo)' },
  { value: 'total', label: 'Pago total' },
];

/* Catálogo de conceptos de pago (qué se paga): gratificación, CTS, liquidación, etc.
   Es independiente del "tipo" (adelanto vs pago total). */
export const PAYMENT_CONCEPTS = [
  { value: 'gratificacion', label: 'Gratificación' },
  { value: 'cts', label: 'CTS' },
  { value: 'liquidacion', label: 'Liquidación de beneficios sociales' },
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'sueldo', label: 'Sueldo / remuneración' },
  { value: 'otro', label: 'Otro' },
];

function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    year: r.year,
    month: r.month,
    tipo: r.tipo || 'adelanto',
    concepto: r.concepto || '',
    monto: num(r.monto),
    comprobante: r.comprobante || '',
  };
}

export const paymentService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_payments').select('*').eq('company_id', cid);
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    return employeeId ? cache.filter((p) => p.employeeId === employeeId) : cache.slice();
  },
  forMonth(employeeId, year, month) {
    return cache.filter((p) => p.employeeId === employeeId && p.year === year && p.month === month);
  },
  /** Descuentos del mes (solo los "adelantos" se descuentan de la planilla). */
  sumDeductionsFor(employeeId, year, month) {
    return round2(
      this.forMonth(employeeId, year, month)
        .filter((p) => p.tipo === 'adelanto')
        .reduce((s, p) => s + num(p.monto), 0)
    );
  },

  async create(data) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: data.employeeId,
      year: data.year,
      month: data.month,
      tipo: data.tipo || 'adelanto',
      concepto: data.concepto || null,
      monto: num(data.monto),
      comprobante: data.comprobante || null,
    };
    const { data: saved, error } = await supabase.from('payroll_payments').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },
  async update(id, patch) {
    const merged = { ...(cache.find((p) => p.id === id) || {}), ...patch };
    const row = {
      employee_id: merged.employeeId || null,
      year: num(merged.year),
      month: num(merged.month),
      tipo: merged.tipo || 'adelanto',
      concepto: merged.concepto || null,
      monto: num(merged.monto),
      comprobante: merged.comprobante || null,
    };
    const { data: saved, error } = await supabase.from('payroll_payments').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    const i = cache.findIndex((p) => p.id === id);
    if (i >= 0) cache[i] = rec;
    return rec;
  },
  async remove(id) {
    const { error } = await supabase.from('payroll_payments').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((p) => p.id !== id);
  },
};
