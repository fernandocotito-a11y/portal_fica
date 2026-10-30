/* ============================================================================
   router.js — Enrutador hash con protección de rutas (guards)
   ----------------------------------------------------------------------------
   Rutas:

     #/login           -> Autenticación (solo invitados)
     #/set-password    -> Establecer contraseña (invitación / reset, sin guard)
     #/select-company  -> Selector de empresa (sesión, sin shell)
     #/dashboard       -> Panel principal (sesión + empresa)
     #/users           -> Gestión de usuarios (sesión + empresa + superadmin)
     #/companies       -> Gestión de empresas (sesión + empresa + superadmin)
     #/module/:key     -> Módulo placeholder (sesión + empresa + permiso)

   Los módulos se cargan de forma diferida con import() dinámico.
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
    pattern: /^\/set-password\/?$/,
    guard: 'none', // accesible tras hacer clic en el enlace de invitación/reset
    shell: false,
    loader: () => import('../modules/set-password/set-password.js'),
  },
  {
    pattern: /^\/select-company\/?$/,
    guard: 'auth',
    shell: false,
    loader: () => import('../modules/select-company/select-company.js'),
  },
  {
    pattern: /^\/dashboard\/?$/,
    guard: 'auth',
    company: true,
    loader: () => import('../modules/dashboard/dashboard.js'),
  },
  {
    pattern: /^\/users\/?$/,
    guard: 'auth',
    adminOnly: true,
    company: true,
    loader: () => import('../modules/users/users.js'),
  },
  {
    pattern: /^\/companies\/?$/,
    guard: 'auth',
    adminOnly: true,
    company: true,
    loader: () => import('../modules/companies/companies.js'),
  },
  {
    pattern: /^\/payroll\/?$/,
    guard: 'auth',
    company: true,
    permission: 'planillas',
    loader: () => import('../modules/payroll/payrollView.js'),
  },
  {
    pattern: /^\/compras\/?$/,
    guard: 'auth',
    company: true,
    permission: 'compras',
    loader: () => import('../modules/compras/comprasView.js'),
  },
  {
    pattern: /^\/retencion\/?$/,
    guard: 'auth',
    company: true,
    permission: 'retenciones',
    loader: () => import('../modules/retencion/retencionView.js'),
  },
  {
    pattern: /^\/sire\/?$/,
    guard: 'auth',
    company: true,
    permission: 'sire',
    loader: () => import('../modules/sire/sireView.js'),
  },
  {
    pattern: /^\/declaraciones\/?$/,
    guard: 'auth',
    company: true,
    permission: 'declaraciones',
    loader: () => import('../modules/declaraciones/declaracionesView.js'),
  },
  {
    pattern: /^\/reportes\/?$/,
    guard: 'auth',
    company: true,
    permission: 'reportes',
    loader: () => import('../modules/reportes/reportesView.js'),
  },
  {
    pattern: /^\/module\/([\w-]+)\/?$/,
    guard: 'auth',
    company: true,
    loader: () => import('../modules/placeholder/module.js'),
  },
];

let currentShell = null;

/** Ruta "de casa" según si ya hay empresa seleccionada. */
function homeHash() {
  return authService.activeCompany() ? '#/dashboard' : '#/select-company';
}

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
    window.location.hash = authService.isAuthenticated() ? homeHash() : '#/login';
    return;
  }

  const { route, params } = matched;
  const isAuthed = authService.isAuthenticated();

  // Rutas sin guard (p. ej. set-password) no aplican controles de sesión.
  if (route.guard === 'none') {
    const mod = (await route.loader()).default;
    const app = document.getElementById('app');
    app.innerHTML = '';
    mod.render(app, buildContext(params));
    return;
  }

  // Guard "guest": si ya hay sesión, no mostramos el login.
  if (route.guard === 'guest' && isAuthed) {
    window.location.hash = homeHash();
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
    window.location.hash = homeHash();
    return;
  }

  // Requisito de empresa seleccionada.
  if (route.company && !authService.activeCompany()) {
    window.location.hash = '#/select-company';
    return;
  }

  // Requisito de permiso sobre un módulo concreto (p. ej. Planillas).
  if (route.permission && !authService.can(route.permission)) {
    showToast('No tienes permisos para acceder a ese módulo.', 'error');
    window.location.hash = homeHash();
    return;
  }

  // Valida el parámetro :key (módulo registrado y permiso de acceso).
  const moduleKey = params[0];
  if (route.pattern.source.startsWith('^\\/module') && moduleKey) {
    if (!getModule(moduleKey) || !authService.can(moduleKey)) {
      showToast('No tienes permisos para acceder a ese módulo.', 'error');
      window.location.hash = homeHash();
      return;
    }
  }

  // Carga el módulo y renderiza.
  const mod = (await route.loader()).default;
  const ctx = buildContext(params);
  const moduleInfo = moduleKey ? getModule(moduleKey) : null;
  const title = moduleInfo ? moduleInfo.name : mod.title || 'FICA Portal';

  // Páginas sin shell: login (guest) y selector de empresa (shell: false).
  const useShell = route.guard === 'auth' && route.shell !== false;
  if (!useShell) {
    if (currentShell) {
      currentShell.cleanup();
      currentShell = null;
    }
    const app = document.getElementById('app');
    app.innerHTML = '';
    mod.render(app, ctx);
    return;
  }

  // Página autenticada con shell: reutiliza el layout si ya existe.
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
