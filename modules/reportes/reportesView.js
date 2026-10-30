/* ============================================================================
   reportesView.js — Reportes Gerenciales consolidados
   ----------------------------------------------------------------------------
   Tres pestañas:
     1. Dashboard           Evolución de ventas, compras, planilla, trabajadores,
                            retenciones y percepciones de todas las empresas.
     2. Comparativo         PDT 621 resumido, empresa por empresa y por período.
     3. Simulación          Facturación intercompany para trasladar crédito fiscal
                            de una empresa a otra del mismo grupo.
   ========================================================================== */

import { MONTHS } from '../compras/comprasConfig.js';
import { round2 } from '../declaraciones/declaracionesEngine.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';
import { reportesService } from './reportesService.js';
import {
  companyPosition, sumPositions, simulateInvoice,
} from './reportesEngine.js';
import {
  CHART_COLORS, groupedBarChart, stackedBarChart, payrollComboChart,
} from './reportesCharts.js';

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;
const YEARS = [CURRENT_YEAR - 4, CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const COMPANY_COLORS = ['#c5a059', '#4e342e', '#3b6e9e', '#2f7d4f', '#a07a1f', '#b3352e', '#7a5b3a', '#5b7f95'];

const fmt = (v) => Number(v || 0).toLocaleString('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const money = (v) => {
  const n = Number(v || 0);
  return n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
};
const num = (v) => Number(v || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 });
const pct = (v) => `${(Number(v || 0) * 100).toFixed(2)}%`;
const dateShort = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

function companyColor(index) {
  return COMPANY_COLORS[index % COMPANY_COLORS.length];
}

function pickMonth(report) {
  if (!report?.companies?.length) return CURRENT_YEAR === report?.year ? NOW.getMonth() + 1 : 12;
  const last = report.companies.reduce((max, c) => Math.max(max, Number(c.lastDataMonth || 0)), 0);
  if (last) return last;
  return report.year === CURRENT_YEAR ? NOW.getMonth() + 1 : 12;
}

