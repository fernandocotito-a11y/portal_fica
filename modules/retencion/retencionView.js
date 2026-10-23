/* ============================================================================
   retencionView.js — Agentes de Retención / Percepción (SUNAT)
   ----------------------------------------------------------------------------
   Pestañas:
     1. Retenciones   Reporte del período (registros importados).
     2. Percepciones  Reporte del período (registros importados).
     3. Importar      Carga de Excel (.xls/.xlsx) / CSV / TXT con deduplicación.
     4. Resumen       Totales mensuales por tipo y exportación.
   ========================================================================== */

import { retencionService } from './retencionService.js';
import { parseRetencionFiles } from './retencionParser.js';
import { kindLabel } from './retencionConfig.js';
import { periodLabel, periodToInput, inputToPeriod } from '../compras/comprasConfig.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const now = new Date();
const CURRENT_PERIOD = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

function num(value) {
  return Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displayDate(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function render(root) {
  const company = authService.activeCompany() || {};
  const viewRoot = root;

  const state = {
    tab: 'retencion',
    period: CURRENT_PERIOD,
    search: '',
    estado: '',
    page: 1,
    pageSize: 25,
    summaryYear: String(new Date().getFullYear()),
    parsed: null,
    importStatus: '',
    importBusy: false,
    parseBusy: false,
  };
  let loading = true;
  let error = '';

  viewRoot.innerHTML = `
    <div data-retencion-root>
    <div class="page-heading">
      <div>
        <h2 class="page-heading__title">Agentes de Retención</h2>
        <p class="page-heading__subtitle">
          Retenciones y percepciones SUNAT · ${escapeHtml(company.name || 'Empresa')} · RUC ${escapeHtml(company.ruc || '—')}
        </p>
      </div>
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center;">
        <span class="badge badge--muted" data-mode-badge><span class="badge__dot"></span>Conectando…</span>
        <button type="button" class="btn btn--primary" data-import>${ICONS.arrowRight} Importar Excel</button>
      </div>
    </div>
    <div class="tabs" style="margin:var(--space-4) 0;">
      ${[['retencion', 'Retenciones'], ['percepcion', 'Percepciones'], ['importar', 'Importar'], ['resumen', 'Resumen']]
        .map(([key, label]) => `<button type="button" class="tab ${state.tab === key ? 'is-active' : ''}" data-tab="${key}">${label}</button>`).join('')}
    </div>
    <div data-content></div>
    </div>`;

  const content = viewRoot.querySelector('[data-content]');
  const modal = document.createElement('dialog');
  modal.className = 'modal';
  viewRoot.appendChild(modal);

  function updateModeBadge() {
    const badge = viewRoot.querySelector('[data-mode-badge]');
    if (!badge) return;
    if (retencionService.mode === 'remote') {
      badge.className = 'badge badge--active';
      badge.innerHTML = `<span class="badge__dot"></span>Supabase conectado`;
      badge.title = 'Los datos se guardan en Supabase con aislamiento por empresa.';
    } else if (retencionService.mode === 'local') {
      badge.className = 'badge badge--gold';
      badge.innerHTML = `<span class="badge__dot"></span>Modo local`;
      badge.title = 'La tabla tax_retention_records no existe en Supabase. Ejecuta supabase/retencion_schema.sql.';
    } else {
      badge.className = 'badge badge--muted';
      badge.innerHTML = `<span class="badge__dot"></span>Conectando…`;
    }
  }

  function localBanner() {
    if (retencionService.mode !== 'local') return '';
    return `<div class="card" style="border-color:var(--color-gold);margin-bottom:var(--space-4);">
      <div class="card__body" style="display:flex;gap:var(--space-3);align-items:flex-start;">
        <span style="color:var(--color-gold);flex-shrink:0;">${ICONS.info}</span>
        <div>
          <strong>Modo local de prueba.</strong>
          La tabla <code>tax_retention_records</code> todavía no existe en Supabase.
          Los registros se guardan solo en este navegador. Para activar el modo multiusuario con RLS,
          ejecuta <code>supabase/retencion_schema.sql</code> en el SQL Editor de Supabase y recarga el portal.
          <div style="margin-top:var(--space-3);">
            <a class="btn" href="./supabase/retencion_schema.sql" target="_blank" rel="noopener">${ICONS.arrowRight} Abrir SQL de instalación</a>
          </div>
        </div>
      </div>
    </div>`;
  }

  function filteredRows(kind) {
    return retencionService.list(kind, { period: state.period, estado: state.estado, search: state.search });
  }

  function statsHtml(kind) {
    const rows = retencionService.list(kind, { period: state.period });
    const comprobantes = new Set(rows.map((r) => `${r.comprobante_serie}|${r.comprobante_numero}`)).size;
    const total = rows.reduce((a, r) => a + Number(r.monto_retenido || 0), 0);
    const base = rows.reduce((a, r) => a + Number(r.total_comprobante || 0), 0);
    return `
      <div class="stat-card"><span class="stat-card__icon">${ICONS.briefcase}</span><div><div class="stat-card__value">${comprobantes}</div><div class="stat-card__label">Comprobantes ${kind === 'percepcion' ? 'de percepción' : 'de retención'}</div></div></div>
      <div class="stat-card"><span class="stat-card__icon">${ICONS.building}</span><div><div class="stat-card__value">${num(base)}</div><div class="stat-card__label">Base (total comprobantes)</div></div></div>
      <div class="stat-card"><span class="stat-card__icon">${ICONS.arrowRight}</span><div><div class="stat-card__value">${num(total)}</div><div class="stat-card__label">Total ${kind === 'percepcion' ? 'percibido' : 'retenido'}</div></div></div>`;
  }

  function registryRowsHtml(rows) {
    if (!rows.length) {
      return `<tr><td colspan="12"><div class="empty-state">
        <span class="empty-state__icon">${ICONS.briefcase}</span>
        <div class="empty-state__title">Sin ${state.tab === 'percepcion' ? 'percepciones' : 'retenciones'} en ${escapeHtml(periodLabel(state.period))}</div>
        <div class="empty-state__desc">Importa el Excel de SUNAT o ajusta el período/filtros.</div>
      </div></td></tr>`;
    }
    return rows.map((r) => `
      <tr>
        <td style="white-space:nowrap;">${displayDate(r.comprobante_fecha)}</td>
        <td><strong>${escapeHtml(r.comprobante_serie || '—')}-${escapeHtml(r.comprobante_numero || '—')}</strong></td>
        <td><div class="table__name">${escapeHtml(r.agente_nombre || '—')}</div><div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(r.agente_ruc || '')}</div></td>
        <td class="cell-num">${Number(r.tasa || 0).toFixed(2)}%</td>
        <td>${escapeHtml(r.doc_tipo || '—')}<div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(r.doc_serie || '')}-${escapeHtml(r.doc_numero || '')}</div></td>
        <td style="white-space:nowrap;">${displayDate(r.doc_fecha)}</td>
        <td class="cell-num">${num(r.total_comprobante)}</td>
        <td class="cell-num">${num(r.importe_pagado)}</td>
        <td class="cell-num cell-strong">${num(r.monto_retenido)}</td>
        <td class="cell-num">${num(r.monto_neto)}</td>
        <td><span class="badge ${String(r.estado || '').toUpperCase() === 'EMITIDO' ? 'badge--active' : 'badge--muted'}">${escapeHtml(r.estado || '—')}</span></td>
        <td>
          <div class="table__actions">
            <button type="button" class="icon-btn" data-view="${escapeHtml(r.id)}" title="Ver detalle">${ICONS.eye}</button>
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
    if (statsEl) statsEl.innerHTML = statsHtml(state.tab);
    const rows = filteredRows(state.tab);
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pages) state.page = pages;
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
            <h3 class="card__title">${kind === 'percepcion' ? 'Percepciones' : 'Retenciones'}</h3>
            <p class="card__subtitle" data-filter-count>${filteredRows(kind).length} registro(s)</p>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
            <button type="button" class="btn" data-export>${ICONS.arrowRight} Exportar CSV</button>
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
              <input class="form-input" data-search value="${escapeHtml(state.search)}" placeholder="Agente, RUC, comprobante, documento…" />
            </div>
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">Estado</label>
              <select class="form-input" data-filter-estado>
                <option value="">Todos</option>
                ${['EMITIDO', 'BAJA', 'ANULADO', 'OTROS'].map((e) => `<option value="${e}"${state.estado === e ? ' selected' : ''}>${e}</option>`).join('')}
              </select>
            </div>
            <button type="button" class="btn" data-clear-filters>Limpiar</button>
          </div>
          <div class="table-wrap">
            <table class="table" style="min-width:1280px;">
              <thead>
                <tr>
                  <th>Fecha</th><th>Comprobante</th><th>Agente</th><th style="text-align:right;">Tasa</th>
                  <th>Documento</th><th>Fecha doc</th><th style="text-align:right;">Total</th>
                  <th style="text-align:right;">Pagado</th><th style="text-align:right;">Retenido</th>
                  <th style="text-align:right;">Neto</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody data-table-body></tbody>
            </table>
          </div>
          <div data-pagination></div>
        </div>
      </div>`;
  }

  function previewRecordsHtml(records) {
    const preview = records.slice(0, 20);
    if (!preview.length) return '';
    return `
      <div class="table-wrap" style="margin-top:var(--space-4);max-height:420px;overflow:auto;">
        <table class="table" style="min-width:1080px;">
          <thead><tr><th>Período</th><th>Comprobante</th><th>Agente</th><th>Documento</th><th style="text-align:right;">Total</th><th style="text-align:right;">Retenido</th></tr></thead>
          <tbody>
            ${preview.map((r) => `<tr>
              <td>${escapeHtml(r.period || '—')}</td>
              <td>${escapeHtml(r.comprobante_serie || '—')}-${escapeHtml(r.comprobante_numero || '—')}</td>
              <td>${escapeHtml(r.agente_nombre || '—')}</td>
              <td>${escapeHtml(r.doc_tipo || '—')} ${escapeHtml(r.doc_serie || '')}-${escapeHtml(r.doc_numero || '')}</td>
              <td class="cell-num">${num(r.total_comprobante)}</td>
              <td class="cell-num">${num(r.monto_retenido)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${records.length > preview.length ? `<p class="text-muted" style="font-size:var(--font-size-sm);margin-top:var(--space-2);">Vista previa de ${preview.length} de ${records.length} registros.</p>` : ''}`;
  }

  function fileRowsHtml(files) {
    return files.map((f) => `
      <tr>
        <td><div class="table__name" style="font-size:var(--font-size-sm);">${escapeHtml(f.fileName)}</div></td>
        <td>${f.kind ? `<span class="badge ${f.kind === 'percepcion' ? 'badge--gold' : 'badge--active'}">${kindLabel(f.kind)}</span>` : '<span class="badge badge--muted">No reconocido</span>'}</td>
        <td>${escapeHtml([...new Set((f.records || []).map((r) => r.period).filter(Boolean))].map(periodLabel).join(', ') || '—')}</td>
        <td class="cell-num">${(f.records || []).length}</td>
        <td class="cell-num">${f.duplicates || 0}</td>
        <td>${(f.warnings || []).length ? `<span class="text-muted" title="${escapeHtml((f.warnings || []).join(' '))}">${(f.warnings || []).length} aviso(s)</span>` : '<span class="badge badge--active">OK</span>'}</td>
      </tr>`).join('');
  }

  function renderImport() {
    const files = state.parsed?.files || [];
    const records = state.parsed?.records || [];
    const warnings = state.parsed?.warnings || [];
    return `
      ${localBanner()}
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Importar retenciones / percepciones</h3>
            <p class="card__subtitle">Acepta el Excel (.xls/.xlsx) de “Consulta de Comprobantes” de SUNAT, o un CSV/TXT exportado. Detecta retenciones y percepciones, y omite lo ya importado.</p>
          </div>
        </div>
        <div class="card__body">
          <input type="file" data-files accept=".xls,.xlsx,.csv,.txt" multiple hidden />
          <div data-drop style="border:1.5px dashed var(--color-border);border-radius:var(--radius-lg);padding:var(--space-7);text-align:center;cursor:pointer;">
            ${ICONS.briefcase}
            <div style="margin-top:var(--space-2);"><strong>Arrastra aquí los archivos</strong> o haz clic para seleccionarlos</div>
            <div class="text-muted" style="font-size:var(--font-size-sm);">Puedes cargar varios a la vez.</div>
            <button type="button" class="btn btn--primary" style="margin-top:var(--space-3);">${ICONS.arrowRight} Seleccionar archivos</button>
          </div>
          <div data-import-status class="text-muted" style="margin-top:var(--space-3);font-size:var(--font-size-sm);">${escapeHtml(state.importStatus)}</div>

          ${files.length ? `
            <div class="table-wrap" style="margin-top:var(--space-4);">
              <table class="table">
                <thead><tr><th>Archivo</th><th>Tipo</th><th>Períodos</th><th style="text-align:right;">Registros</th><th style="text-align:right;">Duplicados</th><th>Estado</th></tr></thead>
                <tbody>${fileRowsHtml(files)}</tbody>
              </table>
            </div>
            ${previewRecordsHtml(records)}
            <div style="display:flex;gap:var(--space-2);margin-top:var(--space-4);flex-wrap:wrap;">
              <button type="button" class="btn btn--primary" data-do-import ${state.importBusy || !records.length ? 'disabled' : ''}>${ICONS.check} Importar ${records.length} registro(s)</button>
              <button type="button" class="btn" data-reset-import>Cancelar</button>
            </div>
          ` : ''}

          ${warnings.length ? `<div class="card" style="border-color:var(--color-gold);margin-top:var(--space-4);"><div class="card__body">${warnings.map((w) => `<div style="font-size:var(--font-size-sm);">${ICONS.info} ${escapeHtml(w)}</div>`).join('')}</div></div>` : ''}
        </div>
      </div>`;
  }

  function summaryYearOptions() {
    const years = new Set([now.getFullYear()]);
    for (let y = now.getFullYear() - 10; y <= now.getFullYear() + 1; y += 1) years.add(y);
    retencionService.all().forEach((r) => { const y = String(r.period || '').slice(0, 4); if (/^\d{4}$/.test(y)) years.add(Number(y)); });
    return [...years].sort((a, b) => b - a);
  }

  function renderSummary() {
    const year = state.summaryYear;
    const rows = retencionService.monthly(year);
    const totals = rows.reduce((acc, r) => {
      acc.retencion.base += r.retencion.base;
      acc.retencion.retenido += r.retencion.retenido;
      acc.percepcion.base += r.percepcion.base;
      acc.percepcion.retenido += r.percepcion.retenido;
      return acc;
    }, { retencion: { base: 0, retenido: 0 }, percepcion: { base: 0, retenido: 0 } });
    return `
      ${localBanner()}
      <div class="stats">
        <div class="stat-card"><span class="stat-card__icon">${ICONS.arrowRight}</span><div><div class="stat-card__value">${num(totals.retencion.retenido)}</div><div class="stat-card__label">Total retenido ${year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.arrowRight}</span><div><div class="stat-card__value">${num(totals.percepcion.retenido)}</div><div class="stat-card__label">Total percibido ${year}</div></div></div>
      </div>
      <div class="card">
        <div class="card__header">
          <div><h3 class="card__title">Resumen mensual ${year}</h3><p class="card__subtitle">Base y monto retenido/percibido por mes.</p></div>
          <div style="display:flex;gap:var(--space-2);align-items:center;">
            <select class="form-input" data-summary-year style="max-width:130px;">${summaryYearOptions().map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
            <button type="button" class="btn" data-export-summary>${ICONS.arrowRight} Exportar resumen</button>
          </div>
        </div>
        <div class="card__body">
          <div class="table-wrap">
            <table class="table" style="min-width:860px;">
              <thead>
                <tr><th rowspan="2" style="vertical-align:middle;">Mes</th>
                  <th colspan="2">Retenciones</th><th colspan="2">Percepciones</th></tr>
                <tr><th style="text-align:right;">Base</th><th style="text-align:right;">Retenido</th>
                  <th style="text-align:right;">Base</th><th style="text-align:right;">Percibido</th></tr>
              </thead>
              <tbody>
                ${rows.map((r) => `<tr>
                  <td>${escapeHtml(r.label)}</td>
                  <td class="cell-num">${num(r.retencion.base)}</td><td class="cell-num cell-strong">${num(r.retencion.retenido)}</td>
                  <td class="cell-num">${num(r.percepcion.base)}</td><td class="cell-num cell-strong">${num(r.percepcion.retenido)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function renderContent() {
    if (loading) {
      content.innerHTML = `<div class="card"><div class="card__body text-muted">Cargando retenciones y percepciones…</div></div>`;
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
    else {
      content.innerHTML = renderRegistry();
      updateRegistry();
    }
  }

  function setTab(tab) {
    state.tab = tab;
    state.page = 1;
    viewRoot.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    });
    renderContent();
  }

  function ensurePeriod(forceLatest = false) {
    const all = retencionService.all();
    const list = all.filter((r) => r.kind === state.tab || state.tab === 'resumen' || state.tab === 'importar');
    const latest = list.map((r) => r.period).filter(Boolean).sort().pop();
    if (latest) {
      if (forceLatest || !state.period || state.period < latest) state.period = latest;
    } else if (!state.period) {
      state.period = CURRENT_PERIOD;
    }
  }

  function openDetail(rec) {
    if (!rec) return;
    modal.innerHTML = `
      <div class="modal__header">
        <h3 class="modal__title">Detalle del ${rec.kind === 'percepcion' ? 'documento percibido' : 'documento retenido'}</h3>
        <button type="button" class="modal__close" data-close aria-label="Cerrar">${ICONS.close}</button>
      </div>
      <div class="modal__body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-3);">
          ${detailItem('Período', periodLabel(rec.period))}
          ${detailItem('Comprobante', `${rec.comprobante_serie || '—'}-${rec.comprobante_numero || '—'}`)}
          ${detailItem('Fecha comprobante', displayDate(rec.comprobante_fecha))}
          ${detailItem('Estado', rec.estado || '—')}
          ${detailItem('Tasa', `${Number(rec.tasa || 0).toFixed(2)}%`)}
          ${detailItem('Agente', `${rec.agente_nombre || '—'} (${rec.agente_ruc || ''})`)}
          ${detailItem('Receptor', `${rec.receptor_nombre || '—'} (${rec.receptor_ruc || ''})`)}
          ${detailItem('Tipo documento', rec.doc_tipo || '—')}
          ${detailItem('Serie / Número', `${rec.doc_serie || '—'}-${rec.doc_numero || '—'}`)}
          ${detailItem('Fecha documento', displayDate(rec.doc_fecha))}
          ${detailItem('Total comprobante', num(rec.total_comprobante))}
          ${detailItem('Nro. de pago', rec.nro_pago || '—')}
          ${detailItem('Importe pagado', num(rec.importe_pagado))}
          ${detailItem('Monto retenido', num(rec.monto_retenido))}
          ${detailItem('Monto neto', num(rec.monto_neto))}
        </div>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn" data-close>Cerrar</button>
      </div>`;
    modal.showModal();
  }

  function detailItem(label, value) {
    return `<div><div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(label)}</div><div style="margin-top:2px;">${escapeHtml(value == null || value === '' ? '—' : value)}</div></div>`;
  }

  function closeModal() {
    if (modal.open) modal.close();
    modal.innerHTML = '';
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    state.parseBusy = true;
    state.importStatus = `Leyendo ${files.length} archivo(s)…`;
    state.tab = 'importar';
    setTab('importar');
    renderContent();
    try {
      const res = await parseRetencionFiles(files, {
        onProgress: (msg) => {
          state.importStatus = msg || 'Procesando…';
          const el = content.querySelector('[data-import-status]');
          if (el) el.textContent = msg || '';
        },
      });
      state.parsed = res;
      state.importStatus = '';
      renderContent();
      if (!res.records.length) showToast('No se encontraron documentos válidos en los archivos.', 'error');
    } catch (err) {
      state.importStatus = '';
      showToast(err.message || String(err), 'error');
      renderContent();
    } finally {
      state.parseBusy = false;
    }
  }

  async function doImport() {
    const currentParsed = state.parsed;
    if (!currentParsed?.records?.length) return;
    state.importBusy = true;
    renderContent();
    try {
      const res = await retencionService.importParsed(currentParsed.files);
      showToast(`Importación completa: ${res.imported} nuevo(s), ${res.skipped} omitido(s) (ya existían).`);
      state.parsed = null;
      state.importStatus = '';
      renderContent();
    } catch (err) {
      showToast(err.message || String(err), 'error');
    } finally {
      state.importBusy = false;
      renderContent();
    }
  }

  async function removeRecord(id) {
    const rec = retencionService.all().find((r) => r.id === id);
    const ok = await confirmDialog({
      title: 'Eliminar registro',
      message: `¿Eliminar ${rec?.doc_tipo || ''} ${rec?.doc_serie || ''}-${rec?.doc_numero || ''} de ${rec?.agente_nombre || ''}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await retencionService.remove(id);
      showToast('Registro eliminado.');
      renderContent();
    } catch (err) { showToast(err.message || String(err), 'error'); }
  }

  viewRoot.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }

    if (e.target.closest('[data-import]')) { setTab('importar'); return; }
    if (e.target.closest('[data-retry]')) { loading = true; renderContent(); load(); return; }

    if (e.target.closest('[data-drop]') || e.target.closest('[data-drop] button')) {
      content.querySelector('[data-files]')?.click();
      return;
    }

    if (e.target.closest('[data-do-import]')) { doImport(); return; }
    if (e.target.closest('[data-reset-import]')) { state.parsed = null; state.importStatus = ''; renderContent(); return; }

    if (e.target.closest('[data-export]')) {
      const rows = filteredRows(state.tab);
      if (!rows.length) { showToast('No hay registros para exportar con los filtros actuales.', 'error'); return; }
      retencionService.downloadCsv(state.tab, rows);
      return;
    }

    if (e.target.closest('[data-export-summary]')) {
      const rows = retencionService.monthly(state.summaryYear);
      const headers = ['Periodo', 'Ret. base', 'Ret. retenido', 'Per. base', 'Per. percibido'];
      const data = rows.map((r) => [r.period, r.retencion.base.toFixed(2), r.retencion.retenido.toFixed(2), r.percepcion.base.toFixed(2), r.percepcion.retenido.toFixed(2)]);
      const text = `\uFEFF${[headers, ...data].map((r) => r.map((v) => String(v ?? '')).join(',')).join('\r\n')}`;
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RESUMEN_RETENCIONES_${state.summaryYear}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }

    const view = e.target.closest('[data-view]');
    if (view) { openDetail(retencionService.all().find((r) => r.id === view.dataset.view)); return; }
    const del = e.target.closest('[data-del]');
    if (del) { removeRecord(del.dataset.del); return; }

    if (e.target.closest('[data-close]')) { closeModal(); return; }

    if (e.target.closest('[data-clear-filters]')) {
      state.search = '';
      state.estado = '';
      state.period = CURRENT_PERIOD;
      renderContent();
      return;
    }

    const page = e.target.closest('[data-page]');
    if (page) {
      state.page += page.dataset.page === 'next' ? 1 : -1;
      if (state.page < 1) state.page = 1;
      renderContent();
      return;
    }
  });

  viewRoot.addEventListener('change', (e) => {
    if (e.target.matches('[data-files]')) { handleFiles(e.target.files); return; }
    if (e.target.matches('[data-period]')) {
      state.period = inputToPeriod(e.target.value) || CURRENT_PERIOD;
      state.page = 1;
      renderContent();
      return;
    }
    if (e.target.matches('[data-filter-estado]')) {
      state.estado = e.target.value;
      state.page = 1;
      updateRegistry();
      return;
    }
    if (e.target.matches('[data-summary-year]')) {
      state.summaryYear = Number(e.target.value) || new Date().getFullYear();
      renderContent();
      return;
    }
  });

  viewRoot.addEventListener('input', (e) => {
    if (e.target.matches('[data-search]')) {
      state.search = e.target.value;
      state.page = 1;
      updateRegistry();
    }
  });

  modal.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  async function load() {
    loading = true;
    error = '';
    renderContent();
    try {
      await retencionService.refresh();
      updateModeBadge();
      ensurePeriod(true);
      loading = false;
      renderContent();
    } catch (err) {
      loading = false;
      error = err.message || String(err);
      renderContent();
    }
  }

  load();
}

export default { title: 'Agentes de Retención', render };
