/* ============================================================================
   comprasView.js — Registro de Compras y Ventas (SIRE SUNAT)
   ----------------------------------------------------------------------------
   Pestañas:
     1. Compras        Registro del período con formato SUNAT editable.
     2. Ventas         Registro del período con formato SUNAT editable.
     3. Proveedores    Directorio para autocompletar RUC y razón social.
     4. Importar SIRE  Carga masiva de ZIP/CSV de la propuesta SIRE.
     5. Resumen        Totales mensuales, IGV y exportación.
   ========================================================================== */

import { taxService } from './taxService.js';
import { supplierService } from './supplierService.js';
import { parseSireFiles, dedupeKey, toCsvText } from './sireParser.js';
import {
  DOC_TYPES, DOC_ID_TYPES, CURRENCIES, STATES, NOTE_TYPES, MONTHS,
  docTypeLabel, stateLabel, periodLabel, periodToInput, inputToPeriod,
  baseGravadaOf, baseNoGravadaOf, igvOf, totalBaseOf,
} from './comprasConfig.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const now = new Date();
const CURRENT_PERIOD = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function num(value) {
  return Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displayDate(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function displayDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16).replace('T', ' ');
  return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}

function optionsHtml(list, selected, emptyLabel = '') {
  const items = [];
  if (emptyLabel !== null) items.push(`<option value="">${escapeHtml(emptyLabel || 'Todos')}</option>`);
  const found = list.some((o) => String(o.value) === String(selected));
  if (!found && selected !== '' && selected != null) {
    items.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
  }
  items.push(...list.map((o) => `<option value="${escapeHtml(o.value)}"${String(o.value) === String(selected) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`));
  return items.join('');
}

function baseOf(rec) {
  return totalBaseOf(rec, rec.kind);
}

/** Tipo de cambio a soles para consolidar totales. */
function penRate(rec) {
  if (String(rec.currency || 'PEN').toUpperCase() === 'PEN') return 1;
  const rate = Number(rec.exchange_rate || 0);
  return rate > 0 ? rate : 1;
}

/** Moneda extranjera sin tipo de cambio informado (1.00 es el valor por defecto). */
function hasMissingRate(rec) {
  return String(rec.currency || 'PEN').toUpperCase() !== 'PEN' && !(Number(rec.exchange_rate) > 1);
}

function basePenOf(rec) {
  return baseOf(rec) * penRate(rec);
}

function baseGravadaPenOf(rec) {
  return baseGravadaOf(rec, rec.kind) * penRate(rec);
}

function baseNoGravadaPenOf(rec) {
  return baseNoGravadaOf(rec, rec.kind) * penRate(rec);
}

function igvPenOf(rec) {
  return igvOf(rec) * penRate(rec);
}

function totalPenOf(rec) {
  return Number(rec.total || 0) * penRate(rec);
}

function moneyCell(value) {
  return `<span class="cell-num">${num(value)}</span>`;
}

