/* ============================================================================
   retencionService.js — Persistencia de Retenciones / Percepciones
   ----------------------------------------------------------------------------
   Usa Supabase (tax_retention_records). Si la tabla todavía no existe, entra en
   MODO LOCAL (localStorage) para poder importar y probar sin bloquear la
   interfaz; el aviso se muestra en pantalla.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { EXPORT_HEADERS, recordToReportRow } from './retencionConfig.js';
import { dedupeKey } from './retencionParser.js';
import { toCsvText } from '../compras/sireParser.js';
import { periodLabel } from '../compras/comprasConfig.js';

let records = [];
let mode = 'unknown'; // 'remote' | 'local'
let checked = false;
let lastError = '';

function cid() {
  const company = authService.activeCompany();
  return company ? company.id : null;
}

function localKey(companyId) {
  return `fica.retencion.${companyId}`;
}

function loadLocal(companyId) {
  try {
    const data = JSON.parse(localStorage.getItem(localKey(companyId)) || '{}');
    records = Array.isArray(data.records) ? data.records : [];
    records.forEach((r) => { r.dedupe_key = r.dedupe_key || dedupeKey(r); });
  } catch {
    records = [];
  }
}

function saveLocal(companyId) {
  try {
    localStorage.setItem(localKey(companyId), JSON.stringify({ records }));
  } catch (err) {
    throw new Error('El almacenamiento local del navegador está lleno. Ejecuta supabase/retencion_schema.sql para guardar en Supabase.');
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
    const { error } = await supabase.from('tax_retention_records').select('id').limit(1);
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
      lastError = err.message;
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
  ['comprobante_fecha', 'doc_fecha'].forEach((field) => {
    const value = String(out[field] || '').slice(0, 10);
    out[field] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  });
  ['tasa', 'importe_total', 'total_comprobante', 'importe_pagado', 'monto_retenido', 'monto_neto'].forEach((field) => {
    if (field in out) {
      const value = Number(out[field]);
      out[field] = Number.isFinite(value) ? value : 0;
    }
  });
  out.dedupe_key = out.dedupe_key || dedupeKey(out);
  return out;
}

function rowToRecord(row) {
  return { ...row, raw: row.raw && typeof row.raw === 'object' ? row.raw : {} };
}

export const retencionService = {
  get mode() { return mode; },
  get lastError() { return lastError; },

  async refresh() {
    const companyId = cid();
    if (!companyId) { records = []; return; }
    await detectMode();
    if (mode === 'local') { loadLocal(companyId); return; }
    const pageSize = 1000;
    const out = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('tax_retention_records')
        .select('*')
        .eq('company_id', companyId)
        .order('comprobante_fecha', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const chunk = data || [];
      out.push(...chunk);
      if (!chunk.length) break;
      from += chunk.length;
    }
    records = out.map(rowToRecord);
  },

  list(kind, filters = {}) {
    let out = records.filter((r) => !kind || r.kind === kind);
    if (filters.period) out = out.filter((r) => r.period === filters.period);
    if (filters.estado) out = out.filter((r) => String(r.estado || '').toLowerCase() === String(filters.estado).toLowerCase());
    if (filters.search) {
      const q = String(filters.search).trim().toLowerCase();
      if (q) {
        out = out.filter((r) => [r.agente_nombre, r.agente_ruc, r.comprobante_serie, r.comprobante_numero, r.doc_tipo, r.doc_serie, r.doc_numero, r.estado]
          .some((v) => String(v || '').toLowerCase().includes(q)));
      }
    }
    return out.slice().sort((a, b) => {
      const da = `${a.comprobante_fecha || ''}${a.comprobante_serie || ''}${a.comprobante_numero || ''}`;
      const db = `${b.comprobante_fecha || ''}${b.comprobante_serie || ''}${b.comprobante_numero || ''}`;
      return db.localeCompare(da);
    });
  },

  all() {
    return records.slice();
  },

  /** Importa un lote ya parseado, omitiendo los que ya existen (dedup). */
  async importParsed(parsedFiles) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const result = { files: parsedFiles.length, imported: 0, skipped: 0, warnings: [] };
    const existing = new Set(records.map((r) => r.dedupe_key));

    for (const file of parsedFiles) {
      if (!file.records?.length) continue;
      const fresh = [];
      let skipped = Number(file.duplicates || 0);
      for (const rec of file.records) {
        const key = rec.dedupe_key || dedupeKey(rec);
        if (existing.has(key)) { skipped += 1; continue; }
        existing.add(key);
        fresh.push(cleanRecord({ ...rec, dedupe_key: key, source: 'excel', source_file: file.fileName }));
      }
      if (!fresh.length) { result.skipped += skipped; continue; }

      if (mode === 'local') {
        const newRows = fresh.map((rec) => ({ ...rec, id: uid(), company_id: companyId, created_at: nowIso(), updated_at: nowIso() }));
        const prev = records;
        records = [...records, ...newRows];
        try { saveLocal(companyId); } catch (err) { records = prev; throw err; }
      } else {
        const rows = fresh.map((rec) => ({ ...rec, company_id: companyId }));
        for (let i = 0; i < rows.length; i += 300) {
          const chunk = rows.slice(i, i + 300);
          const { data, error } = await supabase
            .from('tax_retention_records')
            .upsert(chunk, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true })
            .select();
          if (error) throw new Error(error.message);
          (data || []).forEach((row) => records.push(rowToRecord(row)));
        }
      }
      result.imported += fresh.length;
      result.skipped += skipped;
    }
    result.warnings = [...new Set(result.warnings)];
    return result;
  },

  async remove(id) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    if (mode === 'local') {
      const prev = records;
      records = records.filter((r) => r.id !== id);
      try { saveLocal(companyId); } catch (err) { records = prev; throw err; }
      return;
    }
    const { error } = await supabase.from('tax_retention_records').delete().eq('id', id);
    if (error) throw new Error(error.message);
    records = records.filter((r) => r.id !== id);
  },

  async removeFile(fileName) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const ids = records.filter((r) => r.source_file === fileName).map((r) => r.id);
    if (!ids.length) return 0;
    if (mode === 'local') {
      const prev = records;
      records = records.filter((r) => r.source_file !== fileName);
      try { saveLocal(companyId); } catch (err) { records = prev; throw err; }
      return ids.length;
    }
    const { error } = await supabase.from('tax_retention_records').delete().in('id', ids);
    if (error) throw new Error(error.message);
    records = records.filter((r) => r.source_file !== fileName);
    return ids.length;
  },

  summary(kind, period) {
    const rows = this.list(kind, { period });
    const comprobantes = new Set(rows.map((r) => `${r.comprobante_serie}|${r.comprobante_numero}`));
    const s = { count: rows.length, comprobantes: comprobantes.size, base: 0, pagado: 0, retenido: 0, neto: 0 };
    rows.forEach((r) => {
      s.base += Number(r.total_comprobante || 0);
      s.pagado += Number(r.importe_pagado || 0);
      s.retenido += Number(r.monto_retenido || 0);
      s.neto += Number(r.monto_neto || 0);
    });
    Object.keys(s).forEach((k) => { if (typeof s[k] === 'number') s[k] = Math.round(s[k] * 100) / 100; });
    return s;
  },

  monthly(year) {
    return Array.from({ length: 12 }, (_, i) => {
      const period = `${year}${String(i + 1).padStart(2, '0')}`;
      return {
        period,
        label: periodLabel(period),
        retencion: this.summary('retencion', period),
        percepcion: this.summary('percepcion', period),
      };
    });
  },

  periods() {
    return [...new Set(records.map((r) => r.period).filter(Boolean))].sort().reverse();
  },

  exportCsv(kind, rows) {
    const data = rows.map((r) => recordToReportRow(r).map((v) => (v == null ? '' : v)));
    return {
      fileName: `REPORTE_${kind === 'percepcion' ? 'PERCEPCIONES' : 'RETENCIONES'}_${rows[0]?.period || 'SIN_PERIODO'}.csv`,
      text: toCsvText(EXPORT_HEADERS, data),
    };
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
    URL.revokeObjectURL(url);
  },
};
