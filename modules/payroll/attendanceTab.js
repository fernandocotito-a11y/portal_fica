/* ============================================================================
   attendanceTab.js — Vista "Asistencias y Tardanzas"
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { attendanceService, ATTENDANCE_TYPES } from './attendanceService.js';
import { MESES } from './payrollConfig.js';
import { money, fmtDate, dateInMonth } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const YEAR = new Date().getFullYear();
const YEARS = [YEAR - 1, YEAR, YEAR + 1];

export function renderAttendanceTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let editingId = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Asistencias y Tardanzas</h3>
          <p class="card__subtitle">Descuento al minuto exacto: sueldo ÷ 30 ÷ 8 ÷ 60.</p>
        </div>
        <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Registrar</button>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:120px;"><label class="form-label">Año</label>
            <select class="form-input" data-year>${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Mes</label>
            <select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:920px;">
            <thead><tr>
              <th>Fecha</th><th>Empleado</th><th>Entrada</th><th>Salida</th>
              <th style="text-align:right;">Min. tarde</th><th style="text-align:right;">Min. extra</th>
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
            <div class="form-group" style="margin:0;"><label class="form-label">Entrada</label><input class="form-input" type="time" data-entry /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Salida</label><input class="form-input" type="time" data-exit /></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
            <div class="form-group" style="margin:0;"><label class="form-label">Minutos de tardanza</label><input class="form-input" type="number" min="0" data-tardiness value="0" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Minutos extra</label><input class="form-input" type="number" min="0" data-extra value="0" /></div>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-input" data-type>${ATTENDANCE_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="checkbox">
              <input type="checkbox" data-withpay checked />
              <span class="checkbox__box">${ICONS.check}</span>
              <span>Con goce de haber (no descuenta el día)</span>
            </label>
          </div>
        </div>
        <div class="modal__footer">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn--primary" data-submit>Guardar</button>
        </div>
      </form>
    </dialog>
  `;

  const tbody = root.querySelector('[data-tbody]');
  const summary = root.querySelector('[data-summary]');
  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const modal = root.querySelector('[data-modal]');
  const modalTitle = root.querySelector('[data-modal-title]');
  const form = root.querySelector('[data-form]');
  const employeeSel = root.querySelector('[data-employee]');
  const dateI = root.querySelector('[data-date]');
  const entryI = root.querySelector('[data-entry]');
  const exitI = root.querySelector('[data-exit]');
  const tardI = root.querySelector('[data-tardiness]');
  const extraI = root.querySelector('[data-extra]');
  const typeI = root.querySelector('[data-type]');
  const withpayI = root.querySelector('[data-withpay]');

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }

  function fillEmployeeSelect(selected) {
    employeeSel.innerHTML = employees()
      .map((e) => `<option value="${e.id}"${e.id === selected ? ' selected' : ''}>${escapeHtml(e.name)}</option>`)
      .join('');
  }

  function render() {
    const recs = attendanceService.list().filter((r) => dateInMonth(r.date, year, month));
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="empty-state__icon">${ICONS.clock}</span><div class="empty-state__title">Sin registros</div><div class="empty-state__desc">Registra la asistencia del período seleccionado.</div></div></td></tr>`;
      summary.textContent = '';
      return;
    }
    let tMin = 0;
    let discount = 0;
    tbody.innerHTML = recs
      .map((r) => {
        const emp = payrollService.getEmployee(r.employeeId);
        const sal = emp ? emp.baseSalary : 0;
        const d = attendanceService.descuentoTardanza(sal, r.tardinessMinutes);
        const isAbsence = r.type !== 'normal' && r.type !== 'vacaciones';
        const dayDisc = isAbsence && !r.withPay ? attendanceService.descuentoPorDia(sal) : 0;
        const total = Math.round((d + dayDisc) * 100) / 100;
        tMin += r.tardinessMinutes;
        discount += total;
        return `
          <tr>
            <td>${fmtDate(r.date)}</td>
            <td>${escapeHtml(emp ? emp.name : '—')}</td>
            <td>${escapeHtml(r.entry) || '—'}</td>
            <td>${escapeHtml(r.exit) || '—'}</td>
            <td class="cell-num">${r.tardinessMinutes}</td>
            <td class="cell-num">${r.extraMinutes}</td>
            <td>${escapeHtml((ATTENDANCE_TYPES.find((t) => t.value === r.type) || {}).label || r.type)}</td>
            <td>${r.type === 'normal' || r.type === 'vacaciones' ? '—' : r.withPay ? '<span class="chip">Con goce</span>' : '<span class="chip chip--gold">Sin goce</span>'}</td>
            <td class="cell-num">${money(total)}</td>
            <td><div class="table__actions"><button class="icon-btn" data-edit="${escapeHtml(r.id)}" title="Editar">${ICONS.edit}</button><button class="icon-btn icon-btn--danger" data-del="${escapeHtml(r.id)}" title="Eliminar">${ICONS.trash}</button></div></td>
          </tr>`;
      })
      .join('');
    summary.textContent = `Minutos de tardanza: ${tMin} · Descuento total del período: ${money(discount)}`;
  }

  function openCreate() {
    editingId = null;
    modalTitle.textContent = 'Registrar asistencia';
    form.reset();
    fillEmployeeSelect();
    dateI.value = `${year}-${String(month).padStart(2, '0')}-01`;
    tardI.value = 0;
    extraI.value = 0;
    withpayI.checked = true;
    modal.showModal();
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
    modal.showModal();
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); render(); });
  monthSel.addEventListener('change', () => { month = Number(monthSel.value); render(); });
  root.querySelector('[data-add]').addEventListener('click', openCreate);
  root.querySelector('[data-close]').addEventListener('click', () => modal.close());
  root.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
  modal.addEventListener('cancel', (e) => { e.preventDefault(); modal.close(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!employeeSel.value) { showToast('Selecciona un empleado.', 'error'); return; }
    const data = {
      employeeId: employeeSel.value,
      date: dateI.value,
      entry: entryI.value,
      exit: exitI.value,
      tardinessMinutes: tardI.value,
      extraMinutes: extraI.value,
      type: typeI.value,
      withPay: withpayI.checked,
    };
    if (editingId) attendanceService.update(editingId, data);
    else attendanceService.create(data);
    modal.close();
    showToast('Registro guardado.');
    render();
  });

  tbody.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (ed) openEdit(ed.dataset.edit);
    if (del) {
      const ok = await confirmDialog({ title: 'Eliminar registro', message: '¿Eliminar este registro de asistencia?', confirmText: 'Eliminar', danger: true });
      if (ok) { attendanceService.remove(del.dataset.del); showToast('Registro eliminado.'); render(); }
    }
  });

  fillEmployeeSelect();
  render();
}
