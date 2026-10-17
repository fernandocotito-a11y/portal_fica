/* ============================================================================
   liquidationService.js — Liquidación de Beneficios Sociales (Supabase)
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { getRmv, TASAS } from './payrollConfig.js';
import { activeCompanyId } from './payrollScope.js';

let cache = [];

export const MOTIVOS_CESE = [
  { value: 'renuncia', label: 'Renuncia voluntaria' },
  { value: 'despido', label: 'Despido' },
  { value: 'mutuo_acuerdo', label: 'Mutuo acuerdo' },
  { value: 'fin_contrato', label: 'Fin de contrato' },
  { value: 'jubilacion', label: 'Jubilación' },
];

function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name || '',
    fechaCese: r.fecha_cese || '',
    motivo: r.motivo || 'renuncia',
    bruto: num(r.bruto),
    neto: num(r.neto),
    createdAt: r.created_at,
  };
}

export const liquidationService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_liquidations').select('*').eq('company_id', cid).order('created_at', { ascending: false });
    cache = (data || []).map(map);
  },

  list() {
    return cache.slice();
  },

  async save(liq) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: liq.employeeId || null,
      employee_name: liq.employeeName || null,
      fecha_cese: liq.fechaCese || null,
      motivo: liq.motivo || 'renuncia',
      bruto: num(liq.bruto),
      neto: num(liq.neto),
    };
    const { data: saved, error } = await supabase.from('payroll_liquidations').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.unshift(rec);
    return rec;
  },

  async remove(id) {
    const { error } = await supabase.from('payroll_liquidations').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((r) => r.id !== id);
  },

  /** Cálculo de la liquidación (puro). */
  calcLiquidacion(emp, opts = {}) {
    const year = opts.year || new Date().getFullYear();
    const asig = emp.asignacionFamiliar ? round2(getRmv(year) * TASAS.asignacionFamiliar) : 0;
    const basico = round2(num(emp.baseSalary));
    const base = round2(basico + asig);

    const sexto = round2(base / 6);
    const ctsBase = round2(base + sexto);
    const diasCts = num(opts.diasCts, 0);
    const ctsTrunca = round2((ctsBase / 360) * diasCts);

    const daily = round2(base / 30);
    const vacTruncas = round2(daily * num(opts.vacProporcionales, 0));
    const vacPendientes = round2(daily * num(opts.vacPendientes, 0));

    const mesesGrati = Math.min(Math.max(num(opts.mesesGrati, 0), 0), 6);
    const gratiTrunca = round2((base / 6) * mesesGrati);
    const tasaBono = opts.tipoBono === 'EPS' ? 0.0675 : 0.09;
    const bonoExtra = round2(gratiTrunca * tasaBono);
    const bruto = round2(ctsTrunca + vacTruncas + vacPendientes + gratiTrunca + bonoExtra);

    const afecto = round2(vacTruncas + vacPendientes + gratiTrunca);
    let pension = 0;
    let pensionLabel = '—';
    if (emp.pensionType === 'ONP') {
      pension = round2(afecto * TASAS.onp);
      pensionLabel = 'ONP 13%';
    } else if (emp.pensionType === 'AFP') {
      pension = round2(afecto * 0.1);
      pensionLabel = `AFP ${emp.afp || ''} (aporte 10%)`.trim();
    }
    const renta5ta = round2(num(opts.renta5taRegularizacion, 0));
    const deducciones = round2(pension + renta5ta);
    const neto = round2(bruto - deducciones);

    return {
      employee: emp,
      year,
      fechaCese: opts.fechaCese || '',
      motivo: opts.motivo || 'renuncia',
      basico,
      asignacionFamiliar: asig,
      base,
      cts: { base: ctsBase, sexto, diasCts, monto: ctsTrunca },
      vacaciones: { daily, truncas: vacTruncas, pendientes: vacPendientes, diasTruncas: num(opts.vacProporcionales, 0), diasPendientes: num(opts.vacPendientes, 0) },
      gratificacion: { monto: gratiTrunca, mesesGrati, tasaBono, bonoExtra },
      bruto,
      deducciones: { pension, pensionLabel, renta5ta, total: deducciones },
      neto,
    };
  },
};
