/* ============================================================================
   liquidationTab.js — Vista "Generador de Liquidaciones (LBS)"
   ----------------------------------------------------------------------------
   Formulario de cese + vista previa de la hoja de liquidación (imprimible/PDF).
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { liquidationService, MOTIVOS_CESE } from './liquidationService.js';
import { money, fmtDate, num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const YEAR = new Date().getFullYear();

function documentHtml(liq) {
  const e = liq.employee;
  const row = (c, v) => `<tr><td>${c}</td><td style="text-align:right;">${money(v)}</td></tr>`;
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;max-width:760px;margin:0 auto;padding:24px;">
      <div style="text-align:center;border-bottom:2px solid #3e2723;padding-bottom:12px;margin-bottom:20px;">
        <h2 style="margin:0;color:#3e2723;">A y F FICA Asociados S.A.C.</h2>
        <p style="margin:4px 0 0;font-size:13px;">Liquidación de Beneficios Sociales</p>
      </div>
      <table style="width:100%;font-size:13px;margin-bottom:16px;">
        <tr><td><strong>Trabajador:</strong> ${escapeHtml(e.name)}</td><td><strong>Documento:</strong> ${escapeHtml(e.docType)} ${escapeHtml(e.docNumber)}</td></tr>
        <tr><td><strong>Cargo:</strong> ${escapeHtml(e.position || '—')}</td><td><strong>Fecha de cese:</strong> ${escapeHtml(liq.fechaCese || '—')}</td></tr>
        <tr><td><strong>Motivo:</strong> ${escapeHtml((MOTIVOS_CESE.find((m) => m.value === liq.motivo) || {}).label || liq.motivo)}</td><td><strong>Sueldo básico:</strong> ${money(liq.basico)}</td></tr>
      </table>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr style="background:#f5efeb;"><th style="text-align:left;padding:8px;border:1px solid #e7e0d8;">Concepto</th><th style="text-align:right;padding:8px;border:1px solid #e7e0d8;">Importe</th></tr></thead>
        <tbody>
          ${row(`CTS trunca (${liq.cts.diasCts} días)`, liq.cts.monto)}
          ${row(`Vacaciones truncas (${liq.vacaciones.diasTruncas} días)`, liq.vacaciones.truncas)}
          ${row(`Vacaciones pendientes (${liq.vacaciones.diasPendientes} días)`, liq.vacaciones.pendientes)}
          ${row(`Gratificación trunca (${liq.gratificacion.mesesGrati} meses)`, liq.gratificacion.monto)}
          ${row(`Bonificación extraordinaria (${(liq.gratificacion.tasaBono * 100).toFixed(2)}%)`, liq.gratificacion.bonoExtra)}
          <tr style="font-weight:700;background:#faf8f5;"><td style="padding:8px;border:1px solid #e7e0d8;">TOTAL BRUTO</td><td style="text-align:right;padding:8px;border:1px solid #e7e0d8;">${money(liq.bruto)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e7e0d8;">(-) ${escapeHtml(liq.deducciones.pensionLabel)}</td><td style="text-align:right;padding:8px;border:1px solid #e7e0d8;">${money(liq.deducciones.pension)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e7e0d8;">(-) Regularización Renta 5ta</td><td style="text-align:right;padding:8px;border:1px solid #e7e0d8;">${money(liq.deducciones.renta5ta)}</td></tr>
          <tr style="font-weight:700;background:#3e2723;color:#fff;"><td style="padding:10px;">NETO A PAGAR</td><td style="text-align:right;padding:10px;">${money(liq.neto)}</td></tr>
        </tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:64px;font-size:12px;">
        <div style="border-top:1px solid #333;width:38%;text-align:center;padding-top:6px;">Empleador</div>
        <div style="border-top:1px solid #333;width:38%;text-align:center;padding-top:6px;">Trabajador</div>
      </div>
      <p style="text-align:center;font-size:11px;color:#7a726a;margin-top:24px;">Generado el ${fmtDate(new Date().toISOString())} · Portal FICA</p>
    </div>`;
}

export function renderLiquidationTab(root) {
  let current = null;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Generador de Liquidaciones (LBS)</h3>
          <p class="card__subtitle">Cese de trabajador: CTS trunca, vacaciones, gratificación y deducciones.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-3);align-items:end;">
          <div class="form-group" style="margin:0;"><label class="form-label">Colaborador</label><select class="form-input" data-employee></select></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Fecha de cese</label><input class="form-input" type="date" data-cese /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Motivo</label><select class="form-input" data-motivo>${MOTIVOS_CESE.map((m) => `<option value="${m.value}">${m.label}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Días CTS trunca</label><input class="form-input" type="number" min="0" max="360" value="180" data-diascts /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Meses grati. (0-6)</label><input class="form-input" type="number" min="0" max="6" value="6" data-meses /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Vacac. truncas (días)</label><input class="form-input" type="number" min="0" value="0" data-vactruncas /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Vacac. pendientes (días)</label><input class="form-input" type="number" min="0" value="0" data-vacpend /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Renta 5ta a regularizar</label><input class="form-input" type="number" min="0" step="0.01" value="0" data-renta /></div>
        </div>
        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
          <button type="button" class="btn btn--primary" data-calc>${ICONS.shield} Calcular liquidación</button>
          <button type="button" class="btn" data-print disabled>${ICONS.arrowRight} Imprimir / PDF</button>
          <button type="button" class="btn btn--gold" data-save disabled>${ICONS.check} Guardar</button>
        </div>
      </div>
    </div>

    <div class="card" data-preview hidden style="margin-top:var(--space-4);">
      <div class="card__header"><h3 class="card__title">Vista previa</h3></div>
      <div class="card__body" data-preview-body></div>
    </div>`;

  const employeeSel = root.querySelector('[data-employee]');
  const ceseI = root.querySelector('[data-cese]');
  const motivoI = root.querySelector('[data-motivo]');
  const diasCtsI = root.querySelector('[data-diascts]');
  const mesesI = root.querySelector('[data-meses]');
  const vacTruncI = root.querySelector('[data-vactruncas]');
  const vacPendI = root.querySelector('[data-vacpend]');
  const rentaI = root.querySelector('[data-renta]');
  const calcBtn = root.querySelector('[data-calc]');
  const printBtn = root.querySelector('[data-print]');
  const saveBtn = root.querySelector('[data-save]');
  const preview = root.querySelector('[data-preview]');
  const previewBody = root.querySelector('[data-preview-body]');

  function fillEmployees() {
    const emps = payrollService.listEmployees().filter((e) => e.active !== false);
    employeeSel.innerHTML = emps.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  }

  function build() {
    const emp = payrollService.getEmployee(employeeSel.value);
    if (!emp) {
      showToast('Selecciona un colaborador.', 'error');
      return null;
    }
    return liquidationService.calcLiquidacion(emp, {
      year: new Date(ceseI.value || Date.now()).getFullYear() || YEAR,
      fechaCese: ceseI.value,
      motivo: motivoI.value,
      diasCts: num(diasCtsI.value),
      mesesGrati: num(mesesI.value),
      vacProporcionales: num(vacTruncI.value),
      vacPendientes: num(vacPendI.value),
      renta5taRegularizacion: num(rentaI.value),
    });
  }

  calcBtn.addEventListener('click', () => {
    const liq = build();
    if (!liq) return;
    current = liq;
    preview.hidden = false;
    previewBody.innerHTML = documentHtml(liq);
    printBtn.disabled = false;
    saveBtn.disabled = false;
    showToast('Liquidación calculada.');
  });

  printBtn.addEventListener('click', () => {
    if (!current) return;
    const w = window.open('', '_blank');
    if (!w) {
      showToast('Permite las ventanas emergentes para imprimir.', 'error');
      return;
    }
    w.document.write(`<html><head><title>Liquidación</title></head><body>${documentHtml(current)}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  });

  saveBtn.addEventListener('click', async () => {
    if (!current) return;
    try {
      await liquidationService.save({
        employeeId: current.employee.id,
        employeeName: current.employee.name,
        fechaCese: current.fechaCese,
        motivo: current.motivo,
        neto: current.neto,
        bruto: current.bruto,
      });
      showToast('Liquidación guardada en el historial.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  fillEmployees();
}
