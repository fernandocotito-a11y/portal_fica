/* ============================================================================
   payrollView.js — Interfaz del módulo de Planillas
   ----------------------------------------------------------------------------
   - Selector de período (Año / Mes).
   - Tabla dinámica de colaboradores con columnas de Ingresos, Retenciones,
     Aportes del empleador y Neto a pagar.
   - Cálculo automático en tiempo real.
   - Alta/edición de colaboradores (modal) y cierre de la planilla mensual.
   ========================================================================== */

import { payrollService, calcRow, sumTotals } from './payrollService.js';
import { MESES, AFP_LIST, TIPOS_DOCUMENTO, REGIMENES_PENSION, getRmv } from './payrollConfig.js';
import { ICONS, escapeHtml, formatDate, showToast, confirmDialog } from '../../js/utils.js';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

function money(n) {
  const v = Number(n) || 0;
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function optionsHtml(list, selected) {
  return list
    .map((o) => {
      const value = typeof o === 'string' ? o : o.value;
      const label = typeof o === 'string' ? o : o.label;
      return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

export default {
  title: 'Planillas (PLAME / T-Registro)',

  render(container) {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    let inputs = {}; // { [empId]: { days, bonuses, vacation, tardanzas, loans, vidaLey } }
    let closed = false;

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Planillas</h2>
          <p class="page-heading__subtitle">Control mensual de remuneraciones, aportes y neto a pagar.</p>
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
            <div class="form-group" style="margin:0;min-width:140px;">
              <label class="form-label">Año</label>
              <select class="form-input" data-year>${optionsHtml(YEARS.map(String), String(year))}</select>
            </div>
            <div class="form-group" style="margin:0;min-width:180px;">
              <label class="form-label">Mes</label>
              <select class="form-input" data-month>${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>
            </div>
            <div class="text-muted" style="font-size:var(--font-size-sm);margin-bottom:6px;" data-summary></div>
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
                  <th colspan="1">Neto</th>
                  <th colspan="1"></th>
                </tr>
                <tr>
                  <th>Código</th><th>Doc.</th><th>Apellidos y nombres</th><th>Inicio</th><th>Cargo</th>
                  <th>Días</th><th>Básico</th><th>Asig. fam.</th><th>Vacac.</th><th>Bonif.</th><th>Total bruto</th>
                  <th>Pensión</th><th>Renta 5ta</th><th>Tard./Faltas</th><th>Prést./Adel.</th><th>Total ret.</th>
                  <th>Essalud 9%</th><th>Vida Ley</th><th>Total aport.</th>
                  <th>Neto a pagar</th><th></th>
                </tr>
              </thead>
              <tbody data-tbody></tbody>
              <tfoot data-tfoot></tfoot>
            </table>
          </div>
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
              <div class="form-group" style="margin:0;">
                <label class="form-label">Código</label>
                <input class="form-input" data-code placeholder="Ej. 001" />
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label">Documento <span class="req">*</span></label>
                <div style="display:flex;gap:var(--space-2);">
                  <select class="form-input" data-doctype style="max-width:110px;">${optionsHtml(TIPOS_DOCUMENTO, 'DNI')}</select>
                  <input class="form-input" data-docnum placeholder="N° de documento" inputmode="numeric" />
                </div>
                <span class="field-error" data-error-doc></span>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Apellidos y nombres <span class="req">*</span></label>
              <input class="form-input" data-name placeholder="Ej. Pérez Gómez, Juan" />
              <span class="field-error" data-error-name></span>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
              <div class="form-group" style="margin:0;">
                <label class="form-label">Fecha de inicio</label>
                <input class="form-input" type="date" data-start />
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label">Cargo</label>
                <input class="form-input" data-position placeholder="Ej. Asistente contable" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Sueldo básico (S/) <span class="req">*</span></label>
              <input class="form-input" type="number" min="0" step="0.01" data-salary placeholder="Ej. 1200.00" />
              <span class="field-error" data-error-salary></span>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
              <div class="form-group" style="margin:0;">
                <label class="form-label">Régimen de pensiones <span class="req">*</span></label>
                <select class="form-input" data-pension>${optionsHtml(REGIMENES_PENSION, 'ONP')}</select>
              </div>
              <div class="form-group" style="margin:0;" data-afp-group>
                <label class="form-label">AFP</label>
                <select class="form-input" data-afp>${optionsHtml(AFP_LIST, 'HABITAT')}</select>
              </div>
            </div>

            <div class="form-group">
              <label class="checkbox">
                <input type="checkbox" data-asig />
                <span class="checkbox__box">${ICONS.check}</span>
                <span>Recibe asignación familiar (10% de la RMV)</span>
              </label>
            </div>

            <div class="form-group" data-active-group hidden style="margin-bottom:0;">
              <label class="checkbox">
                <input type="checkbox" data-active />
                <span class="checkbox__box">${ICONS.check}</span>
                <span>Colaborador activo</span>
              </label>
            </div>
          </div>
          <div class="modal__footer">
            <button type="button" class="btn" data-cancel>Cancelar</button>
            <button type="submit" class="btn btn--primary" data-submit>Guardar</button>
          </div>
        </form>
      </dialog>
    `;

    const tbody = container.querySelector('[data-tbody]');
    const tfoot = container.querySelector('[data-tfoot]');
    const summaryEl = container.querySelector('[data-summary]');
    const yearSel = container.querySelector('[data-year]');
    const monthSel = container.querySelector('[data-month]');
    const closedBadge = container.querySelector('[data-closed]');
    const closeBtn = container.querySelector('[data-close]');
    const addBtn = container.querySelector('[data-add]');
    const modal = container.querySelector('[data-modal]');
    const form = container.querySelector('[data-form]');
    const modalTitle = container.querySelector('[data-modal-title]');
    const codeI = container.querySelector('[data-code]');
    const docTypeI = container.querySelector('[data-doctype]');
    const docNumI = container.querySelector('[data-docnum]');
    const nameI = container.querySelector('[data-name]');
    const startI = container.querySelector('[data-start]');
    const positionI = container.querySelector('[data-position]');
    const salaryI = container.querySelector('[data-salary]');
    const pensionI = container.querySelector('[data-pension]');
    const afpGroup = container.querySelector('[data-afp-group]');
    const afpI = container.querySelector('[data-afp]');
    const asigI = container.querySelector('[data-asig]');
    const activeGroup = container.querySelector('[data-active-group]');
    const activeI = container.querySelector('[data-active]');
    const errName = container.querySelector('[data-error-name]');
    const errSalary = container.querySelector('[data-error-salary]');
    const errDoc = container.querySelector('[data-error-doc]');

    let editingId = null;

    /* --------------------------- Datos / render ------------------------ */
    function employees() {
      return payrollService.listEmployees().filter((e) => e.active !== false);
    }

    function computeAll() {
      return employees().map((emp) => ({
        emp,
        calc: calcRow(emp, inputs[emp.id] || {}, year, month),
      }));
    }

    function val(empId, field, def = 0) {
      const r = inputs[empId] || {};
      return r[field] !== undefined && r[field] !== '' ? r[field] : def;
    }

    function rowHtml(emp, calc) {
      const dis = closed ? 'disabled' : '';
      return `
        <tr data-emp="${escapeHtml(emp.id)}">
          <td>${escapeHtml(emp.code) || '—'}</td>
          <td>${escapeHtml(emp.docType)} ${escapeHtml(emp.docNumber)}</td>
          <td><div class="table__name">${escapeHtml(emp.name)}</div></td>
          <td>${emp.startDate ? escapeHtml(formatDate(emp.startDate)) : '—'}</td>
          <td>${escapeHtml(emp.position) || '—'}</td>
          <td><input class="cell-input" type="number" min="0" max="30" data-input="days" value="${val(emp.id, 'days', 30)}" ${dis} /></td>
          <td class="cell-num" data-cell="basico">${money(calc.basico)}</td>
          <td class="cell-num" data-cell="asigFamiliar">${money(calc.asigFamiliar)}</td>
          <td><input class="cell-input" type="number" min="0" step="0.01" data-input="vacation" value="${val(emp.id, 'vacation')}" ${dis} /></td>
          <td><input class="cell-input" type="number" min="0" step="0.01" data-input="bonuses" value="${val(emp.id, 'bonuses')}" ${dis} /></td>
          <td class="cell-num cell-strong" data-cell="totalBruto">${money(calc.totalBruto)}</td>
          <td class="cell-num" data-cell="pension" title="${escapeHtml(calc.pensionLabel)}">${money(calc.pension)}</td>
          <td class="cell-num" data-cell="renta5ta">${money(calc.renta5ta)}</td>
          <td><input class="cell-input" type="number" min="0" step="0.01" data-input="tardanzas" value="${val(emp.id, 'tardanzas')}" ${dis} /></td>
          <td><input class="cell-input" type="number" min="0" step="0.01" data-input="loans" value="${val(emp.id, 'loans')}" ${dis} /></td>
          <td class="cell-num cell-strong" data-cell="totalRetenciones">${money(calc.totalRetenciones)}</td>
          <td class="cell-num" data-cell="essalud">${money(calc.essalud)}</td>
          <td><input class="cell-input" type="number" min="0" step="0.01" data-input="vidaLey" value="${val(emp.id, 'vidaLey')}" ${dis} /></td>
          <td class="cell-num" data-cell="totalAportes">${money(calc.totalAportes)}</td>
          <td class="cell-num cell-neto" data-cell="neto">${money(calc.neto)}</td>
          <td>
            <div class="table__actions">
              <button type="button" class="icon-btn" data-edit="${escapeHtml(emp.id)}" title="Editar">${ICONS.edit}</button>
              <button type="button" class="icon-btn icon-btn--danger" data-del="${escapeHtml(emp.id)}" title="Eliminar">${ICONS.trash}</button>
            </div>
          </td>
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
          <td></td>
        </tr>`;
    }

    function renderTable() {
      const data = computeAll();
      if (data.length === 0) {
        tbody.innerHTML = `
          <tr><td colspan="21">
            <div class="empty-state">
              <span class="empty-state__icon">${ICONS.users}</span>
              <div class="empty-state__title">Sin colaboradores</div>
              <div class="empty-state__desc">Agrega tu primer colaborador para generar la planilla.</div>
            </div>
          </td></tr>`;
        tfoot.innerHTML = '';
        summaryEl.textContent = '';
        return;
      }
      tbody.innerHTML = data.map(({ emp, calc }) => rowHtml(emp, calc)).join('');
      const totals = sumTotals(data.map((d) => d.calc));
      tfoot.innerHTML = footHtml(totals, data.length);
      summaryEl.textContent = `Neto total a pagar: ${money(totals.neto)}`;
    }

    function setCell(tr, field, value) {
      const el = tr.querySelector(`[data-cell="${field}"]`);
      if (el) el.textContent = value;
    }

    function recalcRow(tr, emp) {
      const calc = calcRow(emp, inputs[emp.id] || {}, year, month);
      [
        'basico', 'asigFamiliar', 'totalBruto', 'pension', 'renta5ta',
        'totalRetenciones', 'essalud', 'totalAportes', 'neto',
      ].forEach((f) => setCell(tr, f, money(calc[f])));
      const pen = tr.querySelector('[data-cell="pension"]');
      if (pen) pen.setAttribute('title', calc.pensionLabel);
      return calc;
    }

    function recalcAll() {
      const data = computeAll();
      const totals = sumTotals(data.map((d) => d.calc));
      Object.keys(totals).forEach((k) => {
        const el = tfoot.querySelector(`[data-total="${k}"]`);
        if (el) el.textContent = money(totals[k]);
      });
      summaryEl.textContent = `Neto total a pagar: ${money(totals.neto)}`;
    }

    function persist() {
      payrollService.savePeriodInputs(year, month, inputs, closed);
    }

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
      inputs = p.rows || {};
      closed = !!p.closed;
      applyClosedState();
      renderTable();
    }

    /* ------------------------- Modal colaborador ----------------------- */
    function updateAfpVisibility() {
      afpGroup.hidden = pensionI.value !== 'AFP';
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
      positionI.value = emp.position || '';
      salaryI.value = emp.baseSalary ?? '';
      pensionI.value = emp.pensionType || 'ONP';
      afpI.value = emp.afp || 'HABITAT';
      asigI.checked = !!emp.asignacionFamiliar;
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
      if (!nameI.value.trim()) {
        errName.textContent = 'El nombre es obligatorio.';
        ok = false;
      }
      if (salaryI.value === '' || Number(salaryI.value) <= 0) {
        errSalary.textContent = 'Ingresa un sueldo básico válido.';
        ok = false;
      }
      return ok;
    }

    /* ------------------------------ Eventos ---------------------------- */
    yearSel.addEventListener('change', () => {
      year = Number(yearSel.value);
      loadPeriod();
    });
    monthSel.addEventListener('change', () => {
      month = Number(monthSel.value);
      loadPeriod();
    });

    addBtn.addEventListener('click', openCreate);
    container.querySelector('[data-close-modal]').addEventListener('click', () => modal.close());
    container.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
    modal.addEventListener('cancel', (e) => {
      e.preventDefault();
      modal.close();
    });
    pensionI.addEventListener('change', updateAfpVisibility);

    form.addEventListener('submit', (e) => {
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
        asignacionFamiliar: asigI.checked,
        active: activeGroup.hidden ? true : activeI.checked,
      };
      try {
        if (editingId) {
          payrollService.updateEmployee(editingId, data);
          showToast('Colaborador actualizado.');
        } else {
          payrollService.createEmployee(data);
          showToast('Colaborador agregado.');
        }
        modal.close();
        renderTable();
        applyClosedState();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Cálculo en tiempo real
    tbody.addEventListener('input', (e) => {
      const input = e.target.closest('[data-input]');
      if (!input || closed) return;
      const tr = input.closest('[data-emp]');
      const empId = tr.dataset.emp;
      const emp = payrollService.getEmployee(empId);
      if (!emp) return;
      inputs[empId] = { ...(inputs[empId] || {}), [input.dataset.input]: input.value };
      recalcRow(tr, emp);
      recalcAll();
      persist();
    });

    tbody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn = e.target.closest('[data-del]');
      if (editBtn) {
        openEdit(editBtn.dataset.edit);
        return;
      }
      if (delBtn) {
        const emp = payrollService.getEmployee(delBtn.dataset.del);
        if (!emp) return;
        const ok = await confirmDialog({
          title: 'Eliminar colaborador',
          message: `¿Eliminar a "${emp.name}"? Esta acción no se puede deshacer.`,
          confirmText: 'Eliminar',
          danger: true,
        });
        if (ok) {
          payrollService.removeEmployee(emp.id);
          showToast('Colaborador eliminado.');
          renderTable();
          applyClosedState();
        }
      }
    });

    closeBtn.addEventListener('click', async () => {
      const data = computeAll();
      if (data.length === 0) {
        showToast('No hay colaboradores para cerrar.', 'error');
        return;
      }
      const totals = sumTotals(data.map((d) => d.calc));
      const ok = await confirmDialog({
        title: 'Cerrar planilla del mes',
        message: `Se cerrará la planilla de ${MESES[month - 1]} ${year} con un neto total de ${money(totals.neto)}. Después no podrás editarla.`,
        confirmText: 'Cerrar planilla',
      });
      if (ok) {
        payrollService.closePeriod(year, month, inputs);
        closed = true;
        applyClosedState();
        showToast('Planilla del mes cerrada.');
      }
    });

    /* ------------------------------ Init ------------------------------- */
    monthSel.value = String(month);
    payrollService.ensureAfpTable();
    loadPeriod();
  },
};
