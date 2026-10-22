/* ============================================================================
   supplierService.js — Directorio de proveedores del Registro de Compras
   ----------------------------------------------------------------------------
   Guarda los proveedores en Supabase (tax_suppliers) y, si la tabla todavía no
   existe, en localStorage. Permite alta, edición, eliminación y carga masiva
   desde texto pegado o archivo CSV/TXT.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { DOC_ID_TYPES } from './comprasConfig.js';

const VALID_DOC_TYPES = new Set(DOC_ID_TYPES.map((d) => d.value));
const MODEL_HEADERS = [
  'Tipo Doc Identidad', 'Nro Doc Identidad', 'Razon Social',
  'Nombre Comercial', 'Correo', 'Telefono', 'Direccion',
];

let suppliers = [];
let mode = 'unknown';
let checked = false;
let lastError = '';

function cid() {
  const company = authService.activeCompany();
  return company ? company.id : null;
}

function localKey(companyId) {
  return `fica.suppliers.${companyId}`;
}

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDoc(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function inferDocType(doc, provided) {
  const type = String(provided || '').trim().toUpperCase();
  if (VALID_DOC_TYPES.has(type)) return type;
  if (/^\d{11}$/.test(doc)) return '6';
  if (/^\d{8}$/.test(doc)) return '1';
  return '6';
}

function cleanSupplier(input) {
  const doc = normalizeDoc(input.doc_id_number);
  return {
    doc_id_type: inferDocType(doc, input.doc_id_type),
    doc_id_number: doc,
    name: String(input.name || '').trim().replace(/\s+/g, ' '),
    trade_name: String(input.trade_name || '').trim().replace(/\s+/g, ' '),
    address: String(input.address || '').trim(),
    email: String(input.email || '').trim(),
    phone: String(input.phone || '').trim(),
    source: String(input.source || 'manual').trim() || 'manual',
  };
}

function loadLocal(companyId) {
  try {
    const data = JSON.parse(localStorage.getItem(localKey(companyId)) || '{}');
    suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  } catch {
    suppliers = [];
  }
}

function saveLocal(companyId) {
  try {
    localStorage.setItem(localKey(companyId), JSON.stringify({ suppliers }));
  } catch {
    throw new Error('El almacenamiento local del navegador está lleno. Ejecuta supabase/compras_suppliers_schema.sql para guardar los proveedores en Supabase.');
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
    const { error } = await supabase.from('tax_suppliers').select('id').limit(1);
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

function rowToSupplier(row) {
  return {
    ...row,
    doc_id_number: normalizeDoc(row.doc_id_number),
  };
}

function sortSuppliers(list) {
  return list.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
}

async function fetchAllRemote(companyId) {
  const pageSize = 1000;
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tax_suppliers')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    out.push(...chunk.map(rowToSupplier));
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

function headerIndex(headers, patterns) {
  for (let i = 0; i < headers.length; i += 1) {
    const h = headers[i];
    if (patterns.every((p) => p.test(h))) return i;
  }
  return -1;
}

function looksLikeHeader(cells) {
  const joined = cells.join(' ').toLowerCase();
  return /ruc|documento|razon social|razón social|nombre|correo|telefono|teléfono|direccion|dirección/.test(joined);
}

/**
 * Acepta CSV, TSV, pipe o líneas "RUC, razón social".
 * Devuelve { rows, skipped, warnings }.
 */
