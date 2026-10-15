/* ============================================================================
   userService.js — Gestión de usuarios (Supabase)
   ----------------------------------------------------------------------------
   CRUD sobre la tabla `profiles` + invitación de usuarios vía la Edge Function
   `invite-user` (que envía el correo y crea el usuario en Auth).

   - list()      -> perfiles visibles (el superadmin ve todos por RLS).
   - create()    -> llama a la Edge Function (invitación por correo).
   - update()    -> actualiza el perfil (permisos, empresas, activo, nombre).
   - toggleActive() -> activa/desactiva un usuario.
   ========================================================================== */

import { supabase, SUPABASE_ANON_KEY, INVITE_FUNCTION_URL } from '../js/supabase.js';

export const userService = {
  /** Lista los usuarios (superadmin primero, luego por fecha). */
  async list() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).sort((a, b) => {
      if (a.role === 'superadmin' && b.role !== 'superadmin') return -1;
      if (b.role === 'superadmin' && a.role !== 'superadmin') return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  },

  async getById(id) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    return data || null;
  },

  /**
   * Crea/invita a un usuario secundario por correo (Edge Function).
   * Lanza Error con el mensaje devuelto por la función en caso de fallo.
   */
  async create({ name, email, permissions = [], companies = [] }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No hay sesión activa.');

    const res = await fetch(INVITE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, name, permissions, companies }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'No se pudo invitar al usuario.');
    }
    return json;
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async toggleActive(id) {
    const user = await this.getById(id);
    if (!user) throw new Error('Usuario no encontrado.');
    if (user.role === 'superadmin') {
      throw new Error('No se puede desactivar al Superadministrador.');
    }
    return this.update(id, { active: !user.active });
  },
};
