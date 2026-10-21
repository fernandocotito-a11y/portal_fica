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
  const s = String(iso);
  if (s.length > 10) {
    const d = new Date(s);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  }
  const [y, m] = s.slice(0, 10).split('-').map(Number);
  return y === year && m === month;
}

/** Formatea una fecha ISO a dd/mm/aaaa (sin desfase UTC). */
export function fmtDate(iso) {
  if (!iso) return '—';
  const s = String(iso);
  if (s.length > 10) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** Formatea un monto en soles. */
export function money(n) {
  const v = Number(n) || 0;
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Monto en formato numérico plano (ej. 1234.56) para archivos planos. */
export function amount2(n) {
  return (Number(n) || 0).toFixed(2);
}

/** Rellena una cadena a una longitud fija (izquierda por defecto). */
export function pad(str, len, ch = ' ') {
  let s = String(str ?? '');
  if (s.length > len) s = s.slice(0, len);
  return s + ch.repeat(Math.max(0, len - s.length));
}

/** Limpia texto para archivos planos (quita acentos y caracteres especiales). */
export function sanitizeText(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .,\-/()]/g, '')
    .trim();
}

/** Descarga un texto como archivo (Blob). */
export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Descarga un Blob ya construido. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
