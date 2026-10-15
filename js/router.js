/* ============================================================================
   router.js — Enrutador hash con protección de rutas (guards)
   ----------------------------------------------------------------------------
   Implementa una SPA ligera basada en `location.hash`:

     #/login            -> Autenticación (solo invitados)
     #/dashboard        -> Panel principal (requiere sesión)
     #/users            -> Gestión de usuarios (requiere superadmin)
     #/module/:key      -> Módulo (maqueta/placeholder, requiere sesión)

   Carga los módulos de forma diferida con import() dinámico para que el
   bundle inicial sea mínimo y la arquitectura escale con los futuros módulos.
   ========================================================================== */

import { authService } from '../services/authService.js';
import { getModule } from './config.js';
import { renderShell } from './layout.js';
import { showToast } from './utils.js';

/** Tabla de rutas. `loader` devuelve el módulo vía import() dinámico. */
const routes = [
  {
    pattern: /^\/login\/?$/,
    guard: 'guest',
    loader: () => import('../modules/login/login.js'),
  },
  {
    pattern: /^\/dashboard\/?$/,
    guard: 'auth',
    loader: () => import('../modules/dashboard/dashboard.js'),
  },
  {
    pattern: /^\/users\/?$/,
    guard: 'auth',
    adminOnly: true,
    loader: () => import('../modules/users/users.js'),
  },
  {
    pattern: /^\/module\/([\w-]+)\/?$/,
    guard: 'auth',
    loader: () => import('../modules/placeholder/module.js'),
  },
];

let currentShell = null;

/** Extrae la ruta normalizada a partir del hash actual. */
function currentPath() {
  const hash = window.location.hash || '#/';
  const path = hash.replace(/^#/, '');
  return path === '' ? '/' : path;
}

/** Encuentra la ruta coincidente y sus parámetros. */
function matchRoute(path) {
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      return { route, params: match.slice(1) };
    }
  }
  return null;
}

/** Navega de forma programática a una ruta. */
export function navigate(path) {
  if (window.location.hash === `#${path}`) {
    // Forzar re-render si ya estamos en la ruta (p. ej. logout).
    handleRoute();
  } else {
    window.location.hash = `#${path}`;
  }
}

/** Construye el contexto que recibe cada módulo. */
function buildContext(params) {
  return {
    params,
    user: authService.currentUser(),
    navigate,
    auth: authService,
  };
}

/** Procesa la ruta actual: aplica guards y renderiza la vista correspondiente. */
async function handleRoute() {
  const path = currentPath();
  const matched = matchRoute(path);

  // Ruta desconocida -> redirige según estado de sesión.
  if (!matched) {
    window.location.hash = authService.isAuthenticated() ? '#/dashboard' : '#/login';
    return;
  }

  const { route, params } = matched;
  const isAuthed = authService.isAuthenticated();

  // Guard "guest": si ya hay sesión, no mostramos el login.
  if (route.guard === 'guest' && isAuthed) {
    window.location.hash = '#/dashboard';
    return;
  }

  // Guard "auth": sin sesión, redirige al login.
  if (route.guard === 'auth' && !isAuthed) {
    window.location.hash = '#/login';
    return;
  }

  // Restricción de rol: rutas exclusivas del superadmin.
  if (route.adminOnly && !authService.isSuperAdmin()) {
    showToast('No tienes permisos para acceder a ese módulo.', 'error');
    window.location.hash = '#/dashboard';
    return;
  }

  // Valida que el parámetro :key corresponda a un módulo registrado y que el
  // usuario actual tenga permiso para acceder a él.
  const moduleKey = params[0];
  if (route.pattern.source.startsWith('^\\/module') && moduleKey) {
    if (!getModule(moduleKey) || !authService.can(moduleKey)) {
      showToast('No tienes permisos para acceder a ese módulo.', 'error');
      window.location.hash = '#/dashboard';
      return;
    }
  }

  // Carga el módulo y renderiza.
  const mod = (await route.loader()).default;
  const ctx = buildContext(params);
  // Para el placeholder de módulos, el título del header es el nombre real
  // del módulo (p. ej. "SIRE", "Planillas"); en el resto usa el título propio.
  const moduleInfo = moduleKey ? getModule(moduleKey) : null;
  const title = moduleInfo ? moduleInfo.name : mod.title || 'FICA Portal';

  if (route.guard === 'guest') {
    if (currentShell) {
      currentShell.cleanup();
      currentShell = null;
    }
    const app = document.getElementById('app');
    app.innerHTML = '';
    mod.render(app, ctx);
    return;
  }

  // Página autenticada: reutiliza el shell si ya existe.
  const activeKey = moduleKey || path.replace(/^\/|\/$/g, '') || 'dashboard';
  if (!currentShell) {
    currentShell = renderShell(authService.currentUser(), { title, activeKey });
  } else {
    currentShell.setTitle(title);
    currentShell.setActive(activeKey);
  }
  mod.render(currentShell.content, ctx);
}

/** Inicializa el enrutador. */
export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
