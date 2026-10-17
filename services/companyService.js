/* ============================================================================
   companyService.js — Gestión de empresas (Supabase)
   ----------------------------------------------------------------------------
   CRUD de la tabla `companies` con caché en memoria. El `refresh()` precarga la
   lista (filtrada por las políticas RLS según el usuario), y los getters
   (`getAll`, `list`, `getById`, ...) son síncronos sobre ese caché.
   ========================================================================== */

import { supabase } from '../js/supabase.js';

let cache = [];

/** Traduce errores de PostgREST a mensajes legibles. */
function mapError(error) {
  if (error?.code === '23505') return 'Ya existe una empresa con ese RUC.';
  if (error?.code === '23514') return 'Valor no permitido.';
  return error?.message || 'Error al guardar la empresa.';
}

export const companyService = {
  /** Recarga el caché desde Supabase. */
  async refresh() {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) cache = data || [];
    return cache;
  },

  getAll() {
    return cache.slice();
  },

  clearCache() {
    cache = [];
  },

  list() {
    return cache.slice();
  },

  listActive() {
    return cache.filter((c) => c.active);
  },

  countActive() {
    return cache.filter((c) => c.active).length;
  },

  getById(id) {
    return cache.find((c) => c.id === id) || null;
  },

  findByRuc(ruc) {
    const n = String(ruc || '').trim();
    return cache.find((c) => String(c.ruc).trim() === n) || null;
  },

  async create(fields) {
    const payload = {
      name: String(fields.name || '').trim(),
      ruc: String(fields.ruc || '').trim(),
      tipo_contribuyente: fields.tipo_contribuyente || 'juridica',
      tipo_sociedad: fields.tipo_sociedad || null,
      regimen_tributario: fields.regimen_tributario || 'RG',
      afectacion_igv: fields.afectacion_igv || 'general',
      regimen_laboral: fields.regimen_laboral || 'general',
      agente_retencion: !!fields.agente_retencion,
      agente_percepcion: !!fields.agente_percepcion,
    };
    const { data, error } = await supabase
      .from('companies')
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(mapError(error));
    await this.refresh();
    return data;
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('companies')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(mapError(error));
    await this.refresh();
    return data;
  },

  async toggleActive(id) {
    const company = this.getById(id);
    if (!company) throw new Error('Empresa no encontrada.');
    if (company.active && this.listActive().length <= 1) {
      throw new Error('Debe existir al menos una empresa activa.');
    }
    return this.update(id, { active: !company.active });
  },

  async remove(id) {
    const company = this.getById(id);
    if (!company) throw new Error('Empresa no encontrada.');
    if (this.list().length <= 1) {
      throw new Error('Debe existir al menos una empresa.');
    }
    const { error } = await supabase.from('companies').delete().eq('id', id);
    if (error) throw new Error(mapError(error));
    await this.refresh();
  },
};
