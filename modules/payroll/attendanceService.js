/* ============================================================================
   attendanceService.js — Control de asistencia, tardanzas e inasistencias
   ----------------------------------------------------------------------------
   - Registro diario: entrada, salida, minutos de tardanza y minutos extra.
   - Regla de descuento por tardanza (al minuto exacto):
       descuento_minuto = sueldo_basico / 30 / 8 / 60
       total_descuento  = minutos_tarde * descuento_minuto
   - Inasistencias y descansos médicos: "con goce" (no descuenta) o
     "sin goce" (descuenta día efectivo: sueldo_basico / 30 por día).
   ========================================================================== */

import { num, round2, uuid, storeRead, storeWrite, dateInMonth } from './payrollUtils.js';

const K = 'fica.payroll.attendance';

export const ATTENDANCE_TYPES = [
  { value: 'normal', label: 'Asistencia normal' },
  { value: 'falta', label: 'Falta / Inasistencia' },
  { value: 'descanso_medico', label: 'Descanso médico' },
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'licencia', label: 'Licencia' },
];

export const attendanceService = {
  list(employeeId = null) {
    const all = storeRead(K, []);
    return (employeeId ? all.filter((r) => r.employeeId === employeeId) : all.slice()).sort(
      (a, b) => (a.date || '').localeCompare(b.date || '')
    );
  },

  getById(id) {
    return storeRead(K, []).find((r) => r.id === id) || null;
  },

  create(data) {
    const all = storeRead(K, []);
    const rec = {
      id: uuid(),
      employeeId: data.employeeId,
      date: data.date || '',
      entry: data.entry || '',
      exit: data.exit || '',
      tardinessMinutes: Math.max(0, Math.round(num(data.tardinessMinutes))),
      extraMinutes: Math.max(0, Math.round(num(data.extraMinutes))),
      type: data.type || 'normal',
      withPay: data.withPay !== false,
      note: String(data.note || '').trim(),
    };
    all.push(rec);
    storeWrite(K, all);
    return rec;
  },

  update(id, patch) {
    const all = storeRead(K, []);
    const i = all.findIndex((r) => r.id === id);
    if (i === -1) throw new Error('Registro no encontrado.');
    all[i] = { ...all[i], ...patch, id };
    storeWrite(K, all);
    return all[i];
  },

  remove(id) {
    storeWrite(K, storeRead(K, []).filter((r) => r.id !== id));
  },

  /* ------------------------------- Cálculos ------------------------------ */

  /** Descuento por minuto de tardanza: sueldo / 30 / 8 / 60. */
  descuentoPorMinuto(baseSalary) {
    return round2(num(baseSalary) / 30 / 8 / 60);
  },

  /** Descuento total por minutos de tardanza. */
  descuentoTardanza(baseSalary, minutos) {
    return round2(this.descuentoPorMinuto(baseSalary) * num(minutos));
  },

  /** Descuento por día no laborado (sin goce): sueldo / 30. */
  descuentoPorDia(baseSalary) {
    return round2(num(baseSalary) / 30);
  },

  /**
   * Resumen del empleado en un mes: tardanzas, faltas con/sin goce y descuentos.
   */
  summarize(employeeId, year, month, baseSalary) {
    const recs = this.list(employeeId).filter((r) => dateInMonth(r.date, year, month));
    let tardinessMinutes = 0;
    let extraMinutes = 0;
    let absentWithPay = 0;
    let absentWithoutPay = 0;

    recs.forEach((r) => {
      tardinessMinutes += num(r.tardinessMinutes);
      extraMinutes += num(r.extraMinutes);
      if (r.type === 'falta' || r.type === 'descanso_medico' || r.type === 'licencia') {
        if (r.withPay) absentWithPay += 1;
        else absentWithoutPay += 1;
      }
    });

    const tardinessDiscount = this.descuentoTardanza(baseSalary, tardinessMinutes);
    const absenceDiscount = round2(this.descuentoPorDia(baseSalary) * absentWithoutPay);

    return {
      records: recs,
      tardinessMinutes,
      extraMinutes,
      absentWithPay,
      absentWithoutPay,
      tardinessDiscount,
      absenceDiscount,
      totalDiscount: round2(tardinessDiscount + absenceDiscount),
    };
  },
};
