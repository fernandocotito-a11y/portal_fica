/* ============================================================================
   accountStatementService.js — Estado de cuenta completo del trabajador
   ----------------------------------------------------------------------------
   Consolida por colaborador y año TODO lo que puede percibir:
   - Sueldo del mes (bruto, retenciones y neto sin descontar adelantos).
   - Gratificación (registrada o calculada si el período ya cerró).
   - CTS (solo régimen general, períodos mayo/noviembre ya cerrados).
   - Pagos registrados en "Pagos y Adelantos" (abonado).
   - Pendiente = total a percibir − pagos registrados.
   - Detalle de vacaciones (con saldo), asistencias, préstamos/adelantos,
     gratificaciones y CTS.

   "Abonado" sale SOLO de los pagos registrados (payroll_payments). Tener la
   planilla abierta o cerrada ya NO marca el mes como abonado.
   ========================================================================== */

import { payrollService, calcRow, inPeriod } from './payrollService.js';
import { vacationService } from './vacationService.js';
import { attendanceService, ATTENDANCE_TYPES } from './attendanceService.js';
import { paymentService, PAYMENT_CONCEPTS, PAYMENT_TYPES } from './paymentService.js';
import { gratificacionService } from './gratificacionService.js';
import { loanService } from './loanService.js';
import { benefitsService } from './benefitsService.js';
import { laborRules, MESES } from './payrollConfig.js';
import { num, round2 } from './payrollUtils.js';
import { authService } from '../../services/authService.js';

/* Conceptos que NO forman parte del sueldo del mes (se pagan aparte). */
const BENEFIT_CONCEPTS = ['gratificacion', 'cts', 'liquidacion', 'vacaciones'];

const conceptLabel = (v) => (PAYMENT_CONCEPTS.find((c) => c.value === v) || {}).label || 'Sueldo / remuneración';
const typeLabel = (v) => (PAYMENT_TYPES.find((t) => t.value === v) || {}).label || v || '—';
const attendanceLabel = (v) => (ATTENDANCE_TYPES.find((t) => t.value === v) || {}).label || v || '—';

/** ¿El período ya cerró (su fecha ya llegó)? Mismo criterio que CTS/Gratificaciones. */
function periodoCerrado(year, month) {
  const hoy = new Date();
  const hy = hoy.getFullYear();
  const hm = hoy.getMonth() + 1;
  return year < hy || (year === hy && month <= hm);
}

function emptyMonth(month) {
  return {
    month,
    name: MESES[month - 1],
    abierto: false,
    cerrada: false,
    futuro: false,
    bruto: 0,
    retenciones: 0,
    netoSueldo: 0,
    gratificacion: 0,
    cts: 0,
    totalPercibir: 0,
    abonado: 0,
    pendiente: 0,
    adelantos: 0,
  };
}

