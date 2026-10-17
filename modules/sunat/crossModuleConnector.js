/* ============================================================================
   crossModuleConnector.js — Enlace con SIRE / Declaraciones SUNAT
   ----------------------------------------------------------------------------
   Alimenta los futuros módulos de "Compras y Ventas SIRE" y "Declaraciones
   SUNAT" con el consolidado mensual de nómina como gasto deducible para la
   liquidación del Impuesto a la Renta empresarial.
   ========================================================================== */

import { num, round2, downloadText, amount2 } from '../payroll/payrollUtils.js';

export const crossModuleConnector = {
  /**
   * Consolidado de nómina como gasto deducible del mes.
   * @param {Array} rows [{ employee, calc }]
   */
  getPayrollExpense(rows, period) {
    const remuneraciones = round2(rows.reduce((s, r) => s + num(r.calc.totalBruto), 0));
    const essalud = round2(rows.reduce((s, r) => s + num(r.calc.essalud), 0));
    const vidaLey = round2(rows.reduce((s, r) => s + num(r.calc.vidaLey), 0));
    const gastoTotal = round2(remuneraciones + essalud + vidaLey);

    return {
      period,
      remuneraciones,
      essalud,
      vidaLey,
      gastoTotal,
      trabajadores: rows.length,
      // Estructura lista para el módulo de Declaraciones (IR empresarial)
      concepto: 'Gastos de personal (Planilla)',
      deducibleIR: gastoTotal,
    };
  },

  /**
   * Payload preparatorio para el módulo SIRE (Compras y Ventas).
   * No es una comprobante de compra/venta, pero deja el contrato listo.
   */
  getSirePayload(rows, period) {
    return {
      period,
      origen: 'PLANILLA',
      detalle: rows.map((r) => ({
        docTipo: 'PLANILLA',
        docNumero: `${period.year}${String(period.month).padStart(2, '0')}`,
        razonSocial: r.employee.name,
        docTrabajador: r.employee.docNumber,
        baseImponible: round2(num(r.calc.totalBruto)),
        igv: 0,
        total: round2(num(r.calc.totalBruto)),
      })),
    };
  },

  /** Exporta el consolidado (CSV) para el área contable / declaraciones. */
  downloadDeductibleCSV(rows, period) {
    const e = this.getPayrollExpense(rows, period);
    const lines = [
      ['Concepto', 'Importe'],
      ['Remuneraciones (gasto)', amount2(e.remuneraciones)],
      ['EsSalud (aporte empleador)', amount2(e.essalud)],
      ['Seguro Vida Ley', amount2(e.vidaLey)],
      ['TOTAL GASTO DEDUCIBLE - PERSONAL', amount2(e.gastoTotal)],
      [`Período`, `${period.year}-${String(period.month).padStart(2, '0')}`],
      [`Trabajadores`, String(e.trabajadores)],
    ];
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    downloadText(`GASTO_PERSONAL_${period.year}${String(period.month).padStart(2, '0')}.csv`, csv, 'text/csv');
    return e;
  },
};
