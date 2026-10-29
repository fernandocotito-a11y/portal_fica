/* ============================================================================
   declaracionesView.js — Declaraciones SUNAT · Liquidación IGV / Renta (621)
   ----------------------------------------------------------------------------
   Pestañas:
     1. Matriz anual      Liquidación Enero → Diciembre (reporte completo).
     2. PDT 621           Formulario mensual con casillas, listo para copiar /
                          imprimir y pasar los datos a SUNAT.
     3. Control           Fechas de vencimiento/declaración y cálculo del
                          interés moratorio (TIM 0.04% diario).
     4. Saldos            Arrastre de crédito fiscal, percepciones y retenciones
                          no aplicadas, mes a mes.
   El IGV de ventas/compras es clicable para ver su composición por tasa
   (18% / 10% / otras) según cada comprobante.
   ========================================================================== */

import { declaracionesService } from './declaracionesService.js';
import { authService } from '../../services/authService.js';
import { MONTHS, docTypeLabel } from '../compras/comprasConfig.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const fmt = (v) => Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => `${(Number(v || 0) * 100).toFixed(2)}%`;
// Monto con negativos entre paréntesis (estilo PDT 621).
const money = (v) => {
  const n = Number(v || 0);
  return n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
};
const raw2 = (v) => Number(v || 0).toFixed(2);

