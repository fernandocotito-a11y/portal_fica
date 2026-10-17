/* ============================================================================
   auditTab.js — Vista "Auditoría y Cierre Contable"
   ----------------------------------------------------------------------------
   - Tablero de obligaciones tributarias del mes (con semáforos de estado).
   - Visor del asiento contable (PCGE) con copiado y exportación.
   - Panel de alertas de RR.HH. (contratos, vacaciones, aportes).
   ========================================================================== */

import { payrollService, calcRow } from './payrollService.js';
import { taxSummaryService } from './taxSummaryService.js';
import { accountingBridgeService } from './accountingBridgeService.js';
import { complianceAuditService } from './complianceAuditService.js';
import { crossModuleConnector } from '../sunat/crossModuleConnector.js';
import { MESES } from './payrollConfig.js';
import { money } from './payrollUtils.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 2, Y - 1, Y, Y + 1];
const ESTADOS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'declarado', label: 'Declarado' },
  { value: 'pagado', label: 'Pagado' },
];
const SEMAFORO = { pendiente: 'badge--soon', declarado: 'badge--config', pagado: 'badge--active' };

export function renderAuditTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Obligaciones tributarias del mes</h3>
          <p class="card__subtitle" data-due></p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;">
          <select class="form-input" data-year style="max-width:110px;">${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          <select class="form-input" data-month style="max-width:150px;">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select>
          <select class="form-input" data-state style="max-width:150px;">${ESTADOS.map((e) => `<option value="${e.value}">${e.label}</option>`).join('')}</select>
        </div>
      </div>
      <div class="card__body">
        <div data-oblig style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:var(--space-3);"></div>
        <div style="margin-top:var(--space-4);display:flex;gap:var(--space-3);flex-wrap:wrap;">
          <button type="button" class="btn" data-expense>${ICONS.arrowRight} Exportar gasto deducible (CSV)</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header">
        <div>
          <h3 class="card__title">Asiento contable (PCGE)</h3>
          <p class="card__subtitle" data-entry-sub>Provisión mensual · Debe = Haber</p>
        </div>
        <div style="display:flex;gap:var(--space-3);">
          <button type="button" class="btn" data-copy>Copiar</button>
          <button type="button" class="btn btn--primary" data-csv>${ICONS.arrowRight} Exportar CSV</button>
        </div>
      </div>
      <div class="card__body">
        <div class="table-wrap">
          <table class="table" style="min-width:640px;">
            <thead><tr><th>Cuenta</th><th>Denominación</th><th style="text-align:right;">Debe</th><th style="text-align:right;">Haber</th></tr></thead>
            <tbody data-entry></tbody>
            <tfoot data-entry-foot></tfoot>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header">
        <h3 class="card__title">Alertas de Recursos Humanos</h3>
        <span class="badge badge--muted" data-alerts-count></span>
      </div>
      <div class="card__body" data-alerts></div>
    </div>`;

  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const stateSel = root.querySelector('[data-state]');
  const obligEl = root.querySelector('[data-oblig]');
  const dueEl = root.querySelector('[data-due]');
  const entryBody = root.querySelector('[data-entry]');
  const entryFoot = root.querySelector('[data-entry-foot]');
  const entrySub = root.querySelector('[data-entry-sub]');
  const alertsEl = root.querySelector('[data-alerts]');
  const alertsCount = root.querySelector('[data-alerts-count]');
  const company = authService.activeCompany ? authService.activeCompany() : null;
  const period = () => ({ year, month });

  function buildRows() {
    const p = payrollService.getPeriodInputs(year, month);
    return payrollService
      .listEmployees()
      .filter((e) => e.active !== false)
      .map((emp) => ({ employee: emp, calc: calcRow(emp, p.rows?.[emp.id] || {}, year, month) }));
  }

  function obligCard(label, value, sub) {
    return `<div class="stat-card"><div style="flex:1;">
      <div class="stat-card__label">${escapeHtml(label)}</div>
      <div class="stat-card__value" style="font-size:var(--font-size-lg);">${money(value)}</div>
      <div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(sub || '')}</div>
    </div></div>`;
  }

  function render() {
    const rows = buildRows();
    const s = taxSummaryService.buildSummary(rows, period(), company);

    // Semáforo de estado
    stateSel.value = s.state;

    dueEl.textContent = `Vencimiento estimado: ${s.dueDate} · ${s.trabajadores} trabajador(es)`;
    obligEl.innerHTML =
      obligCard('EsSalud (9%)', s.essalud, 'Aporte del empleador') +
      obligCard('ONP (13%)', s.onp, 'Retenido al trabajador') +
      obligCard('Renta 5ta', s.renta5ta, 'Retenido — a SUNAT') +
      obligCard('AFP (SPP)', s.afpTotal, s.afpList.map((a) => a.afp).join(', ') || 'Sin afiliados') +
      obligCard('Seguro Vida Ley / EPS', s.vidaLey, 'Aporte del empleador') +
      obligCard('Total a SUNAT', s.totalSunat, 'EsSalud + retenciones') +
      `<div class="stat-card"><div style="flex:1;">
        <div class="stat-card__label">Estado de pago</div>
        <div style="margin-top:6px;"><span class="badge ${SEMAFORO[s.state] || 'badge--muted'}"><span class="badge__dot"></span>${escapeHtml((ESTADOS.find((e) => e.value === s.state) || {}).label || s.state)}</span></div>
        <div class="text-muted" style="font-size:var(--font-size-xs);margin-top:4px;">Vence ${s.dueDate}</div>
      </div></div>`;

    // Asiento contable
    const entry = accountingBridgeService.buildEntry(rows, period());
    entrySub.textContent = `Provisión ${MESES[month - 1]} ${year} · Debe ${entry.balanced ? '=' : '≠'} Haber`;
    entryBody.innerHTML = entry.lines
      .map(
        (l) => `<tr>
        <td><code>${escapeHtml(l.cuenta)}</code></td>
        <td>${escapeHtml(l.nombre)}</td>
        <td class="cell-num">${l.debe ? money(l.debe) : '—'}</td>
        <td class="cell-num">${l.haber ? money(l.haber) : '—'}</td>
      </tr>`
      )
      .join('');
    entryFoot.innerHTML = `
      <tr>
        <td colspan="2">TOTALES ${entry.balanced ? '· <span style="color:var(--color-success);">balanceado</span>' : '· <span style="color:var(--color-danger);">desbalanceado</span>'}</td>
        <td class="cell-num cell-strong">${money(entry.totalDebe)}</td>
        <td class="cell-num cell-strong">${money(entry.totalHaber)}</td>
      </tr>`;

    // Alertas RR.HH.
    const alerts = complianceAuditService.audit(rows, period());
    alertsCount.textContent = `${alerts.length} alerta(s)`;
    if (alerts.length === 0) {
      alertsEl.innerHTML = `<div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">✔ Sin alertas. Todo en orden.</div></div>`;
    } else {
      const color = (lv) => (lv === 'danger' ? 'var(--color-danger)' : lv === 'warning' ? 'var(--color-warning)' : 'var(--color-info)');
      alertsEl.innerHTML = `<ul style="margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:var(--space-2);">
        ${alerts
          .map(
            (a) => `<li style="border-left:3px solid ${color(a.level)};padding:var(--space-2) var(--space-3);background:var(--color-cream);border-radius:var(--radius-sm);font-size:var(--font-size-sm);">${escapeHtml(a.message)}</li>`
          )
          .join('')}
      </ul>`;
    }
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); render(); });
  monthSel.addEventListener('change', () => { month = Number(monthSel.value); render(); });
  stateSel.addEventListener('change', async () => {
    try {
      await taxSummaryService.setState(year, month, stateSel.value);
      showToast('Estado de pago actualizado.');
    } catch (err) {
      showToast(err.message, 'error');
    }
    render();
  });

  root.querySelector('[data-csv]').addEventListener('click', () => {
    const rows = buildRows();
    const entry = accountingBridgeService.buildEntry(rows, period());
    accountingBridgeService.downloadCSV(entry, company);
    showToast('Asiento exportado (CSV).');
  });

  root.querySelector('[data-copy]').addEventListener('click', async () => {
    const rows = buildRows();
    const entry = accountingBridgeService.buildEntry(rows, period());
    const text = accountingBridgeService.toCSV(entry, company);
    try {
      await navigator.clipboard.writeText(text);
      showToast('Asiento copiado al portapapeles.');
    } catch {
      showToast('No se pudo copiar (permiso denegado).', 'error');
    }
  });

  root.querySelector('[data-expense]').addEventListener('click', () => {
    const rows = buildRows();
    crossModuleConnector.downloadDeductibleCSV(rows, period());
    showToast('Gasto deducible exportado.');
  });

  render();
}
