/* ============================================================================
   attendanceService.js — Asistencia, tardanzas, horas extras e inasistencias
   ----------------------------------------------------------------------------
   - Registra entrada/salida reales y calcula automáticamente tardanzas y
     horas extras contra el horario de la empresa vigente para la fecha.
   - Solo la asistencia normal permite marcar entrada/salida. Los demás tipos
     (falta, descanso médico, vacaciones, licencia) se registran como novedad.
   - Horas extras: primeras 2 h con sobretasa 25%; adicionales con 35%
     (D.S. 007-2002-TR / Ley 27671).
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2, dateInMonth, isoWeekday, hhmmToMinutes } from './payrollUtils.js';
import { activeCompanyId } from './payrollScope.js';
import { OVERTIME } from './payrollConfig.js';
import { scheduleService, shiftMinutes } from './scheduleService.js';

let cache = [];

export const ATTENDANCE_TYPES = [
  { value: 'normal', label: 'Asistencia normal' },
  { value: 'falta', label: 'Falta / Inasistencia' },
  { value: 'descanso_medico', label: 'Descanso médico' },
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'licencia', label: 'Licencia' },
];

/** Tipos que representan una ausencia que puede descontar el día. */
export const ABSENCE_TYPES = ['falta', 'descanso_medico', 'licencia'];

function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    date: String(r.date || '').slice(0, 10),
    entry: String(r.entry || '').slice(0, 5),
    exit: String(r.exit_time || '').slice(0, 5),
    tardinessMinutes: num(r.tardiness_minutes),
    extraMinutes: num(r.extra_minutes),
    type: r.type || 'normal',
    withPay: r.with_pay !== false,
    manual: r.manual === true,
    note: r.note || '',
  };
}

