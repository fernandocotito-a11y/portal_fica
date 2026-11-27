/* ============================================================================
   periodLock.js — Bloqueo global de períodos cerrados de planilla
   ----------------------------------------------------------------------------
   Un mes se considera cerrado cuando `payroll_periods.closed = true`.
   Este módulo es el punto único de consulta para que TODAS las pestañas de
   planilla (bonos, asistencia, vacaciones, pagos, préstamos, etc.) rechacen
   altas, cambios y bajas de un mes cerrado.

   `payrollService` registra la función que lee su caché de períodos; los
   servicios de cada control solo llaman a los `assert*`.
   ========================================================================== */

import { MESES } from './payrollConfig.js';

let closedChecker = () => false;

/** Lo llama payrollService al cargar/refrescar los períodos. */
export function setPeriodClosedChecker(fn) {
  closedChecker = typeof fn === 'function' ? fn : () => false;
}

export function isPeriodLocked(year, month) {
  return !!closedChecker(Number(year), Number(month));
}

export function periodLabel(year, month) {
  const nombre = MESES[Number(month) - 1] || `mes ${month}`;
  return `${nombre} ${year}`;
}

function lockedError(year, month) {
  return new Error(
    `La planilla de ${periodLabel(year, month)} está cerrada. ` +
      'Reábrela en «Planilla Mensual» antes de modificar este mes.'
  );
}

export function assertPeriodOpen(year, month) {
  if (isPeriodLocked(year, month)) throw lockedError(year, month);
}

/** `months = [{ year, month }]`. Se usa para rangos como vacaciones. */
export function assertMonthsOpen(months) {
  (months || []).forEach(({ year, month }) => assertPeriodOpen(year, month));
}

/** Fecha ISO `YYYY-MM-DD` (o `YYYY-MM`). */
export function assertDateOpen(dateISO) {
  const s = String(dateISO || '');
  if (!/^\d{4}-\d{2}/.test(s)) return;
  assertPeriodOpen(Number(s.slice(0, 4)), Number(s.slice(5, 7)));
}

/**
 * Rango de fechas ISO. Si no hay fecha final se evaluúa hasta hoy.
 * Se usa para horarios y para datos del colaborador que afectan meses pasados.
 */
export function assertDateRangeOpen(fromISO, toISO) {
  const from = String(fromISO || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
  const hoy = new Date();
  const todayISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(toISO || '')) ? String(toISO).slice(0, 10) : todayISO;

  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7));
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard++ < 1200) {
    assertPeriodOpen(y, m);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}
