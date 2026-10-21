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
import { num, todayIso, addDaysIso, hhmmToMinutes, fmtDate } from './payrollUtils.js';
import { WORK_DAY_LABELS } from './payrollConfig.js';

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
const ROUND_OPTIONS = [1, 5, 10, 15, 30];

let cache = [];

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
  return (
    (schedules || [])
      .filter((s) => s.effectiveFrom && s.effectiveFrom <= d && (!s.effectiveTo || s.effectiveTo >= d))
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

  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      this.lastError = '';
      return;
    }
    const { data, error } = await supabase
      .from('payroll_work_schedules')
      .select('*')
      .eq('company_id', cid)
      .order('effective_from');
    if (error) {
      cache = [];
      this.lastError = error.message;
      return;
    }
    this.lastError = '';
    cache = (data || []).map(map);
  },

  list() {
    return cache.slice().sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  },

  getById(id) {
    return cache.find((s) => s.id === id) || null;
  },

  /** Horario vigente para una fecha. */
  scheduleFor(date) {
    return scheduleForDate(cache, date);
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

    // Si el nuevo horario empieza después de un horario abierto, cerramos el
    // anterior el día anterior para no dejar dos vigencias superpuestas.
    const previous = cache
      .filter((s) => !s.effectiveTo && s.effectiveFrom < from)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

    let closedPrevious = null;
    if (previous) {
      const dayBefore = addDaysIso(from, -1);
      if (dayBefore < previous.effectiveFrom) {
        throw new Error('La nueva vigencia se superpone con el horario existente.');
      }
      await this.update(previous.id, { effectiveTo: dayBefore });
      closedPrevious = previous;
    }

    const conflict = cache.find((s) => rangesOverlap(from, to, s.effectiveFrom, s.effectiveTo));
    if (conflict) {
      if (closedPrevious) await this.update(closedPrevious.id, { effectiveTo: '' });
      throw new Error(`El rango se superpone con el horario ${this.describe(conflict)}.`);
    }

    try {
      const { data: saved, error } = await supabase
        .from('payroll_work_schedules')
        .insert(payload(data))
        .select()
        .single();
      if (error) throw new Error(error.message);
      await this.refresh();
      return map(saved);
    } catch (err) {
      if (closedPrevious) await this.update(closedPrevious.id, { effectiveTo: '' });
      throw err;
    }
  },

  async update(id, patch) {
    const current = this.getById(id);
    if (!current) throw new Error('Horario no encontrado.');
    const merged = { ...current, ...patch };
    validate(merged);

    const conflict = cache.find(
      (s) => s.id !== id && rangesOverlap(merged.effectiveFrom, merged.effectiveTo || '', s.effectiveFrom, s.effectiveTo)
    );
    if (conflict) {
      throw new Error(`El rango se superpone con el horario ${this.describe(conflict)}.`);
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
};