export const attendanceService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_attendance').select('*').eq('company_id', cid).order('date');
    cache = (data || []).map(map);
  },

  list(employeeId = null) {
    const all = cache.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return employeeId ? all.filter((r) => r.employeeId === employeeId) : all;
  },
  getById(id) {
    return cache.find((r) => r.id === id) || null;
  },

  /**
   * Normaliza un registro antes de guardarlo:
   *  - Solo `normal` conserva entrada/salida.
   *  - Calcula tardanza/extra automáticamente salvo que `manual` sea true.
   */
  normalize(data) {
    const type = data.type || 'normal';
    const isNormal = type === 'normal';
    const date = data.date || null;
    const entry = isNormal ? String(data.entry || '').slice(0, 5) || null : null;
    const exit = isNormal ? String(data.exit || '').slice(0, 5) || null : null;
    const schedule = date ? scheduleService.scheduleFor(date) : null;
    const auto = this.computeRecord({ type, date, entry, exit, withPay: data.withPay }, schedule, 0);
    const manual = isNormal && data.manual === true;
    return {
      employeeId: data.employeeId,
      date,
      entry,
      exit,
      tardinessMinutes: manual ? Math.max(0, Math.round(num(data.tardinessMinutes))) : auto.tardinessMinutes,
      extraMinutes: manual ? Math.max(0, Math.round(num(data.extraMinutes))) : auto.extraMinutes,
      type,
      withPay: isNormal || type === 'vacaciones' ? true : data.withPay !== false,
      manual,
      note: data.note || '',
    };
  },

  async create(data) {
    const n = this.normalize(data);
    const row = {
      company_id: activeCompanyId(),
      employee_id: n.employeeId,
      date: n.date || null,
      entry: n.entry,
      exit_time: n.exit,
      tardiness_minutes: n.tardinessMinutes,
      extra_minutes: n.extraMinutes,
      type: n.type,
      with_pay: n.withPay,
      manual: n.manual,
      note: n.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_attendance').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.push(rec);
    return rec;
  },

  async update(id, patch) {
    const merged = { ...(this.getById(id) || {}), ...patch };
    const n = this.normalize(merged);
    const row = {
      employee_id: n.employeeId || null,
      date: n.date || null,
      entry: n.entry,
      exit_time: n.exit,
      tardiness_minutes: n.tardinessMinutes,
      extra_minutes: n.extraMinutes,
      type: n.type,
      with_pay: n.withPay,
      manual: n.manual,
      note: n.note || null,
    };
    const { data: saved, error } = await supabase.from('payroll_attendance').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    const i = cache.findIndex((r) => r.id === id);
    if (i >= 0) cache[i] = rec;
    return rec;
  },

  async remove(id) {
    const { error } = await supabase.from('payroll_attendance').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((r) => r.id !== id);
  },

  /* ------------------------------- Cálculos ------------------------------ */
  descuentoPorMinuto(baseSalary, dailyHours = 8) {
    return num(baseSalary) / 30 / num(dailyHours, 8) / 60;
  },
  descuentoTardanza(baseSalary, minutos, dailyHours = 8) {
    return round2(this.descuentoPorMinuto(baseSalary, dailyHours) * num(minutos));
  },
  descuentoPorDia(baseSalary) {
    return round2(num(baseSalary) / 30);
  },

  /**
   * Pago de horas extras con sobretasa legal:
   *   - primeras 2 horas: tarifa hora × 1.25
   *   - horas adicionales: tarifa hora × 1.35
   */
  calcOvertimePay(minutes, baseSalary, scheduledMinutes) {
    const m = Math.max(0, num(minutes));
    const sal = num(baseSalary);
    if (!m || !sal) return 0;
    const dailyHours = num(scheduledMinutes) > 0 ? num(scheduledMinutes) / 60 : 8;
    const hourly = sal / 30 / dailyHours;
    const first = (Math.min(m, OVERTIME.firstTwoMinutes) / 60) * hourly * (1 + OVERTIME.firstTwoSurcharge);
    const rest = (Math.max(0, m - OVERTIME.firstTwoMinutes) / 60) * hourly * (1 + OVERTIME.additionalSurcharge);
    return round2(first + rest);
  },

  /**
   * Calcula los minutos de tardanza/extra y el pago de un registro.
   * @param {Object} r registro (date, entry, exit, type, manual, ...)
   * @param {Object|undefined} schedule horario explícito; undefined = buscar por fecha
   * @param {Number} baseSalary sueldo básico para descuentos y pago de extras
   */
  computeRecord(r, schedule = undefined, baseSalary = 0) {
    const s = schedule === undefined ? (r.date ? scheduleService.scheduleFor(r.date) : null) : schedule;
    const type = r.type || 'normal';
    const isNormal = type === 'normal';
    const isWorkDay = !!(s && r.date && s.workDays.includes(isoWeekday(r.date)));
    const scheduledMinutes = s ? Math.max(0, shiftMinutes(s.entry, s.exit) - num(s.breakMinutes)) : 0;
    const isAbsence = ABSENCE_TYPES.includes(type);
    const absenceDiscount = isAbsence && r.withPay === false ? this.descuentoPorDia(baseSalary) : 0;

    const base = {
      schedule: s,
      isWorkDay,
      scheduledMinutes,
      tardinessMinutes: 0,
      extraMinutes: 0,
      workedMinutes: 0,
      overtimePay: 0,
      tardinessDiscount: 0,
      absenceDiscount,
      reason: '',
    };

    if (!isNormal) return { ...base, reason: 'tipo' };

    // Ajuste manual: se respetan los minutos ingresados, incluso si no hay
    // horario o si la fecha no es laborable. El pago de extras usa la jornada
    // del horario (u 8 h si no hay horario).
    if (r.manual) {
      const tardiness = Math.max(0, Math.round(num(r.tardinessMinutes)));
      const extra = Math.max(0, Math.round(num(r.extraMinutes)));
      const dailyHours = scheduledMinutes > 0 ? scheduledMinutes / 60 : 8;
      return {
        ...base,
        tardinessMinutes: tardiness,
        extraMinutes: extra,
        overtimePay: this.calcOvertimePay(extra, baseSalary, scheduledMinutes),
        tardinessDiscount: round2(this.descuentoPorMinuto(baseSalary, dailyHours) * tardiness),
        reason: 'manual',
      };
    }

    if (!s) return { ...base, reason: 'sin_horario' };
    if (!isWorkDay) return { ...base, reason: 'no_laborable' };
    if (!r.entry || !r.exit) return { ...base, reason: 'sin_marcas' };

    let entry = hhmmToMinutes(r.entry);
    let exit = hhmmToMinutes(r.exit);
    if (exit <= entry) exit += 24 * 60;

    const schedEntry = hhmmToMinutes(s.entry);
    const schedExit = schedEntry + shiftMinutes(s.entry, s.exit);

    // Horario nocturno: si la marcación real cae después de medianoche, se
    // desplaza al mismo día lógico del horario.
    if (schedEntry >= 12 * 60 && entry < 12 * 60) {
      entry += 24 * 60;
      exit += 24 * 60;
    }

    const tardiness = s.tardinessEnabled
      ? Math.min(scheduledMinutes, Math.max(0, entry - schedEntry - num(s.toleranceMinutes)))
      : 0;
    const overtimeStart = Math.max(schedExit, entry + scheduledMinutes + num(s.breakMinutes));
    let extra = s.overtimeEnabled ? Math.max(0, exit - overtimeStart) : 0;
    if (num(s.roundMinutes) > 1) {
      extra = Math.round(extra / num(s.roundMinutes)) * num(s.roundMinutes);
    }

    const workedMinutes = Math.max(0, exit - entry - num(s.breakMinutes));
    const dailyHours = scheduledMinutes > 0 ? scheduledMinutes / 60 : 8;
    const tardinessDiscount = round2(this.descuentoPorMinuto(baseSalary, dailyHours) * tardiness);
    const overtimePay = this.calcOvertimePay(extra, baseSalary, scheduledMinutes);

    return {
      ...base,
      tardinessMinutes: tardiness,
      extraMinutes: extra,
      workedMinutes,
      overtimePay,
      tardinessDiscount,
      reason: 'ok',
    };
  },

  summarize(employeeId, year, month, baseSalary) {
    const recs = this.list(employeeId).filter((r) => dateInMonth(r.date, year, month));
    let tardinessMinutes = 0;
    let extraMinutes = 0;
    let overtimePay = 0;
    let tardinessDiscount = 0;
    let absentWithPay = 0;
    let absentWithoutPay = 0;

    recs.forEach((r) => {
      const c = this.computeRecord(r, undefined, baseSalary);
      tardinessMinutes += c.tardinessMinutes;
      extraMinutes += c.extraMinutes;
      overtimePay = round2(overtimePay + c.overtimePay);
      tardinessDiscount = round2(tardinessDiscount + c.tardinessDiscount);
      if (ABSENCE_TYPES.includes(r.type)) {
        if (r.withPay) absentWithPay += 1;
        else absentWithoutPay += 1;
      }
    });

    const absenceDiscount = round2(this.descuentoPorDia(baseSalary) * absentWithoutPay);
    return {
      records: recs,
      tardinessMinutes,
      extraMinutes,
      overtimePay,
      absentWithPay,
      absentWithoutPay,
      tardinessDiscount,
      absenceDiscount,
      totalDiscount: round2(tardinessDiscount + absenceDiscount),
    };
  },
};
