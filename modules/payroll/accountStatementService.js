/* ============================================================================
   accountStatementService.js — Estado de cuenta y resumen histórico
   ----------------------------------------------------------------------------
   Consolida por colaborador: histórico anual (ingresos, retenciones, neto
   abonado), préstamos/adelantos, vacaciones y asistencias.
   ========================================================================== */

import { payrollService, calcRow } from './payrollService.js';
import { vacationService } from './vacationService.js';
import { attendanceService } from './attendanceService.js';
import { num, round2 } from './payrollUtils.js';
import { MESES } from './payrollConfig.js';

export const accountStatementService = {
  /**
   * Devuelve el estado de cuenta de un colaborador para un año.
   */
  getStatement(employeeId, year) {
    const employee = payrollService.getEmployee(employeeId);
    if (!employee) return null;

    const periods = payrollService.listPeriods();
    const months = [];
    let totalBruto = 0;
    let totalRetenciones = 0;
    let totalNeto = 0;
    let totalAbonado = 0;

    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const p = periods[key];
      const calc = calcRow(employee, payrollService.deriveMonthInputs(employee, year, m), year, m);
      const abonado = p ? calc.neto : 0;
      months.push({
        month: m,
        name: MESES[m - 1],
        abierto: !!p,
        bruto: calc.totalBruto,
        retenciones: calc.totalRetenciones,
        neto: calc.neto,
        abonado,
      });
      totalBruto = round2(totalBruto + calc.totalBruto);
      totalRetenciones = round2(totalRetenciones + calc.totalRetenciones);
      totalNeto = round2(totalNeto + calc.neto);
      totalAbonado = round2(totalAbonado + abonado);
    }

    // Préstamos / adelantos (registrados en las entradas del período)
    const loans = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const li = num(periods[key]?.rows?.[employeeId]?.loans);
      if (li > 0) loans.push({ month: MESES[m - 1], monto: li });
    }

    const vacations = vacationService.list(employeeId);
    const attendance = attendanceService.list(employeeId).filter((r) => {
      const d = new Date(r.date);
      return d.getFullYear() === year;
    });

    return {
      employee,
      year,
      months,
      totals: { totalBruto, totalRetenciones, totalNeto, totalAbonado, pendiente: round2(totalNeto - totalAbonado) },
      loans,
      vacations,
      attendance,
    };
  },

  /** Años que tienen alguna planilla guardada (para el selector). */
  availableYears() {
    const periods = payrollService.listPeriods();
    const years = new Set(Object.keys(periods).map((k) => k.split('-')[0]));
    if (years.size === 0) years.add(String(new Date().getFullYear()));
    return Array.from(years).map(Number).sort((a, b) => b - a);
  },
};
