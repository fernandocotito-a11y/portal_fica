/* ============================================================================
   liquidationTab.js — Vista "Generador de Liquidaciones (LBS)"
   ----------------------------------------------------------------------------
   Formulario de cese + cálculo AUTOMÁTICO (CTS trunca, vacaciones truncas y
   pendientes, gratificación trunca, bono extraordinario y Renta 5ª) con su
   boleta imprimible/PDF y registro en el historial.
   ========================================================================== */

import { payrollService } from './payrollService.js';
import { liquidationService, MOTIVOS_CESE } from './liquidationService.js';
import { activeCompany } from './payrollScope.js';
import { DEDUCCION_UIT } from './taxService.js';
import { money, fmtDate, num } from './payrollUtils.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDias(v) {
  const n = num(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function motivoLabel(v) {
  return (MOTIVOS_CESE.find((m) => m.value === v) || {}).label || v || '—';
}

function documentHtml(liq, company) {
  const e = liq.employee;
  const row = (c, v) => `<tr><td style="padding:8px;border:1px solid #e7e0d8;">${c}</td><td style="text-align:right;padding:8px;border:1px solid #e7e0d8;">${money(v)}</td></tr>`;
  const factor = liq.laborRules && liq.laborRules.benefitFactor;
  const ctsRow = liq.cts.aplica
    ? row(`CTS trunca — ${escapeHtml(liq.cts.periodo)} (${fmtDias(liq.cts.diasCts)} días)`, liq.cts.monto)
    : row(`CTS trunca — no aplica (${escapeHtml(liq.regimen)})`, 0);
  const gratiRow = factor > 0
    ? row(`Gratificación trunca — ${escapeHtml(liq.gratificacion.semestre)} (${fmtDias(liq.gratificacion.mesesGrati)} meses)`, liq.gratificacion.monto)
    : row(`Gratificación trunca — no aplica (${escapeHtml(liq.regimen)})`, 0);

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;max-width:780px;margin:0 auto;padding:24px;">
      <div style="text-align:center;border-bottom:2px solid #3e2723;padding-bottom:12px;margin-bottom:20px;">
        <h2 style="margin:0;color:#3e2723;">${escapeHtml((company && company.name) || 'Empresa')}</h2>
        <p style="margin:2px 0 0;font-size:12px;color:#7a726a;">RUC: ${escapeHtml((company && company.ruc) || '—')}</p>
        <p style="margin:6px 0 0;font-size:13px;font-weight:600;">Liquidación de Beneficios Sociales</p>
      </div>
      <table style="width:100%;font-size:13px;margin-bottom:16px;">
        <tr><td><strong>Trabajador:</strong> ${escapeHtml(e.name)}</td><td><strong>Documento:</strong> ${escapeHtml(e.docType)} ${escapeHtml(e.docNumber)}</td></tr>
        <tr><td><strong>Cargo:</strong> ${escapeHtml(e.position || '—')}</td><td><strong>Fecha de cese:</strong> ${escapeHtml(liq.fechaCese || '—')}</td></tr>
        <tr><td><strong>Motivo:</strong> ${escapeHtml(motivoLabel(liq.motivo))}</td><td><strong>Régimen:</strong> ${escapeHtml(liq.regimen)}</td></tr>
        <tr><td><strong>Fecha de ingreso:</strong> ${escapeHtml(e.startDate || '—')}</td><td><strong>Sueldo básico:</strong> ${money(liq.basico)}</td></tr>
      </table>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr style="background:#f5efeb;"><th style="text-align:left;padding:8px;border:1px solid #e7e0d8;">Concepto</th><th style="text-align:right;padding:8px;border:1px solid #e7e0d8;">Importe</th></tr></thead>
        <tbody>
          ${ctsRow}
          ${row(`Vacaciones truncas (${fmtDias(liq.vacaciones.diasTruncas)} días)`, liq.vacaciones.truncas)}
          ${row(`Vacaciones pendientes (${fmtDias(liq.vacaciones.diasPendientes)} días)`, liq.vacaciones.pendientes)}
          ${gratiRow}
          ${row(`Bonificación extraordinaria (${(liq.gratificacion.tasaBono * 100).toFixed(2)}%)`, liq.gratificacion.bonoExtra)}
          <tr style="font-weight:700;background:#faf8f5;"><td style="padding:8px;border:1px solid #e7e0d8;">TOTAL BRUTO</td><td style="text-align:right;padding:8px;border:1px solid #e7e0d8;">${money(liq.bruto)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e7e0d8;">(-) ${escapeHtml(liq.deducciones.pensionLabel)}</td><td style="text-align:right;padding:8px;border:1px solid #e7e0d8;">${money(liq.deducciones.pension)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e7e0d8;">(-) Regularización Renta 5ta</td><td style="text-align:right;padding:8px;border:1px solid #e7e0d8;">${money(liq.deducciones.renta5ta)}</td></tr>
          <tr style="font-weight:700;background:#3e2723;color:#fff;"><td style="padding:10px;">NETO A PAGAR</td><td style="text-align:right;padding:10px;">${money(liq.neto)}</td></tr>
        </tbody>
      </table>

      <div style="margin-top:16px;padding:12px 14px;background:#faf8f5;border:1px solid #e7e0d8;border-radius:8px;font-size:12px;">
        <div style="font-weight:700;color:#3e2723;margin-bottom:6px;">Regularización anual de Renta 5ta (enero–cese)</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td>Remuneraciones afectas del ejercicio</td><td style="text-align:right;">${money(liq.rentaDetalle.remuneraciones)}</td></tr>
          <tr><td>Gratificaciones pagadas</td><td style="text-align:right;">${money(liq.rentaDetalle.gratificaciones)}</td></tr>
          <tr><td>Liquidación afecta (vacaciones + gratificación)</td><td style="text-align:right;">${money(liq.rentaDetalle.liquidacionAfecta)}</td></tr>
          <tr style="font-weight:600;"><td>Renta bruta anual</td><td style="text-align:right;">${money(liq.rentaDetalle.rentaBruta)}</td></tr>
          <tr><td>(-) Deducción de ley (${DEDUCCION_UIT} UIT · ${money(liq.rentaDetalle.uit)})</td><td style="text-align:right;">${money(liq.rentaDetalle.deduccion)}</td></tr>
          <tr><td>Renta neta imponible</td><td style="text-align:right;">${money(liq.rentaDetalle.rni)}</td></tr>
          <tr><td>Impuesto anual</td><td style="text-align:right;">${money(liq.rentaDetalle.impuestoAnual)}</td></tr>
          <tr><td>(-) Retenciones acumuladas</td><td style="text-align:right;">${money(liq.rentaDetalle.retencionesAcumuladas)}</td></tr>
          <tr style="font-weight:700;color:#3e2723;"><td>Renta 5ta a regularizar</td><td style="text-align:right;">${money(liq.rentaDetalle.renta5ta)}</td></tr>
        </table>
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:56px;font-size:12px;">
        <div style="border-top:1px solid #333;width:38%;text-align:center;padding-top:6px;">Empleador</div>
        <div style="border-top:1px solid #333;width:38%;text-align:center;padding-top:6px;">Trabajador</div>
      </div>
      <p style="text-align:center;font-size:11px;color:#7a726a;margin-top:24px;">Generado el ${fmtDate(new Date().toISOString())} · Portal FICA</p>
    </div>`;
}

export function renderLiquidationTab(root) {
  let current = null;
  let saved = false;

  root.innerHTML = `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Generador de Liquidaciones (LBS)</h3>
          <p class="card__subtitle">Cálculo automático al cese: CTS trunca, vacaciones truncas y pendientes, gratificación trunca, bono extraordinario y Renta 5ta.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-3);align-items:end;">
          <div class="form-group" style="margin:0;"><label class="form-label">Colaborador</label><select class="form-input" data-employee></select></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Fecha de cese</label><input class="form-input" type="date" data-cese value="${todayISO()}" /></div>
          <div class="form-group" style="margin:0;"><label class="form-label">Motivo</label><select class="form-input" data-motivo>${MOTIVOS_CESE.map((m) => `<option value="${m.value}">${m.label}</option>`).join('')}</select></div>
        </div>
        <p style="font-size:12px;color:#7a726a;margin:var(--space-3) 0 0;">
          Los días de CTS y vacaciones, los meses de gratificación y la Renta 5ta se calculan automáticamente con la fecha de ingreso, las asistencias, las vacaciones y la planilla del año.
        </p>
        <label style="display:flex;align-items:center;gap:8px;margin-top:var(--space-3);font-size:13px;">
          <input type="checkbox" data-mark-cese checked />
          Registrar la fecha de cese en la ficha del colaborador (deja de aparecer en planillas futuras)
        </label>
        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);flex-wrap:wrap;">
          <button type="button" class="btn btn--primary" data-calc>${ICONS.shield} Calcular liquidación</button>
          <button type="button" class="btn" data-print disabled>${ICONS.arrowRight} Imprimir / PDF</button>
          <button type="button" class="btn btn--gold" data-save disabled>${ICONS.check} Guardar</button>
        </div>
      </div>
    </div>

    <div class="card" data-preview hidden style="margin-top:var(--space-4);">
      <div class="card__header"><h3 class="card__title">Vista previa</h3></div>
      <div class="card__body" data-preview-body></div>
    </div>

    <div class="card" style="margin-top:var(--space-4);">
      <div class="card__header"><h3 class="card__title">Liquidaciones registradas</h3></div>
      <div class="card__body" data-history></div>
    </div>`;

  const employeeSel = root.querySelector('[data-employee]');
  const ceseI = root.querySelector('[data-cese]');
  const motivoI = root.querySelector('[data-motivo]');
  const markCeseI = root.querySelector('[data-mark-cese]');
  const calcBtn = root.querySelector('[data-calc]');
  const printBtn = root.querySelector('[data-print]');
  const saveBtn = root.querySelector('[data-save]');
  const preview = root.querySelector('[data-preview]');
  const previewBody = root.querySelector('[data-preview-body]');
  const historyBody = root.querySelector('[data-history]');

  function fillEmployees(preferredId) {
    const keep = preferredId || employeeSel.value;
    const emps = payrollService.listEmployees().filter((e) => e.active !== false);
    employeeSel.innerHTML = emps
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.cese ? ' (cesado)' : ''}</option>`)
      .join('');
    if (!emps.length) employeeSel.innerHTML = '<option value="">Sin colaboradores</option>';
    else if (keep && emps.some((e) => e.id === keep)) employeeSel.value = keep;
  }

  function build() {
    const emp = payrollService.getEmployee(employeeSel.value);
    if (!emp) {
      showToast('Selecciona un colaborador.', 'error');
      return null;
    }
    if (!ceseI.value) {
      showToast('Indica la fecha de cese.', 'error');
      return null;
    }
    try {
      return liquidationService.calcLiquidacion(emp, { fechaCese: ceseI.value, motivo: motivoI.value });
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  }

  function renderPreview(liq) {
    current = liq;
    saved = false;
    preview.hidden = false;
    previewBody.innerHTML = documentHtml(liq, activeCompany());
    printBtn.disabled = false;
    saveBtn.disabled = false;
  }

  function calculate(silent = false) {
    const liq = build();
    if (!liq) return;
    renderPreview(liq);
    if (!silent) showToast('Liquidación calculada automáticamente.');
  }

  function renderHistory() {
    const rows = liquidationService.list();
    if (!rows.length) {
      historyBody.innerHTML = '<p style="font-size:13px;color:#7a726a;margin:0;">Aún no hay liquidaciones registradas.</p>';
      return;
    }
    historyBody.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="table" style="width:100%;font-size:13px;">
          <thead><tr><th>Colaborador</th><th>Cese</th><th>Motivo</th><th style="text-align:right;">Bruto</th><th style="text-align:right;">Neto</th><th></th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr>
                  <td>${escapeHtml(r.employeeName || '—')}</td>
                  <td>${escapeHtml(r.fechaCese || '—')}</td>
                  <td>${escapeHtml(motivoLabel(r.motivo))}</td>
                  <td style="text-align:right;">${money(r.bruto)}</td>
                  <td style="text-align:right;"><strong>${money(r.neto)}</strong></td>
                  <td style="text-align:right;"><button type="button" class="btn btn--sm" data-del="${r.id}" title="Eliminar">${ICONS.trash || 'Eliminar'}</button></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
  }

  calcBtn.addEventListener('click', () => calculate(false));

  [employeeSel, ceseI, motivoI].forEach((el) => {
    el.addEventListener('change', () => {
      if (ceseI.value) calculate(true);
    });
  });

  printBtn.addEventListener('click', () => {
    if (!current) return;
    const w = window.open('', '_blank');
    if (!w) {
      showToast('Permite las ventanas emergentes para imprimir.', 'error');
      return;
    }
    w.document.write(`<html><head><title>Liquidación</title></head><body>${documentHtml(current, activeCompany())}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  });

  saveBtn.addEventListener('click', async () => {
    if (!current || saved) return;
    try {
      await liquidationService.save({
        employeeId: current.employee.id,
        employeeName: current.employee.name,
        fechaCese: current.fechaCese,
        motivo: current.motivo,
        neto: current.neto,
        bruto: current.bruto,
      });
      if (markCeseI.checked && current.employee.cese !== current.fechaCese) {
        const empId = current.employee.id;
        await payrollService.updateEmployee(empId, { cese: current.fechaCese });
        fillEmployees(empId);
      }
      saved = true;
      saveBtn.disabled = true;
      renderHistory();
      showToast('Liquidación guardada en el historial.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  historyBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    if (!window.confirm('¿Eliminar esta liquidación del historial?')) return;
    try {
      await liquidationService.remove(btn.getAttribute('data-del'));
      renderHistory();
      showToast('Liquidación eliminada.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  fillEmployees();
  renderHistory();
}
