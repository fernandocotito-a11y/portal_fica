/* ============================================================================
   scheduleService.js — Horarios de trabajo por rango de fechas
   ----------------------------------------------------------------------------
   Permite configurar la jornada de la empresa (entrada, salida, refrigerio,
   días laborables, tolerancia y redondeo) y mantener un historial de cambios.
   Cada registro rige desde `effective_from` hasta `effective_to` (si es null,
   sigue vigente). El motor de asistencias busca el horario aplicable a la fecha
   del registro para calcular tardanzas y horas extras.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { activeCompanyId } from './payrollScope.js';
import { num, todayIso, hhmmToMinutes, fmtDate, isoWeekday } from './payrollUtils.js';
import { WORK_DAY_LABELS } from './payrollConfig.js';

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
const ROUND_OPTIONS = [1, 5, 10, 15, 30];

let cache = [];
let exceptions = [];

function map(r) {
  return {
    id: r.id,
    companyId: r.company_id,
    effectiveFrom: String(r.effective_from || '').slice(0, 10),
    effectiveTo: String(r.effective_to || '').slice(0, 10),
    entry: String(r.entry_time || '').slice(0, 5),
    exit: String(r.exit_time || '').slice(0, 5),
    breakMinutes: num(r.break_minutes),
    workDays: Array.isArray(r.work_days)
      ? r.work_days.map(Number).filter((d) => d >= 1 && d <= 7)
      : DEFAULT_WORK_DAYS.slice(),
    toleranceMinutes: num(r.tolerance_minutes),
    roundMinutes: ROUND_OPTIONS.includes(num(r.round_minutes)) ? num(r.round_minutes) : 1,
    tardinessEnabled: r.tardiness_enabled !== false,
    overtimeEnabled: r.overtime_enabled !== false,
    note: r.note || '',
  };
}

function mapException(r) {
  return {
    id: r.id,
    companyId: r.company_id,
    date: String(r.date || '').slice(0, 10),
    entry: String(r.entry_time || '').slice(0, 5),
    exit: String(r.exit_time || '').slice(0, 5),
    breakMinutes: num(r.break_minutes),
    noImpact: r.no_impact !== false,
    note: r.note || '',
  };
}

/** Minutos de la jornada (soporta horarios que cruzan medianoche). */
export function shiftMinutes(entry, exit) {
  const a = hhmmToMinutes(entry);
  let b = hhmmToMinutes(exit);
  if (b <= a) b += 24 * 60;
  return b - a;
}

/** ¿Dos rangos de fechas se superponen? `effectiveTo` vacío = indefinido. */
export function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  const aEnd = aTo || '9999-12-31';
  const bEnd = bTo || '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

