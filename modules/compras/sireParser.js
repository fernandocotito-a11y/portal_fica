/* ============================================================================
   sireParser.js — Lector de propuestas SIRE (ZIP / CSV) sin dependencias
   ----------------------------------------------------------------------------
   - Descomprime los ZIP de SUNAT con DecompressionStream.
   - Detecta automáticamente si el archivo es COMPRAS o VENTAS.
   - Mapea las columnas oficiales a un modelo normalizado editable.
   ========================================================================== */

import { FIELDS, HEADERS, normHeader } from './comprasConfig.js';

const utf8 = new TextDecoder('utf-8');
const win1252 = new TextDecoder('windows-1252');

/** Convierte un ArrayBuffer de ZIP en [{ name, data }]. */
async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo ZIP no es válido (no se encontró el directorio central).');
  const total = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = utf8.decode(bytes.slice(p + 46, p + 46 + nameLen));
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      p += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = await inflateRaw(compressed);
    } else {
      entries.push({ name, data: null, error: `Compresión ZIP no soportada (método ${method}).` });
      p += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(compressed) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no soporta descompresión ZIP. Usa Chrome/Edge actualizado o sube el CSV directamente.');
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decodifica un CSV respetando BOM y, si hace falta, Windows-1252. */
function decodeText(bytes) {
  let text = utf8.decode(bytes);
  if (text.includes('\uFFFD')) text = win1252.decode(bytes);
  return text.replace(/^\uFEFF/, '');
}

/** Detecta el separador de la primera línea fuera de comillas. */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const c = firstLine[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === ',') commas += 1;
    else if (!quoted && c === ';') semis += 1;
  }
  return semis > commas ? ';' : ',';
}

