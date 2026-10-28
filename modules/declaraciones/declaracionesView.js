/* ============================================================================
   declaracionesView.js — Declaraciones SUNAT · Liquidación IGV / Renta (621)
   ----------------------------------------------------------------------------
   Dos vistas:
     1. Matriz anual de liquidación (Enero → Diciembre) con totales.
     2. Ficha mensual Formulario Virtual 621 (casillas SUNAT) en modal.
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

/* Filas de la matriz anual. `get` recibe el resultado de un mes. */
const MATRIX_ROWS = [
  { section: 'IGV · Ventas' },
  { key: 'base18V', label: 'Base gravada ventas 18%', get: (m) => m.base18V },
  { key: 'igv18V', label: 'IGV ventas 18%', get: (m) => m.igv18V },
  { key: 'base10V', label: 'Base gravada ventas 10%', get: (m) => m.base10V },
  { key: 'igv10V', label: 'IGV ventas 10%', get: (m) => m.igv10V },
  { section: 'IGV · Compras' },
  { key: 'base18C', label: 'Base gravada compras 18%', get: (m) => m.base18C },
  { key: 'igv18C', label: 'IGV compras 18%', get: (m) => m.igv18C },
  { key: 'base10C', label: 'Base gravada compras 10%', get: (m) => m.base10C },
  { key: 'igv10C', label: 'IGV compras 10%', get: (m) => m.igv10C },
  { section: 'Determinación' },
  { key: 'igvVentas', label: 'Débito fiscal (IGV ventas)', get: (m) => m.igvVentas, strong: true },
  { key: 'igvCompras', label: 'Crédito fiscal (IGV compras)', get: (m) => m.igvCompras, strong: true },
  { key: 'preliminar', label: 'Impuesto preliminar', get: (m) => m.preliminar },
  { key: 'saldoIgvAnterior', label: 'Saldo a favor periodo anterior', get: (m) => m.saldoIgvAnterior, total: 'last' },
  { section: 'Compensaciones' },
  { key: 'percepAplic', label: 'Percepciones aplicadas', get: (m) => m.percepAplic },
  { key: 'retenAplic', label: 'Retenciones aplicadas', get: (m) => m.retenAplic },
  { section: 'Resultado IGV' },
  { key: 'igvPorPagar', label: 'IGV a pagar', get: (m) => m.igvPorPagar, strong: true, hl: true },
  { key: 'saldoFavorPeriodo', label: 'Saldo a favor IGV', get: (m) => m.saldoFavorPeriodo, hl: true },
  { section: 'Renta (RMT)' },
  { key: 'ventasNetasMes', label: 'Ingresos netos del mes', get: (m) => m.ventasNetasMes },
  { key: 'ventasAcumuladas', label: 'Ingresos netos acumulados', get: (m) => m.ventasAcumuladas, total: 'last' },
  { key: 'rentaPagar', label: 'Renta a pagar', get: (m) => m.rentaPagar, strong: true },
  { section: 'Total' },
  { key: 'totalAPagar', label: 'Total a pagar (IGV + Renta)', get: (m) => m.totalAPagar, strong: true, hl: true },
];

