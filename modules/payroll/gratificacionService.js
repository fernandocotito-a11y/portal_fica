/* ============================================================================
   gratificacionService.js — Gratificaciones registradas (julio/diciembre)
   ----------------------------------------------------------------------------
   Tabla propia (no se mezcla con bonificaciones). Guarda un registro por
   colaborador y período, para saber qué gratificación ya se registró.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];

function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    year: r.year,
    month: r.month,
    monto: num(r.monto),
    bonificacion: num(r.bonificacion),
  };
}

export const gratificacionService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_gratificaciones').select('*').eq('company_id', cid);
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    return employeeId ? cache.filter((g) => g.employeeId === employeeId) : cache.slice();
  },

  /** Registros de un mes/año (para mostrar el "registro" debajo del cuadro). */
  forPeriod(year, month) {
    return cache.filter((g) => g.year === year && g.month === month);
  },

  /** ¿Ya está registrada la gratificación de un mes para un empleado? */
  hasRegistered(employeeId, year, month) {
    return cache.some((g) => g.employeeId === employeeId && g.year === year && g.month === month);
  },

  /** Monto de gratificación registrada en un mes para un empleado. */
  sumFor(employeeId, year, month) {
    return round2(
      cache.filter((g) => g.employeeId === employeeId && g.year === year && g.month === month)
        .reduce((s, g) => s + num(g.monto), 0)
    );
  },

  async create({ employeeId, year, month, monto, bonificacion = 0 }) {
    const cid = activeCompanyId();
    const row = {
      company_id: cid,
      employee_id: employeeId,
      year,
      month,
      monto: num(monto),
      bonificacion: num(bonificacion),
    };
    const { data: saved, error } = await supabase
      .from('payroll_gratificaciones')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },

  async remove(id) {
    const { error } = await supabase.from('payroll_gratificaciones').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((g) => g.id !== id);
  },
};
