/* ============================================================================
   reportesCharts.js — Gráficos SVG sin dependencias externas
   ----------------------------------------------------------------------------
   Se generan como cadenas SVG para que funcionen igual en pantalla, en la
   impresión y en el PDF. Todos los gráficos son responsivos y accesibles.
   ========================================================================== */

import { escapeHtml } from '../../js/utils.js';

export const CHART_COLORS = {
  ventas: '#c5a059',
  compras: '#4e342e',
  igvVentas: '#d4af37',
  igvCompras: '#7a5b3a',
  retenciones: '#3b6e9e',
  percepciones: '#c5a059',
  payroll: '#4e342e',
  headcount: '#c5a059',
  credit: '#2f7d4f',
  payable: '#b3352e',
};

const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const fmt2 = (v) => Number(v || 0).toLocaleString('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** Formato compacto para ejes: S/ 1,2 M, S/ 125 mil, etc. */
export function compactMoney(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${(n / 1000000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1000) return `${(n / 1000).toLocaleString('es-PE', { maximumFractionDigits: 0 })} mil`;
  return n.toLocaleString('es-PE', { maximumFractionDigits: 0 });
}

function niceMax(value) {
  const n = Number(value || 0);
  if (!(n > 0)) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = 10 ** exp;
  const f = n / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

function axisTicks(max, count = 4) {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

function emptyChart(message = 'Sin datos para el período') {
  return `<div class="mgmt-chart-empty"><span class="mgmt-chart-empty__mark">—</span><span>${escapeHtml(message)}</span></div>`;
}

function chartTitle(series) {
  return series.map((s) => `${s.name}: ${fmt2(s.values.reduce((a, b) => a + Number(b || 0), 0))}`).join(' · ');
}

/**
 * Barras agrupadas por mes.
 * @param {{labels:string[], series:{name:string,color:string,values:number[]}[], height?:number, title?:string}} opts
 */
export function groupedBarChart({ labels, series, height = 250, title = '' }) {
  const cleanSeries = (series || []).map((s) => ({
    ...s,
    values: (s.values || []).map((v) => Number(v || 0)),
  }));
  const maxValue = Math.max(0, ...cleanSeries.flatMap((s) => s.values));
  if (!labels?.length || !cleanSeries.length || maxValue === 0) return emptyChart();

  const W = 760;
  const H = height;
  const P = { top: 18, right: 16, bottom: 34, left: 62 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;
  const max = niceMax(maxValue);
  const groupW = plotW / labels.length;
  const barW = Math.max(4, Math.min(18, (groupW * 0.68) / cleanSeries.length));
  const gap = Math.max(2, (groupW * 0.68 - barW * cleanSeries.length) / Math.max(1, cleanSeries.length - 1));
  const baseY = P.top + plotH;
  const yFor = (v) => baseY - (Math.max(0, v) / max) * plotH;

  const grid = axisTicks(max).map((tick) => {
    const y = yFor(tick);
    return `<line x1="${P.left}" x2="${W - P.right}" y1="${y}" y2="${y}" class="mgmt-svg-grid"/>
      <text x="${P.left - 10}" y="${y + 4}" text-anchor="end" class="mgmt-svg-axis">${escapeHtml(compactMoney(tick))}</text>`;
  }).join('');

  const bars = labels.map((label, i) => {
    const groupX = P.left + i * groupW;
    const startX = groupX + (groupW - (barW * cleanSeries.length + gap * (cleanSeries.length - 1))) / 2;
    const rects = cleanSeries.map((s, j) => {
      const value = s.values[i] || 0;
      const x = startX + j * (barW + gap);
      const y = yFor(value);
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, baseY - y).toFixed(2)}" rx="2" fill="${s.color}"><title>${escapeHtml(label)} · ${escapeHtml(s.name)}: S/ ${fmt2(value)}</title></rect>`;
    }).join('');
    return `<g>${rects}<text x="${(groupX + groupW / 2).toFixed(2)}" y="${baseY + 20}" text-anchor="middle" class="mgmt-svg-axis">${escapeHtml(MONTHS_SHORT[i] || label)}</text></g>`;
  }).join('');

  return `<svg class="mgmt-chart__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(title || `Gráfico de ${cleanSeries.map((s) => s.name).join(' y ')}`)}">
    <title>${escapeHtml(title || chartTitle(cleanSeries))}</title>
    <desc>Comparativo mensual de ${escapeHtml(cleanSeries.map((s) => s.name).join(' y '))}.</desc>
    ${grid}
    <line x1="${P.left}" x2="${W - P.right}" y1="${baseY}" y2="${baseY}" class="mgmt-svg-axis-line"/>
    ${bars}
  </svg>`;
}

/**
 * Barras apiladas (ej. retenciones + percepciones).
 */
export function stackedBarChart({ labels, series, height = 250, title = '' }) {
  const cleanSeries = (series || []).map((s) => ({
    ...s,
    values: (s.values || []).map((v) => Number(v || 0)),
  }));
  const totals = (labels || []).map((_, i) => cleanSeries.reduce((acc, s) => acc + (s.values[i] || 0), 0));
  const maxValue = Math.max(0, ...totals);
  if (!labels?.length || !cleanSeries.length || maxValue === 0) return emptyChart();

  const W = 760;
  const H = height;
  const P = { top: 18, right: 16, bottom: 34, left: 62 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;
  const max = niceMax(maxValue);
  const groupW = plotW / labels.length;
  const barW = Math.max(6, Math.min(28, groupW * 0.52));
  const baseY = P.top + plotH;
  const yFor = (v) => baseY - (Math.max(0, v) / max) * plotH;

  const grid = axisTicks(max).map((tick) => {
    const y = yFor(tick);
    return `<line x1="${P.left}" x2="${W - P.right}" y1="${y}" y2="${y}" class="mgmt-svg-grid"/>
      <text x="${P.left - 10}" y="${y + 4}" text-anchor="end" class="mgmt-svg-axis">${escapeHtml(compactMoney(tick))}</text>`;
  }).join('');

  const bars = labels.map((label, i) => {
    const x = P.left + i * groupW + (groupW - barW) / 2;
    let acc = 0;
    const segments = cleanSeries.map((s) => {
      const value = s.values[i] || 0;
      const yBottom = yFor(acc);
      acc += value;
      const yTop = yFor(acc);
      return `<rect x="${x.toFixed(2)}" y="${yTop.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, yBottom - yTop).toFixed(2)}" rx="1.5" fill="${s.color}"><title>${escapeHtml(label)} · ${escapeHtml(s.name)}: S/ ${fmt2(value)}</title></rect>`;
    }).join('');
    return `<g>${segments}<text x="${(x + barW / 2).toFixed(2)}" y="${baseY + 20}" text-anchor="middle" class="mgmt-svg-axis">${escapeHtml(MONTHS_SHORT[i] || label)}</text></g>`;
  }).join('');

  return `<svg class="mgmt-chart__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(title || 'Gráfico de barras apiladas')}">
    <title>${escapeHtml(title || chartTitle(cleanSeries))}</title>
    <desc>Evolución mensual de ${escapeHtml(cleanSeries.map((s) => s.name).join(' y '))}.</desc>
    ${grid}
    <line x1="${P.left}" x2="${W - P.right}" y1="${baseY}" y2="${baseY}" class="mgmt-svg-axis-line"/>
    ${bars}
  </svg>`;
}

/**
 * Barras para el costo de planilla y línea para el número de trabajadores.
 */
export function payrollComboChart({ labels, cost, headcount, height = 250 }) {
  const costs = (cost || []).map((v) => Number(v || 0));
  const counts = (headcount || []).map((v) => Number(v || 0));
  const maxCost = Math.max(0, ...costs);
  const maxCount = Math.max(0, ...counts);
  if (!labels?.length || (maxCost === 0 && maxCount === 0)) return emptyChart('Sin planilla registrada en el período');

  const W = 760;
  const H = height;
  const P = { top: 18, right: 48, bottom: 34, left: 62 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;
  const costMax = niceMax(maxCost);
  const countMax = niceMax(Math.max(1, maxCount));
  const groupW = plotW / labels.length;
  const barW = Math.max(5, Math.min(24, groupW * 0.48));
  const baseY = P.top + plotH;
  const yCost = (v) => baseY - (Math.max(0, v) / costMax) * plotH;
  const yCount = (v) => baseY - (Math.max(0, v) / countMax) * plotH;

  const grid = axisTicks(costMax).map((tick) => {
    const y = yCost(tick);
    return `<line x1="${P.left}" x2="${W - P.right}" y1="${y}" y2="${y}" class="mgmt-svg-grid"/>
      <text x="${P.left - 10}" y="${y + 4}" text-anchor="end" class="mgmt-svg-axis">${escapeHtml(compactMoney(tick))}</text>`;
  }).join('');

  const bars = labels.map((label, i) => {
    const x = P.left + i * groupW + (groupW - barW) / 2;
    const y = yCost(costs[i]);
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, baseY - y).toFixed(2)}" rx="2" fill="${CHART_COLORS.payroll}"><title>${escapeHtml(label)} · Planilla: S/ ${fmt2(costs[i])}</title></rect>`;
  }).join('');

  const points = counts.map((v, i) => {
    const x = P.left + i * groupW + groupW / 2;
    const y = yCount(v);
    return { x, y, v, label: labels[i] };
  });
  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const dots = points.map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.2" fill="#fff" stroke="${CHART_COLORS.headcount}" stroke-width="2"><title>${escapeHtml(p.label)} · ${p.v} trabajador(es)</title></circle>`).join('');
  const xLabels = labels.map((label, i) => {
    const x = P.left + i * groupW + groupW / 2;
    return `<text x="${x.toFixed(2)}" y="${baseY + 20}" text-anchor="middle" class="mgmt-svg-axis">${escapeHtml(MONTHS_SHORT[i] || label)}</text>`;
  }).join('');

  const rightTicks = axisTicks(countMax, 2).map((tick) => {
    const y = yCount(tick);
    return `<text x="${W - P.right + 8}" y="${y + 4}" text-anchor="start" class="mgmt-svg-axis">${tick.toFixed(0)}</text>`;
  }).join('');

  return `<svg class="mgmt-chart__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Costo de planilla y número de trabajadores">
    <title>Costo de planilla y número de trabajadores por mes</title>
    <desc>Barras: costo de planilla. Línea: trabajadores activos.</desc>
    ${grid}
    <line x1="${P.left}" x2="${W - P.right}" y1="${baseY}" y2="${baseY}" class="mgmt-svg-axis-line"/>
    ${bars}
    <polyline points="${line}" fill="none" stroke="${CHART_COLORS.headcount}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
    ${rightTicks}
  </svg>`;
}
