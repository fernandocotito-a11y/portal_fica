/* ============================================================================
   benefitsTab.js — Vista "Cálculo de CTS y Gratificaciones"
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { benefitsService, BENEFIT_BONOS } from './benefitsService.js';
import { money, num } from './payrollUtils.js';
import { ICONS, escapeHtml } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 1, Y, Y + 1];

export function renderBenefitsTab(root) {
  let year = new Date().getFullYear();
  let mesesGrati = 6;
  let diasCts = 180;
  let tipoBono = 'ESSALUD';

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">CTS y Gratificaciones</h3>
          <p class="card__subtitle">Gratificación (jul/dic) y CTS (may/nov) por colaborador.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:110px;"><label class="form-label">Año</label>
            <select class="form-input" data-year>${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Meses completos (grati.)</label>
            <input class="form-input" type="number" min="0" max="6" value="${mesesGrati}" data-meses />
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Días computables (CTS)</label>
            <input class="form-input" type="number" min="0" max="180" value="${diasCts}" data-dias />
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Bono extraordinario</label>
            <select class="form-input" data-bono>${BENEFIT_BONOS.map((b) => `<option value="${b.value}">${b.label}</option>`).join('')}</select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:1080px;">
            <thead>
              <tr class="table__group">
                <th colspan="5">Gratificación (julio / diciembre)</th>
                <th colspan="4">CTS (mayo / noviembre)</th>
              </tr>
              <tr>
                <th>Empleado</th><th>Base grati.</th><th>Grati. semestral</th><th>Bono extra.</th><th>Total grati.</th>
                <th>Base CTS</th><th>1/6 gratificación</th><th>Días</th><th>CTS</th>
              </tr>
            </thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const tbody = root.querySelector('[data-tbody]');
  const yearSel = root.querySelector('[data-year]');
  const mesesI = root.querySelector('[data-meses]');
  const diasI = root.querySelector('[data-dias]');
  const bonoI = root.querySelector('[data-bono]');

  function render() {
    const emps = payrollService.listEmployees().filter((e) => e.active !== false);
    if (emps.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin colaboradores</div><div class="empty-state__desc">Agrega colaboradores para calcular beneficios.</div></div></td></tr>`;
      return;
    }
    tbody.innerHTML = emps
      .map((emp) => {
        const g = benefitsService.calcGratificacion(emp, { year, mesesCompletos: mesesGrati, tipoBono });
        const c = benefitsService.calcCts(emp, { year, diasComputables: diasCts });
        return `
          <tr>
            <td><div class="table__name">${escapeHtml(emp.name)}</div></td>
            <td class="cell-num">${money(g.base)}</td>
            <td class="cell-num">${money(g.monto)}</td>
            <td class="cell-num">${money(g.bonificacion)}</td>
            <td class="cell-num cell-strong">${money(g.total)}</td>
            <td class="cell-num">${money(c.base)}</td>
            <td class="cell-num">${money(c.sexto)}</td>
            <td class="cell-num">${c.diasComputables}</td>
            <td class="cell-num cell-neto">${money(c.monto)}</td>
          </tr>`;
      })
      .join('');
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); render(); });
  mesesI.addEventListener('input', () => { mesesGrati = num(mesesI.value, 6); render(); });
  diasI.addEventListener('input', () => { diasCts = num(diasI.value, 180); render(); });
  bonoI.addEventListener('change', () => { tipoBono = bonoI.value; render(); });

  render();
}
