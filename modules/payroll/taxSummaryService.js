/* ============================================================================
   taxSummaryService.js — Liquidador tributario mensual de nómina
   ----------------------------------------------------------------------------
   Consolida el mes para el PDT PLAME y guarda el ESTADO de pago por empresa.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { getRmv } from './payrollConfig.js';
import { getAfpParams } from './payrollService.js';
import { activeCompanyId } from './payrollScope.js';

/* Cronograma referencial SUNAT: día límite (mes siguiente) según último dígito del RUC. */
const RUC_DIGIT_DAY = { 0: 13, 1: 14, 2: 15, 3: 16, 4: 17, 5: 18, 6: 19, 7: 20, 8: 21, 9: 22 };

let stateCache = {}; // 'YYYY-MM' -> state

export const taxSummaryService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      stateCache = {};
      return;
    }
    const { data } = await supabase.from('payroll_tax_state').select('*').eq('company_id', cid);
    stateCache = {};
    (data || []).forEach((r) => {
      stateCache[`${r.year}-${String(r.month).padStart(2, '0')}`] = r.state;
    });
  },

  getState(year, month) {
    return stateCache[`${year}-${String(month).padStart(2, '0')}`] || 'pendiente';
  },
  async setState(year, month, state) {
    const cid = activeCompanyId();
    stateCache[`${year}-${String(month).padStart(2, '0')}`] = state;
    const { error } = await supabase
      .from('payroll_tax_state')
      .upsert({ company_id: cid, year, month, state }, { onConflict: 'company_id,year,month' });
    if (error) throw new Error(error.message);
  },

  dueDate(ruc, year, month) {
    const last = String(ruc || '').replace(/\D/g, '').slice(-1);
    const day = RUC_DIGIT_DAY[last] ?? 15;
    let m = month + 1;
    let y = year;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },

  buildSummary(rows, period, company) {
    const rmv = getRmv(period.year);

    const essalud = round2(rows.reduce((s, r) => s + num(r.calc.essalud), 0));
    const vidaLey = round2(rows.reduce((s, r) => s + num(r.calc.vidaLey), 0));
    const renta5ta = round2(rows.reduce((s, r) => s + num(r.calc.renta5ta), 0));
    const onp = round2(rows.filter((r) => r.employee.pensionType === 'ONP').reduce((s, r) => s + num(r.calc.pension), 0));

    const afpMap = {};
    rows
      .filter((r) => r.employee.pensionType === 'AFP')
      .forEach(({ employee, calc }) => {
        const key = employee.afp || 'AFP';
        const params = getAfpParams(period.year, period.month, employee.afp);
        const base = Math.min(num(calc.remAsegurable), num(params.remMaxAsegurable, num(calc.remAsegurable)));
        if (!afpMap[key]) afpMap[key] = { afp: key, fondo: 0, comision: 0, prima: 0, total: 0, afiliados: 0 };
        afpMap[key].fondo = round2(afpMap[key].fondo + base * params.aporteObligatorio);
        afpMap[key].comision = round2(afpMap[key].comision + base * params.comisionFlujo);
        afpMap[key].prima = round2(afpMap[key].prima + base * params.primaSeguro);
        afpMap[key].total = round2(afpMap[key].fondo + afpMap[key].comision + afpMap[key].prima);
        afpMap[key].afiliados += 1;
      });
    const afpList = Object.values(afpMap);
    const afpTotal = round2(afpList.reduce((s, a) => s + a.total, 0));

    const totalEmpleador = round2(essalud + vidaLey);
    const totalTrabajadorSunat = round2(renta5ta + onp);
    const totalSunat = round2(totalEmpleador + totalTrabajadorSunat);

    return {
      period,
      company,
      essalud,
      vidaLey,
      renta5ta,
      onp,
      afpList,
      afpTotal,
      totalEmpleador,
      totalTrabajadorSunat,
      totalSunat,
      totalAFPnet: afpTotal,
      rmv,
      trabajadores: rows.length,
      dueDate: this.dueDate(company?.ruc, period.year, period.month),
      state: this.getState(period.year, period.month),
    };
  },
};
