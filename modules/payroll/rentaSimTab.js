/* ============================================================================
   rentaSimTab.js — Simulador / Verificador de Renta de 5ª Categoría
   ----------------------------------------------------------------------------
   Dos modos:
   - Manual: escribes un sueldo y ves el desglose del impuesto anual.
   - Colaborador: eliges a un trabajador de la planilla y verificas SU Renta 5ª
     (usa sus datos reales: sueldo, asignación familiar, bonos, asistencias).
   Ambos usan el MISMO motor de la Planilla Mensual (calcRow + taxService).
   ========================================================================== */

import { payrollService, calcRow } from './payrollService.js';
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
        <p class="card__subtitle" style="margin:0;">Verifica el cálculo: mismo motor que la Planilla Mensual. Se actualiza solo.</p>
      </div>
    </div>

    <div class="card">
      <div class="card__body">
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="margin:0;"><label class="form-label">Año</label>
            <select class="form-input" data-year style="max-width:110px;"></select></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Mes</label>
            <select class="form-input" data-month style="max-width:160px;">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Verificar colaborador (opcional)</label>
            <select class="form-input" data-empleado style="min-width:230px;"><option value="">— Sueldo manual —</option></select></div>
          <div class="form-group" style="margin:0;" data-manual><label class="form-label">Sueldo mensual (S/)</label>
            <input class="form-input" type="number" min="0" step="0.01" data-sueldo value="${sueldo}" style="max-width:150px;" /></div>
          <label class="checkbox" style="margin:0 0 6px;" data-manual><input type="checkbox" data-asig /><span class="checkbox__box">${ICONS.check}</span><span>Asignación familiar (10% RMV)</span></label>
        </div>
        <p class="form-hint" style="margin-top:var(--space-2);">Elige un colaborador para verificar su Renta 5ª con sus datos reales, o déjalo en “Sueldo manual” y escribe un monto.</p>
      </div>
    </div>

    <div data-results></div>
  `;

  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const empSel = root.querySelector('[data-empleado]');
  const sueldoI = root.querySelector('[data-sueldo]');
  const asigI = root.querySelector('[data-asig]');
  const results = root.querySelector('[data-results]');

  function fillYears() {
    yearSel.innerHTML = paramsService.availableYears()
      .map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('');
  }

  function fillEmpleados() {
    const emps = payrollService.listEmployees().filter((e) => e.active !== false);
    empSel.innerHTML = '<option value="">— Sueldo manual —</option>' +
      emps.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
  }

  function toggleManual(manual) {
    root.querySelectorAll('[data-manual]').forEach((el) => { el.style.display = manual ? '' : 'none'; });
  }

  function currentEmp() {
    if (empSel.value) {
      const e = payrollService.getEmployee(empSel.value);
      if (e) return e;
    }
    return { id: 'sim-5ta', baseSalary: sueldo, pensionType: 'ONP', asignacionFamiliar: asig };
  }

  function simulacion() {
    sueldo = Number(sueldoI.value) || 0;
    asig = asigI.checked;
    const manual = !empSel.value;
    toggleManual(manual);

    if (manual && !(sueldo > 0)) {
      results.innerHTML = `<p class="text-muted">Ingresa un sueldo mensual o elige un colaborador para simular.</p>`;
      return;
    }

    const emp = currentEmp();
    const schedule = [];
    let totalRetenido = 0;
    for (let m = 1; m <= 12; m++) {
      const row = calcRow(emp, payrollService.deriveMonthInputs(emp, year, m), year, m);
      schedule.push({ m, basico: row.basico, asigFamiliar: row.asigFamiliar, vacaciones: row.vacaciones, bonifAfectas: row.bonifAfectas, gratificacion: row.gratificacion, remAsegurable: row.remAsegurable, renta5ta: row.renta5ta, detalle: row.detalle5ta });
      totalRetenido = round2(totalRetenido + row.renta5ta);
    }

    // Desglose del mes seleccionado: lo entrega el propio motor (detalle5ta).
    const sel = schedule[month - 1];
    const det = sel.detalle;
    const tramos = taxService.detalleImpuestoAnual(det.rni, det.uit);

    // Composición de la renta bruta anual (por concepto)
    let salario = 0;
    let vac = 0;
    let bonif = 0;
    for (const r of schedule) {
      salario = round2(salario + r.basico + r.asigFamiliar);
      vac = round2(vac + r.vacaciones);
      bonif = round2(bonif + r.bonifAfectas);
    }
    const gratificaciones = round2(schedule[0].gratificacion * 2); // julio + diciembre
    const bonifExtra = round2(gratificaciones * TASAS.essalud);
    const totalRentaBruta = round2(salario + vac + bonif + gratificaciones + bonifExtra);

    const fuente = manual
      ? `Sueldo manual: ${money(sueldo)}${asig ? ' · con asignación familiar' : ''}`
      : `Colaborador: ${escapeHtml(emp.name || '')} · sueldo ${money(emp.baseSalary)}${emp.asignacionFamiliar ? ' · con asignación familiar' : ''}`;

    const filasTramos = tramos.map((t) => `
      <tr>
        <td>Tramo ${t.tramo}</td>
        <td class="cell-num">${(t.tasa * 100).toFixed(0)}%</td>
        <td class="cell-num">${money(t.base)}</td>
        <td class="cell-num">${money(t.impuesto)}</td>
      </tr>`).join('');

    const filasMeses = schedule.map((r) => `
      <tr${r.m === month ? ' style="background:#faf3e0;"' : ''}>
        <td>${MESES[r.m - 1]}${r.m === month ? ' ◀' : ''}</td>
        <td class="cell-num">${money(r.remAsegurable)}</td>
        <td class="cell-num">${money(r.renta5ta)}</td>
      </tr>`).join('');

    const coincide = Math.abs(det.retencionMes - sel.renta5ta) < 0.01;
    const cuadraAnio = Math.abs(totalRetenido - det.impuestoAnualProyectado) < 0.01;

    results.innerHTML = `
      <div class="card" style="margin-top:var(--space-4);">
        <div class="card__header">
          <div>
            <h3 class="card__title">Resumen ${MESES[month - 1]} ${year}</h3>
            <p class="card__subtitle" style="margin:0;">${fuente}</p>
          </div>
          <span class="badge badge--gold">UIT ${money(det.uit)} · RMV ${money(getRmv(year))}</span>
        </div>
        <div class="card__body">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Composición de la renta bruta anual</th><th style="text-align:right;">Monto (S/)</th></tr></thead>
            <tbody>
              <tr><td>Salario anual (básico + asignación familiar)</td><td class="cell-num">${money(salario)}</td></tr>
              ${vac > 0 ? `<tr><td>Vacaciones</td><td class="cell-num">${money(vac)}</td></tr>` : ''}
              ${bonif > 0 ? `<tr><td>Bonificaciones regulares</td><td class="cell-num">${money(bonif)}</td></tr>` : ''}
              <tr><td>Gratificaciones (julio + diciembre)</td><td class="cell-num">${money(gratificaciones)}</td></tr>
              <tr><td>Bonificación extraordinaria (9%)</td><td class="cell-num">${money(bonifExtra)}</td></tr>
            </tbody>
            <tfoot><tr><td>Renta bruta anual proyectada</td><td class="cell-num cell-strong">${money(totalRentaBruta)}</td></tr></tfoot>
          </table></div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-4);margin-top:var(--space-4);">
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
          <p class="form-hint" style="margin-top:var(--space-3);">El total del año (${money(totalRetenido)}) debe ser igual al impuesto anual (${money(det.impuestoAnualProyectado)}). ${cuadraAnio ? '✅ Cuadra exacto.' : '⚠ Revisar.'}</p>
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
  empSel.addEventListener('change', simulacion);
  sueldoI.addEventListener('input', simulacion);
  asigI.addEventListener('change', simulacion);

  fillYears();
  fillEmpleados();
  simulacion();
}
