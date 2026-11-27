/* ============================================================================
   honorariosService.js — Recibos por Honorarios Electrónicos (RHE)
   ----------------------------------------------------------------------------
   Persistencia con el mismo patrón de retencionService: intenta Supabase
   (honorarios_recibos) y cae a localStorage por empresa si la tabla no existe.
   No modifica Compras/Ventas ni el registro SIRE.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { activeCompanyId } from '../payroll/payrollScope.js';
import { exchangeRateService } from '../compras/exchangeRateService.js';
import { round2 } from '../payroll/payrollUtils.js';
import { dedupeKey } from './honorariosParser.js';

const DEFAULT_CONFIG = { cuenta_retencion: '40173', cuenta_pago: '4111' };

/** Cuentas PCGE genéricas y editables (solo se usan si el usuario no guardó otras). */
export const DEFAULT_ACCOUNTS = [
  { concepto: 'Servicios legales', cuenta_gasto: '6241', denominacion: 'Servicios legales', palabras_clave: 'legal,abogado,asesoria legal,servicios legales,juridico' },
  { concepto: 'Auditoría', cuenta_gasto: '6242', denominacion: 'Servicios de auditoría', palabras_clave: 'auditoria,auditor,revision de estados financieros' },
  { concepto: 'Consultoría', cuenta_gasto: '6243', denominacion: 'Servicios de consultoría', palabras_clave: 'consultoria,consultor,asesoria,asesor' },
  { concepto: 'Capacitación', cuenta_gasto: '6251', denominacion: 'Capacitación al personal', palabras_clave: 'capacitacion,entrenamiento,curso,taller,formacion' },
  { concepto: 'Otros servicios', cuenta_gasto: '6291', denominacion: 'Otros servicios prestados por terceros', palabras_clave: 'servicios,servicio,otros' },
];

let records = [];
let mode = 'unknown'; // 'remote' | 'local'
let checked = false;
let lastError = '';
let accountRows = null;
let configRow = null;
let cacheCompanyId = null;

function cid() {
  const id = activeCompanyId() || authService.activeCompany()?.id || null;
  if (id && cacheCompanyId !== id) {
    cacheCompanyId = id;
    records = [];
    accountRows = null;
    configRow = null;
  }
  return id;
}

function localKey(companyId) { return `fica.honorarios.${companyId}`; }
function accountsKey(companyId) { return `fica.honorarios.accounts.${companyId}`; }
function configKey(companyId) { return `fica.honorarios.config.${companyId}`; }

function isMissingTable(err) {
  const msg = String(err?.message || err || '');
  return /could not find the table|schema cache|does not exist|no existe la tabla/i.test(msg);
}

function nowIso() { return new Date().toISOString(); }

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadLocal(companyId) {
  const data = readJson(localKey(companyId), {});
  records = Array.isArray(data.records) ? data.records : [];
  records.forEach((r) => { r.dedupe_key = r.dedupe_key || dedupeKey(r); });
}

function saveLocal(companyId) {
  try {
    writeJson(localKey(companyId), { records });
  } catch (err) {
    throw new Error('El almacenamiento local del navegador está lleno. Ejecuta supabase/honorarios_schema.sql para guardar en Supabase.');
  }
}