export function render(root) {
  const company = authService.activeCompany() || {};
  const state = {
    tab: 'compra',
    period: CURRENT_PERIOD,
    periodTouched: false,
    search: '',
    docType: '',
    state: '',
    currency: '',
    page: 1,
    pageSize: 25,
    summaryYear: String(new Date().getFullYear()),
    supplierSearch: '',
    supplierPage: 1,
    supplierPageSize: 25,
  };
  let loading = true;
  let error = '';
  let supplierError = '';
  let supplierBusy = false;
  let parsed = null;
  let importStatus = '';
  let importBusy = false;
  let parseBusy = false;
  let modalType = 'record';
  let modalRecord = null;
  let modalSupplierRecord = null;
  let modalInitial = null;
  let modalReadonly = false;
  let modalKind = 'compra';

  root.innerHTML = `
    <div data-compras-root>
    <div class="page-heading">
      <div>
        <h2 class="page-heading__title">Compras y Ventas</h2>
        <p class="page-heading__subtitle">
          Registro SUNAT · ${escapeHtml(company.name || 'Empresa')} · RUC ${escapeHtml(company.ruc || '—')}
        </p>
      </div>
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center;">
        <span class="badge badge--muted" data-mode-badge><span class="badge__dot"></span>Conectando…</span>
        <button type="button" class="btn" data-import>${ICONS.arrowRight} Importar SIRE</button>
        <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Nuevo registro</button>
      </div>
    </div>

    <div class="tabs-bar" data-tabs>
      <button type="button" class="tab-btn is-active" data-tab="compra">Compras</button>
      <button type="button" class="tab-btn" data-tab="venta">Ventas</button>
      <button type="button" class="tab-btn" data-tab="proveedores">Proveedores</button>
      <button type="button" class="tab-btn" data-tab="importar">Importar SIRE</button>
      <button type="button" class="tab-btn" data-tab="resumen">Resumen</button>
    </div>

    <div data-content></div>

    <dialog class="modal modal--wide" data-modal></dialog>
    </div>
  `;

  const viewRoot = root.querySelector('[data-compras-root]');
  const content = viewRoot.querySelector('[data-content]');
  const modal = viewRoot.querySelector('[data-modal]');
  const tabsEl = viewRoot.querySelector('[data-tabs]');
  const modeBadge = viewRoot.querySelector('[data-mode-badge]');

  function updateModeBadge() {
    if (taxService.mode === 'local') {
      modeBadge.className = 'badge badge--gold';
      modeBadge.innerHTML = '<span class="badge__dot"></span>Modo local de prueba';
      modeBadge.title = 'Falta ejecutar supabase/compras_schema.sql en Supabase.';
    } else if (taxService.mode === 'remote') {
      modeBadge.className = 'badge badge--active';
      modeBadge.innerHTML = '<span class="badge__dot"></span>Supabase conectado';
      modeBadge.title = 'Los datos se guardan en Supabase con aislamiento por empresa.';
    } else {
      modeBadge.className = 'badge badge--muted';
      modeBadge.innerHTML = '<span class="badge__dot"></span>Conectando…';
    }
  }

  function localBanner() {
    if (taxService.mode !== 'local') return '';
    return `
      <div class="card" style="border-color:var(--color-gold);margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;gap:var(--space-3);align-items:flex-start;">
          <span style="color:var(--color-gold);flex-shrink:0;">${ICONS.info}</span>
          <div>
            <strong>Modo local de prueba.</strong>
            Las tablas <code>tax_records</code> y <code>tax_import_batches</code> todavía no existen en Supabase.
            Los registros se guardan solo en este navegador. Para activar el modo multiusuario con RLS,
            ejecuta <code>supabase/compras_schema.sql</code> en el SQL Editor de Supabase y recarga el portal.
            <div style="margin-top:var(--space-3);">
              <a class="btn" href="./supabase/compras_schema.sql" target="_blank" rel="noopener">${ICONS.arrowRight} Abrir SQL de instalación</a>
            </div>
          </div>
        </div>
      </div>`;
  }

  function ensurePeriod(forceLatest = false) {
    const all = taxService.all();
    const latest = all.map((r) => r.period).filter(Boolean).sort().pop();
    if (!latest) return;
    if (!all.some((r) => String(r.period || '').startsWith(state.summaryYear))) {
      state.summaryYear = latest.slice(0, 4);
    }
    if (forceLatest) {
      state.period = latest;
      state.periodTouched = true;
      return;
    }
    if (!state.periodTouched && !all.some((r) => r.period === state.period)) {
      state.period = latest;
    }
  }

  function filteredRows(kind = state.tab) {
    return taxService.list(kind, {
      period: state.period,
      search: state.search,
      docType: state.docType,
      state: state.state,
      currency: state.currency,
    });
  }

  function totalsFor(kind, period) {
    const rows = taxService.list(kind, { period });
    return rows.reduce((acc, r) => {
      acc.count += 1;
      acc.baseGravada += baseGravadaPenOf(r);
      acc.baseNoGravada += baseNoGravadaPenOf(r);
      acc.base += basePenOf(r);
      acc.igv += igvPenOf(r);
      acc.total += totalPenOf(r);
      acc.exonerated += Number(r.exonerated || 0) * penRate(r);
      acc.unaffected += Number(r.unaffected || 0) * penRate(r);
      return acc;
    }, { count: 0, baseGravada: 0, baseNoGravada: 0, base: 0, igv: 0, total: 0, exonerated: 0, unaffected: 0 });
  }

  function statsHtml(kind) {
    const rows = filteredRows(kind);
    const totals = rows.reduce((acc, r) => {
      acc.count += 1;
      acc.baseGravada += baseGravadaPenOf(r);
      acc.baseNoGravada += baseNoGravadaPenOf(r);
      acc.igv += igvPenOf(r);
      acc.total += totalPenOf(r);
      return acc;
    }, { count: 0, baseGravada: 0, baseNoGravada: 0, igv: 0, total: 0 });
    const missingRate = rows.filter(hasMissingRate).length;
    return `
      <div class="stat-card">
        <span class="stat-card__icon">${ICONS.briefcase}</span>
        <div><div class="stat-card__value">${totals.count}</div><div class="stat-card__label">Comprobantes del filtro</div></div>
      </div>
      <div class="stat-card">
        <span class="stat-card__icon">${ICONS.check}</span>
        <div><div class="stat-card__value">${num(totals.baseGravada)}</div><div class="stat-card__label">Base gravada (PEN)</div></div>
      </div>
      <div class="stat-card">
        <span class="stat-card__icon">${ICONS.info}</span>
        <div><div class="stat-card__value">${num(totals.baseNoGravada)}</div><div class="stat-card__label">Base no gravada (PEN)</div></div>
      </div>
      <div class="stat-card">
        <span class="stat-card__icon">${ICONS.info}</span>
        <div><div class="stat-card__value">${num(totals.igv)}</div><div class="stat-card__label">IGV / IPM (PEN)</div></div>
      </div>
      <div class="stat-card">
        <span class="stat-card__icon">${ICONS.arrowRight}</span>
        <div><div class="stat-card__value">${num(totals.total)}</div><div class="stat-card__label">Total PEN del período</div></div>
      </div>
      ${missingRate ? `<div class="stat-card" style="border-color:var(--color-gold);">
        <span class="stat-card__icon" style="color:var(--color-gold);">${ICONS.info}</span>
        <div><div class="stat-card__value">${missingRate}</div><div class="stat-card__label">Moneda extranjera sin TC (consolidado a la par)</div></div>
      </div>` : ''}`;
  }

  function registryRowsHtml(rows) {
    if (!rows.length) {
      return `<tr><td colspan="11">
        <div class="empty-state">
          <span class="empty-state__icon">${ICONS.building}</span>
          <div class="empty-state__title">Sin comprobantes en ${escapeHtml(periodLabel(state.period))}</div>
          <div class="empty-state__desc">Importa un archivo SIRE o agrega un registro manual.</div>
        </div>
      </td></tr>`;
    }
    return rows.map((r) => `
      <tr>
        <td style="white-space:nowrap;">${displayDate(r.issue_date)}<div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(r.period || '')}</div></td>
        <td>
          <strong>${escapeHtml(r.doc_type || '—')}</strong>
          <div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(docTypeLabel(r.doc_type).replace(/^\d+\s*·\s*/, ''))}</div>
        </td>
        <td>${escapeHtml(r.series || '—')}-${escapeHtml(r.number || '—')}${r.number_final ? `<div class="text-muted" style="font-size:var(--font-size-xs);">hasta ${escapeHtml(r.number_final)}</div>` : ''}</td>
        <td>${escapeHtml(r.doc_id_number || '—')}<div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(r.doc_id_type ? `Tipo ${r.doc_id_type}` : '')}</div></td>
        <td><div class="table__name">${escapeHtml(r.counterparty_name || '—')}</div></td>
        <td class="cell-num">${num(baseGravadaOf(r, r.kind))}</td>
        <td class="cell-num">${num(baseNoGravadaOf(r, r.kind))}</td>
        <td class="cell-num">${num(igvOf(r, r.kind))}</td>
        <td class="cell-num cell-strong">${num(r.total)}<div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(r.currency || 'PEN')}${hasMissingRate(r) ? ' · sin TC' : ''}</div></td>
        <td><span class="badge ${String(r.state) === '1' ? 'badge--active' : 'badge--muted'}">${escapeHtml(stateLabel(r.state))}</span></td>
        <td>
          <div class="table__actions">
            <button type="button" class="icon-btn" data-view="${escapeHtml(r.id)}" title="Ver detalle">${ICONS.eye}</button>
            <button type="button" class="icon-btn" data-edit="${escapeHtml(r.id)}" title="Editar">${ICONS.edit}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-del="${escapeHtml(r.id)}" title="Eliminar">${ICONS.trash}</button>
          </div>
        </td>
      </tr>`).join('');
  }

  function paginationHtml(total) {
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    const from = total ? (state.page - 1) * state.pageSize + 1 : 0;
    const to = Math.min(total, state.page * state.pageSize);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-top:var(--space-4);flex-wrap:wrap;">
        <span class="text-muted" style="font-size:var(--font-size-sm);">Mostrando ${from}–${to} de ${total}</span>
        <div style="display:flex;gap:var(--space-2);">
          <button type="button" class="btn" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="text-muted" style="padding:9px 4px;font-size:var(--font-size-sm);">Página ${state.page} de ${pages}</span>
          <button type="button" class="btn" data-page="next" ${state.page >= pages ? 'disabled' : ''}>Siguiente</button>
        </div>
      </div>`;
  }

  function updateRegistry() {
    const statsEl = content.querySelector('[data-stats]');
    if (!statsEl) return;
    statsEl.innerHTML = statsHtml(state.tab);
    const rows = filteredRows(state.tab);
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;
    const start = (state.page - 1) * state.pageSize;
    const pageRows = rows.slice(start, start + state.pageSize);
    const tbody = content.querySelector('[data-table-body]');
    if (tbody) tbody.innerHTML = registryRowsHtml(pageRows);
    const pag = content.querySelector('[data-pagination]');
    if (pag) pag.innerHTML = paginationHtml(rows.length);
    const count = content.querySelector('[data-filter-count]');
    if (count) count.textContent = `${rows.length} registro(s)`;
  }

  function renderRegistry() {
    const kind = state.tab;
    return `
      ${localBanner()}
      <div class="stats" data-stats>${statsHtml(kind)}</div>
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Registro de ${kind === 'compra' ? 'compras' : 'ventas'}</h3>
            <p class="card__subtitle" data-filter-count>${filteredRows(kind).length} registro(s)</p>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
            <button type="button" class="btn" data-export>${ICONS.arrowRight} Exportar CSV SUNAT</button>
            <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Agregar registro</button>
          </div>
        </div>
        <div class="card__body">
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">Período</label>
              <input type="month" class="form-input" data-period value="${escapeHtml(periodToInput(state.period))}" />
            </div>
            <div class="form-group" style="margin:0;min-width:240px;flex:1;">
              <label class="form-label">Buscar</label>
              <input class="form-input" data-search value="${escapeHtml(state.search)}" placeholder="RUC, razón social, serie o número…" />
            </div>
            <div class="form-group" style="margin:0;min-width:190px;">
              <label class="form-label">Tipo comprobante</label>
              <select class="form-input" data-filter-doc>${optionsHtml(DOC_TYPES, state.docType)}</select>
            </div>
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">Estado</label>
              <select class="form-input" data-filter-state>${optionsHtml(STATES, state.state)}</select>
            </div>
            <div class="form-group" style="margin:0;min-width:130px;">
              <label class="form-label">Moneda</label>
              <select class="form-input" data-filter-currency>${optionsHtml(CURRENCIES, state.currency)}</select>
            </div>
            <button type="button" class="btn" data-clear-filters>Limpiar</button>
          </div>
          <div class="table-wrap">
            <table class="table" style="min-width:1320px;">
              <thead>
                <tr>
                  <th>Fecha</th><th>Tipo</th><th>Serie / Número</th><th>Doc. contraparte</th>
                  <th>Razón social</th><th style="text-align:right;">Base gravada</th>
                  <th style="text-align:right;">Base no gravada</th><th style="text-align:right;">IGV</th>
                  <th style="text-align:right;">Total</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody data-table-body></tbody>
            </table>
          </div>
          <div data-pagination></div>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-3);">
            La tabla muestra los importes en la moneda original del comprobante. Los indicadores superiores se consolidan a soles (PEN) usando el tipo de cambio.
          </p>
        </div>
      </div>`;
  }

  function fileRowsHtml(files) {
    return files.map((f) => {
      const warnings = f.warnings || [];
      return `<tr>
        <td><div class="table__name" style="font-size:var(--font-size-sm);">${escapeHtml(f.fileName)}</div></td>
        <td>${f.kind ? `<span class="badge ${f.kind === 'compra' ? 'badge--active' : 'badge--gold'}">${f.kind === 'compra' ? 'Compra' : 'Venta'}</span>` : '<span class="badge badge--muted">No reconocido</span>'}</td>
        <td>${escapeHtml([...new Set((f.records || []).map((r) => r.period).filter(Boolean))].map(periodLabel).join(', ') || '—')}</td>
        <td class="cell-num">${(f.records || []).length}</td>
        <td class="cell-num">${f.duplicates || 0}</td>
        <td>${warnings.length ? `<span class="text-muted" title="${escapeHtml(warnings.join(' '))}">${warnings.length} aviso(s)</span>` : '<span class="badge badge--active">OK</span>'}</td>
      </tr>`;
    }).join('');
  }

  function previewRecordsHtml(records) {
    const preview = records.slice(0, 20);
    if (!preview.length) return '';
    return `
      <div class="table-wrap" style="margin-top:var(--space-4);max-height:420px;overflow:auto;">
        <table class="table" style="min-width:980px;">
          <thead><tr><th>Período</th><th>Tipo</th><th>Fecha</th><th>Comprobante</th><th>RUC / Doc.</th><th>Razón social</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>
            ${preview.map((r) => `<tr>
              <td>${escapeHtml(r.period || '—')}</td>
              <td>${escapeHtml(r.kind === 'compra' ? 'Compra' : 'Venta')}</td>
              <td>${displayDate(r.issue_date)}</td>
              <td>${escapeHtml(r.doc_type)} · ${escapeHtml(r.series || '—')}-${escapeHtml(r.number || '—')}</td>
              <td>${escapeHtml(r.doc_id_number || '—')}</td>
              <td>${escapeHtml(r.counterparty_name || '—')}</td>
              <td class="cell-num">${num(r.total)} ${escapeHtml(r.currency || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${records.length > preview.length ? `<p class="text-muted" style="font-size:var(--font-size-sm);margin-top:var(--space-2);">Vista previa de ${preview.length} de ${records.length} registros.</p>` : ''}`;
  }

  function renderImport() {
    const files = parsed?.files || [];
    const records = parsed?.records || [];
    const warnings = parsed?.warnings || [];
    return `
      ${localBanner()}
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Importar propuesta SIRE</h3>
            <p class="card__subtitle">Acepta varios ZIP o CSV a la vez. Detecta automáticamente compras y ventas.</p>
          </div>
        </div>
        <div class="card__body">
          <input type="file" data-files accept=".zip,.csv,application/zip,text/csv" multiple hidden />
          <div data-drop style="border:1.5px dashed var(--color-border);border-radius:var(--radius-lg);padding:var(--space-7);text-align:center;cursor:pointer;background:var(--color-bg-subtle);">
            <span style="color:var(--color-primary);">${ICONS.arrowRight}</span>
            <div style="font-weight:600;margin-top:var(--space-2);">Arrastra los archivos aquí o haz clic para seleccionar</div>
            <div class="text-muted" style="font-size:var(--font-size-sm);margin-top:var(--space-1);">
              Propuestas SIRE de SUNAT en ZIP (con CSV dentro) o CSV directo. Puedes subir varios períodos.
            </div>
          </div>
          ${importStatus ? `<p class="text-muted" data-import-status style="margin-top:var(--space-3);">${escapeHtml(importStatus)}</p>` : ''}
          ${warnings.length ? `<div class="card" style="border-color:var(--color-gold);margin-top:var(--space-4);"><div class="card__body">${warnings.map((w) => `<div style="font-size:var(--font-size-sm);">${ICONS.info} ${escapeHtml(w)}</div>`).join('')}</div></div>` : ''}
          ${files.length ? `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-top:var(--space-5);flex-wrap:wrap;">
              <h4 class="card__title" style="font-size:var(--font-size-lg);">Vista previa</h4>
              <div style="display:flex;gap:var(--space-2);">
                <button type="button" class="btn" data-clear-import>Descartar</button>
                <button type="button" class="btn btn--primary" data-do-import ${records.length ? '' : 'disabled'}>${ICONS.check} Importar ${records.length} registro(s)</button>
              </div>
            </div>
            <div class="table-wrap" style="margin-top:var(--space-3);">
              <table class="table" style="min-width:880px;">
                <thead><tr><th>Archivo</th><th>Tipo</th><th>Período(s)</th><th style="text-align:right;">Filas</th><th style="text-align:right;">Duplicados</th><th>Validación</th></tr></thead>
                <tbody>${fileRowsHtml(files)}</tbody>
              </table>
            </div>
            ${previewRecordsHtml(records)}
          ` : ''}
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-4);">
        <div class="card__header">
          <div><h3 class="card__title">Historial de importaciones</h3><p class="card__subtitle">Lotes cargados en esta empresa.</p></div>
        </div>
        <div class="card__body">
          <div class="table-wrap">
            <table class="table" style="min-width:820px;">
              <thead><tr><th>Fecha</th><th>Archivo</th><th>Tipo</th><th>Período(s)</th><th style="text-align:right;">Filas</th><th style="text-align:right;">Importados</th><th style="text-align:right;">Omitidos</th><th></th></tr></thead>
              <tbody>${(() => {
                const batches = taxService.getBatches();
                if (!batches.length) return `<tr><td colspan="8" class="text-muted">Aún no hay importaciones registradas.</td></tr>`;
                return batches.map((b) => `<tr>
                  <td>${escapeHtml(displayDateTime(b.created_at))}</td>
                  <td><div class="table__name" style="font-size:var(--font-size-sm);">${escapeHtml(b.file_name || '—')}</div></td>
                  <td>${b.kind ? escapeHtml(b.kind === 'compra' ? 'Compra' : 'Venta') : '—'}</td>
                  <td>${escapeHtml((b.periods || []).map(periodLabel).join(', ') || '—')}</td>
                  <td class="cell-num">${b.total_rows || 0}</td>
                  <td class="cell-num cell-strong">${b.imported_rows || 0}</td>
                  <td class="cell-num">${b.skipped_rows || 0}</td>
                  <td><button type="button" class="icon-btn icon-btn--danger" data-del-batch="${escapeHtml(b.id)}" title="Eliminar lote y sus registros">${ICONS.trash}</button></td>
                </tr>`).join('');
              })()}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function summaryYearOptions() {
    const years = new Set([String(new Date().getFullYear()), String(state.summaryYear)]);
    taxService.all().forEach((r) => { if (r.period) years.add(r.period.slice(0, 4)); });
    return [...years].filter(Boolean).sort().reverse();
  }

  function monthlyFor(year) {
    return Array.from({ length: 12 }, (_, i) => {
      const period = `${year}${String(i + 1).padStart(2, '0')}`;
      return {
        period,
        label: MONTHS[i],
        compra: totalsFor('compra', period),
        venta: totalsFor('venta', period),
      };
    });
  }

  function renderSummary() {
    const year = state.summaryYear;
    const rows = monthlyFor(year);
    const totals = rows.reduce((acc, r) => {
      ['baseGravada', 'baseNoGravada', 'base', 'igv', 'total', 'count'].forEach((k) => {
        acc.compra[k] += r.compra[k]; acc.venta[k] += r.venta[k];
      });
      return acc;
    }, {
      compra: { baseGravada: 0, baseNoGravada: 0, base: 0, igv: 0, total: 0, count: 0 },
      venta: { baseGravada: 0, baseNoGravada: 0, base: 0, igv: 0, total: 0, count: 0 },
    });
    const saldo = Math.round((totals.venta.igv - totals.compra.igv) * 100) / 100;
    const missingRate = taxService.all().filter((r) => String(r.period || '').startsWith(year) && hasMissingRate(r)).length;
    return `
      ${localBanner()}
      <div class="stats">
        <div class="stat-card"><span class="stat-card__icon">${ICONS.building}</span><div><div class="stat-card__value">${num(totals.compra.total)}</div><div class="stat-card__label">Compras ${year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.arrowRight}</span><div><div class="stat-card__value">${num(totals.venta.total)}</div><div class="stat-card__label">Ventas ${year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.info}</span><div><div class="stat-card__value">${num(totals.venta.igv)}</div><div class="stat-card__label">IGV ventas</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.check}</span><div><div class="stat-card__value">${num(saldo)}</div><div class="stat-card__label">${saldo >= 0 ? 'IGV por pagar' : 'Crédito fiscal'}</div></div></div>
      </div>
      <div class="card">
        <div class="card__header">
          <div><h3 class="card__title">Resumen mensual ${year}</h3><p class="card__subtitle">Base gravada, base no gravada, IGV y total de compras y ventas.${missingRate ? ` · ${missingRate} comprobante(s) en moneda extranjera sin TC (consolidados a la par).` : ''}</p></div>
          <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;">
            <select class="form-input" data-summary-year style="max-width:130px;">${summaryYearOptions().map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
            <button type="button" class="btn" data-export-summary>${ICONS.arrowRight} Exportar resumen</button>
          </div>
        </div>
        <div class="card__body">
          <div class="table-wrap">
            <table class="table" style="min-width:1240px;">
              <thead>
                <tr class="table__group"><th></th><th colspan="4">Compras</th><th colspan="4">Ventas</th><th rowspan="2">Comprob.</th><th rowspan="2">Saldo IGV</th></tr>
                <tr><th>Mes</th><th style="text-align:right;">Base gravada</th><th style="text-align:right;">Base no gravada</th><th style="text-align:right;">IGV</th><th style="text-align:right;">Total</th><th style="text-align:right;">Base gravada</th><th style="text-align:right;">Base no gravada</th><th style="text-align:right;">IGV</th><th style="text-align:right;">Total</th></tr>
              </thead>
              <tbody>
                ${rows.map((r) => `<tr>
                  <td>${escapeHtml(r.label)}</td>
                  <td class="cell-num">${num(r.compra.baseGravada)}</td><td class="cell-num">${num(r.compra.baseNoGravada)}</td><td class="cell-num">${num(r.compra.igv)}</td><td class="cell-num">${num(r.compra.total)}</td>
                  <td class="cell-num">${num(r.venta.baseGravada)}</td><td class="cell-num">${num(r.venta.baseNoGravada)}</td><td class="cell-num">${num(r.venta.igv)}</td><td class="cell-num">${num(r.venta.total)}</td>
                  <td class="cell-num">${r.venta.count}</td>
                  <td class="cell-num ${r.venta.igv - r.compra.igv < 0 ? 'text-muted' : 'cell-strong'}">${num(r.venta.igv - r.compra.igv)}</td>
                </tr>`).join('')}
              </tbody>
              <tfoot><tr>
                <th>Total ${year}</th>
                <th class="cell-num">${num(totals.compra.baseGravada)}</th><th class="cell-num">${num(totals.compra.baseNoGravada)}</th><th class="cell-num">${num(totals.compra.igv)}</th><th class="cell-num">${num(totals.compra.total)}</th>
                <th class="cell-num">${num(totals.venta.baseGravada)}</th><th class="cell-num">${num(totals.venta.baseNoGravada)}</th><th class="cell-num">${num(totals.venta.igv)}</th><th class="cell-num">${num(totals.venta.total)}</th>
                <th class="cell-num">${totals.venta.count}</th>
                <th class="cell-num">${num(saldo)}</th>
              </tr></tfoot>
            </table>
          </div>
        </div>
      </div>`;
  }

  function supplierLocalBanner() {
    if (supplierService.mode !== 'local') return '';
    return `
      <div class="card" style="border-color:var(--color-gold);margin-bottom:var(--space-4);">
        <div class="card__body" style="display:flex;gap:var(--space-3);align-items:flex-start;">
          <span style="color:var(--color-gold);flex-shrink:0;">${ICONS.info}</span>
          <div>
            <strong>Proveedores en modo local.</strong>
            La tabla <code>tax_suppliers</code> todavía no existe en Supabase. El directorio se guarda solo en este navegador.
            Ejecuta <code>supabase/compras_suppliers_schema.sql</code> en el SQL Editor y recarga el portal para activar el modo multiusuario.
            <div style="margin-top:var(--space-3);">
              <a class="btn" href="./supabase/compras_suppliers_schema.sql" target="_blank" rel="noopener">${ICONS.arrowRight} Abrir SQL de proveedores</a>
            </div>
          </div>
        </div>
      </div>`;
  }

  function supplierFiltered() {
    return supplierService.list(state.supplierSearch);
  }

  function supplierRowsHtml(rows) {
    if (!rows.length) {
      return `<tr><td colspan="6">
        <div class="empty-state">
          <span class="empty-state__icon">${ICONS.users}</span>
          <div class="empty-state__title">${state.supplierSearch ? 'Sin resultados' : 'Aún no hay proveedores'}</div>
          <div class="empty-state__desc">${state.supplierSearch ? 'Prueba con otro RUC o razón social.' : 'Crea uno, importa un archivo o pega una lista desde Excel.'}</div>
        </div>
      </td></tr>`;
    }
    return rows.map((s) => {
      const source = s.source === 'sire' ? 'SIRE' : (s.source === 'import' ? 'Importado' : 'Manual');
      return `<tr>
        <td><strong>${escapeHtml(s.doc_id_number)}</strong><div class="text-muted" style="font-size:var(--font-size-xs);">Tipo ${escapeHtml(s.doc_id_type || '6')}</div></td>
        <td><div class="table__name">${escapeHtml(s.name)}</div>${s.trade_name ? `<div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(s.trade_name)}</div>` : ''}</td>
        <td>${escapeHtml(s.email || '—')}${s.phone ? `<div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(s.phone)}</div>` : ''}</td>
        <td>${escapeHtml(s.address || '—')}</td>
        <td><span class="badge badge--muted">${escapeHtml(source)}</span></td>
        <td>
          <div class="table__actions">
            <button type="button" class="icon-btn" data-supplier-edit="${escapeHtml(s.id)}" title="Editar proveedor">${ICONS.edit}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-supplier-del="${escapeHtml(s.id)}" title="Eliminar proveedor">${ICONS.trash}</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function supplierPaginationHtml(total) {
    const pages = Math.max(1, Math.ceil(total / state.supplierPageSize));
    if (state.supplierPage > pages) state.supplierPage = pages;
    if (state.supplierPage < 1) state.supplierPage = 1;
    const from = total ? (state.supplierPage - 1) * state.supplierPageSize + 1 : 0;
    const to = Math.min(total, state.supplierPage * state.supplierPageSize);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-top:var(--space-4);flex-wrap:wrap;">
        <span class="text-muted" style="font-size:var(--font-size-sm);">Mostrando ${from}–${to} de ${total}</span>
        <div style="display:flex;gap:var(--space-2);">
          <button type="button" class="btn" data-supplier-page="prev" ${state.supplierPage <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="text-muted" style="padding:9px 4px;font-size:var(--font-size-sm);">Página ${state.supplierPage} de ${pages}</span>
          <button type="button" class="btn" data-supplier-page="next" ${state.supplierPage >= pages ? 'disabled' : ''}>Siguiente</button>
        </div>
      </div>`;
  }

  function updateSupplierList() {
    const rows = supplierFiltered();
    const pages = Math.max(1, Math.ceil(rows.length / state.supplierPageSize));
    if (state.supplierPage > pages) state.supplierPage = pages;
    if (state.supplierPage < 1) state.supplierPage = 1;
    const start = (state.supplierPage - 1) * state.supplierPageSize;
    const tbody = content.querySelector('[data-supplier-table-body]');
    if (tbody) tbody.innerHTML = supplierRowsHtml(rows.slice(start, start + state.supplierPageSize));
    const pag = content.querySelector('[data-supplier-pagination]');
    if (pag) pag.innerHTML = supplierPaginationHtml(rows.length);
    const count = content.querySelector('[data-supplier-count]');
    if (count) count.textContent = `${rows.length} proveedor(es)`;
  }

  function renderSuppliers() {
    const all = supplierService.all();
    const rows = supplierFiltered();
    const pages = Math.max(1, Math.ceil(rows.length / state.supplierPageSize));
    if (state.supplierPage > pages) state.supplierPage = pages;
    const start = (state.supplierPage - 1) * state.supplierPageSize;
    const pageRows = rows.slice(start, start + state.supplierPageSize);
    const rucCount = all.filter((s) => /^\d{11}$/.test(s.doc_id_number)).length;
    const withEmail = all.filter((s) => s.email).length;
    return `
      ${supplierError ? `<div class="card" style="border-color:var(--color-danger);margin-bottom:var(--space-4);"><div class="card__body"><strong>No se pudo cargar el directorio.</strong><p class="text-muted" style="margin-top:var(--space-2);">${escapeHtml(supplierError)}</p></div></div>` : ''}
      ${supplierLocalBanner()}
      <div class="stats">
        <div class="stat-card"><span class="stat-card__icon">${ICONS.users}</span><div><div class="stat-card__value">${all.length}</div><div class="stat-card__label">Proveedores registrados</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.check}</span><div><div class="stat-card__value">${rucCount}</div><div class="stat-card__label">Con RUC de 11 dígitos</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.info}</span><div><div class="stat-card__value">${withEmail}</div><div class="stat-card__label">Con correo registrado</div></div></div>
      </div>
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Directorio de proveedores</h3>
            <p class="card__subtitle" data-supplier-count>${rows.length} proveedor(es)</p>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
            <button type="button" class="btn" data-supplier-model>${ICONS.arrowRight} Descargar modelo</button>
            <button type="button" class="btn" data-supplier-file-trigger>${ICONS.arrowRight} Importar archivo</button>
            <button type="button" class="btn btn--primary" data-supplier-add>${ICONS.plus} Nuevo proveedor</button>
          </div>
        </div>
        <div class="card__body">
          <div class="form-group" style="margin-bottom:var(--space-4);max-width:460px;">
            <label class="form-label">Buscar proveedor</label>
            <input class="form-input" data-supplier-search value="${escapeHtml(state.supplierSearch)}" placeholder="RUC, razón social, correo o teléfono…" />
          </div>
          <div class="table-wrap">
            <table class="table" style="min-width:1050px;">
              <thead><tr><th>Documento</th><th>Razón social</th><th>Contacto</th><th>Dirección</th><th>Origen</th><th></th></tr></thead>
              <tbody data-supplier-table-body>${supplierRowsHtml(pageRows)}</tbody>
            </table>
          </div>
          <div data-supplier-pagination>${supplierPaginationHtml(rows.length)}</div>
        </div>
      </div>
      <div class="card" style="margin-top:var(--space-4);">
        <div class="card__header">
          <div>
            <h3 class="card__title">Carga masiva / copiar y pegar</h3>
            <p class="card__subtitle">Pega una fila por proveedor desde Excel o importa un CSV/TXT. También acepta líneas como <code>20601234567, RAZÓN SOCIAL</code>.</p>
          </div>
        </div>
        <div class="card__body">
          <input type="file" data-supplier-file accept=".csv,.txt,text/csv,text/plain" hidden />
          <div class="form-group">
            <label class="form-label">Proveedores a importar</label>
            <textarea class="form-input" data-supplier-paste rows="7" placeholder="Tipo Doc Identidad,Nro Doc Identidad,Razon Social,Nombre Comercial,Correo,Telefono,Direccion&#10;6,20601234567,PROVEEDOR EJEMPLO S.A.C.,PROVEEDOR EJEMPLO,,,&#10;6,20607654321,DISTRIBUIDORA EJEMPLO S.A.,,,,,"></textarea>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center;margin-top:var(--space-3);">
            <button type="button" class="btn btn--primary" data-supplier-paste-import ${supplierBusy ? 'disabled' : ''}>${ICONS.check} Importar proveedores</button>
            <button type="button" class="btn" data-supplier-file-trigger>${ICONS.arrowRight} Importar archivo CSV/TXT</button>
            <button type="button" class="btn" data-supplier-model>${ICONS.arrowRight} Descargar modelo CSV</button>
            ${supplierBusy ? '<span class="text-muted">Procesando…</span>' : ''}
          </div>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-3);">
            El modelo usa las columnas <code>Tipo Doc Identidad, Nro Doc Identidad, Razon Social, Nombre Comercial, Correo, Telefono, Direccion</code>.
            Si el tipo de documento falta, se deduce por la longitud (11 dígitos = RUC, 8 dígitos = DNI). Los documentos repetidos se actualizan.
          </p>
        </div>
      </div>`;
  }

  function renderContent() {
    if (loading) {
      content.innerHTML = `<div class="card"><div class="card__body text-muted">Cargando registro de compras y ventas…</div></div>`;
      return;
    }
    if (error) {
      content.innerHTML = `<div class="card" style="border-color:var(--color-danger);"><div class="card__body">
        <strong>No se pudo cargar el módulo.</strong><p class="text-muted" style="margin-top:var(--space-2);">${escapeHtml(error)}</p>
        <button type="button" class="btn" data-retry>Reintentar</button>
      </div></div>`;
      return;
    }
    if (state.tab === 'importar') content.innerHTML = renderImport();
    else if (state.tab === 'resumen') content.innerHTML = renderSummary();
    else if (state.tab === 'proveedores') content.innerHTML = renderSuppliers();
    else {
      content.innerHTML = renderRegistry();
      updateRegistry();
    }
  }

  function syncHeaderAdd() {
    const btn = viewRoot.querySelector('.page-heading [data-add]');
    if (!btn) return;
    btn.innerHTML = state.tab === 'proveedores'
      ? `${ICONS.plus} Nuevo proveedor`
      : `${ICONS.plus} Nuevo registro`;
  }

  function setTab(tab) {
    state.tab = tab;
    state.page = 1;
    [...tabsEl.querySelectorAll('[data-tab]')].forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    syncHeaderAdd();
    renderContent();
  }

  async function load() {
    loading = true;
    error = '';
    supplierError = '';
    renderContent();
    updateModeBadge();
    try {
      await taxService.refresh();
      try {
        await supplierService.refresh();
        if (supplierService.mode === 'remote' && supplierService.lastError) {
          supplierError = supplierService.lastError;
        }
      } catch (err) {
        supplierError = err.message || String(err);
      }
      ensurePeriod();
    } catch (err) {
      error = err.message || String(err);
    } finally {
      loading = false;
      updateModeBadge();
      syncHeaderAdd();
      renderContent();
    }
  }

  function amountField(name, label, value) {
    return `<div class="form-group" style="margin:0;">
      <label class="form-label">${label}</label>
      <input class="form-input" type="number" step="0.01" name="${name}" value="${Number(value || 0).toFixed(2)}" data-amount />
    </div>`;
  }

  function textField(name, label, value, attrs = '') {
    return `<div class="form-group" style="margin:0;">
      <label class="form-label">${label}</label>
      <input class="form-input" name="${name}" value="${escapeHtml(value || '')}" ${attrs} />
    </div>`;
  }

  function dateField(name, label, value) {
    return `<div class="form-group" style="margin:0;">
      <label class="form-label">${label}</label>
      <input class="form-input" type="date" name="${name}" value="${escapeHtml(value || '')}" />
    </div>`;
  }

  function selectField(name, label, list, value, emptyLabel = null) {
    return `<div class="form-group" style="margin:0;">
      <label class="form-label">${label}</label>
      <select class="form-input" name="${name}">${optionsHtml(list, value, emptyLabel)}</select>
    </div>`;
  }

  function supplierOptionsHtml() {
    return supplierService.all().slice(0, 2000).map((s) => (
      `<option value="${escapeHtml(s.doc_id_number)}">${escapeHtml(s.name)}</option>`
    )).join('');
  }

  function virtualAmountField(dataAttr, label, value) {
    return `<div class="form-group" style="margin:0;">
      <label class="form-label">${label}</label>
      <input class="form-input" type="number" step="0.01" ${dataAttr} value="${Number(value || 0).toFixed(2)}" data-amount />
    </div>`;
  }

  function modalFormHtml(rec, kind, readonly) {
    const r = rec || {};
    const isCompra = kind === 'compra';
    return `
      <form data-form novalidate>
        <div class="modal__header">
          <h3 class="modal__title">${readonly ? 'Detalle del comprobante' : (rec?.id ? 'Editar comprobante' : 'Nuevo registro')}</h3>
          <button type="button" class="modal__close" data-close-modal aria-label="Cerrar">${ICONS.close}</button>
        </div>
        <div class="modal__body">
          <input type="hidden" name="kind" value="${escapeHtml(kind)}" />
          <input type="hidden" name="ruc_empresa" value="${escapeHtml(r.ruc_empresa || company.ruc || '')}" />
          <input type="hidden" name="razon_social_empresa" value="${escapeHtml(r.razon_social_empresa || company.name || '')}" />

          <h4 style="font-weight:600;color:var(--color-primary);margin-bottom:var(--space-3);">Comprobante</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-4);">
            <div class="form-group" style="margin:0;"><label class="form-label">Período <span class="req">*</span></label>
              <input class="form-input" type="month" name="period" value="${escapeHtml(periodToInput(r.period || state.period))}" required /></div>
            ${dateField('issue_date', 'Fecha de emisión *', r.issue_date || TODAY)}
            ${dateField('due_date', 'Fecha vcto / pago', r.due_date)}
            ${selectField('doc_type', 'Tipo comprobante *', DOC_TYPES, r.doc_type || '01')}
            ${textField('series', 'Serie del CDP', r.series, 'placeholder="Ej. F001" maxlength="10"')}
            ${textField('number', 'Número *', r.number, 'placeholder="Ej. 1234" maxlength="30"')}
            ${textField('number_final', 'Número final (rango)', r.number_final, 'maxlength="30"')}
            ${isCompra ? textField('year', 'Año', r.year, 'placeholder="Ej. 2026" maxlength="4"') : ''}
            ${textField('car_sunat', 'CAR SUNAT', r.car_sunat, 'placeholder="Código CAR" maxlength="60"')}
            ${selectField('doc_id_type', isCompra ? 'Tipo doc. proveedor' : 'Tipo doc. contraparte', DOC_ID_TYPES, r.doc_id_type || '6')}
            ${textField('doc_id_number', isCompra ? 'Nro doc. proveedor *' : 'Nro doc. contraparte *', r.doc_id_number, `placeholder="RUC / DNI" maxlength="20"${isCompra ? ' list="supplier-options" autocomplete="off"' : ''}`)}
            ${textField('counterparty_name', isCompra ? 'Razón social del proveedor *' : 'Razón social / nombres *', r.counterparty_name, 'placeholder="Nombre de la contraparte"')}
            ${selectField('currency', 'Moneda', CURRENCIES, r.currency || 'PEN')}
            <div class="form-group" style="margin:0;"><label class="form-label">Tipo de cambio (moneda extranjera)</label>
              <input class="form-input" type="number" min="0" step="0.0001" name="exchange_rate" value="${Number(r.id ? (r.exchange_rate ?? 0) : (r.exchange_rate ?? 1)).toFixed(4)}" /></div>
            ${selectField('state', 'Estado del comprobante', STATES, r.state || '1')}
          </div>
          ${isCompra ? `<datalist id="supplier-options">${supplierOptionsHtml()}</datalist>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-2);">Escribe el RUC del proveedor y se completará su razón social desde el directorio de Proveedores. También puedes seleccionarlo de la lista.</p>` : ''}

          <h4 style="font-weight:600;color:var(--color-primary);margin:var(--space-5) 0 var(--space-3);">Importes</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--space-4);">
            ${virtualAmountField('data-base-gravada', 'Base gravada', baseGravadaOf(r, kind))}
            ${virtualAmountField('data-base-no-gravada', 'Base no gravada', baseNoGravadaOf(r, kind))}
            ${virtualAmountField('data-igv', 'IGV / IPM', igvOf(r, kind))}
            ${amountField('isc', 'ISC', r.isc)}
            ${amountField('icbper', 'ICBPER', r.icbper)}
            ${amountField('other_taxes', 'Otros cargos / tributos', r.other_taxes)}
            ${!isCompra ? amountField('ivap', 'IVAP', r.ivap) : ''}
            <div class="form-group" style="margin:0;">
              <label class="form-label">Total CP</label>
              <input class="form-input" type="number" step="0.01" name="total" value="${Number(r.total || 0).toFixed(2)}" data-total />
            </div>
          </div>
          <label class="checkbox" style="margin-top:var(--space-3);"><input type="checkbox" data-auto-total checked /><span class="checkbox__box">${ICONS.check}</span><span>Calcular IGV (18%) y total automáticamente al editar importes</span></label>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-2);">
            La <strong>base gravada</strong> es la afecta al IGV. La <strong>base no gravada</strong> incluye exoneradas, inafectas, exportación, valor no gravado y otras bases no afectas al IGV.
            Los cargos que no forman base se registran en ISC, ICBPER u otros tributos. Al editar las bases, el comprobante se consolida en las columnas estándar del registro.
          </p>

          <h4 style="font-weight:600;color:var(--color-primary);margin:var(--space-5) 0 var(--space-3);">Notas y documentos modificados</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-4);">
            ${dateField('modified_date', 'Fecha emisión doc. modificado', r.modified_date)}
            ${textField('modified_doc_type', 'Tipo CP modificado', r.modified_doc_type, 'maxlength="2"')}
            ${textField('modified_series', 'Serie CP modificado', r.modified_series, 'maxlength="10"')}
            ${textField('modified_number', 'Nro CP modificado', r.modified_number, 'maxlength="30"')}
            ${selectField('note_type', 'Tipo de nota', NOTE_TYPES, r.note_type || '')}
            ${textField('operation_type', 'Tipo de operación', r.operation_type, 'placeholder="Ej. 0101" maxlength="10"')}
            ${textField('dam', 'DAM / CP', r.dam, 'maxlength="40"')}
            ${textField('clu', 'CLU', r.clu, 'maxlength="40"')}
          </div>
        </div>
        <div class="modal__footer">
          <button type="button" class="btn" data-cancel>${readonly ? 'Cerrar' : 'Cancelar'}</button>
          ${readonly
            ? `<button type="button" class="btn btn--primary" data-edit-modal>${ICONS.edit} Editar</button>`
            : `<button type="submit" class="btn btn--primary" data-submit>${ICONS.check} Guardar</button>`}
        </div>
      </form>`;
  }

  function supplierFormHtml(rec, readonly) {
    const s = rec || {};
    return `
      <form data-supplier-form novalidate>
        <div class="modal__header">
          <h3 class="modal__title">${readonly ? 'Detalle del proveedor' : (s.id ? 'Editar proveedor' : 'Nuevo proveedor')}</h3>
          <button type="button" class="modal__close" data-close-modal aria-label="Cerrar">${ICONS.close}</button>
        </div>
        <div class="modal__body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--space-4);">
            ${selectField('doc_id_type', 'Tipo documento', DOC_ID_TYPES, s.doc_id_type || '6')}
            ${textField('doc_id_number', 'Nro documento *', s.doc_id_number, 'placeholder="RUC / DNI" maxlength="20"')}
            ${textField('name', 'Razón social *', s.name, 'placeholder="Razón social del proveedor"')}
            ${textField('trade_name', 'Nombre comercial', s.trade_name)}
            ${textField('email', 'Correo', s.email, 'type="email" placeholder="correo@proveedor.com"')}
            ${textField('phone', 'Teléfono', s.phone, 'placeholder="Teléfono / celular"')}
            <div class="form-group" style="margin:0;grid-column:1/-1;">
              <label class="form-label">Dirección</label>
              <input class="form-input" name="address" value="${escapeHtml(s.address || '')}" placeholder="Dirección fiscal o comercial" />
            </div>
          </div>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-3);">
            El documento identifica al proveedor y evita duplicados. Al crear un registro de compra, escribe este documento y la razón social se completará automáticamente.
          </p>
        </div>
        <div class="modal__footer">
          <button type="button" class="btn" data-cancel>${readonly ? 'Cerrar' : 'Cancelar'}</button>
          ${readonly
            ? `<button type="button" class="btn btn--primary" data-supplier-edit-modal>${ICONS.edit} Editar</button>`
            : `<button type="submit" class="btn btn--primary" data-submit>${ICONS.check} Guardar proveedor</button>`}
        </div>
      </form>`;
  }

  function openModal(rec, kind, readonly = false) {
    if (modal.open) modal.close();
    modalType = 'record';
    modalRecord = rec ? { ...rec } : null;
    modalSupplierRecord = null;
    modalKind = kind;
    modalReadonly = readonly;
    modalInitial = {
      baseGravada: baseGravadaOf(rec || {}, kind),
      baseNoGravada: baseNoGravadaOf(rec || {}, kind),
      igv: igvOf(rec || {}, kind),
    };
    modal.innerHTML = modalFormHtml(modalRecord, kind, readonly);
    const form = modal.querySelector('[data-form]');
    if (readonly) {
      form.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });
    }
    modal.showModal();
  }

  function openSupplierModal(rec, readonly = false) {
    if (modal.open) modal.close();
    modalType = 'supplier';
    modalRecord = null;
    modalSupplierRecord = rec ? { ...rec } : null;
    modalInitial = null;
    modalReadonly = readonly;
    modal.innerHTML = supplierFormHtml(modalSupplierRecord, readonly);
    const form = modal.querySelector('[data-supplier-form]');
    if (readonly) {
      form.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });
    }
    modal.showModal();
  }

  function closeModal() {
    if (modal.open) modal.close();
    modal.innerHTML = '';
    modalType = 'record';
    modalRecord = null;
    modalSupplierRecord = null;
    modalInitial = null;
    modalReadonly = false;
  }

  function recalcAmounts(target) {
    const form = modal.querySelector('[data-form]');
    if (!form || modalReadonly) return;
    const auto = form.querySelector('[data-auto-total]');
    if (!auto || !auto.checked) return;
    const byName = (name) => Number(form.querySelector(`[name="${name}"]`)?.value || 0);
    const byData = (attr) => Number(form.querySelector(`[${attr}]`)?.value || 0);
    if (target?.matches('[data-base-gravada]')) {
      const igvInput = form.querySelector('[data-igv]');
      if (igvInput) igvInput.value = (byData('data-base-gravada') * 0.18).toFixed(2);
    }
    const total = byData('data-base-gravada')
      + byData('data-base-no-gravada')
      + byData('data-igv')
      + byName('isc')
      + byName('icbper')
      + byName('other_taxes')
      + (modalKind === 'venta' ? byName('ivap') : 0);
    const totalInput = form.querySelector('[data-total]');
    if (totalInput) totalInput.value = total.toFixed(2);
  }

  async function handleFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    if (importBusy || parseBusy) {
      showToast('Espera a que termine la operación en curso.', 'info');
      return;
    }
    parseBusy = true;
    parsed = null;
    importStatus = `Leyendo ${files.length} archivo(s)…`;
    state.tab = 'importar';
    setTab('importar');
    importStatus = 'Leyendo archivos…';
    renderContent();
    try {
      const res = await parseSireFiles(files, {
        expectedRuc: String(company.ruc || '').replace(/\D/g, ''),
        onProgress: (msg) => {
          importStatus = msg || 'Procesando…';
          const el = content.querySelector('[data-import-status]');
          if (el) el.textContent = msg || '';
        },
      });
      parsed = res;
      importStatus = '';
      renderContent();
      if (res.records.length === 0) showToast('No se encontraron registros válidos en los archivos.', 'error');
    } catch (err) {
      importStatus = '';
      showToast(err.message || String(err), 'error');
      renderContent();
    } finally {
      parseBusy = false;
    }
  }

  async function doImport() {
    if (!parsed?.records?.length || importBusy) return;
    importBusy = true;
    const currentParsed = parsed;
    const btn = content.querySelector('[data-do-import]');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
    try {
      const res = await taxService.importParsed(currentParsed.files);
      await taxService.refresh();
      let supplierResult = null;
      try {
        const supplierRows = currentParsed.records
          .filter((r) => r.kind === 'compra' && r.doc_id_number && r.counterparty_name)
          .map((r) => ({
            doc_id_type: r.doc_id_type,
            doc_id_number: r.doc_id_number,
            name: r.counterparty_name,
            source: 'sire',
          }));
        if (supplierRows.length) {
          supplierResult = await supplierService.importRows(supplierRows, { source: 'sire' });
        }
      } catch (err) {
        supplierError = err.message || String(err);
        console.warn('No se pudo actualizar el directorio de proveedores:', err);
      }
      const kinds = [...new Set(currentParsed.files.map((f) => f.kind).filter(Boolean))];
      const periods = currentParsed.records.map((r) => r.period).filter(Boolean).sort();
      parsed = null;
      ensurePeriod(true);
      if (periods.length) state.period = periods[periods.length - 1];
      state.tab = kinds.length === 1 ? kinds[0] : 'compra';
      updateModeBadge();
      showToast(`Importación completada: ${res.imported} registro(s) nuevo(s), ${res.skipped} omitido(s).`);
      if (supplierResult?.total) {
        showToast(`Directorio de proveedores: ${supplierResult.created} nuevo(s), ${supplierResult.updated} actualizado(s).`, 'info');
      }
      if (res.warnings?.length) showToast(res.warnings[0], 'info');
      setTab(state.tab);
    } catch (err) {
      showToast(err.message || String(err), 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `${ICONS.check} Importar ${currentParsed.records.length} registro(s)`; }
    } finally {
      importBusy = false;
    }
  }

  async function importSupplierText(text, origin = 'texto') {
    if (supplierBusy) return;
    const parsedSuppliers = supplierService.parseText(text);
    if (!parsedSuppliers.rows.length) {
      showToast(parsedSuppliers.warnings?.[0] || 'No se encontraron proveedores válidos.', 'error');
      return;
    }
    supplierBusy = true;
    supplierError = '';
    const btn = content.querySelector('[data-supplier-paste-import]');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
    try {
      const res = await supplierService.importRows(parsedSuppliers.rows, { source: 'import' });
      state.supplierPage = 1;
      renderContent();
      showToast(`Proveedores (${origin}): ${res.created} nuevo(s), ${res.updated} actualizado(s)${res.skipped ? `, ${res.skipped} omitido(s)` : ''}.`);
      if (parsedSuppliers.skipped && parsedSuppliers.warnings?.length) showToast(parsedSuppliers.warnings[0], 'info');
    } catch (err) {
      showToast(err.message || String(err), 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `${ICONS.check} Importar proveedores`; }
    } finally {
      supplierBusy = false;
    }
  }

  async function handleSupplierFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      await importSupplierText(text, file.name);
    } catch (err) {
      showToast(err.message || String(err), 'error');
    }
  }

  function downloadText(fileName, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeRecord(id) {
    const rec = taxService.getById(id);
    if (!rec) return;
    const ok = await confirmDialog({
      title: 'Eliminar comprobante',
      message: `¿Eliminar ${rec.doc_type || ''} ${rec.series || ''}-${rec.number || ''} de ${rec.counterparty_name || 'la contraparte'}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await taxService.remove(id);
      showToast('Comprobante eliminado.');
      renderContent();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function removeBatch(id) {
    const batch = taxService.getBatches().find((b) => b.id === id);
    const ok = await confirmDialog({
      title: 'Eliminar lote de importación',
      message: `Se eliminarán también los registros importados en "${batch?.file_name || 'este lote'}". ¿Continuar?`,
      confirmText: 'Eliminar lote',
      danger: true,
    });
    if (!ok) return;
    try {
      await taxService.removeBatch(id);
      showToast('Lote eliminado.');
      renderContent();
    } catch (err) { showToast(err.message, 'error'); }
  }

  viewRoot.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }

    if (e.target.closest('[data-import]')) { setTab('importar'); return; }
    if (e.target.closest('[data-add]')) {
      if (state.tab === 'proveedores') openSupplierModal(null);
      else openModal(null, state.tab === 'venta' ? 'venta' : 'compra');
      return;
    }
    if (e.target.closest('[data-retry]')) { load(); return; }

    if (e.target.closest('[data-supplier-add]')) { openSupplierModal(null); return; }
    if (e.target.closest('[data-supplier-model]')) {
      downloadText('MODELO_PROVEEDORES.csv', supplierService.modelCsv());
      showToast('Modelo CSV descargado. Completa una fila por proveedor.');
      return;
    }
    if (e.target.closest('[data-supplier-file-trigger]')) {
      content.querySelector('[data-supplier-file]')?.click();
      return;
    }
    if (e.target.closest('[data-supplier-paste-import]')) {
      const text = content.querySelector('[data-supplier-paste]')?.value || '';
      importSupplierText(text, 'texto pegado');
      return;
    }
    const supplierEdit = e.target.closest('[data-supplier-edit]');
    if (supplierEdit) {
      openSupplierModal(supplierService.getById(supplierEdit.dataset.supplierEdit));
      return;
    }
    const supplierDel = e.target.closest('[data-supplier-del]');
    if (supplierDel) {
      const id = supplierDel.dataset.supplierDel;
      const supplier = supplierService.getById(id);
      confirmDialog({
        title: 'Eliminar proveedor',
        message: `¿Eliminar a ${supplier?.name || 'este proveedor'}? Los comprobantes ya registrados conservarán sus datos.`,
        confirmText: 'Eliminar',
        danger: true,
      }).then(async (ok) => {
        if (!ok) return;
        try {
          await supplierService.remove(id);
          state.supplierPage = 1;
          renderContent();
          showToast('Proveedor eliminado.');
        } catch (err) { showToast(err.message || String(err), 'error'); }
      });
      return;
    }
    const supplierPage = e.target.closest('[data-supplier-page]');
    if (supplierPage) {
      state.supplierPage += supplierPage.dataset.supplierPage === 'next' ? 1 : -1;
      updateSupplierList();
      return;
    }
    if (e.target.closest('[data-supplier-edit-modal]')) {
      openSupplierModal(modalSupplierRecord, false);
      return;
    }

    if (e.target.closest('[data-drop]')) {
      content.querySelector('[data-files]')?.click();
      return;
    }
    if (e.target.closest('[data-clear-import]')) {
      parsed = null;
      renderContent();
      return;
    }
    if (e.target.closest('[data-do-import]')) { doImport(); return; }

    const delBatch = e.target.closest('[data-del-batch]');
    if (delBatch) { removeBatch(delBatch.dataset.delBatch); return; }

    const view = e.target.closest('[data-view]');
    if (view) { openModal(taxService.getById(view.dataset.view), state.tab === 'venta' ? 'venta' : 'compra', true); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit && !e.target.closest('[data-edit-modal]')) {
      const rec = taxService.getById(edit.dataset.edit);
      openModal(rec, rec?.kind || state.tab, false);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) { removeRecord(del.dataset.del); return; }

    if (e.target.closest('[data-edit-modal]')) { openModal(modalRecord, modalKind, false); return; }
    if (e.target.closest('[data-close-modal]') || e.target.closest('[data-cancel]')) { closeModal(); return; }

    if (e.target.closest('[data-export]')) {
      const rows = filteredRows(state.tab);
      if (!rows.length) { showToast('No hay registros para exportar con los filtros actuales.', 'error'); return; }
      taxService.downloadCsv(state.tab, rows);
      return;
    }

    if (e.target.closest('[data-export-summary]')) {
      const rows = monthlyFor(state.summaryYear);
      const headers = ['Periodo', 'Compras base gravada', 'Compras base no gravada', 'Compras IGV', 'Compras total', 'Ventas base gravada', 'Ventas base no gravada', 'Ventas IGV', 'Ventas total', 'Saldo IGV'];
      const data = rows.map((r) => [
        r.period,
        r.compra.baseGravada.toFixed(2), r.compra.baseNoGravada.toFixed(2), r.compra.igv.toFixed(2), r.compra.total.toFixed(2),
        r.venta.baseGravada.toFixed(2), r.venta.baseNoGravada.toFixed(2), r.venta.igv.toFixed(2), r.venta.total.toFixed(2),
        (r.venta.igv - r.compra.igv).toFixed(2),
      ]);
      downloadText(`RESUMEN_COMPRAS_VENTAS_${state.summaryYear}.csv`, toCsvText(headers, data));
      return;
    }

    const page = e.target.closest('[data-page]');
    if (page) {
      state.page += page.dataset.page === 'next' ? 1 : -1;
      renderContent();
      return;
    }

    if (e.target.closest('[data-clear-filters]')) {
      state.search = '';
      state.docType = '';
      state.state = '';
      state.currency = '';
      state.page = 1;
      renderContent();
    }
  });

  viewRoot.addEventListener('input', (e) => {
    if (e.target.matches('[data-search]')) {
      state.search = e.target.value;
      state.page = 1;
      updateRegistry();
    }
    if (e.target.matches('[data-supplier-search]')) {
      state.supplierSearch = e.target.value;
      state.supplierPage = 1;
      updateSupplierList();
    }
  });

  viewRoot.addEventListener('change', (e) => {
    if (e.target.matches('[data-files]')) {
      handleFiles(e.target.files);
      return;
    }
    if (e.target.matches('[data-supplier-file]')) {
      const file = e.target.files?.[0];
      e.target.value = '';
      handleSupplierFile(file);
      return;
    }
    if (e.target.matches('[data-period]')) {
      const nextPeriod = inputToPeriod(e.target.value);
      if (!nextPeriod) { renderContent(); return; }
      state.period = nextPeriod;
      state.periodTouched = true;
      state.page = 1;
      renderContent();
      return;
    }
    if (e.target.matches('[data-filter-doc]')) { state.docType = e.target.value; state.page = 1; updateRegistry(); return; }
    if (e.target.matches('[data-filter-state]')) { state.state = e.target.value; state.page = 1; updateRegistry(); return; }
    if (e.target.matches('[data-filter-currency]')) { state.currency = e.target.value; state.page = 1; updateRegistry(); return; }
    if (e.target.matches('[data-summary-year]')) { state.summaryYear = e.target.value; renderContent(); }
  });

  viewRoot.addEventListener('dragover', (e) => {
    const drop = e.target.closest('[data-drop]');
    if (!drop) return;
    e.preventDefault();
    drop.style.borderColor = 'var(--color-primary)';
    drop.style.background = 'var(--color-primary-soft, var(--color-bg-subtle))';
  });
  viewRoot.addEventListener('dragleave', (e) => {
    const drop = e.target.closest('[data-drop]');
    if (!drop) return;
    drop.style.borderColor = '';
    drop.style.background = '';
  });
  viewRoot.addEventListener('drop', (e) => {
    const drop = e.target.closest('[data-drop]');
    if (!drop) return;
    e.preventDefault();
    drop.style.borderColor = '';
    drop.style.background = '';
    handleFiles(e.dataTransfer?.files);
  });

  modal.addEventListener('input', (e) => {
    if (modalType === 'supplier' || modalReadonly) return;
    if (e.target.matches('[data-amount], [data-base-gravada], [data-base-no-gravada], [data-igv]')) {
      recalcAmounts(e.target);
    }
    if (e.target.matches('[name="counterparty_name"]')) e.target.dataset.auto = '0';
    if (e.target.matches('[name="doc_id_number"]') && modalKind === 'compra') {
      const supplier = supplierService.getByDoc(e.target.value);
      if (!supplier) return;
      const form = modal.querySelector('[data-form]');
      const nameInput = form?.querySelector('[name="counterparty_name"]');
      const currentName = nameInput ? nameInput.value.trim() : '';
      const savedName = String(modalRecord?.counterparty_name || '').trim();
      const canFill = !modalRecord?.id || !currentName || nameInput.dataset.auto === '1' || currentName === savedName;
      if (nameInput && canFill) {
        nameInput.value = supplier.name;
        nameInput.dataset.auto = '1';
      }
      const typeInput = form?.querySelector('[name="doc_id_type"]');
      if (typeInput && supplier.doc_id_type) typeInput.value = supplier.doc_id_type;
    }
  });

  modal.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (modalReadonly) return;

    if (modalType === 'supplier') {
      const form = e.target;
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      data.doc_id_number = String(data.doc_id_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      data.name = String(data.name || '').trim();
      data.source = modalSupplierRecord?.source || 'manual';
      const missing = [];
      if (!data.doc_id_number) missing.push('documento');
      if (!data.name) missing.push('razón social');
      if (missing.length) {
        showToast(`Completa: ${missing.join(', ')}.`, 'error');
        return;
      }
      const submit = form.querySelector('[data-submit]');
      if (submit) { submit.disabled = true; submit.textContent = 'Guardando…'; }
      try {
        if (modalSupplierRecord?.id) {
          await supplierService.update(modalSupplierRecord.id, data);
          showToast('Proveedor actualizado.');
        } else {
          await supplierService.create(data);
          showToast('Proveedor registrado.');
        }
        closeModal();
        state.supplierPage = 1;
        renderContent();
      } catch (err) {
        showToast(err.message || String(err), 'error');
        if (submit) { submit.disabled = false; submit.innerHTML = `${ICONS.check} Guardar proveedor`; }
      }
      return;
    }

    const form = e.target;
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.kind = modalKind;
    data.period = inputToPeriod(data.period);
    data.exchange_rate = Number(data.exchange_rate || 0);

    const baseRec = modalRecord || {};
    [
      'taxed_base', 'igv', 'taxed_base_ng', 'igv_ng', 'taxed_base_dng', 'igv_dng',
      'acq_value_ng', 'export_value', 'discount_base', 'discount_igv', 'exonerated',
      'unaffected', 'ivap_base', 'ivap', 'isc', 'icbper', 'other_taxes', 'total',
    ].forEach((k) => { data[k] = Number(baseRec[k] || 0); });

    const formAmount = (name) => {
      const el = form.elements[name];
      return el ? Number(el.value || 0) : 0;
    };
    ['isc', 'icbper', 'other_taxes', 'ivap'].forEach((k) => {
      if (form.elements[k]) data[k] = formAmount(k);
    });
    data.total = Number(form.querySelector('[data-total]')?.value || 0);

    const baseGravada = Number(form.querySelector('[data-base-gravada]')?.value || 0);
    const baseNoGravada = Number(form.querySelector('[data-base-no-gravada]')?.value || 0);
    const igv = Number(form.querySelector('[data-igv]')?.value || 0);
    const changed = (value, initial) => Math.abs(Number(value || 0) - Number(initial || 0)) > 0.004;
    const baseGravadaChanged = changed(baseGravada, modalInitial?.baseGravada);
    const baseNoGravadaChanged = changed(baseNoGravada, modalInitial?.baseNoGravada);
    const igvChanged = changed(igv, modalInitial?.igv);

    if (baseGravadaChanged) {
      data.taxed_base = baseGravada;
      if (modalKind === 'compra') {
        data.taxed_base_ng = 0;
        data.taxed_base_dng = 0;
      } else {
        data.discount_base = 0;
      }
    }
    if (baseNoGravadaChanged) {
      if (modalKind === 'compra') {
        data.acq_value_ng = baseNoGravada;
      } else {
        data.exonerated = baseNoGravada;
        data.export_value = 0;
        data.unaffected = 0;
        data.ivap_base = 0;
      }
    }
    if (igvChanged) {
      data.igv = igv;
      if (modalKind === 'compra') {
        data.igv_ng = 0;
        data.igv_dng = 0;
      } else {
        data.discount_igv = 0;
      }
    }

    data.ruc_empresa = String(data.ruc_empresa || '').replace(/\D/g, '');
    data.doc_id_number = String(data.doc_id_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    data.series = String(data.series || '').toUpperCase().trim();
    data.number = String(data.number || '').toUpperCase().replace(/\s/g, '');
    data.source = modalRecord?.source || 'manual';
    data.raw = modalRecord?.raw || {};
    data.dedupe_key = dedupeKey(data);

    const missing = [];
    if (!/^\d{6}$/.test(data.period)) missing.push('período');
    if (!data.issue_date) missing.push('fecha de emisión');
    if (!data.doc_type) missing.push('tipo de comprobante');
    if (!data.series && !['20', '40', '50'].includes(data.doc_type)) missing.push('serie');
    if (!data.number) missing.push('número');
    if (!data.doc_id_number) missing.push('documento de la contraparte');
    if (!data.counterparty_name) missing.push('razón social de la contraparte');
    if (!Number.isFinite(Number(data.total))) missing.push('total');
    if (missing.length) {
      showToast(`Completa: ${missing.join(', ')}.`, 'error');
      return;
    }

    const submit = form.querySelector('[data-submit]');
    if (submit) { submit.disabled = true; submit.textContent = 'Guardando…'; }
    try {
      if (modalRecord?.id) {
        await taxService.update(modalRecord.id, data);
        showToast('Comprobante actualizado.');
      } else {
        await taxService.create(data);
        showToast('Comprobante registrado.');
      }
      if (!Number(data.total)) showToast('El total quedó en 0.00; verifica el comprobante.', 'info');
      closeModal();
      state.period = data.period;
      state.periodTouched = true;
      state.tab = data.kind === 'venta' ? 'venta' : 'compra';
      setTab(state.tab);
    } catch (err) {
      showToast(err.message || String(err), 'error');
      if (submit) { submit.disabled = false; submit.innerHTML = `${ICONS.check} Guardar`; }
    }
  });

  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.matches('textarea, button')) return;
    if (e.target.matches('input, select')) e.preventDefault();
  });

  // Evita que un clic accidental en el fondo cierre el formulario y pierda lo escrito.
  modal.addEventListener('cancel', (e) => {
    e.preventDefault();
  });

  load();
}

export default { title: 'Compras y Ventas', render };
