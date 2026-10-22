/* ============================================================================
   vacationTab.js — Control de vacaciones + impacto en planilla
   ----------------------------------------------------------------------------
   · Período (récord vacacional) elegido de una lista generada desde el ingreso.
   · Días calculados automáticamente desde el rango de fechas (enteros).
   · Acumulado entero: años completos (30/15) + adelanto a los 6 meses (15/7).
   · Vista del impacto por mes: remuneración vacacional + básico del mes, para
     que la planilla refleje el nuevo bruto cuando el descanso cruza de mes.
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { vacationService } from './vacationService.js';
import { laborRules, MESES } from './payrollConfig.js';
import { money, fmtDate, num, round2 } from './payrollUtils.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

export function renderVacationTab(root) {
  const company = authService.activeCompany ? authService.activeCompany() : null;
  const rules = laborRules(company && company.regimen_laboral);
  let editingId = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Control de vacaciones</h3>
          <p class="card__subtitle">Régimen <strong>${escapeHtml(rules.label)}</strong> · ${rules.vacationDays} días por año completo · adelanto de ${Math.floor(rules.vacationDays / 2)} días a los 6 meses.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--space-3);align-items:end;">
          <div class="form-group" style="margin:0;min-width:200px;"><label class="form-label">Colaborador</label><select class="form-input" data-emp></select></div>
          <div class="form-group" style="margin:0;min-width:220px;"><label class="form-label">Período (récord vacacional)</label><select class="form-input" data-period></select></div>
          <div class="form-group" style="margin:0;min-width:140px;"><label class="form-label">Desde</label><input class="form-input" type="date" data-from /></div>
          <div class="form-group" style="margin:0;min-width:140px;"><label class="form-label">Hasta</label><input class="form-input" type="date" data-to /></div>
          <div class="form-group" style="margin:0;min-width:90px;"><label class="form-label">Días</label><input class="form-input" data-days value="0" readonly style="background:#f5efeb;font-weight:700;" /></div>
        </div>
        <p style="font-size:12px;color:#7a726a;margin:var(--space-3) 0 0;">
          El período es el récord vacacional (ej. 2025-2026). Las fechas son las del descanso efectivo y determinan en qué mes(es) se refleja la planilla.
        </p>
        <p style="font-size:12px;color:#3e2723;margin:4px 0 0;font-weight:600;" data-available></p>

        <div data-impact hidden style="margin-top:var(--space-3);padding:12px 14px;background:#faf8f5;border:1px solid #e7e0d8;border-radius:8px;">
          <div style="font-weight:700;color:#3e2723;margin-bottom:6px;">Impacto en planilla (remuneración + vacacional)</div>
          <div data-impact-body style="overflow-x:auto;"></div>
          <p style="font-size:11px;color:#7a726a;margin:6px 0 0;">Vista referencial sin asignación familiar, bonificaciones ni descuentos.</p>
        </div>

        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);flex-wrap:wrap;">
          <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Registrar</button>
          <button type="button" class="btn" data-cancel hidden>Cancelar</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header"><h3 class="card__title">Vacaciones registradas</h3></div>
      <div class="card__body">
        <div class="table-wrap">
          <table class="table" style="min-width:820px;">
            <thead><tr><th>Colaborador</th><th>Período</th><th style="text-align:right;">Días</th><th>Desde</th><th>Hasta</th><th></th></tr></thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header">
        <div>
          <h3 class="card__title">Detalle por período</h3>
          <p class="card__subtitle">Saldo del colaborador seleccionado. El derecho se genera por año completo; a los 6 meses se muestra el adelanto.</p>
        </div>
      </div>
      <div class="card__body">
        <div class="table-wrap">
          <table class="table" style="min-width:860px;">
            <thead><tr><th>Período</th><th>Desde</th><th>Hasta</th><th style="text-align:right;">Derecho</th><th style="text-align:right;">Gozados</th><th style="text-align:right;">Pendiente</th><th>Estado</th></tr></thead>
            <tbody data-detail></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header"><h3 class="card__title">Reporte por colaborador (saldo entero)</h3></div>
      <div class="card__body">
        <div class="table-wrap">
          <table class="table" style="min-width:860px;">
            <thead><tr><th>Colaborador</th><th>Ingreso</th><th style="text-align:right;">Años</th><th>Período actual</th><th style="text-align:right;">Derecho</th><th style="text-align:right;">Gozados</th><th style="text-align:right;">Pendientes</th></tr></thead>
            <tbody data-report></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const empSel = root.querySelector('[data-emp]');
  const periodSel = root.querySelector('[data-period]');
  const fromI = root.querySelector('[data-from]');
  const toI = root.querySelector('[data-to]');
  const daysI = root.querySelector('[data-days]');
  const availableEl = root.querySelector('[data-available]');
  const impact = root.querySelector('[data-impact]');
  const impactBody = root.querySelector('[data-impact-body]');
  const tbody = root.querySelector('[data-tbody]');
  const detail = root.querySelector('[data-detail]');
  const report = root.querySelector('[data-report]');
  const addBtn = root.querySelector('[data-add]');
  const cancelBtn = root.querySelector('[data-cancel]');

  /* ------------------------------------------------------------ utilidades */
  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }

  function selectedEmp() {
    return payrollService.getEmployee(empSel.value);
  }

  function selectedPeriod(emp) {
    const periods = emp ? vacationService.periodsFor(emp) : [];
    return periods.find((p) => p.value === periodSel.value) || null;
  }

  /* -------------------------------------------------------------- períodos */
  function fillPeriods(employeeId, preferred) {
    const emp = employeeId ? payrollService.getEmployee(employeeId) : null;
    const periods = emp ? vacationService.periodsFor(emp) : [];

    if (!periods.length) {
      periodSel.innerHTML = '<option value="">Sin períodos</option>';
      periodSel.disabled = true;
      addBtn.disabled = true;
      fromI.disabled = true;
      toI.disabled = true;
      updateAvailableHint();
      return;
    }

    periodSel.disabled = false;
    addBtn.disabled = false;
    fromI.disabled = false;
    toI.disabled = false;
    periodSel.innerHTML = periods
      .map((p) => `<option value="${p.value}">${p.value} · ${fmtDate(p.start)} – ${fmtDate(p.end)}</option>`)
      .join('');

    // Permitir editar un registro antiguo cuyo período ya no esté en la lista.
    if (preferred && !periods.some((p) => p.value === preferred)) {
      periodSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(preferred)}">${escapeHtml(preferred)}</option>`);
    }

    const current = periods.find((p) => p.current);
    const pick = preferred && [...periodSel.options].some((o) => o.value === preferred)
      ? preferred
      : current
        ? current.value
        : periods[0].value;
    periodSel.value = pick;
    updateDateConstraints();
    updateAvailableHint();
  }

  function updateDateConstraints() {
    const emp = selectedEmp();
    const p = selectedPeriod(emp);
    const min = p ? p.start : '';
    const max = emp && emp.cese ? emp.cese : '';
    fromI.min = min;
    fromI.max = max;
    toI.min = fromI.value && fromI.value > min ? fromI.value : min;
    toI.max = max;
  }

  function updateAvailableHint() {
    const emp = selectedEmp();
    const p = selectedPeriod(emp);
    if (!emp) {
      availableEl.textContent = '';
      return;
    }
    if (!p) {
      availableEl.textContent = 'El colaborador no tiene fecha de ingreso registrada: registra su fecha de ingreso para generar los períodos.';
      return;
    }
    const available = vacationService.availableForPeriod(emp, p.value, rules.vacationDays, editingId);
    const entitlement = vacationService.entitlementFor(p, rules.vacationDays);
    const estado = p.complete
      ? 'período completo'
      : p.current && p.monthsElapsed >= 6
        ? 'período en curso · adelanto habilitado'
        : p.current
          ? 'período en curso · aún sin derecho (faltan 6 meses)'
          : '';
    availableEl.textContent = `Disponible en ${p.value}: ${available} día(s) · Derecho del período: ${entitlement} día(s)${estado ? ` · ${estado}` : ''}${editingId ? ' · incluye el registro en edición' : ''}`;
  }

  /* --------------------------------------------------------------- impacto */
  function updateImpact() {
    const emp = selectedEmp();
    const days = fromI.value && toI.value ? vacationService.daysInRange(fromI.value, toI.value) : 0;
    daysI.value = String(days);

    if (!emp || days <= 0) {
      impact.hidden = true;
      impactBody.innerHTML = '';
      return;
    }

    const split = vacationService.splitByMonth(fromI.value, toI.value);
    const base = num(emp.baseSalary);
    let capped = false;
    const rows = split
      .map((m) => {
        const paidDays = Math.min(30, m.days);
        if (m.days > paidDays) capped = true;
        const vacPay = round2((paidDays * base) / 30);
        const worked = Math.max(0, 30 - paidDays);
        const basico = round2((base * worked) / 30);
        const bruto = round2(vacPay + basico);
        return `<tr>
          <td>${MESES[m.month - 1]} ${m.year}</td>
          <td class="cell-num">${m.days}</td>
          <td class="cell-num">${money(vacPay)}</td>
          <td class="cell-num">${worked}</td>
          <td class="cell-num">${money(basico)}</td>
          <td class="cell-num cell-neto">${money(bruto)}</td>
        </tr>`;
      })
      .join('');

    impactBody.innerHTML = `
      <table class="table" style="min-width:560px;">
        <thead><tr><th>Mes</th><th style="text-align:right;">Días vac.</th><th style="text-align:right;">Rem. vacacional</th><th style="text-align:right;">Días trabajados</th><th style="text-align:right;">Básico</th><th style="text-align:right;">Bruto</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${capped ? '<p style="font-size:11px;color:#7a726a;margin:6px 0 0;">Mes comercial de 30 días: si el descanso cubre todo el mes calendario, se paga como máximo la remuneración mensual.</p>' : ''}`;
    impact.hidden = false;
  }

  /* --------------------------------------------------------------- listado */
  function renderList() {
    const recs = vacationService.list().slice().sort((a, b) => String(b.dateFrom || '').localeCompare(String(a.dateFrom || '')));
    if (recs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin vacaciones registradas.</div></div></td></tr>`;
      return;
    }
    tbody.innerHTML = recs
      .map((r) => {
        const emp = payrollService.getEmployee(r.employeeId);
        return `
          <tr>
            <td>${escapeHtml(emp ? emp.name : '—')}</td>
            <td>${escapeHtml(r.period || '—')}</td>
            <td class="cell-num">${r.daysTaken}</td>
            <td>${r.dateFrom ? fmtDate(r.dateFrom) : '—'}</td>
            <td>${r.dateTo ? fmtDate(r.dateTo) : '—'}</td>
            <td><div class="table__actions"><button class="icon-btn" data-edit="${escapeHtml(r.id)}" title="Editar">${ICONS.edit}</button><button class="icon-btn icon-btn--danger" data-del="${escapeHtml(r.id)}" title="Eliminar">${ICONS.trash}</button></div></td>
          </tr>`;
      })
      .join('');
  }

  /* -------------------------------------------------------- detalle/reporte */
  function renderDetail() {
    const emp = selectedEmp();
    if (!emp) {
      detail.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Selecciona un colaborador.</div></div></td></tr>`;
      return;
    }
    if (!emp.startDate) {
      detail.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">El colaborador no tiene fecha de ingreso registrada.</div></div></td></tr>`;
      return;
    }

    const a = vacationService.accrual(emp.id, rules.vacationDays);
    if (!a.periods.length) {
      detail.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin períodos generados.</div></div></td></tr>`;
      return;
    }

    const rows = a.periods
      .map((p) => {
        const estado = p.complete
          ? 'Completo'
          : p.current
            ? p.monthsElapsed >= 6
              ? 'En curso · adelanto'
              : 'En curso (< 6 meses)'
            : '—';
        const derecho = `${p.entitlement}${p.current && p.entitlement > 0 ? ' (adelanto)' : ''}`;
        return `<tr>
          <td><strong>${p.value}</strong></td>
          <td>${fmtDate(p.start)}</td>
          <td>${fmtDate(p.end)}</td>
          <td class="cell-num">${derecho}</td>
          <td class="cell-num">${p.taken}</td>
          <td class="cell-num cell-neto">${p.pending}</td>
          <td>${estado}</td>
        </tr>`;
      })
      .join('');

    detail.innerHTML = `${rows}
      <tr style="font-weight:700;background:#faf8f5;">
        <td colspan="3">TOTAL</td>
        <td class="cell-num">${a.accrued}</td>
        <td class="cell-num">${a.taken}</td>
        <td class="cell-num">${a.pending}</td>
        <td>Saldo entero</td>
      </tr>`;
  }

  function renderReport() {
    const emps = employees();
    if (emps.length === 0) {
      report.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:var(--space-4);"><div class="empty-state__desc">Sin colaboradores.</div></div></td></tr>`;
      return;
    }
    report.innerHTML = emps
      .map((emp) => {
        const a = vacationService.accrual(emp.id, rules.vacationDays);
        return `
          <tr>
            <td>${escapeHtml(emp.name)}</td>
            <td>${emp.startDate ? fmtDate(emp.startDate) : '—'}</td>
            <td class="cell-num">${a.years}</td>
            <td>${a.current ? a.current.value : '—'}</td>
            <td class="cell-num">${a.accrued}</td>
            <td class="cell-num">${a.taken}</td>
            <td class="cell-num cell-neto">${a.pending}</td>
          </tr>`;
      })
      .join('');
  }

  function render() {
    renderList();
    renderDetail();
    renderReport();
    updateAvailableHint();
  }

  /* ------------------------------------------------------------------ form */
  function resetForm(keepPeriod = true) {
    editingId = null;
    addBtn.innerHTML = `${ICONS.plus} Registrar`;
    cancelBtn.hidden = true;
    fromI.value = '';
    toI.value = '';
    daysI.value = '0';
    impact.hidden = true;
    impactBody.innerHTML = '';
    const keep = keepPeriod ? periodSel.value : '';
    fillPeriods(empSel.value, keep);
  }

  function fillSelectors(includeId = null) {
    const emps = payrollService.listEmployees().filter((e) => e.active !== false || e.id === includeId);
    empSel.innerHTML = emps.length
      ? emps.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.active === false ? ' (inactivo)' : ''}</option>`).join('')
      : '<option value="">Sin colaboradores</option>';
    fillPeriods(includeId || empSel.value);
  }

  function startEdit(id) {
    const r = vacationService.list().find((x) => x.id === id);
    if (!r) return;
    editingId = id;
    addBtn.innerHTML = `${ICONS.check} Guardar cambios`;
    cancelBtn.hidden = false;
    fillSelectors(r.employeeId);
    empSel.value = r.employeeId;
    fillPeriods(r.employeeId, r.period);
    fromI.value = r.dateFrom || '';
    toI.value = r.dateTo || '';
    updateDateConstraints();
    updateImpact();
    updateAvailableHint();
    renderDetail();
  }

  function buildData() {
    const emp = selectedEmp();
    if (!emp) throw new Error('Selecciona un colaborador.');
    const p = selectedPeriod(emp);
    if (!p) throw new Error('Selecciona un período válido.');
    if (!fromI.value || !toI.value) throw new Error('Indica las fechas de inicio y fin.');
    if (toI.value < fromI.value) throw new Error('La fecha final no puede ser anterior a la fecha inicial.');
    if (fromI.value < p.start) throw new Error(`La fecha de inicio no puede ser anterior al período (${fmtDate(p.start)}).`);
    if (emp.cese && toI.value > emp.cese) throw new Error(`Las vacaciones no pueden exceder la fecha de cese (${fmtDate(emp.cese)}).`);

    const days = vacationService.daysInRange(fromI.value, toI.value);
    if (days <= 0) throw new Error('El rango de fechas no genera días de vacaciones.');

    const entitlement = vacationService.entitlementFor(p, rules.vacationDays);
    if (entitlement === 0) {
      throw new Error(`El período ${p.value} aún no genera derecho: se requiere completar el año o, para el adelanto, 6 meses.`);
    }

    const available = vacationService.availableForPeriod(emp, p.value, rules.vacationDays, editingId);
    if (days > available) {
      throw new Error(`El período ${p.value} solo tiene ${available} día(s) disponible(s); estás registrando ${days}.`);
    }

    const balance = vacationService.accrual(emp.id, rules.vacationDays);
    const old = editingId ? vacationService.list().find((r) => r.id === editingId) : null;
    const totalAvailable = balance.pending + (old ? Math.round(num(old.daysTaken)) : 0);
    if (days > totalAvailable) {
      throw new Error(`El saldo total disponible es ${totalAvailable} día(s); estás registrando ${days}.`);
    }

    return {
      employeeId: emp.id,
      period: p.value,
      daysTaken: days,
      dateFrom: fromI.value,
      dateTo: toI.value,
      monthYear: fromI.value.slice(0, 7),
      note: '',
    };
  }

  /* --------------------------------------------------------------- eventos */
  cancelBtn.addEventListener('click', () => resetForm(true));

  empSel.addEventListener('change', () => {
    editingId = null;
    addBtn.innerHTML = `${ICONS.plus} Registrar`;
    cancelBtn.hidden = true;
    fromI.value = '';
    toI.value = '';
    daysI.value = '0';
    impact.hidden = true;
    impactBody.innerHTML = '';
    fillPeriods(empSel.value);
    renderDetail();
  });

  periodSel.addEventListener('change', () => {
    const p = selectedPeriod(selectedEmp());
    if (p) {
      if (fromI.value && fromI.value < p.start) fromI.value = '';
      if (toI.value && fromI.value && toI.value < fromI.value) toI.value = '';
    }
    updateDateConstraints();
    updateImpact();
    updateAvailableHint();
  });

  fromI.addEventListener('change', () => {
    updateDateConstraints();
    updateImpact();
  });

  toI.addEventListener('change', updateImpact);

  addBtn.addEventListener('click', async () => {
    try {
      const data = buildData();
      const keepPeriod = periodSel.value;
      if (editingId) {
        await vacationService.update(editingId, data);
        showToast('Vacaciones actualizadas.');
      } else {
        await vacationService.create(data);
        showToast('Vacaciones registradas.');
      }
      editingId = null;
      fromI.value = '';
      toI.value = '';
      daysI.value = '0';
      impact.hidden = true;
      impactBody.innerHTML = '';
      addBtn.innerHTML = `${ICONS.plus} Registrar`;
      cancelBtn.hidden = true;
      fillPeriods(empSel.value, keepPeriod);
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  tbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (editBtn) {
      startEdit(editBtn.dataset.edit);
      return;
    }
    if (!del) return;
    const ok = await confirmDialog({ title: 'Eliminar vacaciones', message: '¿Eliminar este registro?', confirmText: 'Eliminar', danger: true });
    if (ok) {
      try {
        await vacationService.remove(del.dataset.del);
        showToast('Registro eliminado.');
        if (editingId === del.dataset.del) resetForm(true);
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  fillSelectors();
  render();
}
