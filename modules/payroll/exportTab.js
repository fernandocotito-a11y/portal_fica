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

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return escapeHtml(String(iso));
  return `${d}/${m}/${y}`;
}

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
          <p class="card__subtitle">Sueldo, gratificaciones, CTS, pagos, pendiente, vacaciones y asistencias.</p>
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
    const t = s.totals;

    const stat = (value, label) =>
      `<div class="stat-card"><div><div class="stat-card__value" style="font-size:var(--font-size-lg);">${money(value)}</div><div class="stat-card__label">${label}</div></div></div>`;

    const monthRows = s.months
      .map((m) => {
        const sinDatos = m.totalPercibir === 0 && m.abonado === 0;
        const nota = m.futuro
          ? ' <span class="text-muted">(por procesar)</span>'
          : m.cerrada
            ? ' <span class="text-muted">(cerrada)</span>'
            : '';
        const pendStyle = m.pendiente > 0 ? ' style="color:var(--color-warning);"' : '';
        return `<tr${sinDatos ? ' style="opacity:.55"' : ''}>
          <td>${m.name}${nota}</td>
          <td class="cell-num">${money(m.bruto)}</td>
          <td class="cell-num">${money(m.retenciones)}</td>
          <td class="cell-num">${money(m.netoSueldo)}</td>
          <td class="cell-num">${money(m.gratificacion)}</td>
          <td class="cell-num">${money(m.cts)}</td>
          <td class="cell-num cell-strong">${money(m.totalPercibir)}</td>
          <td class="cell-num">${money(m.abonado)}</td>
          <td class="cell-num"${pendStyle}>${money(m.pendiente)}</td>
        </tr>`;
      })
      .join('');

    const monthFoot = `<tfoot><tr>
      <td class="cell-strong">TOTALES</td>
      <td class="cell-num cell-strong">${money(t.bruto)}</td>
      <td class="cell-num cell-strong">${money(t.retenciones)}</td>
      <td class="cell-num cell-strong">${money(t.netoSueldo)}</td>
      <td class="cell-num cell-strong">${money(t.gratificacion)}</td>
      <td class="cell-num cell-strong">${money(t.cts)}</td>
      <td class="cell-num cell-strong">${money(t.totalPercibir)}</td>
      <td class="cell-num cell-strong">${money(t.abonado)}</td>
      <td class="cell-num cell-strong">${money(t.pendiente)}</td>
    </tr></tfoot>`;

    const gratRows = s.gratificaciones.length
      ? s.gratificaciones
          .map(
            (g) => `<tr>
            <td>${g.name} ${s.year}</td>
            <td class="cell-num">${money(g.monto)}</td>
            <td class="cell-num">${money(g.bonificacion)}</td>
            <td class="cell-num cell-strong">${money(g.total)}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="4" class="text-muted">Sin gratificaciones registradas.</td></tr>`;

    const ctsRows = s.ctsDetail.length
      ? s.ctsDetail
          .map(
            (c) => `<tr>
            <td>${c.name} ${s.year}</td>
            <td class="cell-num">${c.dias}</td>
            <td class="cell-num">${money(c.base)}</td>
            <td class="cell-num cell-strong">${money(c.monto)}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="4" class="text-muted">Sin CTS (régimen sin CTS o período aún no cerrado).</td></tr>`;

    const paymentRows = s.payments.length
      ? s.payments
          .map(
            (p) => `<tr>
            <td>${p.name} ${s.year}</td>
            <td>${escapeHtml(p.conceptoLabel)}</td>
            <td>${escapeHtml(p.tipoLabel)}</td>
            <td class="cell-num">${money(p.monto)}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="4" class="text-muted">Sin pagos registrados este año.</td></tr>`;

    const loanRows = s.prestamos.length
      ? s.prestamos
          .map(
            (l) => `<tr>
            <td>${escapeHtml(l.descripcion || 'Préstamo')}</td>
            <td>${l.name} ${l.startYear}</td>
            <td class="cell-num" style="text-align:center;">${l.aplicadas}/${l.total}</td>
            <td class="cell-num">${money(l.cuota)}</td>
            <td class="cell-num cell-strong">${money(l.saldo)}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="5" class="text-muted">Sin préstamos registrados.</td></tr>`;

    const vb = s.vacationBalance;
    const vacRows = s.vacations.length
      ? s.vacations
          .map(
            (v) => `<tr>
            <td>${escapeHtml(v.period || '—')}</td>
            <td class="cell-num">${v.daysTaken}</td>
            <td>${fmtDate(v.dateFrom)}</td>
            <td>${fmtDate(v.dateTo)}</td>
            <td>${escapeHtml(v.note || '')}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="5" class="text-muted">Sin vacaciones registradas en el año.</td></tr>`;

    const at = s.attendanceTotals;
    const attRows = s.attendance.length
      ? s.attendance
          .map(
            (a) => `<tr>
            <td>${fmtDate(a.date)}</td>
            <td>${escapeHtml(a.typeLabel)}</td>
            <td class="cell-num">${a.tardinessMinutes}</td>
            <td>${a.withPay ? 'Sí' : 'No'}</td>
            <td>${escapeHtml(a.note || '')}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="5" class="text-muted">Sin registros de asistencia en el año.</td></tr>`;

    const h4 = 'margin:0 0 var(--space-2);font-size:var(--font-size-md);';
    const grid2 = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:var(--space-4);margin-bottom:var(--space-4);';
    const chip = 'display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2);font-size:var(--font-size-sm);';

    stmtEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3);margin-bottom:var(--space-4);">
        ${stat(t.bruto, 'Bruto anual')}
        ${stat(t.retenciones, 'Retenciones')}
        ${stat(t.netoSueldo, 'Neto sueldo')}
        ${stat(t.gratificacion, 'Gratificaciones')}
        ${stat(t.cts, 'CTS')}
        ${stat(t.totalPercibir, 'Total a percibir')}
        ${stat(t.abonado, 'Abonado')}
        ${stat(t.pendiente, 'Pendiente')}
      </div>

      <h4 style="${h4}">Devengado mensual</h4>
      <div class="table-wrap" style="margin-bottom:var(--space-2);">
        <table class="table" style="min-width:940px;">
          <thead><tr>
            <th>Mes</th>
            <th style="text-align:right;">Bruto</th>
            <th style="text-align:right;">Retenciones</th>
            <th style="text-align:right;">Neto sueldo</th>
            <th style="text-align:right;">Gratif.</th>
            <th style="text-align:right;">CTS</th>
            <th style="text-align:right;">Total a percibir</th>
            <th style="text-align:right;">Abonado</th>
            <th style="text-align:right;">Pendiente</th>
          </tr></thead>
          <tbody>${monthRows}</tbody>
          ${monthFoot}
        </table>
      </div>
      <p class="text-muted" style="font-size:var(--font-size-sm);margin:0 0 var(--space-4);">Neto sueldo = bruto − retenciones (sin descontar adelantos). Total a percibir = neto sueldo + gratificación + CTS. Abonado = pagos registrados en «Pagos y Adelantos». Pendiente = total a percibir − abonado. Los meses futuros aparecen como <strong>(por procesar)</strong>; <strong>(cerrada)</strong> indica que la planilla de ese mes ya se cerró.</p>

      <div style="${grid2}">
        <div>
          <h4 style="${h4}">Gratificaciones</h4>
          <div class="table-wrap"><table class="table" style="min-width:360px;">
            <thead><tr><th>Período</th><th style="text-align:right;">Gratif.</th><th style="text-align:right;">Bono</th><th style="text-align:right;">Total</th></tr></thead>
            <tbody>${gratRows}</tbody>
          </table></div>
        </div>
        <div>
          <h4 style="${h4}">CTS</h4>
          <div class="table-wrap"><table class="table" style="min-width:360px;">
            <thead><tr><th>Período</th><th style="text-align:right;">Días</th><th style="text-align:right;">Base</th><th style="text-align:right;">CTS</th></tr></thead>
            <tbody>${ctsRows}</tbody>
          </table></div>
        </div>
      </div>

      <h4 style="${h4}">Pagos y adelantos registrados</h4>
      <div class="table-wrap" style="margin-bottom:var(--space-4);">
        <table class="table" style="min-width:520px;">
          <thead><tr><th>Mes</th><th>Concepto</th><th>Tipo</th><th style="text-align:right;">Monto</th></tr></thead>
          <tbody>${paymentRows}</tbody>
          <tfoot><tr><td colspan="3" class="cell-strong">TOTAL ABONADO</td><td class="cell-num cell-strong">${money(t.abonado)}</td></tr></tfoot>
        </table>
      </div>

      <div style="${grid2}">
        <div>
          <h4 style="${h4}">Vacaciones</h4>
          <div style="${chip}">
            <span><strong>Base:</strong> ${vb.base} días</span>
            <span><strong>Acumuladas:</strong> ${vb.accrued}</span>
            <span><strong>Gozadas:</strong> ${vb.taken}</span>
            <span><strong>Pendientes:</strong> ${vb.pending}</span>
          </div>
          <div class="table-wrap"><table class="table" style="min-width:520px;">
            <thead><tr><th>Período</th><th style="text-align:right;">Días</th><th>Desde</th><th>Hasta</th><th>Nota</th></tr></thead>
            <tbody>${vacRows}</tbody>
          </table></div>
        </div>
        <div>
          <h4 style="${h4}">Préstamos</h4>
          <div class="table-wrap"><table class="table" style="min-width:520px;">
            <thead><tr><th>Descripción</th><th>Inicio</th><th style="text-align:center;">Cuotas</th><th style="text-align:right;">Cuota</th><th style="text-align:right;">Saldo</th></tr></thead>
            <tbody>${loanRows}</tbody>
            <tfoot><tr><td colspan="4" class="cell-strong">SALDO TOTAL</td><td class="cell-num cell-strong">${money(s.prestamosSaldo)}</td></tr></tfoot>
          </table></div>
        </div>
      </div>

      <h4 style="${h4}">Asistencias</h4>
      <div style="${chip}">
        <span><strong>Tardanzas:</strong> ${at.tardinessMinutes} min (${money(at.tardinessDiscount)})</span>
        <span><strong>Faltas con goce:</strong> ${at.absentWithPay}</span>
        <span><strong>Faltas sin goce:</strong> ${at.absentWithoutPay} (${money(at.absenceDiscount)})</span>
        <span><strong>Descuento total:</strong> ${money(at.totalDiscount)}</span>
      </div>
      <div class="table-wrap">
        <table class="table" style="min-width:520px;">
          <thead><tr><th>Fecha</th><th>Tipo</th><th style="text-align:right;">Min. tardanza</th><th>Con goce</th><th>Nota</th></tr></thead>
          <tbody>${attRows}</tbody>
        </table>
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
