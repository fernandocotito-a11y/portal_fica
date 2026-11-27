/* ============================================================================
   honorariosView.js — Recibos por Honorarios Electrónicos (RHE / PDT 601)
   ----------------------------------------------------------------------------
   Módulo independiente (no dentro de Agentes de Retención):
     1. Recibos       Importación del TXT de SUNAT, dedupe y tabla del mes.
     2. Asiento       Asiento mensual con cuentas editables y exportación CSV.
   El login de SUNAT NO se automatiza: el usuario descarga el TXT manualmente.
   ========================================================================== */

import { honorariosService } from './honorariosService.js';
import { parseHonorariosTxt } from './honorariosParser.js';
import { buildAsiento, downloadPdtZip, downloadPdtSingle, downloadAsiento } from './honorariosPdtService.js';
import { periodLabel, periodToInput, inputToPeriod } from '../compras/comprasConfig.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

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

function blankRheForm() {
  return {
    fecha_emision: '',
    doc_tipo_codigo: '06',
    doc_numero: '',
    emisor_nombre: '',
    tipo_doc_emitido: 'RH',
    nro_doc_emitido: '',
    serie: '',
    numero: '',
    descripcion: '',
    renta_bruta: '',
    impuesto_renta: '',
    renta_neta: '',
    moneda: 'PEN',
    pagado: false,
    fecha_pago: '',
  };
}

function rheExcludedText(ex = {}) {
  const parts = [];
  if (ex.anulados) parts.push(`${ex.anulados} anulado(s)`);
  if (ex.impagos) parts.push(`${ex.impagos} impago(s)`);
  if (ex.otroMes) parts.push(`${ex.otroMes} de otro mes`);
  const total = parts.reduce((sum, _, i) => sum + [ex.anulados, ex.impagos, ex.otroMes][i], 0);
  return parts.length ? ` ${total} excluidos (${parts.join(', ')}).` : '';
}

