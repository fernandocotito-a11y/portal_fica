/* ============================================================================
   companyService.js — Gestión de empresas (CRUD)
   ----------------------------------------------------------------------------
   Administra la colección de empresas persistida en LocalStorage. Cada empresa
   tiene razón social y RUC. El Superadministrador crea las empresas y asigna a
   cada usuario secundario cuáles puede ver.
   ========================================================================== */

import { storageService } from './storageService.js';
import { uuid } from '../js/utils.js';
import { STORAGE_KEYS } from '../js/config.js';

/** Empresa por defecto que se siembra la primera vez (editable). */
const DEFAULT_COMPANY = {
  name: 'A y F FICA Asociados S.A.C.',
  ruc: '20123456789',
};

function readCompanies() {
  return storageService.local.get(STORAGE_KEYS.companies, []);
}

function writeCompanies(companies) {
  storageService.local.set(STORAGE_KEYS.companies, companies);
}

function normalizeRuc(value) {
  return String(value || '').trim();
}

/** Valida el formato de un RUC peruano (11 dígitos). */
function isValidRuc(ruc) {
  return /^\d{11}$/.test(ruc);
}

export const companyService = {
  /** Garantiza que exista al menos una empresa inicial. Idempotente. */
  seedDefaultCompany() {
    const companies = readCompanies();
    if (companies.length > 0) return;
    companies.push({
      id: uuid(),
      name: DEFAULT_COMPANY.name,
      ruc: DEFAULT_COMPANY.ruc,
      active: true,
      createdAt: new Date().toISOString(),
    });
    writeCompanies(companies);
  },

  /** Lista todas las empresas (más recientes primero). */
  list() {
    return readCompanies()
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  /** Lista solo las empresas activas. */
  listActive() {
    return this.list().filter((c) => c.active);
  },

  /** Obtiene una empresa por id. */
  getById(id) {
    return readCompanies().find((c) => c.id === id) || null;
  },

  /** Busca una empresa por RUC (insensible a espacios). */
  findByRuc(ruc) {
    const normalized = normalizeRuc(ruc);
    return readCompanies().find((c) => normalizeRuc(c.ruc) === normalized) || null;
  },

  /** Número total de empresas activas. */
  countActive() {
    return this.listActive().length;
  },

  /**
   * Crea una empresa. Lanza Error si la razón social o el RUC son inválidos
   * o si el RUC ya existe.
   */
  create({ name, ruc }) {
    const nName = String(name || '').trim();
    const nRuc = normalizeRuc(ruc);

    if (!nName) throw new Error('La razón social es obligatoria.');
    if (!nRuc) throw new Error('El RUC es obligatorio.');
    if (!isValidRuc(nRuc)) throw new Error('El RUC debe tener 11 dígitos.');
    if (this.findByRuc(nRuc)) throw new Error('Ya existe una empresa con ese RUC.');

    const companies = readCompanies();
    const company = {
      id: uuid(),
      name: nName,
      ruc: nRuc,
      active: true,
      createdAt: new Date().toISOString(),
    };
    companies.push(company);
    writeCompanies(companies);
    return company;
  },

  /** Actualiza campos de una empresa (razón social, RUC, activo). */
  update(id, patch) {
    const companies = readCompanies();
    const index = companies.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('Empresa no encontrada.');

    const current = companies[index];
    const next = { ...current, ...patch, id: current.id };

    if (patch.name !== undefined && !String(patch.name).trim()) {
      throw new Error('La razón social es obligatoria.');
    }
    if (patch.ruc !== undefined) {
      const nRuc = normalizeRuc(patch.ruc);
      if (!isValidRuc(nRuc)) throw new Error('El RUC debe tener 11 dígitos.');
      const duplicate = companies.find(
        (c) => c.id !== id && normalizeRuc(c.ruc) === nRuc
      );
      if (duplicate) throw new Error('Ya existe una empresa con ese RUC.');
      next.ruc = nRuc;
    }

    companies[index] = next;
    writeCompanies(companies);
    return next;
  },

  /** Activa o desactiva una empresa (siempre debe quedar al menos una activa). */
  toggleActive(id) {
    const company = this.getById(id);
    if (!company) throw new Error('Empresa no encontrada.');
    if (company.active && this.listActive().length <= 1) {
      throw new Error('Debe existir al menos una empresa activa.');
    }
    return this.update(id, { active: !company.active });
  },

  /** Elimina una empresa (siempre debe quedar al menos una). */
  remove(id) {
    const company = this.getById(id);
    if (!company) throw new Error('Empresa no encontrada.');
    if (this.list().length <= 1) {
      throw new Error('Debe existir al menos una empresa.');
    }
    writeCompanies(readCompanies().filter((c) => c.id !== id));
  },
};
