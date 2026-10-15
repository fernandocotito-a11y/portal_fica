/* ============================================================================
   authService.js — Autenticación, sesión, RBAC y contexto de empresa
   ----------------------------------------------------------------------------
   Envoltorio sobre Supabase Auth + la tabla `profiles`. Mantiene un caché en
   memoria del perfil y de la empresa activa para que las vistas y el router
   puedan consultarlos de forma síncrona después del arranque.

   - init()  (async): restaura la sesión y carga perfil + empresas.
   - login() (async): inicia sesión por email/contraseña.
   - Los getters (currentUser, can, availableCompanies, activeCompany) son
     síncronos y leen del caché.
   ========================================================================== */

import { supabase } from '../js/supabase.js';
import { companyService } from './companyService.js';
import { ROLES, MODULES, getModule } from '../js/config.js';

const ACTIVE_COMPANY_KEY = 'fica.activeCompanyId';

let profile = null; // perfil en caché (null si no hay sesión válida)
let activeCompanyId = null; // empresa activa en memoria

/** Traduce errores de Supabase Auth a mensajes legibles. */
function mapAuthError(error) {
  const msg = (error && (error.message || error.msg)) || 'Error de autenticación.';
  if (/invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Confirma tu correo antes de iniciar sesión.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera unos segundos e inténtalo de nuevo.';
  return msg;
}

export const authService = {
  /** Restaura la sesión y precarga perfil y empresas (arranque de la app). */
  async init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      profile = null;
      return;
    }
    const ok = await this._loadProfile(session.user.id);
    if (!ok) {
      await supabase.auth.signOut();
      profile = null;
      return;
    }
    activeCompanyId = localStorage.getItem(ACTIVE_COMPANY_KEY) || null;
    await companyService.refresh();
    if (activeCompanyId && !this.activeCompany()) activeCompanyId = null;
  },

  /** Carga el perfil del usuario desde la BD y lo guarda en caché. */
  async _loadProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!data) {
      profile = null;
      return false;
    }

    let email = data.email || '';
    if (!email) {
      const { data: { user } } = await supabase.auth.getUser();
      email = user?.email || '';
    }

    profile = {
      id: data.id,
      name: data.name,
      role: data.role,
      permissions: data.permissions || [],
      companies: data.companies || [],
      active: data.active,
      email,
    };

    if (!profile.active) {
      profile = null;
      return false;
    }
    return true;
  },

  /** Inicia sesión por email/contraseña. Lanza Error con mensaje legible. */
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password,
    });
    if (error) throw new Error(mapAuthError(error));

    const ok = await this._loadProfile(data.user.id);
    if (!ok) {
      await supabase.auth.signOut();
      throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
    }

    activeCompanyId = localStorage.getItem(ACTIVE_COMPANY_KEY) || null;
    await companyService.refresh();
    if (activeCompanyId && !this.activeCompany()) activeCompanyId = null;
    return this.currentUser();
  },

  /** Cierra la sesión y limpia el caché. */
  async logout() {
    await supabase.auth.signOut();
    profile = null;
    activeCompanyId = null;
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    companyService.clearCache();
  },

  /** Envía el correo para restablecer la contraseña. */
  async requestPasswordReset(email) {
    // redirectTo apunta a la raíz (sin hash) para que Supabase añada los tokens
    // en un único "#..." y no se rompa el enrutado. app.js lleva a #/set-password.
    const { error } = await supabase.auth.resetPasswordForEmail(
      String(email || '').trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/` }
    );
    if (error) throw new Error(mapAuthError(error));
  },

  /** Establece una nueva contraseña para el usuario autenticado. */
  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(mapAuthError(error));
  },

  /* --------------------------- Getters síncronos ------------------------ */

  currentUser() {
    return profile;
  },

  isAuthenticated() {
    return !!profile;
  },

  isSuperAdmin() {
    return !!profile && profile.role === ROLES.SUPERADMIN;
  },

  can(moduleKey) {
    if (!profile) return false;
    if (moduleKey === 'dashboard') return true;
    if (profile.role === ROLES.SUPERADMIN) return true;
    const mod = getModule(moduleKey);
    if (mod && mod.adminOnly) return false;
    return (profile.permissions || []).includes(moduleKey);
  },

  accessibleModules() {
    if (!profile) return [];
    if (profile.role === ROLES.SUPERADMIN) return MODULES.slice();
    return MODULES.filter((m) => this.can(m.key));
  },

  canAccessCompany(companyId) {
    if (!profile) return false;
    if (profile.role === ROLES.SUPERADMIN) return true;
    return (profile.companies || []).includes(companyId);
  },

  /** Empresas activas a las que el usuario tiene acceso (según RLS + perfil). */
  availableCompanies() {
    if (!profile) return [];
    return companyService.getAll().filter((c) => c.active);
  },

  activeCompany() {
    if (!activeCompanyId) return null;
    return companyService.getAll().find((c) => c.id === activeCompanyId && c.active) || null;
  },

  setActiveCompany(companyId) {
    if (!this.canAccessCompany(companyId)) return false;
    const company = companyService.getAll().find((c) => c.id === companyId && c.active);
    if (!company) return false;
    activeCompanyId = companyId;
    localStorage.setItem(ACTIVE_COMPANY_KEY, companyId);
    return true;
  },
};
