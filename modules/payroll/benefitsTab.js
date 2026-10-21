/* ============================================================================
   benefitsTab.js — CTS y Gratificaciones (cálculo automático por período)
   ----------------------------------------------------------------------------
   - Gratificación (julio / diciembre): meses completos según fecha de inicio,
     bono extraordinario automático (EsSalud 9% / EPS 6.75%).
   - CTS (mayo / noviembre): días computables = 180 − permisos sin goce de haber.
   - Registro en planilla / generación de boletas SOLO dentro del período.
   ========================================================================== */

import { payrollService, inPeriod } from './payrollService.js';
import { benefitsService } from './benefitsService.js';
import { bonusService } from './bonusService.js';
import { pdfReportsService } from './pdfReportsService.js';
import { laborRules, MESES } from './payrollConfig.js';
import { money } from './payrollUtils.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 1, Y, Y + 1];

export function renderBenefitsTab(root) {
  let year = new Date().getFullYear();
  const company = authService.activeCompany ? authService.activeCompany() : null;
  const rules = laborRules(company && company.regimen_laboral);

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Gratificaciones (julio / diciembre)</h3>
          <p class="card__subtitle">Meses completos según fecha de inicio · bono según EsSalud/EPS · régimen ${escapeHtml(rules.label)}.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">
          <select class="form-input" data-year style="max-width:110px;">${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          <button type="button" class="btn btn--primary" data-reg-grati>${ICONS.check} Registrar gratificación</button>
        </div>
      </div>
      <div class="card__body">
        <div class="table-wrap"><table class="table" style="min-width:900px;">
          <thead>
            <tr class="table__group">
              <th colspan="2"></th><th colspan="4">Julio (enero–junio)</th><th colspan="4">Diciembre (julio–diciembre)</th>
            </tr>
            <tr>
              <th>Empleado</th><th>Base</th>
              <th>Meses</th><th>Gratif.</th><th>Bono</th><th>Total</th>
              <th>Meses</th><th>Gratif.</th><th>Bono</th><th>Total</th>
            </tr>
          </thead>
          <tbody data-grati-tbody></tbody>
        </table></div>
      </div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header">
        <div>
          <h3 class="card__title">CTS (mayo / noviembre)</h3>
          <p class="card__subtitle">Días computables = 180 − permisos sin goce de haber${rules.hasCts ? '' : ' · este régimen no tiene CTS'}.</p>
        </div>
        <button type="button" class="btn" data-reg-cts>${ICONS.arrowRight} Generar boletas CTS</button>
      </div>
      <div class="card__body">
        <div class="table-wrap"><table class="table" style="min-width:760px;">
          <thead>
            <tr><th>Empleado</th><th>Base CTS</th><th>Días May</th><th>CTS May</th><th>Días Nov</th><th>CTS Nov</th></tr>
          </thead>
          <tbody data-cts-tbody></tbody>
        </table></div>
      </div>
    </div>`;

  const yearSel = root.querySelector('[data-year]');
  const gratiTbody = root.querySelector('[data-grati-tbody]');
  const ctsTbody = root.querySelector('[data-cts-tbody]');
  const regGratiBtn = root.querySelector('[data-reg-grati]');
  const regCtsBtn = root.querySelector('[data-reg-cts]');

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const esMesGrati = currentMonth === 7 || currentMonth === 12;
  const esMesCts = currentMonth === 5 || currentMonth === 11;
  const semestreActual = currentMonth === 7 ? 'julio' : 'diciembre';
  const periodoActual = currentMonth === 5 ? 'mayo' : 'noviembre';

  regGratiBtn.disabled = !(esMesGrati && rules.benefitFactor > 0);
  regGratiBtn.title = rules.benefitFactor <= 0
    ? 'Este régimen no tiene gratificación.'
    : (esMesGrati ? `Registrar la gratificación de ${MESES[currentMonth - 1]} ${currentYear} en la planilla` : 'Solo se registra en julio o diciembre (no se permiten proyectados).');

  regCtsBtn.disabled = !(esMesCts && rules.hasCts);
  regCtsBtn.title = rules.hasCts
    ? (esMesCts ? `Generar las boletas de CTS de ${MESES[currentMonth - 1]} ${currentYear}` : 'Solo se genera en mayo o noviembre.')
    : 'Este régimen no tiene CTS.';

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }

  function render() {
    const emps = employees();
    if (emps.length === 0) {
      gratiTbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin colaboradores</div></div></td></tr>`;
      ctsTbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin colaboradores</div></div></td></tr>`;
      return;
    }
    gratiTbody.innerHTML = emps.map((emp) => {
      const jul = benefitsService.calcGratificacion(emp, { year, semestre: 'julio', factor: rules.benefitFactor });
      const dic = benefitsService.calcGratificacion(emp, { year, semestre: 'diciembre', factor: rules.benefitFactor });
      return `<tr>
        <td><div class="table__name">${escapeHtml(emp.name)}</div></td>
        <td class="cell-num">${money(jul.base)}</td>
        <td class="cell-num">${jul.mesesCompletos}</td><td class="cell-num">${money(jul.monto)}</td><td class="cell-num">${money(jul.bonificacion)}</td><td class="cell-num cell-strong">${money(jul.total)}</td>
        <td class="cell-num">${dic.mesesCompletos}</td><td class="cell-num">${money(dic.monto)}</td><td class="cell-num">${money(dic.bonificacion)}</td><td class="cell-num cell-strong">${money(dic.total)}</td>
      </tr>`;
    }).join('');

    ctsTbody.innerHTML = emps.map((emp) => {
      const may = benefitsService.calcCts(emp, { year, periodo: 'mayo', factor: rules.benefitFactor, hasCts: rules.hasCts });
      const nov = benefitsService.calcCts(emp, { year, periodo: 'noviembre', factor: rules.benefitFactor, hasCts: rules.hasCts });
      return `<tr>
        <td><div class="table__name">${escapeHtml(emp.name)}</div></td>
        <td class="cell-num">${money(may.base)}</td>
        <td class="cell-num">${may.diasComputables}</td><td class="cell-num cell-neto">${money(may.monto)}</td>
        <td class="cell-num">${nov.diasComputables}</td><td class="cell-num cell-neto">${money(nov.monto)}</td>
      </tr>`;
    }).join('');
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); render(); });

  regGratiBtn.addEventListener('click', async () => {
    if (!esMesGrati) { showToast('La gratificación solo se registra en julio o diciembre.', 'error'); return; }
    const emps = employees().filter((e) => inPeriod(e, currentYear, currentMonth));
    const pendientes = emps.filter((e) => bonusService.sumGratificacion(e.id, currentYear, currentMonth) <= 0);
    if (pendientes.length === 0) { showToast('No hay gratificaciones pendientes de registrar.', 'info'); return; }
    const ok = await confirmDialog({
      title: 'Registrar gratificación',
      message: `Se registrará la gratificación de ${MESES[currentMonth - 1]} ${currentYear} (${semestreActual === 'julio' ? 'enero–junio' : 'julio–diciembre'}) para ${pendientes.length} colaborador(es), y aparecerá en la planilla de ese mes.`,
      confirmText: 'Registrar',
    });
    if (!ok) return;
    try {
      for (const emp of pendientes) {
        const g = benefitsService.calcGratificacion(emp, { year: currentYear, semestre: semestreActual, factor: rules.benefitFactor });
        await bonusService.create({ employeeId: emp.id, year: currentYear, month: currentMonth, tipo: 'regular', concepto: 'Gratificación', monto: g.monto });
      }
      showToast(`Gratificación registrada (${pendientes.length} colaborador(es)).`);
    } catch (err) { showToast(err.message, 'error'); }
  });

  regCtsBtn.addEventListener('click', async () => {
    if (!esMesCts) { showToast('Las CTS solo se generan en mayo o noviembre.', 'error'); return; }
    const emps = employees();
    let n = 0;
    try {
      for (const emp of emps) {
        const c = benefitsService.calcCts(emp, { year: currentYear, periodo: periodoActual, factor: rules.benefitFactor, hasCts: rules.hasCts });
        if (!c.hasCts || c.monto <= 0) continue;
        await pdfReportsService.downloadCtSCertificate(emp, { semestre: `${MESES[currentMonth - 1]} ${currentYear}` }, c, company);
        n += 1;
      }
      showToast(n ? `Se generaron ${n} boleta(s) de CTS.` : 'No hay colaboradores con CTS que generar.', n ? 'success' : 'info');
    } catch (err) { showToast(err.message, 'error'); }
  });

  render();
}
