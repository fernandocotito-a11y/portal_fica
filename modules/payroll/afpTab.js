/* ============================================================================
   afpTab.js — Parámetros AFP por mes (SBS) con importación automática
   ========================================================================== */

import { afpRatesService } from './afpRatesService.js';
import { MESES } from './payrollConfig.js';
import { num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 2, Y - 1, Y, Y + 1];
const AFPS = ['HABITAT', 'INTEGRA', 'PRIMA', 'PROFUTURO'];

export function renderAfpTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Parámetros AFP</h3>
          <p class="card__subtitle">Comisiones, prima y Remuneración Máxima Asegurable publicadas por la SBS.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">
          <select class="form-input" data-year style="max-width:110px;">${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          <select class="form-input" data-month style="max-width:150px;">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select>
          <button type="button" class="btn" data-import>${ICONS.arrowRight} Actualizar desde la SBS</button>
          <button type="button" class="btn btn--primary" data-save>${ICONS.check} Guardar</button>
        </div>
      </div>
      <div class="card__body">
        <div class="table-wrap">
          <table class="table" style="min-width:820px;">
            <thead><tr>
              <th>AFP</th>
              <th style="text-align:right;">Comisión flujo (%)</th>
              <th style="text-align:right;">Comisión saldo anual (%)</th>
              <th style="text-align:right;">Prima seguros (%)</th>
              <th style="text-align:right;">Aporte obligatorio (%)</th>
              <th style="text-align:right;">Rem. Máx. Asegurable (S/)</th>
            </tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
        <p class="form-hint mt-3" data-hint></p>
      </div>
    </div>`;

  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const tbody = root.querySelector('[data-tbody]');
  const hint = root.querySelector('[data-hint]');

  function render() {
    const rows = afpRatesService.forMonth(year, month);
    const saved = afpRatesService.hasData(year, month);
    tbody.innerHTML = AFPS.map((afp) => {
      const r = rows.find((x) => x.afp === afp) || { comisionFlujo: 0, comisionSaldo: 0, primaSeguro: 0, aporteObligatorio: 0.1, remMaxAsegurable: 0 };
      const p = (v) => (num(v) * 100).toFixed(2);
      return `
        <tr data-afp="${afp}">
          <td><strong>${afp}</strong></td>
          <td><input class="cell-input" type="number" step="0.01" value="${p(r.comisionFlujo)}" data-field="comisionFlujo" /></td>
          <td><input class="cell-input" type="number" step="0.01" value="${p(r.comisionSaldo)}" data-field="comisionSaldo" /></td>
          <td><input class="cell-input" type="number" step="0.01" value="${p(r.primaSeguro)}" data-field="primaSeguro" /></td>
          <td><input class="cell-input" type="number" step="0.01" value="${p(r.aporteObligatorio)}" data-field="aporteObligatorio" /></td>
          <td><input class="cell-input" style="width:110px;" type="number" step="0.01" value="${num(r.remMaxAsegurable).toFixed(2)}" data-field="remMaxAsegurable" /></td>
        </tr>`;
    }).join('');
    hint.textContent = saved
      ? `Parámetros guardados para ${MESES[month - 1]} ${year}.`
      : `Sin datos guardados para ${MESES[month - 1]} ${year}; se muestran valores base. Pulsa "Actualizar desde la SBS" o edita y guarda.`;
  }

  function collect() {
    return Array.from(tbody.querySelectorAll('tr[data-afp]')).map((tr) => {
      const get = (f) => num(tr.querySelector(`[data-field="${f}"]`).value);
      return {
        afp: tr.dataset.afp,
        comisionFlujo: get('comisionFlujo') / 100,
        comisionSaldo: get('comisionSaldo') / 100,
        primaSeguro: get('primaSeguro') / 100,
        aporteObligatorio: get('aporteObligatorio') / 100,
        remMaxAsegurable: get('remMaxAsegurable'),
      };
    });
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); render(); });
  monthSel.addEventListener('change', () => { month = Number(monthSel.value); render(); });

  root.querySelector('[data-save]').addEventListener('click', async () => {
    try {
      await afpRatesService.saveMonth(year, month, collect());
      showToast(`Parámetros AFP guardados (${MESES[month - 1]} ${year}).`);
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  root.querySelector('[data-import]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { period, rows } = await afpRatesService.fetchFromSBS();
      let [y, m] = [year, month];
      if (period) {
        y = Number(period.split('-')[0]);
        m = Number(period.split('-')[1]);
      }
      await afpRatesService.saveMonth(y, m, rows);
      year = y;
      month = m;
      yearSel.value = String(y);
      monthSel.value = String(m);
      showToast(`Parámetros importados desde la SBS (${period || 'último mes'}).`);
      render();
    } catch (err) {
      showToast('No se pudo importar: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  render();
}
