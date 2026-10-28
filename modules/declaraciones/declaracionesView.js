/* ============================================================================
   declaracionesView.js — Declaraciones SUNAT · Liquidación IGV / Renta (621)
   ----------------------------------------------------------------------------
   Reproduce los reportes del PDT 621:
     1. Matriz anual de liquidación (Enero → Diciembre) con totales.
     2. Ficha mensual Formulario Virtual 621 (desglose de casillas SUNAT) con
        la "determinación" compacta (resumen del control) al inicio.
   Incluye formulario de saldos iniciales editables y ajustes por periodo.
   ========================================================================== */

import { declaracionesService } from './declaracionesService.js';
import { authService } from '../../services/authService.js';
import { MONTHS } from '../compras/comprasConfig.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const now = new Date();
const CURRENT_YEAR = now.getFullYear();

const fmt = (v) => Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => `${(Number(v || 0) * 100).toFixed(2)}%`;
// Monto con negativos entre paréntesis (estilo PDT 621).
const money = (v) => {
  const n = Number(v || 0);
  return n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
};

/* Filas de la matriz anual (reporte completo). */
const MATRIX_ROWS = [
  { section: 'IGV' },
  { key: 'igvVentas', label: 'IGV VENTAS', get: (m) => m.igvVentas },
  { key: 'igvCompras', label: '(-) IGV COMPRAS', get: (m) => m.igvCompras, minus: true },
  { key: 'preliminar', label: 'IGV POR PAGAR / IGV A FAVOR', get: (m) => m.preliminar, strong: true },
  { key: 'saldoIgvAnterior', label: '(-) SALDO ANTERIOR IGV A FAVOR', get: (m) => m.saldoIgvAnterior, minus: true, total: 'last' },
  { key: 'igvNeto', label: 'SALDO DE IGV POR PAGAR O A FAVOR', get: (m) => m.igvNeto, strong: true },
  { key: 'percepAplic', label: '(-) PERCEPCIONES', get: (m) => m.percepAplic, minus: true },
  { key: 'saldoDespuesPercepciones', label: 'SALDO IMPUESTO POR PAGAR O A FAVOR', get: (m) => m.saldoDespuesPercepciones },
  { key: 'retenAplic', label: '(-) RETENCIONES', get: (m) => m.retenAplic, minus: true },
  { key: 'igvPorPagar', label: 'SALDO IMPUESTO POR PAGAR O A FAVOR', get: (m) => m.igvPorPagar, strong: true },
  { key: 'intereses', label: 'INTERES TRIBUTARIO (0.04% DIARIO)', get: (m) => m.intereses },
  { key: 'igvTotal', label: 'IGV TOTAL POR PAGAR', get: (m) => m.igvTotal, strong: true, hl: true },
  { key: 'pagosPrevios', label: '(-) PAGOS EFECTUADOS', get: (m) => m.pagosPrevios, minus: true },
  { key: 'igvRegularizar', label: 'IGV POR REGULARIZAR', get: (m) => m.igvRegularizar, strong: true, hl: true },
  { section: 'RENTA (RMT)' },
  { key: 'ventasNetasMes', label: 'VENTAS NETAS', get: (m) => m.ventasNetasMes },
  { key: 'tasaRenta', label: '(%) COEFICIENTE (SEGÚN TIPO EMPRESA)', get: (m) => m.tasaRenta, pct: true, total: 'last' },
  { key: 'rentaPagar', label: 'RENTA POR PAGAR', get: (m) => m.rentaPagar, strong: true },
  { key: 'interesesRenta', label: 'INTERES TRIBUTARIO', get: (m) => m.interesesRenta },
  { key: 'rentaTotal', label: 'RENTA TOTAL POR PAGAR', get: (m) => m.rentaTotal, strong: true },
  { key: 'pagosPreviosRenta', label: '(-) PAGOS EFECTUADOS', get: (m) => m.pagosPreviosRenta, minus: true },
  { key: 'rentaRegularizar', label: 'RENTA POR REGULARIZAR', get: (m) => m.rentaRegularizar, strong: true, hl: true },
];

