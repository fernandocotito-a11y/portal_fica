/* ============================================================================
   taxSummaryService.js — Liquidador tributario mensual de nómina
   ----------------------------------------------------------------------------
   Consolida el mes para la declaración del PDT PLAME:
     - A cargo del empleador: EsSalud (9%), Seguro Vida Ley / EPS.
     - Retenido al trabajador (a pagar a SUNAT): Renta 5ta, ONP (13%).
     - Aportes SPP (AFPnet): fondo obligatorio + comisión + prima por AFP.
   Incluye fecha límite según el último dígito del RUC y estado de pago.
   ========================================================================== */

import { num, round2, storeRead, storeWrite } from './payrollUtils.js';
import { getRmv, MESES } from './payrollConfig.js';
import { getAfpParams } from './payrollService.js';

const K = 'fica.payroll.taxState';

/* Cronograma referencial SUNAT: día límite (mes siguiente) según último dígito del RUC.
   Debe actualizarse con el cronograma oficial del año. */
const RUC_DIGIT_DAY = { 0: 13, 1: 14, 2: 15, 3: 16, 4: 17, 5: 18, 6: 19, 7: 20, 8: 21, 9: 22 };

export const taxSummaryService = {
  getState(year, month) {
    const all = storeRead(K, {});
    return all[`${year}-${String(month).padStart(2, '0')}`] || 'pendiente';
  },
  setState(year, month, state) {
    const all = storeRead(K, {});
    all[`${year}-${String(month).padStart(2, '0')}`] = state;
    storeWrite(K, all);
  },

  /** Fecha límite de pago (referencial) según el último dígito del RUC. */
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

  /**
   * Resumen ejecutivo del período.
   * @param {Array} rows [{ employee, calc }]
   * @param {Object} period { year, month }
   * @param {Object} company { name, ruc }
   */
  buildSummary(rows, period, company) {
    const rmv = getRmv(period.year);

    const essalud = round2(rows.reduce((s, r) => s + num(r.calc.essalud), 0));
    const vidaLey = round2(rows.reduce((s, r) => s + num(r.calc.vidaLey), 0));
    const renta5ta = round2(rows.reduce((s, r) => s + num(r.calc.renta5ta), 0));
    const onp = round2(
      rows.filter((r) => r.employee.pensionType === 'ONP').reduce((s, r) => s + num(r.calc.pension), 0)
    );

    // Desglose AFP por administradora
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
    const totalSunat = round2(totalEmpleador + totalTrabajadorSunat); // EsSalud va a SUNAT (PLAME)

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
