/* ============================================================================
   module.js — Vista placeholder para módulos futuros
   ----------------------------------------------------------------------------
   Renderiza la maqueta de un módulo aún no desarrollado, mostrando su nombre,
   descripción y estado ("Próximamente" o "Listo para configurar"). Sirve como
   punto de conexión para los módulos de Planillas, SIRE, Compras/Ventas,
   Retenciones, Declaraciones SUNAT y Reportes.
   ========================================================================== */

import { getModule, STATUS_LABELS } from '../../js/config.js';
import { ICONS, escapeHtml } from '../../js/utils.js';

function badgeClass(status) {
  if (status === 'active') return 'badge--active';
  if (status === 'config') return 'badge--config';
  return 'badge--soon';
}

export default {
  title: '', // El enrutador asigna el nombre real del módulo en el header.

  render(container, ctx) {
    const key = ctx.params[0];
    const mod = getModule(key);

    if (!mod) {
      container.innerHTML = '';
      return;
    }

    const status = mod.status || 'soon';
    const message =
      status === 'config'
        ? 'Este módulo está listo para configurar. Su estructura ya se encuentra conectada al portal y será habilitado en las próximas fases.'
        : 'Este módulo se encuentra en desarrollo y estará disponible próximamente.';

    container.innerHTML = `
      <div class="card">
        <div class="placeholder-hero">
          <div class="placeholder-hero__icon">${mod.icon}</div>
          <h2>${escapeHtml(mod.name)}</h2>
          <span class="badge ${badgeClass(status)}">
            <span class="badge__dot"></span>${escapeHtml(STATUS_LABELS[status])}
          </span>
          <p>${escapeHtml(mod.description)}</p>
          <p style="max-width:460px;color:var(--color-text-muted);">${escapeHtml(message)}</p>
          <button type="button" class="btn btn--primary" data-back>
            ${ICONS.arrowRight} Volver al panel
          </button>
        </div>
      </div>
    `;

    container.querySelector('[data-back]').addEventListener('click', () => {
      window.location.hash = '#/dashboard';
    });
  },
};