async function detectMode() {
  if (checked) return mode;
  checked = true;
  try {
    const { error } = await supabase.from('honorarios_recibos').select('id').limit(1);
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

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanNumber(value) {
  if (value === null || value === '' || value === undefined) return 0;
  return round2(num(value));
}

function cleanRecord(rec) {
  const out = { ...rec };
  ['id', 'created_at', 'updated_at', 'warnings', 'company_id', 'created_by'].forEach((key) => { delete out[key]; });
  out.raw = out.raw && typeof out.raw === 'object' && !Array.isArray(out.raw) ? out.raw : {};
  ['fecha_emision', 'fecha_pago', 'tc_fecha'].forEach((field) => {
    const value = String(out[field] || '').slice(0, 10);
    out[field] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  });
  [
    'renta_bruta', 'impuesto_renta', 'renta_neta', 'pendiente_pago',
    'renta_bruta_pen', 'impuesto_renta_pen', 'renta_neta_pen', 'tc',
  ].forEach((field) => { out[field] = cleanNumber(out[field]); });
  out.indicador_retencion = num(out.indicador_retencion) > 0 ? 1 : 0;
  out.anulado = !!out.anulado;
  out.moneda = String(out.moneda || 'PEN').trim().toUpperCase().slice(0, 3) || 'PEN';
  out.dedupe_key = out.dedupe_key || dedupeKey(out);
  return out;
}

function rowToRecord(row) {
  return { ...row, raw: row.raw && typeof row.raw === 'object' ? row.raw : {} };
}

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function accountFor(rec, accounts) {
  if (rec.cuenta_gasto) return rec;
  const text = normalized([rec.descripcion, rec.observacion].filter(Boolean).join(' '));
  if (!text) return rec;
  const match = (accounts || []).find((a) => {
    if (!a.activo && a.activo !== undefined) return false;
    const words = String(a.palabras_clave || '').split(/[,|;]/).map(normalized).filter((w) => w.length > 2);
    const byConcept = normalized(a.concepto);
    if (byConcept && text.includes(byConcept)) return true;
    return words.some((word) => text.includes(word));
  });
  if (match) {
    rec.cuenta_gasto = match.cuenta_gasto;
    rec.cuenta_gasto_nombre = match.denominacion || match.concepto || '';
  }
  return rec;
}

/** Aplica el TC SUNAT (mismo servicio que Compras) y calcula los importes PEN. */
async function applyExchangeRates(recs, warnings) {
  try {
    await exchangeRateService.refresh();
  } catch (err) {
    warnings.push(`No se pudieron cargar los tipos de cambio SUNAT: ${err.message || err}`);
  }
  for (const rec of recs) {
    const base = {
      renta_bruta: cleanNumber(rec.renta_bruta),
      impuesto_renta: cleanNumber(rec.impuesto_renta),
      renta_neta: cleanNumber(rec.renta_neta),
    };
    if (String(rec.moneda || 'PEN').toUpperCase() !== 'USD') {
      rec.tc = 1;
      rec.tc_fecha = rec.fecha_emision || null;
      Object.keys(base).forEach((key) => { rec[`${key}_pen`] = base[key]; });
      continue;
    }
    let rate = num(rec.tc);
    let rateDate = rec.tc_fecha || rec.fecha_emision || null;
    if (!(rate > 0)) {
      const found = exchangeRateService.rateFor(rec.fecha_emision, 'USD');
      rate = num(found?.rate);
      rateDate = found?.rate_date || rateDate;
    }
    if (!(rate > 0)) {
      warnings.push(`Sin tipo de cambio SUNAT para ${rec.fecha_emision || 'la fecha del recibo'} (${rec.nro_doc_emitido || rec.doc_numero || ''}). Se usó TC 1.00; carga los TC en Compras para corregirlo.`);
      rate = 1;
    }
    rec.tc = round2(rate * 10000) / 10000;
    rec.tc_fecha = rateDate;
    Object.keys(base).forEach((key) => { rec[`${key}_pen`] = round2(base[key] * rate); });
  }
}

export const honorariosService = {
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
        .from('honorarios_recibos')
        .select('*')
        .eq('company_id', companyId)
        .order('fecha_emision', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const chunk = data || [];
      out.push(...chunk.map(rowToRecord));
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    records = out;
  },

  /** Lista de recibos del mes. `year`/`month` aceptan número o texto. */
  list({ year, month, search, includeAnulados = false } = {}) {
    let out = records.slice();
    if (!includeAnulados) out = out.filter((r) => !r.anulado);
    if (year) out = out.filter((r) => String(r.fecha_emision || '').slice(0, 4) === String(year).padStart(4, '0'));
    if (month) {
      const mm = String(month).padStart(2, '0');
      out = out.filter((r) => String(r.fecha_emision || '').slice(5, 7) === mm);
    }
    const q = String(search || '').trim().toLowerCase();
    if (q) {
      out = out.filter((r) => [
        r.emisor_nombre, r.doc_numero, r.tipo_doc_emisor, r.tipo_doc_emitido,
        r.nro_doc_emitido, r.descripcion, r.cuenta_gasto, r.cuenta_gasto_nombre,
      ].some((v) => String(v || '').toLowerCase().includes(q)));
    }
    return out.sort((a, b) => {
      const byDate = String(b.fecha_emision || '').localeCompare(String(a.fecha_emision || ''));
      if (byDate) return byDate;
      return String(b.nro_doc_emitido || '').localeCompare(String(a.nro_doc_emitido || ''));
    });
  },

  all() { return records.slice(); },

  /**
   * Importa los registros ya parseados. Respeta la cuenta asignada, omite los
   * duplicados (company_id + dedupe_key) y nunca borra registros existentes.
   */
  async importParsed(parsed, fileName = '') {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    const list = Array.isArray(parsed) ? parsed : (parsed?.records || []);
    await detectMode();
    const result = { imported: 0, skipped: 0, warnings: [], batchId: uid() };
    if (!list.length) return result;

    const accounts = await this.accounts();
    await applyExchangeRates(list, result.warnings);

    const existing = new Set(records.map((r) => r.dedupe_key));
    const fresh = [];
    for (const raw of list) {
      const rec = cleanRecord(accountFor({ ...raw }, accounts));
      rec.source = rec.source || 'sunat_rhe';
      rec.source_file = raw.source_file || fileName || rec.source_file || '';
      rec.import_batch_id = result.batchId;
      if (existing.has(rec.dedupe_key)) { result.skipped += 1; continue; }
      existing.add(rec.dedupe_key);
      fresh.push(rec);
    }
    if (!fresh.length) return result;

    if (mode === 'local') {
      const newRows = fresh.map((rec) => ({ ...rec, id: uid(), company_id: companyId, created_at: nowIso(), updated_at: nowIso() }));
      const prev = records;
      records = [...records, ...newRows];
      try { saveLocal(companyId); } catch (err) { records = prev; throw err; }
    } else {
      for (let i = 0; i < fresh.length; i += 300) {
        const chunk = fresh.slice(i, i + 300).map((rec) => ({ ...rec, company_id: companyId }));
        const { data, error } = await supabase
          .from('honorarios_recibos')
          .upsert(chunk, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true })
          .select();
        if (error) throw new Error(error.message);
        (data || []).forEach((row) => records.push(rowToRecord(row)));
      }
    }
    result.imported = fresh.length;
    result.warnings = [...new Set(result.warnings)];
    return result;
  },

  async updateCuenta(id, cuenta, nombre = '') {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    await detectMode();
    const current = records.find((r) => r.id === id);
    const accounts = accountRows || (await this.accounts());
    const match = accounts.find((a) => String(a.cuenta_gasto) === String(cuenta));
    const patch = {
      cuenta_gasto: String(cuenta || '').trim(),
      cuenta_gasto_nombre: nombre || match?.denominacion || match?.concepto || '',
    };
    if (mode === 'local') {
      const prev = records;
      records = records.map((r) => (r.id === id ? { ...r, ...patch } : r));
      try { saveLocal(companyId); } catch (err) { records = prev; throw err; }
      return records.find((r) => r.id === id);
    }
    const { data, error } = await supabase
      .from('honorarios_recibos')
      .update(patch)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const i = records.findIndex((r) => r.id === id);
    if (i >= 0) records[i] = rowToRecord(data);
    return rowToRecord(data);
  },

  async config() {
    if (configRow) return { ...configRow };
    const companyId = cid();
    if (!companyId) return { ...DEFAULT_CONFIG };
    await detectMode();
    if (mode === 'local') {
      configRow = { ...DEFAULT_CONFIG, ...readJson(configKey(companyId), {}) };
      return { ...configRow };
    }
    const { data, error } = await supabase
      .from('honorarios_asiento_config')
      .select('cuenta_retencion,cuenta_pago')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error && !isMissingTable(error)) throw new Error(error.message);
    configRow = {
      cuenta_retencion: data?.cuenta_retencion || DEFAULT_CONFIG.cuenta_retencion,
      cuenta_pago: data?.cuenta_pago || DEFAULT_CONFIG.cuenta_pago,
    };
    return { ...configRow };
  },

  async saveConfig(input) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    const next = {
      cuenta_retencion: String(input?.cuenta_retencion || DEFAULT_CONFIG.cuenta_retencion).trim(),
      cuenta_pago: String(input?.cuenta_pago || DEFAULT_CONFIG.cuenta_pago).trim(),
    };
    await detectMode();
    if (mode === 'local') {
      writeJson(configKey(companyId), next);
    } else {
      const { error } = await supabase
        .from('honorarios_asiento_config')
        .upsert({ ...next, company_id: companyId, updated_at: nowIso() }, { onConflict: 'company_id' });
      if (error && !isMissingTable(error)) throw new Error(error.message);
    }
    configRow = next;
    return { ...next };
  },

  async accounts() {
    if (accountRows) return accountRows.slice();
    const companyId = cid();
    if (!companyId) return DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
    await detectMode();
    if (mode === 'local') {
      const saved = readJson(accountsKey(companyId), null);
      accountRows = Array.isArray(saved) && saved.length ? saved : DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
      return accountRows.slice();
    }
    const { data, error } = await supabase
      .from('honorarios_conceptos_cuentas')
      .select('concepto,cuenta_gasto,denominacion,palabras_clave,activo')
      .eq('company_id', companyId)
      .order('concepto', { ascending: true });
    if (error && !isMissingTable(error)) throw new Error(error.message);
    accountRows = data?.length ? data : DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
    return accountRows.slice();
  },

  async saveAccounts(rows) {
    const companyId = cid();
    if (!companyId) throw new Error('No hay empresa activa.');
    const cleaned = (Array.isArray(rows) ? rows : []).map((r) => ({
      company_id: companyId,
      concepto: String(r.concepto || '').trim(),
      cuenta_gasto: String(r.cuenta_gasto || '').trim(),
      denominacion: String(r.denominacion || '').trim(),
      palabras_clave: String(r.palabras_clave || '').trim(),
      activo: r.activo !== false,
    })).filter((r) => r.concepto && r.cuenta_gasto);
    await detectMode();
    if (mode === 'local') {
      writeJson(accountsKey(companyId), cleaned);
    } else if (cleaned.length) {
      const { error } = await supabase
        .from('honorarios_conceptos_cuentas')
        .upsert(cleaned, { onConflict: 'company_id,concepto' });
      if (error && !isMissingTable(error)) throw new Error(error.message);
    }
    accountRows = cleaned.length ? cleaned : DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
    return accountRows.slice();
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
    const { error } = await supabase
      .from('honorarios_recibos')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);
    if (error) throw new Error(error.message);
    records = records.filter((r) => r.id !== id);
  },

  summary(year, month) {
    const rows = this.list({ year, month });
    const s = { count: rows.length, bruta: 0, retenido: 0, neto: 0, anulados: records.filter((r) => {
      const y = String(r.fecha_emision || '').slice(0, 4) === String(year).padStart(4, '0');
      const m = !month || String(r.fecha_emision || '').slice(5, 7) === String(month).padStart(2, '0');
      return y && m && r.anulado;
    }).length };
    rows.forEach((r) => {
      s.bruta += num(r.renta_bruta_pen) || num(r.renta_bruta);
      s.retenido += num(r.impuesto_renta_pen) || num(r.impuesto_renta);
      s.neto += num(r.renta_neta_pen) || num(r.renta_neta);
    });
    Object.keys(s).forEach((k) => { if (typeof s[k] === 'number') s[k] = round2(s[k]); });
    return s;
  },

  /** Reinicia la caché en memoria (útil al cambiar de empresa). */
  reset() {
    records = [];
    accountRows = null;
    configRow = null;
    checked = false;
    mode = 'unknown';
    lastError = '';
  },
};

export default honorariosService;
