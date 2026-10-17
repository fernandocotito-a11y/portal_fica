/* ============================================================================
   payrollUtils.js — Utilidades compartidas del módulo de Planillas
   ----------------------------------------------------------------------------
   Helpers numéricos, de fechas e de almacenamiento (mock en LocalStorage)
   reutilizados por todos los servicios del módulo.
   ========================================================================== */

/** Convierte a número (con valor por defecto). */
export function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

/** Redondea a 2 decimales (formato monetario). */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Limita un número entre min y max. */
export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/** Genera un identificador único. */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** Lee y deserializa una clave de LocalStorage. */
export function storeRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Serializa y escribe una clave en LocalStorage. */
export function storeWrite(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* noop */
  }
}

/** Clave de período 'YYYY-MM'. */
export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Devuelve true si una fecha ISO (YYYY-MM-DD) cae en el mes/año indicados. */
export function dateInMonth(iso, year, month) {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

/** Formatea una fecha ISO a dd/mm/aaaa. */
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Formatea un monto en soles. */
export function money(n) {
  const v = Number(n) || 0;
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