/* Casillas del Formulario Virtual 621. */
const FICHA = [
  { section: 'IGV · Ventas' },
  { casilla: '100', label: 'Ventas netas (base gravada)', value: (m) => m.baseGravadaV },
  { casilla: '101', label: 'IGV ventas gravadas', value: (m) => m.igvVentas },
  { casilla: '102', label: 'Descuentos concedidos y/o devoluciones (base)', value: () => 0, hideZero: true },
  { casilla: '103', label: 'Descuentos y/o devoluciones (tributo)', value: () => 0, hideZero: true },
  { casilla: '105', label: 'Ventas no gravadas (sin exportaciones)', value: (m) => m.baseNoGravadaV },
  { casilla: '131', label: 'Total base ventas', value: (m) => (m.baseGravadaV || 0) + (m.baseNoGravadaV || 0) },
  { section: 'IGV · Compras' },
  { casilla: '107', label: 'Compras netas destinadas a ventas gravadas (base)', value: (m) => m.baseGravadaC },
  { casilla: '108', label: 'IGV compras (crédito fiscal)', value: (m) => m.igvCompras },
  { casilla: '120', label: 'Compras internas no gravadas', value: (m) => m.baseNoGravadaC },
  { casilla: '178', label: 'Total IGV compras (crédito fiscal)', value: (m) => m.igvCompras, strong: true },
  { section: 'Renta · Régimen MYPE Tributario' },
  { casilla: '301', label: 'Ingresos netos del mes (base)', value: (m) => m.ventasNetasMes },
  { casilla: '312', label: 'Impuesto a pagar (renta)', value: (m) => m.rentaPagar },
  { casilla: '315', label: 'Porcentaje', value: (m) => m.tasaRenta, pct: true },
  { casilla: '380', label: 'Coeficiente', value: (m) => m.coeficienteRenta, raw: true },
  { section: 'Determinación del IGV' },
  { casilla: '140', label: 'Impuesto resultante o saldo a favor', value: (m) => m.preliminar, strong: true },
  { casilla: '145', label: 'Saldo a favor del periodo anterior', value: (m) => m.saldoIgvAnterior },
  { casilla: '184', label: 'Tributo a pagar o saldo a favor', value: (m) => m.igvNeto, strong: true },
  { casilla: '171', label: 'Percepciones declaradas en el periodo', value: (m) => m.percepcionesMes },
  { casilla: '168', label: 'Saldo de percepciones de periodos anteriores', value: (m) => m.percepcionesAnterior, hideZero: true },
  { casilla: '164', label: 'Saldo de percepciones no aplicadas', value: (m) => m.percepcionesNoAplicadas, hideZero: true },
  { casilla: '179', label: 'Retenciones declaradas en el periodo', value: (m) => m.retencionesMes },
  { casilla: '176', label: 'Saldo de retenciones de periodos anteriores', value: (m) => m.retencionesAnterior, hideZero: true },
  { casilla: '165', label: 'Saldo de retenciones no aplicadas', value: (m) => m.retencionesNoAplicadas, hideZero: true },
  { casilla: '681', label: 'Sub total (IGV)', value: (m) => m.igvPorPagar, strong: true },
  { casilla: '185', label: 'Pagos previos (IGV)', value: (m) => m.pagosPrevios },
  { casilla: '187', label: 'Interés moratorio (IGV)', value: (m) => m.intereses },
  { casilla: '188', label: 'Total deuda tributaria (IGV)', value: (m) => m.igvTotal, strong: true, hl: true },
  { section: 'Determinación de la Renta' },
  { casilla: '303', label: 'Impuesto resultante (renta)', value: (m) => m.rentaPagar },
  { casilla: '304', label: 'Tributo a pagar o saldo a favor (renta)', value: (m) => m.rentaPagar },
  { casilla: '682', label: 'Sub total (renta)', value: (m) => m.rentaPagar },
  { casilla: '317', label: 'Pagos previos (renta)', value: (m) => m.pagosPreviosRenta },
  { casilla: '319', label: 'Interés moratorio (renta)', value: (m) => m.interesesRenta },
  { casilla: '324', label: 'Total deuda tributaria (renta)', value: (m) => m.rentaTotal, strong: true, hl: true },
];