/** Horario aplicable a una fecha (función pura, fácil de probar). */
export function scheduleForDate(schedules, date) {
  const d = String(date || '').slice(0, 10);
  if (!d) return null;
  const day = isoWeekday(d);
  return (
    (schedules || [])
      .filter(
        (s) =>
          s.effectiveFrom &&
          s.effectiveFrom <= d &&
          (!s.effectiveTo || s.effectiveTo >= d) &&
          (!day || (Array.isArray(s.workDays) ? s.workDays : DEFAULT_WORK_DAYS).includes(day))
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null
  );
}

/** Etiqueta compacta de días laborables. */
export function workDaysLabel(days) {
  const arr = Array.from(new Set((days || []).map(Number).filter((d) => d >= 1 && d <= 7))).sort((a, b) => a - b);
  if (arr.length === 7) return 'Todos los días';
  if (arr.length === 5 && arr.every((d, i) => d === i + 1)) return 'Lun–Vie';
  if (arr.length === 6 && arr[0] === 1 && arr[5] === 6) return 'Lun–Sáb';
  return arr.map((d) => (WORK_DAY_LABELS.find((x) => x.value === d) || {}).label || '').filter(Boolean).join(' ');
}

function validate(data) {
  if (!data.effectiveFrom) throw new Error('La fecha de vigencia inicial es obligatoria.');
  if (data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
    throw new Error('La fecha final no puede ser anterior a la fecha inicial.');
  }
  if (!data.entry || !data.exit) throw new Error('La hora de entrada y salida son obligatorias.');
  const shift = shiftMinutes(data.entry, data.exit);
  if (!(shift > 0)) throw new Error('El horario no es válido.');
  if (num(data.breakMinutes) >= shift) {
    throw new Error('El refrigerio no puede ser mayor o igual a la jornada.');
  }
  if (!Array.isArray(data.workDays) || data.workDays.length === 0) {
    throw new Error('Selecciona al menos un día laborable.');
  }
  if (num(data.toleranceMinutes) < 0) throw new Error('La tolerancia no puede ser negativa.');
  if (!ROUND_OPTIONS.includes(num(data.roundMinutes, 1))) {
    throw new Error('El redondeo debe ser 1, 5, 10, 15 o 30 minutos.');
  }
}

function payload(data) {
  return {
    company_id: activeCompanyId(),
    effective_from: data.effectiveFrom,
    effective_to: data.effectiveTo || null,
    entry_time: data.entry,
    exit_time: data.exit,
    break_minutes: Math.max(0, Math.round(num(data.breakMinutes))),
    work_days: Array.from(new Set((data.workDays || []).map(Number).filter((d) => d >= 1 && d <= 7))).sort((a, b) => a - b),
    tolerance_minutes: Math.max(0, Math.round(num(data.toleranceMinutes))),
    round_minutes: num(data.roundMinutes, 1),
    tardiness_enabled: data.tardinessEnabled !== false,
    overtime_enabled: data.overtimeEnabled !== false,
    note: data.note || null,
  };
}

export const scheduleService = {
  lastError: '',
  exceptionError: '',

  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      exceptions = [];
      this.lastError = '';
      this.exceptionError = '';
      return;
    }
    const [schedulesRes, exceptionsRes] = await Promise.all([
      supabase
        .from('payroll_work_schedules')
        .select('*')
        .eq('company_id', cid)
        .order('effective_from'),
      supabase
        .from('payroll_schedule_exceptions')
        .select('*')
        .eq('company_id', cid)
        .order('date'),
    ]);
    if (schedulesRes.error) {
      cache = [];
      this.lastError = schedulesRes.error.message;
    } else {
      this.lastError = '';
      cache = (schedulesRes.data || []).map(map);
    }
    // La tabla de días especiales puede no existir todavía: no bloqueamos los
    // horarios por eso, solo avisamos en la interfaz.
    if (exceptionsRes.error) {
      exceptions = [];
      this.exceptionError = exceptionsRes.error.message;
    } else {
      this.exceptionError = '';
      exceptions = (exceptionsRes.data || []).map(mapException);
    }
  },

  list() {
    return cache.slice().sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  },

  getById(id) {
    return cache.find((s) => s.id === id) || null;
  },

  /** Excepción configurada para una fecha concreta. */
  exceptionFor(date) {
    const d = String(date || '').slice(0, 10);
    return exceptions.find((x) => x.date === d) || null;
  },

  listExceptions() {
    return exceptions.slice().sort((a, b) => b.date.localeCompare(a.date));
  },

  /**
   * Horario efectivo para una fecha: el horario base más la excepción del día.
   * Con `noImpact` el día se marca como jornada completa y no afecta descuentos
   * ni extras. Sin esa marca, la excepción puede cambiar entrada/salida.
   */
  effectiveFor(date) {
    const base = scheduleForDate(cache, date);
    const ex = this.exceptionFor(date);
    if (!ex) return base;
    if (ex.noImpact) return base ? { ...base, noImpact: true, exception: ex } : null;
    if (!base) return null;
    return {
      ...base,
      entry: ex.entry || base.entry,
      exit: ex.exit || base.exit,
      breakMinutes: ex.breakMinutes,
      exception: ex,
    };
  },

  /** Horario vigente para una fecha (incluye días especiales). */
  scheduleFor(date) {
    return this.effectiveFor(date);
  },

  /** Horario vigente hoy. */
  current() {
    return this.scheduleFor(todayIso());
  },

  /** Próximo cambio programado (para avisar en la interfaz). */
  nextChange() {
    const today = todayIso();
    return (
      cache
        .filter((s) => s.effectiveFrom > today)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] || null
    );
  },

  describe(s) {
    if (!s) return 'Sin horario';
    const range = s.effectiveTo
      ? `${fmtDate(s.effectiveFrom)} – ${fmtDate(s.effectiveTo)}`
      : `Desde ${fmtDate(s.effectiveFrom)}`;
    return `${range} · ${s.entry}–${s.exit} · ${workDaysLabel(s.workDays)} · refrigerio ${s.breakMinutes} min`;
  },

  async create(data) {
    validate(data);
    const from = data.effectiveFrom;
    const to = data.effectiveTo || '';
    const days = Array.from(new Set((data.workDays || []).map(Number)));

    // Varios horarios pueden estar vigentes a la vez siempre que sus días no
    // se solapen (por ejemplo, Lun–Vie y Sáb). Solo chocan rangos que además
    // comparten algún día de la semana.
    const conflict = cache.find(
      (s) =>
        rangesOverlap(from, to, s.effectiveFrom, s.effectiveTo) &&
        days.some((d) => s.workDays.includes(d))
    );
    if (conflict) {
      throw new Error(`Los días se superponen con el horario ${this.describe(conflict)}. Edita ese horario o quita esos días.`);
    }

    const { data: saved, error } = await supabase
      .from('payroll_work_schedules')
      .insert(payload(data))
      .select()
      .single();
    if (error) throw new Error(error.message);
    await this.refresh();
    return map(saved);
  },

  async update(id, patch) {
    const current = this.getById(id);
    if (!current) throw new Error('Horario no encontrado.');
    const merged = { ...current, ...patch };
    validate(merged);

    const days = Array.from(new Set((merged.workDays || []).map(Number)));
    const conflict = cache.find(
      (s) =>
        s.id !== id &&
        rangesOverlap(merged.effectiveFrom, merged.effectiveTo || '', s.effectiveFrom, s.effectiveTo) &&
        days.some((d) => s.workDays.includes(d))
    );
    if (conflict) {
      throw new Error(`Los días se superponen con el horario ${this.describe(conflict)}. Edita ese horario o quita esos días.`);
    }

    const { data: saved, error } = await supabase
      .from('payroll_work_schedules')
      .update(payload(merged))
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await this.refresh();
    return map(saved);
  },

  async remove(id) {
    const { error } = await supabase.from('payroll_work_schedules').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await this.refresh();
  },

  /* ------------------------ Días especiales ------------------------ */

  async saveException(data) {
    const date = String(data.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('La fecha del día especial es obligatoria.');
    const row = {
      company_id: activeCompanyId(),
      date,
      entry_time: data.entry || null,
      exit_time: data.exit || null,
      break_minutes: Math.max(0, Math.round(num(data.breakMinutes))),
      no_impact: data.noImpact !== false,
      note: data.note || null,
    };
    let query = supabase.from('payroll_schedule_exceptions');
    if (data.id) {
      query = query.update(row).eq('id', data.id);
    } else {
      // Un único día especial por fecha (unique company_id + date).
      query = query.upsert(row, { onConflict: 'company_id,date' });
    }
    const { data: saved, error } = await query.select().single();
    if (error) throw new Error(error.message);
    await this.refresh();
    return mapException(saved);
  },

  async removeException(id) {
    const { error } = await supabase.from('payroll_schedule_exceptions').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await this.refresh();
  },
};
