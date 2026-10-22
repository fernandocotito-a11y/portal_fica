/* ============================================================================
   bonusesTab.js — Control de bonificaciones (agregar / EDITAR / eliminar)
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { bonusService } from './bonusService.js';
import { MESES, BONUS_TYPES, BONUS_CONCEPTS } from './payrollConfig.js';
import { money, num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

export function renderBonusesTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let editingId = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Bonificaciones</h3>
          <p class="card__subtitle">Se suman automáticamente a la planilla. Elige el concepto: la afectación se asigna sola.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:200px;"><label class="form-label">Colaborador</label><select class="form-input" data-emp></select></div>
          <div class="form-group" style="margin:0;min-width:100px;"><label class="form-label">Año</label><input class="form-input" type="number" value="${year}" data-year /></div>
          <div class="form-group" style="margin:0;min-width:140px;"><label class="form-label">Mes</label><select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:240px;"><label class="form-label">Concepto</label><select class="form-input" data-concepto-cat>${BONUS_CONCEPTS.map((c) => `<option value="${c.value}">${escapeHtml(c.label)}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:200px;" hidden data-custom-group><label class="form-label">Concepto personalizado</label><input class="form-input" data-concepto-custom placeholder="Escribe el concepto" /></div>
          <div class="form-group" style="margin:0;min-width:250px;"><label class="form-label">Afectación</label><select class="form-input" data-tipo>${BONUS_TYPES.map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:120px;"><label class="form-label">Monto (S/)</label><input class="form-input" type="number" min="0" step="0.01" value="0" data-monto /></div>
          <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Agregar</button>
          <button type="button" class="btn" data-cancel hidden>Cancelar</button>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:880px;">
            <thead><tr><th>Colaborador</th><th>Período</th><th>Tipo</th><th>Concepto</th><th style="text-align:right;">Monto</th><th>Acciones</th></tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const empSel = root.querySelector('[data-emp]');
  const yearI = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const catSel = root.querySelector('[data-concepto-cat]');
  const customGroup = root.querySelector('[data-custom-group]');
  const customI = root.querySelector('[data-concepto-custom]');
  const tipoSel = root.querySelector('[data-tipo]');
  const montoI = root.querySelector('[data-monto]');
  const tbody = root.querySelector('[data-tbody]');
  const addBtn = root.querySelector('[data-add]');
  const cancelBtn = root.querySelector('[data-cancel]');

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }
  /** Incluye al colaborador del registro que se edita aunque esté inactivo. */
  function fillEmployees(includeId = null) {
    const list = payrollService.listEmployees().filter((e) => e.active !== false || e.id === includeId);
    empSel.innerHTML = list
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.active === false ? ' (inactivo)' : ''}</option>`)
      .join('');
  }
  function applyConcept() {
    const c = BONUS_CONCEPTS.find((x) => x.value === catSel.value);
    customGroup.hidden = catSel.value !== 'otro';
    if (catSel.value !== 'otro') customI.value = '';
    if (c) tipoSel.value = c.tipo;
  }

  function resetForm() {
    editingId = null;
    addBtn.textContent = `${ICONS.plus} Agregar`;
    addBtn.innerHTML = `${ICONS.plus} Agregar`;
    cancelBtn.hidden = true;
    customI.value = '';
    montoI.value = '0';
    catSel.value = BONUS_CONCEPTS[0].value;
    tipoSel.value = BONUS_CONCEPTS[0].tipo;
    applyConcept();
  }

  function startEdit(id) {
    const b = bonusService.list().find((x) => x.id === id);
    if (!b) return;
    editingId = id;
    addBtn.innerHTML = `${ICONS.check} Guardar cambios`;
    cancelBtn.hidden = false;
    fillEmployees(b.employeeId);
    empSel.value = b.employeeId;
    yearI.value = b.year;
    monthSel.value = String(b.month);
    const c = BONUS_CONCEPTS.find((x) => x.label === b.concepto);
    if (c) {
      catSel.value = c.value;
      customGroup.hidden = true;
      customI.value = '';
    } else {
      catSel.value = 'otro';
      customGroup.hidden = false;
      customI.value = b.concepto || '';
    }
    tipoSel.value = b.tipo || 'regular';
    montoI.value = b.monto;
  }

  function render() {
    fillEmployees(empSel.value || null);
    const recs = bonusService.list();
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin bonificaciones registradas.</div></div></td></tr>`;
      return;
    }
    tbody.innerHTML = recs
      .map((b) => {
        const emp = payrollService.getEmployee(b.employeeId);
        const tipoLabel = b.tipo === 'extraordinaria' ? 'Extraordinaria (no afecta)' : 'Regular (afecta)';
        return `<tr>
          <td>${escapeHtml(emp ? emp.name : '—')}</td>
          <td>${MESES[b.month - 1]} ${b.year}</td>
          <td>${escapeHtml(tipoLabel)}</td>
          <td>${escapeHtml(b.concepto || '—')}</td>
          <td class="cell-num">${money(b.monto)}</td>
          <td><div class="table__actions">
            <button class="icon-btn" data-edit="${escapeHtml(b.id)}" title="Editar">${ICONS.edit}</button>
            <button class="icon-btn icon-btn--danger" data-del="${escapeHtml(b.id)}" title="Eliminar">${ICONS.trash}</button>
          </div></td>
        </tr>`;
      })
      .join('');
  }

  catSel.addEventListener('change', applyConcept);
  cancelBtn.addEventListener('click', resetForm);

  addBtn.addEventListener('click', async () => {
    if (!empSel.value) { showToast('Selecciona un colaborador.', 'error'); return; }
    if (num(montoI.value) <= 0) { showToast('Ingresa un monto válido.', 'error'); return; }
    const c = BONUS_CONCEPTS.find((x) => x.value === catSel.value);
    const concepto = catSel.value === 'otro' ? customI.value.trim() : (c ? c.label : '');
    if (!concepto) { showToast('Escribe el concepto.', 'error'); customI.focus(); return; }
    const data = { employeeId: empSel.value, year: num(yearI.value), month: num(monthSel.value), tipo: tipoSel.value, concepto, monto: num(montoI.value) };
    try {
      if (editingId) { await bonusService.update(editingId, data); showToast('Bonificación actualizada.'); }
      else { await bonusService.create(data); showToast('Bonificación agregada.'); }
      resetForm();
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  tbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) { startEdit(editBtn.dataset.edit); return; }
    if (delBtn) {
      const ok = await confirmDialog({ title: 'Eliminar bonificación', message: '¿Eliminar este registro?', confirmText: 'Eliminar', danger: true });
      if (ok) {
        try { await bonusService.remove(delBtn.dataset.del); showToast('Registro eliminado.'); if (editingId === delBtn.dataset.del) resetForm(); } catch (err) { showToast(err.message, 'error'); }
        render();
      }
    }
  });

  render();
  resetForm();
}
