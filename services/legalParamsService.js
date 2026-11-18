/* ============================================================================
   legalParamsService.js — UIT / RMV globales para todo el portal
   ----------------------------------------------------------------------------
   - Lee/escribe la tabla global `payroll_params` (una fila por año).
   - Descarga `data/parametros-legales.json`, que GitHub Actions actualiza
     desde SUNAT (UIT) y el BCRP/MTPE (RMV).
   - Los valores oficiales tienen prioridad sobre filas antiguas de Supabase.
     Un ajuste manual guardado después de la última actualización oficial sí
     tiene prioridad hasta la siguiente sincronización.
   ========================================================================== */

import { supabase } from '../js/supabase.js';
import {
  UIT,
  RMV,
  getUit,
  getRmv,
  setUitYear,
  setRmvYear,
  clearUitYear,
  clearRmvYear,
  resetParams,
  setOfficialValues,
  getOfficialUpdatedAt,
  hasOfficialUit,
  hasOfficialRmv,
  rmvHistory,
} from '../js/legalParams.js';

const CACHE_KEY = 'fica.legalParams.lastSync';
const AUTO_SYNC_MS = 12 * 60 * 60 * 1000; // 12 horas
const OFFICIAL_URL = 'data/parametros-legales.json';

const cache = {}; // year -> { uit, rmv, updated_at, custom }
let loaded = false;
let officialData = null;
let officialPromise = null;
let lastError = '';

function currentYear() {
  return new Date().getFullYear();
}

function builtInOfficial() {
  return {
    source: 'Valores oficiales incluidos en el portal',
    updatedAt: getOfficialUpdatedAt(),
    uit: { ...UIT },
    rmv: { ...RMV },
    rmvMonthly: {},
    stale: true,
  };
}

/** Descarga (una vez) el JSON oficial actualizado por GitHub Actions. */
async function loadOfficial({ force = false } = {}) {
  if (officialData && !force) return officialData;
  if (officialPromise && !force) return officialPromise;

  officialPromise = (async () => {
    try {
      const url = new URL(OFFICIAL_URL, document.baseURI);
      url.searchParams.set('v', String(Date.now()));
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || (!data.uit && !data.rmv)) throw new Error('JSON sin valores');
      officialData = { ...data, stale: false };
      setOfficialValues(officialData);
    } catch (_err) {
      officialData = builtInOfficial();
      setOfficialValues(officialData);
    } finally {
      officialPromise = null;
    }
    return officialData;
  })();

  return officialPromise;
}

function officialTime() {
  const t = Date.parse(getOfficialUpdatedAt() || '');
  return Number.isFinite(t) ? t : 0;
}

function dbTime(row) {
  const t = Date.parse(row?.updated_at || '');
  return Number.isFinite(t) ? t : 0;
}

/**
 * Un valor de Supabase se usa como manual solo si:
 *   - no hay valor oficial para ese campo, o
 *   - fue guardado después de la última actualización oficial y además difiere
 *     del valor oficial (si coincide, es simplemente una fila sincronizada).
 * Así una fila antigua (p. ej. UIT 2026 = 5400) no pisa el valor oficial 5,500.
 */
function shouldUseDbUit(year, row) {
  const value = Number(row?.uit);
  if (!(value > 0)) return false;
  if (!hasOfficialUit(year)) return true;
  return dbTime(row) > officialTime() && value !== Number(UIT[year]);
}

function shouldUseDbRmv(year, row) {
  const value = Number(row?.rmv);
  if (!(value > 0)) return false;
  if (!hasOfficialRmv(year)) return true;
  return dbTime(row) > officialTime() && value !== Number(RMV[year]);
}

