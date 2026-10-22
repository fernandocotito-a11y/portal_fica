/* ============================================================================
   afpTab.js — Parámetros AFP por mes (SBS) con importación automática
   ========================================================================== */

import { afpRatesService, parseSbsHtml } from './afpRatesService.js';
import { authService } from '../../services/authService.js';
import { MESES } from './payrollConfig.js';
import { num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 2, Y - 1, Y, Y + 1];
const AFPS = ['HABITAT', 'INTEGRA', 'PRIMA', 'PROFUTURO'];
const SBS_URL = 'https://www.sbs.gob.pe/app/spp/empleadores/comisiones_spp/paginas/comision_prima.aspx';

export function renderAfpTab(root) {
  const canEdit = authService.isSuperAdmin();
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
          <button type="button" class="btn" data-open-sbs>${ICONS.arrowRight} Abrir la SBS</button>
          <button type="button" class="btn btn--primary" data-save>${ICONS.check} Guardar</button>
        </div>
      </div>
      <div class="card__body">
        ${canEdit ? '' : '<p class="form-hint" data-readonly>Solo el superadministrador puede modificar los parámetros AFP (comisiones, prima y tope). Estos valores son de solo lectura.</p>'}
        <div class="form-group" style="margin-bottom:var(--space-4);">
          <label class="form-label">Pegar tabla de la SBS (método recomendado)</label>
          <textarea class="form-input" data-paste rows="3" placeholder="Abre la SBS en tu navegador → selecciona las 4 filas (HABITAT…PROFUTURO) → Ctrl+C → pega aquí (Ctrl+V)."></textarea>
          <p class="form-hint">1) Pulsa <strong>"Abrir la SBS"</strong> → 2) selecciona la tabla (elige el mes en la SBS si necesitas otro) → 3) Ctrl+C → 4) pega aquí abajo. Se llena sola.</p>
        </div>
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
        <p class="text-muted" data-history style="font-size:var(--font-size-sm);margin-top:var(--space-2);border-top:1px solid var(--color-border);padding-top:var(--space-2);"></p>
      </div>
    </div>`;

  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const tbody = root.querySelector('[data-tbody]');
  const hint = root.querySelector('[data-hint]');
  const historyEl = root.querySelector('[data-history]');

  if (!canEdit) {
    root.querySelectorAll('[data-year],[data-month],[data-paste],[data-save],input[data-field]').forEach((el) => { el.disabled = true; });
  }

  function renderHistory() {
    const saved = afpRatesService.savedPeriods();
    historyEl.textContent = saved.length
      ? `Períodos guardados: ${saved.join(' · ')}`
      : 'Aún no hay ningún período guardado (se usan valores base).';
  }

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
    if (!canEdit) tbody.querySelectorAll('input[data-field]').forEach((el) => { el.disabled = true; });
    renderHistory();
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

  // Pegado de la tabla copiada desde la SBS -> llena las filas automáticamente
  const pasteArea = root.querySelector('[data-paste]');
  function fillRows(rows) {
    rows.forEach((r) => {
      const tr = tbody.querySelector(`tr[data-afp="${r.afp}"]`);
      if (!tr) return;
      const set = (f, v, mul = 100) => { const el = tr.querySelector(`[data-field="${f}"]`); if (el) el.value = (num(v) * mul).toFixed(2); };
      set('comisionFlujo', r.comisionFlujo);
      set('comisionSaldo', r.comisionSaldo);
      set('primaSeguro', r.primaSeguro);
      set('aporteObligatorio', r.aporteObligatorio);
      set('remMaxAsegurable', r.remMaxAsegurable, 1);
    });
  }
  pasteArea.addEventListener('paste', (e) => {
    const html = e.clipboardData ? e.clipboardData.getData('text/html') : '';
    if (!html || !html.includes('<td')) {
      showToast('Copia la tabla completa (no solo el texto) para reconocerla.', 'info');
      return;
    }
    const rows = parseSbsHtml(html);
    if (rows.length === 0) {
      showToast('No se reconocieron los AFP. Asegúrate de copiar la tabla con los 4 AFP.', 'error');
      return;
    }
    e.preventDefault();
    fillRows(rows);
    showToast('Datos de la SBS cargados. Revisa y pulsa Guardar.');
  });

  root.querySelector('[data-save]').addEventListener('click', async () => {
    try {
      await afpRatesService.saveMonth(year, month, collect());
      showToast(`Parámetros AFP guardados (${MESES[month - 1]} ${year}).`);
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Abre la web de la SBS en una pestaña nueva para copiar la tabla
  root.querySelector('[data-open-sbs]').addEventListener('click', () => {
    window.open(SBS_URL, '_blank', 'noopener');
    showToast('Selecciona la tabla en la SBS, copia (Ctrl+C) y pégala aquí.', 'info');
  });

  render();
}
