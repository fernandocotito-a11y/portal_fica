/* ============================================================================
   layout.js — "Shell" del panel administrativo
   ----------------------------------------------------------------------------
   Renderiza el marco visual de las páginas autenticadas: sidebar colapsable
   con logotipo y módulos dinámicos, header superior con perfil y cierre de
   sesión, y área de contenido. Expone métodos para actualizar el título y el
   módulo activo sin reconstruir todo el layout.
   ========================================================================== */

import { authService } from '../services/authService.js';
import { storageService } from '../services/storageService.js';
import { APP, ROLE_LABELS, ROLES } from './config.js';
import { ICONS, initials, escapeHtml } from './utils.js';

const COLLAPSE_KEY = 'fica.sidebar.collapsed';

/** Móvil: ancho <= 768px (coincide con el breakpoint del CSS). */
function isMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

/** Agrupa los módulos accesibles por sección del sidebar. */
function buildSections(modules) {
  const groups = [
    { key: 'core', label: 'Principal' },
    { key: 'operations', label: 'Módulos' },
    { key: 'admin', label: 'Administración' },
  ];
  return groups
    .map((g) => ({
      label: g.label,
      items: modules.filter((m) => m.group === g.key),
    }))
    .filter((s) => s.items.length > 0);
}

/** Construye el HTML del sidebar y header a partir del usuario autenticado. */
function shellTemplate(user, activeKey, title) {
  const sections = buildSections(authService.accessibleModules());
  const roleLabel = ROLE_LABELS[user.role] || 'Usuario';

  const navHtml = sections
    .map((section) => {
      const items = section.items
        .map((m) => {
          const active = m.key === activeKey ? 'is-active' : '';
          return `
            <button type="button" class="nav-item ${active}" data-key="${escapeHtml(m.key)}"
              ${active ? 'aria-current="page"' : ''}>
              <span class="nav-item__icon">${m.icon}</span>
              <span class="nav-item__label">${escapeHtml(m.name)}</span>
            </button>`;
        })
        .join('');
      return `<div class="nav-section">
        <div class="nav-section__title">${escapeHtml(section.label)}</div>
        ${items}
      </div>`;
    })
    .join('');

  return `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar__brand">
          <img class="sidebar__logo" src="./assets/logo-ayf.png" alt="A y F FICA Asociados" />
          <div class="sidebar__brand-text">
            <div class="sidebar__brand-name">${escapeHtml(APP.name)}</div>
            <div class="sidebar__brand-sub">A y F FICA</div>
          </div>
        </div>
        <nav class="sidebar__nav" aria-label="Módulos del portal">${navHtml}</nav>
        <div class="sidebar__footer"><span>${escapeHtml(APP.name)} · v${escapeHtml(APP.version)}</span></div>
      </aside>

      <div class="sidebar-backdrop" data-backdrop></div>

      <main class="main">
        <header class="header">
          <button type="button" class="header__toggle" data-toggle aria-label="Alternar menú">${ICONS.menu}</button>
          <h1 class="header__title" data-title>${escapeHtml(title)}</h1>
          <div class="header__spacer"></div>

          <div class="profile" data-profile>
            <button type="button" class="profile__button" data-profile-button aria-haspopup="true" aria-expanded="false">
              <span class="profile__avatar">${escapeHtml(initials(user.name))}</span>
              <span class="profile__info">
                <span class="profile__name">${escapeHtml(user.name)}</span>
                <span class="profile__role">${escapeHtml(roleLabel)}</span>
              </span>
              <span class="profile__chevron">${ICONS.chevronDown}</span>
            </button>
            <div class="dropdown" data-dropdown>
              <div class="dropdown__head">
                <div class="profile__name">${escapeHtml(user.name)}</div>
                <div class="dropdown__email">${escapeHtml(user.email)}</div>
              </div>
              <button type="button" class="dropdown__item dropdown__item--danger" data-logout>${ICONS.logout}
                <span>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </header>

        <div class="content">
          <div class="content__inner" data-content></div>
        </div>
      </main>
    </div>`;
}

/**
 * Renderiza el shell y devuelve una API para manipularlo.
 * @param {Object} user Usuario autenticado.
 * @param {{title: string, activeKey: string}} options
 */
export function renderShell(user, { title = '', activeKey = 'dashboard' } = {}) {
  const app = document.getElementById('app');
  app.innerHTML = shellTemplate(user, activeKey, title);

  const layout = app.querySelector('.layout');
  const content = app.querySelector('[data-content]');
  const titleEl = app.querySelector('[data-title]');
  const toggleBtn = app.querySelector('[data-toggle]');
  const backdrop = app.querySelector('[data-backdrop]');
  const profileWrap = app.querySelector('[data-profile]');
  const profileBtn = app.querySelector('[data-profile-button]');
  const dropdown = app.querySelector('[data-dropdown]');
  const logoutBtn = app.querySelector('[data-logout]');

  // Restaura el estado colapsado persistido.
  if (storageService.local.get(COLLAPSE_KEY, false)) {
    layout.classList.add('is-collapsed');
  }

  /* ---- Alternar sidebar (colapsar en escritorio / off-canvas en móvil) ---- */
  const closeMobileMenu = () => layout.classList.remove('menu-open');

  toggleBtn.addEventListener('click', () => {
    if (isMobile()) {
      layout.classList.toggle('menu-open');
    } else {
      layout.classList.toggle('is-collapsed');
      storageService.local.set(COLLAPSE_KEY, layout.classList.contains('is-collapsed'));
    }
  });

  backdrop.addEventListener('click', closeMobileMenu);

  /* ---- Navegación del sidebar ---- */
  app.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const key = item.dataset.key;
      closeMobileMenu();
      if (key === 'dashboard') window.location.hash = '#/dashboard';
      else if (key === 'users') window.location.hash = '#/users';
      else window.location.hash = `#/module/${key}`;
    });
  });

  /* ---- Menú desplegable de perfil ---- */
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.classList.toggle('is-open');
    profileBtn.setAttribute('aria-expanded', String(open));
  });

  const closeDropdown = (e) => {
    if (!profileWrap.contains(e.target)) {
      dropdown.classList.remove('is-open');
      profileBtn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', closeDropdown);

  /* ---- Cerrar sesión ---- */
  logoutBtn.addEventListener('click', () => {
    authService.logout();
    window.location.hash = '#/login';
  });

  return {
    content,
    /** Actualiza el título del header. */
    setTitle(nextTitle) {
      titleEl.textContent = nextTitle;
    },
    /** Marca como activo el módulo indicado en el sidebar. */
    setActive(key) {
      app.querySelectorAll('.nav-item').forEach((item) => {
        const active = item.dataset.key === key;
        item.classList.toggle('is-active', active);
        if (active) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
    },
    /** Libera listeners globales asociados al shell. */
    cleanup() {
      document.removeEventListener('click', closeDropdown);
    },
  };
}