/* Filas de la matriz anual (reporte completo). */
const MATRIX_ROWS = [
  { section: 'IGV' },
  { key: 'igvVentas', label: 'IGV VENTAS', get: (m) => m.igvVentas, detail: 'venta' },
  { key: 'igvCompras', label: '(-) IGV COMPRAS', get: (m) => m.igvCompras, minus: true, detail: 'compra' },
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

/* Casillas del Formulario Virtual 621, en el orden del formulario.
   Cada fila tiene Base y Tributo; la casilla va dentro de cada celda.
   Las casillas 101/103/131 y 108/111/115/117/178 son Tributo (IGV). */
const FICHA = [
  { section: 'IGV · Ventas' },
  {
    label: 'Ventas netas gravadas',
    base: { casilla: '100', value: (m) => m.pdt?.ventas?.c100 || 0 },
    tributo: { casilla: '101', value: (m) => m.pdt?.ventas?.c101 || 0, detail: 'venta' },
  },
  {
    label: 'Descuentos concedidos y/o devoluciones de ventas',
    base: { casilla: '102', value: (m) => m.pdt?.ventas?.c102 || 0 },
    tributo: { casilla: '103', value: (m) => m.pdt?.ventas?.c103 || 0 },
  },
  {
    label: 'Exportaciones facturadas en el periodo',
    base: { casilla: '106', value: (m) => m.pdt?.ventas?.c106 || 0 },
  },
  {
    label: 'Exportaciones embarcadas en el periodo',
    base: { casilla: '127', value: (m) => m.pdt?.ventas?.c127 || 0 },
  },
  {
    label: 'Ventas no gravadas (sin considerar exportaciones)',
    base: { casilla: '105', value: (m) => m.pdt?.ventas?.c105 || 0 },
  },
  {
    label: 'Ventas no gravadas (sin efecto en ratio)',
    base: { casilla: '109', value: (m) => m.pdt?.ventas?.c109 || 0 },
  },
  {
    label: 'Otras ventas (inciso ii) numeral 6.2 art. 6 del reglamento',
    base: { casilla: '112', value: (m) => m.pdt?.ventas?.c112 || 0 },
  },
  {
    label: 'Total IGV ventas',
    tributo: { casilla: '131', value: (m) => m.pdt?.ventas?.c131 || 0, strong: true },
  },

  { section: 'IGV · Compras' },
  {
    label: 'Compras netas destinadas a ventas gravadas exclusivamente',
    base: { casilla: '107', value: (m) => m.pdt?.compras?.c107 || 0 },
    tributo: { casilla: '108', value: (m) => m.pdt?.compras?.c108 || 0, detail: 'compra' },
  },
  {
    label: 'Compras netas destinadas a ventas gravadas y no gravadas',
    base: { casilla: '110', value: (m) => m.pdt?.compras?.c110 || 0 },
    tributo: { casilla: '111', value: (m) => m.pdt?.compras?.c111 || 0, detail: 'compra' },
  },
  {
    label: 'Compras netas destinadas a ventas no gravadas exclusivamente',
    base: { casilla: '113', value: (m) => m.pdt?.compras?.c113 || 0 },
  },
  {
    label: 'Compras netas importadas destinadas a ventas gravadas exclusivamente',
    base: { casilla: '114', value: (m) => m.pdt?.compras?.c114 || 0 },
    tributo: { casilla: '115', value: (m) => m.pdt?.compras?.c115 || 0, detail: 'compra' },
  },
  {
    label: 'Compras netas importadas destinadas a ventas gravadas y no gravadas',
    base: { casilla: '116', value: (m) => m.pdt?.compras?.c116 || 0 },
    tributo: { casilla: '117', value: (m) => m.pdt?.compras?.c117 || 0, detail: 'compra' },
  },
  {
    label: 'Compras netas importadas destinadas a ventas no gravadas exclusivamente',
    base: { casilla: '119', value: (m) => m.pdt?.compras?.c119 || 0 },
  },
  {
    label: 'Compras netas internas no gravadas',
    base: { casilla: '120', value: (m) => m.pdt?.compras?.c120 || 0 },
  },
  {
    label: 'Compras netas importadas no gravadas',
    base: { casilla: '122', value: (m) => m.pdt?.compras?.c122 || 0 },
  },
  {
    label: 'Total IGV compras',
    tributo: { casilla: '178', value: (m) => m.pdt?.compras?.c178 || 0, strong: true },
  },

  { section: 'Renta · Régimen MYPE Tributario' },
  {
    label: 'Ingresos netos',
    base: { casilla: '301', value: (m) => m.pdt?.renta?.c301 || 0 },
    tributo: { casilla: '312', value: (m) => m.pdt?.renta?.c312 || 0, strong: true },
  },
  {
    label: 'Coeficiente',
    base: { casilla: '380', value: (m) => m.pdt?.renta?.c380 || 0, fmt: 'raw' },
  },
  {
    label: 'Porcentaje',
    base: { casilla: '315', value: (m) => m.pdt?.renta?.c315 || 0, fmt: 'pct' },
  },

  { section: 'Determinación del IGV' },
  {
    label: 'Impuesto resultante o saldo a favor',
    tributo: { casilla: '140', value: (m) => m.pdt?.igv?.c140 || 0, strong: true },
  },
  {
    label: 'Saldo a favor del periodo anterior',
    tributo: { casilla: '145', value: (m) => m.pdt?.igv?.c145 || 0 },
  },
  {
    label: 'Tributo a pagar o saldo a favor',
    tributo: { casilla: '184', value: (m) => m.pdt?.igv?.c184 || 0, strong: true },
  },
  {
    label: 'Percepciones declaradas en el periodo',
    tributo: { casilla: '171', value: (m) => m.pdt?.igv?.c171 || 0 },
  },
  {
    label: 'Saldo de percepciones de periodos anteriores',
    tributo: { casilla: '168', value: (m) => m.pdt?.igv?.c168 || 0 },
  },
  {
    label: 'Saldo de percepciones no aplicadas',
    tributo: { casilla: '164', value: (m) => m.pdt?.igv?.c164 || 0 },
  },
  {
    label: 'Retenciones declaradas en el periodo',
    tributo: { casilla: '179', value: (m) => m.pdt?.igv?.c179 || 0 },
  },
  {
    label: 'Saldo de retenciones de periodos anteriores',
    tributo: { casilla: '176', value: (m) => m.pdt?.igv?.c176 || 0 },
  },
  {
    label: 'Saldo de retenciones no aplicadas',
    tributo: { casilla: '165', value: (m) => m.pdt?.igv?.c165 || 0 },
  },
  {
    label: 'Sub total',
    tributo: { casilla: '681', value: (m) => m.pdt?.igv?.c681 || 0, strong: true },
  },
  {
    label: 'Pagos previos',
    tributo: { casilla: '185', value: (m) => m.pdt?.igv?.c185 || 0 },
  },
  {
    label: 'Interés moratorio',
    tributo: { casilla: '187', value: (m) => m.pdt?.igv?.c187 || 0 },
  },
  {
    label: 'Total deuda tributaria',
    tributo: { casilla: '188', value: (m) => m.pdt?.igv?.c188 || 0, strong: true },
    hl: true,
  },
  {
    label: 'Importe a pagar',
    tributo: { casilla: '189', value: (m) => m.pdt?.igv?.c189 || 0, strong: true },
    hl: true,
  },

  { section: 'Determinación de la Renta' },
  {
    label: 'Impuesto resultante o saldo a favor',
    tributo: { casilla: '302', value: (m) => m.pdt?.renta?.c302 || 0, strong: true },
  },
  {
    label: 'Saldo a favor del periodo anterior',
    tributo: { casilla: '303', value: (m) => m.pdt?.renta?.c303 || 0 },
  },
  {
    label: 'Renta a pagar o saldo a favor',
    tributo: { casilla: '304', value: (m) => m.pdt?.renta?.c304 || 0, strong: true },
  },
  {
    label: 'Retenciones de tercera declaradas en el periodo',
    tributo: { casilla: '326', value: (m) => m.pdt?.renta?.c326 || 0 },
  },
  {
    label: 'Retenciones de tercera declaradas en periodos anteriores',
    tributo: { casilla: '327', value: (m) => m.pdt?.renta?.c327 || 0 },
  },
  {
    label: 'Compensación saldo a favor del exportador',
    tributo: { casilla: '305', value: (m) => m.pdt?.renta?.c305 || 0 },
  },
  {
    label: 'Impuesto Temporal a los Activos Netos',
    tributo: { casilla: '328', value: (m) => m.pdt?.renta?.c328 || 0 },
  },
  {
    label: 'Otros créditos permitidos por ley',
    tributo: { casilla: '306', value: (m) => m.pdt?.renta?.c306 || 0 },
  },
  {
    label: 'Sub total',
    tributo: { casilla: '682', value: (m) => m.pdt?.renta?.c682 || 0, strong: true },
  },
  {
    label: 'Pagos previos',
    tributo: { casilla: '317', value: (m) => m.pdt?.renta?.c317 || 0 },
  },
  {
    label: 'Interés moratorio',
    tributo: { casilla: '319', value: (m) => m.pdt?.renta?.c319 || 0 },
  },
  {
    label: 'Total deuda tributaria',
    tributo: { casilla: '324', value: (m) => m.pdt?.renta?.c324 || 0, strong: true },
    hl: true,
  },
  {
    label: 'Importe a pagar',
    tributo: { casilla: '307', value: (m) => m.pdt?.renta?.c307 || 0, strong: true },
    hl: true,
  },
];

function yearOptions() {
  const years = [];
  for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 4; y -= 1) years.push(y);
  return years;
}

