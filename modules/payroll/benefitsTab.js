/* ============================================================================
   benefitsTab.js — CTS y Gratificaciones (cálculo automático por período)
   ----------------------------------------------------------------------------
   - Gratificación (julio / diciembre): meses según fecha de inicio, bono
     automático (EsSalud 9% / EPS 6.75%). Se registra y guarda en la planilla.
   - CTS (mayo / noviembre): solo régimen general. Tiene su propia planilla
     (boletas de depósito). Días = 180 − inasistencias/faltas/permisos sin goce.
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
const YEARS = [Y - 2, Y - 1, Y, Y + 1];

export function renderBenefitsTab(root) {
  let year = new Date().getFullYear();
  const company = authService.activeCompany ? authService.activeCompany() : null;
  const rules = laborRules(company && company.regimen_laboral);

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Gratificaciones</h3>
          <p class="card__subtitle">Meses según fecha de inicio · bono EsSalud/EPS · régimen <strong>${escapeHtml(rules.label)}</strong>.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">
          <select class="form-input" data-year style="max-width:110px;">${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          <select class="form-input" data-semestre style="max-width:150px;">
            <option value="julio">Julio (ene–jun)</option>
            <option value="diciembre">Diciembre (jul–dic)</option>
          </select>
          <button type="button" class="btn btn--primary" data-reg-grati>${ICONS.check} Registrar gratificación</button>
        </div>
      </div>
      <div class="card__body">
        <div class="table-wrap"><table class="table" style="min-width:900px;">
          <thead>
            <tr class="table__group"><th colspan="2"></th><th colspan="4">Julio (enero–junio)</th><th colspan="4">Diciembre (julio–diciembre)</th></tr>
            <tr><th>Empleado</th><th>Base</th><th>Meses</th><th>Gratif.</th><th>Bono</th><th>Total</th><th>Meses</th><th>Gratif.</th><th>Bono</th><th>Total</th></tr>
          </thead>
          <tbody data-grati-tbody></tbody>
        </table></div>
      </div>
    </div>

    ${rules.hasCts ? `
    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header">
        <div>
          <h3 class="card__title">CTS</h3>
          <p class="card__subtitle">Días computables = 180 − inasistencias, faltas o permisos sin goce de haber.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">
          <select class="form-input" data-periodo-cts style="max-width:170px;">
            <option value="mayo">Mayo (nov–abr)</option>
            <option value="noviembre">Noviembre (may–oct)</option>
          </select>
          <button type="button" class="btn" data-reg-cts>${ICONS.arrowRight} Generar boletas CTS</button>
        </div>
      </div>
      <div class="card__body">
        <div class="table-wrap"><table class="table" style="min-width:760px;">
          <thead><tr><th>Empleado</th><th>Base CTS</th><th>Días May</th><th>CTS May</th><th>Días Nov</th><th>CTS Nov</th></tr></thead>
          <tbody data-cts-tbody></tbody>
        </table></div>
      </div>
    </div>` : ''}`;

  const yearSel = root.querySelector('[data-year]');
  const semestreSel = root.querySelector('[data-semestre]');
  const gratiTbody = root.querySelector('[data-grati-tbody]');
  const regGratiBtn = root.querySelector('[data-reg-grati]');
  const regCtsBtn = root.querySelector('[data-reg-cts]');
  const ctsTbody = root.querySelector('[data-cts-tbody]');
  const ctsPeriodoSel = root.querySelector('[data-periodo-cts]');

  regGratiBtn.disabled = rules.benefitFactor <= 0;
  if (rules.benefitFactor <= 0) regGratiBtn.title = 'Este régimen no tiene gratificación.';

  function employees() {
    return payrollService.listEmployees().filter((e) => e.active !== false);
  }

  function render() {
    const emps = employees();
    if (emps.length === 0) {
      gratiTbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin colaboradores</div></div></td></tr>`;
      if (ctsTbody) ctsTbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin colaboradores</div></div></td></tr>`;
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

    if (ctsTbody) {
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
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); render(); });

  regGratiBtn.addEventListener('click', async () => {
    const semestre = semestreSel.value;
    const mes = semestre === 'julio' ? 7 : 12;
    const emps = employees().filter((e) => inPeriod(e, year, mes));
    const pendientes = emps.filter((e) => bonusService.sumGratificacion(e.id, year, mes) <= 0);
    if (pendientes.length === 0) { showToast('No hay gratificaciones pendientes de registrar.', 'info'); return; }
    const ok = await confirmDialog({
      title: 'Registrar gratificación',
      message: `Se registrará la gratificación de ${semestre === 'julio' ? 'Julio' : 'Diciembre'} ${year} para ${pendientes.length} colaborador(es), y quedará guardada en la planilla de ese mes.`,
      confirmText: 'Registrar',
    });
    if (!ok) return;
    try {
      for (const emp of pendientes) {
        const g = benefitsService.calcGratificacion(emp, { year, semestre, factor: rules.benefitFactor });
        await bonusService.create({ employeeId: emp.id, year, month: mes, tipo: 'regular', concepto: 'Gratificación', monto: g.monto });
      }
      showToast(`Gratificación de ${semestre === 'julio' ? 'Julio' : 'Diciembre'} ${year} registrada (${pendientes.length} colaborador(es)).`);
    } catch (err) { showToast(err.message, 'error'); }
  });

  if (regCtsBtn) {
    regCtsBtn.addEventListener('click', async () => {
      const periodo = ctsPeriodoSel.value;
      const emps = employees();
      let n = 0;
      try {
        for (const emp of emps) {
          const c = benefitsService.calcCts(emp, { year, periodo, factor: rules.benefitFactor, hasCts: rules.hasCts });
          if (!c.hasCts || c.monto <= 0) continue;
          await pdfReportsService.downloadCtSCertificate(emp, { semestre: `${MESES[periodo === 'mayo' ? 4 : 10]} ${year}` }, c, company);
          n += 1;
        }
        showToast(n ? `Se generaron ${n} boleta(s) de CTS.` : 'No hay colaboradores con CTS que generar.', n ? 'success' : 'info');
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  render();
}