export const accountStatementService = {
  /**
   * Devuelve el estado de cuenta completo de un colaborador para un año.
   */
  getStatement(employeeId, year) {
    const employee = payrollService.getEmployee(employeeId);
    if (!employee) return null;

    const company = authService.activeCompany ? authService.activeCompany() : null;
    const rules = laborRules(company && company.regimen_laboral);

    const periods = payrollService.listPeriods();
    const pagos = paymentService.list(employeeId).filter((p) => p.year === year);
    const gratifs = gratificacionService.list(employeeId).filter((g) => g.year === year);
    const asistencias = attendanceService.list(employeeId).filter((r) => String(r.date || '').slice(0, 4) === String(year));
    const vacaciones = vacationService.list(employeeId).filter((v) => {
      const y1 = String(v.dateFrom || v.monthYear || v.period || '').slice(0, 4);
      const y2 = String(v.period || '').slice(5, 9);
      return y1 === String(year) || y2 === String(year);
    });

    const months = [];
    const totals = {
      bruto: 0,
      retenciones: 0,
      netoSueldo: 0,
      gratificacion: 0,
      cts: 0,
      totalPercibir: 0,
      abonado: 0,
      pendiente: 0,
      adelantos: 0,
    };

    const hoy = new Date();
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const futuro = year > hoy.getFullYear() || (year === hoy.getFullYear() && m > hoy.getMonth() + 1);
      if (!inPeriod(employee, year, m) || (futuro && !periods[key])) {
        const em = emptyMonth(m);
        em.futuro = futuro;
        months.push(em);
        continue;
      }

      const calc = calcRow(employee, payrollService.deriveMonthInputs(employee, year, m), year, m);

      // El neto de la planilla ya descuenta los adelantos; aquí mostramos el
      // sueldo neto completo y los adelantos van como parte del "abonado".
      const adelantos = paymentService.sumDeductionsFor(employee.id, year, m);
      const retenciones = round2(calc.totalRetenciones - adelantos);
      const netoSueldo = round2(calc.neto + adelantos);

      // Gratificación: lo registrado manda; si no se registró y el período ya
      // cerró, se muestra el cálculo automático (devengado).
      let gratificacion = 0;
      if (m === 7 || m === 12) {
        const registrado = round2(
          gratifs
            .filter((g) => g.month === m)
            .reduce((s, g) => s + num(g.monto) + num(g.bonificacion), 0)
        );
        if (registrado > 0) {
          gratificacion = registrado;
        } else if (rules.benefitFactor > 0 && periodoCerrado(year, m)) {
          gratificacion = benefitsService.calcGratificacion(employee, {
            year,
            semestre: m === 7 ? 'julio' : 'diciembre',
            factor: rules.benefitFactor,
          }).total;
        }
      }

      // CTS: solo régimen general y período ya cerrado.
      let cts = 0;
      if (rules.hasCts && (m === 5 || m === 11) && periodoCerrado(year, m)) {
        cts = benefitsService.calcCts(employee, {
          year,
          periodo: m === 5 ? 'mayo' : 'noviembre',
          hasCts: true,
        }).monto;
      }

      const totalPercibir = round2(netoSueldo + gratificacion + cts);
      const abonado = round2(pagos.filter((x) => x.month === m).reduce((s, x) => s + num(x.monto), 0));
      const pendiente = round2(totalPercibir - abonado);

      months.push({
        month: m,
        name: MESES[m - 1],
        abierto: !!periods[key],
        cerrada: !!(periods[key] && periods[key].closed),
        futuro: false,
        bruto: calc.totalBruto,
        retenciones,
        netoSueldo,
        gratificacion,
        cts,
        totalPercibir,
        abonado,
        pendiente,
        adelantos,
      });

      totals.bruto = round2(totals.bruto + calc.totalBruto);
      totals.retenciones = round2(totals.retenciones + retenciones);
      totals.netoSueldo = round2(totals.netoSueldo + netoSueldo);
      totals.gratificacion = round2(totals.gratificacion + gratificacion);
      totals.cts = round2(totals.cts + cts);
      totals.totalPercibir = round2(totals.totalPercibir + totalPercibir);
      totals.abonado = round2(totals.abonado + abonado);
      totals.pendiente = round2(totals.pendiente + pendiente);
      totals.adelantos = round2(totals.adelantos + adelantos);
    }

    /* ------------------------- Detalle de pagos ------------------------- */
    const payments = pagos
      .slice()
      .sort((a, b) => a.month - b.month)
      .map((p) => ({
        month: p.month,
        name: MESES[p.month - 1],
        concepto: p.concepto || '',
        conceptoLabel: conceptLabel(p.concepto),
        tipo: p.tipo,
        tipoLabel: typeLabel(p.tipo),
        monto: num(p.monto),
        comprobante: p.comprobante || '',
      }));

    const loans = payments.filter((p) => p.tipo === 'adelanto');

    /* ------------------------------ Préstamos --------------------------- */
    const prestamos = loanService.list(employeeId).map((l) => {
      const p = loanService.progress(l);
      return {
        id: l.id,
        descripcion: l.descripcion || '',
        monto: l.monto,
        nCuotas: l.nCuotas,
        cuota: p.cuota,
        aplicadas: p.aplicadas,
        total: p.total,
        aplicado: p.aplicado,
        saldo: p.saldo,
        startYear: l.startYear,
        startMonth: l.startMonth,
        name: MESES[l.startMonth - 1],
      };
    });
    const prestamosSaldo = round2(prestamos.reduce((s, p) => s + p.saldo, 0));

    /* --------------------- Gratificaciones y CTS ------------------------ */
    const gratificaciones = gratifs
      .slice()
      .sort((a, b) => a.month - b.month)
      .map((g) => ({
        month: g.month,
        name: MESES[g.month - 1],
        monto: num(g.monto),
        bonificacion: num(g.bonificacion),
        total: round2(num(g.monto) + num(g.bonificacion)),
      }));

    const ctsDetail = [];
    if (rules.hasCts) {
      [5, 11].forEach((m) => {
        if (!periodoCerrado(year, m)) return;
        const r = benefitsService.calcCts(employee, {
          year,
          periodo: m === 5 ? 'mayo' : 'noviembre',
          hasCts: true,
        });
        ctsDetail.push({
          month: m,
          name: MESES[m - 1],
          base: r.base,
          dias: r.diasComputables,
          monto: r.monto,
        });
      });
    }

    /* ----------------------------- Vacaciones --------------------------- */
    const accrualDate = year < new Date().getFullYear() ? new Date(year, 11, 31) : new Date();
    const vacationBalance = vacationService.accrual(employeeId, rules.vacationDays, accrualDate);
    const vacations = vacaciones
      .slice()
      .sort((a, b) => String(a.dateFrom || '').localeCompare(String(b.dateFrom || '')))
      .map((v) => ({
        period: v.period || '',
        daysTaken: num(v.daysTaken),
        dateFrom: v.dateFrom || '',
        dateTo: v.dateTo || '',
        monthYear: v.monthYear || '',
        note: v.note || '',
      }));

    /* ---------------------------- Asistencias --------------------------- */
    const attTotals = {
      tardinessMinutes: 0,
      extraMinutes: 0,
      absentWithPay: 0,
      absentWithoutPay: 0,
      tardinessDiscount: 0,
      absenceDiscount: 0,
      totalDiscount: 0,
    };
    for (let m = 1; m <= 12; m++) {
      const s = attendanceService.summarize(employeeId, year, m, employee.baseSalary);
      attTotals.tardinessMinutes += s.tardinessMinutes;
      attTotals.extraMinutes += s.extraMinutes;
      attTotals.absentWithPay += s.absentWithPay;
      attTotals.absentWithoutPay += s.absentWithoutPay;
      attTotals.tardinessDiscount = round2(attTotals.tardinessDiscount + s.tardinessDiscount);
      attTotals.absenceDiscount = round2(attTotals.absenceDiscount + s.absenceDiscount);
      attTotals.totalDiscount = round2(attTotals.totalDiscount + s.totalDiscount);
    }

    const attendance = asistencias.map((r) => ({
      date: r.date || '',
      type: r.type,
      typeLabel: attendanceLabel(r.type),
      tardinessMinutes: num(r.tardinessMinutes),
      extraMinutes: num(r.extraMinutes),
      withPay: r.withPay !== false,
      note: r.note || '',
    }));

    return {
      employee,
      year,
      rules,
      months,
      totals,
      payments,
      paymentsTotal: totals.abonado,
      loans,
      prestamos,
      prestamosSaldo,
      gratificaciones,
      ctsDetail,
      vacations,
      vacationBalance,
      attendance,
      attendanceTotals: attTotals,
    };
  },

  /** Años con información (planillas, pagos o gratificaciones) para el selector. */
  availableYears() {
    const years = new Set();
    Object.keys(payrollService.listPeriods()).forEach((k) => years.add(k.split('-')[0]));
    paymentService.list().forEach((p) => p.year && years.add(String(p.year)));
    gratificacionService.list().forEach((g) => g.year && years.add(String(g.year)));
    years.add(String(new Date().getFullYear()));
    return Array.from(years)
      .map(Number)
      .sort((a, b) => b - a);
  },
};
