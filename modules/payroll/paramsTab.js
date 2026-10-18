/* ============================================================================
   paramsTab.js — Parámetros legales por año (UIT / RMV)
   ----------------------------------------------------------------------------
   Permite configurar la UIT y la RMV de cada año (ej. 2027) y guardarlas en
   Supabase. El sistema las usa automáticamente en toda la planilla (Renta 5ª,
   asignación familiar, EsSalud, etc.).
   ========================================================================== */

import { paramsService } from './paramsService.js';
import { money, num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

export function renderParamsTab(root) {
  const nextYear = new Date().getFullYear() + 1;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Parámetros UIT / RMV</h3>
          <p class="card__subtitle">Valores nacionales por año. Configúralos aquí y se aplican a toda la planilla.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="margin:0;"><label class="form-label">Año</label>
            <input class="form-input" type="number" data-year value="${nextYear}" style="max-width:110px;" /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">UIT (S/)</label>
            <input class="form-input" type="number" min="0" step="1" data-uit placeholder="Ej. 5400" style="max-width:130px;" /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">RMV (S/)</label>
            <input class="form-input" type="number" min="0" step="1" data-rmv placeholder="Ej. 1130" style="max-width:130px;" /></div>
          <button type="button" class="btn btn--primary" data-save>${ICONS.check} Guardar</button>
        </div>
        <p class="form-hint">Ej. para 2027 escribe Año <strong>2027</strong>, UIT <strong>5400</strong> (o la oficial) y RMV según corresponda. Quedará disponible en el selector de año de la planilla y del simulador.</p>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header"><h3 class="card__title">Años configurados</h3></div>
      <div class="card__body">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Año</th><th style="text-align:right;">UIT (S/)</th><th style="text-align:right;">RMV (S/)</th><th>Origen</th><th></th></tr></thead>
          <tbody data-tbody></tbody>
        </table></div>
      </div>
    </div>
  `;

  const yearI = root.querySelector('[data-year]');
  const uitI = root.querySelector('[data-uit]');
  const rmvI = root.querySelector('[data-rmv]');
  const tbody = root.querySelector('[data-tbody]');

  function render() {
    const rows = paramsService.list();
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Sin años configurados.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${r.year}</strong></td>
        <td class="cell-num">${money(r.uit)}</td>
        <td class="cell-num">${money(r.rmv)}</td>
        <td>${r.custom ? '<span class="badge badge--gold">Personalizado</span>' : '<span class="badge badge--muted">Predeterminado</span>'}</td>
        <td><div class="table__actions">
          <button type="button" class="icon-btn" data-edit="${r.year}" title="Editar">${ICONS.edit}</button>
          ${r.custom ? `<button type="button" class="icon-btn icon-btn--danger" data-del="${r.year}" title="Quitar">${ICONS.trash}</button>` : ''}
        </div></td>
      </tr>`).join('');
  }

  tbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) {
      const r = paramsService.list().find((x) => x.year === Number(editBtn.dataset.edit));
      if (r) {
        yearI.value = r.year;
        uitI.value = r.uit;
        rmvI.value = r.rmv;
      }
      return;
    }
    if (delBtn) {
      const y = Number(delBtn.dataset.del);
      try {
        await paramsService.remove(y);
        showToast(`Parámetros de ${y} eliminados (vuelve al predeterminado).`);
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  root.querySelector('[data-save]').addEventListener('click', async () => {
    const y = Number(yearI.value);
    const u = Number(uitI.value);
    const r = Number(rmvI.value);
    if (!y || !(u > 0) || !(r > 0)) {
      showToast('Ingresa año, UIT y RMV válidos (mayores a 0).', 'error');
      return;
    }
    try {
      await paramsService.save(y, u, r);
      showToast(`Parámetros de ${y} guardados (UIT ${money(u)}, RMV ${money(r)}).`);
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  render();
}
