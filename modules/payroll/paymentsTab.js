/* ============================================================================
   paymentsTab.js — Control de pagos, adelantos y préstamos (agregar/EDITAR/eliminar)
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { paymentService, PAYMENT_TYPES, PAYMENT_CONCEPTS } from './paymentService.js';
import { MESES } from './payrollConfig.js';
import { money, num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

export function renderPaymentsTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let editingId = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Pagos y Adelantos</h3>
          <p class="card__subtitle">Los adelantos y cuotas de préstamo se descuentan automáticamente en la planilla.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:190px;"><label class="form-label">Colaborador</label><select class="form-input" data-emp></select></div>
          <div class="form-group" style="margin:0;min-width:100px;"><label class="form-label">Año</label><input class="form-input" type="number" value="${year}" data-year /></div>
          <div class="form-group" style="margin:0;min-width:130px;"><label class="form-label">Mes</label><select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:200px;"><label class="form-label">Concepto</label><select class="form-input" data-concepto-cat>${PAYMENT_CONCEPTS.map((c) => `<option value="${c.value}">${escapeHtml(c.label)}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:190px;"><label class="form-label">Tipo</label><select class="form-input" data-tipo>${PAYMENT_TYPES.map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:150px;" data-custom-group><label class="form-label">Referencia / voucher</label><input class="form-input" data-concepto placeholder="Ej. Voucher 0012" /></div>
          <div class="form-group" style="margin:0;min-width:110px;"><label class="form-label">Monto (S/)</label><input class="form-input" type="number" min="0" step="0.01" value="0" data-monto /></div>
          <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Registrar</button>
          <button type="button" class="btn" data-cancel hidden>Cancelar</button>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:900px;">
            <thead><tr><th>Colaborador</th><th>Período</th><th>Tipo</th><th>Concepto</th><th style="text-align:right;">Monto</th><th>Acciones</th></tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const empSel = root.querySelector('[data-emp]');
  const yearI = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const tipoSel = root.querySelector('[data-tipo]');
  const conceptoCat = root.querySelector('[data-concepto-cat]');
  const conceptoI = root.querySelector('[data-concepto]');
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

  function resetForm() {
    editingId = null;
    addBtn.innerHTML = `${ICONS.plus} Registrar`;
    cancelBtn.hidden = true;
    conceptoCat.value = PAYMENT_CONCEPTS[0].value;
    tipoSel.value = 'adelanto';
    conceptoI.value = '';
    montoI.value = '0';
  }

  function startEdit(id) {
    const p = paymentService.list().find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    addBtn.innerHTML = `${ICONS.check} Guardar cambios`;
    cancelBtn.hidden = false;
    fillEmployees(p.employeeId);
    empSel.value = p.employeeId;
    yearI.value = p.year;
    monthSel.value = String(p.month);
    const c = PAYMENT_CONCEPTS.find((x) => x.label === p.concepto);
    if (c) {
      conceptoCat.value = c.value;
      conceptoI.value = '';
    } else {
      conceptoCat.value = 'otro';
      conceptoI.value = p.concepto || '';
    }
    tipoSel.value = p.tipo || 'adelanto';
    montoI.value = p.monto;
  }

  function render() {
    fillEmployees(empSel.value || null);
    const recs = paymentService.list();
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin pagos ni adelantos registrados.</div></div></td></tr>`;
      return;
    }
    tbody.innerHTML = recs
      .map((p) => {
        const emp = payrollService.getEmployee(p.employeeId);
        const tipoLabel = (PAYMENT_TYPES.find((t) => t.value === p.tipo) || {}).label || p.tipo;
        return `<tr>
          <td>${escapeHtml(emp ? emp.name : '—')}</td>
          <td>${MESES[p.month - 1]} ${p.year}</td>
          <td>${escapeHtml(tipoLabel)}</td>
          <td>${escapeHtml(p.concepto || '—')}</td>
          <td class="cell-num">${money(p.monto)}</td>
          <td><div class="table__actions">
            <button class="icon-btn" data-edit="${escapeHtml(p.id)}" title="Editar">${ICONS.edit}</button>
            <button class="icon-btn icon-btn--danger" data-del="${escapeHtml(p.id)}" title="Eliminar">${ICONS.trash}</button>
          </div></td>
        </tr>`;
      })
      .join('');
  }

  cancelBtn.addEventListener('click', resetForm);

  addBtn.addEventListener('click', async () => {
    if (!empSel.value) { showToast('Selecciona un colaborador.', 'error'); return; }
    if (num(montoI.value) <= 0) { showToast('Ingresa un monto válido.', 'error'); return; }
    const c = PAYMENT_CONCEPTS.find((x) => x.value === conceptoCat.value);
    const concepto = conceptoCat.value === 'otro' ? conceptoI.value.trim() : (c ? c.label : '');
    const data = { employeeId: empSel.value, year: num(yearI.value), month: num(monthSel.value), tipo: tipoSel.value, concepto, monto: num(montoI.value) };
    try {
      if (editingId) { await paymentService.update(editingId, data); showToast('Registro actualizado.'); }
      else { await paymentService.create(data); showToast('Pago registrado.'); }
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
      const ok = await confirmDialog({ title: 'Eliminar registro', message: '¿Eliminar este registro?', confirmText: 'Eliminar', danger: true });
      if (ok) {
        try { await paymentService.remove(delBtn.dataset.del); showToast('Registro eliminado.'); if (editingId === delBtn.dataset.del) resetForm(); } catch (err) { showToast(err.message, 'error'); }
        render();
      }
    }
  });

  render();
  resetForm();
}
