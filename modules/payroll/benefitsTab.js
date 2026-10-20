/* ============================================================================
   benefitsTab.js — Vista "Cálculo de CTS y Gratificaciones"
   ========================================================================== */

import { payrollService, inPeriod } from './payrollService.js';
import { benefitsService, BENEFIT_BONOS } from './benefitsService.js';
import { bonusService } from './bonusService.js';
import { pdfReportsService } from './pdfReportsService.js';
import { laborRules, MESES } from './payrollConfig.js';
import { money, num } from './payrollUtils.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const Y = new Date().getFullYear();
const YEARS = [Y - 1, Y, Y + 1];

export function renderBenefitsTab(root) {
  let year = new Date().getFullYear();
  let mesesGrati = 6;
  let diasCts = 180;
  let tipoBono = 'ESSALUD';
  const company = authService.activeCompany ? authService.activeCompany() : null;
  const rules = laborRules(company && company.regimen_laboral);

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">CTS y Gratificaciones</h3>
          <p class="card__subtitle">Régimen <strong>${escapeHtml(rules.label)}</strong> · beneficios ${Math.round(rules.benefitFactor * 100)}%${rules.hasCts ? '' : ' · sin CTS'}.</p>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">
          <button type="button" class="btn btn--primary" data-reg-grati>${ICONS.check} Registrar gratificación</button>
          <button type="button" class="btn" data-reg-cts>${ICONS.arrowRight} Generar boletas CTS</button>
        </div>
      </div>
      <div class="card__body">
        <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4);">
          <div class="form-group" style="margin:0;min-width:110px;"><label class="form-label">Año</label>
            <select class="form-input" data-year>${YEARS.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Meses completos (grati.)</label>
            <input class="form-input" type="number" min="0" max="6" value="${mesesGrati}" data-meses />
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Días computables (CTS)</label>
            <input class="form-input" type="number" min="0" max="180" value="${diasCts}" data-dias />
          </div>
          <div class="form-group" style="margin:0;min-width:150px;"><label class="form-label">Bono extraordinario</label>
            <select class="form-input" data-bono>${BENEFIT_BONOS.map((b) => `<option value="${b.value}">${b.label}</option>`).join('')}</select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:1080px;">
            <thead>
              <tr class="table__group">
                <th colspan="5">Gratificación (julio / diciembre)</th>
                <th colspan="4">CTS (mayo / noviembre)</th>
              </tr>
              <tr>
                <th>Empleado</th><th>Base grati.</th><th>Grati. semestral</th><th>Bono extra.</th><th>Total grati.</th>
                <th>Base CTS</th><th>1/6 gratificación</th><th>Días</th><th>CTS</th>
              </tr>
            </thead>
            <tbody data-tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const tbody = root.querySelector('[data-tbody]');
  const yearSel = root.querySelector('[data-year]');
  const mesesI = root.querySelector('[data-meses]');
  const diasI = root.querySelector('[data-dias]');
  const bonoI = root.querySelector('[data-bono]');
  const regGratiBtn = root.querySelector('[data-reg-grati]');
  const regCtsBtn = root.querySelector('[data-reg-cts]');

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const esMesGrati = currentMonth === 7 || currentMonth === 12;
  const esMesCts = currentMonth === 5 || currentMonth === 11;

  regGratiBtn.disabled = !esMesGrati;
  regGratiBtn.title = esMesGrati
    ? `Registrar la gratificación de ${MESES[currentMonth - 1]} ${currentYear} en la planilla`
    : 'Solo se registra en julio o diciembre (no se permiten cálculos proyectados).';
  regCtsBtn.disabled = !(esMesCts && rules.hasCts);
  regCtsBtn.title = rules.hasCts
    ? (esMesCts ? `Generar las boletas de CTS de ${MESES[currentMonth - 1]} ${currentYear}` : 'Solo se genera en mayo o noviembre.')
    : 'Este régimen no tiene CTS.';

  function render() {
    const emps = payrollService.listEmployees().filter((e) => e.active !== false);
    if (emps.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><span class="empty-state__icon">${ICONS.building}</span><div class="empty-state__title">Sin colaboradores</div><div class="empty-state__desc">Agrega colaboradores para calcular beneficios.</div></div></td></tr>`;
      return;
    }
    tbody.innerHTML = emps
      .map((emp) => {
        const g = benefitsService.calcGratificacion(emp, { year, mesesCompletos: mesesGrati, tipoBono, factor: rules.benefitFactor });
        const c = benefitsService.calcCts(emp, { year, diasComputables: diasCts, factor: rules.benefitFactor, hasCts: rules.hasCts });
        return `
          <tr>
            <td><div class="table__name">${escapeHtml(emp.name)}</div></td>
            <td class="cell-num">${money(g.base)}</td>
            <td class="cell-num">${money(g.monto)}</td>
            <td class="cell-num">${money(g.bonificacion)}</td>
            <td class="cell-num cell-strong">${money(g.total)}</td>
            <td class="cell-num">${money(c.base)}</td>
            <td class="cell-num">${money(c.sexto)}</td>
            <td class="cell-num">${c.diasComputables}</td>
            <td class="cell-num cell-neto">${money(c.monto)}</td>
          </tr>`;
      })
      .join('');
  }

  yearSel.addEventListener('change', () => { year = Number(yearSel.value); render(); });
  mesesI.addEventListener('input', () => { mesesGrati = num(mesesI.value, 6); render(); });
  diasI.addEventListener('input', () => { diasCts = num(diasI.value, 180); render(); });
  bonoI.addEventListener('change', () => { tipoBono = bonoI.value; render(); });

  regGratiBtn.addEventListener('click', async () => {
    if (!esMesGrati) { showToast('La gratificación solo se registra en julio o diciembre.', 'error'); return; }
    const emps = payrollService.listEmployees().filter((e) => e.active !== false && inPeriod(e, currentYear, currentMonth));
    const pendientes = emps.filter((e) => bonusService.sumGratificacion(e.id, currentYear, currentMonth) <= 0);
    if (pendientes.length === 0) { showToast('No hay gratificaciones pendientes de registrar.', 'info'); return; }
    const ok = await confirmDialog({
      title: 'Registrar gratificación',
      message: `Se registrará la gratificación de ${MESES[currentMonth - 1]} ${currentYear} para ${pendientes.length} colaborador(es), y aparecerá en la planilla de ese mes.`,
      confirmText: 'Registrar',
    });
    if (!ok) return;
    try {
      for (const emp of pendientes) {
        const g = benefitsService.calcGratificacion(emp, { year: currentYear, mesesCompletos: mesesGrati, tipoBono, factor: rules.benefitFactor });
        await bonusService.create({ employeeId: emp.id, year: currentYear, month: currentMonth, tipo: 'regular', concepto: 'Gratificación', monto: g.monto });
      }
      showToast(`Gratificación registrada (${pendientes.length} colaborador(es)).`);
    } catch (err) { showToast(err.message, 'error'); }
  });

  regCtsBtn.addEventListener('click', async () => {
    if (!esMesCts) { showToast('Las CTS solo se generan en mayo o noviembre.', 'error'); return; }
    const emps = payrollService.listEmployees().filter((e) => e.active !== false);
    let n = 0;
    try {
      for (const emp of emps) {
        const c = benefitsService.calcCts(emp, { year: currentYear, diasComputables: diasCts, factor: rules.benefitFactor, hasCts: rules.hasCts });
        if (!c.hasCts || c.monto <= 0) continue;
        await pdfReportsService.downloadCtSCertificate(emp, { semestre: `${MESES[currentMonth - 1]} ${currentYear}` }, c, company);
        n += 1;
      }
      showToast(n ? `Se generaron ${n} boleta(s) de CTS.` : 'No hay colaboradores con CTS que generar.', n ? 'success' : 'info');
    } catch (err) { showToast(err.message, 'error'); }
  });

  render();
}
