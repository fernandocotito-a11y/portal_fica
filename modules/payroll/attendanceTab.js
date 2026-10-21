/* ============================================================================
   attendanceTab.js — Vista "Asistencias y Tardanzas"
   ----------------------------------------------------------------------------
   - Registro con fecha de hoy por defecto.
   - Entrada/salida solo para asistencia normal; los demás tipos las desactivan.
   - Cálculo automático de tardanzas y horas extras contra el horario vigente.
   - Configuración de horarios por rango de fechas, tolerancia, refrigerio,
     redondeo y activación/desactivación de cada cálculo.
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { attendanceService, ATTENDANCE_TYPES, ABSENCE_TYPES } from './attendanceService.js';
import { scheduleService, workDaysLabel } from './scheduleService.js';
import { MESES, WORK_DAY_LABELS } from './payrollConfig.js';
import { money, fmtDate, dateInMonth, todayIso, isoWeekday, formatDuration, round2, addDaysIso } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const YEAR = new Date().getFullYear();
const YEARS = [YEAR - 1, YEAR, YEAR + 1];

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function typeLabel(value) {
  return (ATTENDANCE_TYPES.find((t) => t.value === value) || {}).label || value || '—';
}

function salaryOf(emp) {
  return emp ? Number(emp.baseSalary) || 0 : 0;
}

export function renderAttendanceTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let editingId = null;
  let editingScheduleId = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Asistencias y Tardanzas</h3>
          <p class="card__subtitle">Marca la entrada y salida reales; el sistema calcula tardanzas y horas extras según el horario vigente.</p>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          <button type="button" class="btn" data-schedule-btn>${ICONS.clock} Horario</button>
          <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Registrar</button>
        </div>
      </div>
      <div class="card__body">
        <div data-schedule-banner style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface-alt);margin-bottom:var(--space-4);"></div>
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:120px;"><label class="form-label">Año</label>
            <select class="form-input" data-year>${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Mes</label>
            <select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:1120px;">
            <thead><tr>
              <th>Fecha</th><th>Empleado</th><th>Entrada</th><th>Salida</th>
              <th style="text-align:right;">Min. tarde</th><th style="text-align:right;">Min. extra</th>
              <th style="text-align:right;">Pago extra</th>
              <th>Tipo</th><th>Goce de haber</th><th style="text-align:right;">Descuento</th><th></th>
            </tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
        <div data-summary class="text-muted" style="font-size:var(--font-size-sm);margin-top:var(--space-3);"></div>
      </div>
    </div>

    <dialog class="modal" data-modal>
      <form data-form novalidate>
        <div class="modal__header">
          <h3 class="modal__title" data-modal-title>Registrar asistencia</h3>
          <button type="button" class="modal__close" data-close aria-label="Cerrar">${ICONS.close}</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label class="form-label">Empleado <span class="req">*</span></label>
            <select class="form-input" data-employee></select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3);">
            <div class="form-group" style="margin:0;"><label class="form-label">Fecha</label><input class="form-input" type="date" data-date /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Entrada</label>
              <div style="display:flex;gap:var(--space-1);"><input class="form-input" type="time" data-entry /><button type="button" class="btn btn--sm btn--ghost" data-now-entry>Ahora</button></div>
            </div>
            <div class="form-group" style="margin:0;"><label class="form-label">Salida</label>
              <div style="display:flex;gap:var(--space-1);"><input class="form-input" type="time" data-exit /><button type="button" class="btn btn--sm btn--ghost" data-now-exit>Ahora</button></div>
            </div>
          </div>
          <div class="form-hint" data-schedule-hint style="margin-top:calc(var(--space-2) * -1);margin-bottom:var(--space-3);"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
            <div class="form-group" style="margin:0;"><label class="form-label">Minutos de tardanza</label><input class="form-input" type="number" min="0" data-tardiness value="0" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Minutos extra</label><input class="form-input" type="number" min="0" data-extra value="0" /><div class="form-hint" data-extra-pay></div></div>
          </div>
          <div class="form-group">
            <label class="checkbox"><input type="checkbox" data-manual /><span class="checkbox__box">${ICONS.check}</span><span>Ajuste manual de minutos (si no, se calculan solos)</span></label>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-input" data-type>${ATTENDANCE_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
            <div class="form-hint" data-type-hint></div>
          </div>
          <div class="form-group">
            <label class="checkbox"><input type="checkbox" data-withpay checked /><span class="checkbox__box">${ICONS.check}</span><span>Con goce de haber (no descuenta el día)</span></label>
          </div>
          <div class="form-group" style="margin-bottom:0;"><label class="form-label">Nota</label><input class="form-input" data-note placeholder="Opcional" /></div>
        </div>
        <div class="modal__footer">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn--primary" data-submit>Guardar</button>
        </div>
      </form>
    </dialog>

    <dialog class="modal" data-schedule-modal>
      <div class="modal__header">
        <div>
          <h3 class="modal__title">Horario de trabajo</h3>
          <p class="text-muted" style="margin:0;font-size:var(--font-size-sm);">El horario se aplica por rango de fechas a todos los colaboradores de la empresa.</p>
        </div>
        <button type="button" class="modal__close" data-sched-close aria-label="Cerrar">${ICONS.close}</button>
      </div>
      <div class="modal__body">
        <div style="display:flex;justify-content:space-between;gap:var(--space-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-3);">
          <p class="text-muted" style="margin:0;font-size:var(--font-size-sm);">Puedes crear un nuevo horario cuando cambie la jornada; el anterior se cierra automáticamente el día anterior.</p>
          <button type="button" class="btn btn--sm" data-sched-new>${ICONS.plus} Nuevo horario</button>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:820px;">
            <thead><tr><th>Vigencia</th><th>Horario</th><th>Días</th><th>Refrigerio</th><th>Tolerancia</th><th>Cálculos</th><th></th></tr></thead>
            <tbody data-sched-list></tbody>
          </table>
        </div>

        <form data-sched-form novalidate style="margin-top:var(--space-4);border-top:1px solid var(--color-border);padding-top:var(--space-4);">
          <h4 style="margin:0 0 var(--space-3);font-size:var(--font-size-md);" data-sched-form-title>Nuevo horario</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
            <div class="form-group"><label class="form-label">Vigente desde <span class="req">*</span></label><input class="form-input" type="date" data-sched-from /></div>
            <div class="form-group"><label class="form-label">Vigente hasta (opcional)</label><input class="form-input" type="date" data-sched-to /></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3);">
            <div class="form-group"><label class="form-label">Entrada <span class="req">*</span></label><input class="form-input" type="time" data-sched-entry /></div>
            <div class="form-group"><label class="form-label">Salida <span class="req">*</span></label><input class="form-input" type="time" data-sched-exit /></div>
            <div class="form-group"><label class="form-label">Refrigerio (min)</label><input class="form-input" type="number" min="0" step="5" data-sched-break value="60" /></div>
          </div>
          <div class="form-group">
            <label class="form-label">Días laborables</label>
            <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;" data-sched-days>
              ${WORK_DAY_LABELS.map((d) => `<label class="checkbox"><input type="checkbox" value="${d.value}"${d.value <= 5 ? ' checked' : ''} /><span class="checkbox__box">${ICONS.check}</span><span>${d.label}</span></label>`).join('')}
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
            <div class="form-group"><label class="form-label">Tolerancia (min)</label><input class="form-input" type="number" min="0" data-sched-tolerance value="0" /></div>
            <div class="form-group"><label class="form-label">Redondeo de extras</label>
              <select class="form-input" data-sched-round>
                <option value="1">1 min (exacto)</option>
                <option value="5">5 min</option>
                <option value="10">10 min</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;margin-bottom:var(--space-3);">
            <label class="checkbox"><input type="checkbox" data-sched-tardiness checked /><span class="checkbox__box">${ICONS.check}</span><span>Descontar tardanzas</span></label>
            <label class="checkbox"><input type="checkbox" data-sched-overtime checked /><span class="checkbox__box">${ICONS.check}</span><span>Calcular horas extras</span></label>
          </div>
          <div class="form-group"><label class="form-label">Nota</label><input class="form-input" data-sched-note placeholder="Ej. horario de verano" /></div>
          <div style="display:flex;justify-content:flex-end;gap:var(--space-2);flex-wrap:wrap;">
            <button type="button" class="btn" data-sched-reset>Limpiar</button>
            <button type="submit" class="btn btn--primary" data-sched-submit>Guardar horario</button>
          </div>
        </form>
      </div>
    </dialog>
  `;

  const tbody = root.querySelector('[data-tbody]');
  const summary = root.querySelector('[data-summary]');
  const banner = root.querySelector('[data-schedule-banner]');
  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const modal = root.querySelector('[data-modal]');
  const modalTitle = root.querySelector('[data-modal-title]');
  const form = root.querySelector('[data-form]');
  const employeeSel = root.querySelector('[data-employee]');
  const dateI = root.querySelector('[data-date]');
  const entryI = root.querySelector('[data-entry]');
  const exitI = root.querySelector('[data-exit]');
  const nowEntryBtn = root.querySelector('[data-now-entry]');
  const nowExitBtn = root.querySelector('[data-now-exit]');
  const tardI = root.querySelector('[data-tardiness]');
  const extraI = root.querySelector('[data-extra]');
  const manualI = root.querySelector('[data-manual]');
  const typeI = root.querySelector('[data-type]');
  const withpayI = root.querySelector('[data-withpay]');
  const noteI = root.querySelector('[data-note]');
  const scheduleHint = root.querySelector('[data-schedule-hint]');
  const extraPayHint = root.querySelector('[data-extra-pay]');
  const typeHint = root.querySelector('[data-type-hint]');

  const scheduleModal = root.querySelector('[data-schedule-modal]');
  const schedList = root.querySelector('[data-sched-list]');
  const schedForm = root.querySelector('[data-sched-form]');
  const schedFormTitle = root.querySelector('[data-sched-form-title]');
  const schedFrom = root.querySelector('[data-sched-from]');
  const schedTo = root.querySelector('[data-sched-to]');
  const schedEntry = root.querySelector('[data-sched-entry]');
  const schedExit = root.querySelector('[data-sched-exit]');
  const schedBreak = root.querySelector('[data-sched-break]');
  const schedDays = root.querySelector('[data-sched-days]');
  const schedTolerance = root.querySelector('[data-sched-tolerance]');
  const schedRound = root.querySelector('[data-sched-round]');
  const schedTardiness = root.querySelector('[data-sched-tardiness]');
  const schedOvertime = root.querySelector('[data-sched-overtime]');
  const schedNote = root.querySelector('[data-sched-note]');

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }

  function fillEmployeeSelect(selected) {
    const list = employees();
    employeeSel.innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}"${e.id === selected ? ' selected' : ''}>${escapeHtml(e.name)}</option>`).join('')
      : '<option value="">Sin colaboradores</option>';
  }

  function ensureYearOption(y) {
    if (!Array.from(yearSel.options).some((o) => Number(o.value) === y)) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      yearSel.appendChild(opt);
      Array.from(yearSel.options)
        .sort((a, b) => Number(a.value) - Number(b.value))
        .forEach((o) => yearSel.appendChild(o));
    }
  }

  /* ---------------------------- Horario ---------------------------- */
  function renderScheduleBanner() {
    const current = scheduleService.current();
    const next = scheduleService.nextChange();
    if (scheduleService.lastError) {
      banner.innerHTML = `<span class="badge badge--gold">Horario</span>
        <span class="text-muted">No se pudo cargar el horario. Ejecuta el SQL de <code>payroll_work_schedules</code> en Supabase.</span>
        <button type="button" class="btn btn--sm" data-sched-retry>Reintentar</button>`;
      return;
    }
    if (!current) {
      banner.innerHTML = `<span class="badge badge--gold">Horario</span>
        <span class="text-muted">Sin horario configurado. Los cálculos automáticos de tardanzas y horas extras están desactivados.</span>
        <button type="button" class="btn btn--sm" data-schedule-open>Configurar horario</button>`;
      return;
    }
    const nextText = next
      ? `<span class="text-muted" style="font-size:var(--font-size-sm);">Próximo cambio: ${fmtDate(next.effectiveFrom)} → ${escapeHtml(next.entry)}–${escapeHtml(next.exit)}</span>`
      : '';
    banner.innerHTML = `<span class="badge badge--gold">Horario vigente</span>
      <span class="text-muted">${escapeHtml(current.entry)}–${escapeHtml(current.exit)} · ${escapeHtml(workDaysLabel(current.workDays))} · refrigerio ${current.breakMinutes} min · tolerancia ${current.toleranceMinutes} min</span>
      <span class="chip">Tardanzas: ${current.tardinessEnabled ? 'sí' : 'no'}</span>
      <span class="chip">Extras: ${current.overtimeEnabled ? 'sí' : 'no'}</span>
      ${nextText}`;
  }

  function renderScheduleList() {
    if (scheduleService.lastError) {
      schedList.innerHTML = `<tr><td colspan="7" class="text-muted">No se pudo cargar la tabla de horarios. Ejecuta el SQL en Supabase y pulsa Reintentar.</td></tr>`;
      return;
    }
    const list = scheduleService.list();
    if (!list.length) {
      schedList.innerHTML = `<tr><td colspan="7" class="text-muted">Sin horarios configurados. Crea el primero para activar los cálculos automáticos.</td></tr>`;
      return;
    }
    schedList.innerHTML = list
      .map(
        (s) => `<tr>
          <td>${s.effectiveTo ? `${fmtDate(s.effectiveFrom)} – ${fmtDate(s.effectiveTo)}` : `Desde ${fmtDate(s.effectiveFrom)}`}</td>
          <td>${escapeHtml(s.entry)}–${escapeHtml(s.exit)}</td>
          <td>${escapeHtml(workDaysLabel(s.workDays))}</td>
          <td>${s.breakMinutes} min</td>
          <td>${s.toleranceMinutes} min · redondeo ${s.roundMinutes} min</td>
          <td>${s.tardinessEnabled ? '<span class="chip">Tardanzas</span>' : '<span class="chip chip--gold">Sin tardanzas</span>'}
              ${s.overtimeEnabled ? '<span class="chip">Extras</span>' : '<span class="chip chip--gold">Sin extras</span>'}</td>
          <td><div class="table__actions">
            <button type="button" class="icon-btn" data-sched-edit="${escapeHtml(s.id)}" title="Editar">${ICONS.edit}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-sched-del="${escapeHtml(s.id)}" title="Eliminar">${ICONS.trash}</button>
          </div></td>
        </tr>`
      )
      .join('');
  }

  function resetScheduleForm() {
    editingScheduleId = null;
    schedFormTitle.textContent = 'Nuevo horario';
    const current = scheduleService.current() || scheduleService.list()[0] || null;
    const today = todayIso();
    schedFrom.value = current && current.effectiveFrom >= today ? addDaysIso(today, 1) : today;
    schedTo.value = '';
    schedEntry.value = current ? current.entry : '09:00';
    schedExit.value = current ? current.exit : '18:00';
    schedBreak.value = current ? current.breakMinutes : 60;
    schedTolerance.value = current ? current.toleranceMinutes : 0;
    schedRound.value = String(current ? current.roundMinutes : 1);
    schedTardiness.checked = current ? current.tardinessEnabled : true;
    schedOvertime.checked = current ? current.overtimeEnabled : true;
    schedNote.value = '';
    const days = current ? current.workDays : [1, 2, 3, 4, 5];
    schedDays.querySelectorAll('input[type="checkbox"]').forEach((i) => {
      i.checked = days.includes(Number(i.value));
    });
  }

  function openScheduleModal() {
    renderScheduleList();
    resetScheduleForm();
    if (!scheduleModal.open) scheduleModal.showModal();
  }

  function fillScheduleForm(s) {
    editingScheduleId = s.id;
    schedFormTitle.textContent = 'Editar horario';
    schedFrom.value = s.effectiveFrom;
    schedTo.value = s.effectiveTo;
    schedEntry.value = s.entry;
    schedExit.value = s.exit;
    schedBreak.value = s.breakMinutes;
    schedTolerance.value = s.toleranceMinutes;
    schedRound.value = String(s.roundMinutes);
    schedTardiness.checked = s.tardinessEnabled;
    schedOvertime.checked = s.overtimeEnabled;
    schedNote.value = s.note || '';
    schedDays.querySelectorAll('input[type="checkbox"]').forEach((i) => {
      i.checked = s.workDays.includes(Number(i.value));
    });
    schedForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* --------------------------- Asistencia --------------------------- */
  function updateScheduleHint() {
    const s = scheduleService.scheduleFor(dateI.value);
    if (!s) {
      scheduleHint.innerHTML = '<span style="color:var(--color-warning);">Sin horario para esta fecha.</span> Configura el horario para calcular automáticamente.';
      return;
    }
    const wd = isoWeekday(dateI.value);
    const isWork = s.workDays.includes(wd);
    let text = `Horario ${escapeHtml(s.entry)}–${escapeHtml(s.exit)} · ${escapeHtml(workDaysLabel(s.workDays))} · refrigerio ${s.breakMinutes} min · tolerancia ${s.toleranceMinutes} min.`;
    if (!isWork) text += ' <strong>Día no laborable.</strong>';
    if (!s.tardinessEnabled) text += ' Tardanzas desactivadas.';
    if (!s.overtimeEnabled) text += ' Extras desactivados.';
    scheduleHint.innerHTML = text;
  }

  function updateExtraPay() {
    const emp = payrollService.getEmployee(employeeSel.value);
    const s = scheduleService.scheduleFor(dateI.value);
    const c = attendanceService.computeRecord(
      {
        type: 'normal',
        date: dateI.value,
        entry: entryI.value,
        exit: exitI.value,
        manual: true,
        tardinessMinutes: tardI.value,
        extraMinutes: extraI.value,
      },
      s,
      salaryOf(emp)
    );
    extraPayHint.textContent = c.overtimePay > 0 ? `Pago estimado de extras: ${money(c.overtimePay)}` : '';
  }

  function recalcFromTimes() {
    if (typeI.value !== 'normal') return;
    const emp = payrollService.getEmployee(employeeSel.value);
    const s = scheduleService.scheduleFor(dateI.value);
    const c = attendanceService.computeRecord(
      { type: 'normal', date: dateI.value, entry: entryI.value, exit: exitI.value },
      s,
      salaryOf(emp)
    );
    tardI.value = c.tardinessMinutes;
    extraI.value = c.extraMinutes;
    updateExtraPay();
  }

  function updateManualState() {
    const isNormal = typeI.value === 'normal';
    const manual = isNormal && manualI.checked;
    manualI.disabled = !isNormal;
    tardI.readOnly = !manual;
    extraI.readOnly = !manual;
    if (!isNormal) {
      manualI.checked = false;
      tardI.value = 0;
      extraI.value = 0;
      extraPayHint.textContent = '';
      return;
    }
    if (manual) updateExtraPay();
    else recalcFromTimes();
  }

  function updateTypeUI() {
    const isNormal = typeI.value === 'normal';
    entryI.disabled = !isNormal;
    exitI.disabled = !isNormal;
    nowEntryBtn.disabled = !isNormal;
    nowExitBtn.disabled = !isNormal;
    withpayI.disabled = isNormal || typeI.value === 'vacaciones';
    if (withpayI.disabled) withpayI.checked = true;
    if (!isNormal) {
      entryI.value = '';
      exitI.value = '';
    }
    typeHint.textContent = isNormal
      ? 'Marca la entrada y salida reales; el sistema calcula la tardanza y las horas extras.'
      : 'Este tipo no requiere entrada/salida: se registra como novedad (falta, descanso, vacaciones o licencia).';
    updateManualState();
  }

  function render() {
    const recs = attendanceService.list().filter((r) => dateInMonth(r.date, year, month));
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><span class="empty-state__icon">${ICONS.clock}</span><div class="empty-state__title">Sin registros</div><div class="empty-state__desc">Registra la asistencia del período seleccionado.</div></div></td></tr>`;
      summary.textContent = '';
      return;
    }

    let tMin = 0;
    let eMin = 0;
    let otPay = 0;
    let discount = 0;

    tbody.innerHTML = recs
      .map((r) => {
        const emp = payrollService.getEmployee(r.employeeId);
        const sal = salaryOf(emp);
        const c = attendanceService.computeRecord(r, undefined, sal);
        const isAbsence = ABSENCE_TYPES.includes(r.type);
        const dayDisc = isAbsence && !r.withPay ? attendanceService.descuentoPorDia(sal) : 0;
        const total = round2(c.tardinessDiscount + dayDisc);
        const sinHorario = c.reason === 'sin_horario' && r.type === 'normal' && (r.entry || r.exit);
        const manualChip = r.manual ? ' <span class="chip chip--gold">manual</span>' : '';
        tMin += c.tardinessMinutes;
        eMin += c.extraMinutes;
        otPay = round2(otPay + c.overtimePay);
        discount = round2(discount + total);
        return `
          <tr>
            <td>${fmtDate(r.date)}</td>
            <td>${escapeHtml(emp ? emp.name : '—')}</td>
            <td>${r.type === 'normal' ? escapeHtml(r.entry) || '—' : '—'}</td>
            <td>${r.type === 'normal' ? escapeHtml(r.exit) || '—' : '—'}</td>
            <td class="cell-num"${sinHorario ? ' title="Sin horario configurado para esta fecha"' : ''}>${c.tardinessMinutes}${sinHorario ? ' ⚠' : ''}</td>
            <td class="cell-num">${c.extraMinutes}</td>
            <td class="cell-num">${money(c.overtimePay)}</td>
            <td>${escapeHtml(typeLabel(r.type))}${manualChip}</td>
            <td>${r.type === 'normal' || r.type === 'vacaciones' ? '—' : r.withPay ? '<span class="chip">Con goce</span>' : '<span class="chip chip--gold">Sin goce</span>'}</td>
            <td class="cell-num">${money(total)}</td>
            <td><div class="table__actions"><button class="icon-btn" data-edit="${escapeHtml(r.id)}" title="Editar">${ICONS.edit}</button><button class="icon-btn icon-btn--danger" data-del="${escapeHtml(r.id)}" title="Eliminar">${ICONS.trash}</button></div></td>
          </tr>`;
      })
      .join('');

    summary.textContent = `Tardanzas: ${tMin} min · Horas extras: ${formatDuration(eMin)} (${money(otPay)}) · Descuento total del período: ${money(discount)}`;
  }

  function openCreate() {
    editingId = null;
    modalTitle.textContent = 'Registrar asistencia';
    form.reset();
    fillEmployeeSelect();
    dateI.value = todayIso();
    entryI.value = '';
    exitI.value = '';
    tardI.value = 0;
    extraI.value = 0;
    typeI.value = 'normal';
    withpayI.checked = true;
    manualI.checked = false;
    noteI.value = '';
    updateTypeUI();
    updateScheduleHint();
    if (!modal.open) modal.showModal();
  }

  function openEdit(id) {
    const r = attendanceService.getById(id);
    if (!r) return;
    editingId = id;
    modalTitle.textContent = 'Editar asistencia';
    fillEmployeeSelect(r.employeeId);
    dateI.value = r.date || '';
    entryI.value = r.entry || '';
    exitI.value = r.exit || '';
    tardI.value = r.tardinessMinutes;
    extraI.value = r.extraMinutes;
    typeI.value = r.type;
    withpayI.checked = r.withPay !== false;
    manualI.checked = r.manual;
    noteI.value = r.note || '';
    updateTypeUI();
    updateScheduleHint();
    if (!modal.open) modal.showModal();
  }

  /* ------------------------------ Eventos ------------------------------ */
  yearSel.addEventListener('change', () => {
    year = Number(yearSel.value);
    render();
  });
  monthSel.addEventListener('change', () => {
    month = Number(monthSel.value);
    render();
  });
  root.querySelector('[data-add]').addEventListener('click', openCreate);
  root.querySelector('[data-schedule-btn]').addEventListener('click', openScheduleModal);
  root.querySelector('[data-close]').addEventListener('click', () => modal.close());
  root.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
  modal.addEventListener('cancel', (e) => {
    e.preventDefault();
    modal.close();
  });
  root.querySelector('[data-sched-close]').addEventListener('click', () => scheduleModal.close());
  scheduleModal.addEventListener('cancel', (e) => {
    e.preventDefault();
    scheduleModal.close();
  });

  typeI.addEventListener('change', () => {
    updateTypeUI();
    updateScheduleHint();
  });
  manualI.addEventListener('change', updateManualState);
  dateI.addEventListener('change', () => {
    updateScheduleHint();
    if (!manualI.checked) recalcFromTimes();
    else updateExtraPay();
  });
  employeeSel.addEventListener('change', () => {
    updateScheduleHint();
    if (!manualI.checked) recalcFromTimes();
    else updateExtraPay();
  });
  entryI.addEventListener('change', () => {
    if (!manualI.checked) recalcFromTimes();
    else updateExtraPay();
  });
  exitI.addEventListener('change', () => {
    if (!manualI.checked) recalcFromTimes();
    else updateExtraPay();
  });
  tardI.addEventListener('input', updateExtraPay);
  extraI.addEventListener('input', updateExtraPay);
  nowEntryBtn.addEventListener('click', () => {
    entryI.value = nowTime();
    if (!manualI.checked) recalcFromTimes();
    else updateExtraPay();
  });
  nowExitBtn.addEventListener('click', () => {
    exitI.value = nowTime();
    if (!manualI.checked) recalcFromTimes();
    else updateExtraPay();
  });

  banner.addEventListener('click', async (e) => {
    if (e.target.closest('[data-schedule-open]')) openScheduleModal();
    if (e.target.closest('[data-sched-retry]')) {
      await scheduleService.refresh();
      renderScheduleBanner();
      render();
      updateScheduleHint();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!employeeSel.value) {
      showToast('Selecciona un empleado.', 'error');
      return;
    }
    const data = {
      employeeId: employeeSel.value,
      date: dateI.value,
      entry: typeI.value === 'normal' ? entryI.value : '',
      exit: typeI.value === 'normal' ? exitI.value : '',
      tardinessMinutes: tardI.value,
      extraMinutes: extraI.value,
      type: typeI.value,
      withPay: withpayI.checked,
      manual: manualI.checked && typeI.value === 'normal',
      note: noteI.value.trim(),
    };
    try {
      if (editingId) await attendanceService.update(editingId, data);
      else await attendanceService.create(data);
      modal.close();
      showToast('Registro guardado.');
      const [y, m] = String(data.date || '').split('-').map(Number);
      if (y && m) {
        ensureYearOption(y);
        year = y;
        month = m;
        yearSel.value = String(y);
        monthSel.value = String(m);
      }
      render();
      updateScheduleHint();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  tbody.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (ed) openEdit(ed.dataset.edit);
    if (del) {
      const ok = await confirmDialog({ title: 'Eliminar registro', message: '¿Eliminar este registro de asistencia?', confirmText: 'Eliminar', danger: true });
      if (ok) {
        try {
          await attendanceService.remove(del.dataset.del);
          showToast('Registro eliminado.');
        } catch (err) {
          showToast(err.message, 'error');
        }
        render();
      }
    }
  });

  schedList.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-sched-edit]');
    const del = e.target.closest('[data-sched-del]');
    if (ed) {
      const s = scheduleService.getById(ed.dataset.schedEdit);
      if (s) fillScheduleForm(s);
    }
    if (del) {
      const ok = await confirmDialog({ title: 'Eliminar horario', message: '¿Eliminar este horario? Los registros de asistencia se recalcularán con el horario que quede vigente.', confirmText: 'Eliminar', danger: true });
      if (ok) {
        try {
          await scheduleService.remove(del.dataset.schedDel);
          showToast('Horario eliminado.');
          renderScheduleList();
          renderScheduleBanner();
          render();
          updateScheduleHint();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    }
  });

  root.querySelector('[data-sched-new]').addEventListener('click', resetScheduleForm);
  root.querySelector('[data-sched-reset]').addEventListener('click', resetScheduleForm);

  schedForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const workDays = Array.from(schedDays.querySelectorAll('input[type="checkbox"]:checked')).map((i) => Number(i.value));
    const data = {
      effectiveFrom: schedFrom.value,
      effectiveTo: schedTo.value,
      entry: schedEntry.value,
      exit: schedExit.value,
      breakMinutes: schedBreak.value,
      workDays,
      toleranceMinutes: schedTolerance.value,
      roundMinutes: schedRound.value,
      tardinessEnabled: schedTardiness.checked,
      overtimeEnabled: schedOvertime.checked,
      note: schedNote.value.trim(),
    };
    try {
      const saved = editingScheduleId
        ? await scheduleService.update(editingScheduleId, data)
        : await scheduleService.create(data);
      showToast('Horario guardado.');
      renderScheduleList();
      renderScheduleBanner();
      render();
      updateScheduleHint();
      // Dejar el formulario en modo edición del horario guardado para evitar
      // que un segundo "Guardar" cree otro horario sin querer.
      if (saved) fillScheduleForm(saved);
    } catch (err) {
      const msg = /relation|does not exist|schema cache|column/i.test(err.message)
        ? 'Falta crear la tabla/columna de horarios en Supabase. Ejecuta el SQL indicado.'
        : err.message;
      showToast(msg, 'error');
    }
  });

  fillEmployeeSelect();
  renderScheduleBanner();
  render();
}
