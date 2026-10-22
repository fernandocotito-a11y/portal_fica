/* ============================================================================
   loansTab.js — Préstamos con cuotas (agregar/editar/eliminar y cronograma)
   ----------------------------------------------------------------------------
   El préstamo se define con monto total, n° de cuotas y primera cuota. La
   cuota se descuenta automáticamente cada mes en la planilla (columna
   "Prést./Adel."), sin tener que registrarla a mano mes a mes.
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { loanService } from './loanService.js';
import { MESES } from './payrollConfig.js';
import { money, num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

export function renderLoansTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let editingId = null;
  let scheduleLoanId = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Préstamos</h3>
          <p class="card__subtitle">Monto total y n° de cuotas. La cuota se descuenta automáticamente cada mes en la planilla.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-2);">
          <div class="form-group" style="margin:0;min-width:200px;">
            <label class="form-label">Colaborador</label>
            <select class="form-input" data-emp></select>
          </div>
          <div class="form-group" style="margin:0;min-width:190px;">
            <label class="form-label">Descripción</label>
            <input class="form-input" data-desc placeholder="Ej. Préstamo personal" />
          </div>
          <div class="form-group" style="margin:0;min-width:130px;">
            <label class="form-label">Monto total (S/)</label>
            <input class="form-input" type="number" min="0" step="0.01" value="0" data-monto />
          </div>
          <div class="form-group" style="margin:0;min-width:100px;">
            <label class="form-label">N° cuotas</label>
            <input class="form-input" type="number" min="1" step="1" value="1" data-cuotas />
          </div>
          <div class="form-group" style="margin:0;min-width:100px;">
            <label class="form-label">Año inicio</label>
            <input class="form-input" type="number" value="${year}" data-year />
          </div>
          <div class="form-group" style="margin:0;min-width:130px;">
            <label class="form-label">Mes inicio</label>
            <select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select>
          </div>
          <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Registrar</button>
          <button type="button" class="btn" data-cancel hidden>Cancelar</button>
        </div>
        <p class="text-muted" style="font-size:var(--font-size-sm);margin:0 0 var(--space-4);" data-preview></p>

        <div class="table-wrap">
          <table class="table" style="min-width:1040px;">
            <thead><tr>
              <th>Colaborador</th>
              <th>Descripción</th>
              <th style="text-align:right;">Monto</th>
              <th style="text-align:center;">Cuotas</th>
              <th style="text-align:right;">Cuota mensual</th>
              <th>Inicio</th>
              <th style="text-align:center;">Aplicadas</th>
              <th style="text-align:right;">Saldo</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
        <div data-schedule style="margin-top:var(--space-4);"></div>
      </div>
    </div>`;

  const empSel = root.querySelector('[data-emp]');
  const descI = root.querySelector('[data-desc]');
  const montoI = root.querySelector('[data-monto]');
  const cuotasI = root.querySelector('[data-cuotas]');
  const yearI = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const previewEl = root.querySelector('[data-preview]');
  const tbody = root.querySelector('[data-tbody]');
  const scheduleEl = root.querySelector('[data-schedule]');
  const addBtn = root.querySelector('[data-add]');
  const cancelBtn = root.querySelector('[data-cancel]');

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }
  /** Incluye al colaborador del préstamo que se edita aunque esté inactivo. */
  function fillEmployees(includeId = null) {
    const list = payrollService.listEmployees().filter((e) => e.active !== false || e.id === includeId);
    empSel.innerHTML = list
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.active === false ? ' (inactivo)' : ''}</option>`)
      .join('');
  }

  function cuotaPreview() {
    const monto = num(montoI.value);
    const n = Math.max(1, Math.round(num(cuotasI.value, 1)));
    return n > 0 ? monto / n : 0;
  }

  function updatePreview() {
    const n = Math.max(1, Math.round(num(cuotasI.value, 1)));
    const cuota = cuotaPreview();
    const inicio = `${MESES[Math.max(1, Math.min(12, num(monthSel.value, 1))) - 1]} ${num(yearI.value)}`;
    previewEl.textContent = num(montoI.value) > 0
      ? `Cuota mensual: ${money(cuota)} × ${n} cuota(s), desde ${inicio}. El sistema la descuenta sola cada mes.`
      : 'Ingresa el monto y el n° de cuotas para ver la cuota mensual.';
  }

  function resetForm() {
    editingId = null;
    addBtn.innerHTML = `${ICONS.plus} Registrar`;
    cancelBtn.hidden = true;
    descI.value = '';
    montoI.value = '0';
    cuotasI.value = '1';
    yearI.value = year;
    monthSel.value = String(month);
    updatePreview();
  }

  function startEdit(id) {
    const l = loanService.getById(id);
    if (!l) return;
    editingId = id;
    addBtn.innerHTML = `${ICONS.check} Guardar cambios`;
    cancelBtn.hidden = false;
    fillEmployees(l.employeeId);
    empSel.value = l.employeeId;
    descI.value = l.descripcion || '';
    montoI.value = l.monto;
    cuotasI.value = l.nCuotas;
    yearI.value = l.startYear;
    monthSel.value = String(l.startMonth);
    updatePreview();
    root.querySelector('.card__body').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function estadoLabel(l, p) {
    const idxStart = l.startYear * 12 + (l.startMonth - 1);
    const idxHoy = now.getFullYear() * 12 + now.getMonth();
    if (idxStart > idxHoy && p.aplicadas === 0) return 'Programado';
    if (p.saldo > 0) return 'Activo';
    return 'Cancelado';
  }

  function renderSchedule() {
    const l = loanService.getById(scheduleLoanId);
    if (!l) {
      scheduleEl.innerHTML = '';
      return;
    }
    const emp = payrollService.getEmployee(l.employeeId);
    const p = loanService.progress(l);
    const rows = loanService
      .schedule(l)
      .map(
        (c) => `<tr>
          <td class="cell-num">${c.n}</td>
          <td>${MESES[c.month - 1]} ${c.year}</td>
          <td class="cell-num">${money(c.monto)}</td>
          <td>${c.aplicada ? 'Aplicada' : 'Programada'}</td>
        </tr>`
      )
      .join('');
    scheduleEl.innerHTML = `
      <h4 style="margin:0 0 var(--space-2);font-size:var(--font-size-md);">Cronograma · ${escapeHtml(emp ? emp.name : '—')}${l.descripcion ? ' · ' + escapeHtml(l.descripcion) : ''}</h4>
      <p class="text-muted" style="font-size:var(--font-size-sm);margin:0 0 var(--space-2);">${p.aplicadas} de ${p.total} cuota(s) aplicadas · Aplicado ${money(p.aplicado)} · Saldo ${money(p.saldo)}.</p>
      <div class="table-wrap">
        <table class="table" style="min-width:420px;">
          <thead><tr><th style="text-align:right;">Cuota</th><th>Mes</th><th style="text-align:right;">Monto</th><th>Estado</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function render() {
    fillEmployees(empSel.value || null);

    const recs = loanService.list();
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin préstamos registrados.</div></div></td></tr>`;
      scheduleEl.innerHTML = '';
      return;
    }

    tbody.innerHTML = recs
      .map((l) => {
        const emp = payrollService.getEmployee(l.employeeId);
        const p = loanService.progress(l);
        const estado = estadoLabel(l, p);
        return `<tr>
          <td>${escapeHtml(emp ? emp.name : '—')}</td>
          <td>${escapeHtml(l.descripcion) || '—'}</td>
          <td class="cell-num">${money(l.monto)}</td>
          <td class="cell-num" style="text-align:center;">${l.nCuotas}</td>
          <td class="cell-num">${money(p.cuota)}</td>
          <td>${MESES[l.startMonth - 1]} ${l.startYear}</td>
          <td class="cell-num" style="text-align:center;">${p.aplicadas}/${p.total}</td>
          <td class="cell-num cell-strong">${money(p.saldo)}</td>
          <td>${estado}</td>
          <td><div class="table__actions">
            <button class="icon-btn" data-sched="${escapeHtml(l.id)}" title="Ver cuotas">${ICONS.list || ICONS.arrowRight}</button>
            <button class="icon-btn" data-edit="${escapeHtml(l.id)}" title="Editar">${ICONS.edit}</button>
            <button class="icon-btn icon-btn--danger" data-del="${escapeHtml(l.id)}" title="Eliminar">${ICONS.trash}</button>
          </div></td>
        </tr>`;
      })
      .join('');

    renderSchedule();
  }

  montoI.addEventListener('input', updatePreview);
  cuotasI.addEventListener('input', updatePreview);
  yearI.addEventListener('input', updatePreview);
  monthSel.addEventListener('change', updatePreview);
  cancelBtn.addEventListener('click', resetForm);

  addBtn.addEventListener('click', async () => {
    if (!empSel.value) { showToast('Selecciona un colaborador.', 'error'); return; }
    const monto = num(montoI.value);
    const n = Math.round(num(cuotasI.value, 1));
    const y = num(yearI.value);
    const m = num(monthSel.value);
    if (monto <= 0) { showToast('Ingresa un monto válido.', 'error'); return; }
    if (n < 1) { showToast('El n° de cuotas debe ser al menos 1.', 'error'); return; }
    if (y < 2000 || y > 2100) { showToast('Ingresa un año válido.', 'error'); return; }
    if (m < 1 || m > 12) { showToast('Ingresa un mes válido.', 'error'); return; }

    const data = {
      employeeId: empSel.value,
      descripcion: descI.value.trim(),
      monto,
      nCuotas: n,
      startYear: y,
      startMonth: m,
    };
    try {
      if (editingId) {
        await loanService.update(editingId, data);
        showToast('Préstamo actualizado.');
      } else {
        await loanService.create(data);
        showToast('Préstamo registrado. La cuota se descontará automáticamente en la planilla.');
      }
      resetForm();
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  tbody.addEventListener('click', async (e) => {
    const schedBtn = e.target.closest('[data-sched]');
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');

    if (schedBtn) {
      scheduleLoanId = scheduleLoanId === schedBtn.dataset.sched ? null : schedBtn.dataset.sched;
      renderSchedule();
      return;
    }
    if (editBtn) { startEdit(editBtn.dataset.edit); return; }
    if (delBtn) {
      const l = loanService.getById(delBtn.dataset.del);
      const emp = l ? payrollService.getEmployee(l.employeeId) : null;
      const ok = await confirmDialog({
        title: 'Eliminar préstamo',
        message: `¿Eliminar el préstamo${emp ? ' de ' + emp.name : ''}? Dejará de descontarse en la planilla.`,
        confirmText: 'Eliminar',
        danger: true,
      });
      if (!ok) return;
      try {
        await loanService.remove(delBtn.dataset.del);
        if (scheduleLoanId === delBtn.dataset.del) scheduleLoanId = null;
        if (editingId === delBtn.dataset.del) resetForm();
        showToast('Préstamo eliminado.');
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  render();
  resetForm();
}