/** Parser CSV con soporte de comillas, comas y saltos de línea internos. */
export function parseCsv(text, delimiter) {
  const sep = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // Se ignora; el \n siguiente cierra la fila.
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function parseAmount(value) {
  if (value == null) return 0;
  let s = String(value).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, '').replace(/^S\/\.?/i, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length !== 3) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  if (/^\d{5}$/.test(s)) {
    const ms = (Number(s) - 25569) * 86400000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return '';
}

function detectKind(headers, fileName) {
  const set = new Set(headers.map(normHeader));
  if (set.has('bi gravado dg') || set.has('valor adq ng')) return 'compra';
  if (set.has('bi gravada') || set.has('valor facturado exportacion')) return 'venta';
  const n = normHeader(fileName);
  if (n.includes('compra')) return 'compra';
  if (n.includes('venta')) return 'venta';
  return null;
}

function buildFieldIndex(kind, headers) {
  const index = {};
  headers.forEach((h, i) => {
    const field = findField(kind, h);
    if (field && index[field] == null) index[field] = i;
  });
  return index;
}

function findField(kind, header) {
  const n = normHeader(header);
  for (const [field, aliases] of Object.entries(FIELDS[kind])) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

function normalizeRecord(kind, headers, cells, meta) {
  const idx = buildFieldIndex(kind, headers);
  const get = (field) => {
    const i = idx[field];
    return i == null ? '' : String(cells[i] ?? '').trim();
  };
  const raw = {};
  headers.forEach((h, i) => { raw[h] = cells[i] ?? ''; });

  const period = get('period').replace(/\D/g, '').slice(0, 6);
  const docIdNumber = get('doc_id_number').replace(/\s/g, '');
  const docType = get('doc_type').replace(/\D/g, '').padStart(2, '0');
  const series = get('series').toUpperCase();
  const number = get('number').replace(/\s/g, '');
  const currency = get('currency').toUpperCase() || 'PEN';
  const rawRate = parseAmount(get('exchange_rate'));
  const rec = {
    kind,
    period,
    ruc_empresa: get('ruc_empresa').replace(/\D/g, ''),
    razon_social_empresa: get('razon_social_empresa'),
    car_sunat: get('car_sunat'),
    issue_date: parseDate(get('issue_date')),
    due_date: parseDate(get('due_date')),
    doc_type: docType,
    series,
    number,
    number_final: get('number_final'),
    doc_id_type: get('doc_id_type').replace(/\D/g, ''),
    doc_id_number: docIdNumber,
    counterparty_name: get('counterparty_name'),
    total: parseAmount(get('total')),
    currency,
    // 0 = la fuente no informó tipo de cambio; la interfaz lo advierte.
    exchange_rate: rawRate > 0 ? rawRate : (currency === 'PEN' ? 1 : 0),
    modified_date: parseDate(get('modified_date')),
    modified_doc_type: get('modified_doc_type'),
    modified_series: get('modified_series'),
    modified_number: get('modified_number'),
    note_type: get('note_type'),
    state: get('state'),
    raw,
    source: 'sire',
    source_file: meta.fileName,
  };

  if (kind === 'compra') {
    rec.year = get('year');
    rec.taxed_base = parseAmount(get('taxed_base'));
    rec.igv = parseAmount(get('igv'));
    rec.taxed_base_ng = parseAmount(get('taxed_base_ng'));
    rec.igv_ng = parseAmount(get('igv_ng'));
    rec.taxed_base_dng = parseAmount(get('taxed_base_dng'));
    rec.igv_dng = parseAmount(get('igv_dng'));
    rec.acq_value_ng = parseAmount(get('acq_value_ng'));
    rec.isc = parseAmount(get('isc'));
    rec.icbper = parseAmount(get('icbper'));
    rec.other_taxes = parseAmount(get('other_taxes'));
    rec.dam = get('dam');
    rec.clu = get('clu');
  } else {
    rec.export_value = parseAmount(get('export_value'));
    rec.taxed_base = parseAmount(get('taxed_base'));
    rec.discount_base = parseAmount(get('discount_base'));
    rec.igv = parseAmount(get('igv'));
    rec.discount_igv = parseAmount(get('discount_igv'));
    rec.exonerated = parseAmount(get('exonerated'));
    rec.unaffected = parseAmount(get('unaffected'));
    rec.isc = parseAmount(get('isc'));
    rec.ivap_base = parseAmount(get('ivap_base'));
    rec.ivap = parseAmount(get('ivap'));
    rec.icbper = parseAmount(get('icbper'));
    rec.other_taxes = parseAmount(get('other_taxes'));
    rec.operation_type = get('operation_type');
    rec.dam = get('dam');
    rec.clu = get('clu');
  }
  rec.dedupe_key = dedupeKey(rec);
  rec.warnings = validateRecord(rec, meta.expectedRuc);
  return rec;
}

export function dedupeKey(rec) {
  const docNumber = String(rec.doc_id_number || rec.ruc_empresa || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return [
    String(rec.kind || '').toLowerCase(),
    String(rec.period || '').replace(/\D/g, '').slice(0, 6),
    docNumber,
    String(rec.doc_type || '').padStart(2, '0'),
    String(rec.series || '').toUpperCase().trim(),
    String(rec.number || '').toUpperCase().replace(/\s/g, ''),
  ].join('|');
}

function validateRecord(rec, expectedRuc) {
  const warnings = [];
  if (!rec.period || rec.period.length !== 6) warnings.push('Periodo vacío o inválido.');
  if (!rec.doc_type) warnings.push('Falta tipo de comprobante.');
  if (!rec.series && !['20', '40', '50'].includes(rec.doc_type)) warnings.push('Falta serie.');
  if (!rec.number) warnings.push('Falta número de comprobante.');
  if (!rec.issue_date) warnings.push('Falta fecha de emisión.');
  if (!rec.total) warnings.push('Total en cero.');
  if (rec.currency && rec.currency !== 'PEN' && !(Number(rec.exchange_rate) > 1)) {
    warnings.push(`Moneda ${rec.currency} sin tipo de cambio; completa el TC para consolidar en soles.`);
  }
  if (expectedRuc && rec.ruc_empresa && rec.ruc_empresa !== expectedRuc) {
    warnings.push(`El archivo pertenece al RUC ${rec.ruc_empresa}, distinto al de la empresa activa (${expectedRuc}).`);
  }
  return warnings;
}

function readCsvEntry(entry, fileName, expectedRuc) {
  const text = decodeText(entry.data);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('El CSV no contiene filas de datos.');
  const headers = rows[0].map((h) => String(h).trim());
  const kind = detectKind(headers, fileName);
  if (!kind) throw new Error('No se reconoce si el archivo es de COMPRAS o VENTAS. Revisa el encabezado.');
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (!rows[i].some((v) => String(v).trim() !== '')) continue;
    records.push(normalizeRecord(kind, headers, rows[i], { fileName, expectedRuc }));
  }
  return { kind, headers, records };
}

/**
 * Procesa uno o varios ZIP/CSV de SIRE.
 * @param {File[]} files
 * @param {{ expectedRuc?: string, onProgress?: (msg:string)=>void }} opts
 * @returns {Promise<{ files: object[], records: object[], warnings: string[] }>}
 */
export async function parseSireFiles(files, opts = {}) {
  const { expectedRuc = '', onProgress = () => {} } = opts;
  const parsedFiles = [];
  const allRecords = [];
  const globalWarnings = [];
  const seen = new Set();

  for (const file of files) {
    const lower = file.name.toLowerCase();
    onProgress(`Leyendo ${file.name}…`);
    try {
      if (lower.endsWith('.zip')) {
        const entries = await unzip(await file.arrayBuffer());
        const csvEntries = entries.filter((e) => e.name.toLowerCase().endsWith('.csv'));
        if (!csvEntries.length) {
          parsedFiles.push({ fileName: file.name, kind: null, records: [], warnings: ['El ZIP no contiene archivos CSV.'], duplicates: 0 });
          continue;
        }
        for (const entry of csvEntries) {
          if (entry.error) {
            parsedFiles.push({ fileName: `${file.name}/${entry.name}`, kind: null, records: [], warnings: [entry.error], duplicates: 0 });
            continue;
          }
          const parsed = readCsvEntry(entry, `${file.name}/${entry.name}`, expectedRuc);
          const fresh = [];
          let duplicates = 0;
          for (const rec of parsed.records) {
            if (seen.has(rec.dedupe_key)) { duplicates += 1; continue; }
            seen.add(rec.dedupe_key);
            fresh.push(rec);
            allRecords.push(rec);
          }
          parsedFiles.push({
            fileName: `${file.name}/${entry.name}`,
            kind: parsed.kind,
            records: fresh,
            duplicates,
            warnings: [...new Set(fresh.flatMap((r) => r.warnings || []))],
          });
        }
      } else if (lower.endsWith('.csv')) {
        const text = decodeText(new Uint8Array(await file.arrayBuffer()));
        const rows = parseCsv(text);
        if (rows.length < 2) throw new Error('El CSV no contiene filas de datos.');
        const headers = rows[0].map((h) => String(h).trim());
        const kind = detectKind(headers, file.name);
        if (!kind) throw new Error('No se reconoce si el archivo es de COMPRAS o VENTAS.');
        const fresh = [];
        let duplicates = 0;
        for (let i = 1; i < rows.length; i += 1) {
          if (!rows[i].some((v) => String(v).trim() !== '')) continue;
          const rec = normalizeRecord(kind, headers, rows[i], { fileName: file.name, expectedRuc });
          if (seen.has(rec.dedupe_key)) { duplicates += 1; continue; }
          seen.add(rec.dedupe_key);
          fresh.push(rec);
          allRecords.push(rec);
        }
        parsedFiles.push({ fileName: file.name, kind, records: fresh, duplicates, warnings: [...new Set(fresh.flatMap((r) => r.warnings || []))] });
      } else {
        globalWarnings.push(`${file.name}: formato no soportado. Sube un ZIP de SIRE o un CSV.`);
      }
    } catch (err) {
      parsedFiles.push({ fileName: file.name, kind: null, records: [], warnings: [err.message], duplicates: 0 });
      globalWarnings.push(`${file.name}: ${err.message}`);
    }
  }

  onProgress('');
  return { files: parsedFiles, records: allRecords, warnings: globalWarnings };
}

/** Exporta un registro normalizado a una fila con los encabezados SIRE. */
export function recordToSunatRow(kind, rec) {
  const headers = HEADERS[kind];
  return headers.map((header) => {
    const field = findField(kind, header);
    if (!field) return rec.raw?.[header] ?? '';
    if (field === 'period') return rec.period || '';
    if (field === 'issue_date' || field === 'due_date' || field === 'modified_date') return toDdMmYyyy(rec[field]);
    if (field === 'doc_type' || field === 'doc_id_type') return rec[field] || '';
    if (field === 'total' || field === 'igv' || field === 'taxed_base' || field === 'taxed_base_ng'
      || field === 'igv_ng' || field === 'taxed_base_dng' || field === 'igv_dng' || field === 'acq_value_ng'
      || field === 'isc' || field === 'icbper' || field === 'other_taxes' || field === 'export_value'
      || field === 'discount_base' || field === 'discount_igv' || field === 'exonerated' || field === 'unaffected'
      || field === 'ivap_base' || field === 'ivap') {
      return Number(rec[field] || 0).toFixed(2);
    }
    if (field === 'exchange_rate') {
      // Si la fuente traía el TC en blanco, se conserva en blanco al exportar.
      // El encabezado real puede variar entre compras y ventas.
      let rawValue;
      if (rec.raw) {
        const key = Object.prototype.hasOwnProperty.call(rec.raw, header)
          ? header
          : Object.keys(rec.raw).find((k) => findField(kind, k) === 'exchange_rate');
        if (key) rawValue = rec.raw[key];
      }
      if (rawValue != null && String(rawValue).trim() === '') {
        return Number(rec[field]) > 0 ? Number(rec[field]).toFixed(4) : '';
      }
      return Number(rec[field] || 0).toFixed(4);
    }
    return rec[field] ?? '';
  });
}

export function toDdMmYyyy(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/** CSV con BOM y comillas dobles, listo para Excel. */
export function toCsvText(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${[headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}`;
}
