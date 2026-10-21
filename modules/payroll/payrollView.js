/* ============================================================================
   payrollView.js — Contenedor del módulo de Planillas (con pestañas)
   ----------------------------------------------------------------------------
   Pestañas:
     1. Planilla Mensual           (Cálculo de remuneraciones)
     2. Asistencias y Tardanzas    (attendanceTab)
     3. CTS y Gratificaciones      (benefitsTab)
     4. Liquidaciones (LBS)        (liquidationTab)
   ========================================================================== */

import { payrollService, calcRow, sumTotals, inPeriod } from './payrollService.js';
import { attendanceService } from './attendanceService.js';
import { vacationService } from './vacationService.js';
import { liquidationService } from './liquidationService.js';
import { taxSummaryService } from './taxSummaryService.js';
import { bonusService } from './bonusService.js';
import { paymentService } from './paymentService.js';
import { gratificacionService } from './gratificacionService.js';
import { MESES, AFP_LIST, TIPOS_DOCUMENTO, REGIMENES_PENSION, COMMISSION_TYPES, laborRules } from './payrollConfig.js';
import { money, round2 } from './payrollUtils.js';
import { renderAttendanceTab } from './attendanceTab.js';
import { renderVacationTab } from './vacationTab.js';
import { renderBonusesTab } from './bonusesTab.js';
import { renderPaymentsTab } from './paymentsTab.js';
import { renderBenefitsTab } from './benefitsTab.js';
import { renderLiquidationTab } from './liquidationTab.js';
import { renderExportTab } from './exportTab.js';
import { renderAuditTab } from './auditTab.js';
import { renderAfpTab } from './afpTab.js';
import { afpRatesService } from './afpRatesService.js';
import { paramsService } from './paramsService.js';
import { renderRentaSimTab } from './rentaSimTab.js';
import { renderParamsTab } from './paramsTab.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

