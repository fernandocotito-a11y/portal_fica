/* ============================================================================
   exportTab.js — Vista "Exportaciones y Reportes"
   ----------------------------------------------------------------------------
   - Panel de exportación: PLAME (.rem/.jor), AFPnet (.txt), Banca (.txt),
     Boletas PDF masivas (ZIP).
   - Visor de auditoría: alerta inconsistencias antes de exportar.
   - Estado de cuenta individual por colaborador (histórico anual).
   ========================================================================== */

import { payrollService, calcRow } from './payrollService.js';
import { attendanceService } from './attendanceService.js';
import { accountStatementService } from './accountStatementService.js';
import { sunatExporterService } from './sunatExporterService.js';
import { afpnetExporterService } from './afpnetExporterService.js';
import { bankingService } from './bankingService.js';
import { pdfReportsService } from './pdfReportsService.js';
import { MESES } from './payrollConfig.js';
import { money } from './payrollUtils.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 2, Y - 1, Y, Y + 1];

export function renderExportTab(root) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let useCci = true;
  let stmtEmployeeId = '';
  let stmtYear = now.getFullYear();

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Exportaciones oficiales</h3>
          <p class="card__subtitle">Estructuras planas SUNAT, AFPnet y dispersión bancaria.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;">
          <select class="form-input" data-year style="max-width:110px;">${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          <select class="form-input" data-month style="max-width:150px;">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4);">
          <button type="button" class="btn btn--primary" data-exp="jor">${ICONS.arrowRight} PLAME .jor</button>
          <button type="button" class="btn btn--primary" data-exp="rem">${ICONS.arrowRight} PLAME .rem</button>
          <button type="button" class="btn" data-exp="afpnet">${ICONS.arrowRight} AFPnet .txt</button>
          <button type="button" class="btn" data-exp="bank">${ICONS.arrowRight} TXT bancario (haberes)</button>
          <button type="button" class="btn btn--gold" data-exp="zip">${ICONS.arrowRight} Boletas PDF (ZIP)</button>
          <label class="checkbox" style="align-self:center;">
            <input type="checkbox" data-cci checked />
            <span class="checkbox__box">${ICONS.check}</span>
            <span>Usar CCI interbancario</span>
          </label>
        </div>
        <div style="background:var(--color-cream);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);">
          <strong style="font-size:var(--font-size-sm);">Auditoría previa</strong>
          <div data-audit style="font-size:var(--font-size-sm);margin-top:var(--space-2);"></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header">
        <div>
          <h3 class="card__title">Estado de cuenta del trabajador</h3>
          <p class="card__subtitle">Histórico anual, préstamos, vacaciones e inasistencias.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);">
          <select class="form-input" data-stmt-emp style="min-width:220px;"></select>
          <select class="form-input" data-stmt-year style="max-width:110px;"></select>
          <button type="button" class="btn" data-stmt-pdf>${ICONS.arrowRight} Boleta del período</button>
        </div>
      </div>
      <div class="card__body" data-stmt></div>
    </div>`;

  const yearSel = root.querySelector('[data-year]');
  const monthSel = root.querySelector('[data-month]');
  const cciI = root.querySelector('[data-cci]');
  const auditEl = root.querySelector('[data-audit]');
  const stmtEmp = root.querySelector('[data-stmt-emp]');
  const stmtYearSel = root.querySelector('[data-stmt-year]');
  const stmtEl = root.querySelector('[data-stmt]');
  const period = () => ({ year, month });
  const company = authService.activeCompany ? authService.activeCompany() : null;

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }

  function buildRows() {
    return employees().map((emp) => ({
      employee: emp,
      calc: calcRow(emp, payrollService.deriveMonthInputs(emp, year, month), year, month),
      attendance: attendanceService.summarize(emp.id, year, month, emp.baseSalary),
    }));
  }

  /* ----------------------------- Auditoría ------------------------------ */
  function audit() {
    const rows = buildRows();
    const issues = [];
    if (rows.length === 0) issues.push('No hay colaboradores activos.');
    if (!payrollService.isPeriodClosed(year, month)) issues.push(`La planilla de ${MESES[month - 1]} ${year} aún no está cerrada.`);

    rows.forEach(({ employee }) => {
      if (!employee.docNumber || employee.docNumber.length < 8) issues.push(`${employee.name}: DNI/documento incompleto.`);
      if (employee.pensionType === 'AFP' && !employee.cuspp) issues.push(`${employee.name}: AFP sin CUSPP.`);
      if (!useCci && !employee.bankAccount) issues.push(`${employee.name}: sin cuenta bancaria.`);
      if (useCci && !employee.bankCci) issues.push(`${employee.name}: sin CCI interbancario.`);
    });

    if (issues.length === 0) {
      auditEl.innerHTML = `<span style="color:var(--color-success);">✔ Sin inconsistencias. Todo listo para exportar.</span>`;
    } else {
      auditEl.innerHTML = `<ul style="margin:0;padding-left:18px;color:var(--color-warning);">${issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    }
  }

  /* --------------------------- Estado de cuenta ------------------------- */
  function fillStatementSelectors() {
    stmtEmp.innerHTML = employees()
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`)
      .join('');
    const years = accountStatementService.availableYears();
    stmtYearSel.innerHTML = years.map((y) => `<option value="${y}"${y === stmtYear ? ' selected' : ''}>${y}</option>`).join('');
    stmtEmployeeId = stmtEmp.value || '';
  }

  function renderStatement() {
    if (!stmtEmployeeId) {
      stmtEl.innerHTML = `<p class="text-muted">No hay colaboradores.</p>`;
      return;
    }
    const s = accountStatementService.getStatement(stmtEmployeeId, stmtYear);
    if (!s) {
      stmtEl.innerHTML = `<p class="text-muted">Sin datos.</p>`;
      return;
    }
    const rowsHtml = s.months
      .map(
        (m) => `
        <tr>
          <td>${m.name}${m.abierto ? '' : ' <span class="text-muted">(sin planilla)</span>'}</td>
          <td class="cell-num">${money(m.bruto)}</td>
          <td class="cell-num">${money(m.retenciones)}</td>
          <td class="cell-num cell-strong">${money(m.neto)}</td>
          <td class="cell-num">${money(m.abonado)}</td>
        </tr>`
      )
      .join('');

    const loansHtml = s.loans.length
      ? `<ul style="margin:0;padding-left:18px;">${s.loans.map((l) => `<li>${l.month}: ${money(l.monto)}</li>`).join('')}</ul>`
      : '<span class="text-muted">Sin préstamos/adelantos.</span>';
    const vacHtml = s.vacations.length
      ? `<ul style="margin:0;padding-left:18px;">${s.vacations.map((v) => `<li>${escapeHtml(v.period || '')}: ${v.daysTaken} días (${escapeHtml(v.dateFrom || '')}${v.dateTo ? ' a ' + escapeHtml(v.dateTo) : ''})</li>`).join('')}</ul>`
      : '<span class="text-muted">Sin vacaciones registradas.</span>';
    const attHtml = s.attendance.length
      ? `<span>${s.attendance.length} registro(s) de asistencia este año.</span>`
      : '<span class="text-muted">Sin inasistencias registradas.</span>';

    stmtEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-4);">
        <div class="stat-card"><div><div class="stat-card__value" style="font-size:var(--font-size-lg);">${money(s.totals.totalBruto)}</div><div class="stat-card__label">Bruto anual</div></div></div>
        <div class="stat-card"><div><div class="stat-card__value" style="font-size:var(--font-size-lg);">${money(s.totals.totalRetenciones)}</div><div class="stat-card__label">Retenciones</div></div></div>
        <div class="stat-card"><div><div class="stat-card__value" style="font-size:var(--font-size-lg);">${money(s.totals.totalNeto)}</div><div class="stat-card__label">Neto anual</div></div></div>
        <div class="stat-card"><div><div class="stat-card__value" style="font-size:var(--font-size-lg);">${money(s.totals.totalAbonado)}</div><div class="stat-card__label">Abonado</div></div></div>
      </div>
      <div class="table-wrap" style="margin-bottom:var(--space-4);">
        <table class="table" style="min-width:640px;">
          <thead><tr><th>Mes</th><th style="text-align:right;">Bruto</th><th style="text-align:right;">Retenciones</th><th style="text-align:right;">Neto</th><th style="text-align:right;">Abonado</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--space-4);font-size:var(--font-size-sm);">
        <div><strong>Préstamos / adelantos</strong><br/>${loansHtml}</div>
        <div><strong>Vacaciones</strong><br/>${vacHtml}</div>
        <div><strong>Asistencias</strong><br/>${attHtml}</div>
      </div>`;
  }

  /* ------------------------------ Eventos ------------------------------- */
  yearSel.addEventListener('change', () => { year = Number(yearSel.value); audit(); });
  monthSel.addEventListener('change', () => { month = Number(monthSel.value); audit(); });
  cciI.addEventListener('change', () => { useCci = cciI.checked; audit(); });

  root.querySelectorAll('[data-exp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rows = buildRows();
      if (rows.length === 0) { showToast('No hay colaboradores para exportar.', 'error'); return; }
      const kind = btn.dataset.exp;
      try {
        if (kind === 'jor') { sunatExporterService.downloadJor(rows, period()); showToast('Archivo .jor generado.'); }
        else if (kind === 'rem') { sunatExporterService.downloadRem(rows, period()); showToast('Archivo .rem generado.'); }
        else if (kind === 'afpnet') { const w = afpnetExporterService.download(rows, period()); showToast(w.length ? `AFPnet generado con ${w.length} aviso(s).` : 'AFPnet generado.', w.length ? 'info' : 'success'); }
        else if (kind === 'bank') { const w = bankingService.downloadHaberes(rows, period(), { useCci }); showToast(w.length ? `TXT bancario con ${w.length} aviso(s).` : 'TXT bancario generado.', w.length ? 'info' : 'success'); }
        else if (kind === 'zip') { btn.disabled = true; await pdfReportsService.downloadMassPayslipsZip(rows, period(), company); showToast('Boletas PDF generadas (ZIP).'); btn.disabled = false; }
      } catch (err) {
        showToast('Error al exportar: ' + err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  stmtEmp.addEventListener('change', () => { stmtEmployeeId = stmtEmp.value; renderStatement(); });
  stmtYearSel.addEventListener('change', () => { stmtYear = Number(stmtYearSel.value); renderStatement(); });
  root.querySelector('[data-stmt-pdf]').addEventListener('click', async () => {
    const emp = payrollService.getEmployee(stmtEmployeeId);
    if (!emp) { showToast('Selecciona un colaborador.', 'error'); return; }
    const calc = calcRow(emp, payrollService.deriveMonthInputs(emp, year, month), year, month);
    try {
      await pdfReportsService.downloadPayslip(emp, period(), calc, company);
      showToast('Boleta PDF generada.');
    } catch (err) {
      showToast('Error al generar PDF: ' + err.message, 'error');
    }
  });

  fillStatementSelectors();
  renderStatement();
  audit();
}