export function parseSupplierText(text) {
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
    map = {
      docType: headerIndex(headers, [/tipo/, /doc/]),
      doc: headers.findIndex((h) => /(nro|numero|número|documento|ruc|dni)/.test(h) && !/tipo/.test(h)),
      name: headers.findIndex((h) => /(razon|razón|nombre)/.test(h) && !/comercial/.test(h)),
      trade: headerIndex(headers, [/comercial/]),
      email: headerIndex(headers, [/correo|email/]),
      phone: headerIndex(headers, [/telefono|teléfono|celular/]),
      address: headerIndex(headers, [/direccion|dirección/]),
    };
    if (map.doc < 0) map.doc = 0;
    if (map.name < 0) map.name = 1;
    start = 1;
  }

  const out = [];
  const seen = new Set();
  let skipped = 0;
  const warnings = [];

  for (let i = start; i < rows.length; i += 1) {
    const cells = rows[i];
    let row;
    if (map) {
      row = {
        doc_id_type: map.docType >= 0 ? cells[map.docType] : '',
        doc_id_number: cells[map.doc] || '',
        name: cells[map.name] || '',
        trade_name: map.trade >= 0 ? cells[map.trade] : '',
        email: map.email >= 0 ? cells[map.email] : '',
        phone: map.phone >= 0 ? cells[map.phone] : '',
        address: map.address >= 0 ? cells[map.address] : '',
        source: 'import',
      };
    } else if (cells.length === 1) {
      const match = cells[0].match(/^([A-Za-z0-9-]{6,20})\s+(.+)$/);
      if (!match) { skipped += 1; continue; }
      row = { doc_id_number: match[1], name: match[2], source: 'import' };
    } else {
      const first = String(cells[0] || '').toUpperCase();
      const hasType = VALID_DOC_TYPES.has(first) && cells.length >= 3;
      row = hasType
        ? { doc_id_type: first, doc_id_number: cells[1], name: cells[2], trade_name: cells[3] || '', email: cells[4] || '', phone: cells[5] || '', address: cells[6] || '', source: 'import' }
        : { doc_id_number: cells[0], name: cells[1], trade_name: cells[2] || '', email: cells[3] || '', phone: cells[4] || '', address: cells[5] || '', source: 'import' };
    }
    const clean = cleanSupplier(row);
    if (!clean.doc_id_number || !clean.name) { skipped += 1; continue; }
    if (seen.has(clean.doc_id_number)) { skipped += 1; continue; }
    seen.add(clean.doc_id_number);
    out.push(clean);
  }

  if (!out.length) warnings.push('No se encontraron proveedores con documento y razón social.');
  return { rows: out, skipped, warnings };
}