/* Casillas del Formulario Virtual 621. */
const FICHA = [
  { section: 'IGV · Ventas' },
  { casilla: '100', label: 'Base imponible — Ventas gravadas (18%)', value: (m) => m.base18V },
  { casilla: '101', label: 'IGV — Ventas gravadas (18%)', value: (m) => m.igv18V },
  { casilla: '172', label: 'Base imponible — Ventas gravadas (10%)', value: (m) => m.base10V, hideZero: true },
  { casilla: '173', label: 'IGV — Ventas gravadas (10%)', value: (m) => m.igv10V, hideZero: true },
  { section: 'IGV · Compras' },
  { casilla: '107', label: 'Base imponible — Compras gravadas (18%)', value: (m) => m.base18C },
  { casilla: '108', label: 'IGV — Compras gravadas (18%)', value: (m) => m.igv18C },
  { casilla: '174', label: 'Base imponible — Compras gravadas (10%)', value: (m) => m.base10C, hideZero: true },
  { casilla: '175', label: 'IGV — Compras gravadas (10%)', value: (m) => m.igv10C, hideZero: true },
  { section: 'Determinación del IGV' },
  { casilla: '140', label: 'IGV — Débito fiscal (ventas)', value: (m) => m.igvVentas, strong: true },
  { casilla: '145', label: 'IGV — Crédito fiscal (compras)', value: (m) => m.igvCompras, strong: true },
  { casilla: '184', label: 'Impuesto resultante / saldo a favor (preliminar)', value: (m) => m.preliminar },
  { casilla: '178', label: 'Saldo a favor del periodo anterior (IGV)', value: (m) => m.saldoIgvAnterior },
  { casilla: '185', label: 'Saldo a favor del periodo (IGV)', value: (m) => m.saldoFavorPeriodo, hideZero: true },
  { section: 'Percepciones del IGV' },
  { casilla: '171', label: 'Percepciones del periodo', value: (m) => m.percepcionesMes },
  { casilla: '168', label: 'Percepciones no aplicadas de periodos anteriores', value: (m) => m.percepcionesAnterior, hideZero: true },
  { casilla: '164', label: 'Saldo de percepciones no aplicadas (resultante)', value: (m) => m.percepcionesNoAplicadas, hideZero: true },
  { section: 'Retenciones del IGV' },
  { casilla: '179', label: 'Retenciones del periodo', value: (m) => m.retencionesMes },
  { casilla: '176', label: 'Retenciones no aplicadas de periodos anteriores', value: (m) => m.retencionesAnterior, hideZero: true },
  { casilla: '165', label: 'Saldo de retenciones no aplicadas (resultante)', value: (m) => m.retencionesNoAplicadas, hideZero: true },
  { section: 'Resultado IGV' },
  { casilla: '188', label: 'IGV a pagar', value: (m) => m.igvPorPagar, strong: true, hl: true },
  { section: 'Renta mensual (RMT)' },
  { casilla: '301', label: 'Ingresos netos del mes', value: (m) => m.ventasNetasMes },
  { casilla: '315', label: 'Ingresos netos acumulados', value: (m) => m.ventasAcumuladas },
  { casilla: '312', label: 'Renta a pagar (pago a cuenta)', value: (m) => m.rentaPagar, strong: true },
  { section: 'Total' },
  { casilla: '681', label: 'Total a pagar (IGV + Renta)', value: (m) => m.totalAPagar, strong: true, hl: true },
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
    data: null, // cache del servicio
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

  function matrixHtml() {
    const months = state.data.timeline.months;

    const head = `
      <thead>
        <tr>
          <th class="sticky-col">Concepto</th>
          ${MONTHS.map((name, i) => `
            <th class="cell-num month-click" data-month="${i + 1}" title="Ver Ficha 621 de ${escapeHtml(name)}">
              ${escapeHtml(name)}<div class="text-muted" style="font-size:var(--font-size-xs);">Ficha 621</div>
            </th>`).join('')}
          <th class="cell-num total-col">Total</th>
        </tr>
      </thead>`;

    const bodyRows = MATRIX_ROWS.map((row) => {
      if (row.section) {
        return `<tr class="section-row"><td class="sticky-col" colspan="${months.length + 2}">${escapeHtml(row.section)}</td></tr>`;
      }
      const cells = months.map((m) => `<td class="cell-num${row.strong ? ' cell-strong' : ''}">${fmt(row.get(m))}</td>`).join('');
      const totalVal = annualTotalsForRow(row);
      return `<tr class="${row.hl ? 'row-hl' : ''}">
        <td class="sticky-col${row.strong ? ' cell-strong' : ''}">${escapeHtml(row.label)}</td>
        ${cells}
        <td class="cell-num total-col${row.strong ? ' cell-strong' : ''}">${fmt(totalVal)}</td>
      </tr>`;
    }).join('');

    return `<div class="table-wrap">
      <table class="table decl-matrix">
        ${head}
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }

  // Valor de la columna "Total" por fila: suma, o el último mes para las
  // filas acumulativas (saldo a favor anterior, ingresos acumulados).
  function annualTotalsForRow(row) {
    const months = state.data.timeline.months;
    if (row.total === 'last') {
      const last = months[months.length - 1];
      return Number(last ? row.get(last) : 0) || 0;
    }
    return months.reduce((acc, m) => acc + (Number(row.get(m)) || 0), 0);
  }

  function statsHtml() {
    const t = state.data.totals;
    const months = state.data.timeline.months;
    const last = months[months.length - 1] || {};
    return `
      <div class="stats">
        <div class="stat-card"><span class="stat-card__icon">${ICONS.briefcase}</span><div><div class="stat-card__value">${fmt(t.igvVentas)}</div><div class="stat-card__label">IGV ventas (débito) ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.building}</span><div><div class="stat-card__value">${fmt(t.igvCompras)}</div><div class="stat-card__label">IGV compras (crédito) ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.arrowRight}</span><div><div class="stat-card__value">${fmt(t.igvPorPagar)}</div><div class="stat-card__label">IGV a pagar ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.check}</span><div><div class="stat-card__value">${fmt(t.rentaPagar)}</div><div class="stat-card__label">Renta a pagar ${state.year}</div></div></div>
        <div class="stat-card"><span class="stat-card__icon">${ICONS.info}</span><div><div class="stat-card__value">${fmt(t.totalAPagar)}</div><div class="stat-card__label">Total a pagar ${state.year}</div></div></div>
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
            UIT ${state.data ? fmt(state.data.balances.uit) : '—'} · Tasa renta: 1.00% hasta 300 UIT, 1.50% por encima
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

  function openFicha(mes) {
    const m = state.data.timeline.months.find((x) => x.mes === mes);
    if (!m) return;
    const monthName = MONTHS[mes - 1];
    const rows = FICHA.filter((r) => r.section || !r.hideZero || Number(r.value(m) || 0) !== 0)
      .map((r) => {
        if (r.section) return `<tr class="section-row"><td colspan="3">${escapeHtml(r.section)}</td></tr>`;
        return `<tr class="${r.hl ? 'row-hl' : ''}">
          <td class="cell-num casilla">${r.casilla}</td>
          <td>${escapeHtml(r.label)}</td>
          <td class="cell-num${r.strong ? ' cell-strong' : ''}">${fmt(r.value(m))}</td>
        </tr>`;
      }).join('');

    const body = `
      <div class="text-muted" style="font-size:var(--font-size-sm);margin-bottom:var(--space-3);">
        ${escapeHtml(monthName)} ${m.anio} · Estado: <strong>${m.estado === 'cerrado' ? 'Cerrado' : 'Calculado'}</strong> · Tasa renta ${pct(m.tasaRenta)} · UIT ${fmt(m.uit)}
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
      const patch = {
        saldo_igv_anterior: Number(fd.get('saldo_igv_anterior') || 0),
        percepciones_ant: Number(fd.get('percepciones_ant') || 0),
        retenciones_ant: Number(fd.get('retenciones_ant') || 0),
        uit: Number(fd.get('uit') || 0),
        coeficiente_renta: Number(fd.get('coeficiente_renta') || 0),
        is_manual_initial_balance: fd.get('is_manual_initial_balance') === 'on',
      };
      try {
        await declaracionesService.saveBalances(state.year, patch);
        showToast('Saldos iniciales guardados.');
        close();
      } catch (err) {
        showToast(err.message || String(err), 'error');
      }
    });
  }

  function openAjustes(mes) {
    const m = state.data.timeline.months.find((x) => x.mes === mes);
    if (!m) return;
    const body = `
      <form data-ajustes-form>
        <div class="form-group"><label class="form-label">Pagos previos</label>
          <input class="form-input" type="number" step="0.01" name="pagos_previos" value="${Number(m.pagosPrevios || 0).toFixed(2)}"></div>
        <div class="form-group"><label class="form-label">Intereses</label>
          <input class="form-input" type="number" step="0.01" name="intereses" value="${Number(m.intereses || 0).toFixed(2)}"></div>
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
