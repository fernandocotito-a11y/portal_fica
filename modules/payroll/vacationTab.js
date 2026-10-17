/* ============================================================================
   vacationTab.js — Control de vacaciones + reporte por período
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { vacationService, periodOfYear } from './vacationService.js';
import { laborRules } from './payrollConfig.js';
import { money, fmtDate, num } from './payrollUtils.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 2, Y - 1, Y, Y + 1];

export function renderVacationTab(root) {
  const company = authService.activeCompany ? authService.activeCompany() : null;
  const rules = laborRules(company && company.regimen_laboral);
  let year = new Date().getFullYear();
  let editingId = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Control de vacaciones</h3>
          <p class="card__subtitle">Régimen <strong>${escapeHtml(rules.label)}</strong> · base ${rules.vacationDays} días por año.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:200px;"><label class="form-label">Colaborador</label><select class="form-input" data-emp></select></div>
          <div class="form-group" style="margin:0;min-width:130px;"><label class="form-label">Período</label><input class="form-input" data-period placeholder="2025-2026" value="${periodOfYear(year - 1)}" /></div>
          <div class="form-group" style="margin:0;min-width:110px;"><label class="form-label">Días gozados</label><input class="form-input" type="number" min="0" step="0.5" value="0" data-days /></div>
          <div class="form-group" style="margin:0;min-width:140px;"><label class="form-label">Desde</label><input class="form-input" type="date" data-from /></div>
          <div class="form-group" style="margin:0;min-width:140px;"><label class="form-label">Hasta</label><input class="form-input" type="date" data-to /></div>
          <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Registrar</button>
          <button type="button" class="btn" data-cancel hidden>Cancelar</button>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:760px;">
            <thead><tr><th>Colaborador</th><th>Período</th><th style="text-align:right;">Días</th><th>Desde</th><th>Hasta</th><th></th></tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header"><h3 class="card__title">Reporte por colaborador (acumulado)</h3></div>
      <div class="card__body">
        <div class="table-wrap">
          <table class="table" style="min-width:760px;">
            <thead><tr><th>Colaborador</th><th>Inicio</th><th style="text-align:right;">Meses</th><th style="text-align:right;">Acumulado</th><th style="text-align:right;">Gozados</th><th style="text-align:right;">Pendientes</th></tr></thead>
            <tbody data-report></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const empSel = root.querySelector('[data-emp]');
  const periodI = root.querySelector('[data-period]');
  const daysI = root.querySelector('[data-days]');
  const fromI = root.querySelector('[data-from]');
  const toI = root.querySelector('[data-to]');
  const tbody = root.querySelector('[data-tbody]');
  const report = root.querySelector('[data-report]');
  const addBtn = root.querySelector('[data-add]');
  const cancelBtn = root.querySelector('[data-cancel]');

  function resetForm() {
    editingId = null;
    addBtn.innerHTML = `${ICONS.plus} Registrar`;
    cancelBtn.hidden = true;
    daysI.value = '0';
    fromI.value = '';
    toI.value = '';
  }

  function startEdit(id) {
    const r = vacationService.list().find((x) => x.id === id);
    if (!r) return;
    editingId = id;
    addBtn.innerHTML = `${ICONS.check} Guardar cambios`;
    cancelBtn.hidden = false;
    empSel.value = r.employeeId;
    periodI.value = r.period || '';
    daysI.value = r.daysTaken;
    fromI.value = r.dateFrom || '';
    toI.value = r.dateTo || '';
  }

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }

  function fillSelectors() {
    empSel.innerHTML = employees().map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  }

  function renderList() {
    const recs = vacationService.list();
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin vacaciones registradas.</div></div></td></tr>`;
      return;
    }
    tbody.innerHTML = recs
      .map((r) => {
        const emp = payrollService.getEmployee(r.employeeId);
        return `
          <tr>
            <td>${escapeHtml(emp ? emp.name : '—')}</td>
            <td>${escapeHtml(r.period || '—')}</td>
            <td class="cell-num">${r.daysTaken}</td>
            <td>${r.dateFrom ? fmtDate(r.dateFrom) : '—'}</td>
            <td>${r.dateTo ? fmtDate(r.dateTo) : '—'}</td>
            <td><div class="table__actions"><button class="icon-btn" data-edit="${escapeHtml(r.id)}" title="Editar">${ICONS.edit}</button><button class="icon-btn icon-btn--danger" data-del="${escapeHtml(r.id)}" title="Eliminar">${ICONS.trash}</button></div></td>
          </tr>`;
      })
      .join('');
  }

  function renderReport() {
    const emps = employees();
    if (emps.length === 0) {
      report.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin colaboradores.</div></div></td></tr>`;
      return;
    }
    report.innerHTML = emps
      .map((emp) => {
        const a = vacationService.accrual(emp.id, rules.vacationDays);
        return `
          <tr>
            <td>${escapeHtml(emp.name)}</td>
            <td>${emp.startDate ? fmtDate(emp.startDate) : '—'}</td>
            <td class="cell-num">${a.months}</td>
            <td class="cell-num">${a.accrued}</td>
            <td class="cell-num">${a.taken}</td>
            <td class="cell-num cell-neto">${a.pending}</td>
          </tr>`;
      })
      .join('');
  }

  function render() {
    renderList();
    renderReport();
  }

  cancelBtn.addEventListener('click', resetForm);

  root.querySelector('[data-add]').addEventListener('click', async () => {
    if (!empSel.value) { showToast('Selecciona un colaborador.', 'error'); return; }
    const data = {
      employeeId: empSel.value,
      period: periodI.value.trim(),
      daysTaken: num(daysI.value),
      dateFrom: fromI.value,
      dateTo: toI.value,
      monthYear: (fromI.value || '').slice(0, 7),
    };
    try {
      if (editingId) { await vacationService.update(editingId, data); showToast('Vacaciones actualizadas.'); }
      else { await vacationService.create(data); showToast('Vacaciones registradas.'); }
      resetForm();
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  tbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (editBtn) { startEdit(editBtn.dataset.edit); return; }
    if (!del) return;
    const ok = await confirmDialog({ title: 'Eliminar vacaciones', message: '¿Eliminar este registro?', confirmText: 'Eliminar', danger: true });
    if (ok) {
      try { await vacationService.remove(del.dataset.del); showToast('Registro eliminado.'); if (editingId === del.dataset.del) resetForm(); } catch (err) { showToast(err.message, 'error'); }
      render();
    }
  });

  fillSelectors();
  render();
}
