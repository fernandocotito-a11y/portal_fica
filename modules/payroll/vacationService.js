/* ============================================================================
   vacationService.js — Control de vacaciones
   ----------------------------------------------------------------------------
   - Base legal de 30 días por período laboral anual (ej. 2025-2026).
   - Días gozados, días pendientes y saldo acumulado.
   - Remuneración vacacional diaria = sueldo_basico / 30.
   - Registro de vacaciones gozadas por mes (para reflejarlas en la planilla).
   ========================================================================== */

import { num, round2, uuid, storeRead, storeWrite, dateInMonth } from './payrollUtils.js';

const K = 'fica.payroll.vacations';
const DIAS_LEGALES = 30;

/** Período laboral correspondiente a una fecha (ej. '2025-2026'). */
export function periodOfYear(year) {
  return `${year}-${year + 1}`;
}

export const vacationService = {
  list(employeeId = null) {
    const all = storeRead(K, []);
    return employeeId ? all.filter((r) => r.employeeId === employeeId) : all.slice();
  },

  create(data) {
    const all = storeRead(K, []);
    const rec = {
      id: uuid(),
      employeeId: data.employeeId,
      period: data.period || '',
      daysTaken: num(data.daysTaken),
      dateFrom: data.dateFrom || '',
      dateTo: data.dateTo || '',
      monthYear: data.monthYear || '', // 'YYYY-MM' del mes en que se gozó
      note: String(data.note || '').trim(),
    };
    all.push(rec);
    storeWrite(K, all);
    return rec;
  },

  update(id, patch) {
    const all = storeRead(K, []);
    const i = all.findIndex((r) => r.id === id);
    if (i === -1) throw new Error('Registro de vacaciones no encontrado.');
    all[i] = { ...all[i], ...patch, id };
    storeWrite(K, all);
    return all[i];
  },

  remove(id) {
    storeWrite(K, storeRead(K, []).filter((r) => r.id !== id));
  },

  /* ------------------------------- Cálculos ------------------------------ */

  /** Remuneración vacacional diaria = sueldo / 30. */
  dailyRate(baseSalary) {
    return round2(num(baseSalary) / 30);
  },

  /** Días gozados en un período. */
  takenInPeriod(employeeId, period) {
    return round2(
      this.list(employeeId)
        .filter((r) => r.period === period)
        .reduce((s, r) => s + num(r.daysTaken), 0)
    );
  },

  /** Saldo del período: base 30 días, gozados y pendientes. */
  balance(employeeId, period) {
    const taken = this.takenInPeriod(employeeId, period);
    return {
      period,
      base: DIAS_LEGALES,
      taken,
      pending: round2(Math.max(0, DIAS_LEGALES - taken)),
    };
  },

  /** Vacaciones gozadas (días) en un mes concreto. */
  takenInMonth(employeeId, year, month) {
    return round2(
      this.list(employeeId)
        .filter((r) => (r.monthYear ? false : false) || this._inMonth(r, year, month))
        .reduce((s, r) => s + num(r.daysTaken), 0)
    );
  },

  _inMonth(rec, year, month) {
    if (rec.monthYear) {
      return rec.monthYear === `${year}-${String(month).padStart(2, '0')}`;
    }
    return dateInMonth(rec.dateFrom, year, month) || dateInMonth(rec.dateTo, year, month);
  },
};
