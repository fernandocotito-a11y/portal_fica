/* ============================================================================
   accountStatementService.js — Estado de cuenta y resumen histórico
   ----------------------------------------------------------------------------
   Consolida por colaborador: histórico anual (ingresos, retenciones, neto,
   abonado y pendiente), préstamos/adelantos, vacaciones y asistencias.

   Importante: "Abonado" sale SOLO de los pagos registrados en la pestaña
   "Pagos y Adelantos" (payroll_payments). Tener la planilla abierta o cerrada
   ya NO marca el mes como abonado.
   ========================================================================== */

import { payrollService, calcRow, inPeriod } from './payrollService.js';
import { vacationService } from './vacationService.js';
import { attendanceService } from './attendanceService.js';
import { paymentService } from './paymentService.js';
import { num, round2 } from './payrollUtils.js';
import { MESES } from './payrollConfig.js';

/* Conceptos que NO forman parte del sueldo del mes (se pagan aparte). */
const BENEFIT_CONCEPTS = ['gratificacion', 'cts', 'liquidacion', 'vacaciones'];

export const accountStatementService = {
  /**
   * Devuelve el estado de cuenta de un colaborador para un año.
   */
  getStatement(employeeId, year) {
    const employee = payrollService.getEmployee(employeeId);
    if (!employee) return null;

    const periods = payrollService.listPeriods();
    const pagos = paymentService.list(employeeId).filter((p) => p.year === year);

    const months = [];
    let totalBruto = 0;
    let totalRetenciones = 0;
    let totalNeto = 0;
    let totalAbonado = 0;
    let totalPendiente = 0;

    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const p = periods[key];
      if (!inPeriod(employee, year, m)) {
        months.push({ month: m, name: MESES[m - 1], abierto: false, bruto: 0, retenciones: 0, neto: 0, abonado: 0, pendiente: 0 });
        continue;
      }

      const calc = calcRow(employee, payrollService.deriveMonthInputs(employee, year, m), year, m);
      const pagosMes = pagos.filter((x) => x.month === m);

      // Todo lo que se le entregó al trabajador en el mes (sueldo, adelantos, beneficios).
      const abonado = round2(pagosMes.reduce((s, x) => s + num(x.monto), 0));

      // Solo los "pago total" de sueldo/otros descuentan el neto pendiente.
      // Los adelantos ya están descontados dentro del neto de la planilla.
      const pagadoSueldo = round2(
        pagosMes
          .filter((x) => x.tipo === 'total' && !BENEFIT_CONCEPTS.includes(x.concepto))
          .reduce((s, x) => s + num(x.monto), 0)
      );

      const pendiente = p ? Math.max(0, round2(calc.neto - pagadoSueldo)) : 0;

      months.push({
        month: m,
        name: MESES[m - 1],
        abierto: !!p,
        bruto: calc.totalBruto,
        retenciones: calc.totalRetenciones,
        neto: calc.neto,
        abonado,
        pendiente,
      });

      totalBruto = round2(totalBruto + calc.totalBruto);
      totalRetenciones = round2(totalRetenciones + calc.totalRetenciones);
      totalNeto = round2(totalNeto + calc.neto);
      totalAbonado = round2(totalAbonado + abonado);
      totalPendiente = round2(totalPendiente + pendiente);
    }

    // Préstamos / adelantos: salen de los pagos registrados (tipo adelanto)
    const loans = pagos
      .filter((x) => x.tipo === 'adelanto')
      .map((x) => ({ month: MESES[x.month - 1], monto: x.monto, concepto: x.concepto }));

    const vacations = vacationService.list(employeeId);
    const attendance = attendanceService.list(employeeId).filter((r) => {
      const d = new Date(r.date);
      return d.getFullYear() === year;
    });

    return {
      employee,
      year,
      months,
      totals: { totalBruto, totalRetenciones, totalNeto, totalAbonado, pendiente: totalPendiente },
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
