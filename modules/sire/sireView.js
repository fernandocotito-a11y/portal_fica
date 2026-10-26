/* ============================================================================
   sireView.js — SIRE: conexión en línea con SUNAT
   ----------------------------------------------------------------------------
   Pestañas:
     1. Actualizar      Descarga la propuesta SUNAT de un período (compras/ventas)
                        y la fusiona con el Registro de Compras y Ventas.
     2. Configuración   Credenciales de API SUNAT (solo superadmin).
   ========================================================================== */

import { sireService } from './sireService.js';
import { authService } from '../../services/authService.js';
import { periodLabel, periodToInput, inputToPeriod } from '../compras/comprasConfig.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

const now = new Date();
const CURRENT_PERIOD = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

export function render(root) {
  const company = authService.activeCompany() || {};
  const isSuper = authService.isSuperAdmin();
  const state = {
    tab: 'actualizar',
    kind: 'compra',
    period: CURRENT_PERIOD,
    busy: false,
    status: '',
    result: null,
    configured: null,
    masked: null,
    saving: false,
    testing: false,
    testResult: null,
    // Conserva lo escrito en el formulario entre re-renderizados (memoria del navegador).
    form: { clientId: '', clientSecret: '', username: '', password: '' },
  };

  root.innerHTML = `
    <div data-sire-root>
    <div class="page-heading">
      <div>
        <h2 class="page-heading__title">SIRE · Conexión SUNAT</h2>
        <p class="page-heading__subtitle">
          Actualiza en línea el Registro de Compras y Ventas · ${escapeHtml(company.name || 'Empresa')} · RUC ${escapeHtml(company.ruc || '—')}
        </p>
      </div>
    </div>

    <div class="tabs-bar" data-tabs>
      <button type="button" class="tab-btn is-active" data-tab="actualizar">Actualizar</button>
      ${isSuper ? '<button type="button" class="tab-btn" data-tab="config">Configuración SUNAT</button>' : ''}
    </div>

    <div data-content></div>
    </div>`;

  const viewRoot = root.querySelector('[data-sire-root]');
  const content = viewRoot.querySelector('[data-content]');

  function setTab(tab) {
    state.tab = tab;
    viewRoot.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    });
    renderContent();
  }

  function renderActualizar() {
    const configured = state.configured;
    const statusMsg = state.status
      ? `<div class="text-muted" style="font-size:var(--font-size-sm);margin-top:var(--space-3);">${escapeHtml(state.status)}</div>`
      : '';
    const result = state.result
      ? `<div class="card" style="border-color:var(--color-gold);margin-top:var(--space-4);"><div class="card__body">
          <strong>Sincronización completa.</strong>
          <div style="margin-top:var(--space-2);">${state.result.imported} comprobante(s) nuevo(s) · ${state.result.skipped} omitido(s) (ya existían).</div>
          ${state.result.warnings?.length ? `<div class="text-muted" style="margin-top:var(--space-2);font-size:var(--font-size-sm);">${state.result.warnings.map((w) => escapeHtml(w)).join('<br>')}</div>` : ''}
        </div></div>`
      : '';

    return `
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Actualizar desde SUNAT</h3>
            <p class="card__subtitle">Descarga la propuesta SIRE del período y agrega solo los comprobantes nuevos al registro.</p>
          </div>
        </div>
        <div class="card__body">
          ${configured === false
            ? `<div class="card" style="border-color:var(--color-gold);"><div class="card__body">
                ${ICONS.info} <strong>SUNAT aún no está configurado.</strong>${isSuper
                  ? ' Ve a la pestaña <strong>Configuración SUNAT</strong> y guarda tus credenciales de API.'
                  : ' Pídele al administrador que configure las credenciales.'}
              </div></div>`
            : ''}

          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;">
            <div class="form-group" style="margin:0;min-width:190px;">
              <label class="form-label">Tipo de registro</label>
              <select class="form-input" data-kind>
                <option value="compra"${state.kind === 'compra' ? ' selected' : ''}>Compras</option>
                <option value="venta"${state.kind === 'venta' ? ' selected' : ''}>Ventas</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;min-width:170px;">
              <label class="form-label">Período</label>
              <input type="month" class="form-input" data-period value="${escapeHtml(periodToInput(state.period))}" />
            </div>
            <button type="button" class="btn btn--primary" data-sync ${state.busy || configured === false ? 'disabled' : ''}>${ICONS.arrowRight} Actualizar desde SUNAT</button>
          </div>
          ${statusMsg}
          ${result}
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-3);">
            Al actualizar, SUNAT entrega la propuesta del período y el módulo omite los comprobantes que ya existen. Puedes seguir usando la importación manual de ZIP/CSV en Compras y Ventas como respaldo.
          </p>
        </div>
      </div>`;
  }

  function renderConfig() {
    const f = state.form || {};
    const tr = state.testResult;
    const testBox = tr
      ? `<div class="card" style="border-color:${tr.ok ? '#2e7d32' : '#c62828'};margin-top:var(--space-4);">
          <div class="card__body">
            <strong>${tr.ok ? '✅ Conexión correcta' : '❌ No se pudo conectar'}</strong>
            <div style="margin-top:var(--space-2);font-size:var(--font-size-sm);">
              ${tr.message ? `<div>${escapeHtml(tr.message)}</div>` : ''}
              ${tr.error ? `<div><strong>Respuesta de SUNAT:</strong> ${escapeHtml(tr.error)}</div>` : ''}
              <div style="margin-top:var(--space-2);" class="text-muted">
                Usuario enviado: <code>${escapeHtml(tr.username || '—')}</code> (${tr.usernameLength || 0} caracteres)<br>
                client_id: <code>${escapeHtml(tr.clientId || '—')}</code>
                ${tr.tokenPreview ? `<br>Token: <code>${escapeHtml(tr.tokenPreview)}</code>` : ''}
              </div>
              ${tr.hint ? `<div style="margin-top:var(--space-2);"><strong>Pista:</strong> ${escapeHtml(tr.hint)}</div>` : ''}
            </div>
          </div>
        </div>`
      : '';

    return `
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Configuración de API SUNAT</h3>
            <p class="card__subtitle">${state.configured ? `Credenciales guardadas · client_id ${escapeHtml(state.masked || '')}` : 'Aún no hay credenciales guardadas.'}</p>
          </div>
        </div>
        <div class="card__body">
          <p class="text-muted" style="font-size:var(--font-size-sm);">
            Obtén tu <code>client_id</code> y <code>client_secret</code> en <strong>SOL → EMPRESAS → Credenciales de API SUNAT → Gestión Credenciales de API SUNAT</strong>.
            Las credenciales se guardan en Supabase y <strong>nunca se envían al navegador</strong> ni a otros usuarios.
          </p>
          <form data-config-form novalidate style="margin-top:var(--space-4);display:grid;gap:var(--space-3);max-width:480px;">
            <div class="form-group" style="margin:0;"><label class="form-label">client_id</label><input class="form-input" name="clientId" autocomplete="off" value="${escapeHtml(f.clientId || '')}" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">client_secret</label><input class="form-input" name="clientSecret" type="password" autocomplete="new-password" value="${escapeHtml(f.clientSecret || '')}" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Usuario (RUC o RUC+usuario)</label><input class="form-input" name="username" placeholder="Ej. 20601705657 o 20601705657USUARIO" autocomplete="off" value="${escapeHtml(f.username || '')}" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Clave SOL</label><input class="form-input" name="password" type="password" autocomplete="new-password" value="${escapeHtml(f.password || '')}" /></div>
            <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
              <button type="submit" class="btn btn--primary" data-save ${state.saving ? 'disabled' : ''}>${ICONS.check} Guardar credenciales</button>
              <button type="button" class="btn" data-test ${state.testing ? 'disabled' : ''}>${ICONS.search} Probar conexión</button>
            </div>
          </form>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-2);">
            “Probar conexión” guarda estos datos y verifica el token con SUNAT. Te muestra el usuario que se envía y la respuesta exacta.
          </p>
          ${testBox}
        </div>
      </div>`;
  }

  function renderContent() {
    if (state.tab === 'config') content.innerHTML = renderConfig();
    else content.innerHTML = renderActualizar();
  }

  async function loadStatus() {
    try {
      const s = await sireService.status();
      state.configured = s.configured;
      state.masked = s.masked;
    } catch (e) {
      state.configured = null;
      state.status = `No se pudo verificar la configuración: ${e.message}`;
    }
    renderContent();
  }

  viewRoot.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }

    if (e.target.closest('[data-test]')) {
      testConnection();
      return;
    }

    if (e.target.closest('[data-sync]')) {
      sync();
      return;
    }
  });

  viewRoot.addEventListener('change', (e) => {
    if (e.target.matches('[data-kind]')) state.kind = e.target.value;
    if (e.target.matches('[data-period]')) state.period = inputToPeriod(e.target.value) || CURRENT_PERIOD;
  });

  viewRoot.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-config-form]');
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const missing = [];
    if (!data.clientId) missing.push('client_id');
    if (!data.clientSecret) missing.push('client_secret');
    if (!data.username) missing.push('usuario/RUC');
    if (!data.password) missing.push('Clave SOL');
    if (missing.length) { showToast(`Completa: ${missing.join(', ')}.`, 'error'); return; }
    state.form = {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      username: data.username,
      password: data.password,
    };
    state.saving = true;
    renderContent();
    try {
      await sireService.saveCredentials({
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        username: data.username,
        password: data.password,
      });
      showToast('Credenciales guardadas. Ahora puedes probar la conexión.');
      await loadStatus();
    } catch (err) {
      showToast(err.message || String(err), 'error');
    } finally {
      state.saving = false;
      renderContent();
    }
  });

  async function testConnection() {
    const form = content.querySelector('[data-config-form]');
    const fd = form ? new FormData(form) : null;
    const data = fd ? Object.fromEntries(fd.entries()) : {};
    const allFilled = data.clientId && data.clientSecret && data.username && data.password;

    // Guarda lo escrito para no perderlo al re-renderizar.
    if (allFilled) {
      state.form = {
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        username: data.username,
        password: data.password,
      };
    }

    state.testing = true;
    state.testResult = null;
    renderContent();

    try {
      if (allFilled) {
        await sireService.saveCredentials({
          clientId: data.clientId,
          clientSecret: data.clientSecret,
          username: data.username,
          password: data.password,
        });
        const s = await sireService.status();
        state.configured = s.configured;
        state.masked = s.masked;
      }
      const res = await sireService.testConnection();
      state.testResult = res;
      if (res.ok) showToast('Conexión correcta con SUNAT.');
      else showToast('SUNAT rechazó la conexión. Revisa el detalle.', 'error');
    } catch (err) {
      state.testResult = { ok: false, error: err.message || String(err) };
      showToast(err.message || String(err), 'error');
    } finally {
      state.testing = false;
      renderContent();
    }
  }

  async function sync() {
    state.busy = true;
    state.status = `Conectando con SUNAT para descargar ${state.kind === 'venta' ? 'ventas' : 'compras'} de ${periodLabel(state.period)}…`;
    state.result = null;
    renderContent();
    try {
      const result = await sireService.sincronizar(state.kind, state.period, (msg) => {
        state.status = msg || state.status;
        const el = content.querySelector('[data-sync-status]');
        if (el) el.textContent = msg;
      });
      state.status = '';
      state.result = result;
      showToast(`Listo: ${result.imported} nuevo(s), ${result.skipped} omitido(s).`);
    } catch (err) {
      state.status = '';
      showToast(err.message || String(err), 'error');
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  renderContent();
  loadStatus();
}

export default { title: 'SIRE · Conexión SUNAT', render };
