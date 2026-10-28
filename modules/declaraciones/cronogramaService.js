/* ============================================================================
   cronogramaService.js — Cronograma oficial de vencimientos SUNAT
   ----------------------------------------------------------------------------
   SUNAT publica el cronograma mensual en una página por ejercicio:
     https://www.sunat.gob.pe/orientacion/cronogramas/<año>/cObligacionMensual<año>.html
   Esa página no permite ser leída desde el navegador (CORS restringido a
   ww3.sunat.gob.pe), por lo que la descarga se hace con la Edge Function
   "sunat-sire" (acción "cronograma") y el resultado se cachea en localStorage.

   Si todavía no se descargó (o la función no está desplegada), se usa el
   cronograma oficial incluido aquí para 2025 y 2026. Como último recurso se
   estima con la regla histórica (ver declaracionesService.defaultVencimiento).
   ========================================================================== */

import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '../../js/supabase.js';

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/sunat-sire`;
const CACHE_PREFIX = 'fica.sunat.cronograma.v1';

/** Grupos de último dígito del RUC que publica SUNAT. */
export const GRUPOS = ['0', '1', '2-3', '4-5', '6-7', '8-9', 'bc'];

/** Grupo de vencimiento según el último dígito del RUC. */
export function grupoRuc(ruc) {
  const digits = String(ruc || '').replace(/\D/g, '');
  if (!digits) return '';
  const d = Number(digits.slice(-1));
  if (d === 0) return '0';
  if (d === 1) return '1';
  if (d === 2 || d === 3) return '2-3';
  if (d === 4 || d === 5) return '4-5';
  if (d === 6 || d === 7) return '6-7';
  return '8-9';
}

export function officialUrl(year) {
  const y = Number(year);
  return `https://www.sunat.gob.pe/orientacion/cronogramas/${y}/cObligacionMensual${y}.html`;
}

/* Cronograma oficial publicado por SUNAT (columnas: 0, 1, 2-3, 4-5, 6-7, 8-9, BC/UESP). */
const OFFICIAL = {
  2025: [
    ['2025-02-17', '2025-02-18', '2025-02-19', '2025-02-20', '2025-02-21', '2025-02-24', '2025-02-25'],
    ['2025-03-17', '2025-03-18', '2025-03-19', '2025-03-20', '2025-03-21', '2025-03-24', '2025-03-25'],
    ['2025-04-15', '2025-04-16', '2025-04-21', '2025-04-22', '2025-04-23', '2025-04-24', '2025-04-25'],
    ['2025-05-16', '2025-05-19', '2025-05-20', '2025-05-21', '2025-05-22', '2025-05-23', '2025-05-26'],
    ['2025-06-16', '2025-06-17', '2025-06-18', '2025-06-19', '2025-06-20', '2025-06-23', '2025-06-24'],
    ['2025-07-15', '2025-07-16', '2025-07-17', '2025-07-18', '2025-07-21', '2025-07-22', '2025-07-24'],
    ['2025-08-18', '2025-08-19', '2025-08-20', '2025-08-21', '2025-08-22', '2025-08-25', '2025-08-26'],
    ['2025-09-15', '2025-09-16', '2025-09-17', '2025-09-18', '2025-09-19', '2025-09-22', '2025-09-23'],
    ['2025-10-16', '2025-10-17', '2025-10-20', '2025-10-21', '2025-10-22', '2025-10-23', '2025-10-24'],
    ['2025-11-17', '2025-11-18', '2025-11-19', '2025-11-20', '2025-11-21', '2025-11-24', '2025-11-25'],
    ['2025-12-17', '2025-12-18', '2025-12-19', '2025-12-22', '2025-12-23', '2025-12-24', '2025-12-26'],
    ['2026-01-16', '2026-01-19', '2026-01-20', '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-26'],
  ],
  2026: [
    ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23', '2026-02-24'],
    ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-23', '2026-03-24'],
    ['2026-04-17', '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-27'],
    ['2026-05-18', '2026-05-19', '2026-05-20', '2026-05-21', '2026-05-22', '2026-05-25', '2026-05-26'],
    ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-22', '2026-06-23'],
    ['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-24'],
    ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26'],
    ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23'],
    ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'],
    ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'],
    ['2026-12-17', '2026-12-18', '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-28'],
    ['2027-01-18', '2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22', '2027-01-25', '2027-01-26'],
  ],
};

function rowsToMonths(rows) {
  return rows.map((dates, i) => ({
    mes: i + 1,
    dates: Object.fromEntries(GRUPOS.map((g, j) => [g, dates[j] || ''])),
  }));
}

function cacheKey(year) {
  return `${CACHE_PREFIX}.${Number(year)}`;
}

function readCache(year) {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(year)) || 'null');
    if (raw && Array.isArray(raw.months) && raw.months.length) return raw;
  } catch { /* caché corrupta: se ignora */ }
  return null;
}

/** Cronograma disponible para el año (descargado > incluido > vacío). */
export function cronogramaFor(year) {
  const y = Number(year);
  const cached = readCache(y);
  if (cached) {
    return { year: y, months: cached.months, source: 'sunat', fetchedAt: cached.fetchedAt || '', url: cached.url || officialUrl(y) };
  }
  const rows = OFFICIAL[y];
  if (rows) {
    return { year: y, months: rowsToMonths(rows), source: 'local', fetchedAt: '', url: officialUrl(y) };
  }
  return { year: y, months: [], source: 'none', fetchedAt: '', url: officialUrl(y) };
}

/** Estado legible del cronograma para la interfaz. */
export function cronogramaStatus(year) {
  const data = cronogramaFor(year);
  const label = data.source === 'sunat'
    ? 'Descargado de SUNAT'
    : data.source === 'local'
      ? 'Cronograma oficial incluido'
      : 'Estimado (sin cronograma oficial)';
  return { ...data, label };
}

/** Fecha de vencimiento (YYYY-MM-DD) del periodo según el cronograma. */
export function vencimientoFor(year, month, ruc) {
  const data = cronogramaFor(year);
  const row = data.months.find((m) => Number(m.mes) === Number(month));
  const group = grupoRuc(ruc);
  return (row && group && row.dates[group]) || '';
}

function normalizeMonths(months) {
  if (!Array.isArray(months)) return [];
  return months
    .map((m) => ({
      mes: Number(m?.mes),
      dates: Object.fromEntries(GRUPOS.map((g) => [g, String(m?.dates?.[g] || '').slice(0, 10)])),
    }))
    .filter((m) => m.mes >= 1 && m.mes <= 12)
    .sort((a, b) => a.mes - b.mes);
}

/** Descarga el cronograma oficial del año vía Edge Function y lo cachea. */
export async function descargarCronograma(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) throw new Error('Ejercicio inválido.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('No hay sesión activa.');

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action: 'cronograma', year: y }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Error ${res.status} al consultar SUNAT.`);
  }
  const months = normalizeMonths(json.months);
  if (!months.length) throw new Error('SUNAT no devolvió vencimientos para ese ejercicio.');

  const payload = {
    year: y,
    fetchedAt: json.fetchedAt || new Date().toISOString(),
    url: json.source || officialUrl(y),
    months,
  };
  localStorage.setItem(cacheKey(y), JSON.stringify(payload));
  return cronogramaFor(y);
}

/** Borra la copia descargada y vuelve al cronograma incluido. */
export function limpiarCronograma(year) {
  localStorage.removeItem(cacheKey(year));
}