function statusInfo(m) {
  if (m.estado === 'declarado') return { label: 'Declarado', cls: 'badge--active' };
  if (m.fechaVencimiento && TODAY > m.fechaVencimiento) return { label: 'Vencido', cls: 'badge--gold' };
  return { label: 'Pendiente', cls: 'badge--muted' };
}

function openModal(title, bodyHtml) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal modal--wide';
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function render(root) {
  const company = authService.activeCompany() || {};
  const state = {
    year: CURRENT_YEAR,
    tab: 'matriz',
    pdtMes: null,
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
      <div class="tabs-bar" data-tabs>
        <button type="button" class="tab-btn is-active" data-tab="matriz">Matriz anual</button>
        <button type="button" class="tab-btn" data-tab="pdt">PDT 621</button>
        <button type="button" class="tab-btn" data-tab="control">Control de declaraciones</button>
        <button type="button" class="tab-btn" data-tab="saldos">Saldos de créditos</button>
      </div>
      <div data-content></div>
    </div>`;

  const viewRoot = root.querySelector('[data-decl-root]');
  const content = viewRoot.querySelector('[data-content]');
  const tabsEl = viewRoot.querySelector('[data-tabs]');

  function setTab(tab) {
    state.tab = tab;
    [...tabsEl.querySelectorAll('[data-tab]')].forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    renderContent();
  }

  function goPdt(mes) {
    if (mes) state.pdtMes = Number(mes);
    setTab('pdt');
  }

  async function load() {
    state.busy = true;
    state.error = '';
    renderContent();
    try {
      state.data = await declaracionesService.refresh(state.year);
      ensurePdtMes();
    } catch (err) {
      state.error = err.message || String(err);
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  function ensurePdtMes() {
    if (!state.data) return;
    const months = state.data.timeline.months;
    if (state.pdtMes && months.some((m) => m.mes === state.pdtMes)) return;
    const withData = months.filter((m) => m.igvVentas || m.igvCompras || m.retencionesMes || m.percepcionesMes || m.ventasNetasMes);
    const last = withData[withData.length - 1];
    state.pdtMes = last ? last.mes : (state.year === CURRENT_YEAR ? now.getMonth() + 1 : 1);
  }

  /* ----------------------------- Matriz ----------------------------- */

  function cellText(row, m) {
    if (row.pct) return pct(row.get(m));
    const v = Number(row.get(m) || 0);
    if (row.minus) return v === 0 ? '0.00' : `(${fmt(Math.abs(v))})`;
    return money(v);
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

  function matrixHtml() {
    const months = state.data.timeline.months;

    const head = `
      <thead>
        <tr>
          <th class="sticky-col">Concepto</th>
          ${months.map((m, i) => `
            <th class="cell-num month-click" data-open-month="${m.mes}" title="Abrir PDT 621 de ${escapeHtml(MONTHS[i])}">
              ${escapeHtml(MONTHS[i])}<div class="text-muted" style="font-size:var(--font-size-xs);">${String(m.mes).padStart(2, '0')}/${m.anio}</div>
            </th>`).join('')}
          <th class="cell-num total-col">Total</th>
        </tr>
      </thead>`;

    const bodyRows = MATRIX_ROWS.map((row) => {
      if (row.section) {
        return `<tr class="section-row"><td class="sticky-col" colspan="${months.length + 2}">${escapeHtml(row.section)}</td></tr>`;
      }
      const cells = months.map((m) => {
        const strong = row.strong ? ' cell-strong' : '';
        if (row.detail) {
          return `<td class="cell-num igv-click${strong}" data-igv="${row.detail}" data-igv-mes="${m.mes}" title="Ver composición por tasa">${cellText(row, m)}</td>`;
        }
        return `<td class="cell-num${strong}">${cellText(row, m)}</td>`;
      }).join('');
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

  function yearSelector() {
    return `
      <div>
        <label class="form-label" for="decl-year">Ejercicio</label>
        <select class="form-input" data-year style="max-width:140px;">
          ${yearOptions().map((y) => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>`;
  }

  function toolbarHtml() {
    return `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-end;">
          ${yearSelector()}
          <div class="text-muted" style="font-size:var(--font-size-sm);">
            UIT ${fmt(state.data.balances.uit)} · Renta RMT: 1.00% hasta 300 UIT, 1.50% por encima
          </div>
          <div style="margin-left:auto;display:flex;gap:var(--space-2);">
            <button type="button" class="btn" data-saldos>${ICONS.edit} Saldos iniciales</button>
            <button type="button" class="btn" data-export>${ICONS.arrowRight} Exportar</button>
          </div>
        </div>
      </div>`;
  }

  function localBanner() {
    if (declaracionesService.mode !== 'local') return '';
    return `<div class="card" style="border-color:var(--color-gold);margin-bottom:var(--space-4);"><div class="card__body">
        La tabla <code>tax_declaration_periods</code> todavía no existe en Supabase. Los saldos y ajustes se guardan solo en este navegador.
        Ejecuta <code>supabase/declaraciones_schema.sql</code> en el SQL Editor y recarga el portal para activar el modo multiusuario.
      </div></div>`;
  }

  function renderMatriz() {
    content.innerHTML = `
      ${toolbarHtml()}
      ${localBanner()}
      ${statsHtml()}
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Liquidación tributaria anual ${state.year}</h3>
            <p class="card__subtitle">Clic en un mes para abrir el PDT 621. Clic en un IGV para ver su composición por tasa.</p>
          </div>
        </div>
        <div class="card__body" style="padding:0;">
          ${matrixHtml()}
        </div>
      </div>`;
  }

  /* ------------------------------ PDT 621 ------------------------------ */

  function pdtCellValue(cell, m) {
    return Number(cell.value(m) || 0);
  }

  function pdtCellText(cell, m) {
    const v = pdtCellValue(cell, m);
    if (cell.fmt === 'pct') return pct(v);
    if (cell.fmt === 'raw') return v.toFixed(4);
    return money(v);
  }

  function pdtCellRaw(cell, m) {
    const v = pdtCellValue(cell, m);
    if (cell.fmt === 'pct') return (v * 100).toFixed(2);
    if (cell.fmt === 'raw') return v.toFixed(4);
    return v.toFixed(2);
  }

  function pdtCellHtml(cell, m) {
    if (!cell) return '<span class="text-muted">—</span>';
    const cls = ['pdt-amount', cell.strong ? 'cell-strong' : '', cell.detail ? 'igv-click' : ''].filter(Boolean).join(' ');
    const attrs = cell.detail
      ? ` data-igv="${cell.detail}" data-igv-mes="${m.mes}" title="Ver composición por tasa"`
      : '';
    return `<span class="casilla-tag">${cell.casilla}</span> <span class="${cls}"${attrs}>${pdtCellText(cell, m)}</span>`;
  }

  function fichaTableHtml(m) {
    const rows = FICHA.map((r) => {
      if (r.section) return `<tr class="section-row"><td colspan="3">${escapeHtml(r.section)}</td></tr>`;
      return `<tr class="${r.hl ? 'row-hl' : ''}">
        <td>${escapeHtml(r.label)}</td>
        <td class="cell-num">${pdtCellHtml(r.base, m)}</td>
        <td class="cell-num">${pdtCellHtml(r.tributo, m)}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap">
      <table class="table decl-pdt">
        <thead><tr><th>Concepto</th><th class="cell-num">Base</th><th class="cell-num">Tributo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="text-muted" style="padding:var(--space-3);font-size:var(--font-size-xs);border-top:1px solid var(--color-border);">
      El número de casilla aparece en dorado dentro de cada columna. Los descuentos y notas de crédito se muestran aparte en 102 (base) y 103 (IGV).
    </div>`;
  }

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

  function pdtTsv(m) {
    const lines = [
      `PDT 621 - ${MONTHS[m.mes - 1]} ${m.anio} - RUC ${company.ruc || ''}`,
      ['Concepto', 'Casilla Base', 'Base', 'Casilla Tributo', 'Tributo'].join('\t'),
    ];
    for (const r of FICHA) {
      if (r.section) { lines.push(`# ${r.section}`); continue; }
      lines.push([
        r.label,
        r.base?.casilla || '',
        r.base ? pdtCellRaw(r.base, m) : '',
        r.tributo?.casilla || '',
        r.tributo ? pdtCellRaw(r.tributo, m) : '',
      ].join('\t'));
    }
    return lines.join('\n');
  }

  function printPdt(m) {
    const rowsHtml = FICHA.map((r) => {
      if (r.section) return `<tr class="sec"><td colspan="3">${escapeHtml(r.section)}</td></tr>`;
      const base = r.base ? `<span class="c">${r.base.casilla}</span> ${pdtCellText(r.base, m)}` : '';
      const tributo = r.tributo ? `<span class="c">${r.tributo.casilla}</span> ${pdtCellText(r.tributo, m)}` : '';
      return `<tr><td>${escapeHtml(r.label)}</td><td class="n">${base}</td><td class="n">${tributo}</td></tr>`;
    }).join('');
    const win = window.open('', '_blank');
    if (!win) { showToast('Permite las ventanas emergentes para imprimir.', 'error'); return; }
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>PDT 621 ${m.mes}/${m.anio}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;padding:24px;font-size:12px}
        h1{font-size:16px;margin:0 0 2px} h2{font-size:12px;font-weight:normal;color:#555;margin:0 0 16px}
        table{width:100%;border-collapse:collapse} th,td{border:1px solid #cbd5e1;padding:4px 6px}
        th{background:#f1f5f9;text-align:left} td.n{text-align:right;font-variant-numeric:tabular-nums}
        span.c{color:#92400e;font-weight:bold}
        tr.sec td{background:#e2e8f0;font-weight:bold}
      </style></head><body>
      <h1>Formulario Virtual 621 · ${escapeHtml(MONTHS[m.mes - 1])} ${m.anio}</h1>
      <h2>${escapeHtml(company.name || '')} · RUC ${escapeHtml(company.ruc || '')}</h2>
      <table><thead><tr><th>Concepto</th><th style="text-align:right">Base</th><th style="text-align:right">Tributo</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  function renderPdt() {
    ensurePdtMes();
    const m = state.data.timeline.months.find((x) => x.mes === state.pdtMes) || state.data.timeline.months[0];
    const st = statusInfo(m);
    content.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-end;">
          ${yearSelector()}
          <div>
            <label class="form-label" for="decl-pdt-month">Periodo</label>
            <select class="form-input" data-pdt-month style="max-width:180px;">
              ${state.data.timeline.months.map((x) => `<option value="${x.mes}"${x.mes === m.mes ? ' selected' : ''}>${escapeHtml(MONTHS[x.mes - 1])} ${x.anio}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <span class="badge ${st.cls}"><span class="badge__dot"></span>${st.label}</span>
            <span class="text-muted" style="font-size:var(--font-size-sm);">Vence ${m.fechaVencimiento || '—'}${m.fechaDeclaracion ? ` · Declarado ${m.fechaDeclaracion}` : ''}</span>
          </div>
          <div style="margin-left:auto;display:flex;gap:var(--space-2);">
            <button type="button" class="btn" data-periodo="${m.mes}">${ICONS.edit} Control / fechas</button>
            <button type="button" class="btn" data-copy-pdt="${m.mes}">${ICONS.check} Copiar datos</button>
            <button type="button" class="btn btn--primary" data-print-pdt="${m.mes}">${ICONS.arrowRight} Imprimir</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__header"><div><h4 class="card__title" style="font-size:var(--font-size-md);">Resumen del control</h4>
          <p class="card__subtitle">Cascada de determinación del IGV del periodo.</p></div></div>
        <div class="card__body" style="padding:0;">
          <table class="table">
            <thead><tr><th>Concepto</th><th class="cell-num">Importe (S/)</th></tr></thead>
            <tbody>${compactHtml(m)}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card__header"><div><h4 class="card__title" style="font-size:var(--font-size-md);">Formulario Virtual 621 · ${escapeHtml(MONTHS[m.mes - 1])} ${m.anio}</h4>
          <p class="card__subtitle">Formulario completo con columnas Base y Tributo. Clic en las casillas 101, 108, 111, 115 o 117 para ver el IGV por tasa.</p></div></div>
        <div class="card__body" style="padding:0;">
          ${fichaTableHtml(m)}
        </div>
      </div>`;
  }

  /* --------------------------- Control --------------------------- */

  function renderControl() {
    const months = state.data.timeline.months;
    const totalInt = months.reduce((a, m) => a + Number(m.intereses || 0) + Number(m.interesesRenta || 0), 0);
    const crono = declaracionesService.cronograma(state.year);
    const cronoWhen = crono.fetchedAt ? new Date(crono.fetchedAt).toLocaleString('es-PE') : '';
    const rows = months.map((m) => {
      const st = statusInfo(m);
      return `<tr>
        <td class="cell-strong">${escapeHtml(MONTHS[m.mes - 1])}</td>
        <td>${m.fechaVencimiento || '—'}</td>
        <td>${m.fechaDeclaracion || '—'}</td>
        <td class="cell-num ${m.diasAtraso > 0 ? 'text-danger' : ''}">${m.diasAtraso || 0}</td>
        <td class="cell-num">${fmt(m.intereses)}</td>
        <td class="cell-num">${fmt(m.interesesRenta)}</td>
        <td><span class="badge ${st.cls}"><span class="badge__dot"></span>${st.label}</span></td>
        <td class="cell-num"><button type="button" class="btn btn--sm" data-periodo="${m.mes}">${ICONS.edit} Editar</button></td>
      </tr>`;
    }).join('');
    content.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-end;">
          ${yearSelector()}
          <div class="text-muted" style="font-size:var(--font-size-sm);">
            El interés se calcula con los días de atraso entre el vencimiento y la fecha real de declaración
            (TIM ${(Number(state.data.timeline.months[0]?.tasaInteres || 0.0004) * 100).toFixed(2)}% diario).
            Si aún no se declaró, se proyecta a hoy (${TODAY}).
          </div>
          <div style="margin-left:auto;text-align:right;">
            <div class="text-muted" style="font-size:var(--font-size-xs);">Interés acumulado del año</div>
            <div class="cell-strong" style="font-size:var(--font-size-lg);">S/ ${fmt(totalInt)}</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;">
          <div>
            <div class="cell-strong">Cronograma de vencimientos ${state.year}</div>
            <div class="text-muted" style="font-size:var(--font-size-sm);">
              ${escapeHtml(crono.label)}${cronoWhen ? ` · actualizado ${escapeHtml(cronoWhen)}` : ''} ·
              <a href="${escapeHtml(crono.url)}" target="_blank" rel="noopener">ver cronograma en SUNAT</a>
            </div>
          </div>
          <button type="button" class="btn" style="margin-left:auto;" data-sync-crono>${ICONS.arrowRight} Actualizar desde SUNAT</button>
        </div>
      </div>
      <div class="card">
        <div class="card__header"><div><h3 class="card__title">Control de declaraciones ${state.year}</h3>
          <p class="card__subtitle">Vencimiento según cronograma oficial SUNAT; puedes ajustar la fecha real de declaración.</p></div></div>
        <div class="card__body" style="padding:0;">
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>Periodo</th><th>Vencimiento</th><th>Declaración</th><th class="cell-num">Días atraso</th>
                <th class="cell-num">Interés IGV</th><th class="cell-num">Interés Renta</th><th>Estado</th><th></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  /* ---------------------------- Saldos ---------------------------- */

  function saldosTable(title, subtitle, head, bodyRows) {
    return `<div class="card" style="margin-bottom:var(--space-4);">
      <div class="card__header"><div><h4 class="card__title" style="font-size:var(--font-size-md);">${escapeHtml(title)}</h4>
        <p class="card__subtitle">${escapeHtml(subtitle)}</p></div></div>
      <div class="card__body" style="padding:0;">
        <div class="table-wrap"><table class="table">
          <thead><tr>${head}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table></div>
      </div>
    </div>`;
  }

  function renderSaldos() {
    const months = state.data.timeline.months;

    const igvRows = months.map((m) => {
      const aplicado = Math.min(Number(m.saldoIgvAnterior || 0), Math.max(0, Number(m.preliminar || 0)));
      return `<tr>
        <td class="cell-strong">${escapeHtml(MONTHS[m.mes - 1])}</td>
        <td class="cell-num">${fmt(m.saldoIgvAnterior)}</td>
        <td class="cell-num">${money(m.preliminar)}</td>
        <td class="cell-num">${fmt(aplicado)}</td>
        <td class="cell-num cell-strong">${fmt(m.saldoFavorPeriodo)}</td>
      </tr>`;
    }).join('');

    const percepRows = months.map((m) => `<tr>
        <td class="cell-strong">${escapeHtml(MONTHS[m.mes - 1])}</td>
        <td class="cell-num">${fmt(m.percepcionesAnterior)}</td>
        <td class="cell-num">${fmt(m.percepcionesMes)}</td>
        <td class="cell-num">${fmt(m.percepAplic)}</td>
        <td class="cell-num cell-strong">${fmt(m.percepcionesNoAplicadas)}</td>
      </tr>`).join('');

    const retenRows = months.map((m) => `<tr>
        <td class="cell-strong">${escapeHtml(MONTHS[m.mes - 1])}</td>
        <td class="cell-num">${fmt(m.retencionesAnterior)}</td>
        <td class="cell-num">${fmt(m.retencionesMes)}</td>
        <td class="cell-num">${fmt(m.retenAplic)}</td>
        <td class="cell-num cell-strong">${fmt(m.retencionesNoAplicadas)}</td>
      </tr>`).join('');

    const last = months[months.length - 1] || {};
    content.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-end;">
          ${yearSelector()}
          <div class="text-muted" style="font-size:var(--font-size-sm);margin-left:auto;">
            Saldo final ${state.year}: crédito fiscal <strong>S/ ${fmt(last.saldoFavorPeriodo)}</strong> ·
            percepciones <strong>S/ ${fmt(last.percepcionesNoAplicadas)}</strong> ·
            retenciones <strong>S/ ${fmt(last.retencionesNoAplicadas)}</strong>
          </div>
        </div>
      </div>
      ${saldosTable('Crédito fiscal IGV (saldo a favor)', 'El saldo a favor se arrastra al mes siguiente cuando no alcanza a cubrir el IGV.',
        '<th>Mes</th><th class="cell-num">Saldo anterior</th><th class="cell-num">IGV del mes (140)</th><th class="cell-num">Aplicado</th><th class="cell-num">Saldo final</th>', igvRows)}
      ${saldosTable('Percepciones', 'Percepciones del periodo y arrastre de las no aplicadas (casillas 171 / 168 / 164).',
        '<th>Mes</th><th class="cell-num">Saldo anterior (168)</th><th class="cell-num">Del periodo (171)</th><th class="cell-num">Aplicado</th><th class="cell-num">No aplicado (164)</th>', percepRows)}
      ${saldosTable('Retenciones', 'Retenciones del periodo y arrastre de las no aplicadas (casillas 179 / 176 / 165).',
        '<th>Mes</th><th class="cell-num">Saldo anterior (176)</th><th class="cell-num">Del periodo (179)</th><th class="cell-num">Aplicado</th><th class="cell-num">No aplicado (165)</th>', retenRows)}`;
  }

  /* --------------------------- Contenido --------------------------- */

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
    if (state.tab === 'pdt') renderPdt();
    else if (state.tab === 'control') renderControl();
    else if (state.tab === 'saldos') renderSaldos();
    else renderMatriz();
  }

  /* ---------------------------- Modales ---------------------------- */

  function openIgvDetail(kind, mes) {
    const m = state.data.timeline.months.find((x) => x.mes === mes);
    if (!m) return;
    const period = `${state.year}${String(mes).padStart(2, '0')}`;
    const { groups, rows } = declaracionesService.igvDetail(kind, period);
    const kindLabel = kind === 'venta' ? 'IGV Ventas' : 'IGV Compras';

    const groupRows = groups.length
      ? groups.map((g) => `<tr>
          <td class="cell-strong">${escapeHtml(g.bucket)}</td>
          <td class="cell-num">${g.count}</td>
          <td class="cell-num">${fmt(g.base)}</td>
          <td class="cell-num cell-strong">${fmt(g.igv)}</td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="text-muted">Sin comprobantes en el periodo.</td></tr>`;

    const detailRows = rows.length
      ? rows.map((r) => `<tr>
          <td>${escapeHtml(r.issue_date || '—')}</td>
          <td>${escapeHtml(docTypeLabel(r.doc_type))}</td>
          <td>${escapeHtml(`${r.series || ''}-${r.number || ''}`)}</td>
          <td>${escapeHtml(r.counterparty_name || '—')}</td>
          <td class="cell-num">${fmt(r.base)}</td>
          <td class="cell-num">${fmt(r.igv)}</td>
          <td class="cell-num"><span class="badge badge--muted">${escapeHtml(r.bucket)}</span></td>
        </tr>`).join('')
      : `<tr><td colspan="7" class="text-muted">Sin comprobantes en el periodo.</td></tr>`;

    const body = `
      <div class="text-muted" style="font-size:var(--font-size-sm);margin-bottom:var(--space-3);">
        ${escapeHtml(MONTHS[mes - 1])} ${state.year} · La tasa se deduce de IGV ÷ base de cada comprobante.
      </div>
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card__header"><div><h4 class="card__title" style="font-size:var(--font-size-md);">Composición por tasa</h4></div></div>
        <div class="card__body" style="padding:0;">
          <table class="table">
            <thead><tr><th>Tasa</th><th class="cell-num">Comprobantes</th><th class="cell-num">Base</th><th class="cell-num">IGV</th></tr></thead>
            <tbody>${groupRows}</tbody>
          </table>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Fecha</th><th>Doc.</th><th>Serie-Número</th><th>Contraparte</th><th class="cell-num">Base</th><th class="cell-num">IGV</th><th class="cell-num">Tasa</th></tr></thead>
          <tbody>${detailRows}</tbody>
        </table>
      </div>`;
    openModal(`${kindLabel} · ${MONTHS[mes - 1]} ${state.year}`, body);
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
      try {
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
        await load();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function openPeriodo(mes) {
    const m = state.data.timeline.months.find((x) => x.mes === mes);
    if (!m) return;
    const body = `
      <form data-periodo-form>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
          <div class="form-group"><label class="form-label">Fecha de vencimiento</label>
            <input class="form-input" type="date" name="fecha_vencimiento" value="${escapeHtml(m.fechaVencimiento || '')}"></div>
          <div class="form-group"><label class="form-label">Fecha de declaración (real)</label>
            <input class="form-input" type="date" name="fecha_declaracion" value="${escapeHtml(m.fechaDeclaracion || '')}"></div>
        </div>
        <div class="form-group"><label class="form-label">Estado</label>
          <select class="form-input" name="estado">
            <option value="pendiente"${m.estado === 'pendiente' ? ' selected' : ''}>Pendiente</option>
            <option value="declarado"${m.estado === 'declarado' ? ' selected' : ''}>Declarado</option>
          </select></div>

        <label class="permission-item" style="margin-top:var(--space-2);">
          <input type="checkbox" name="interes_manual" ${m.interesManual ? 'checked' : ''} data-interes-toggle>
          <span class="permission-item__box">${ICONS.check}</span>
          <span class="permission-item__label">Usar interés manual (desactiva el cálculo automático)</span>
        </label>
        <div class="text-muted" style="font-size:var(--font-size-sm);margin:var(--space-2) 0 var(--space-3);">
          Cálculo automático: ${m.diasAtraso || 0} día(s) de atraso × ${((m.tasaInteres || 0.0004) * 100).toFixed(2)}% diario.
          Interés IGV estimado <strong>S/ ${fmt(m.interesesAuto)}</strong> · Renta <strong>S/ ${fmt(m.interesesRentaAuto)}</strong>.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);">
          <div class="form-group"><label class="form-label">Interés moratorio (IGV)</label>
            <input class="form-input" type="number" step="0.01" name="intereses" value="${Number(m.intereses || 0).toFixed(2)}" ${m.interesManual ? '' : 'disabled'}></div>
          <div class="form-group"><label class="form-label">Interés moratorio (Renta)</label>
            <input class="form-input" type="number" step="0.01" name="intereses_renta" value="${Number(m.interesesRenta || 0).toFixed(2)}" ${m.interesManual ? '' : 'disabled'}></div>
          <div class="form-group"><label class="form-label">Pagos previos (IGV)</label>
            <input class="form-input" type="number" step="0.01" name="pagos_previos" value="${Number(m.pagosPrevios || 0).toFixed(2)}"></div>
          <div class="form-group"><label class="form-label">Pagos previos (Renta)</label>
            <input class="form-input" type="number" step="0.01" name="pagos_previos_renta" value="${Number(m.pagosPreviosRenta || 0).toFixed(2)}"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--color-border);">
          <button type="button" class="btn" data-close-periodo>Cancelar</button>
          <button type="submit" class="btn btn--primary">${ICONS.check} Guardar</button>
        </div>
      </form>`;
    const { dialog, close } = openModal(`Control · ${MONTHS[mes - 1]} ${state.year}`, body);

    const toggle = dialog.querySelector('[data-interes-toggle]');
    const intIgv = dialog.querySelector('[name="intereses"]');
    const intRenta = dialog.querySelector('[name="intereses_renta"]');
    toggle.addEventListener('change', () => {
      intIgv.disabled = !toggle.checked;
      intRenta.disabled = !toggle.checked;
    });

    dialog.querySelector('[data-close-periodo]').addEventListener('click', close);
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const autoVenc = declaracionesService.defaultVencimiento(state.year, mes, authService.activeCompany()?.ruc);
      const typedVenc = String(fd.get('fecha_vencimiento') || '');
      try {
        await declaracionesService.savePeriod(state.year, mes, {
          // Si no se cambió la fecha, se guarda vacía para seguir el cronograma.
          fecha_vencimiento: typedVenc && typedVenc !== autoVenc ? typedVenc : '',
          fecha_declaracion: fd.get('fecha_declaracion') || '',
          estado: fd.get('estado') || 'pendiente',
          interes_manual: fd.get('interes_manual') === 'on',
          intereses: Number(fd.get('intereses') || 0),
          intereses_renta: Number(fd.get('intereses_renta') || 0),
          pagos_previos: Number(fd.get('pagos_previos') || 0),
          pagos_previos_renta: Number(fd.get('pagos_previos_renta') || 0),
        });
        showToast('Control del periodo guardado.');
        close();
        await load();
      } catch (err) {
        showToast(err.message, 'error');
      }
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

  async function syncCronograma(btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Consultando SUNAT…';
    try {
      const { updated } = await declaracionesService.syncCronograma(state.year);
      showToast(updated
        ? `Cronograma ${state.year} actualizado desde SUNAT (${updated} vencimiento(s) automático(s) recalibrado(s)).`
        : `Cronograma ${state.year} actualizado desde SUNAT.`);
      await load();
    } catch (err) {
      const needsDeploy = /404|not found|failed to fetch|no encontrada/i.test(String(err.message || ''));
      const hint = needsDeploy ? ' Vuelve a desplegar la Edge Function sunat-sire (acción "cronograma").' : '';
      showToast(`No se pudo descargar el cronograma: ${err.message}.${hint} Se mantiene el cronograma incluido.`, 'error');
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  /* ---------------------------- Eventos ---------------------------- */

  viewRoot.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }

    const openMonth = e.target.closest('[data-open-month]');
    if (openMonth) { goPdt(Number(openMonth.dataset.openMonth)); return; }

    const igv = e.target.closest('[data-igv]');
    if (igv) { openIgvDetail(igv.dataset.igv, Number(igv.dataset.igvMes)); return; }

    const periodo = e.target.closest('[data-periodo]');
    if (periodo) { openPeriodo(Number(periodo.dataset.periodo)); return; }

    if (e.target.closest('[data-saldos]')) { openSaldos(); return; }
    if (e.target.closest('[data-export]')) { exportCsv(); return; }

    const syncCrono = e.target.closest('[data-sync-crono]');
    if (syncCrono) { syncCronograma(syncCrono); return; }

    const copyBtn = e.target.closest('[data-copy-pdt]');
    if (copyBtn) {
      const m = state.data.timeline.months.find((x) => x.mes === Number(copyBtn.dataset.copyPdt));
      if (m) {
        copyText(pdtTsv(m)).then((ok) => {
          showToast(ok ? 'Datos del PDT 621 copiados. Ya puedes pegarlos en SUNAT.' : 'No se pudo copiar. Usa Imprimir.', ok ? 'success' : 'error');
        });
      }
      return;
    }

    const printBtn = e.target.closest('[data-print-pdt]');
    if (printBtn) {
      const m = state.data.timeline.months.find((x) => x.mes === Number(printBtn.dataset.printPdt));
      if (m) printPdt(m);
      return;
    }
  });

  viewRoot.addEventListener('change', async (e) => {
    if (e.target.matches('[data-year]')) {
      state.year = Number(e.target.value) || CURRENT_YEAR;
      state.pdtMes = null;
      await load();
      return;
    }
    if (e.target.matches('[data-pdt-month]')) {
      state.pdtMes = Number(e.target.value) || 1;
      renderContent();
    }
  });

  load();
}

export default { title: 'Declaraciones SUNAT', render };
