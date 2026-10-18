/* ============================================================================
   rentaSimTab.js — Simulador de Renta de 5ª Categoría
   ----------------------------------------------------------------------------
   Permite verificar el cálculo de la planilla: con un sueldo, muestra el
   desglose del impuesto anual (escala por tramos) y la retención mes a mes,
   usando el MISMO motor (payrollService.calcRow + taxService) de la planilla.
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { taxService } from './taxService.js';
import { paramsService } from './paramsService.js';
import { MESES, TASAS, getRmv } from './payrollConfig.js';
import { money, round2 } from './payrollUtils.js';
import { ICONS, escapeHtml } from '../../js/utils.js';

export function renderRentaSimTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let sueldo = 8000;
  let asig = false;

  root.innerHTML = `
    <div class="page-heading" style="padding-bottom:0;">
      <div>
        <h3 class="card__title" style="margin:0;">Simulador de Renta de 5ª Categoría</h3>
        <p class="card__subtitle" style="margin:0;">Verifica el cálculo: usa el mismo motor que la Planilla Mensual.</p>
      </div>
    </div>

    <div class="card">
      <div class="card__body">
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="margin:0;"><label class="form-label">Año</label>
            <select class="form-input" data-year style="max-width:110px;"></select></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Mes</label>
            <select class="form-input" data-month style="max-width:160px;">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Sueldo mensual (S/)</label>
            <input class="form-input" type="number" min="0" step="0.01" data-sueldo value="${sueldo}" style="max-width:150px;" /></div>
          <label class="checkbox" style="margin:0 0 6px;"><input type="checkbox" data-asig /><span class="checkbox__box">${ICONS.check}</span><span>Asignación familiar (10% RMV)</span></label>
        </div>
      </div>
    </div>

    <div data-results></div>
  `;

  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const sueldoI = root.querySelector('[data-sueldo]');
  const asigI = root.querySelector('[data-asig]');
  const results = root.querySelector('[data-results]');

  function fillYears() {
    yearSel.innerHTML = paramsService.availableYears()
      .map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('');
  }

  function simulacion() {
    sueldo = Number(sueldoI.value) || 0;
    asig = asigI.checked;
    if (!(sueldo > 0)) {
      results.innerHTML = `<p class="text-muted">Ingresa un sueldo mensual para simular.</p>`;
      return;
    }

    const emp = { id: 'sim-5ta', baseSalary: sueldo, pensionType: 'ONP', asignacionFamiliar: asig };
    const schedule = [];
    let totalRetenido = 0;
    for (let m = 1; m <= 12; m++) {
      const row = payrollService.calcRow(emp, payrollService.deriveMonthInputs(emp, year, m), year, m);
      schedule.push({ m, remAsegurable: row.remAsegurable, renta5ta: row.renta5ta });
      totalRetenido = round2(totalRetenido + row.renta5ta);
    }

    // Desglose del mes seleccionado (reconstruye los acumulados igual que el motor)
    const sel = schedule[month - 1];
    const remAcum = round2(schedule.slice(0, month - 1).reduce((s, r) => s + r.remAsegurable, 0));
    const gratAcum = month > 7 ? (schedule[6] ? schedule[6].remAsegurable : 0) : 0;
    const gratBase = sel.remAsegurable;
    const gratProyectada = round2(gratBase * (month <= 7 ? 2 : 1));
    const gratTotal = round2(gratAcum + gratProyectada);
    const retAcumPrev = round2(schedule.slice(0, month - 1).reduce((s, r) => s + r.renta5ta, 0));

    const det = taxService.retencionMensual({
      remuneracionMensual: sel.remAsegurable,
      remuneracionesAcumuladas: round2(remAcum + gratAcum),
      mes: month,
      year,
      gratificacionesProyectadas: gratProyectada,
      bonifExtraordinaria: round2(gratTotal * TASAS.essalud),
      retencionesAcumuladas: retAcumPrev,
    });
    const tramos = taxService.detalleImpuestoAnual(det.rni, det.uit);

    const filasTramos = tramos.map((t) => `
      <tr>
        <td>Tramo ${t.tramo}</td>
        <td class="cell-num">${(t.tasa * 100).toFixed(0)}%</td>
        <td class="cell-num">${money(t.base)}</td>
        <td class="cell-num">${money(t.impuesto)}</td>
      </tr>`).join('');

    const filasMeses = schedule.map((r) => `
      <tr${r.m === month ? ' style="background:var(--gold-50, #faf3e0);"' : ''}>
        <td>${MESES[r.m - 1]}${r.m === month ? ' ◀' : ''}</td>
        <td class="cell-num">${money(r.remAsegurable)}</td>
        <td class="cell-num">${money(r.renta5ta)}</td>
      </tr>`).join('');

    const coincide = Math.abs(det.retencionMes - sel.renta5ta) < 0.01;

    results.innerHTML = `
      <div class="card" style="margin-top:var(--space-4);">
        <div class="card__header"><h3 class="card__title">Resumen anual ${year}</h3>
          <span class="badge badge--gold">UIT ${money(det.uit)} · RMV ${money(getRmv(year))}</span>
        </div>
        <div class="card__body">
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-4);">
            ${stat('Renta bruta anual proyectada', det.rentaBruta)}
            ${stat('Deducción (7 UIT)', det.deduccion)}
            ${stat('Renta neta imponible (RNI)', det.rni)}
            ${stat('Impuesto anual proyectado', det.impuestoAnualProyectado)}
            ${stat(`Divisor del mes (${MESES[month - 1]})`, det.divisor, true)}
            ${stat(`Retención de ${MESES[month - 1]}`, det.retencionMes, false, true)}
          </div>
          <p class="form-hint" style="margin-top:var(--space-3);">${coincide
            ? '✅ La retención del mes coincide con la que arroja la Planilla Mensual (mismo motor).'
            : '⚠ La retención no coincide con la planilla: revisa los parámetros.'}</p>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-4);">
        <div class="card__header"><h3 class="card__title">Escala progresiva (Art. 53° LIR)</h3></div>
        <div class="card__body">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Tramo</th><th>Tasa</th><th style="text-align:right;">Base</th><th style="text-align:right;">Impuesto</th></tr></thead>
            <tbody>${filasTramos}</tbody>
            <tfoot><tr><td colspan="3">Total impuesto anual</td><td class="cell-num cell-strong">${money(det.impuestoAnualProyectado)}</td></tr></tfoot>
          </table></div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-4);">
        <div class="card__header"><h3 class="card__title">Retención mes a mes (regularización)</h3></div>
        <div class="card__body">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Mes</th><th style="text-align:right;">Rem. afecta</th><th style="text-align:right;">Renta 5ta</th></tr></thead>
            <tbody>${filasMeses}</tbody>
            <tfoot><tr><td>Total retenido en el año</td><td></td><td class="cell-num cell-strong">${money(totalRetenido)}</td></tr></tfoot>
          </table></div>
          <p class="form-hint" style="margin-top:var(--space-3);">El total del año (${money(totalRetenido)}) debe ser igual al impuesto anual (${money(det.impuestoAnualProyectado)}). ${Math.abs(totalRetenido - det.impuestoAnualProyectado) < 0.01 ? '✅ Cuadra exacto.' : '⚠ Revisar.'}</p>
        </div>
      </div>
    `;
  }

  function stat(label, value, raw = false, strong = false) {
    const txt = raw ? String(value) : money(value);
    return `<div class="card" style="background:var(--surface);border:1px solid var(--border);">
      <div class="card__body" style="padding:var(--space-3);">
        <div class="text-muted" style="font-size:var(--font-size-sm);">${escapeHtml(label)}</div>
        <div style="font-size:1.25rem;${strong ? 'color:var(--primary);' : ''}font-weight:600;">${txt}</div>
      </div></div>`;
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); simulacion(); });
  monthSel.addEventListener('change', () => { month = Number(monthSel.value); simulacion(); });
  sueldoI.addEventListener('input', simulacion);
  asigI.addEventListener('change', simulacion);

  fillYears();
  simulacion();
}
