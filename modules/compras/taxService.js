/* ============================================================================
   taxService.js — Persistencia del Registro de Compras y Ventas
   ----------------------------------------------------------------------------
   Usa Supabase (tax_records / tax_import_batches). Si el esquema todavía no
   fue creado, entra en MODO LOCAL para poder importar y probar sin bloquear la
   interfaz; el aviso se muestra en pantalla.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import {
  HEADERS, periodLabel, baseGravadaOf, baseNoGravadaOf, igvOf, isSolarized,
} from './comprasConfig.js';
import { recordToSunatRow, toCsvText, dedupeKey } from './sireParser.js';
import { exchangeRateService } from './exchangeRateService.js';

let records = [];
let batches = [];
let mode = 'unknown'; // 'remote' | 'local'
let checked = false;
let lastError = '';
let hasGlosaColumn = false;

function cid() {
  const company = authService.activeCompany();
  return company ? company.id : null;
}

function localKey(companyId) {
  return `fica.tax.${companyId}`;
}

function loadLocal(companyId) {
  try {
    const data = JSON.parse(localStorage.getItem(localKey(companyId)) || '{}');
    records = Array.isArray(data.records) ? data.records : [];
    batches = Array.isArray(data.batches) ? data.batches : [];
    // Recalcula claves de versiones anteriores para mantener la deduplicación.
    records.forEach((r) => { r.dedupe_key = dedupeKey(r); });
  } catch {
    records = [];
    batches = [];
  }
}

function saveLocal(companyId) {
  try {
    localStorage.setItem(localKey(companyId), JSON.stringify({ records, batches }));
  } catch (err) {
    throw new Error('El almacenamiento local del navegador está lleno. Ejecuta supabase/compras_schema.sql para guardar los registros en Supabase.');
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
    const [r1, r2, rGlosa] = await Promise.all([
      supabase.from('tax_records').select('id').limit(1),
      supabase.from('tax_import_batches').select('id').limit(1),
      supabase.from('tax_records').select('glosa').limit(1),
    ]);
    const err = r1.error || r2.error;
    if (err && isMissingTable(err)) {
      mode = 'local';
      lastError = err.message;
    } else if (err) {
      checked = false;
      throw new Error(err.message);
    } else {
      mode = 'remote';
    }
    // La columna glosa es opcional: si aún no se ejecutó su migración, no se
    // envía en el payload para no romper la carga en Supabase.
    hasGlosaColumn = mode === 'local' ? true : !rGlosa.error;
  } catch (err) {
    if (isMissingTable(err)) {
      mode = 'local';
      lastError = err.message;
      hasGlosaColumn = true;
    } else {
      checked = false;
      throw err;
    }
  }
  return mode;
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanRecord(rec) {
  const out = { ...rec };
  delete out.id;
  delete out.created_at;
  delete out.updated_at;
  delete out.warnings;
  delete out.company_id;
  delete out.created_by;
  out.raw = out.raw && typeof out.raw === 'object' ? out.raw : {};
  if ('glosa' in out) {
    if (hasGlosaColumn) out.glosa = String(out.glosa || '').trim();
    else delete out.glosa;
  }
  // Las columnas date de Postgres no aceptan cadena vacía: se envían como null.
  ['issue_date', 'due_date', 'modified_date'].forEach((field) => {
    const value = String(out[field] || '').slice(0, 10);
    out[field] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  });
  // Evita enviar NaN o cadenas inválidas a columnas numeric.
  [
    'export_value', 'taxed_base', 'discount_base', 'igv', 'discount_igv',
    'taxed_base_ng', 'igv_ng', 'taxed_base_dng', 'igv_dng', 'acq_value_ng',
    'exonerated', 'unaffected', 'isc', 'ivap_base', 'ivap', 'icbper',
    'other_taxes', 'total', 'exchange_rate',
  ].forEach((field) => {
    if (field in out) {
      const value = Number(out[field]);
      out[field] = Number.isFinite(value) ? value : 0;
    }
  });
  out.dedupe_key = out.dedupe_key || dedupeKey(out);
  return out;
}

function rowToRecord(row) {
  return {
    ...row,
    raw: row.raw && typeof row.raw === 'object' ? row.raw : {},
  };
}

function companyMeta() {
  const company = authService.activeCompany() || {};
  return {
    id: company.id,
    ruc: String(company.ruc || '').replace(/\D/g, ''),
    name: company.name || '',
  };
}

export const taxService = {
  get mode() { return mode; },
  get lastError() { return lastError; },

  async refresh() {
    const companyId = cid();
    if (!companyId) {
      records = [];
      batches = [];
      return;
    }
    await detectMode();
    if (mode === 'local') {
      loadLocal(companyId);
      return;
    }
    const pageSize = 1000;
    const fetchAll = async (table, orderColumn, ascending) => {
      const out = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq('company_id', companyId)
          .order(orderColumn, { ascending })
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const chunk = data || [];
        out.push(...chunk);
        if (!chunk.length) break;
        from += chunk.length;
      }
      return out;
    };
    const [recs, batchRows] = await Promise.all([
      fetchAll('tax_records', 'issue_date', false),
      fetchAll('tax_import_batches', 'created_at', false),
    ]);
    records = recs.map(rowToRecord);
    batches = batchRows;
  },

  list(kind, filters = {}) {
    let out = records.filter((r) => !kind || r.kind === kind);
    if (filters.period) out = out.filter((r) => r.period === filters.period);
    if (filters.docType) out = out.filter((r) => r.doc_type === filters.docType);
    if (filters.state) out = out.filter((r) => String(r.state) === String(filters.state));
    if (filters.currency) out = out.filter((r) => r.currency === filters.currency);
    if (filters.search) {
      const q = String(filters.search).trim().toLowerCase();
      if (q) {
        out = out.filter((r) => [r.counterparty_name, r.doc_id_number, r.series, r.number, r.ruc_empresa, r.car_sunat, r.source_file, r.glosa]
          .some((v) => String(v || '').toLowerCase().includes(q)));
      }
    }
    return out.sort((a, b) => {
      const da = `${a.issue_date || ''}${a.series || ''}${a.number || ''}`;
      const db = `${b.issue_date || ''}${b.series || ''}${b.number || ''}`;
      return db.localeCompare(da);
    });
  },

  getById(id) {
    return records.find((r) => r.id === id) || null;
  },

  getBatches() {
    return batches.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  },

  all() {
    return records.slice();
  },

  async create(input) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const rec = cleanRecord({ ...input });
    rec.dedupe_key = rec.dedupe_key || dedupeKey(rec);
    if (records.some((r) => r.dedupe_key === rec.dedupe_key)) {
      throw new Error('Ya existe un comprobante con el mismo tipo, serie y número para ese período.');
    }
    if (mode === 'local') {
      const row = { ...rec, id: uid(), company_id: companyId, created_at: nowIso(), updated_at: nowIso() };
      const prev = records;
      records = [...records, row];
      try {
        saveLocal(companyId);
      } catch (err) {
        records = prev;
        throw err;
      }
      return row;
    }
    const { data, error } = await supabase
      .from('tax_records')
      .insert({ ...rec, company_id: companyId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const row = rowToRecord(data);
    records.push(row);
    return row;
  },

  async update(id, patch) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const current = records.find((r) => r.id === id);
    if (!current) throw new Error('Registro no encontrado.');
    const merged = cleanRecord({ ...current, ...patch });
    merged.dedupe_key = dedupeKey(merged);
    merged.updated_at = nowIso();
    if (records.some((r) => r.id !== id && r.dedupe_key === merged.dedupe_key)) {
      throw new Error('Ya existe otro comprobante con el mismo tipo, serie y número.');
    }
    if (mode === 'local') {
      const row = { ...current, ...merged, updated_at: nowIso() };
      const i = records.findIndex((r) => r.id === id);
      const prev = records[i];
      records[i] = row;
      try {
        saveLocal(companyId);
      } catch (err) {
        records[i] = prev;
        throw err;
      }
      return row;
    }
    const { data, error } = await supabase
      .from('tax_records')
      .update(merged)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const row = rowToRecord(data);
    const i = records.findIndex((r) => r.id === id);
    if (i >= 0) records[i] = row;
    return row;
  },

  /** Actualiza masivamente el tipo de cambio de comprobantes ya guardados. */
  async updateExchangeRates(items) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    const clean = (items || []).filter((item) => item?.id && Number(item.exchange_rate) > 0);
    if (!clean.length) return 0;
    await detectMode();
    if (mode === 'local') {
      const prev = records;
      records = records.map((r) => {
        const item = clean.find((x) => x.id === r.id);
        return item ? { ...r, exchange_rate: Number(item.exchange_rate), updated_at: nowIso() } : r;
      });
      try {
        saveLocal(companyId);
      } catch (err) {
        records = prev;
        throw err;
      }
      return clean.length;
    }
    for (let i = 0; i < clean.length; i += 8) {
      const chunk = clean.slice(i, i + 8);
      await Promise.all(chunk.map(async (item) => {
        const { data, error } = await supabase
          .from('tax_records')
          .update({ exchange_rate: Number(item.exchange_rate), updated_at: nowIso() })
          .eq('id', item.id)
          .eq('company_id', companyId)
          .select()
          .single();
        if (error) throw new Error(error.message);
        const row = rowToRecord(data);
        const index = records.findIndex((r) => r.id === item.id);
        if (index >= 0) records[index] = row;
      }));
    }
    return clean.length;
  },

  async remove(id) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    if (mode === 'local') {
      const prev = records;
      records = records.filter((r) => r.id !== id);
      try {
        saveLocal(companyId);
      } catch (err) {
        records = prev;
        throw err;
      }
      return;
    }
    const { error } = await supabase.from('tax_records').delete().eq('id', id);
    if (error) throw new Error(error.message);
    records = records.filter((r) => r.id !== id);
  },

  async removeBatch(id) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    if (mode === 'local') {
      const prevBatches = batches;
      const prevRecords = records;
      batches = batches.filter((b) => b.id !== id);
      records = records.filter((r) => r.import_batch_id !== id);
      try {
        saveLocal(companyId);
      } catch (err) {
        batches = prevBatches;
        records = prevRecords;
        throw err;
      }
      return;
    }
    // El FK ON DELETE CASCADE elimina también los registros del lote.
    const { error } = await supabase.from('tax_import_batches').delete().eq('id', id);
    if (error) throw new Error(error.message);
    batches = batches.filter((b) => b.id !== id);
    records = records.filter((r) => r.import_batch_id !== id);
  },

  /**
   * Importa los resultados de parseSireFiles. Crea un lote por archivo y
   * descarta duplicados ya existentes.
   */
  async importParsed(parsedFiles) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const meta = companyMeta();
    const result = { batches: 0, imported: 0, skipped: 0, warnings: [] };
    const existing = new Set(records.map((r) => r.dedupe_key));

    for (const file of parsedFiles) {
      if (!file.records?.length) {
        result.warnings.push(...(file.warnings || []).map((w) => `${file.fileName}: ${w}`));
        continue;
      }
      const fresh = [];
      let skipped = Number(file.duplicates || 0);
      let invalidRows = 0;
      for (const rec of file.records) {
        // `period` es obligatorio en la tabla; no se envía una fila inválida.
        if (!/^\d{6}$/.test(String(rec.period || ''))) {
          skipped += 1;
          invalidRows += 1;
          continue;
        }
        const key = rec.dedupe_key || dedupeKey(rec);
        if (existing.has(key)) { skipped += 1; continue; }
        existing.add(key);
        fresh.push(cleanRecord({ ...rec, dedupe_key: key, source: 'sire', source_file: file.fileName }));
      }
      if (invalidRows) {
        result.warnings.push(`${file.fileName}: ${invalidRows} fila(s) sin período válido fueron omitidas.`);
      }
      const periodSource = fresh.length ? fresh : file.records;
      const periods = [...new Set(periodSource.map((r) => r.period).filter(Boolean))];
      const kind = file.kind || periodSource[0]?.kind || '';
      const batchId = uid();
      const batch = {
        id: batchId,
        company_id: companyId,
        file_name: file.fileName,
        kind,
        periods,
        total_rows: file.records.length,
        imported_rows: fresh.length,
        skipped_rows: skipped,
        warnings: [...(file.warnings || [])],
        created_at: nowIso(),
      };

      if (mode === 'local') {
        const prevRecords = records;
        const prevBatches = batches;
        const newRows = fresh.map((rec) => ({
          ...rec,
          id: uid(),
          company_id: companyId,
          import_batch_id: batchId,
          created_at: nowIso(),
          updated_at: nowIso(),
        }));
        batches = [...batches, batch];
        records = [...records, ...newRows];
        try {
          saveLocal(companyId);
        } catch (err) {
          records = prevRecords;
          batches = prevBatches;
          throw err;
        }
      } else {
        const { error: bErr } = await supabase.from('tax_import_batches').insert(batch);
        if (bErr) throw new Error(bErr.message);
        try {
          if (fresh.length) {
            const rows = fresh.map((rec) => ({ ...rec, company_id: companyId, import_batch_id: batchId }));
            for (let i = 0; i < rows.length; i += 300) {
              const chunk = rows.slice(i, i + 300);
              const { data, error } = await supabase
                .from('tax_records')
                .upsert(chunk, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true })
                .select();
              if (error) throw new Error(error.message);
              (data || []).forEach((row) => records.push(rowToRecord(row)));
            }
          }
        } catch (err) {
          // Si falla la carga, se elimina el lote y sus registros parciales.
          await supabase.from('tax_import_batches').delete().eq('id', batchId);
          records = records.filter((r) => r.import_batch_id !== batchId);
          throw err;
        }
        batches.push(batch);
      }
      result.batches += 1;
      result.imported += fresh.length;
      result.skipped += skipped;
      result.warnings.push(...(file.warnings || []).map((w) => `${file.fileName}: ${w}`));
      if (meta.ruc && file.records[0]?.ruc_empresa && file.records[0].ruc_empresa !== meta.ruc) {
        result.warnings.push(`${file.fileName}: el RUC del archivo (${file.records[0].ruc_empresa}) no coincide con el de la empresa activa (${meta.ruc}).`);
      }
    }
    result.warnings = [...new Set(result.warnings)];
    return result;
  },

  summary(kind, period) {
    const rows = this.list(kind, { period });
    const s = {
      count: rows.length,
      base: 0,
      baseGravada: 0,
      baseNoGravada: 0,
      igv: 0,
      total: 0,
      exonerated: 0,
      unaffected: 0,
      other: 0,
    };
    if (!rows.length) return s;
    rows.forEach((r) => {
      const ownRate = Number(r.exchange_rate || 0);
      const sunatRate = String(r.currency || 'PEN').toUpperCase() === 'PEN'
        ? null
        : exchangeRateService.rateFor(r.issue_date, r.currency);
      const rate = isSolarized(r)
        ? 1
        : (String(r.currency || 'PEN').toUpperCase() === 'PEN'
          ? 1
          : (ownRate > 1 ? ownRate : (Number(sunatRate?.rate || 0) || 1)));
      const baseGravada = baseGravadaOf(r, kind);
      const baseNoGravada = baseNoGravadaOf(r, kind);
      s.baseGravada += baseGravada * rate;
      s.baseNoGravada += baseNoGravada * rate;
      s.base += (baseGravada + baseNoGravada) * rate;
      s.igv += igvOf(r, kind) * rate;
      s.total += Number(r.total || 0) * rate;
      s.exonerated += Number(r.exonerated || 0) * rate;
      s.unaffected += Number(r.unaffected || 0) * rate;
      s.other += (Number(r.isc || 0) + Number(r.icbper || 0) + Number(r.other_taxes || 0)) * rate;
    });
    Object.keys(s).forEach((k) => { if (typeof s[k] === 'number') s[k] = Math.round(s[k] * 100) / 100; });
    return s;
  },

  monthly(year) {
    const out = [];
    for (let m = 1; m <= 12; m += 1) {
      const period = `${year}${String(m).padStart(2, '0')}`;
      out.push({
        period,
        label: periodLabel(period),
        compra: this.summary('compra', period),
        venta: this.summary('venta', period),
      });
    }
    return out;
  },

  exportCsv(kind, rows) {
    // Se conservan los encabezados SIRE exactos y se añade una columna "Glosa"
    // al final. En una reimportación esa columna se ignora (no es un campo SIRE).
    const headers = [...HEADERS[kind], 'Glosa'];
    const data = rows.map((r) => [...recordToSunatRow(kind, r), r.glosa ?? '']);
    return { fileName: `REGISTRO_${kind === 'compra' ? 'COMPRAS' : 'VENTAS'}_${rows[0]?.period || 'SIN_PERIODO'}.csv`, text: toCsvText(headers, data) };
  },

  downloadCsv(kind, rows) {
    const { fileName, text } = this.exportCsv(kind, rows);
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
