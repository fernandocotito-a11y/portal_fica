/* ============================================================================
   exchangeRateService.js — Tipos de cambio SUNAT por fecha
   ----------------------------------------------------------------------------
   Guarda los tipos de cambio en Supabase (tax_exchange_rates) y, si la tabla
   todavía no existe, en localStorage. Permite carga masiva por CSV/TXT, pegado
   desde Excel, CRUD y búsqueda del tipo de cambio por fecha/moneda.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { isSolarized } from './comprasConfig.js';

const MODEL_HEADERS = ['Fecha', 'Tipo de Cambio', 'Moneda'];
const VALID_CURRENCIES = new Set(['USD', 'EUR', 'PEN']);

let rates = [];
let mode = 'unknown';
let checked = false;
let lastError = '';

function cid() {
  const company = authService.activeCompany();
  return company ? company.id : null;
}

function localKey(companyId) {
  return `fica.exchange_rates.${companyId}`;
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

function loadLocal(companyId) {
  try {
    const data = JSON.parse(localStorage.getItem(localKey(companyId)) || '{}');
    rates = Array.isArray(data.rates) ? data.rates : [];
  } catch {
    rates = [];
  }
}

function saveLocal(companyId) {
  try {
    localStorage.setItem(localKey(companyId), JSON.stringify({ rates }));
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

async function fetchAllRemote(companyId) {
  const pageSize = 1000;
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tax_exchange_rates')
      .select('*')
      .eq('company_id', companyId)
      .order('rate_date', { ascending: false })
      .order('currency', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    out.push(...chunk.map(rowToRate));
    if (!chunk.length) break;
    from += chunk.length;
  }
  return out;
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
    } else if (cells.length >= 2) {
      dateValue = cells[0];
      rateValue = cells[1];
      currencyValue = cells[2] || '';
    } else if (cells.length === 1) {
      const match = cells[0].match(/^(\S+)\s+([\d.,]+)$/);
      if (!match) { skipped += 1; continue; }
      dateValue = match[1];
      rateValue = match[2];
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

export const exchangeRateService = {
  get mode() { return mode; },
  get lastError() { return lastError; },

  async refresh() {
    const companyId = cid();
    if (!companyId) { rates = []; return; }
    await detectMode();
    if (mode === 'local') {
      loadLocal(companyId);
      return;
    }
    rates = await fetchAllRemote(companyId);
    // Migra automáticamente los tipos de cambio creados en modo local.
    let raw = null;
    try { raw = localStorage.getItem(localKey(companyId)); } catch { raw = null; }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const localRows = Array.isArray(parsed.rates) ? parsed.rates : [];
        if (localRows.length) await exchangeRateService.importRows(localRows, { source: 'local' });
        localStorage.removeItem(localKey(companyId));
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
    const changed = [];
    (records || []).forEach((rec) => {
      if (isSolarized(rec)) return; // SIRE ya viene en soles
      const currency = String(rec.currency || 'PEN').toUpperCase();
      if (currency === 'PEN') return;
      if (Number(rec.exchange_rate) > 1) return;
      const found = this.rateFor(rec.issue_date, currency);
      if (found && found.rate > 0) {
        rec.exchange_rate = found.rate;
        assigned += 1;
        changed.push(rec);
      } else {
        missing += 1;
      }
    });
    return { assigned, missing, changed };
  },

  async create(input) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const rec = cleanRate(input);
    if (!rec.rate_date) throw new Error('Ingresa una fecha válida.');
    if (!(rec.rate > 0)) throw new Error('Ingresa un tipo de cambio mayor a cero.');
    if (rec.currency === 'PEN') throw new Error('El tipo de cambio se registra solo para moneda extranjera.');
    if (rates.some((r) => r.rate_date === rec.rate_date && r.currency === rec.currency)) {
      throw new Error('Ya existe un tipo de cambio para esa fecha y moneda.');
    }
    if (mode === 'local') {
      const row = { ...rec, id: uid(), company_id: companyId, created_at: nowIso(), updated_at: nowIso() };
      const prev = rates;
      rates = [...rates, row];
      try { saveLocal(companyId); } catch (err) { rates = prev; throw err; }
      return row;
    }
    const { data, error } = await supabase
      .from('tax_exchange_rates')
      .insert({ ...rec, company_id: companyId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const row = rowToRate(data);
    rates.push(row);
    return row;
  },

  async update(id, patch) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
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
      try { saveLocal(companyId); } catch (err) { rates[i] = prev; throw err; }
      return row;
    }
    const { data, error } = await supabase
      .from('tax_exchange_rates')
      .update({ ...merged, updated_at: nowIso() })
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
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    if (mode === 'local') {
      const prev = rates;
      rates = rates.filter((r) => r.id !== id);
      try { saveLocal(companyId); } catch (err) { rates = prev; throw err; }
      return;
    }
    const { error } = await supabase.from('tax_exchange_rates').delete().eq('id', id);
    if (error) throw new Error(error.message);
    rates = rates.filter((r) => r.id !== id);
  },

  async importRows(rows, options = {}) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
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
        else next.push({ ...rec, id: uid(), company_id: companyId, created_at: nowIso(), updated_at: nowIso() });
      });
      rates = next;
      try { saveLocal(companyId); } catch (err) { rates = prev; throw err; }
      return { created, updated, skipped, total: normalized.length };
    }

    for (let i = 0; i < normalized.length; i += 300) {
      const chunk = normalized.slice(i, i + 300).map((rec) => {
        const out = { ...rec, company_id: companyId };
        delete out.id;
        delete out.created_at;
        delete out.updated_at;
        return out;
      });
      const { error } = await supabase
        .from('tax_exchange_rates')
        .upsert(chunk, { onConflict: 'company_id,rate_date,currency' });
      if (error) throw new Error(error.message);
    }
    rates = await fetchAllRemote(companyId);
    return { created, updated, skipped, total: normalized.length };
  },

  modelCsv() {
    return `\uFEFF${MODEL_HEADERS.join(',')}\r\n`;
  },

  parseText: parseRateText,
};
