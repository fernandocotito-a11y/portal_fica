/* ============================================================================
   authService.js — Autenticación, sesión, RBAC y contexto de empresa
   ----------------------------------------------------------------------------
   Además del inicio/cierre de sesión y los permisos por módulo, gestiona el
   "contexto de empresa": qué empresas puede ver cada usuario y cuál tiene
   seleccionada (guardada en la sesión). La interfaz está preparada para
   sustituirse por un backend real (JWT + API) sin afectar a las vistas.
   ========================================================================== */

import { storageService } from './storageService.js';
import { userService } from './userService.js';
import { companyService } from './companyService.js';
import { hashPassword } from '../js/utils.js';
import { STORAGE_KEYS, ROLES, MODULES, getModule } from '../js/config.js';

/** Inicializa el sistema de autenticación (semilla de superadmin y empresa). */
function init() {
  userService.seedSuperAdmin();
  companyService.seedDefaultCompany();
}

/** Lee la sesión activa (prioriza la persistente, luego la de pestaña). */
function readSession() {
  const fromLocal = storageService.local.get(STORAGE_KEYS.session, null);
  if (fromLocal) return fromLocal;
  return storageService.session.get(STORAGE_KEYS.session, null);
}

/** Escribe la sesión según la opción "recordar sesión" (guardada en la sesión). */
function writeSession(session) {
  const remember = !!session.remember;
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
   * Autentica a un usuario. Lanza Error con mensaje legible en caso de
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

    writeSession({
      userId: user.id,
      issuedAt: new Date().toISOString(),
      remember: !!remember,
      activeCompanyId: null,
    });
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

    if (moduleKey === 'dashboard') return true;

    if (user.role === ROLES.SUPERADMIN) return true;

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

  /* ----------------------- Contexto de empresa -------------------------- */

  /** ¿El usuario actual puede acceder a la empresa indicada? */
  canAccessCompany(companyId) {
    const user = this.currentUser();
    if (!user) return false;
    if (user.role === ROLES.SUPERADMIN) return true;
    return Array.isArray(user.companies) && user.companies.includes(companyId);
  },

  /** Empresas (activas) que el usuario actual puede ver. */
  availableCompanies() {
    const user = this.currentUser();
    if (!user) return [];
    const active = companyService.listActive();
    if (user.role === ROLES.SUPERADMIN) return active;
    const ids = Array.isArray(user.companies) ? user.companies : [];
    return active.filter((c) => ids.includes(c.id));
  },

  /** Empresa actualmente seleccionada (o `null` si no hay/ya no aplica). */
  activeCompany() {
    const session = readSession();
    if (!session || !session.activeCompanyId) return null;
    if (!this.canAccessCompany(session.activeCompanyId)) return null;
    const company = companyService.getById(session.activeCompanyId);
    return company && company.active ? company : null;
  },

  /** Selecciona una empresa como contexto activo. Devuelve true si se pudo. */
  setActiveCompany(companyId) {
    const session = readSession();
    if (!session || !this.canAccessCompany(companyId)) return false;
    const company = companyService.getById(companyId);
    if (!company || !company.active) return false;
    session.activeCompanyId = companyId;
    writeSession(session);
    return true;
  },

  /** Quita el contexto de empresa activo (sin cerrar sesión). */
  clearActiveCompany() {
    const session = readSession();
    if (!session) return;
    session.activeCompanyId = null;
    writeSession(session);
  },
};
