/* ============================================================================
   taxSummaryService.js — Liquidador tributario mensual de nómina
   ----------------------------------------------------------------------------
   Consolida el mes para el PDT PLAME y guarda el ESTADO de pago por empresa.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2, todayIso } from './payrollUtils.js';
import { getRmv, monthlyCommission } from './payrollConfig.js';
import { getAfpParams } from './payrollService.js';
import { activeCompanyId } from './payrollScope.js';

/* Cronograma referencial SUNAT: día límite (mes siguiente) según último dígito del RUC. */
const RUC_DIGIT_DAY = { 0: 13, 1: 14, 2: 15, 3: 16, 4: 17, 5: 18, 6: 19, 7: 20, 8: 21, 9: 22 };

let stateCache = {}; // 'YYYY-MM' -> state (tabla histórica de planilla)
let controlCache = {}; // 'YYYY-MM' -> control real de SUNAT (declaraciones)

export const taxSummaryService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      stateCache = {};
      controlCache = {};
      return;
    }
    const [statesRes, declRaw] = await Promise.all([
      supabase.from('payroll_tax_state').select('*').eq('company_id', cid),
      supabase
        .from('tax_declaration_periods')
        .select('anio,mes,estado,fecha_declaracion,fecha_pago,pagado')
        .eq('company_id', cid),
    ]);
    // Si aún no se ejecutó la migración de pago, seguimos con el estado anterior.
    const declRes = declRaw.error && /relation|does not exist|column|schema cache/i.test(declRaw.error.message)
      ? { data: [] }
      : declRaw;
    stateCache = {};
    (statesRes.data || []).forEach((r) => {
      stateCache[`${r.year}-${String(r.month).padStart(2, '0')}`] = r.state;
    });
    controlCache = {};
    (declRes.data || []).forEach((r) => {
      const key = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
      const pagado = !!r.pagado;
      const declarado = r.estado === 'declarado' || pagado || !!r.fecha_declaracion;
      controlCache[key] = {
        estado: pagado ? 'pagado' : (declarado ? 'declarado' : (stateCache[key] || 'pendiente')),
        fechaDeclaracion: r.fecha_declaracion || '',
        fechaPago: r.fecha_pago || '',
        pagado,
      };
    });
  },

  getControl(year, month) {
    return controlCache[`${year}-${String(month).padStart(2, '0')}`] || {
      estado: stateCache[`${year}-${String(month).padStart(2, '0')}`] || 'pendiente',
      fechaDeclaracion: '',
      fechaPago: '',
      pagado: false,
    };
  },

  getState(year, month) {
    return this.getControl(year, month).estado;
  },

  /** Actualiza el semáforo y lo refleja también en el control de declaraciones. */
  async setState(year, month, state) {
    const cid = activeCompanyId();
    if (!cid) throw new Error('No hay empresa activa.');
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const normalized = ['pendiente', 'declarado', 'pagado'].includes(state) ? state : 'pendiente';
    const current = this.getControl(year, month);
    const control = {
      estado: normalized,
      pagado: normalized === 'pagado' || (normalized === 'declarado' ? !!current.pagado : false),
      fechaDeclaracion: normalized === 'pendiente'
        ? current.fechaDeclaracion
        : (current.fechaDeclaracion || todayIso()),
      fechaPago: normalized === 'pagado'
        ? (current.fechaPago || todayIso())
        : (normalized === 'pendiente' ? '' : current.fechaPago),
    };
    stateCache[key] = normalized;
    controlCache[key] = control;

    const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    const one = await supabase
      .from('payroll_tax_state')
      .upsert({ company_id: cid, year, month, state: normalized }, { onConflict: 'company_id,year,month' });
    if (one.error) throw new Error(one.error.message);

    const two = await supabase.from('tax_declaration_periods').upsert({
      company_id: cid,
      anio: Number(year),
      mes: Number(month),
      estado: normalized === 'pendiente' ? 'pendiente' : 'declarado',
      pagado: control.pagado,
      fecha_declaracion: dateOrNull(control.fechaDeclaracion),
      fecha_pago: dateOrNull(control.fechaPago),
    }, { onConflict: 'company_id,anio,mes' });
    if (two.error && !/relation|does not exist|column|schema cache/i.test(two.error.message)) {
      throw new Error(two.error.message);
    }
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
    const rmv = getRmv(period.year, period.month);

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
        afpMap[key].comision = round2(afpMap[key].comision + base * monthlyCommission(employee.commissionType, params));
        afpMap[key].prima = round2(afpMap[key].prima + base * params.primaSeguro);
        afpMap[key].total = round2(afpMap[key].fondo + afpMap[key].comision + afpMap[key].prima);
        afpMap[key].afiliados += 1;
      });
    const afpList = Object.values(afpMap);
    const afpTotal = round2(afpList.reduce((s, a) => s + a.total, 0));

    const totalEmpleador = round2(essalud + vidaLey);
    const totalTrabajadorSunat = round2(renta5ta + onp);
    // La Vida Ley se paga a la aseguradora, no a SUNAT: no entra en "Total a SUNAT".
    const totalSunat = round2(essalud + totalTrabajadorSunat);

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
      fechaDeclaracion: this.getControl(period.year, period.month).fechaDeclaracion,
      fechaPago: this.getControl(period.year, period.month).fechaPago,
      pagado: this.getControl(period.year, period.month).pagado,
    };
  },
};
