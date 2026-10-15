/* ============================================================================
   userService.js — Gestión de usuarios (CRUD)
   ----------------------------------------------------------------------------
   Administra la colección de usuarios persistida en LocalStorage. Incluye la
   semilla del Superadministrador. A futuro, este servicio puede delegar en un
   endpoint REST manteniendo la misma interfaz pública.
   ========================================================================== */

import { storageService } from './storageService.js';
import { uuid, hashPassword } from '../js/utils.js';
import { STORAGE_KEYS, ROLES, SUPERADMIN_SEED } from '../js/config.js';

/** Lee la colección de usuarios. */
function readUsers() {
  return storageService.local.get(STORAGE_KEYS.users, []);
}

/** Persiste la colección de usuarios. */
function writeUsers(users) {
  storageService.local.set(STORAGE_KEYS.users, users);
}

/** Normaliza un correo para comparaciones consistentes. */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

export const userService = {
  /**
   * Garantiza la existencia del Superadministrador inicial. Idempotente: si ya
   * existe un usuario con ese correo, no duplica registros.
   */
  seedSuperAdmin() {
    const users = readUsers();
    const exists = users.some((u) => u.email === SUPERADMIN_SEED.email);
    if (exists) return;

    users.push({
      id: uuid(),
      name: SUPERADMIN_SEED.name,
      email: SUPERADMIN_SEED.email,
      passwordHash: hashPassword(SUPERADMIN_SEED.password),
      role: ROLES.SUPERADMIN,
      permissions: ['*'],
      companies: ['*'],
      active: true,
      createdAt: new Date().toISOString(),
    });
    writeUsers(users);
  },

  /** Lista todos los usuarios ordenados (superadmin primero, luego por fecha). */
  list() {
    return readUsers()
      .slice()
      .sort((a, b) => {
        if (a.role === ROLES.SUPERADMIN && b.role !== ROLES.SUPERADMIN) return -1;
        if (b.role === ROLES.SUPERADMIN && a.role !== ROLES.SUPERADMIN) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
  },

  /** Número total de usuarios activos. */
  countActive() {
    return readUsers().filter((u) => u.active).length;
  },

  /** Obtiene un usuario por id. */
  getById(id) {
    return readUsers().find((u) => u.id === id) || null;
  },

  /** Busca un usuario por correo (insensible a mayúsculas). */
  findByEmail(email) {
    const normalized = normalizeEmail(email);
    return readUsers().find((u) => u.email === normalized) || null;
  },

  /**
   * Crea un usuario secundario.
   * Lanza Error si el correo ya está registrado o los datos son inválidos.
   */
  create({ name, email, password, permissions = [], companies = [] }) {
    const normalized = normalizeEmail(email);
    if (!name || !name.trim()) throw new Error('El nombre es obligatorio.');
    if (!normalized) throw new Error('El correo es obligatorio.');
    if (!password) throw new Error('La contraseña es obligatoria.');
    if (this.findByEmail(normalized)) {
      throw new Error('Ya existe un usuario con ese correo electrónico.');
    }

    const users = readUsers();
    const user = {
      id: uuid(),
      name: name.trim(),
      email: normalized,
      passwordHash: hashPassword(password),
      role: ROLES.SECONDARY,
      permissions: Array.isArray(permissions) ? permissions.slice() : [],
      companies: Array.isArray(companies) ? companies.slice() : [],
      active: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);
    return user;
  },

  /** Actualiza campos de un usuario existente (nombre, permisos, activo...). */
  update(id, patch) {
    const users = readUsers();
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) throw new Error('Usuario no encontrado.');

    const user = users[index];

    // El superadministrador no puede desactivarse ni cambiarse de rol.
    if (user.role === ROLES.SUPERADMIN && patch.active === false) {
      throw new Error('No se puede desactivar al Superadministrador.');
    }

    const updated = { ...user, ...patch, id: user.id, role: user.role, email: user.email };
    users[index] = updated;
    writeUsers(users);
    return updated;
  },

  /** Activa o desactiva un usuario secundario. */
  toggleActive(id) {
    const user = this.getById(id);
    if (!user) throw new Error('Usuario no encontrado.');
    if (user.role === ROLES.SUPERADMIN) {
      throw new Error('No se puede desactivar al Superadministrador.');
    }
    return this.update(id, { active: !user.active });
  },

  /** Elimina un usuario secundario. */
  remove(id) {
    const user = this.getById(id);
    if (!user) throw new Error('Usuario no encontrado.');
    if (user.role === ROLES.SUPERADMIN) {
      throw new Error('No se puede eliminar al Superadministrador.');
    }
    writeUsers(readUsers().filter((u) => u.id !== id));
  },
};
