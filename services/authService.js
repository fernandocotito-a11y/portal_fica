/* ============================================================================
   authService.js — Autenticación, sesión y control de acceso (RBAC)
   ----------------------------------------------------------------------------
   Gestiona el inicio/cierre de sesión, la sesión activa (con opción de
   "recordar sesión") y las comprobaciones de permisos por módulo. La interfaz
   está preparada para sustituirse por un backend real (JWT + API) sin afectar
   a las vistas ni al enrutador.
   ========================================================================== */

import { storageService } from './storageService.js';
import { userService } from './userService.js';
import { hashPassword } from '../js/utils.js';
import { STORAGE_KEYS, ROLES, MODULES, getModule } from '../js/config.js';

/** Inicializa el sistema de autenticación (semilla del superadmin). */
function init() {
  userService.seedSuperAdmin();
}

/** Lee la sesión activa (prioriza la persistente, luego la de pestaña). */
function readSession() {
  const fromLocal = storageService.local.get(STORAGE_KEYS.session, null);
  if (fromLocal) return fromLocal;
  return storageService.session.get(STORAGE_KEYS.session, null);
}

/** Escribe la sesión según la opción "recordar sesión". */
function writeSession(session, remember) {
  // Se limpia la otra ubicación para evitar sesiones duplicadas/desincronizadas.
  if (remember) {
    storageService.session.remove(STORAGE_KEYS.session);
    storageService.local.set(STORAGE_KEYS.session, session);
  } else {
    storageService.local.remove(STORAGE_KEYS.session);
    storageService.session.set(STORAGE_KEYS.session, session);
  }
}

export const authService = {
  init,

  /**
   * Autentica a un usuario. Lanza Error con un mensaje legible en caso de
   * credenciales inválidas o cuenta desactivada. Devuelve el usuario en éxito.
   */
  login(email, password, remember = false) {
    const normalized = String(email || '').trim().toLowerCase();
    const user = userService.findByEmail(normalized);

    if (!user || user.passwordHash !== hashPassword(password)) {
      throw new Error('Correo o contraseña incorrectos.');
    }
    if (!user.active) {
      throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
    }

    writeSession({ userId: user.id, issuedAt: new Date().toISOString() }, !!remember);
    return user;
  },

  /** Cierra la sesión actual y limpia ambos almacenes. */
  logout() {
    storageService.local.remove(STORAGE_KEYS.session);
    storageService.session.remove(STORAGE_KEYS.session);
  },

  /** Devuelve el usuario de la sesión activa, o `null` si no hay sesión. */
  currentUser() {
    const session = readSession();
    if (!session || !session.userId) return null;
    const user = userService.getById(session.userId);
    return user && user.active ? user : null;
  },

  /** ¿Hay una sesión autenticada válida? */
  isAuthenticated() {
    return this.currentUser() !== null;
  },

  /** ¿El usuario actual es Superadministrador? */
  isSuperAdmin() {
    const user = this.currentUser();
    return !!user && user.role === ROLES.SUPERADMIN;
  },

  /** ¿El usuario actual tiene acceso al módulo indicado? */
  can(moduleKey) {
    const user = this.currentUser();
    if (!user) return false;

    // El panel principal está disponible para todo usuario autenticado.
    if (moduleKey === 'dashboard') return true;

    // El Superadministrador tiene acceso total.
    if (user.role === ROLES.SUPERADMIN) return true;

    // Los módulos exclusivos del administrador quedan bloqueados.
    const mod = getModule(moduleKey);
    if (mod && mod.adminOnly) return false;

    return Array.isArray(user.permissions) && user.permissions.includes(moduleKey);
  },

  /** Devuelve los módulos accesibles por el usuario actual. */
  accessibleModules() {
    if (!this.isAuthenticated()) return [];
    if (this.isSuperAdmin()) return MODULES.slice();
    return MODULES.filter((m) => this.can(m.key));
  },
};