function yearOptions() {
  const years = [];
  for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 4; y -= 1) years.push(y);
  return years;
}

function openModal(title, bodyHtml) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <div class="modal__header">
      <h3 class="modal__title">${escapeHtml(title)}</h3>
      <button type="button" class="modal__close" data-close aria-label="Cerrar">${ICONS.close}</button>
    </div>
    <div class="modal__body">${bodyHtml}</div>`;
  document.body.appendChild(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.showModal();
  return { dialog, close };
}

export function render(root) {
  const company = authService.activeCompany() || {};
  const state = {
    year: CURRENT_YEAR,
    busy: false,
    data: null,
    error: '',
  };

  root.innerHTML = `
    <div data-decl-root>
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Declaraciones SUNAT</h2>
          <p class="page-heading__subtitle">
            Liquidación mensual de IGV y Renta (RMT) · ${escapeHtml(company.name || 'Empresa')} · RUC ${escapeHtml(company.ruc || '—')}
          </p>
        </div>
      </div>
      <div data-content></div>
    </div>`;

  const content = root.querySelector('[data-content]');

  async function load() {
    state.busy = true;
    state.error = '';
    renderContent();
    try {
      state.data = await declaracionesService.refresh(state.year);
    } catch (err) {
      state.error = err.message || String(err);
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  /* ------------------------- Matriz anual ------------------------- */

  function cellText(row, m) {
    if (row.pct) return pct(row.get(m));
    const v = Number(row.get(m) || 0);
    if (row.minus) return v === 0 ? '0.00' : `(${fmt(Math.abs(v))})`;
    return money(v);
  }

  function matrixHtml() {
    const months = state.data.timeline.months;

    const head = `
      <thead>
        <tr>
          <th class="sticky-col">Concepto</th>
          ${months.map((m, i) => `
            <th class="cell-num month-click" data-month="${m.mes}" title="Ver Ficha 621 de ${escapeHtml(MONTHS[i])}">
              ${escapeHtml(MONTHS[i])}<div class="text-muted" style="font-size:var(--font-size-xs);">${String(m.mes).padStart(2, '0')}/${m.anio}</div>
            </th>`).join('')}
          <th class="cell-num total-col">Total</th>
        </tr>
      </thead>`;

    const bodyRows = MATRIX_ROWS.map((row) => {
      if (row.section) {
        return `<tr class="section-row"><td class="sticky-col" colspan="${months.length + 2}">${escapeHtml(row.section)}</td></tr>`;
      }
      const cells = months.map((m) => `<td class="cell-num${row.strong ? ' cell-strong' : ''}">${cellText(row, m)}</td>`).join('');
      const totalVal = totalForRow(row);
      return `<tr class="${row.hl ? 'row-hl' : ''}">
        <td class="sticky-col${row.strong ? ' cell-strong' : ''}">${escapeHtml(row.label)}</td>
        ${cells}
        <td class="cell-num total-col${row.strong ? ' cell-strong' : ''}">${totalCellText(row, totalVal)}</td>
      </tr>`;
    }).join('');

    return `<div class="table-wrap">
      <table class="table decl-matrix">
        ${head}
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }

  function totalForRow(row) {
    const months = state.data.timeline.months;
    if (row.total === 'last') {
      const last = months[months.length - 1];
      return Number(last ? row.get(last) : 0) || 0;
    }
    return months.reduce((acc, m) => acc + (Number(row.get(m)) || 0), 0);
  }

  function totalCellText(row, value) {
    if (row.pct) return pct(value);
    const v = Number(value || 0);
    if (row.minus) return v === 0 ? '0.00' : `(${fmt(Math.abs(v))})`;
    return money(v);
  }

  function statsHtml() {
    const t = state.data.totals;
    const last = state.data.timeline.months[state.data.timeline.months.length - 1] || {};
    return `
      <div class="stats">
        <div class="stat-card"><span class="stat-card__icon">${ICONS.briefcase}</span><div><div class="stat-card__value">${fmt(t.igvVentas)}</div><div class="stat-card__label">IGV ventas ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.building}</span><div><div class="stat-card__value">${fmt(t.igvCompras)}</div><div class="stat-card__label">IGV compras ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.arrowRight}</span><div><div class="stat-card__value">${fmt(t.igvPorPagar)}</div><div class="stat-card__label">IGV a pagar ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.check}</span><div><div class="stat-card__value">${fmt(t.rentaPagar)}</div><div class="stat-card__label">Renta a pagar ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.info}</span><div><div class="stat-card__value">${fmt(t.igvRegularizar + t.rentaRegularizar)}</div><div class="stat-card__label">Total a regularizar ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.shield}</span><div><div class="stat-card__value">${fmt(last.saldoFavorPeriodo)}</div><div class="stat-card__label">Saldo a favor final</div></div></div>
      </div>`;
  }

  function toolbarHtml() {
    return `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-end;">
          <div>
            <label class="form-label" for="decl-year">Ejercicio</label>
            <select class="form-input" data-year style="max-width:140px;">
              ${yearOptions().map((y) => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <div class="text-muted" style="font-size:var(--font-size-sm);">
            UIT ${state.data ? fmt(state.data.balances.uit) : '—'} · Renta RMT: 1.00% hasta 300 UIT, 1.50% por encima
          </div>
          <div style="margin-left:auto;display:flex;gap:var(--space-2);">
            <button type="button" class="btn" data-saldos>${ICONS.edit} Saldos iniciales</button>
            <button type="button" class="btn" data-export>${ICONS.arrowRight} Exportar</button>
          </div>
        </div>
      </div>`;
  }

  function renderContent() {
    if (state.busy) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state__title">Calculando liquidación…</div></div>`;
      return;
    }
    if (state.error) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state__title">No se pudo calcular</div><div class="empty-state__desc">${escapeHtml(state.error)}</div></div>`;
      return;
    }
    if (!state.data) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state__title">Sin datos</div></div>`;
      return;
    }

    const banner = declaracionesService.mode === 'local'
      ? `<div class="card" style="border-color:var(--color-gold);margin-bottom:var(--space-4);"><div class="card__body">
          La tabla <code>tax_declaration_periods</code> todavía no existe en Supabase. Los saldos y ajustes se guardan solo en este navegador.
          Ejecuta <code>supabase/declaraciones_schema.sql</code> en el SQL Editor y recarga el portal para activar el modo multiusuario.
          <a class="btn" href="./supabase/declaraciones_schema.sql" target="_blank" rel="noopener" style="margin-top:var(--space-2);">${ICONS.arrowRight} Abrir SQL de declaraciones</a>
        </div></div>`
      : '';

    content.innerHTML = `
      ${toolbarHtml()}
      ${banner}
      ${statsHtml()}
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Liquidación tributaria anual ${state.year}</h3>
            <p class="card__subtitle">Clic en un mes para ver la Ficha 621 (casillas SUNAT).</p>
          </div>
        </div>
        <div class="card__body" style="padding:0;">
          ${matrixHtml()}
        </div>
      </div>`;
  }

  /* ------------------------- Modales ------------------------- */

  function compactHtml(m) {
    const lines = [
      { label: 'IMPUESTO RESULTANTE', value: m.preliminar },
      { label: '(-) CRÉDITO FISCAL ANTERIOR', value: m.saldoIgvAnterior, minus: true },
      { label: 'IMPUESTO NETO', value: m.igvNeto, strong: true },
      { label: '(-) PERCEPCIONES APLICADAS', value: m.percepAplic, minus: true },
      { label: '(-) RETENCIONES APLICADAS', value: m.retenAplic, minus: true },
      { label: 'IMPUESTO NETO POR PAGAR', value: m.igvPorPagar, strong: true, hl: true },
      { label: 'CRÉDITO FISCAL (SALDO A FAVOR)', value: m.saldoFavorPeriodo },
      { label: 'PERCEPCIONES NO APLICADAS', value: m.percepcionesNoAplicadas },
      { label: 'RETENCIONES NO APLICADAS', value: m.retencionesNoAplicadas },
    ];
    return lines.map((l) => {
      const v = Number(l.value || 0);
      const text = l.minus ? (v === 0 ? '0.00' : `(${fmt(Math.abs(v))})`) : money(v);
      return `<tr class="${l.hl ? 'row-hl' : ''}">
        <td${l.strong ? ' style="font-weight:600;"' : ''}>${escapeHtml(l.label)}</td>
        <td class="cell-num${l.strong ? ' cell-strong' : ''}">${text}</td>
      </tr>`;
    }).join('');
  }

  function openFicha(mes) {
    const m = state.data.timeline.months.find((x) => x.mes === mes);
    if (!m) return;
    const monthName = MONTHS[mes - 1];

    const rows = FICHA.filter((r) => r.section || !r.hideZero || Number(r.value(m) || 0) !== 0)
      .map((r) => {
        if (r.section) return `<tr class="section-row"><td colspan="3">${escapeHtml(r.section)}</td></tr>`;
        const raw = Number(r.value(m) || 0);
        const text = r.pct ? pct(raw) : r.raw ? raw.toFixed(4) : money(raw);
        return `<tr class="${r.hl ? 'row-hl' : ''}">
          <td class="cell-num casilla">${r.casilla}</td>
          <td>${escapeHtml(r.label)}</td>
          <td class="cell-num${r.strong ? ' cell-strong' : ''}">${text}</td>
        </tr>`;
      }).join('');

    const body = `
      <div class="text-muted" style="font-size:var(--font-size-sm);margin-bottom:var(--space-3);">
        ${escapeHtml(monthName)} ${m.anio} · Estado: <strong>${m.estado === 'cerrado' ? 'Cerrado' : 'Calculado'}</strong> · Tasa renta ${pct(m.tasaRenta)} · UIT ${fmt(m.uit)}
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__header"><div><h4 class="card__title" style="font-size:var(--font-size-md);">Resumen del control</h4></div></div>
        <div class="card__body" style="padding:0;">
          <table class="table">
            <thead><tr><th>Concepto</th><th class="cell-num">Importe (S/)</th></tr></thead>
            <tbody>${compactHtml(m)}</tbody>
          </table>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th class="cell-num">Casilla</th><th>Concepto</th><th class="cell-num">Importe (S/)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--color-border);">
        <button type="button" class="btn" data-ajustar="${mes}">${ICONS.edit} Ajustes del periodo</button>
        <button type="button" class="btn btn--primary" data-cerrar-621>Cerrar</button>
      </div>`;
    const { dialog, close } = openModal(`Ficha 621 · ${monthName} ${m.anio}`, body);
    dialog.querySelector('[data-cerrar-621]').addEventListener('click', close);
    dialog.querySelector('[data-ajustar]').addEventListener('click', () => {
      close();
      openAjustes(mes);
    });
  }

  function openSaldos() {
    const b = state.data.balances;
    const body = `
      <form data-saldos-form>
        <div class="form-group"><label class="form-label">Saldo crédito fiscal IGV ejercicio anterior</label>
          <input class="form-input" type="number" step="0.01" name="saldo_igv_anterior" value="${Number(b.saldo_igv_anterior || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Percepciones no aplicadas ejercicio anterior</label>
          <input class="form-input" type="number" step="0.01" name="percepciones_ant" value="${Number(b.percepciones_ant || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Retenciones no aplicadas ejercicio anterior</label>
          <input class="form-input" type="number" step="0.01" name="retenciones_ant" value="${Number(b.retenciones_ant || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">UIT del ejercicio</label>
          <input class="form-input" type="number" step="0.01" name="uit" value="${Number(b.uit || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Coeficiente de renta (0 = automático)</label>
          <input class="form-input" type="number" step="0.0001" name="coeficiente_renta" value="${Number(b.coeficiente_renta || 0).toFixed(4)}"></div>
        <label class="permission-item" style="margin-top:var(--space-3);">
          <input type="checkbox" name="is_manual_initial_balance" ${b.is_manual_initial_balance ? 'checked' : ''}>
          <span class="permission-item__box">${ICONS.check}</span>
          <span class="permission-item__label">Saldos iniciales ingresados manualmente</span>
        </label>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--color-border);">
          <button type="button" class="btn" data-close-saldos>Cancelar</button>
          <button type="submit" class="btn btn--primary">${ICONS.check} Guardar saldos</button>
        </div>
      </form>`;
    const { dialog, close } = openModal('Saldos iniciales y configuración', body);
    dialog.querySelector('[data-close-saldos]').addEventListener('click', close);
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await declaracionesService.saveBalances(state.year, {
        saldo_igv_anterior: Number(fd.get('saldo_igv_anterior') || 0),
        percepciones_ant: Number(fd.get('percepciones_ant') || 0),
        retenciones_ant: Number(fd.get('retenciones_ant') || 0),
        uit: Number(fd.get('uit') || 0),
        coeficiente_renta: Number(fd.get('coeficiente_renta') || 0),
        is_manual_initial_balance: fd.get('is_manual_initial_balance') === 'on',
      });
      showToast('Saldos iniciales guardados.');
      close();
    });
  }

  function openAjustes(mes) {
    const m = state.data.timeline.months.find((x) => x.mes === mes);
    if (!m) return;
    const body = `
      <form data-ajustes-form>
        <div class="form-group"><label class="form-label">Pagos previos (IGV)</label>
          <input class="form-input" type="number" step="0.01" name="pagos_previos" value="${Number(m.pagosPrevios || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Interés moratorio (IGV)</label>
          <input class="form-input" type="number" step="0.01" name="intereses" value="${Number(m.intereses || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Pagos previos (Renta)</label>
          <input class="form-input" type="number" step="0.01" name="pagos_previos_renta" value="${Number(m.pagosPreviosRenta || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Interés moratorio (Renta)</label>
          <input class="form-input" type="number" step="0.01" name="intereses_renta" value="${Number(m.interesesRenta || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Estado</label>
          <select class="form-input" name="estado">
            <option value="calculado"${m.estado === 'calculado' ? ' selected' : ''}>Calculado</option>
            <option value="cerrado"${m.estado === 'cerrado' ? ' selected' : ''}>Cerrado</option>
          </select></div>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--color-border);">
          <button type="button" class="btn" data-close-ajustes>Cancelar</button>
          <button type="submit" class="btn btn--primary">${ICONS.check} Guardar</button>
        </div>
      </form>`;
    const { dialog, close } = openModal(`Ajustes · ${MONTHS[mes - 1]} ${state.year}`, body);
    dialog.querySelector('[data-close-ajustes]').addEventListener('click', close);
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await declaracionesService.savePeriod(state.year, mes, {
        pagos_previos: Number(fd.get('pagos_previos') || 0),
        intereses: Number(fd.get('intereses') || 0),
        pagos_previos_renta: Number(fd.get('pagos_previos_renta') || 0),
        intereses_renta: Number(fd.get('intereses_renta') || 0),
        estado: fd.get('estado') || 'calculado',
      });
      showToast('Ajustes guardados.');
      close();
    });
  }

  function exportCsv() {
    const months = state.data.timeline.months;
    const headers = ['Concepto', ...MONTHS, 'Total'];
    const rows = MATRIX_ROWS.filter((r) => r.key).map((row) => {
      const vals = months.map((m) => Number(row.get(m) || 0).toFixed(2));
      const total = vals.reduce((a, v) => a + Number(v), 0).toFixed(2);
      return [row.label, ...vals, total];
    });
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LIQUIDACION_${state.year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------- Eventos ------------------------- */

  content.addEventListener('click', (e) => {
    const monthBtn = e.target.closest('[data-month]');
    if (monthBtn) { openFicha(Number(monthBtn.dataset.month)); return; }
    if (e.target.closest('[data-saldos]')) { openSaldos(); return; }
    if (e.target.closest('[data-export]')) { exportCsv(); return; }
  });

  content.addEventListener('change', (e) => {
    if (e.target.matches('[data-year]')) {
      state.year = Number(e.target.value) || CURRENT_YEAR;
      load();
    }
  });

  load();
}

export default { title: 'Declaraciones SUNAT', render };