export const supplierService = {
  get mode() { return mode; },
  get lastError() { return lastError; },

  async refresh() {
    const companyId = cid();
    if (!companyId) { suppliers = []; return; }
    await detectMode();
    if (mode === 'local') {
      loadLocal(companyId);
    } else {
      suppliers = await fetchAllRemote(companyId);
      // Si el usuario ya había creado proveedores en modo local, se migran
      // automáticamente la primera vez que la tabla remota está disponible.
      let raw = null;
      try { raw = localStorage.getItem(localKey(companyId)); } catch { raw = null; }
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const localRows = Array.isArray(parsed.suppliers) ? parsed.suppliers : [];
          if (localRows.length) {
            await supplierService.importRows(localRows, { source: 'local' });
          }
          localStorage.removeItem(localKey(companyId));
        } catch (err) {
          lastError = `No se pudieron migrar los proveedores locales: ${err.message || err}`;
        }
      }
    }
  },

  all() {
    return sortSuppliers(suppliers);
  },

  list(search = '') {
    const q = String(search || '').trim().toLowerCase();
    let out = suppliers;
    if (q) {
      out = out.filter((s) => [s.doc_id_number, s.name, s.trade_name, s.email, s.phone, s.address]
        .some((v) => String(v || '').toLowerCase().includes(q)));
    }
    return sortSuppliers(out);
  },

  getById(id) {
    return suppliers.find((s) => s.id === id) || null;
  },

  getByDoc(doc) {
    const key = normalizeDoc(doc);
    if (!key) return null;
    return suppliers.find((s) => s.doc_id_number === key) || null;
  },

  async create(input) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const rec = cleanSupplier(input);
    if (!rec.doc_id_number) throw new Error('Ingresa el documento del proveedor.');
    if (!rec.name) throw new Error('Ingresa la razón social del proveedor.');
    if (suppliers.some((s) => s.doc_id_number === rec.doc_id_number)) {
      throw new Error('Ya existe un proveedor con ese documento.');
    }
    if (mode === 'local') {
      const row = { ...rec, id: uid(), company_id: companyId, created_at: nowIso(), updated_at: nowIso() };
      const prev = suppliers;
      suppliers = [...suppliers, row];
      try { saveLocal(companyId); } catch (err) { suppliers = prev; throw err; }
      return row;
    }
    const { data, error } = await supabase
      .from('tax_suppliers')
      .insert({ ...rec, company_id: companyId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const row = rowToSupplier(data);
    suppliers.push(row);
    return row;
  },

  async update(id, patch) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const current = suppliers.find((s) => s.id === id);
    if (!current) throw new Error('Proveedor no encontrado.');
    const merged = cleanSupplier({ ...current, ...patch });
    if (!merged.doc_id_number) throw new Error('Ingresa el documento del proveedor.');
    if (!merged.name) throw new Error('Ingresa la razón social del proveedor.');
    if (suppliers.some((s) => s.id !== id && s.doc_id_number === merged.doc_id_number)) {
      throw new Error('Ya existe otro proveedor con ese documento.');
    }
    if (mode === 'local') {
      const i = suppliers.findIndex((s) => s.id === id);
      const prev = suppliers[i];
      const row = { ...current, ...merged, updated_at: nowIso() };
      suppliers[i] = row;
      try { saveLocal(companyId); } catch (err) { suppliers[i] = prev; throw err; }
      return row;
    }
    const { data, error } = await supabase
      .from('tax_suppliers')
      .update({ ...merged, updated_at: nowIso() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const row = rowToSupplier(data);
    const i = suppliers.findIndex((s) => s.id === id);
    if (i >= 0) suppliers[i] = row;
    return row;
  },

  async remove(id) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    if (mode === 'local') {
      const prev = suppliers;
      suppliers = suppliers.filter((s) => s.id !== id);
      try { saveLocal(companyId); } catch (err) { suppliers = prev; throw err; }
      return;
    }
    const { error } = await supabase.from('tax_suppliers').delete().eq('id', id);
    if (error) throw new Error(error.message);
    suppliers = suppliers.filter((s) => s.id !== id);
  },

  /**
   * Inserta o actualiza proveedores en bloque.
   * `rows` puede venir de parseSupplierText o de una importación SIRE.
   */
  async importRows(rows, options = {}) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    const source = String(options.source || 'import');
    const prepared = [];
    const seen = new Set();
    let skipped = 0;
    for (const raw of rows || []) {
      const rec = cleanSupplier({ ...raw, source: raw.source || source });
      if (!rec.doc_id_number || !rec.name) { skipped += 1; continue; }
      if (seen.has(rec.doc_id_number)) { skipped += 1; continue; }
      seen.add(rec.doc_id_number);
      prepared.push(rec);
    }
    if (!prepared.length) return { created: 0, updated: 0, skipped, total: 0 };
    await detectMode();

    const existingByDoc = new Map(suppliers.map((s) => [s.doc_id_number, s]));
    let created = 0;
    let updated = 0;
    const normalized = prepared.map((rec) => {
      const existing = existingByDoc.get(rec.doc_id_number);
      if (existing) {
        updated += 1;
        return {
          ...existing,
          ...rec,
          name: rec.name || existing.name,
          trade_name: rec.trade_name || existing.trade_name,
          address: rec.address || existing.address,
          email: rec.email || existing.email,
          phone: rec.phone || existing.phone,
          source: existing.source === 'manual' ? 'manual' : (rec.source || existing.source),
        };
      }
      created += 1;
      return rec;
    });

    if (mode === 'local') {
      const prev = suppliers;
      const next = suppliers.slice();
      normalized.forEach((rec) => {
        const i = next.findIndex((s) => s.doc_id_number === rec.doc_id_number);
        if (i >= 0) next[i] = { ...next[i], ...rec, updated_at: nowIso() };
        else next.push({ ...rec, id: uid(), company_id: companyId, created_at: nowIso(), updated_at: nowIso() });
      });
      suppliers = next;
      try { saveLocal(companyId); } catch (err) { suppliers = prev; throw err; }
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
        .from('tax_suppliers')
        .upsert(chunk, { onConflict: 'company_id,doc_id_number' });
      if (error) throw new Error(error.message);
    }
    suppliers = await fetchAllRemote(companyId);
    return { created, updated, skipped, total: normalized.length };
  },

  modelCsv() {
    return `\uFEFF${MODEL_HEADERS.join(',')}\r\n`;
  },

  parseText: parseSupplierText,
};
