/* ============================================================================
   bonusesTab.js — Control de bonificaciones / ingresos adicionales
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { bonusService } from './bonusService.js';
import { MESES, BONUS_TYPES } from './payrollConfig.js';
import { money, num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

export function renderBonusesTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Bonificaciones</h3>
          <p class="card__subtitle">Ingresos adicionales que se suman automáticamente a la planilla del mes.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:200px;"><label class="form-label">Colaborador</label><select class="form-input" data-emp></select></div>
          <div class="form-group" style="margin:0;min-width:100px;"><label class="form-label">Año</label><input class="form-input" type="number" value="${year}" data-year /></div>
          <div class="form-group" style="margin:0;min-width:140px;"><label class="form-label">Mes</label><select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:250px;"><label class="form-label">Tipo</label><select class="form-input" data-tipo>${BONUS_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;min-width:200px;"><label class="form-label">Concepto</label><input class="form-input" data-concepto placeholder="Ej. Bonif. extraordinaria" /></div>
          <div class="form-group" style="margin:0;min-width:120px;"><label class="form-label">Monto (S/)</label><input class="form-input" type="number" min="0" step="0.01" value="0" data-monto /></div>
          <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Agregar</button>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:720px;">
            <thead><tr><th>Colaborador</th><th>Período</th><th>Tipo</th><th>Concepto</th><th style="text-align:right;">Monto</th><th></th></tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const empSel = root.querySelector('[data-emp]');
  const yearI = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const tipoSel = root.querySelector('[data-tipo]');
  const conceptoI = root.querySelector('[data-concepto]');
  const montoI = root.querySelector('[data-monto]');
  const tbody = root.querySelector('[data-tbody]');

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }
  function render() {
    empSel.innerHTML = employees().map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
    const recs = bonusService.list();
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin bonificaciones registradas.</div></div></td></tr>`;
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
          <td><button class="icon-btn icon-btn--danger" data-del="${escapeHtml(b.id)}" title="Eliminar">${ICONS.trash}</button></td>
        </tr>`;
      })
      .join('');
  }

  root.querySelector('[data-add]').addEventListener('click', async () => {
    if (!empSel.value) { showToast('Selecciona un colaborador.', 'error'); return; }
    if (num(montoI.value) <= 0) { showToast('Ingresa un monto válido.', 'error'); return; }
    try {
      await bonusService.create({ employeeId: empSel.value, year: num(yearI.value), month: num(monthSel.value), tipo: tipoSel.value, concepto: conceptoI.value.trim(), monto: num(montoI.value) });
      showToast('Bonificación agregada.');
      conceptoI.value = '';
      montoI.value = '0';
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  tbody.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const ok = await confirmDialog({ title: 'Eliminar bonificación', message: '¿Eliminar este registro?', confirmText: 'Eliminar', danger: true });
    if (ok) { try { await bonusService.remove(del.dataset.del); showToast('Registro eliminado.'); } catch (err) { showToast(err.message, 'error'); } render(); }
  });

  render();
}
