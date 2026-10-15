/* ============================================================================
   dashboard.js — Panel principal (vista de inicio autenticada)
   ----------------------------------------------------------------------------
   Muestra un saludo personalizado, métricas resumidas y tarjetas de acceso
   directo a los módulos (con su estado: Activo / Próximamente / Listo para
   configurar).
   ========================================================================== */

import { authService } from '../../services/authService.js';
import { companyService } from '../../services/companyService.js';
import { STATUS_LABELS } from '../../js/config.js';
import { ICONS, escapeHtml } from '../../js/utils.js';

/** Mapea el estado de un módulo a la clase de su badge. */
function badgeClass(status) {
  if (status === 'active') return 'badge--active';
  if (status === 'config') return 'badge--config';
  return 'badge--soon';
}

export default {
  title: 'Panel Principal',

  render(container) {
    const user = authService.currentUser();
    const isAdmin = authService.isSuperAdmin();
    const company = authService.activeCompany();
    const firstName = user ? user.name.trim().split(/\s+/)[0] : '';

    const accessible = authService.accessibleModules().filter((m) => m.key !== 'dashboard');
    const activeCount = accessible.filter((m) => m.status === 'active').length;
    const soonCount = accessible.filter((m) => m.status === 'soon').length;

    // Métricas resumen.
    const stats = [
      { icon: ICONS.shield, value: accessible.length, label: 'Módulos accesibles' },
      { icon: ICONS.check, value: activeCount, label: 'Módulos activos' },
      { icon: ICONS.clock, value: soonCount, label: 'Próximamente' },
      { icon: ICONS.building, value: companyService.countActive(), label: 'Empresas activas' },
    ];

    const statsHtml = stats
      .map(
        (s) => `
          <div class="stat-card">
            <span class="stat-card__icon">${s.icon}</span>
            <div>
              <div class="stat-card__value">${s.value}</div>
              <div class="stat-card__label">${escapeHtml(s.label)}</div>
            </div>
          </div>`
      )
      .join('');

    const cardsHtml = accessible
      .map((m) => {
        const href = m.key === 'users' ? '#/users' : `#/module/${m.key}`;
        const status = m.status || 'soon';
        return `
          <a class="module-card" href="${href}">
            <div class="module-card__top">
              <span class="module-card__icon">${m.icon}</span>
              <span class="badge ${badgeClass(status)}">
                <span class="badge__dot"></span>${escapeHtml(STATUS_LABELS[status])}
              </span>
            </div>
            <div class="module-card__name">${escapeHtml(m.name)}</div>
            <div class="module-card__desc">${escapeHtml(m.description)}</div>
            <div class="module-card__foot">
              <span class="text-muted" style="font-size: var(--font-size-xs);">Módulo del portal</span>
              <span style="display:inline-flex;align-items:center;gap:6px;color:var(--color-gold);font-size:var(--font-size-xs);font-weight:600;">
                Abrir ${ICONS.arrowRight}
              </span>
            </div>
          </a>`;
      })
      .join('');

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Bienvenido, ${escapeHtml(firstName || 'Usuario')}</h2>
          <p class="page-heading__subtitle">${company ? `${escapeHtml(company.name)} — ` : ''}Resumen general de tu espacio de trabajo.</p>
        </div>
        <span class="badge badge--gold">
          <span class="badge__dot"></span>${isAdmin ? 'Superadministrador' : 'Usuario Secundario'}
        </span>
      </div>

      <div class="stats">${statsHtml}</div>

      <h3 style="font-size: var(--font-size-lg); color: var(--color-primary); margin-bottom: var(--space-4);">Módulos del portal</h3>
      <div class="module-grid">${cardsHtml}</div>
    `;
  },
};
