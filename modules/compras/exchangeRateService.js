/* ============================================================================
   exchangeRateService.js — Tipos de cambio SUNAT por fecha (Global / Multiempresa)
   ----------------------------------------------------------------------------
   Guarda los tipos de cambio en Supabase (tax_exchange_rates) de forma global
   (compartida para todas las empresas) y, si la tabla no existe, en localStorage.
   Permite consulta automática vía BCRP, carga masiva, CRUD y asignación a
   comprobantes en moneda extranjera.
   ========================================================================== */

import { supabase, SUPABASE_URL } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { isSolarized, convertAmountsToSoles, markSolarized } from './comprasConfig.js';

const MODEL_HEADERS = ['Fecha', 'Tipo de Cambio', 'Moneda'];
const VALID_CURRENCIES = new Set(['USD', 'EUR', 'PEN']);
const LOCAL_STORAGE_KEY = 'fica.exchange_rates.global';

let rates = [];
let mode = 'unknown';
let checked = false;
let lastError = '';
let legacySchema = false;

function cid() {
  const company = authService.activeCompany();
  return company ? company.id : null;
}

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCurrency(value) {
  const c = String(value || 'USD').trim().toUpperCase();
  return VALID_CURRENCIES.has(c) ? c : 'USD';
}

function normalizeDate(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/[T\s].*$/, '');
  let y;
  let m;
  let d;
  let match = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (match) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else {
    match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (match) {
      d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
    } else {
      match = s.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (match) {
        y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
      }
    }
  }
  if (!y || !m || !d) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseRateNumber(value) {
  let s = String(value ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function cleanRate(input) {
  return {
    rate_date: normalizeDate(input.rate_date ?? input.date ?? input.fecha),
    currency: normalizeCurrency(input.currency ?? input.moneda),
    rate: parseRateNumber(input.rate ?? input.tipo_cambio ?? input.valor),
    source: String(input.source || 'sunat').trim() || 'sunat',
  };
}

function deduplicateRates(list) {
  const byKey = new Map();
  for (const item of list) {
    const key = `${normalizeDate(item.rate_date)}|${normalizeCurrency(item.currency)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    if (existing.source === 'manual' && item.source !== 'manual') continue;
    if (item.source === 'manual' && existing.source !== 'manual') {
      byKey.set(key, item);
      continue;
    }
    if (String(item.updated_at || '') > String(existing.updated_at || '')) {
      byKey.set(key, item);
    }
  }
  return sortRates([...byKey.values()]);
}

function loadLocal() {
  try {
    let raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const merged = new Map();
      const legacyKeys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('fica.exchange_rates.')) {
          legacyKeys.push(key);
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (Array.isArray(data.rates)) {
              data.rates.forEach((r) => {
                const c = cleanRate(r);
                if (c.rate_date && c.rate > 0) {
                  merged.set(`${c.rate_date}|${c.currency}`, { ...r, ...c });
                }
              });
            }
          } catch {}
        }
      }
      if (merged.size) {
        rates = deduplicateRates([...merged.values()]);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ rates }));
        legacyKeys.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
        return;
      }
    }
    const data = JSON.parse(raw || '{}');
    rates = Array.isArray(data.rates) ? deduplicateRates(data.rates.map(rowToRate)) : [];
  } catch {
    rates = [];
  }
}

function saveLocal() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ rates }));
  } catch {
    throw new Error('El almacenamiento local del navegador está lleno. Ejecuta supabase/compras_exchange_rates_schema.sql para guardar los tipos de cambio en Supabase.');
  }
}

function isMissingTable(err) {
  const msg = String(err?.message || err || '');
  return /could not find the table|schema cache|does not exist|no existe la tabla/i.test(msg);
}

async function detectMode() {
  if (checked) return mode;
  checked = true;
  try {
    const { error } = await supabase.from('tax_exchange_rates').select('id').limit(1);
    if (error && isMissingTable(error)) {
      mode = 'local';
      lastError = error.message;
    } else if (error) {
      checked = false;
      throw new Error(error.message);
    } else {
      mode = 'remote';
      // Detecta si la tabla todavía guarda los TC por empresa (esquema antiguo).
      // En ese caso el portal avisa que falta ejecutar la migración global.
      const legacy = await supabase
        .from('tax_exchange_rates')
        .select('id')
        .not('company_id', 'is', null)
        .limit(1);
      legacySchema = !legacy.error && Array.isArray(legacy.data) && legacy.data.length > 0;
    }
  } catch (err) {
    if (isMissingTable(err)) {
      mode = 'local';
      lastError = String(err.message || err);
    } else {
      checked = false;
      throw err;
    }
  }
  return mode;
}

function rowToRate(row) {
  return {
    ...row,
    rate_date: normalizeDate(row.rate_date),
    currency: normalizeCurrency(row.currency),
    rate: Number(row.rate || 0),
  };
}

function sortRates(list) {
  return list.slice().sort((a, b) => {
    const byDate = String(b.rate_date || '').localeCompare(String(a.rate_date || ''));
    if (byDate) return byDate;
    return String(a.currency || '').localeCompare(String(b.currency || ''));
  });
}

async function fetchAllRemote() {
  const pageSize = 1000;
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tax_exchange_rates')
      .select('*')
      .order('rate_date', { ascending: false })
      .order('currency', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    out.push(...chunk.map(rowToRate));
    if (!chunk.length || chunk.length < pageSize) break;
    from += chunk.length;
  }
  return deduplicateRates(out);
}

/* ---------------------------------------------------------------------------
   Parser de carga masiva
   ------------------------------------------------------------------------- */

function splitDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(text) {
  const first = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  const counts = [
    ['\t', (first.match(/\t/g) || []).length],
    [';', (first.match(/;/g) || []).length],
    ['|', (first.match(/\|/g) || []).length],
    [',', (first.match(/,/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : '';
}

function looksLikeHeader(cells) {
  const joined = cells.join(' ').toLowerCase();
  return /fecha|date|d[ií]a/.test(joined)
    && /cambio|rate|valor|venta|compra|moneda|currency/.test(joined);
}

/**
 * Acepta CSV, TSV, pipe o líneas "fecha, tipo de cambio[, moneda]".
 * Devuelve { rows, skipped, warnings }.
 */
export function parseRateText(text) {
  const source = String(text || '').trim();
  if (!source) return { rows: [], skipped: 0, warnings: ['No hay texto para importar.'] };
  const delimiter = detectDelimiter(source);
  const rawRows = delimiter
    ? splitDelimited(source, delimiter)
    : source.split(/\r?\n/).map((line) => [line]);
  const rows = rawRows
    .map((cells) => cells.map((c) => String(c || '').trim()))
    .filter((cells) => cells.some((c) => c !== ''));
  if (!rows.length) return { rows: [], skipped: 0, warnings: ['No hay filas válidas.'] };

  let map = null;
  let start = 0;
  if (looksLikeHeader(rows[0])) {
    const headers = rows[0].map((h) => h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    let rateIndex = headers.findIndex((h) => /venta/.test(h) && !/fecha|date/.test(h));
    if (rateIndex < 0) {
      rateIndex = headers.findIndex((h) => /cambio|rate|valor|compra/.test(h) && !/fecha|date/.test(h));
    }
    map = {
      date: headers.findIndex((h) => /fecha|date|dia/.test(h)),
      rate: rateIndex,
      currency: headers.findIndex((h) => /moneda|currency|divisa/.test(h)),
    };
    if (map.date < 0) map.date = 0;
    if (map.rate < 0) map.rate = 1;
    start = 1;
  }

  const out = new Map();
  let skipped = 0;
  const warnings = [];

  for (let i = start; i < rows.length; i += 1) {
    const cells = rows[i];
    let dateValue;
    let rateValue;
    let currencyValue = '';
    if (map) {
      dateValue = cells[map.date];
      rateValue = cells[map.rate];
      currencyValue = map.currency >= 0 ? cells[map.currency] : '';
    } else if (cells.length >= 3 && /^\d+(\.\d+)?$/.test(cells[1].replace(',', '.')) && /^\d+(\.\d+)?$/.test(cells[2].replace(',', '.'))) {
      // Formato típico SUNAT: Día / Compra / Venta -> Venta para solarización
      dateValue = cells[0];
      rateValue = cells[2]; // Venta oficial para solarización
      currencyValue = cells[3] || 'USD';
    } else if (cells.length >= 2) {
      dateValue = cells[0];
      rateValue = cells[1];
      currencyValue = cells[2] || '';
    } else if (cells.length === 1) {
      const parts = cells[0].trim().split(/\s+/);
      if (parts.length >= 3 && /^\d+(\.\d+)?$/.test(parts[1].replace(',', '.')) && /^\d+(\.\d+)?$/.test(parts[2].replace(',', '.'))) {
        dateValue = parts[0];
        rateValue = parts[2]; // Venta oficial para solarización
        currencyValue = parts[3] || 'USD';
      } else if (parts.length >= 2) {
        dateValue = parts[0];
        rateValue = parts[1];
        currencyValue = parts[2] || 'USD';
      } else {
        skipped += 1;
        continue;
      }
    } else {
      skipped += 1;
      continue;
    }
    const rateDate = normalizeDate(dateValue);
    const rate = parseRateNumber(rateValue);
    if (!rateDate || !(rate > 0)) { skipped += 1; continue; }
    const currency = normalizeCurrency(currencyValue);
    if (currency === 'PEN') { skipped += 1; continue; }
    out.set(`${rateDate}|${currency}`, { rate_date: rateDate, currency, rate, source: 'import' });
  }

  const result = [...out.values()].sort((a, b) => a.rate_date.localeCompare(b.rate_date));
  if (!result.length) warnings.push('No se encontraron fechas y tipos de cambio válidos.');
  return { rows: result, skipped, warnings };
}

/* ---------------------------------------------------------------------------
   Tipo de cambio automático desde el BCRP
   ----------------------------------------------------------------------------
   Serie PD04640PD = "Tipo de cambio - TC Sistema bancario SBS (S/ por US$)
   - Venta", la que se usa para convertir operaciones en moneda extranjera.

   La API del BCRP no envía cabeceras CORS, así que el navegador no puede
   llamarla directamente. Se intentan tres vías, en este orden:

     1. Edge Function propia (`bcrp-rates`): lectura del lado servidor.
     2. `data/tc-bcrp.json`: archivo del propio portal, actualizado a diario
        por GitHub Actions (mismo origen, sin CORS).
     3. Llamada directa al BCRP (solo funcionaría si algún día abren CORS).
   ------------------------------------------------------------------------- */

const BCRP_SERIES = 'PD04639PD-PD04640PD';
const BCRP_BASE = 'https://estadisticas.bcrp.gob.pe/estadisticas/series/api';

const BCRP_MONTHS = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

/** Convierte "02.Nov.26" (formato del BCRP) a "2026-11-02". */
function bcrpIsoDate(label) {
  const text = String(label || '').trim();
  let match = text.match(/^(\d{1,2})[.\-/]([A-Za-zÁÉÍÓÚáéíóú]{3,})[.\-/](\d{2,4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = BCRP_MONTHS[match[2].toLowerCase().slice(0, 3)];
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    if (!month) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  }
  return '';
}

/**
 * Normaliza la respuesta del BCRP (`periods`) o del JSON estático (`rates`)
 * a filas listas para `importRows()`.
 *
 * Aplica la regla SUNAT:
 *   - Para solarización de comprobantes (compras o ventas) rige la tasa VENTA de la SBS.
 *   - Fines de semana y feriados arrastran el último tipo de cambio hábil anterior.
 *   - Todos los días calendario del mes quedan cubiertos.
 */
export function parseBcrpPayload(payload, targetPrefix = '') {
  const rows = [];
  if (!payload || typeof payload !== 'object') return rows;

  if (Array.isArray(payload.periods)) {
    const business = new Map();
    for (const period of payload.periods) {
      const rateDate = bcrpIsoDate(period?.name);
      if (!rateDate) continue;
      const v0 = String((period?.values || [])[0] ?? '').trim();
      const v1 = String((period?.values || [])[1] ?? '').trim();

      const c = /^\d+(\.\d+)?$/.test(v0) ? Number(v0) : 0;
      const v = /^\d+(\.\d+)?$/.test(v1) ? Number(v1) : (c || 0);

      const compra = c > 0 ? c : v;
      const venta = v > 0 ? v : c;

      if (compra > 0 || venta > 0) {
        business.set(rateDate, { compra, venta });
      }
    }
    if (!business.size) return rows;

    const sorted = [...business.keys()].sort();
    const lastHabil = sorted[sorted.length - 1];
    const todayIso = new Date().toISOString().slice(0, 10);

    let targetEnd = lastHabil;
    if (targetPrefix) {
      const parts = targetPrefix.split('-');
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      if (y && m) {
        const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const endOfMonthIso = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
        const maxDate = todayIso < endOfMonthIso ? todayIso : endOfMonthIso;
        if (maxDate > targetEnd) targetEnd = maxDate;
      }
    } else if (todayIso > targetEnd) {
      targetEnd = todayIso;
    }

    const start = new Date(`${sorted[0]}T00:00:00Z`);
    const end = new Date(`${targetEnd}T00:00:00Z`);
    let last = null;

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      // Regla SUNAT: el tipo de cambio oficial para la fecha calendario `iso`
      // es la cotización de cierre del último día hábil anterior (last).
      if (last) {
        if (!targetPrefix || iso.startsWith(targetPrefix)) {
          // Para solarización de comprobantes rige el tipo de cambio VENTA oficial
          const rate = last.venta > 0 ? last.venta : last.compra;
          rows.push({
            rate_date: iso,
            currency: 'USD',
            rate,
            compra: last.compra,
            venta: last.venta,
            source: 'sunat',
          });
        }
      }
      // Al cierre de las operaciones del día hábil, la tasa rige a partir del día siguiente
      if (business.has(iso)) {
        last = business.get(iso);
      }
    }
    return rows;
  }

  if (payload.rates && typeof payload.rates === 'object') {
    for (const [date, value] of Object.entries(payload.rates)) {
      const rateDate = normalizeDate(date);
      if (targetPrefix && !rateDate.startsWith(targetPrefix)) continue;
      let compra = 0;
      let venta = 0;
      if (typeof value === 'object' && value !== null) {
        compra = Number(value.compra || 0);
        venta = Number(value.venta || 0);
      } else {
        compra = Number(value || 0);
        venta = compra;
      }
      // Rige el tipo de cambio VENTA para solarización
      const rate = venta > 0 ? venta : compra;
      if (!rateDate || !(rate > 0)) continue;
      rows.push({
        rate_date: rateDate,
        currency: 'USD',
        rate,
        compra: compra || rate,
        venta: venta || rate,
        source: 'sunat',
      });
    }
  }
  return rows;
}

function bcrpMonthRange(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  // Consultar desde 15 días antes para arrastrar el tipo de cambio del último día hábil anterior
  const prevDate = new Date(Date.UTC(year, month - 1, 1));
  prevDate.setUTCDate(prevDate.getUTCDate() - 15);
  return {
    fetchStart: prevDate.toISOString().slice(0, 10),
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    prefix: `${year}-${mm}`,
  };
}

async function bcrpFromEdge(year, month) {
  const { prefix } = bcrpMonthRange(year, month);
  const url = `${SUPABASE_URL}/functions/v1/bcrp-rates?year=${year}&month=${month}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = parseBcrpPayload(await res.json(), prefix);
  if (!rows.length) throw new Error('sin tasas en la respuesta');
  return rows;
}

async function bcrpFromStatic(year, month) {
  const { prefix } = bcrpMonthRange(year, month);
  const url = new URL('data/tc-bcrp.json', document.baseURI);
  url.searchParams.set('v', String(Date.now()));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rows = parseBcrpPayload(data, prefix);
  if (!rows.length) throw new Error('ese mes no está en el archivo local');
  return { rows, updatedAt: String(data.updatedAt || '') };
}

async function bcrpFromDirect(year, month) {
  const { fetchStart, end, prefix } = bcrpMonthRange(year, month);
  const url = `${BCRP_BASE}/${BCRP_SERIES}/json/${fetchStart}/${end}/ing`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let clean = text.trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) clean = clean.substring(firstBrace, lastBrace + 1);
  const rows = parseBcrpPayload(JSON.parse(clean), prefix);
  if (!rows.length) throw new Error('sin tasas en la respuesta');
  return rows;
}

/**
 * Obtiene los tipos de cambio USD de un mes.
 * @returns {Promise<{rows: Array, transport: string, year: number, month: number, updatedAt?: string, errors: string[]}>}
 */
export async function fetchBcrpRates({ year, month } = {}) {
  const now = new Date();
  const y = Number(year) || now.getFullYear();
  const m = Number(month) || (now.getMonth() + 1);
  const errors = [];

  try {
    return { rows: await bcrpFromEdge(y, m), transport: 'edge', year: y, month: m, errors };
  } catch (err) {
    errors.push(`servidor: ${err.message || err}`);
  }

  try {
    const res = await bcrpFromStatic(y, m);
    return { rows: res.rows, transport: 'static', updatedAt: res.updatedAt, year: y, month: m, errors };
  } catch (err) {
    errors.push(`archivo local: ${err.message || err}`);
  }

  try {
    return { rows: await bcrpFromDirect(y, m), transport: 'direct', year: y, month: m, errors };
  } catch (err) {
    errors.push(`BCRP: ${err.message || err}`);
  }

  const error = new Error('No se pudo obtener el tipo de cambio del BCRP.');
  error.details = errors;
  throw error;
}

export const exchangeRateService = {
  get mode() { return mode; },
  get lastError() { return lastError; },
  get legacySchema() { return legacySchema; },

  async refresh() {
    await detectMode();
    if (mode === 'local') {
      loadLocal();
      return;
    }
    rates = await fetchAllRemote();

    // Migra automáticamente los tipos de cambio creados en modo local si existen
    let raw = null;
    try { raw = localStorage.getItem(LOCAL_STORAGE_KEY); } catch { raw = null; }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const localRows = Array.isArray(parsed.rates) ? parsed.rates : [];
        if (localRows.length) await exchangeRateService.importRows(localRows, { source: 'local' });
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      } catch (err) {
        lastError = `No se pudieron migrar los tipos de cambio locales: ${err.message || err}`;
      }
    }
  },

  all() {
    return sortRates(rates);
  },

  list(search = '') {
    const q = String(search || '').trim().toLowerCase();
    let out = rates;
    if (q) {
      out = out.filter((r) => [r.rate_date, r.currency, r.source]
        .some((v) => String(v || '').toLowerCase().includes(q)));
    }
    return sortRates(out);
  },

  getById(id) {
    return rates.find((r) => r.id === id) || null;
  },

  /** Tipo de cambio exacto o el último publicado antes de la fecha. */
  rateFor(date, currency = 'USD') {
    const cur = normalizeCurrency(currency);
    if (cur === 'PEN') return { rate: 1, rate_date: normalizeDate(date), currency: 'PEN' };
    const target = normalizeDate(date);
    if (!target) return null;
    const candidates = rates.filter((r) => r.currency === cur);
    const exact = candidates.find((r) => r.rate_date === target);
    if (exact) return exact;
    const previous = candidates
      .filter((r) => r.rate_date && r.rate_date <= target)
      .sort((a, b) => b.rate_date.localeCompare(a.rate_date))[0];
    return previous || null;
  },

  /**
   * Asigna el tipo de cambio a los comprobantes en moneda extranjera que no lo
   * tienen. Devuelve los registros modificados para poder persistirlos.
   */
  applyMissingRates(records) {
    let assigned = 0;
    let missing = 0;
    let converted = 0;
    const changed = [];
    (records || []).forEach((rec) => {
      if (isSolarized(rec)) return; // ya está en soles
      const currency = String(rec.currency || 'PEN').toUpperCase();
      if (currency === 'PEN') return;
      const isSire = String(rec.source || '') === 'sire';
      let rate = Number(rec.exchange_rate || 0);
      if (!(rate > 1)) {
        const found = this.rateFor(rec.issue_date, currency);
        if (!found || !(found.rate > 0)) {
          missing += 1;
          return;
        }
        rate = Number(found.rate);
      } else if (!isSire) {
        return; // manual con TC propio: no requiere regularización
      }
      const patch = { id: rec.id, exchange_rate: rate };
      if (isSire) {
        // El SIRE no trajo TC: sus importes están en la divisa original.
        // Al asignar el TC se convierten a soles una sola vez.
        Object.assign(patch, convertAmountsToSoles(rec, rate));
        patch.raw = markSolarized(rec, rate);
        converted += 1;
      }
      Object.assign(rec, patch);
      assigned += 1;
      changed.push(patch);
    });
    return { assigned, missing, converted, changed };
  },

  async create(input) {
    await detectMode();
    const rec = cleanRate(input);
    if (!rec.rate_date) throw new Error('Ingresa una fecha válida.');
    if (!(rec.rate > 0)) throw new Error('Ingresa un tipo de cambio mayor a cero.');
    if (rec.currency === 'PEN') throw new Error('El tipo de cambio se registra solo para moneda extranjera.');
    if (rates.some((r) => r.rate_date === rec.rate_date && r.currency === rec.currency)) {
      throw new Error('Ya existe un tipo de cambio para esa fecha y moneda.');
    }
    if (mode === 'local') {
      const row = { ...rec, id: uid(), created_at: nowIso(), updated_at: nowIso() };
      const prev = rates;
      rates = deduplicateRates([...rates, row]);
      try { saveLocal(); } catch (err) { rates = prev; throw err; }
      return row;
    }

    const companyId = cid();
    let payload = {
      company_id: null,
      rate_date: rec.rate_date,
      currency: rec.currency,
      rate: rec.rate,
      source: rec.source || 'manual',
    };
    let { data, error } = await supabase.from('tax_exchange_rates').insert(payload).select().single();
    if (error && (error.code === '23502' || /not-null|company_id/i.test(error.message))) {
      legacySchema = true;
      payload.company_id = companyId;
      const retry = await supabase.from('tax_exchange_rates').insert(payload).select().single();
      if (retry.error) throw new Error(retry.error.message);
      data = retry.data;
    } else if (error) {
      throw new Error(error.message);
    }
    const row = rowToRate(data);
    rates = deduplicateRates([row, ...rates]);
    return row;
  },

  async update(id, patch) {
    await detectMode();
    const current = rates.find((r) => r.id === id);
    if (!current) throw new Error('Tipo de cambio no encontrado.');
    const merged = cleanRate({ ...current, ...patch });
    if (!merged.rate_date) throw new Error('Ingresa una fecha válida.');
    if (!(merged.rate > 0)) throw new Error('Ingresa un tipo de cambio mayor a cero.');
    if (merged.currency === 'PEN') throw new Error('El tipo de cambio se registra solo para moneda extranjera.');
    if (rates.some((r) => r.id !== id && r.rate_date === merged.rate_date && r.currency === merged.currency)) {
      throw new Error('Ya existe otro tipo de cambio para esa fecha y moneda.');
    }
    if (mode === 'local') {
      const i = rates.findIndex((r) => r.id === id);
      const prev = rates[i];
      const row = { ...current, ...merged, updated_at: nowIso() };
      rates[i] = row;
      try { saveLocal(); } catch (err) { rates[i] = prev; throw err; }
      return row;
    }
    const { data, error } = await supabase
      .from('tax_exchange_rates')
      .update({
        rate_date: merged.rate_date,
        currency: merged.currency,
        rate: merged.rate,
        source: merged.source || 'manual',
        updated_at: nowIso(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const row = rowToRate(data);
    const i = rates.findIndex((r) => r.id === id);
    if (i >= 0) rates[i] = row;
    return row;
  },

  async remove(id) {
    await detectMode();
    const current = rates.find((r) => r.id === id);
    if (mode === 'local') {
      const prev = rates;
      rates = rates.filter((r) => r.id !== id);
      try { saveLocal(); } catch (err) { rates = prev; throw err; }
      return;
    }
    if (current?.rate_date && current?.currency) {
      const { error } = await supabase
        .from('tax_exchange_rates')
        .delete()
        .eq('rate_date', current.rate_date)
        .eq('currency', current.currency);
      if (error) throw new Error(error.message);
      rates = rates.filter((r) => !(r.rate_date === current.rate_date && r.currency === current.currency));
    } else {
      const { error } = await supabase.from('tax_exchange_rates').delete().eq('id', id);
      if (error) throw new Error(error.message);
      rates = rates.filter((r) => r.id !== id);
    }
  },

  /**
   * Elimina tipos de cambio en un rango de fechas [startDate, endDate] de golpe.
   * @param {string} startDate - 'YYYY-MM-DD'
   * @param {string} endDate - 'YYYY-MM-DD'
   * @returns {Promise<{count: number, startDate: string, endDate: string}>}
   */
  async removeRange(startDate, endDate) {
    const start = normalizeDate(startDate);
    const end = normalizeDate(endDate);
    if (!start || !end) throw new Error('Ingresa un rango de fechas válido (Desde y Hasta).');
    if (start > end) throw new Error('La fecha inicial no puede ser mayor que la fecha final.');

    await detectMode();
    const matching = rates.filter((r) => r.rate_date >= start && r.rate_date <= end);
    const count = matching.length;
    if (!count) return { count: 0, startDate: start, endDate: end };

    if (mode === 'local') {
      const prev = rates;
      rates = rates.filter((r) => !(r.rate_date >= start && r.rate_date <= end));
      try { saveLocal(); } catch (err) { rates = prev; throw err; }
      return { count, startDate: start, endDate: end };
    }

    const { error } = await supabase
      .from('tax_exchange_rates')
      .delete()
      .gte('rate_date', start)
      .lte('rate_date', end);

    if (error) throw new Error(error.message);
    rates = rates.filter((r) => !(r.rate_date >= start && r.rate_date <= end));
    return { count, startDate: start, endDate: end };
  },

  /**
   * Elimina todos los tipos de cambio de un mes específico (año y mes) de golpe.
   * @param {number|string} year
   * @param {number|string} month
   * @returns {Promise<{count: number, prefix: string}>}
   */
  async removeMonth(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!y || !m || m < 1 || m > 12) throw new Error('Año o mes no válido.');
    const prefix = `${y}-${String(m).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const startDate = `${prefix}-01`;
    const endDate = `${prefix}-${String(lastDay).padStart(2, '0')}`;
    const res = await this.removeRange(startDate, endDate);
    return { ...res, prefix };
  },

  async importRows(rows, options = {}) {
    const source = String(options.source || 'import');
    const preparedMap = new Map();
    let skipped = 0;
    for (const raw of rows || []) {
      const rec = cleanRate({ ...raw, source: raw.source || source });
      if (!rec.rate_date || !(rec.rate > 0) || rec.currency === 'PEN') { skipped += 1; continue; }
      preparedMap.set(`${rec.rate_date}|${rec.currency}`, rec);
    }
    const prepared = [...preparedMap.values()];
    if (!prepared.length) return { created: 0, updated: 0, skipped, total: 0 };
    await detectMode();

    const existingByKey = new Map(rates.map((r) => [`${r.rate_date}|${r.currency}`, r]));
    let created = 0;
    let updated = 0;
    const normalized = prepared.map((rec) => {
      const existing = existingByKey.get(`${rec.rate_date}|${rec.currency}`);
      if (existing) {
        updated += 1;
        return {
          ...existing,
          ...rec,
          id: existing.id,
          source: existing.source === 'manual' ? 'manual' : (rec.source || existing.source),
        };
      }
      created += 1;
      return rec;
    });

    if (mode === 'local') {
      const prev = rates;
      const next = rates.slice();
      normalized.forEach((rec) => {
        const i = next.findIndex((r) => r.rate_date === rec.rate_date && r.currency === rec.currency);
        if (i >= 0) next[i] = { ...next[i], ...rec, updated_at: nowIso() };
        else next.push({ ...rec, id: uid(), created_at: nowIso(), updated_at: nowIso() });
      });
      rates = deduplicateRates(next);
      try { saveLocal(); } catch (err) { rates = prev; throw err; }
      return { created, updated, skipped, total: normalized.length };
    }

    const companyId = cid();
    for (let i = 0; i < normalized.length; i += 100) {
      const slice = normalized.slice(i, i + 100);

      const toUpdate = slice.filter((rec) => rec.id);
      const toInsert = slice.filter((rec) => !rec.id);

      if (toUpdate.length) {
        const updateTasks = toUpdate.map((rec) =>
          supabase
            .from('tax_exchange_rates')
            .update({
              rate: rec.rate,
              source: rec.source || 'sunat',
              updated_at: nowIso(),
            })
            .eq('id', rec.id)
        );
        const results = await Promise.all(updateTasks);
        const err = results.find((r) => r.error)?.error;
        if (err) throw new Error(err.message);
      }

      if (toInsert.length) {
        const globalChunk = toInsert.map((rec) => ({
          company_id: null,
          rate_date: rec.rate_date,
          currency: rec.currency,
          rate: rec.rate,
          source: rec.source || 'sunat',
        }));

        let { error } = await supabase.from('tax_exchange_rates').insert(globalChunk);
        if (error && (error.code === '23502' || /not-null|company_id/i.test(error.message))) {
          legacySchema = true;
          const fallbackChunk = toInsert.map((rec) => ({
            company_id: companyId,
            rate_date: rec.rate_date,
            currency: rec.currency,
            rate: rec.rate,
            source: rec.source || 'sunat',
          }));
          const retry = await supabase
            .from('tax_exchange_rates')
            .upsert(fallbackChunk, { onConflict: 'company_id,rate_date,currency' });
          if (retry.error) throw new Error(retry.error.message);
        } else if (error) {
          throw new Error(error.message);
        }
      }
    }
    rates = await fetchAllRemote();
    return { created, updated, skipped, total: normalized.length };
  },

  modelCsv() {
    return `\uFEFF${MODEL_HEADERS.join(',')}\r\n`;
  },

  parseText: parseRateText,

  /** Descarga el tipo de cambio USD del BCRP para un mes (año/mes). */
  fetchFromBCRP: fetchBcrpRates,
};
