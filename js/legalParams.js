/* ============================================================================
   legalParams.js — Parámetros legales nacionales (UIT / RMV)
   ----------------------------------------------------------------------------
   La UIT y la RMV son valores únicos para todo el Perú. No dependen de la
   empresa ni del usuario. Este archivo es la única fuente de valores por
   defecto y de los overrides que se cargan desde Supabase (`payroll_params`).

   Prioridad de un valor:
     1. Override manual guardado en Supabase y más reciente que el dato oficial.
     2. Valor oficial detectado (SUNAT / BCRP-MTPE).
     3. Último valor oficial conocido anterior al año consultado.

   La RMV puede cambiar a mitad de año (por ejemplo, octubre de 2026). Por eso
   `getRmv(year, month)` consulta el histórico mensual oficial (después de un
   override manual, que siempre tiene prioridad).
   ========================================================================== */

const CURRENT_YEAR = new Date().getFullYear();

/* ---------------------------------------------------------------------------
   Valores oficiales incluidos como respaldo. El archivo
   `data/parametros-legales.json` los actualiza automáticamente desde internet.
   -------------------------------------------------------------------------- */
export const UIT = {
  2018: 4150,
  2019: 4200,
  2020: 4300,
  2021: 4400,
  2022: 4600,
  2023: 4950,
  2024: 5150,
  2025: 5350,
  2026: 5500,
};

export const RMV = {
  2018: 930,
  2019: 930,
  2020: 930,
  2021: 930,
  2022: 1025,
  2023: 1025,
  2024: 1025,
  2025: 1130,
  2026: 1230,
};

/** RMV vigente desde el mes indicado (clave YYYY-MM). */
export const RMV_MONTHLY = {
  '2021-01': 930,
  '2022-01': 930,
  '2022-05': 1025,
  '2023-01': 1025,
  '2024-01': 1025,
  '2025-01': 1130,
  '2026-01': 1130,
  '2026-10': 1230,
};

let OFFICIAL_UPDATED_AT = '2026-11-18';
let UIT_OVERRIDES = {};
let RMV_OVERRIDES = {};

/** Fecha de la última actualización oficial cargada (ISO). */
export function getOfficialUpdatedAt() {
  return OFFICIAL_UPDATED_AT;
}

/** Mezcla los valores oficiales descargados desde internet. */
export function setOfficialValues(payload = {}) {
  if (payload.updatedAt) OFFICIAL_UPDATED_AT = String(payload.updatedAt);
  for (const [year, value] of Object.entries(payload.uit || {})) {
    const y = Number(year);
    const v = Number(value);
    if (Number.isFinite(y) && v > 0) UIT[y] = v;
  }
  for (const [year, value] of Object.entries(payload.rmv || {})) {
    const y = Number(year);
    const v = Number(value);
    if (Number.isFinite(y) && v > 0) RMV[y] = v;
  }
  for (const [period, value] of Object.entries(payload.rmvMonthly || {})) {
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    const v = Number(value);
    if (v > 0) RMV_MONTHLY[period] = v;
  }
}

/** ¿Hay un valor oficial de UIT para ese año? */
export function hasOfficialUit(year) {
  return UIT[Number(year)] != null;
}

/** ¿Hay un valor oficial de RMV para ese año? */
export function hasOfficialRmv(year) {
  return RMV[Number(year)] != null;
}

/** Histórico de cambios oficiales de la RMV para un año (mes de inicio). */
export function rmvHistory(year) {
  const prefix = `${Number(year)}-`;
  const months = Object.keys(RMV_MONTHLY)
    .filter((key) => key.startsWith(prefix))
    .sort()
    .map((from) => ({ from, value: RMV_MONTHLY[from] }));
  return months.filter((item, index) => index === 0 || item.value !== months[index - 1].value);
}

/** Establece la UIT de un año (override manual). */
export function setUitYear(year, val) {
  const v = Number(val);
  const y = Number(year);
  if (Number.isFinite(y) && v > 0) UIT_OVERRIDES[y] = v;
  else delete UIT_OVERRIDES[y];
}

/** Establece la RMV de un año (override manual). */
export function setRmvYear(year, val) {
  const v = Number(val);
  const y = Number(year);
  if (Number.isFinite(y) && v > 0) RMV_OVERRIDES[y] = v;
  else delete RMV_OVERRIDES[y];
}

/** Elimina el override manual de UIT de un año. */
export function clearUitYear(year) {
  delete UIT_OVERRIDES[Number(year)];
}

/** Elimina el override manual de RMV de un año. */
export function clearRmvYear(year) {
  delete RMV_OVERRIDES[Number(year)];
}

/** Limpia los overrides (se invoca antes de recargar desde Supabase). */
export function resetParams() {
  UIT_OVERRIDES = {};
  RMV_OVERRIDES = {};
}

/** ¿El valor efectivo de UIT proviene de un override manual? */
export function isUitManual(year) {
  return UIT_OVERRIDES[Number(year)] != null;
}

/** ¿El valor efectivo de RMV proviene de un override manual? */
export function isRmvManual(year) {
  return RMV_OVERRIDES[Number(year)] != null;
}

/** UIT de un año (override > oficial > último oficial conocido). */
export function getUit(year) {
  const y = Number(year) || CURRENT_YEAR;
  if (UIT_OVERRIDES[y] != null) return UIT_OVERRIDES[y];
  if (UIT[y] != null) return UIT[y];
  for (let i = y - 1; i >= y - 15; i -= 1) {
    if (UIT[i] != null) return UIT[i];
  }
  const years = Object.keys(UIT).map(Number).sort((a, b) => a - b);
  if (!years.length) return 5500;
  return UIT[y < years[0] ? years[0] : years[years.length - 1]];
}

/** Busca la RMV oficial vigente en un período YYYY-MM (o la anterior). */
function monthlyRmvAt(period) {
  let found = null;
  let foundKey = '';
  for (const [key, value] of Object.entries(RMV_MONTHLY)) {
    if (key <= period && key > foundKey) {
      foundKey = key;
      found = value;
    }
  }
  return found;
}

/**
 * RMV de un año (o de un mes concreto).
 * @param {number|string} year
 * @param {number|string} [month] 1..12. Si se omite, devuelve la RMV más
 *   reciente del año (útil para etiquetas y resúmenes anuales).
 */
export function getRmv(year, month) {
  const y = Number(year) || CURRENT_YEAR;
  if (RMV_OVERRIDES[y] != null) return RMV_OVERRIDES[y];

  const m = Number(month);
  if (Number.isFinite(m) && m >= 1 && m <= 12) {
    const period = `${y}-${String(m).padStart(2, '0')}`;
    const monthly = monthlyRmvAt(period);
    if (monthly != null) return monthly;
  }

  // Sin mes (o sin histórico mensual): usar el último mes oficial del año.
  const history = rmvHistory(y);
  if (history.length) return history[history.length - 1].value;
  if (RMV[y] != null) return RMV[y];

  for (let i = y - 1; i >= y - 15; i -= 1) {
    if (RMV[i] != null) return RMV[i];
  }
  const years = Object.keys(RMV).map(Number).sort((a, b) => a - b);
  if (!years.length) return 1230;
  return RMV[y < years[0] ? years[0] : years[years.length - 1]];
}
