/* ============================================================================
   supabase.js — Cliente de Supabase y configuración del proyecto
   ----------------------------------------------------------------------------
   Único punto de conexión con Supabase. Aquí vive la URL del proyecto y la
   clave pública (anon/publishable). La clave secreta (service_role) NUNCA va
   aquí: solo la usa la Edge Function del lado del servidor.
   ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://kiogxgcrexgpgumfpgnq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_J3XL58s2L6cEhYm9ghaNkg_nV-aToIS';

/** URL de la Edge Function que invita a usuarios por correo. */
export const INVITE_FUNCTION_URL =
  'https://kiogxgcrexgpgumfpgnq.supabase.co/functions/v1/super-action';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true, // la sesión se mantiene entre recargas del navegador
    autoRefreshToken: true,
    detectSessionInUrl: true, // captura el token de los enlaces de invitación/reset
    storageKey: 'fica-auth',
  },
});