function optionsHtml(list, selected) {
  return list.map((item) => {
    const value = typeof item === 'string' ? item : item.value;
    const label = typeof item === 'string' ? item : item.label;
    return `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function positionChip(p) {
  if (Number(p.igvPorPagar || 0) > 0.009) {
    return `<span class="mgmt-chip mgmt-chip--payable">IGV por pagar</span>`;
  }
  if (Number(p.creditAvailable || 0) > 0.009) {
    return `<span class="mgmt-chip mgmt-chip--credit">Saldo a favor</span>`;
  }
  return `<span class="mgmt-chip mgmt-chip--neutral">Equilibrado</span>`;
}

function positionText(p) {
  if (Number(p.igvPorPagar || 0) > 0.009) return `S/ ${money(p.igvPorPagar)} por pagar`;
  if (Number(p.creditAvailable || 0) > 0.009) return `S/ ${money(p.creditAvailable)} a favor`;
  return 'Sin IGV pendiente';
}

function sumAnnual(companies) {
  const out = {
    ventasBase: 0, comprasBase: 0, igvVentas: 0, igvCompras: 0, igvNeto: 0,
    retenciones: 0, percepciones: 0, payrollCost: 0, payrollGross: 0,
    renta: 0, igvPorPagar: 0, total: 0,
  };
  companies.forEach((c) => {
    const t = c.totals || {};
    out.ventasBase += Number(t.ventasBase || 0);
    out.comprasBase += Number(t.comprasBase || 0);
    out.igvVentas += Number(t.igvVentas || 0);
    out.igvCompras += Number(t.igvCompras || 0);
    out.igvNeto += Number(t.igvNeto || 0);
    out.retenciones += Number(t.retenciones || 0);
    out.percepciones += Number(t.percepciones || 0);
    out.payrollCost += Number(t.payrollCost || 0);
    out.payrollGross += Number(t.payrollGross || 0);
    out.renta += Number(t.rentaPagar || 0);
    out.igvPorPagar += Number(t.igvPorPagar || 0);
    out.total += Number(t.totalAPagar || 0);
  });
  Object.keys(out).forEach((k) => { out[k] = round2(out[k]); });
  return out;
}

function monthlySeries(companies) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const row = {
      mes: month,
      ventasBase: 0, comprasBase: 0, igvVentas: 0, igvCompras: 0,
      retenciones: 0, percepciones: 0, payrollCost: 0, headcount: 0,
    };
    companies.forEach((c) => {
      const m = c.months?.[i];
      if (!m) return;
      row.ventasBase += Number(m.ventasSummary?.baseGravada || 0);
      row.comprasBase += Number(m.comprasSummary?.baseGravada || 0);
      row.igvVentas += Number(m.igvVentas || 0);
      row.igvCompras += Number(m.igvCompras || 0);
      row.retenciones += Number(m.retencionesMes || 0);
      row.percepciones += Number(m.percepcionesMes || 0);
      row.payrollCost += Number(m.payroll?.cost || 0);
      row.headcount += Number(m.payroll?.headcount || 0);
    });
    Object.keys(row).forEach((k) => { if (k !== 'mes') row[k] = round2(row[k]); });
    return row;
  });
}

function legendHtml(series) {
  return `<div class="mgmt-legend">${series.map((s) => `
    <span class="mgmt-legend__item"><span class="mgmt-legend__dot" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`).join('')}</div>`;
}

function chartCard({ title, subtitle, chart, series, className = '' }) {
  return `<section class="card mgmt-chart-card ${className}">
    <div class="mgmt-chart-card__head">
      <div>
        <h3 class="mgmt-chart-card__title">${escapeHtml(title)}</h3>
        <p class="mgmt-chart-card__subtitle">${escapeHtml(subtitle)}</p>
      </div>
    </div>
    <div class="mgmt-chart">${chart}</div>
    ${series?.length ? legendHtml(series) : ''}
  </section>`;
}

function kpiCard({ label, value, hint, icon = ICONS.info, tone = 'gold' }) {
  return `<article class="mgmt-kpi mgmt-kpi--${tone}">
    <div class="mgmt-kpi__top">
      <span class="mgmt-kpi__label">${escapeHtml(label)}</span>
      <span class="mgmt-kpi__icon">${icon}</span>
    </div>
    <div class="mgmt-kpi__value">${value}</div>
    <div class="mgmt-kpi__hint">${escapeHtml(hint)}</div>
  </article>`;
}

function warningsHtml(report) {
  if (!report?.warnings?.length) return '';
  return `<div class="mgmt-alert" data-no-print>
    <strong>Algunos módulos no están completos</strong>
    <ul>${report.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
  </div>`;
}

export function render(root) {
  const state = {
    year: CURRENT_YEAR,
    month: NOW.getMonth() + 1,
    tab: 'dashboard',
    companyId: 'all',
    compareMode: 'month',
    report: null,
    busy: true,
    error: '',
    sim: { sellerId: '', buyerId: '', base: null, rate: 0.18 },
  };

  root.innerHTML = `
    <div data-mgmt-root>
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Reportes Gerenciales</h2>
          <p class="page-heading__subtitle" data-mgmt-subtitle>Consolidado de las empresas a las que tienes acceso.</p>
        </div>
        <div class="mgmt-heading-actions" data-no-print>
          <button type="button" class="btn" data-refresh>${ICONS.clock} Actualizar</button>
          <button type="button" class="btn btn--primary" data-print>${ICONS.arrowRight} Exportar PDF</button>
        </div>
      </div>
      <div class="tabs-bar" data-tabs>
        <button type="button" class="tab-btn is-active" data-tab="dashboard">Dashboard</button>
        <button type="button" class="tab-btn" data-tab="comparativo">Comparativo tributario</button>
        <button type="button" class="tab-btn" data-tab="simulacion">Simulación intercompany</button>
      </div>
      <div data-content></div>
    </div>`;

  const viewRoot = root.querySelector('[data-mgmt-root]');
  const content = viewRoot.querySelector('[data-content]');
  const tabsEl = viewRoot.querySelector('[data-tabs]');
  const subtitle = viewRoot.querySelector('[data-mgmt-subtitle]');

  function setTab(tab) {
    state.tab = tab;
    [...tabsEl.querySelectorAll('[data-tab]')].forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    });
    renderContent();
  }

  function companies() {
    const list = state.report?.companies || [];
    if (state.companyId === 'all') return list;
    return list.filter((c) => c.id === state.companyId);
  }

  function companyById(id) {
    return (state.report?.companies || []).find((c) => c.id === id) || null;
  }

  function scopeLabel() {
    if (!state.report) return '';
    if (state.companyId === 'all') return `Todas las empresas (${state.report.companies.length})`;
    return companyById(state.companyId)?.name || 'Empresa';
  }

  function updateSubtitle() {
    if (!state.report) return;
    subtitle.textContent = `${scopeLabel()} · Ejercicio ${state.year} · Consolidado generado ${dateShort(state.report.generatedAt)}`;
  }

  function ensureSimSelection() {
    const list = state.report?.companies || [];
    if (!list.length) return;
    const idExists = (id) => list.some((c) => c.id === id);
    if (!idExists(state.sim.sellerId)) {
      const withCredit = list.find((c) => companyPosition(c, state.month, 'month').creditAvailable > 0.009);
      state.sim.sellerId = (withCredit || list[0]).id;
    }
    if (!idExists(state.sim.buyerId) || state.sim.buyerId === state.sim.sellerId) {
      const withPayable = list.find((c) => c.id !== state.sim.sellerId
        && companyPosition(c, state.month, 'month').igvPorPagar > 0.009);
      state.sim.buyerId = (withPayable || list.find((c) => c.id !== state.sim.sellerId) || list[0]).id;
    }
  }

  async function load({ resetMonth = false } = {}) {
    state.busy = true;
    state.error = '';
    renderContent();
    try {
      const report = await reportesService.load(state.year);
      state.report = report;
      if (resetMonth || !state.month) state.month = pickMonth(report);
      state.month = Math.max(1, Math.min(12, Number(state.month) || 1));
      if (state.companyId !== 'all' && !companyById(state.companyId)) state.companyId = 'all';
      ensureSimSelection();
      updateSubtitle();
    } catch (err) {
      state.error = err.message || String(err);
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  /* ------------------------------- Toolbar ------------------------------- */

  function toolbarHtml() {
    if (!state.report) return '';
    const list = state.report.companies;
    return `<div class="card mgmt-toolbar" data-no-print>
      <div class="mgmt-toolbar__filters">
        <div class="form-group mgmt-field">
          <label class="form-label">Ejercicio</label>
          <select class="form-input" data-year>${optionsHtml(YEARS.map(String), String(state.year))}</select>
        </div>
        <div class="form-group mgmt-field">
          <label class="form-label">Mes de análisis</label>
          <select class="form-input" data-month>${MONTHS.map((m, i) => `<option value="${i + 1}"${i + 1 === state.month ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select>
        </div>
        <div class="form-group mgmt-field mgmt-field--wide">
          <label class="form-label">Empresas</label>
          <select class="form-input" data-company>
            <option value="all"${state.companyId === 'all' ? ' selected' : ''}>Todas las empresas (${list.length})</option>
            ${list.map((c) => `<option value="${escapeHtml(c.id)}"${state.companyId === c.id ? ' selected' : ''}>${escapeHtml(c.name)} · ${escapeHtml(c.ruc)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="mgmt-toolbar__meta">
        <span class="mgmt-toolbar__dot"></span>
        <span>${escapeHtml(scopeLabel())}</span>
        <span class="mgmt-toolbar__sep">·</span>
        <span>${state.report.companies.length ? `${state.report.companies.length} empresa(s) en alcance` : 'Sin empresas'}</span>
      </div>
    </div>`;
  }

  /* ------------------------------ Dashboard ------------------------------ */

  function dashboardHtml() {
    const list = companies();
    const annual = sumAnnual(list);
    const monthly = monthlySeries(list);
    const positions = list.map((c, i) => ({
      company: c,
      color: companyColor(i),
      month: companyPosition(c, state.month, 'month'),
      ytd: companyPosition(c, state.month, 'ytd'),
    }));
    const groupYtd = sumPositions(positions.map((p) => p.ytd));
    const groupMonth = sumPositions(positions.map((p) => p.month));
    const headcount = positions.reduce((s, p) => s + Number(p.month.payroll?.headcount || 0), 0);
    const labelMonth = `${MONTHS[state.month - 1]} ${state.year}`;

    const salesSeries = [
      { name: 'Ventas', color: CHART_COLORS.ventas, values: monthly.map((m) => m.ventasBase) },
      { name: 'Compras', color: CHART_COLORS.compras, values: monthly.map((m) => m.comprasBase) },
    ];
    const retentionSeries = [
      { name: 'Retenciones', color: CHART_COLORS.retenciones, values: monthly.map((m) => m.retenciones) },
      { name: 'Percepciones', color: CHART_COLORS.percepciones, values: monthly.map((m) => m.percepciones) },
    ];

    const topSales = [...positions].sort((a, b) => b.ytd.baseVentas - a.ytd.baseVentas)[0];
    const topPayable = [...positions].sort((a, b) => b.ytd.igvPorPagar - a.ytd.igvPorPagar)[0];
    const topCredit = [...positions].sort((a, b) => b.month.creditAvailable - a.month.creditAvailable)[0];
    const pending = list.reduce((s, c) => s + Number(c.pending || 0), 0);
    const declared = list.reduce((s, c) => s + Number(c.declared || 0), 0);

    const hasAnyData = list.some((c) => c.hasData);
    const emptyBanner = hasAnyData ? '' : `<div class="mgmt-alert mgmt-alert--info">
      <strong>Aún no hay movimientos para ${escapeHtml(String(state.year))}</strong>
      <p>Importa compras, ventas, retenciones o planillas para que el consolidado muestre información. También puedes probar con otro ejercicio o revisar que las empresas tengan acceso asignado.</p>
    </div>`;

    const kpis = [
      { label: 'Ventas del ejercicio', value: `S/ ${money(annual.ventasBase)}`, hint: 'Base gravada de ventas', icon: ICONS.briefcase, tone: 'gold' },
      { label: 'Compras del ejercicio', value: `S/ ${money(annual.comprasBase)}`, hint: 'Base gravada de compras', icon: ICONS.building, tone: 'brown' },
      { label: 'IGV neto del ejercicio', value: `S/ ${money(annual.igvNeto)}`, hint: 'IGV ventas − IGV compras', icon: ICONS.arrowRight, tone: annual.igvNeto >= 0 ? 'brown' : 'green' },
      { label: 'Planilla del ejercicio', value: `S/ ${money(annual.payrollCost)}`, hint: 'Costo bruto + aportes estimados', icon: ICONS.users, tone: 'brown' },
      { label: 'Trabajadores', value: num(headcount), hint: `Activos en ${labelMonth}`, icon: ICONS.users, tone: 'gold' },
      { label: 'Retenciones + percepciones', value: `S/ ${money(annual.retenciones + annual.percepciones)}`, hint: 'Importes del ejercicio', icon: ICONS.shield, tone: 'blue' },
      { label: 'IGV por pagar', value: `S/ ${money(groupYtd.igvPorPagar)}`, hint: `Acumulado enero–${MONTHS[state.month - 1]}`, icon: ICONS.info, tone: 'red' },
      { label: 'Renta RMT', value: `S/ ${money(groupYtd.renta)}`, hint: `Acumulado enero–${MONTHS[state.month - 1]}`, icon: ICONS.check, tone: 'green' },
    ];

    const companyRows = positions.map(({ company, color, ytd }) => `
      <tr>
        <td>
          <div class="mgmt-company">
            <span class="mgmt-company__dot" style="background:${color}"></span>
            <div>
              <div class="mgmt-company__name">${escapeHtml(company.name)}</div>
              <div class="mgmt-company__meta">RUC ${escapeHtml(company.ruc || '—')} · ${escapeHtml(company.regimen || 'Régimen no definido')}</div>
            </div>
          </div>
        </td>
        <td class="cell-num">${money(ytd.baseVentas)}</td>
        <td class="cell-num">${money(ytd.baseCompras)}</td>
        <td class="cell-num ${ytd.igvNeto >= 0 ? 'cell-strong' : 'mgmt-text-credit'}">${money(ytd.igvNeto)}</td>
        <td class="cell-num">${money(ytd.retenciones + ytd.percepciones)}</td>
        <td class="cell-num">${money(ytd.payroll?.cost || 0)}</td>
        <td class="cell-num">${num(ytd.payroll?.headcount || 0)}</td>
        <td>${positionChip(ytd)}<div class="mgmt-cell-note">${positionText(ytd)}</div></td>
      </tr>`).join('');

    const totalsRow = `<tr class="mgmt-total-row">
      <td>Consolidado · ${list.length} empresa(s)</td>
      <td class="cell-num">${money(groupYtd.baseVentas)}</td>
      <td class="cell-num">${money(groupYtd.baseCompras)}</td>
      <td class="cell-num">${money(groupYtd.igvNeto)}</td>
      <td class="cell-num">${money(groupYtd.retenciones + groupYtd.percepciones)}</td>
      <td class="cell-num">${money(groupYtd.payroll?.cost || 0)}</td>
      <td class="cell-num">${num(groupYtd.payroll?.headcount || 0)}</td>
      <td>${positionChip(groupYtd)}</td>
    </tr>`;

    return `${warningsHtml(state.report)}
      ${emptyBanner}
      ${toolbarHtml()}
      <div class="stats mgmt-kpis">${kpis.map(kpiCard).join('')}</div>

      <div class="mgmt-chart-grid">
        ${chartCard({
          title: 'Ventas y compras del ejercicio',
          subtitle: 'Bases gravadas mensuales · todas las empresas del alcance',
          chart: groupedBarChart({
            labels: MONTHS,
            series: salesSeries,
            title: 'Ventas y compras por mes',
          }),
          series: salesSeries,
          className: 'mgmt-chart-card--wide',
        })}
        ${chartCard({
          title: 'Planilla y trabajadores',
          subtitle: 'Costo de planilla y colaboradores activos por mes',
          chart: payrollComboChart({
            labels: MONTHS,
            cost: monthly.map((m) => m.payrollCost),
            headcount: monthly.map((m) => m.headcount),
          }),
          series: [
            { name: 'Costo planilla', color: CHART_COLORS.payroll },
            { name: 'Trabajadores', color: CHART_COLORS.headcount },
          ],
        })}
        ${chartCard({
          title: 'Retenciones y percepciones',
          subtitle: 'Importes acumulados por mes',
          chart: stackedBarChart({
            labels: MONTHS,
            series: retentionSeries,
            title: 'Retenciones y percepciones por mes',
          }),
          series: retentionSeries,
        })}
      </div>

      <div class="mgmt-insight-grid">
        <section class="card mgmt-insights">
          <div class="mgmt-section-head"><div><h3 class="card__title">Lectura gerencial</h3><p class="card__subtitle">Señales relevantes del período seleccionado.</p></div></div>
          <ul class="mgmt-insight-list">
            ${topSales && topSales.ytd.baseVentas > 0 ? `<li><strong>Mayor volumen de ventas:</strong> ${escapeHtml(topSales.company.name)} con S/ ${money(topSales.ytd.baseVentas)}.</li>` : ''}
            ${topPayable && topPayable.ytd.igvPorPagar > 0 ? `<li><strong>Mayor IGV por pagar:</strong> ${escapeHtml(topPayable.company.name)} con S/ ${money(topPayable.ytd.igvPorPagar)} acumulado.</li>` : ''}
            ${topCredit && topCredit.month.creditAvailable > 0 ? `<li><strong>Crédito disponible:</strong> ${escapeHtml(topCredit.company.name)} con S/ ${money(topCredit.month.creditAvailable)} al cierre de ${escapeHtml(labelMonth)}.</li>` : ''}
            <li><strong>Control de declaraciones:</strong> ${declared} período(s) declarado(s) y ${pending} pendiente(s) en empresas con movimiento.</li>
            ${annual.payrollCost > 0 ? `<li><strong>Planilla:</strong> el costo consolidado del ejercicio asciende a S/ ${money(annual.payrollCost)} y ${num(headcount)} trabajador(es) activos en ${escapeHtml(labelMonth)}.</li>` : ''}
          </ul>
        </section>
        <section class="card mgmt-coverage-card">
          <div class="mgmt-section-head"><div><h3 class="card__title">Cobertura del consolidado</h3><p class="card__subtitle">Fuentes integradas y estado de la información.</p></div></div>
          <div class="mgmt-coverage">
            <div><span class="mgmt-coverage__value">${list.length}</span><span class="mgmt-coverage__label">empresas</span></div>
            <div><span class="mgmt-coverage__value">${num(headcount)}</span><span class="mgmt-coverage__label">trabajadores</span></div>
            <div><span class="mgmt-coverage__value">${declared}</span><span class="mgmt-coverage__label">declaraciones</span></div>
          </div>
          <div class="mgmt-source-list">
            <span>Compras y ventas</span><span>Retenciones</span><span>Planillas</span><span>Declaraciones</span>
          </div>
          <p class="mgmt-note">La planilla cerrada usa la foto oficial del período. En períodos abiertos se estima con sueldo base y conceptos registrados; los meses sin período abierto no se proyectan. El detalle definitivo está en Planillas.</p>
        </section>
      </div>

      <section class="card mgmt-table-card">
        <div class="mgmt-section-head">
          <div><h3 class="card__title">Resumen por empresa</h3><p class="card__subtitle">Acumulado enero–${escapeHtml(MONTHS[state.month - 1])} ${state.year}. Los importes están en soles.</p></div>
          <span class="mgmt-section-head__badge">${escapeHtml(labelMonth)}</span>
        </div>
        <div class="table-wrap mgmt-table-wrap">
          <table class="table mgmt-table mgmt-table--summary">
            <colgroup><col class="mgmt-col-company"><col span="7"></colgroup>
            <thead><tr>
              <th>Empresa</th><th class="cell-num">Ventas base</th><th class="cell-num">Compras base</th>
              <th class="cell-num">IGV neto</th><th class="cell-num">Reten. + percep.</th>
              <th class="cell-num">Planilla</th><th class="cell-num">Trab.</th><th>Posición</th>
            </tr></thead>
            <tbody>${companyRows || `<tr><td colspan="8"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin empresas en el alcance</div><div class="empty-state__desc">Asigna empresas a tu usuario para ver el consolidado.</div></div></td></tr>`}</tbody>
            <tfoot>${companyRows ? totalsRow : ''}</tfoot>
          </table>
        </div>
      </section>`;
  }

  /* ----------------------------- Comparativo ----------------------------- */

  function comparativePositions() {
    return companies().map((c, i) => ({
      company: c,
      color: companyColor(i),
      p: companyPosition(c, state.month, state.compareMode),
    }));
  }

  function comparativeTableHtml(positions) {
    const group = sumPositions(positions.map((x) => x.p));
    const rows = positions.map(({ company, color, p }) => `
      <tr>
        <td>
          <div class="mgmt-company">
            <span class="mgmt-company__dot" style="background:${color}"></span>
            <div>
              <div class="mgmt-company__name">${escapeHtml(company.name)}</div>
              <div class="mgmt-company__meta">${escapeHtml(company.ruc || '—')} · ${p.estado === 'declarado' ? 'Declarado' : 'Pendiente'}${p.diasAtraso > 0 ? ` · ${p.diasAtraso} día(s) de atraso` : ''}</div>
            </div>
          </div>
        </td>
        <td class="cell-num">${money(p.baseVentas)}</td>
        <td class="cell-num">${money(p.baseCompras)}</td>
        <td class="cell-num">${money(p.igvVentas)}</td>
        <td class="cell-num">${money(p.igvCompras)}</td>
        <td class="cell-num">${money(p.saldoAnterior)}</td>
        <td class="cell-num">${money(p.percepciones)}</td>
        <td class="cell-num">${money(p.retenciones)}</td>
        <td class="cell-num mgmt-text-credit" title="Saldo a favor + créditos no aplicados">${money(p.creditAvailable)}</td>
        <td class="cell-num ${p.igvPorPagar > 0 ? 'cell-strong' : ''}">${money(p.igvPorPagar)}</td>
        <td class="cell-num">${money(p.renta)}</td>
        <td class="cell-num cell-strong">${money(p.total)}</td>
      </tr>`).join('');
    const totalRow = `<tr class="mgmt-total-row">
      <td>Consolidado · ${positions.length} empresa(s)</td>
      <td class="cell-num">${money(group.baseVentas)}</td>
      <td class="cell-num">${money(group.baseCompras)}</td>
      <td class="cell-num">${money(group.igvVentas)}</td>
      <td class="cell-num">${money(group.igvCompras)}</td>
      <td class="cell-num">${money(group.saldoAnterior)}</td>
      <td class="cell-num">${money(group.percepciones)}</td>
      <td class="cell-num">${money(group.retenciones)}</td>
      <td class="cell-num mgmt-text-credit">${money(group.creditAvailable)}</td>
      <td class="cell-num cell-strong">${money(group.igvPorPagar)}</td>
      <td class="cell-num">${money(group.renta)}</td>
      <td class="cell-num cell-strong">${money(group.total)}</td>
    </tr>`;
    return `<div class="table-wrap mgmt-table-wrap">
      <table class="table mgmt-table mgmt-table--compare">
        <colgroup><col class="mgmt-col-company"><col span="11"></colgroup>
        <thead><tr>
          <th>Empresa</th><th class="cell-num">Ventas base</th><th class="cell-num">Compras base</th>
          <th class="cell-num">IGV ventas</th><th class="cell-num">IGV compras</th><th class="cell-num">Saldo anterior</th>
          <th class="cell-num">Percep.</th><th class="cell-num">Reten.</th><th class="cell-num">Crédito disp.</th>
          <th class="cell-num">IGV por pagar</th><th class="cell-num">Renta</th><th class="cell-num">Total</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="12"><div class="empty-state"><span class="empty-state__icon">${ICONS.info}</span><div class="empty-state__title">Sin información para el período</div><div class="empty-state__desc">Selecciona otro mes o revisa los módulos de origen.</div></div></td></tr>`}</tbody>
        <tfoot>${rows ? totalRow : ''}</tfoot>
      </table>
    </div>`;
  }

  function rankingHtml(positions) {
    const payable = positions.filter((x) => x.p.igvPorPagar > 0.009).sort((a, b) => b.p.igvPorPagar - a.p.igvPorPagar);
    const credit = positions.filter((x) => x.p.creditAvailable > 0.009).sort((a, b) => b.p.creditAvailable - a.p.creditAvailable);
    const maxPayable = Math.max(1, ...payable.map((x) => x.p.igvPorPagar));
    const maxCredit = Math.max(1, ...credit.map((x) => x.p.creditAvailable));
    const bar = (x, max, cls) => `<div class="mgmt-rank-row">
      <div class="mgmt-rank-name">${escapeHtml(x.company.name)}</div>
      <div class="mgmt-rank-track"><div class="mgmt-rank-bar ${cls}" style="width:${Math.max(2, (x.p[cls === 'mgmt-rank-bar--payable' ? 'igvPorPagar' : 'creditAvailable'] / max) * 100)}%"></div></div>
      <div class="mgmt-rank-value">S/ ${money(x.p[cls === 'mgmt-rank-bar--payable' ? 'igvPorPagar' : 'creditAvailable'])}</div>
    </div>`;
    return `<div class="mgmt-ranking-grid">
      <section class="card mgmt-ranking-card">
        <div class="mgmt-section-head"><div><h3 class="card__title">IGV por pagar</h3><p class="card__subtitle">Empresas con mayor obligación.</p></div></div>
        <div class="mgmt-rank-list">${payable.length ? payable.map((x) => bar(x, maxPayable, 'mgmt-rank-bar--payable')).join('') : '<p class="mgmt-empty-line">Sin IGV por pagar en el período.</p>'}</div>
      </section>
      <section class="card mgmt-ranking-card">
        <div class="mgmt-section-head"><div><h3 class="card__title">Crédito disponible</h3><p class="card__subtitle">Saldos a favor y créditos no aplicados.</p></div></div>
        <div class="mgmt-rank-list">${credit.length ? credit.map((x) => bar(x, maxCredit, 'mgmt-rank-bar--credit')).join('') : '<p class="mgmt-empty-line">Sin crédito disponible en el período.</p>'}</div>
      </section>
    </div>`;
  }

  function comparativeHtml() {
    const positions = comparativePositions();
    const group = sumPositions(positions.map((x) => x.p));
    const periodLabel = state.compareMode === 'ytd'
      ? `Enero–${MONTHS[state.month - 1]} ${state.year}`
      : `${MONTHS[state.month - 1]} ${state.year}`;
    const kpis = [
      { label: 'IGV por pagar', value: `S/ ${money(group.igvPorPagar)}`, hint: 'Después de créditos y retenciones', tone: 'red', icon: ICONS.info },
      { label: 'Crédito disponible', value: `S/ ${money(group.creditAvailable)}`, hint: 'Saldo a favor + no aplicado', tone: 'green', icon: ICONS.shield },
      { label: 'Percepciones', value: `S/ ${money(group.percepciones)}`, hint: state.compareMode === 'ytd' ? 'Acumulado del ejercicio' : 'Del período seleccionado', tone: 'blue', icon: ICONS.arrowRight },
      { label: 'Retenciones', value: `S/ ${money(group.retenciones)}`, hint: state.compareMode === 'ytd' ? 'Acumulado del ejercicio' : 'Del período seleccionado', tone: 'blue', icon: ICONS.check },
      { label: 'Renta RMT', value: `S/ ${money(group.renta)}`, hint: 'Tasa 1.00% / 1.50%', tone: 'brown', icon: ICONS.briefcase },
      { label: 'Total a regularizar', value: `S/ ${money(group.total)}`, hint: 'IGV + Renta + intereses', tone: 'gold', icon: ICONS.building },
    ];
    return `${warningsHtml(state.report)}
      ${toolbarHtml()}
      <div class="mgmt-comparative-head">
        <div>
          <div class="mgmt-eyebrow">PDT 621 · Vista comparativa</div>
          <h3 class="mgmt-comparative-title">${escapeHtml(periodLabel)}</h3>
        </div>
        <div class="mgmt-comparative-actions" data-no-print>
          <div class="mgmt-segmented">
            <button type="button" class="${state.compareMode === 'month' ? 'is-active' : ''}" data-compare-mode="month">Mes</button>
            <button type="button" class="${state.compareMode === 'ytd' ? 'is-active' : ''}" data-compare-mode="ytd">Acumulado</button>
          </div>
          <button type="button" class="btn btn--sm" data-export-csv>${ICONS.arrowRight} CSV</button>
        </div>
      </div>
      <div class="stats mgmt-kpis mgmt-kpis--compact">${kpis.map(kpiCard).join('')}</div>
      <section class="card mgmt-table-card">
        <div class="mgmt-section-head">
          <div><h3 class="card__title">Posición tributaria por empresa</h3><p class="card__subtitle">${state.compareMode === 'ytd' ? 'Acumulado del ejercicio' : 'Resultado del mes'} · importes en soles</p></div>
          <span class="mgmt-section-head__badge">${positions.length} empresa(s)</span>
        </div>
        ${comparativeTableHtml(positions)}
        <p class="mgmt-note">IGV por pagar = IGV ventas − IGV compras − saldo anterior − percepciones − retenciones. El crédito disponible incluye el saldo a favor del período y los créditos no aplicados. La renta corresponde al Régimen MYPE Tributario y el total incluye los intereses moratorios calculados a la fecha.</p>
      </section>
      ${rankingHtml(positions)}`;
  }

  /* ------------------------------ Simulación ----------------------------- */

  function simulationData() {
    const seller = companyById(state.sim.sellerId);
    const buyer = companyById(state.sim.buyerId);
    if (!seller || !buyer || seller.id === buyer.id) {
      return { valid: false, reason: 'Selecciona una empresa vendedora y una compradora distintas.' };
    }
    const month = state.month;
    const rate = Number(state.sim.rate || 0.18);
    const sellerBefore = companyPosition(seller, month, 'month');
    const buyerBefore = companyPosition(buyer, month, 'month');
    const sellerBeforeYtd = companyPosition(seller, month, 'ytd');
    const buyerBeforeYtd = companyPosition(buyer, month, 'ytd');
    const maxBase = round2(Math.max(0, Math.min(sellerBefore.creditAvailable, buyerBefore.igvPorPagar) / rate));
    const rawBase = state.sim.base == null ? maxBase : Number(state.sim.base || 0);
    const base = round2(Math.max(0, rawBase));
    const igv = round2(base * rate);
    const sellerSim = simulateInvoice(seller, { month, kind: 'venta', base, igv });
    const buyerSim = simulateInvoice(buyer, { month, kind: 'compra', base, igv });
    const sellerAfter = companyPosition({ ...seller, months: sellerSim.timeline.months }, month, 'month');
    const buyerAfter = companyPosition({ ...buyer, months: buyerSim.timeline.months }, month, 'month');
    const sellerAfterYtd = companyPosition({ ...seller, months: sellerSim.timeline.months }, month, 'ytd');
    const buyerAfterYtd = companyPosition({ ...buyer, months: buyerSim.timeline.months }, month, 'ytd');
    const groupBefore = sumPositions([sellerBefore, buyerBefore]);
    const groupAfter = sumPositions([sellerAfter, buyerAfter]);
    const groupBeforeYtd = sumPositions([sellerBeforeYtd, buyerBeforeYtd]);
    const groupAfterYtd = sumPositions([sellerAfterYtd, buyerAfterYtd]);
    const exceeds = base > maxBase + 0.009;
    const sellerNoCredit = sellerBefore.creditAvailable <= 0.009;
    const buyerNoPayable = buyerBefore.igvPorPagar <= 0.009;
    const buyerSaving = round2(buyerBefore.igvPorPagar - buyerAfter.igvPorPagar);
    const creditUsed = round2(sellerBefore.creditAvailable - sellerAfter.creditAvailable);
    const rentaDelta = round2(sellerAfter.renta - sellerBefore.renta);
    const rentaDeltaYtd = round2(sellerAfterYtd.renta - sellerBeforeYtd.renta);
    const igvGroupDelta = round2(groupBefore.igvPorPagar - groupAfter.igvPorPagar);
    const netEffect = round2(igvGroupDelta - rentaDelta);
    const netEffectYtd = round2((groupBeforeYtd.igvPorPagar - groupAfterYtd.igvPorPagar) - rentaDeltaYtd);
    return {
      valid: true,
      seller, buyer, rate, maxBase, base, igv,
      sellerBefore, buyerBefore, sellerAfter, buyerAfter,
      sellerBeforeYtd, buyerAfterYtd, sellerAfterYtd,
      groupBefore, groupAfter, groupBeforeYtd, groupAfterYtd,
      exceeds, sellerNoCredit, buyerNoPayable,
      buyerSaving, creditUsed, rentaDelta, rentaDeltaYtd, netEffect, netEffectYtd,
    };
  }

  function simCompanyCard(title, company, before, after, kind, color) {
    const beforeBase = kind === 'venta' ? before.baseVentas : before.baseCompras;
    const afterBase = kind === 'venta' ? after.baseVentas : after.baseCompras;
    const beforeIgv = kind === 'venta' ? before.igvVentas : before.igvCompras;
    const afterIgv = kind === 'venta' ? after.igvVentas : after.igvCompras;
    return `<section class="card mgmt-sim-company">
      <div class="mgmt-sim-company__head">
        <span class="mgmt-company__dot" style="background:${color}"></span>
        <div><div class="mgmt-eyebrow">${escapeHtml(title)}</div><h3 class="card__title">${escapeHtml(company.name)}</h3><p class="card__subtitle">RUC ${escapeHtml(company.ruc || '—')}</p></div>
      </div>
      <table class="mgmt-sim-table">
        <thead><tr><th>Concepto</th><th class="cell-num">Antes</th><th class="cell-num">Después</th></tr></thead>
        <tbody>
          <tr><td>${kind === 'venta' ? 'Ventas base' : 'Compras base'}</td><td class="cell-num">${money(beforeBase)}</td><td class="cell-num">${money(afterBase)}</td></tr>
          <tr><td>${kind === 'venta' ? 'IGV ventas' : 'IGV compras'}</td><td class="cell-num">${money(beforeIgv)}</td><td class="cell-num">${money(afterIgv)}</td></tr>
          <tr><td>Crédito disponible</td><td class="cell-num">${money(before.creditAvailable)}</td><td class="cell-num">${money(after.creditAvailable)}</td></tr>
          <tr class="mgmt-sim-table__strong"><td>IGV por pagar</td><td class="cell-num">${money(before.igvPorPagar)}</td><td class="cell-num">${money(after.igvPorPagar)}</td></tr>
          <tr><td>Renta RMT</td><td class="cell-num">${money(before.renta)}</td><td class="cell-num">${money(after.renta)}</td></tr>
          <tr class="mgmt-sim-table__strong"><td>Total a regularizar</td><td class="cell-num">${money(before.total)}</td><td class="cell-num">${money(after.total)}</td></tr>
        </tbody>
      </table>
    </section>`;
  }

  function simulationHtml() {
    ensureSimSelection();
    const list = state.report?.companies || [];
    const sim = simulationData();
    const simRate = Number(state.sim.rate || 0.18);
    const options = (selected, exclude) => list
      .filter((c) => c.id !== exclude)
      .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === selected ? ' selected' : ''}>${escapeHtml(c.name)} · ${escapeHtml(c.ruc)}</option>`)
      .join('');

    const selectionCards = sim.valid ? `<div class="mgmt-sim-position-grid">
      <div class="mgmt-sim-position mgmt-sim-position--credit">
        <span class="mgmt-eyebrow">Crédito disponible</span>
        <strong>${escapeHtml(sim.seller.name)}</strong>
        <span class="mgmt-sim-position__value">S/ ${money(sim.sellerBefore.creditAvailable)}</span>
        <span class="mgmt-cell-note">Vendedora · crédito al cierre de ${escapeHtml(MONTHS[state.month - 1])}</span>
      </div>
      <div class="mgmt-sim-position mgmt-sim-position--payable">
        <span class="mgmt-eyebrow">IGV por pagar</span>
        <strong>${escapeHtml(sim.buyer.name)}</strong>
        <span class="mgmt-sim-position__value">S/ ${money(sim.buyerBefore.igvPorPagar)}</span>
        <span class="mgmt-cell-note">Compradora · obligación del período</span>
      </div>
    </div>` : '';

    const result = sim.valid ? `<div class="mgmt-sim-result">
      <section class="card mgmt-sim-invoice">
        <div class="mgmt-sim-invoice__head">
          <div><div class="mgmt-eyebrow">Factura simulada · operación intercompany</div><h3 class="mgmt-sim-invoice__title">${escapeHtml(sim.seller.name)} <span>→</span> ${escapeHtml(sim.buyer.name)}</h3></div>
          <span class="mgmt-chip mgmt-chip--neutral">${pct(sim.rate)} IGV</span>
        </div>
        <div class="mgmt-sim-invoice__numbers">
          <div><span>Base gravada</span><strong>S/ ${money(sim.base)}</strong></div>
          <div><span>IGV</span><strong>S/ ${money(sim.igv)}</strong></div>
          <div class="mgmt-sim-invoice__total"><span>Total factura</span><strong>S/ ${money(sim.base + sim.igv)}</strong></div>
        </div>
        <div class="mgmt-sim-limits">
          <div><span>Máximo sugerido</span><strong>S/ ${money(sim.maxBase)}</strong></div>
          <div><span>Crédito de la vendedora</span><strong>S/ ${money(sim.sellerBefore.creditAvailable)}</strong></div>
          <div><span>IGV por pagar de la compradora</span><strong>S/ ${money(sim.buyerBefore.igvPorPagar)}</strong></div>
        </div>
      </section>

      ${sim.sellerNoCredit || sim.buyerNoPayable || sim.exceeds ? `<div class="mgmt-alert mgmt-alert--warning">
        <strong>Revisa los límites de la simulación</strong>
        <ul>
          ${sim.sellerNoCredit ? '<li>La empresa vendedora no tiene crédito fiscal disponible en el período.</li>' : ''}
          ${sim.buyerNoPayable ? '<li>La empresa compradora no tiene IGV por pagar en el período.</li>' : ''}
          ${sim.exceeds ? `<li>El monto supera el máximo sugerido. El excedente podría generar IGV por pagar en la vendedora.</li>` : ''}
        </ul>
      </div>` : ''}

      <div class="mgmt-sim-company-grid">
        ${simCompanyCard('Vendedora · emite factura', sim.seller, sim.sellerBefore, sim.sellerAfter, 'venta', CHART_COLORS.ventas)}
        ${simCompanyCard('Compradora · recibe factura', sim.buyer, sim.buyerBefore, sim.buyerAfter, 'compra', CHART_COLORS.compras)}
      </div>

      <div class="mgmt-impact-grid">
        <article class="mgmt-impact mgmt-impact--green"><span>IGV que deja de desembolsar la compradora</span><strong>S/ ${money(sim.buyerSaving)}</strong><small>Reducción del IGV por pagar del mes</small></article>
        <article class="mgmt-impact"><span>Crédito utilizado de la vendedora</span><strong>S/ ${money(sim.creditUsed)}</strong><small>Saldo a favor consumido</small></article>
        <article class="mgmt-impact mgmt-impact--warning"><span>Costo RMT adicional</span><strong>S/ ${money(sim.rentaDelta)}</strong><small>Renta del mes de la vendedora</small></article>
        <article class="mgmt-impact mgmt-impact--dark"><span>Efecto neto estimado</span><strong>S/ ${money(sim.netEffect)}</strong><small>IGV neto del grupo − Renta adicional</small></article>
      </div>

      <section class="card mgmt-sim-analysis">
        <div class="mgmt-section-head"><div><h3 class="card__title">Lectura de la operación</h3><p class="card__subtitle">El IGV consolidado del grupo no cambia: se traslada crédito entre empresas.</p></div></div>
        <div class="mgmt-sim-analysis__grid">
          <div><span>IGV por pagar de la pareja</span><strong>S/ ${money(sim.groupBefore.igvPorPagar)} → S/ ${money(sim.groupAfter.igvPorPagar)}</strong></div>
          <div><span>Crédito disponible de la pareja</span><strong>S/ ${money(sim.groupBefore.creditAvailable)} → S/ ${money(sim.groupAfter.creditAvailable)}</strong></div>
          <div><span>Renta del mes de la vendedora</span><strong>S/ ${money(sim.sellerBefore.renta)} → S/ ${money(sim.sellerAfter.renta)}</strong></div>
          <div><span>IGV + Renta del mes de la pareja</span><strong>S/ ${money(sim.groupBefore.igvPorPagar + sim.groupBefore.renta)} → S/ ${money(sim.groupAfter.igvPorPagar + sim.groupAfter.renta)}</strong></div>
        </div>
        <div class="mgmt-sim-recommendation ${sim.netEffect >= 0 ? 'is-positive' : 'is-negative'}">
          <strong>${sim.netEffect >= 0 ? 'La simulación libera caja tributaria' : 'La simulación incrementa el costo tributario'}.</strong>
          ${sim.netEffect >= 0
            ? `Se usarían S/ ${money(sim.creditUsed)} de crédito y la compradora reduciría su IGV en S/ ${money(sim.buyerSaving)}; el costo adicional de RMT sería S/ ${money(sim.rentaDelta)}.`
            : `El efecto neto es negativo (S/ ${money(Math.abs(sim.netEffect))}): revisa el costo adicional de RMT (S/ ${money(sim.rentaDelta)}) y el IGV que asumiría la vendedora.`}
          ${sim.exceeds ? 'Cuando la factura supera el crédito disponible de la vendedora, el efecto neto incorpora el IGV que esta asumiría por el excedente.' : ''}
          Revisa que exista una operación económica real, sustento comercial y que el precio esté a valor de mercado antes de emitir la factura.
          <span class="mgmt-sim-recommendation__note">El efecto neto no incluye intereses moratorios.</span>
        </div>
      </section>
    </div>` : `<div class="card mgmt-empty-sim"><div class="empty-state"><span class="empty-state__icon">${ICONS.info}</span><div class="empty-state__title">Selecciona dos empresas</div><div class="empty-state__desc">${escapeHtml(sim.reason || 'Elige una empresa con crédito fiscal y otra con IGV por pagar.')}</div></div></div>`;

    return `${warningsHtml(state.report)}
      ${toolbarHtml()}
      <div class="mgmt-sim-intro">
        <div class="mgmt-eyebrow">Planeamiento tributario intragrupo</div>
        <h3 class="mgmt-comparative-title">Simulación de facturación intercompany</h3>
        <p>Usa el crédito fiscal disponible de una empresa para reducir el IGV por pagar de otra empresa del mismo grupo. La herramienta recalcula la cascada de IGV y la Renta RMT del ejercicio. Para simular siempre considera todas las empresas a las que tienes acceso, aunque el filtro superior esté en una sola empresa.</p>
      </div>
      <section class="card mgmt-sim-form" data-no-print>
        <div class="mgmt-sim-form__grid">
          <div class="form-group"><label class="form-label">Empresa vendedora · crédito</label><select class="form-input" data-sim-seller>${options(state.sim.sellerId, null)}</select></div>
          <div class="form-group"><label class="form-label">Empresa compradora · IGV por pagar</label><select class="form-input" data-sim-buyer>${options(state.sim.buyerId, state.sim.sellerId)}</select></div>
          <div class="form-group"><label class="form-label">Tasa de IGV</label><select class="form-input" data-sim-rate><option value="0.18"${simRate === 0.18 ? ' selected' : ''}>18% · régimen general</option><option value="0.10"${simRate === 0.10 ? ' selected' : ''}>10% · IGV Justo / Ley 31556</option></select></div>
          <div class="form-group mgmt-sim-base-field"><label class="form-label">Base de la factura</label><div class="mgmt-input-action"><input class="form-input" type="number" min="0" step="0.01" data-sim-base value="${sim.valid ? sim.base.toFixed(2) : '0.00'}" /><button type="button" class="btn btn--sm" data-sim-max>Usar máximo</button></div><span class="mgmt-field-hint">Máximo sugerido: S/ ${sim.valid ? money(sim.maxBase) : '0.00'}</span></div>
        </div>
        <div class="mgmt-sim-form__foot">
          <span class="mgmt-note">La simulación es referencial y no reemplaza la evaluación contable, legal ni de precios de transferencia.</span>
          <button type="button" class="btn btn--primary" data-print>${ICONS.arrowRight} Exportar simulación</button>
        </div>
      </section>
      ${selectionCards}
      ${result}`;
  }

  /* ------------------------------- Render -------------------------------- */

  function renderContent() {
    if (state.busy) {
      content.innerHTML = `<div class="card mgmt-loading"><span class="mgmt-spinner"></span><div><strong>Generando consolidado</strong><p>Consultando compras, ventas, planillas, retenciones y declaraciones de las empresas accesibles…</p></div></div>`;
      return;
    }
    if (state.error) {
      content.innerHTML = `<div class="card"><div class="card__body"><div class="empty-state"><span class="empty-state__icon">${ICONS.error}</span><div class="empty-state__title">No se pudo generar el reporte</div><div class="empty-state__desc">${escapeHtml(state.error)}</div><button type="button" class="btn btn--primary" data-refresh>Reintentar</button></div></div></div>`;
      return;
    }
    if (!state.report) return;
    if (!state.report.companies.length) {
      content.innerHTML = `<div class="card"><div class="card__body"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin empresas asignadas</div><div class="empty-state__desc">Tu usuario no tiene empresas activas. Contacta al administrador para que te asigne acceso.</div></div></div></div>`;
      return;
    }
    if (state.tab === 'comparativo') content.innerHTML = comparativeHtml();
    else if (state.tab === 'simulacion') content.innerHTML = simulationHtml();
    else content.innerHTML = dashboardHtml();
  }

  /* ------------------------------- Export -------------------------------- */

  function exportCsv() {
    const positions = comparativePositions();
    const headers = [
      'Empresa', 'RUC', 'Ventas base', 'Compras base', 'IGV ventas', 'IGV compras',
      'Saldo anterior', 'Percepciones', 'Retenciones', 'Credito disponible',
      'IGV por pagar', 'Renta', 'Total a regularizar', 'Estado',
    ];
    const rows = positions.map(({ company, p }) => [
      company.name, company.ruc, p.baseVentas, p.baseCompras, p.igvVentas, p.igvCompras,
      p.saldoAnterior, p.percepciones, p.retenciones, p.creditAvailable,
      p.igvPorPagar, p.renta, p.total, p.estado,
    ]);
    const group = sumPositions(positions.map((x) => x.p));
    rows.push(['Consolidado', '', group.baseVentas, group.baseCompras, group.igvVentas, group.igvCompras,
      group.saldoAnterior, group.percepciones, group.retenciones, group.creditAvailable,
      group.igvPorPagar, group.renta, group.total, '']);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `COMPARATIVO_TRIBUTARIO_${state.year}_${String(state.month).padStart(2, '0')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function printReport() {
    if (!state.report) return;
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Permite las ventanas emergentes para exportar el PDF.', 'error');
      return;
    }
    const clone = content.cloneNode(true);
    clone.querySelectorAll('[data-no-print], form, button, select, input, textarea').forEach((el) => el.remove());
    const base = new URL('../../', import.meta.url).href;
    const period = `${MONTHS[state.month - 1]} ${state.year}`;
    const tabTitle = state.tab === 'comparativo' ? 'Comparativo tributario' : state.tab === 'simulacion' ? 'Simulación intercompany' : 'Dashboard gerencial';
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>${escapeHtml(tabTitle)} · ${escapeHtml(period)}</title>
      <link rel="stylesheet" href="${base}css/variables.css">
      <link rel="stylesheet" href="${base}css/base.css">
      <link rel="stylesheet" href="${base}css/components.css">
      <style>
        *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#fff;padding:22px;font-size:11px}
        .print-head{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:2px solid #c5a059;padding-bottom:12px;margin-bottom:16px}
        .print-brand{display:flex;align-items:center;gap:12px}.print-brand img{width:48px;height:48px;object-fit:contain;background:#fff;border:1px solid #e7e0d8;border-radius:6px;padding:3px}
        .print-brand h1{font-size:17px;margin:0;color:#3e2723}.print-brand p{font-size:10px;color:#7a726a;margin:2px 0 0}
        .print-meta{text-align:right;font-size:10px;color:#7a726a}.print-meta strong{display:block;color:#3e2723;font-size:12px}
        .print-bar{background:#3e2723;color:#fff;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:11px}
        .print-content .page-heading,.print-content .tabs-bar,.print-content .mgmt-heading-actions{display:none!important}
        .print-content .mgmt-toolbar{display:none!important}
        .print-content .card{border:1px solid #e7e0d8;box-shadow:none;border-radius:6px;margin-bottom:10px}
        .print-content .card__body{padding:10px}
        .print-content .mgmt-kpis{grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
        .print-content .mgmt-kpi{padding:8px;border-radius:5px}
        .print-content .mgmt-kpi__value{font-size:13px}.print-content .mgmt-kpi__label,.print-content .mgmt-kpi__hint{font-size:8px}
        .print-content .mgmt-chart-grid{display:block}.print-content .mgmt-chart-card{break-inside:avoid;margin-bottom:10px}
        .print-content .mgmt-chart__svg{width:100%;height:auto;max-height:230px}
        .print-content .mgmt-insight-grid,.print-content .mgmt-ranking-grid,.print-content .mgmt-sim-company-grid,.print-content .mgmt-impact-grid,.print-content .mgmt-sim-position-grid,.print-content .mgmt-sim-analysis__grid{display:block}
        .print-content .mgmt-insight-grid>*,.print-content .mgmt-ranking-grid>*,.print-content .mgmt-sim-company-grid>*{margin-bottom:10px}
        .print-content .table-wrap{overflow:visible;border:1px solid #e7e0d8}
        .print-content table{font-size:8px;min-width:0}
        .print-content .mgmt-table th,.print-content .mgmt-table td{white-space:normal}
        .print-content .mgmt-table thead th{position:static}
        .print-content .mgmt-table th:first-child,.print-content .mgmt-table td:first-child{position:static;box-shadow:none}
        .print-content .mgmt-company__name{font-size:8px}.print-content .mgmt-company__meta{font-size:7px}
        .print-content th,.print-content td{padding:4px 5px}
        .print-content .mgmt-total-row td{background:#f5efeb!important;font-weight:700}
        .print-content .mgmt-chip{font-size:7px;padding:2px 5px}
        .print-content .mgmt-note{font-size:8px}
        .print-content .empty-state{padding:12px}
        .print-content .mgmt-sim-form{display:none}
        @page{size:A4 landscape;margin:10mm}
        @media print{body{padding:0}.print-content .card{break-inside:avoid}}
      </style></head><body>
      <div class="print-head"><div class="print-brand"><img src="${base}assets/logo-ayf.png" alt="A y F FICA"><div><h1>A y F FICA Asociados S.A.C.</h1><p>Reportes Gerenciales · ${escapeHtml(tabTitle)}</p></div></div>
      <div class="print-meta"><strong>${escapeHtml(period)}</strong>${escapeHtml(scopeLabel())}<br>${state.report.companies.length} empresa(s) en alcance<br>Generado: ${dateShort(TODAY)}</div></div>
      <div class="print-bar">Consolidado tributario y operativo · información confidencial de uso interno</div>
      <div class="print-content">${clone.innerHTML}</div>
      </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  /* ------------------------------- Eventos ------------------------------- */

  viewRoot.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }

    if (e.target.closest('[data-refresh]')) { load(); return; }
    if (e.target.closest('[data-print]')) { printReport(); return; }
    if (e.target.closest('[data-export-csv]')) { exportCsv(); return; }

    const mode = e.target.closest('[data-compare-mode]');
    if (mode) { state.compareMode = mode.dataset.compareMode; renderContent(); return; }

    if (e.target.closest('[data-sim-max]')) {
      const sim = simulationData();
      if (sim.valid) {
        state.sim.base = sim.maxBase;
        renderContent();
      }
      return;
    }
  });

  viewRoot.addEventListener('change', async (e) => {
    if (e.target.matches('[data-year]')) {
      state.year = Number(e.target.value) || CURRENT_YEAR;
      state.month = null;
      state.sim.base = null;
      await load({ resetMonth: true });
      return;
    }
    if (e.target.matches('[data-month]')) {
      state.month = Number(e.target.value) || 1;
      state.sim.base = null;
      ensureSimSelection();
      renderContent();
      return;
    }
    if (e.target.matches('[data-company]')) {
      state.companyId = e.target.value || 'all';
      renderContent();
      return;
    }
    if (e.target.matches('[data-sim-seller]')) {
      state.sim.sellerId = e.target.value;
      if (state.sim.buyerId === state.sim.sellerId) {
        const other = (state.report?.companies || []).find((c) => c.id !== state.sim.sellerId);
        state.sim.buyerId = other ? other.id : '';
      }
      state.sim.base = null;
      renderContent();
      return;
    }
    if (e.target.matches('[data-sim-buyer]')) {
      state.sim.buyerId = e.target.value;
      state.sim.base = null;
      renderContent();
      return;
    }
    if (e.target.matches('[data-sim-rate]')) {
      state.sim.rate = Number(e.target.value) || 0.18;
      state.sim.base = null;
      renderContent();
      return;
    }
    if (e.target.matches('[data-sim-base]')) {
      const value = Number(e.target.value);
      state.sim.base = Number.isFinite(value) ? value : 0;
      renderContent();
    }
  });

  load({ resetMonth: true });
}

export default { title: 'Reportes Gerenciales', render };