function optionsHtml(list, selected) {
  return list
    .map((o) => {
      const value = typeof o === 'string' ? o : o.value;
      const label = typeof o === 'string' ? o : o.label;
      return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

/* ========================================================================== */
/*  Pestaña 1 — Planilla Mensual                                              */
/* ========================================================================== */
function renderPlanillaTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let inputs = {};
  let closed = false;
  let editingId = null;
  let showAll = false;
  const years = paramsService.availableYears();

  root.innerHTML = `
    <div class="page-heading">
      <div>
        <h2 class="page-heading__title">Planilla Mensual</h2>
        <p class="page-heading__subtitle">Control de remuneraciones, aportes y neto a pagar.</p>
      </div>
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center;">
        <span class="badge badge--muted" data-closed hidden><span class="badge__dot"></span>Planilla cerrada</span>
        <button type="button" class="btn" data-close>${ICONS.check} Cerrar planilla del mes</button>
        <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Nuevo colaborador</button>
      </div>
    </div>

    <div class="card">
      <div class="card__body" style="padding-bottom:var(--space-3);">
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="margin:0;min-width:130px;"><label class="form-label">Año</label>
            <select class="form-input" data-year>${optionsHtml(years.map(String), String(year))}</select></div>
          <div class="form-group" style="margin:0;min-width:170px;"><label class="form-label">Mes</label>
            <select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="text-muted" style="font-size:var(--font-size-sm);margin-bottom:6px;" data-summary></div>
          <label class="checkbox" style="margin:0 0 6px;" title="Listar a todos los colaboradores activos, incluso los que están fuera del período por su fecha de inicio/cese"><input type="checkbox" data-showall /><span class="checkbox__box">${ICONS.check}</span><span>Mostrar todos</span></label>
        </div>
      </div>
      <div class="card__body" style="padding-top:0;">
        <div class="table-wrap">
          <table class="table table--payroll">
            <thead>
              <tr class="table__group">
                <th colspan="5">Datos del colaborador</th>
                <th colspan="6">Ingresos</th>
                <th colspan="5">Retenciones al trabajador</th>
                <th colspan="3">Aportes del empleador</th>
                <th colspan="3">Neto</th>
                <th colspan="1"></th>
              </tr>
              <tr>
                <th>Código</th><th>Doc.</th><th>Apellidos y nombres</th><th>Inicio</th><th>Cargo</th>
                <th>Días</th><th>Básico</th><th>Asig. fam.</th><th>Vacac.</th><th>Bonif.</th><th>Total bruto</th>
                <th>Pensión</th><th>Renta 5ta</th><th>Tard./Faltas</th><th>Prést./Adel.</th><th>Total ret.</th>
                <th>Essalud 9%</th><th>Vida Ley</th><th>Total aport.</th>
                <th>Neto a pagar</th><th>Gratificación</th><th>Neto total a pagar</th><th></th>
              </tr>
            </thead>
            <tbody data-tbody></tbody>
            <tfoot data-tfoot></tfoot>
          </table>
        </div>
        <p class="text-muted" data-period-note style="font-size:var(--font-size-sm);margin-top:var(--space-3);"></p>
      </div>
    </div>

    <dialog class="modal" data-modal>
      <form data-form novalidate>
        <div class="modal__header">
          <h3 class="modal__title" data-modal-title>Nuevo colaborador</h3>
          <button type="button" class="modal__close" data-close-modal aria-label="Cerrar">${ICONS.close}</button>
        </div>
        <div class="modal__body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
            <div class="form-group" style="margin:0;"><label class="form-label">Código</label><input class="form-input" data-code placeholder="Ej. 001" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Documento <span class="req">*</span></label>
              <div style="display:flex;gap:var(--space-2);"><select class="form-input" data-doctype style="max-width:110px;">${optionsHtml(TIPOS_DOCUMENTO, 'DNI')}</select><input class="form-input" data-docnum placeholder="N° de documento" inputmode="numeric" /></div>
              <span class="field-error" data-error-doc></span></div>
          </div>
          <div class="form-group"><label class="form-label">Apellidos y nombres <span class="req">*</span></label><input class="form-input" data-name placeholder="Ej. Pérez Gómez, Juan" /><span class="field-error" data-error-name></span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
            <div class="form-group" style="margin:0;"><label class="form-label">Fecha de inicio</label><input class="form-input" type="date" data-start /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Cargo</label><input class="form-input" data-position placeholder="Ej. Asistente contable" /></div>
          </div>
          <div class="form-group"><label class="form-label">Fecha de cese (si aplica)</label><input class="form-input" type="date" data-cese /></div>
          <div class="form-group"><label class="form-label">Sueldo básico (S/) <span class="req">*</span></label><input class="form-input" type="number" min="0" step="0.01" data-salary placeholder="Ej. 1200.00" /><span class="field-error" data-error-salary></span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
            <div class="form-group" style="margin:0;"><label class="form-label">Régimen de pensiones <span class="req">*</span></label><select class="form-input" data-pension>${optionsHtml(REGIMENES_PENSION, 'ONP')}</select></div>
            <div class="form-group" style="margin:0;" data-afp-group><label class="form-label">AFP</label><select class="form-input" data-afp>${optionsHtml(AFP_LIST, 'HABITAT')}</select></div>
          </div>
          <div class="form-group" data-commission-group><label class="form-label">Tipo de comisión AFP</label><select class="form-input" data-commission>${optionsHtml(COMMISSION_TYPES, 'flujo')}</select></div>
          <div class="form-group"><label class="checkbox"><input type="checkbox" data-asig /><span class="checkbox__box">${ICONS.check}</span><span>Recibe asignación familiar (10% de la RMV)</span></label></div>
          <div class="form-group"><label class="form-label">Salud (para el bono de gratificación)</label>
            <select class="form-input" data-salud>
              <option value="ESSALUD">EsSalud (bono extraordinario 9%)</option>
              <option value="EPS">EPS (bono extraordinario 6.75%)</option>
            </select></div>
          <div class="form-group" data-cuspp-group><label class="form-label">CUSPP (solo AFP)</label><input class="form-input" data-cuspp placeholder="Ej. 123456789012" /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
            <div class="form-group" style="margin:0;"><label class="form-label">Tipo de contrato</label>
              <select class="form-input" data-contract>
                <option value="indeterminado">Plazo indeterminado</option>
                <option value="plazo_fijo">Plazo fijo</option>
                <option value="part_time">Jornada parcial</option>
                <option value="locacion">Locación de servicios</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;" data-contract-end-group><label class="form-label">Fin de contrato</label><input class="form-input" type="date" data-contractend /></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
            <div class="form-group" style="margin:0;"><label class="form-label">Banco</label><input class="form-input" data-bank placeholder="Ej. BCP" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">N° de cuenta</label><input class="form-input" data-bankacc placeholder="N° de cuenta" /></div>
          </div>
          <div class="form-group"><label class="form-label">CCI interbancario (20 dígitos)</label><input class="form-input" maxlength="20" inputmode="numeric" data-bankcci placeholder="CCI" /></div>
          <div class="form-group" data-active-group hidden style="margin-bottom:0;"><label class="checkbox"><input type="checkbox" data-active /><span class="checkbox__box">${ICONS.check}</span><span>Colaborador activo</span></label></div>
        </div>
        <div class="modal__footer">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn--primary" data-submit>Guardar</button>
        </div>
      </form>
    </dialog>
  `;

  const tbody = root.querySelector('[data-tbody]');
  const tfoot = root.querySelector('[data-tfoot]');
  const summaryEl = root.querySelector('[data-summary]');
  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const closedBadge = root.querySelector('[data-closed]');
  const closeBtn = root.querySelector('[data-close]');
  const addBtn = root.querySelector('[data-add]');
  const modal = root.querySelector('[data-modal]');
  const form = root.querySelector('[data-form]');
  const modalTitle = root.querySelector('[data-modal-title]');
  const codeI = root.querySelector('[data-code]');
  const docTypeI = root.querySelector('[data-doctype]');
  const docNumI = root.querySelector('[data-docnum]');
  const nameI = root.querySelector('[data-name]');
  const startI = root.querySelector('[data-start]');
  const ceseI = root.querySelector('[data-cese]');
  const positionI = root.querySelector('[data-position]');
  const salaryI = root.querySelector('[data-salary]');
  const pensionI = root.querySelector('[data-pension]');
  const afpGroup = root.querySelector('[data-afp-group]');
  const afpI = root.querySelector('[data-afp]');
  const asigI = root.querySelector('[data-asig]');
  const saludI = root.querySelector('[data-salud]');
  const activeGroup = root.querySelector('[data-active-group]');
  const activeI = root.querySelector('[data-active]');
  const errName = root.querySelector('[data-error-name]');
  const errSalary = root.querySelector('[data-error-salary]');
  const errDoc = root.querySelector('[data-error-doc]');
  const cusppI = root.querySelector('[data-cuspp]');
  const cusppGroup = root.querySelector('[data-cuspp-group]');
  const commissionI = root.querySelector('[data-commission]');
  const commissionGroup = root.querySelector('[data-commission-group]');
  const contractI = root.querySelector('[data-contract]');
  const contractEndGroup = root.querySelector('[data-contract-end-group]');
  const contractEndI = root.querySelector('[data-contractend]');
  const bankI = root.querySelector('[data-bank]');
  const bankAccI = root.querySelector('[data-bankacc]');
  const bankCciI = root.querySelector('[data-bankcci]');

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }
  function employeesForPeriod() {
    return employees().filter((e) => inPeriod(e, year, month));
  }
  /**
   * Si el período actual no tiene colaboradores, busca el más cercano (pasado o
   * futuro) que sí tenga, para que la planilla nunca se abra vacía por error.
   */
  function pickDefaultPeriod() {
    const all = employees();
    if (all.length === 0 || all.some((e) => inPeriod(e, year, month))) return null;
    for (let i = 1; i <= 24; i += 1) {
      for (const dir of [-1, 1]) {
        const d = new Date(year, month - 1 + dir * i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        if (years.includes(y) && all.some((e) => inPeriod(e, y, m))) return { year: y, month: m };
      }
    }
    return null;
  }
  /** Conceptos del mes (delegado al servicio, que ya regulariza la Renta 5ta). */
  function deriveInputs(emp) {
    return payrollService.deriveMonthInputs(emp, year, month);
  }
  function zeroCalc() {
    return { days: 0, basico: 0, asigFamiliar: 0, vacaciones: 0, bonificaciones: 0, totalBruto: 0, remAsegurable: 0, pension: 0, pensionLabel: '—', renta5ta: 0, tardanzas: 0, prestamos: 0, totalRetenciones: 0, essalud: 0, vidaLey: 0, totalAportes: 0, neto: 0, fueraPeriodo: true };
  }
  function computeAll() {
    const lista = showAll ? employees() : employeesForPeriod();
    return lista.map((emp) => {
      if (!inPeriod(emp, year, month)) return { emp, calc: zeroCalc() };
      try {
        return { emp, calc: calcRow(emp, deriveInputs(emp), year, month) };
      } catch (err) {
        console.error('Error calculando fila de', emp.name, err);
        return { emp, calc: zeroCalc(), error: err.message };
      }
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function rowHtml(emp, calc, error) {
    if (error) {
      return `<tr data-emp="${escapeHtml(emp.id)}"><td colspan="23"><span style="color:#b91c1c;font-size:var(--font-size-sm);">⚠ ${escapeHtml(emp.name)}: ${escapeHtml(error)}</span></td></tr>`;
    }
    const fuera = !!calc.fueraPeriodo;
    const badge = fuera ? ' <span class="badge badge--muted">Fuera de período</span>' : '';
    return `
      <tr data-emp="${escapeHtml(emp.id)}"${fuera ? ' style="opacity:.5"' : ''}>
        <td>${escapeHtml(emp.code) || '—'}</td>
        <td>${escapeHtml(emp.docType)} ${escapeHtml(emp.docNumber)}</td>
        <td><div class="table__name">${escapeHtml(emp.name)}</div></td>
        <td>${fmtDate(emp.startDate)}${badge}</td>
        <td>${escapeHtml(emp.position) || '—'}</td>
        <td class="cell-num" data-cell="days">${calc.days}</td>
        <td class="cell-num" data-cell="basico">${money(calc.basico)}</td>
        <td class="cell-num" data-cell="asigFamiliar">${money(calc.asigFamiliar)}</td>
        <td class="cell-num" data-cell="vacaciones">${money(calc.vacaciones)}</td>
        <td class="cell-num" data-cell="bonificaciones">${money(calc.bonificaciones)}</td>
        <td class="cell-num cell-strong" data-cell="totalBruto">${money(calc.totalBruto)}</td>
        <td class="cell-num" data-cell="pension" title="${escapeHtml(calc.pensionLabel)}">${money(calc.pension)}</td>
        <td class="cell-num" data-cell="renta5ta">${money(calc.renta5ta)}</td>
        <td class="cell-num" data-cell="tardanzas">${money(calc.tardanzas)}</td>
        <td class="cell-num" data-cell="prestamos">${money(calc.prestamos)}</td>
        <td class="cell-num cell-strong" data-cell="totalRetenciones">${money(calc.totalRetenciones)}</td>
        <td class="cell-num" data-cell="essalud">${money(calc.essalud)}</td>
        <td class="cell-num" data-cell="vidaLey">${money(calc.vidaLey)}</td>
        <td class="cell-num" data-cell="totalAportes">${money(calc.totalAportes)}</td>
        <td class="cell-num cell-neto" data-cell="neto">${money(calc.neto)}</td>
        <td class="cell-num" data-cell="gratificacionPagada">${money(calc.gratificacionPagada)}</td>
        <td class="cell-num cell-neto" data-cell="netoTotal">${money(calc.netoTotal)}</td>
        <td><div class="table__actions"><button type="button" class="icon-btn" data-edit="${escapeHtml(emp.id)}" title="Editar">${ICONS.edit}</button><button type="button" class="icon-btn icon-btn--danger" data-del="${escapeHtml(emp.id)}" title="Eliminar">${ICONS.trash}</button></div></td>
      </tr>`;
  }

  function footHtml(totals, count) {
    return `
      <tr>
        <td colspan="5">TOTALES · ${count} colaborador(es)</td>
        <td></td>
        <td class="cell-num" data-total="basico">${money(totals.basico)}</td>
        <td class="cell-num" data-total="asigFamiliar">${money(totals.asigFamiliar)}</td>
        <td class="cell-num" data-total="vacaciones">${money(totals.vacaciones)}</td>
        <td class="cell-num" data-total="bonificaciones">${money(totals.bonificaciones)}</td>
        <td class="cell-num cell-strong" data-total="totalBruto">${money(totals.totalBruto)}</td>
        <td class="cell-num" data-total="pension">${money(totals.pension)}</td>
        <td class="cell-num" data-total="renta5ta">${money(totals.renta5ta)}</td>
        <td class="cell-num" data-total="tardanzas">${money(totals.tardanzas)}</td>
        <td class="cell-num" data-total="prestamos">${money(totals.prestamos)}</td>
        <td class="cell-num cell-strong" data-total="totalRetenciones">${money(totals.totalRetenciones)}</td>
        <td class="cell-num" data-total="essalud">${money(totals.essalud)}</td>
        <td class="cell-num" data-total="vidaLey">${money(totals.vidaLey)}</td>
        <td class="cell-num" data-total="totalAportes">${money(totals.totalAportes)}</td>
        <td class="cell-num cell-neto" data-total="neto">${money(totals.neto)}</td>
        <td class="cell-num" data-total="gratificacionPagada">${money(totals.gratificacionPagada)}</td>
        <td class="cell-num cell-neto" data-total="netoTotal">${money(totals.netoTotal)}</td>
        <td></td>
      </tr>`;
  }

  function renderTable() {
    let all, data;
    try {
      all = employees();
      data = computeAll();
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="23"><div class="empty-state"><span class="empty-state__icon">⚠️</span><div class="empty-state__title">Error al generar la planilla</div><div class="empty-state__desc">${escapeHtml(err.message)}</div></div></td></tr>`;
      tfoot.innerHTML = '';
      summaryEl.textContent = '';
      const n = root.querySelector('[data-period-note]'); if (n) n.textContent = '';
      return;
    }
    const periodNote = root.querySelector('[data-period-note]');
    const visibles = data.filter((d) => !d.calc.fueraPeriodo);
    if (data.length === 0) {
      const detalle = all.length > 0
        ? `<div class="empty-state__title">Sin colaboradores en ${MESES[month - 1]} ${year}</div><div class="empty-state__desc">Hay ${all.length} colaborador(es) registrado(s), pero ninguno está activo en este período (fecha de inicio posterior o cese anterior). Activa “Mostrar todos” o cambia el mes/año.</div>`
        : `<div class="empty-state__title">Sin colaboradores</div><div class="empty-state__desc">Agrega tu primer colaborador para generar la planilla.</div>`;
      tbody.innerHTML = `<tr><td colspan="23"><div class="empty-state"><span class="empty-state__icon">${ICONS.users}</span>${detalle}</div></td></tr>`;
      tfoot.innerHTML = '';
      summaryEl.textContent = '';
      if (periodNote) periodNote.textContent = '';
      return;
    }
    tbody.innerHTML = data.map(({ emp, calc, error }) => rowHtml(emp, calc, error)).join('');
    const totals = sumTotals(visibles.map((d) => d.calc));
    tfoot.innerHTML = footHtml(totals, visibles.length);
    summaryEl.textContent = `Neto total a pagar: ${money(totals.neto)}`;
    if (periodNote) {
      const ocultos = all.length - visibles.length;
      periodNote.textContent = ocultos > 0
        ? `Mostrando ${visibles.length} colaborador(es) activo(s) en ${MESES[month - 1]} ${year}. ${ocultos} fuera del período.`
        : '';
    }
  }

  function setCell(tr, field, value) {
    const el = tr.querySelector(`[data-cell="${field}"]`);
    if (el) el.textContent = value;
  }
  function recalcRow(tr, emp) {
    const calc = calcRow(emp, inputs[emp.id] || {}, year, month);
    ['basico', 'asigFamiliar', 'totalBruto', 'pension', 'renta5ta', 'totalRetenciones', 'essalud', 'totalAportes', 'neto'].forEach((f) => setCell(tr, f, money(calc[f])));
    const pen = tr.querySelector('[data-cell="pension"]');
    if (pen) pen.setAttribute('title', calc.pensionLabel);
  }
  function recalcAll() {
    const data = computeAll().filter((d) => !d.calc.fueraPeriodo);
    const totals = sumTotals(data.map((d) => d.calc));
    Object.keys(totals).forEach((k) => {
      const el = tfoot.querySelector(`[data-total="${k}"]`);
      if (el) el.textContent = money(totals[k]);
    });
    summaryEl.textContent = `Neto total a pagar: ${money(totals.neto)}`;
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      payrollService.savePeriodInputs(year, month, inputs, closed).catch((err) => showToast(err.message, 'error'));
    }, 700);
  }
  let saveTimer = null;
  function applyClosedState() {
    closedBadge.hidden = !closed;
    closeBtn.disabled = closed;
    yearSel.disabled = closed;
    monthSel.disabled = closed;
    addBtn.disabled = closed;
    tbody.querySelectorAll('input,button').forEach((el) => (el.disabled = closed));
  }
  function loadPeriod() {
    const p = payrollService.getPeriodInputs(year, month);
    closed = !!p.closed;
    applyClosedState();
    renderTable();
  }

  function updateAfpVisibility() {
    const isAfp = pensionI.value === 'AFP';
    afpGroup.hidden = !isAfp;
    cusppGroup.hidden = !isAfp;
    commissionGroup.hidden = !isAfp;
  }
  function updateContractVisibility() {
    contractEndGroup.hidden = contractI.value !== 'plazo_fijo';
  }
  function openCreate() {
    editingId = null;
    modalTitle.textContent = 'Nuevo colaborador';
    form.reset();
    errName.textContent = '';
    errSalary.textContent = '';
    errDoc.textContent = '';
    pensionI.value = 'ONP';
    docTypeI.value = 'DNI';
    activeGroup.hidden = true;
    activeI.checked = true;
    cusppI.value = '';
    commissionI.value = 'flujo';
    saludI.value = 'ESSALUD';
    bankI.value = '';
    bankAccI.value = '';
    bankCciI.value = '';
    contractI.value = 'indeterminado';
    contractEndI.value = '';
    updateContractVisibility();
    updateAfpVisibility();
    modal.showModal();
    nameI.focus();
  }
  function openEdit(id) {
    const emp = payrollService.getEmployee(id);
    if (!emp) return;
    editingId = id;
    modalTitle.textContent = 'Editar colaborador';
    errName.textContent = '';
    errSalary.textContent = '';
    errDoc.textContent = '';
    codeI.value = emp.code || '';
    docTypeI.value = emp.docType || 'DNI';
    docNumI.value = emp.docNumber || '';
    nameI.value = emp.name || '';
    startI.value = emp.startDate || '';
    ceseI.value = emp.cese || '';
    positionI.value = emp.position || '';
    salaryI.value = emp.baseSalary ?? '';
    pensionI.value = emp.pensionType || 'ONP';
    afpI.value = emp.afp || 'HABITAT';
    asigI.checked = !!emp.asignacionFamiliar;
    saludI.value = emp.salud || 'ESSALUD';
    cusppI.value = emp.cuspp || '';
    commissionI.value = emp.commissionType || 'flujo';
    bankI.value = emp.bankName || '';
    bankAccI.value = emp.bankAccount || '';
    bankCciI.value = emp.bankCci || '';
    contractI.value = emp.contractType || 'indeterminado';
    contractEndI.value = emp.contractEnd || '';
    updateContractVisibility();
    activeGroup.hidden = false;
    activeI.checked = emp.active !== false;
    updateAfpVisibility();
    modal.showModal();
    nameI.focus();
  }
  function validate() {
    let ok = true;
    errName.textContent = '';
    errSalary.textContent = '';
    errDoc.textContent = '';
    if (!nameI.value.trim()) { errName.textContent = 'El nombre es obligatorio.'; ok = false; }
    if (salaryI.value === '' || Number(salaryI.value) <= 0) { errSalary.textContent = 'Ingresa un sueldo básico válido.'; ok = false; }
    return ok;
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); loadPeriod(); });
  monthSel.addEventListener('change', () => { month = Number(monthSel.value); loadPeriod(); });
  root.querySelector('[data-showall]').addEventListener('change', (e) => { showAll = e.target.checked; renderTable(); });
  addBtn.addEventListener('click', openCreate);
  root.querySelector('[data-close-modal]').addEventListener('click', () => modal.close());
  root.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
  modal.addEventListener('cancel', (e) => { e.preventDefault(); modal.close(); });
  pensionI.addEventListener('change', updateAfpVisibility);
  contractI.addEventListener('change', updateContractVisibility);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const data = {
      code: codeI.value.trim(),
      docType: docTypeI.value,
      docNumber: docNumI.value.trim(),
      name: nameI.value.trim(),
      startDate: startI.value,
      position: positionI.value.trim(),
      baseSalary: Number(salaryI.value),
      pensionType: pensionI.value,
      afp: pensionI.value === 'AFP' ? afpI.value : null,
      cuspp: pensionI.value === 'AFP' ? cusppI.value.trim() : '',
      commissionType: pensionI.value === 'AFP' ? commissionI.value : '',
      bankName: bankI.value.trim(),
      bankAccount: bankAccI.value.trim(),
      bankCci: bankCciI.value.trim(),
      contractType: contractI.value,
      contractEnd: contractI.value === 'plazo_fijo' ? contractEndI.value : '',
      cese: ceseI.value,
      salud: saludI.value,
      asignacionFamiliar: asigI.checked,
      active: activeGroup.hidden ? true : activeI.checked,
    };
    try {
      if (editingId) await payrollService.updateEmployee(editingId, data);
      else await payrollService.createEmployee(data);
      showToast(editingId ? 'Colaborador actualizado.' : 'Colaborador agregado.');
      modal.close();
      renderTable();
      applyClosedState();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Nota: los conceptos de la planilla se calculan automáticamente desde los
  // controles (asistencias, vacaciones, bonificaciones, pagos y adelantos).

  tbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) { openEdit(editBtn.dataset.edit); return; }
    if (delBtn) {
      const emp = payrollService.getEmployee(delBtn.dataset.del);
      if (!emp) return;
      const ok = await confirmDialog({ title: 'Eliminar colaborador', message: `¿Eliminar a "${emp.name}"? Esta acción no se puede deshacer.`, confirmText: 'Eliminar', danger: true });
      if (ok) {
        try {
          await payrollService.removeEmployee(emp.id);
          showToast('Colaborador eliminado.');
        } catch (err) {
          showToast(err.message, 'error');
        }
        renderTable();
        applyClosedState();
      }
    }
  });

  closeBtn.addEventListener('click', async () => {
    const data = computeAll().filter((d) => !d.calc.fueraPeriodo);
    if (data.length === 0) { showToast('No hay colaboradores para cerrar.', 'error'); return; }
    const totals = sumTotals(data.map((d) => d.calc));
    const ok = await confirmDialog({ title: 'Cerrar planilla del mes', message: `Se cerrará la planilla de ${MESES[month - 1]} ${year} con un neto total de ${money(totals.neto)}. Después no podrás editarla.`, confirmText: 'Cerrar planilla' });
    if (ok) {
      try {
        await payrollService.closePeriod(year, month, {});
        closed = true;
        applyClosedState();
        showToast('Planilla del mes cerrada.');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  const mejorPeriodo = pickDefaultPeriod();
  if (mejorPeriodo) {
    year = mejorPeriodo.year;
    month = mejorPeriodo.month;
  }
  yearSel.value = String(year);
  monthSel.value = String(month);
  loadPeriod();
}

/* ========================================================================== */
/*  Contenedor con pestañas                                                   */
/* ========================================================================== */
const TABS = [
  { key: 'planilla', label: 'Planilla Mensual' },
  { key: 'rentasim', label: 'Renta 5ta (Simulador)' },
  { key: 'attendance', label: 'Asistencias y Tardanzas' },
  { key: 'vacation', label: 'Vacaciones' },
  { key: 'bonuses', label: 'Bonificaciones' },
  { key: 'payments', label: 'Pagos y Adelantos' },
  { key: 'benefits', label: 'CTS y Gratificaciones' },
  { key: 'liquidation', label: 'Liquidaciones (LBS)' },
  { key: 'export', label: 'Exportaciones y Reportes' },
  { key: 'audit', label: 'Auditoría y Cierre Contable' },
  { key: 'params', label: 'Parámetros UIT / RMV' },
  { key: 'afp', label: 'Parámetros AFP' },
];

export default {
  title: 'Planillas (PLAME / T-Registro)',

  render(container) {
    container.innerHTML = `
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Planillas</h2>
          <p class="page-heading__subtitle">Remuneraciones, asistencias, beneficios sociales y liquidaciones.</p>
        </div>
        <span class="badge badge--gold"><span class="badge__dot"></span>Módulo activo</span>
      </div>
      <div class="tabs-bar" data-tabs>
        ${TABS.map((t) => `<button type="button" class="tab-btn${t.key === 'planilla' ? ' is-active' : ''}" data-tab="${t.key}">${escapeHtml(t.label)}</button>`).join('')}
      </div>
      <div data-tab-content></div>
    `;

    const content = container.querySelector('[data-tab-content]');
    const tabsBar = container.querySelector('[data-tabs]');

    function show(key) {
      tabsBar.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === key));
      if (key === 'planilla') renderPlanillaTab(content);
      else if (key === 'rentasim') renderRentaSimTab(content);
      else if (key === 'attendance') renderAttendanceTab(content);
      else if (key === 'vacation') renderVacationTab(content);
      else if (key === 'bonuses') renderBonusesTab(content);
      else if (key === 'payments') renderPaymentsTab(content);
      else if (key === 'benefits') renderBenefitsTab(content);
      else if (key === 'liquidation') renderLiquidationTab(content);
      else if (key === 'export') renderExportTab(content);
      else if (key === 'audit') renderAuditTab(content);
      else if (key === 'params') renderParamsTab(content);
      else if (key === 'afp') renderAfpTab(content);
    }

    tabsBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) show(btn.dataset.tab);
    });

    // Carga inicial desde Supabase y render de la primera pestaña.
    (async () => {
      content.innerHTML = '<p class="text-muted" style="padding:var(--space-4);">Cargando planilla…</p>';
      try {
        await Promise.all([
          payrollService.refresh(),
          attendanceService.refresh(),
          vacationService.refresh(),
          liquidationService.refresh(),
          taxSummaryService.refresh(),
          bonusService.refresh(),
          paymentService.refresh(),
          gratificacionService.refresh(),
          afpRatesService.refresh(),
          paramsService.refresh(),
        ]);
        vacationService.setEmployeeGetter((id) => payrollService.getEmployee(id));
      } catch (err) {
        showToast('Error al cargar la planilla: ' + err.message, 'error');
      }
      show('planilla');
    })();
  },
};
