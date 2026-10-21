/* ============================================================================
   accountingBridgeService.js — Asientos contables de planilla (PCGE)
   ----------------------------------------------------------------------------
   Genera la provisión mensual bajo el Plan Contable General Empresarial:
     Debe (Clase 6 - Gastos): 6211, 6214, 6215, 6271…
     Haber (Clase 4/1): 4031, 4032, 40173, 417, 141, 4111
   Produce un voucher balanceado (Debe = Haber) y exportación CSV/Excel.
   ========================================================================== */

import { num, round2, downloadText } from './payrollUtils.js';
import { MESES } from './payrollConfig.js';

export const accountingBridgeService = {
  /**
   * Construye el asiento contable del período.
   * @param {Array} rows [{ employee, calc }]
   * @param {Object} period { year, month }
   * @param {Object} opts { gratificaciones, cts }
   */
  buildEntry(rows, period, opts = {}) {
    const sum = (fn) => round2(rows.reduce((s, r) => s + num(fn(r)), 0));

    const basicos = sum((r) => num(r.calc.basico) + num(r.calc.asigFamiliar) + num(r.calc.bonificaciones) + num(r.calc.overtime));
    const tardanzas = sum((r) => num(r.calc.tardanzas));
    const vacaciones = sum((r) => num(r.calc.vacaciones));
    const gratificaciones = round2(num(opts.gratificaciones));
    const essalud = sum((r) => num(r.calc.essalud));
    const vidaLey = sum((r) => num(r.calc.vidaLey));

    const onp = sum((r) => (r.employee.pensionType === 'ONP' ? num(r.calc.pension) : 0));
    const afp = sum((r) => (r.employee.pensionType === 'AFP' ? num(r.calc.pension) : 0));
    const renta5ta = sum((r) => num(r.calc.renta5ta));
    const prestamos = sum((r) => num(r.calc.prestamos));
    const neto = sum((r) => num(r.calc.neto));

    const sueldosGasto = round2(basicos - tardanzas);

    const lines = [];
    const push = (cuenta, nombre, debe, haber) => {
      if (round2(debe) !== 0 || round2(haber) !== 0) lines.push({ cuenta, nombre, debe: round2(debe), haber: round2(haber) });
    };

    // ---- DEBE (gastos) ----
    push('6211', 'Sueldos y salarios', sueldosGasto, 0);
    if (gratificaciones) push('6214', 'Gratificaciones', gratificaciones, 0);
    if (vacaciones) push('6215', 'Vacaciones', vacaciones, 0);
    if (essalud) push('6271', 'Régimen de prestaciones de salud (EsSalud)', essalud, 0);
    if (vidaLey) push('6271', 'Seguro Vida Ley', vidaLey, 0);

    // ---- HABER (pasivos / por pagar) ----
    if (essalud) push('4031', 'EsSalud', 0, essalud);
    if (onp) push('4032', 'ONP', 0, onp);
    if (renta5ta) push('40173', 'Renta de 5ta categoría', 0, renta5ta);
    if (afp) push('417', 'Administradoras de fondos de pensiones (AFP)', 0, afp);
    if (prestamos) push('141', 'Personal (préstamos y adelantos por cobrar)', 0, prestamos);
    push('4111', 'Remuneraciones por pagar', 0, neto);

    const totalDebe = round2(lines.reduce((s, l) => s + l.debe, 0));
    const totalHaber = round2(lines.reduce((s, l) => s + l.haber, 0));

    return {
      period,
      lines,
      totalDebe,
      totalHaber,
      balanced: totalDebe === totalHaber,
      diferencia: round2(totalDebe - totalHaber),
    };
  },

  /** Exporta el asiento a CSV (compatible Concar/Contasis/Siscont). */
  toCSV(entry, company) {
    const head = ['Cuenta', 'Denominación', 'Debe', 'Haber'];
    const body = entry.lines.map((l) => [l.cuenta, l.nombre, l.debe.toFixed(2), l.haber.toFixed(2)]);
    body.push(['', 'TOTALES', entry.totalDebe.toFixed(2), entry.totalHaber.toFixed(2)]);
    const rows = [head, ...body];
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  },

  downloadCSV(entry, company) {
    const name = `ASIENTO_${entry.period.year}${String(entry.period.month).padStart(2, '0')}.csv`;
    downloadText(name, this.toCSV(entry, company), 'text/csv');
  },
};