export function render(root) {
  const company = authService.activeCompany() || {};
  const viewRoot = root;

  const state = {
    tab: 'recibos',
    rhePeriod: CURRENT_PERIOD,
    rheDateField: 'pago',
    rheSearch: '',
    rheParsed: null,
    rheStatus: '',
    rheBusy: false,
    rheAccounts: [],
    rheConfig: { cuenta_retencion: '40173', cuenta_pago: '4111' },
    rheSummary: { count: 0, bruta: 0, retenido: 0, neto: 0, anulados: 0, pendientes: 0 },
    rheFormOpen: false,
    rheForm: blankRheForm(),
    rheSourceFile: '',
  };
  let loading = true;
  let error = '';

  viewRoot.innerHTML = `
    <div data-honorarios-root>
    <div class="page-heading">
      <div>
        <h2 class="page-heading__title">Recibos de Honorarios</h2>
        <p class="page-heading__subtitle">
          TXT de Consulta Receptor · PDT 601 · ${escapeHtml(company.name || 'Empresa')} · RUC ${escapeHtml(company.ruc || '—')}
        </p>
      </div>
      <span class="badge badge--muted" data-mode-badge><span class="badge__dot"></span>Conectando…</span>
    </div>
    <div class="tabs-bar" data-tabs>
      ${[['recibos', 'Recibos'], ['asiento', 'Asiento mensual']]
        .map(([key, label]) => `<button type="button" class="tab-btn ${state.tab === key ? 'is-active' : ''}" data-tab="${key}">${label}</button>`).join('')}
    </div>
    <div data-content></div>
    </div>`;

  const content = viewRoot.querySelector('[data-content]');

  function updateModeBadge() {
    const badge = viewRoot.querySelector('[data-mode-badge]');
    if (!badge) return;
    if (honorariosService.mode === 'remote') {
      badge.className = 'badge badge--active';
      badge.innerHTML = `<span class="badge__dot"></span>Supabase conectado`;
      badge.title = 'Los recibos se guardan en Supabase con aislamiento por empresa.';
    } else if (honorariosService.mode === 'local') {
      badge.className = 'badge badge--gold';
      badge.innerHTML = `<span class="badge__dot"></span>Modo local`;
      badge.title = 'Ejecuta supabase/honorarios_schema.sql para guardar en Supabase.';
    } else {
      badge.className = 'badge badge--muted';
      badge.innerHTML = `<span class="badge__dot"></span>Conectando…`;
    }
  }

  function rheYearMonth() {
    return { year: state.rhePeriod.slice(0, 4), month: state.rhePeriod.slice(4, 6) };
  }

  /** PDT y asiento SIEMPRE usan mes de pago. */
  function rheMonthRows(includeAnulados = true) {
    const { year, month } = rheYearMonth();
    return honorariosService.list({ year, month, includeAnulados, dateField: 'pago' });
  }

  /** Filas mostradas en la tabla (con búsqueda y filtro pago/emisión). */
  function rheRows(includeAnulados = true) {
    const { year, month } = rheYearMonth();
    return honorariosService.list({ year, month, search: state.rheSearch, includeAnulados, dateField: state.rheDateField });
  }

  function rheSourceFiles() {
    const names = new Set(['MANUAL']);
    honorariosService.all().forEach((r) => {
      if (r.source_file) names.add(String(r.source_file));
    });
    return [...names].sort((a, b) => (a === 'MANUAL' ? -1 : b === 'MANUAL' ? 1 : a.localeCompare(b)));
  }

  function rhePen(row, field) {
    const pen = Number(row[`${field}_pen`]);
    return Number.isFinite(pen) ? pen : Number(row[field] || 0);
  }

  function rheAccountOptions(selected) {
    const list = [
      { value: '', label: 'Sin asignar' },
      ...state.rheAccounts.map((a) => ({
        value: a.cuenta_gasto,
        label: `${a.cuenta_gasto} — ${a.denominacion || a.concepto || ''}`,
      })),
    ];
    if (selected && !list.some((o) => String(o.value) === String(selected))) {
      list.push({ value: selected, label: `${selected} — (cuenta personalizada)` });
    }
    return list.map((o) => `<option value="${escapeHtml(o.value)}"${String(o.value) === String(selected || '') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  }

  function rhePreviewHtml() {
    const parsed = state.rheParsed;
    if (!parsed) return '';
    const records = parsed.records || [];
    const preview = records.slice(0, 20);
    return `
      <div class="table-wrap" style="margin-top:var(--space-4);max-height:380px;overflow:auto;">
        <table class="table" style="min-width:860px;">
          <thead><tr><th>Fecha</th><th>Emisor</th><th>Comprobante</th><th>Descripción</th><th style="text-align:right;">Renta bruta</th><th style="text-align:right;">IR</th></tr></thead>
          <tbody>${preview.map((r) => `<tr>
            <td style="white-space:nowrap;">${escapeHtml(displayDate(r.fecha_emision))}</td>
            <td>${escapeHtml(r.emisor_nombre || '—')}<div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(r.doc_tipo_emisor || '')} ${escapeHtml(r.doc_numero || '')}</div></td>
            <td>${escapeHtml(r.tipo_doc_emitido || '—')} ${escapeHtml(r.nro_doc_emitido || '')}</td>
            <td>${escapeHtml(r.descripcion || '—')}</td>
            <td class="cell-num">${num(r.renta_bruta)}</td>
            <td class="cell-num">${num(r.impuesto_renta)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      ${records.length > preview.length ? `<p class="text-muted" style="font-size:var(--font-size-sm);margin-top:var(--space-2);">Vista previa de ${preview.length} de ${records.length} registros.</p>` : ''}`;
  }

  function renderRecibos() {
    const rows = rheRows(true);
    const monthRows = rheMonthRows(true);
    const summary = state.rheSummary;
    const parsed = state.rheParsed;
    const sourceFiles = rheSourceFiles();
    if (!sourceFiles.includes(state.rheSourceFile)) state.rheSourceFile = sourceFiles[0] || '';
    return `
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Recibos por Honorarios Electrónicos</h3>
            <p class="card__subtitle">TXT descargado manualmente de SUNAT OLE → Consulta Receptor de Recibos por Honorarios Electrónicos.</p>
          </div>
          <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;">
            <button type="button" class="btn" data-rhe-pdt ${monthRows.length ? '' : 'disabled'}>${ICONS.arrowRight} Descargar PDT 601 (ZIP)</button>
            <button type="button" class="btn btn--ghost btn--sm" data-rhe-pdt-single="ps4" title="Descargar .ps4" ${monthRows.length ? '' : 'disabled'}>Proveedores</button>
            <button type="button" class="btn btn--ghost btn--sm" data-rhe-pdt-single="4ta" title="Descargar .4ta" ${monthRows.length ? '' : 'disabled'}>Comprobantes</button>
            <button type="button" class="btn btn--ghost btn--sm" data-rhe-form-open>${ICONS.info} Agregar recibo</button>
          </div>
          <div style="display:flex;gap:var(--space-2);align-items:flex-end;flex-wrap:wrap;margin-top:var(--space-2);">
            <div class="form-group" style="margin:0;min-width:260px;">
              <label class="form-label">Limpiar archivo importado</label>
              <select class="form-input" data-rhe-source-file>${sourceFiles.map((name) => `<option value="${escapeHtml(name)}"${name === state.rheSourceFile ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>
            </div>
            <button type="button" class="btn btn--ghost btn--sm" data-rhe-clear-file ${state.rheSourceFile ? '' : 'disabled'}>Limpiar archivo</button>
          </div>
        </div>
        <div class="card__body">
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">${state.rheDateField === 'pago' ? 'Mes de pago' : 'Mes de emisión'}</label>
              <input type="month" class="form-input" data-rhe-period value="${escapeHtml(periodToInput(state.rhePeriod))}" />
            </div>
            <div class="form-group" style="margin:0;min-width:150px;">
              <label class="form-label">Filtrar por</label>
              <select class="form-input" data-rhe-date-field>
                <option value="pago"${state.rheDateField === 'pago' ? ' selected' : ''}>Pago</option>
                <option value="emision"${state.rheDateField === 'emision' ? ' selected' : ''}>Emisión</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;min-width:240px;flex:1;">
              <label class="form-label">Buscar</label>
              <input class="form-input" data-rhe-search value="${escapeHtml(state.rheSearch)}" placeholder="Emisor, RUC/DNI, comprobante, descripción…" />
            </div>
          </div>
          <input type="file" data-rhe-files accept=".txt,.csv" hidden />
          <div data-rhe-drop style="border:1.5px dashed var(--color-border);border-radius:var(--radius-lg);padding:var(--space-6);text-align:center;cursor:pointer;">
            ${ICONS.briefcase}
            <div style="margin-top:var(--space-2);"><strong>Arrastra aquí el TXT de SUNAT</strong> o haz clic para seleccionarlo</div>
            <div class="text-muted" style="font-size:var(--font-size-sm);">Acepta .txt y .csv con separador |. El login de SUNAT NO se automatiza: descarga el archivo manualmente.</div>
            <button type="button" class="btn" style="margin-top:var(--space-3);">Seleccionar TXT</button>
          </div>
          <div data-rhe-status class="text-muted" style="margin-top:var(--space-3);font-size:var(--font-size-sm);">${escapeHtml(state.rheStatus)}</div>
          ${parsed ? `
            <div class="card" style="border-color:var(--color-gold);margin-top:var(--space-4);">
              <div class="card__body">
                <strong>${parsed.records.length} registro(s) leídos de ${escapeHtml(parsed.fileNames.join(', '))}</strong>
                ${parsed.duplicates ? `<p class="text-muted" style="font-size:var(--font-size-sm);">${parsed.duplicates} registro(s) repetidos dentro del archivo: se omitirán.</p>` : ''}
                ${(parsed.warnings || []).length ? `<div style="margin-top:var(--space-2);font-size:var(--font-size-sm);">${parsed.warnings.map((w) => `<div>${ICONS.info} ${escapeHtml(w)}</div>`).join('')}</div>` : ''}
                <div style="display:flex;gap:var(--space-2);margin-top:var(--space-3);flex-wrap:wrap;">
                  <button type="button" class="btn btn--primary" data-rhe-do-import ${state.rheBusy || !parsed.records.length ? 'disabled' : ''}>${ICONS.check} Importar TXT SUNAT</button>
                  <button type="button" class="btn" data-rhe-reset>Cancelar</button>
                </div>
                ${rhePreviewHtml()}
              </div>
            </div>` : ''}
          ${state.rheFormOpen ? `
            <div class="card" style="border-color:var(--color-gold);margin-top:var(--space-4);">
              <div class="card__header">
                <div><h3 class="card__title">Agregar recibo individual</h3><p class="card__subtitle">Alta manual. Si hay saldo pendiente, queda PENDIENTE hasta que marques la fecha de pago.</p></div>
                <button type="button" class="btn btn--ghost btn--sm" data-rhe-form-cancel>Cancelar</button>
              </div>
              <div class="card__body">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-3);">
                  <div class="form-group" style="margin:0;"><label class="form-label">Fecha emisión</label><input type="date" class="form-input" data-rhe-form="fecha_emision" value="${escapeHtml(state.rheForm.fecha_emision)}" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Tipo emisor</label><select class="form-input" data-rhe-form="doc_tipo_codigo"><option value="06"${state.rheForm.doc_tipo_codigo === '06' ? ' selected' : ''}>RUC</option><option value="01"${state.rheForm.doc_tipo_codigo === '01' ? ' selected' : ''}>DNI</option></select></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Nro documento</label><input class="form-input" data-rhe-form="doc_numero" value="${escapeHtml(state.rheForm.doc_numero)}" placeholder="RUC/DNI del emisor" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Razón social / Emisor</label><input class="form-input" data-rhe-form="emisor_nombre" value="${escapeHtml(state.rheForm.emisor_nombre)}" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Tipo comprobante</label><select class="form-input" data-rhe-form="tipo_doc_emitido"><option value="RH"${state.rheForm.tipo_doc_emitido === 'RH' ? ' selected' : ''}>RH</option><option value="NC"${state.rheForm.tipo_doc_emitido === 'NC' ? ' selected' : ''}>NC</option></select></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Serie</label><input class="form-input" data-rhe-form="serie" value="${escapeHtml(state.rheForm.serie)}" placeholder="E001" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Número</label><input class="form-input" data-rhe-form="numero" value="${escapeHtml(state.rheForm.numero)}" placeholder="46" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Descripción</label><input class="form-input" data-rhe-form="descripcion" value="${escapeHtml(state.rheForm.descripcion)}" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Renta bruta</label><input type="number" step="0.01" class="form-input" data-rhe-form="renta_bruta" value="${escapeHtml(state.rheForm.renta_bruta)}" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">IR</label><input type="number" step="0.01" class="form-input" data-rhe-form="impuesto_renta" value="${escapeHtml(state.rheForm.impuesto_renta)}" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Renta neta</label><input type="number" step="0.01" class="form-input" data-rhe-form="renta_neta" value="${escapeHtml(state.rheForm.renta_neta)}" /></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Moneda</label><select class="form-input" data-rhe-form="moneda"><option value="PEN"${state.rheForm.moneda === 'PEN' ? ' selected' : ''}>PEN</option><option value="USD"${state.rheForm.moneda === 'USD' ? ' selected' : ''}>USD</option></select></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Pagado</label><label style="display:flex;gap:var(--space-2);align-items:center;min-height:38px;"><input type="checkbox" data-rhe-form="pagado"${state.rheForm.pagado ? ' checked' : ''} /> Marcar como pagado</label></div>
                  <div class="form-group" style="margin:0;"><label class="form-label">Fecha de pago</label><input type="date" class="form-input" data-rhe-form="fecha_pago" value="${escapeHtml(state.rheForm.fecha_pago)}"${state.rheForm.pagado ? '' : ' disabled'} /></div>
                </div>
                <div style="margin-top:var(--space-4);"><button type="button" class="btn btn--primary" data-rhe-form-save>${ICONS.check} Guardar recibo</button></div>
              </div>
            </div>` : ''}
          ${!monthRows.length ? `
            <div class="card" style="border-color:var(--color-gold);margin-top:var(--space-4);">
              <div class="card__body">
                <strong>Falta descargar el TXT de SUNAT (Consulta Receptor)</strong>
                <p class="text-muted" style="margin-top:var(--space-2);font-size:var(--font-size-sm);">
                  Ingresa a <a href="https://www.sunat.gob.pe/" target="_blank" rel="noopener">https://www.sunat.gob.pe/</a>,
                  entra a <strong>SOL → Empresas → Recibos por Honorarios → Consulta Receptor</strong> (opción de ARCHIVO TXT),
                  elige el rango del mes y sube aquí el archivo descargado. Recuerda hacerlo cada mes antes de declarar el PDT 601 y el asiento.
                </p>
              </div>
            </div>` : ''}
          <div class="stats" style="margin-top:var(--space-4);">
            <div class="stat-card"><span class="stat-card__icon">${ICONS.briefcase}</span><div><div class="stat-card__value">${summary.count}</div><div class="stat-card__label">Recibos pagados (mes de pago)</div></div></div>
            <div class="stat-card"><span class="stat-card__icon">${ICONS.arrowRight}</span><div><div class="stat-card__value">${num(summary.bruta)}</div><div class="stat-card__label">Renta bruta (PEN)</div></div></div>
            <div class="stat-card"><span class="stat-card__icon">${ICONS.check}</span><div><div class="stat-card__value">${num(summary.retenido)}</div><div class="stat-card__label">Impuesto retenido</div></div></div>
            <div class="stat-card"><span class="stat-card__icon">${ICONS.info}</span><div><div class="stat-card__value">${summary.pendientes || 0}</div><div class="stat-card__label">Pendientes de pago</div></div></div>
            <div class="stat-card"><span class="stat-card__icon">${ICONS.info}</span><div><div class="stat-card__value">${summary.anulados}</div><div class="stat-card__label">Anulados (excluidos)</div></div></div>
          </div>
          <div class="table-wrap" style="margin-top:var(--space-4);">
            <table class="table" style="min-width:1560px;">
              <thead><tr>
                <th>Fecha emisión</th><th>Emisor</th><th>Comprobante</th><th>Descripción</th>
                <th style="text-align:right;">Renta bruta</th><th style="text-align:right;">IR</th><th style="text-align:right;">Renta neta</th>
                <th>Fecha pago</th><th>Pago</th><th>Cuenta de gasto</th><th>Estado</th><th>Acciones</th>
              </tr></thead>
              <tbody>${rows.length ? rows.map((r) => `<tr>
                <td style="white-space:nowrap;">${escapeHtml(displayDate(r.fecha_emision))}</td>
                <td><div class="table__name">${escapeHtml(r.emisor_nombre || '—')}</div><div class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(r.doc_tipo_codigo === '01' ? 'DNI' : 'RUC')} ${escapeHtml(r.doc_numero || '')}</div></td>
                <td>${escapeHtml(r.tipo_doc_emitido || '—')} <strong>${escapeHtml(r.serie || '')}-${escapeHtml(r.numero || '')}</strong></td>
                <td style="max-width:240px;">${escapeHtml(r.descripcion || '—')}</td>
                <td class="cell-num">${num(rhePen(r, 'renta_bruta'))}</td>
                <td class="cell-num">${num(rhePen(r, 'impuesto_renta'))}</td>
                <td class="cell-num cell-strong">${num(rhePen(r, 'renta_neta'))}</td>
                <td style="white-space:nowrap;">${escapeHtml(displayDate(r.fecha_pago))}<input type="date" class="form-input" data-rhe-pago-fecha="${escapeHtml(r.id)}" value="${escapeHtml(r.fecha_pago || '')}" style="min-width:140px;margin-top:var(--space-1);" /></td>
                <td><span class="badge ${r.pagado ? 'badge--active' : 'badge--gold'}">${r.pagado ? 'PAGADO' : 'PENDIENTE'}</span><label style="display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-1);font-size:var(--font-size-xs);"><input type="checkbox" data-rhe-pagado="${escapeHtml(r.id)}"${r.pagado ? ' checked' : ''} /> Marcar pagado</label></td>
                <td><select class="form-input" data-rhe-cuenta="${escapeHtml(r.id)}" style="min-width:200px;">${rheAccountOptions(r.cuenta_gasto)}</select></td>
                <td><span class="badge ${r.anulado ? 'badge--gold' : 'badge--active'}">${r.anulado ? 'ANULADO' : 'VIGENTE'}</span></td>
                <td><button type="button" class="btn btn--ghost btn--sm" data-rhe-delete="${escapeHtml(r.id)}">Eliminar</button></td>
              </tr>`).join('') : `<tr><td colspan="12"><div class="empty-state"><span class="empty-state__icon">${ICONS.briefcase}</span><div class="empty-state__title">Sin recibos en ${escapeHtml(periodLabel(state.rhePeriod))}</div><div class="empty-state__desc">Importa el TXT, agrega un recibo o cambia el mes / filtro.</div></div></td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function renderAsiento() {
    const { year, month } = rheYearMonth();
    const rows = rheMonthRows(false);
    const entry = buildAsiento(rows, state.rheConfig, state.rheAccounts, year, month);
    return `
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Asiento mensual de recibos por honorarios</h3>
            <p class="card__subtitle">Una sola transacción con los recibos PAGADOS en el mes de pago. Anulados, impagos y otros meses se excluyen.</p>
          </div>
          <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;">
            <span class="badge badge--active">${entry.count || 0} recibo(s) pagado(s)</span>
            <span class="badge badge--gold">${(entry.excluded?.anulados || 0) + (entry.excluded?.impagos || 0) + (entry.excluded?.otroMes || 0)} excluido(s)</span>
            <span class="badge ${entry.balanced ? 'badge--active' : 'badge--gold'}">${entry.balanced ? 'Cuadrado' : 'No cuadrado'}</span>
            <button type="button" class="btn" data-rhe-asiento-csv ${entry.lines.length ? '' : 'disabled'}>${ICONS.arrowRight} Descargar CSV</button>
          </div>
        </div>
        <div class="card__body">
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">Mes de pago</label>
              <input type="month" class="form-input" data-rhe-asiento-period value="${escapeHtml(periodToInput(state.rhePeriod))}" />
            </div>
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">Cuenta retenciones</label>
              <input class="form-input" data-rhe-cuenta-retencion value="${escapeHtml(state.rheConfig.cuenta_retencion)}" />
            </div>
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">Cuenta pago</label>
              <input class="form-input" data-rhe-cuenta-pago value="${escapeHtml(state.rheConfig.cuenta_pago)}" />
            </div>
            <button type="button" class="btn" data-rhe-save-config>${ICONS.check} Guardar cuentas</button>
          </div>
          ${entry.warnings.length ? `<div class="card" style="border-color:var(--color-gold);margin-bottom:var(--space-4);"><div class="card__body" style="font-size:var(--font-size-sm);">${entry.warnings.map((w) => `<div>${ICONS.info} ${escapeHtml(w)}</div>`).join('')}</div></div>` : ''}
          <div class="table-wrap">
            <table class="table" style="min-width:720px;">
              <thead><tr><th>Cuenta</th><th>Denominación</th><th style="text-align:right;">Debe</th><th style="text-align:right;">Haber</th></tr></thead>
              <tbody>${entry.lines.length ? entry.lines.map((line) => `<tr>
                <td><strong>${escapeHtml(line.cuenta)}</strong></td>
                <td>${escapeHtml(line.nombre || '—')}</td>
                <td class="cell-num">${line.debe ? num(line.debe) : '—'}</td>
                <td class="cell-num">${line.haber ? num(line.haber) : '—'}</td>
              </tr>`).join('') : `<tr><td colspan="4"><div class="empty-state"><div class="empty-state__title">Sin líneas para ${escapeHtml(periodLabel(state.rhePeriod))}</div><div class="empty-state__desc">Importa los recibos RHE y marca como pagados los que correspondan a este mes de pago.</div></div></td></tr>`}</tbody>
              <tfoot><tr><th colspan="2">TOTALES</th><th class="cell-num">${num(entry.totalDebe)}</th><th class="cell-num">${num(entry.totalHaber)}</th></tr></tfoot>
            </table>
          </div>
        </div>
      </div>`;
  }

  function renderContent() {
    if (loading) {
      content.innerHTML = `<div class="card"><div class="card__body text-muted">Cargando recibos de honorarios…</div></div>`;
      return;
    }
    if (error) {
      content.innerHTML = `<div class="card" style="border-color:var(--color-danger);"><div class="card__body">
        <strong>No se pudo cargar el módulo.</strong><p class="text-muted" style="margin-top:var(--space-2);">${escapeHtml(error)}</p>
        <button type="button" class="btn" data-retry>Reintentar</button>
      </div></div>`;
      return;
    }
    content.innerHTML = state.tab === 'asiento' ? renderAsiento() : renderRecibos();
  }

  function setTab(tab) {
    state.tab = tab;
    viewRoot.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    });
    renderContent();
  }

  async function readFileBytes(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`No se pudo leer "${file.name}".`));
      reader.readAsArrayBuffer(file);
    });
  }

  async function loadRheMeta() {
    try {
      state.rheAccounts = await honorariosService.accounts();
    } catch (err) {
      state.rheStatus = `No se pudo cargar la lista de conceptos: ${err.message || err}`;
    }
    try {
      state.rheConfig = await honorariosService.config();
    } catch (err) {
      state.rheStatus = `No se pudo cargar la configuración del asiento: ${err.message || err}`;
    }
    const { year, month } = rheYearMonth();
    state.rheSummary = honorariosService.summary(year, month);
  }

  async function refreshRhePeriod() {
    state.rheStatus = 'Actualizando recibos del mes…';
    renderContent();
    try {
      await honorariosService.refresh();
      await loadRheMeta();
      state.rheStatus = '';
    } catch (err) {
      state.rheStatus = err.message || String(err);
    }
    renderContent();
  }

  async function handleRheFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    state.tab = 'recibos';
    state.rheBusy = true;
    state.rheStatus = `Leyendo ${files.length} archivo(s)…`;
    renderContent();
    const records = [];
    const warnings = [];
    const fileNames = [];
    const seen = new Set();
    let duplicates = 0;
    try {
      for (const file of files) {
        if (!/\.(txt|csv)$/i.test(file.name)) {
          warnings.push(`${file.name}: formato no soportado. Sube un TXT o CSV de SUNAT.`);
          continue;
        }
        fileNames.push(file.name);
        const parsed = parseHonorariosTxt(await readFileBytes(file), file.name);
        (parsed.warnings || []).forEach((w) => warnings.push(w));
        for (const rec of parsed.records) {
          if (seen.has(rec.dedupe_key)) { duplicates += 1; continue; }
          seen.add(rec.dedupe_key);
          records.push(rec);
        }
      }
      state.rheParsed = { records, warnings: [...new Set(warnings)], fileNames, duplicates };
      state.rheStatus = '';
    } catch (err) {
      state.rheParsed = null;
      state.rheStatus = err.message || String(err);
      showToast(state.rheStatus, 'error');
    } finally {
      state.rheBusy = false;
      renderContent();
    }
  }

  async function doRheImport() {
    if (state.rheBusy || !state.rheParsed?.records?.length) return;
    state.rheBusy = true;
    renderContent();
    try {
      const res = await honorariosService.importParsed(state.rheParsed.records, state.rheParsed.fileNames.join(', '));
      await honorariosService.refresh();
      await loadRheMeta();
      const extra = res.warnings.length ? ` ${res.warnings[0]}` : '';
      showToast(`Importación RHE: ${res.imported} nuevo(s), ${res.skipped} omitido(s).${extra}`, res.warnings.length ? 'info' : 'success');
      state.rheParsed = null;
      state.rheStatus = '';
    } catch (err) {
      showToast(err.message || String(err), 'error');
    } finally {
      state.rheBusy = false;
      renderContent();
    }
  }

  async function updateRheCuenta(id, cuenta) {
    try {
      await honorariosService.updateCuenta(id, cuenta);
      const { year, month } = rheYearMonth();
      state.rheSummary = honorariosService.summary(year, month);
      renderContent();
    } catch (err) {
      showToast(err.message || String(err), 'error');
    }
  }

  async function saveRheManual() {
    const form = state.rheForm;
    if (!form.fecha_emision || !String(form.doc_numero || '').trim() || !String(form.emisor_nombre || '').trim()) {
      showToast('Completa fecha de emisión, número de documento y emisor.', 'error');
      return;
    }
    state.rheBusy = true;
    renderContent();
    try {
      const res = await honorariosService.createManual(form);
      await honorariosService.refresh();
      await loadRheMeta();
      if (res.record?.fecha_pago) state.rhePeriod = inputToPeriod(res.record.fecha_pago.slice(0, 7)) || state.rhePeriod;
      state.rheFormOpen = false;
      state.rheForm = blankRheForm();
      const extra = res.warnings?.length ? ` ${res.warnings[0]}` : '';
      showToast(`Recibo manual guardado${res.record?.pagado ? ' como pagado' : ' pendiente de pago'}.${extra}`, res.warnings?.length ? 'info' : 'success');
    } catch (err) {
      showToast(err.message || String(err), 'error');
    } finally {
      state.rheBusy = false;
      renderContent();
    }
  }

  async function updateRheRow(id, patch) {
    try {
      await honorariosService.update(id, patch);
      await loadRheMeta();
      renderContent();
    } catch (err) {
      showToast(err.message || String(err), 'error');
      renderContent();
    }
  }

  async function deleteRheRow(id) {
    if (!window.confirm('¿Eliminar este recibo de forma individual?')) return;
    try {
      await honorariosService.remove(id);
      await loadRheMeta();
      showToast('Recibo eliminado.');
      renderContent();
    } catch (err) {
      showToast(err.message || String(err), 'error');
    }
  }

  async function clearRheFile() {
    const sourceFile = state.rheSourceFile;
    if (!sourceFile) return;
    if (!window.confirm(`¿Eliminar TODOS los recibos de "${sourceFile}"? Esta acción no se puede deshacer.`)) return;
    try {
      const removed = await honorariosService.removeByFile(sourceFile);
      await loadRheMeta();
      showToast(`Se eliminaron ${removed} recibo(s) de ${sourceFile}.`);
      renderContent();
    } catch (err) {
      showToast(err.message || String(err), 'error');
    }
  }

  async function saveRheConfig() {
    const inputRet = content.querySelector('[data-rhe-cuenta-retencion]');
    const inputPago = content.querySelector('[data-rhe-cuenta-pago]');
    try {
      state.rheConfig = await honorariosService.saveConfig({
        cuenta_retencion: inputRet?.value || '40173',
        cuenta_pago: inputPago?.value || '4111',
      });
      showToast('Cuentas del asiento guardadas.');
      renderContent();
    } catch (err) {
      showToast(err.message || String(err), 'error');
    }
  }

  async function downloadRhePdt() {
    const rows = rheMonthRows(true);
    if (!rows.length) { showToast('No hay recibos en el mes seleccionado para el PDT 601.', 'error'); return; }
    const button = content.querySelector('[data-rhe-pdt]');
    if (button) button.disabled = true;
    try {
      const { year, month } = rheYearMonth();
      const res = await downloadPdtZip(company, rows, year, month);
      showToast(`PDT de ${periodLabel(state.rhePeriod)}: ${res.count} recibos pagados.${rheExcludedText(res.excluded)} Descargados ${res.ps4Name} y ${res.fourtaName}.`);
    } catch (err) {
      showToast(err.message || String(err), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function downloadRhePdtSingle(ext) {
    const rows = rheMonthRows(true);
    if (!rows.length) { showToast('No hay recibos en el mes seleccionado para el PDT 601.', 'error'); return; }
    try {
      const { year, month } = rheYearMonth();
      const res = downloadPdtSingle(company, rows, year, month, ext);
      const tipo = ext === 'ps4' ? 'Proveedores' : 'Comprobantes';
      showToast(`${tipo} de ${periodLabel(state.rhePeriod)}: ${res.count} recibos pagados.${rheExcludedText(res.excluded)} Descargado ${res.fileName}.`);
    } catch (err) {
      showToast(err.message || String(err), 'error');
    }
  }

  function downloadRheAsientoCsv() {
    const { year, month } = rheYearMonth();
    const rows = rheMonthRows(false);
    const entry = buildAsiento(rows, state.rheConfig, state.rheAccounts, year, month);
    if (!entry.lines.length) { showToast('No hay líneas para exportar en el mes de pago seleccionado.', 'error'); return; }
    try {
      const res = downloadAsiento(entry, company, year, month);
      showToast(`Asiento de ${periodLabel(state.rhePeriod)}: ${res.count} recibos pagados.${rheExcludedText(res.excluded)} Descargado ${res.fileName}.`);
    } catch (err) {
      showToast(err.message || String(err), 'error');
    }
  }

  viewRoot.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }
    if (e.target.closest('[data-retry]')) { loading = true; renderContent(); load(); return; }
    if (e.target.closest('[data-rhe-drop]')) { content.querySelector('[data-rhe-files]')?.click(); return; }
    if (e.target.closest('[data-rhe-do-import]')) { doRheImport(); return; }
    if (e.target.closest('[data-rhe-reset]')) { state.rheParsed = null; state.rheStatus = ''; renderContent(); return; }
    if (e.target.closest('[data-rhe-form-open]')) { state.rheFormOpen = true; renderContent(); return; }
    if (e.target.closest('[data-rhe-form-cancel]')) { state.rheFormOpen = false; state.rheForm = blankRheForm(); renderContent(); return; }
    if (e.target.closest('[data-rhe-form-save]')) { saveRheManual(); return; }
    if (e.target.closest('[data-rhe-clear-file]')) { clearRheFile(); return; }
    const deleteBtn = e.target.closest('[data-rhe-delete]');
    if (deleteBtn) { deleteRheRow(deleteBtn.dataset.rheDelete); return; }
    const single = e.target.closest('[data-rhe-pdt-single]');
    if (single) { downloadRhePdtSingle(single.dataset.rhePdtSingle); return; }
    if (e.target.closest('[data-rhe-pdt]')) { downloadRhePdt(); return; }
    if (e.target.closest('[data-rhe-save-config]')) { saveRheConfig(); return; }
    if (e.target.closest('[data-rhe-asiento-csv]')) { downloadRheAsientoCsv(); return; }
  });

  viewRoot.addEventListener('change', (e) => {
    if (e.target.matches('[data-rhe-files]')) {
      const input = e.target;
      const selected = Array.from(input.files || []);
      input.value = '';
      handleRheFiles(selected);
      return;
    }
    if (e.target.matches('[data-rhe-period]') || e.target.matches('[data-rhe-asiento-period]')) {
      state.rhePeriod = inputToPeriod(e.target.value) || CURRENT_PERIOD;
      refreshRhePeriod();
      return;
    }
    if (e.target.matches('[data-rhe-date-field]')) {
      state.rheDateField = e.target.value === 'emision' ? 'emision' : 'pago';
      renderContent();
      return;
    }
    if (e.target.matches('[data-rhe-source-file]')) {
      state.rheSourceFile = e.target.value;
      renderContent();
      return;
    }
    if (e.target.matches('[data-rhe-pagado]')) {
      const id = e.target.dataset.rhePago;
      const checked = e.target.checked;
      const row = honorariosService.all().find((r) => r.id === id);
      updateRheRow(id, {
        pagado: checked,
        fecha_pago: checked ? (row?.fecha_pago || row?.fecha_emision || null) : null,
      });
      return;
    }
    if (e.target.matches('[data-rhe-pago-fecha]')) {
      const value = e.target.value;
      updateRheRow(e.target.dataset.rhePagoFecha, { fecha_pago: value || null, pagado: !!value });
      return;
    }
    if (e.target.matches('[data-rhe-form]')) {
      const key = e.target.dataset.rheForm;
      if (key === 'pagado') {
        state.rheForm.pagado = e.target.checked;
        if (!e.target.checked) state.rheForm.fecha_pago = '';
        renderContent();
        return;
      }
      state.rheForm[key] = e.target.value;
      if (key === 'fecha_pago' && e.target.value && !state.rheForm.pagado) {
        state.rheForm.pagado = true;
        renderContent();
      }
      return;
    }
    if (e.target.matches('[data-rhe-cuenta]')) {
      updateRheCuenta(e.target.dataset.rheCuenta, e.target.value);
      return;
    }
  });

  viewRoot.addEventListener('input', (e) => {
    if (e.target.matches('[data-rhe-form]') && e.target.type !== 'checkbox') {
      state.rheForm[e.target.dataset.rheForm] = e.target.value;
      return;
    }
    if (e.target.matches('[data-rhe-search]')) {
      const caret = e.target.selectionStart;
      state.rheSearch = e.target.value;
      renderContent();
      const again = content.querySelector('[data-rhe-search]');
      if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch {} }
    }
  });

  viewRoot.addEventListener('dragover', (e) => {
    const drop = e.target.closest('[data-rhe-drop]');
    if (drop) { e.preventDefault(); drop.style.borderColor = 'var(--color-gold)'; }
  });
  viewRoot.addEventListener('dragleave', (e) => {
    const drop = e.target.closest('[data-rhe-drop]');
    if (drop) drop.style.borderColor = '';
  });
  viewRoot.addEventListener('drop', (e) => {
    const drop = e.target.closest('[data-rhe-drop]');
    if (!drop) return;
    e.preventDefault();
    drop.style.borderColor = '';
    handleRheFiles(e.dataTransfer?.files);
  });

  async function load() {
    loading = true;
    error = '';
    renderContent();
    try {
      await honorariosService.refresh();
      await loadRheMeta();
      updateModeBadge();
      loading = false;
    } catch (err) {
      loading = false;
      error = err.message || String(err);
    }
    renderContent();
  }

  load();
}

export default { title: 'Recibos de Honorarios', render };
