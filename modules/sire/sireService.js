/* ============================================================================
   sireService.js — Conexión con el Servicio Web API del SIRE (SUNAT)
   ----------------------------------------------------------------------------
   Habla con la Edge Function "sunat-sire", que hace el flujo token -> descargar
   propuesta -> descargar archivo usando las credenciales guardadas en Supabase
   (la Clave SOL nunca pasa por el navegador). El ZIP resultante se procesa con
   el mismo importador SIRE de Compras/Ventas (con deduplicación).
   ========================================================================== */

import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { parseSireFiles } from '../compras/sireParser.js';
import { taxService } from '../compras/taxService.js';

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/sunat-sire`;

async function invoke(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const companyId = authService.activeCompany()?.id || '';
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, companyId, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status} del servidor.`);
  return json;
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const sireService = {
  /** Estado de configuración (sin exponer secretos). */
  status() {
    return invoke('status');
  },

  /** Guarda las credenciales (solo superadmin). */
  saveCredentials({ clientId, clientSecret, username, password }) {
    return invoke('save', { clientId, clientSecret, username, password });
  },

  /** Prueba solo el token contra SUNAT (diagnóstico). */
  testConnection() {
    return invoke('test');
  },

  /** Descarga la propuesta de SUNAT (devuelve fileName + base64). */
  descargar(kind, period) {
    return invoke('descargar', { kind, period });
  },

  /**
   * Descarga de SUNAT y fusiona con el Registro de Compras/Ventas.
   * Devuelve { imported, skipped, fileName }.
   */
  async sincronizar(kind, period, onProgress = () => {}) {
    const res = await this.descargar(kind, period);
    const mime = /\.zip$/i.test(res.fileName) ? 'application/zip' : 'text/csv';
    const file = new File([base64ToBytes(res.base64)], res.fileName, { type: mime });

    await taxService.refresh();
    const parsed = await parseSireFiles([file], { onProgress });
    if (!parsed.records.length) throw new Error('La propuesta descargada no contiene comprobantes.');
    const result = await taxService.importParsed(parsed.files);
    return { ...result, fileName: res.fileName, kind, period };
  },
};