export const legalParamsService = {
  /** Carga parámetros oficiales + overrides de Supabase. */
  async refresh({ force = false } = {}) {
    if (loaded && !force) return;
    // La descarga oficial se hace una vez; el botón “Sincronizar ahora” es el
    // que fuerza una consulta nueva a internet.
    await loadOfficial({ force: false });
    resetParams();
    for (const y of Object.keys(cache)) delete cache[y];

    let data = [];
    try {
      const result = await supabase.from('payroll_params').select('*');
      if (result.error) {
        lastError = result.error.message;
        // La tabla puede no existir todavía: seguimos con los valores oficiales.
        loaded = true;
        return;
      }
      data = result.data || [];
    } catch (err) {
      lastError = err?.message || String(err);
      loaded = true;
      return;
    }

    lastError = '';
    for (const row of data) {
      const y = Number(row.year);
      if (!Number.isFinite(y)) continue;
      cache[y] = {
        uit: Number(row.uit) || 0,
        rmv: Number(row.rmv) || 0,
        updated_at: row.updated_at || '',
        custom: true,
      };
      if (row.uit != null && shouldUseDbUit(y, row)) setUitYear(y, row.uit);
      if (row.rmv != null && shouldUseDbRmv(y, row)) setRmvYear(y, row.rmv);
    }
    loaded = true;
  },

  /** Años disponibles (rango alrededor del actual + personalizados + oficiales). */
  availableYears() {
    const Y = currentYear();
    const set = new Set();
    for (let y = Y - 1; y <= Y + 1; y += 1) set.add(y);
    Object.keys(cache).map(Number).forEach((y) => set.add(y));
    Object.keys(UIT).map(Number).filter((y) => y >= Y - 5 && y <= Y + 2).forEach((y) => set.add(y));
    Object.keys(RMV).map(Number).filter((y) => y >= Y - 5 && y <= Y + 2).forEach((y) => set.add(y));
    return Array.from(set).sort((a, b) => a - b);
  },

  /** Lista de años con UIT/RMV efectiva, origen y si es manual. */
  list() {
    return this.availableYears().map((y) => {
      const row = cache[y];
      const official = hasOfficialUit(y) || hasOfficialRmv(y);
      const manual = !!row && (shouldUseDbUit(y, row) || shouldUseDbRmv(y, row));
      return {
        year: y,
        uit: getUit(y),
        rmv: getRmv(y),
        rmvHistory: rmvHistory(y),
        custom: !!row,
        manual,
        official,
        source: manual ? 'manual' : (official ? 'official' : 'default'),
        updatedAt: row?.updated_at || '',
      };
    });
  },

  getUit,
  getRmv,
  rmvHistory,
  get lastError() { return lastError; },
  get official() { return officialData; },
  get loaded() { return loaded; },

  /** Guarda (o actualiza) UIT y RMV de un año. */
  async save(year, uit, rmv) {
    const y = Number(year);
    const u = Number(uit);
    const r = Number(rmv);
    if (!Number.isFinite(y) || !(u > 0) || !(r > 0)) {
      throw new Error('Año, UIT y RMV deben ser números válidos y mayores a 0.');
    }
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('payroll_params')
      .upsert({ year: y, uit: u, rmv: r, updated_at: updatedAt }, { onConflict: 'year' });
    if (error) throw new Error(error.message);

    cache[y] = { uit: u, rmv: r, updated_at: updatedAt, custom: true };
    // Si el valor coincide con el oficial no se crea un override: así la RMV
    // mensual (por ejemplo, 1,130 de enero a septiembre y 1,230 desde octubre)
    // sigue aplicándose mes a mes.
    if (hasOfficialUit(y) && Number(u) === Number(UIT[y])) clearUitYear(y);
    else setUitYear(y, u);
    if (hasOfficialRmv(y) && Number(r) === Number(RMV[y])) clearRmvYear(y);
    else setRmvYear(y, r);
  },

  /** Elimina la configuración de un año (vuelve al valor oficial/default). */
  async remove(year) {
    const y = Number(year);
    const { error } = await supabase.from('payroll_params').delete().eq('year', y);
    if (error) throw new Error(error.message);
    delete cache[y];
    clearUitYear(y);
    clearRmvYear(y);
  },

  /**
   * Descarga los valores oficiales y actualiza Supabase.
   * Solo el superadministrador puede escribir `payroll_params` (RLS).
   */
  async syncOfficial() {
    const data = await loadOfficial({ force: true });
    if (!data) throw new Error('No se pudieron leer los parámetros oficiales.');
    if (data.stale) {
      throw new Error('No se pudo consultar internet; se mantienen los valores actuales.');
    }

    const Y = currentYear();
    const minYear = Y - 10;
    const maxYear = Y + 1;
    const years = new Set([
      ...Object.keys(data.uit || {}).map(Number),
      ...Object.keys(data.rmv || {}).map(Number),
      ...Object.keys(cache).map(Number),
    ].filter((y) => Number.isFinite(y) && y >= minYear && y <= maxYear));
    const now = new Date().toISOString();
    const rows = [];
    const changes = [];

    for (const y of [...years].sort((a, b) => a - b)) {
      if (!Number.isFinite(y)) continue;
      // Solo se sincronizan años con ambos valores oficiales. Para años con
      // UIT pero sin RMV (históricos) basta el valor oficial en memoria.
      const nextUit = Number(data.uit?.[y]);
      const nextRmv = Number(data.rmv?.[y]);
      if (!(nextUit > 0) || !(nextRmv > 0)) continue;

      const row = cache[y] || {};
      const sameUit = Number(row.uit) === nextUit;
      const sameRmv = Number(row.rmv) === nextRmv;
      if (!sameUit || !sameRmv) {
        changes.push({
          year: y,
          before: { uit: Number(row.uit) || null, rmv: Number(row.rmv) || null },
          after: { uit: nextUit, rmv: nextRmv },
        });
        rows.push({ year: y, uit: nextUit, rmv: nextRmv, updated_at: now });
      }
    }

    if (rows.length) {
      const { error } = await supabase
        .from('payroll_params')
        .upsert(rows, { onConflict: 'year' });
      if (error) throw new Error(error.message);
      for (const row of rows) {
        cache[row.year] = {
          uit: row.uit,
          rmv: row.rmv,
          updated_at: row.updated_at,
          custom: true,
        };
        // La fila ya coincide con el valor oficial: no debe comportarse como
        // override manual (la RMV mensual debe seguir aplicándose por mes).
        clearUitYear(row.year);
        clearRmvYear(row.year);
      }
    }

    try {
      localStorage.setItem(CACHE_KEY, String(Date.now()));
    } catch (_err) {
      /* almacenamiento no disponible */
    }
    return { changes, official: data };
  },

  /** Sincroniza en segundo plano si pasaron más de 12 horas. */
  async autoSyncIfStale() {
    let last = 0;
    try {
      last = Number(localStorage.getItem(CACHE_KEY) || 0);
    } catch (_err) {
      last = 0;
    }
    if (Date.now() - last < AUTO_SYNC_MS) return { skipped: true, changes: [] };
    return this.syncOfficial();
  },
};
