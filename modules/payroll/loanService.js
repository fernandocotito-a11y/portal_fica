/* ============================================================================
   loanService.js — Préstamos con cuotas (Supabase)
   ----------------------------------------------------------------------------
   Cada préstamo tiene: monto total, n° de cuotas y mes/año de la primera cuota.
   La cuota se calcula automáticamente y se descuenta en la planilla del mes
   que corresponde (sin duplicar con adelantos puntuales).
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];

function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    descripcion: r.descripcion || '',
    monto: num(r.monto),
    nCuotas: Math.max(1, Math.round(num(r.n_cuotas, 1))),
    startYear: num(r.start_year),
    startMonth: num(r.start_month),
  };
}

function monthIndex(year, month) {
  return num(year) * 12 + (num(month) - 1);
}

function fromIndex(idx) {
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const loanService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_loans').select('*').eq('company_id', cid);
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    return employeeId ? cache.filter((l) => l.employeeId === employeeId) : cache.slice();
  },

  getById(id) {
    return cache.find((l) => l.id === id) || null;
  },

  async create(data) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: data.employeeId,
      descripcion: data.descripcion || null,
      monto: num(data.monto),
      n_cuotas: Math.max(1, Math.round(num(data.nCuotas, 1))),
      start_year: num(data.startYear),
      start_month: num(data.startMonth),
    };
    const { data: saved, error } = await supabase.from('payroll_loans').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },

  async update(id, patch) {
    const merged = { ...(this.getById(id) || {}), ...patch };
    const row = {
      employee_id: merged.employeeId,
      descripcion: merged.descripcion || null,
      monto: num(merged.monto),
      n_cuotas: Math.max(1, Math.round(num(merged.nCuotas, 1))),
      start_year: num(merged.startYear),
      start_month: num(merged.startMonth),
    };
    const { data: saved, error } = await supabase.from('payroll_loans').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    const i = cache.findIndex((l) => l.id === id);
    if (i >= 0) cache[i] = rec;
    return rec;
  },

  async remove(id) {
    const { error } = await supabase.from('payroll_loans').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((l) => l.id !== id);
  },

  /** Cuota mensual (la última se ajusta para cuadrar el total exacto). */
  cuotaMonto(loan) {
    const n = Math.max(1, Math.round(num(loan.nCuotas, 1)));
    return round2(num(loan.monto) / n);
  },

  /** Cronograma de cuotas: [{ n, year, month, monto, aplicada }]. */
  schedule(loan, today = new Date()) {
    const n = Math.max(1, Math.round(num(loan.nCuotas, 1)));
    const total = num(loan.monto);
    const cuota = round2(total / n);
    const start = monthIndex(loan.startYear, loan.startMonth);
    const idxHoy = monthIndex(today.getFullYear(), today.getMonth() + 1);
    const out = [];
    let acum = 0;
    for (let i = 0; i < n; i++) {
      const { year, month } = fromIndex(start + i);
      const monto = i === n - 1 ? round2(total - acum) : cuota;
      acum = round2(acum + monto);
      out.push({ n: i + 1, year, month, monto, aplicada: start + i <= idxHoy });
    }
    return out;
  },

  /** Avance del préstamo (cuotas aplicadas, monto aplicado y saldo). */
  progress(loan, today = new Date()) {
    const sch = this.schedule(loan, today);
    const aplicadas = sch.filter((c) => c.aplicada);
    const aplicado = round2(aplicadas.reduce((s, c) => s + c.monto, 0));
    return {
      total: sch.length,
      aplicadas: aplicadas.length,
      aplicado,
      saldo: round2(num(loan.monto) - aplicado),
      cuota: this.cuotaMonto(loan),
    };
  },

  /** Cuota que corresponde a un mes concreto (para descontar en planilla). */
  sumCuotaFor(employeeId, year, month) {
    const idx = monthIndex(year, month);
    return round2(
      this.list(employeeId)
        .flatMap((l) => this.schedule(l))
        .filter((c) => monthIndex(c.year, c.month) === idx)
        .reduce((s, c) => s + c.monto, 0)
    );
  },
};
