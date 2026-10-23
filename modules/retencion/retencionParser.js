/* ============================================================================
   retencionParser.js — Lector de reportes de Retenciones / Percepciones
   ----------------------------------------------------------------------------
   Lee el Excel (.xls/.xlsx) de "Consulta de Comprobantes Emitidos/Recibidos" de
   SUNAT (Agentes de Retención/Percepción), o un CSV/TXT exportado desde Excel,
   y lo convierte en un listado normalizado con una fila por documento.

   Estructura del reporte SUNAT (por cada comprobante de retención/percepción):
     ;Emisor:;RUC ... - NOMBRE;;;;;No. de Comprobante Retención;R001 - 3206
     ;Receptor:;RUC ... - NOMBRE;;;;;Fecha de emisión:;04/09/2026
     ;Importe Total Retenido:;S/ 55.22;;tasa %:;03.00;;Estado:;EMITIDO
     (encabezado) Tipo de documento;Serie;Número;Fecha emisión;Total comprobante;
                  Nro. de pago;Importe pagado;Retención S/;Monto neto a pagar S/
     (líneas)     FACTURA;F001;0002374;05/08/2026;S/ 1840.80;1;S/ 1840.80;55.22;1785.58
   ========================================================================== */

import { parseCsv } from '../compras/sireParser.js';

const utf8 = new TextDecoder('utf-8');
const win1252 = new TextDecoder('windows-1252');

function decodeText(bytes) {
  let text = utf8.decode(bytes);
  if (text.includes('\uFFFD')) text = win1252.decode(bytes);
  return text.replace(/^\uFEFF/, '');
}

/** Minúsculas y espacios simples; no quita tildes para no alterar el texto. */
function norm(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseAmount(value) {
  if (value == null) return 0;
  let s = String(value).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, '')
    .replace(/^S\/\.?/i, '')
    .replace(/^US?\$/i, '')
    .replace(/^S\//i, '');
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
  return '';
}

/** "RUC 20110378956 - AGROMAR INDUSTRIAL S.A." -> { ruc, nombre }. */
function parseRucNombre(value) {
  const s = String(value || '').trim();
  const m = s.match(/RUC\s*(\d{8,11})\s*[-–]\s*(.*)/i);
  if (m) return { ruc: m[1], nombre: m[2].trim() };
  const only = s.match(/(\d{11})/);
  return { ruc: only ? only[1] : '', nombre: s.replace(/RUC\s*/i, '').trim() };
}

/** "R001 - 3206" -> { serie, numero }. */
function parseSerieNumero(value) {
  const s = String(value || '').trim();
  const m = s.match(/([A-Z]\d+)\s*[-–]\s*(\d+)/i);
  if (m) return { serie: m[1].toUpperCase(), numero: m[2] };
  return { serie: '', numero: s };
}

/** "01/09/2026 - 30/09/2026" -> "202609" (usa la fecha final). */
function periodFromRange(value) {
  const dates = String(value || '').split(/[-–]/).map((x) => x.trim()).filter(Boolean);
  const d = parseDate(dates[dates.length - 1] || '');
  return d ? d.replace(/-/g, '').slice(0, 6) : '';
}

export function dedupeKey(rec) {
  return [
    String(rec.kind || '').toLowerCase(),
    String(rec.period || '').replace(/\D/g, '').slice(0, 6),
    String(rec.comprobante_serie || '').toUpperCase().trim(),
    String(rec.comprobante_numero || '').toUpperCase().trim(),
    String(rec.doc_tipo || '').toUpperCase().replace(/\s+/g, ' ').trim(),
    String(rec.doc_serie || '').toUpperCase().trim(),
    String(rec.doc_numero || '').toUpperCase().trim(),
    String(rec.nro_pago || '').trim(),
  ].join('|');
}

/** Índices fijos del bloque de datos (formato estándar SUNAT). */
const DATA_COLS = {
  docTipo: 0, serie: 1, numero: 2, fecha: 3, total: 4, nroPago: 5, pagado: 6, retenido: 7, neto: 8,
};

/** Devuelve la celda que sigue a la que coincide con `re` (búsqueda por etiqueta). */
function labelValue(cells, re) {
  for (let i = 0; i < cells.length - 1; i += 1) {
    if (re.test(norm(cells[i]))) return cells[i + 1] || '';
  }
  return '';
}

function rowsToRecords(rows, meta) {
  const records = [];
  let period = '';
  let block = null;
  let inData = false;

  for (const raw of rows) {
    const cells = (Array.isArray(raw) ? raw : [raw]).map((c) => String(c ?? '').trim());
    const has = (re) => cells.some((c) => re.test(norm(c)));

    if (has(/^periodo/)) {
      const p = labelValue(cells, /^periodo/);
      if (p) period = periodFromRange(p);
      continue;
    }

    if (has(/^emisor/)) {
      block = {
        agente: parseRucNombre(labelValue(cells, /^emisor/)),
        comprobante: parseSerieNumero(labelValue(cells, /comprobante/)),
      };
      inData = false;
      continue;
    }

    if (!block) continue;

    if (has(/^receptor/)) {
      block.receptor = parseRucNombre(labelValue(cells, /^receptor/));
      block.fecha = parseDate(labelValue(cells, /fecha de emisi/));
      continue;
    }

    if (has(/^importe total/)) {
      block.total = parseAmount(labelValue(cells, /^importe total/));
      block.tasa = parseAmount(labelValue(cells, /^tasa/));
      block.estado = labelValue(cells, /^estado/);
      block.kind = /percib/i.test(labelValue(cells, /^importe total/)) ? 'percepcion' : 'retencion';
      continue;
    }

    if (has(/^tipo de documento/)) { inData = true; continue; }

    if (inData && cells.some((c) => c !== '')) {
      const docTipo = cells[DATA_COLS.docTipo] || '';
      if (!/^tipo de documento/.test(norm(docTipo))) {
        records.push(makeRecord(block, cells, period, meta));
      }
    }
  }
  return records;
}

function makeRecord(block, cells, period, meta) {
  const serie = block.comprobante.serie || '';
  const kind = block.kind || (serie.toUpperCase().startsWith('P') ? 'percepcion' : 'retencion');
  return {
    kind,
    period,
    comprobante_serie: serie,
    comprobante_numero: block.comprobante.numero || '',
    comprobante_fecha: block.fecha || '',
    estado: block.estado || '',
    tasa: block.tasa || 0,
    agente_ruc: block.agente.ruc || '',
    agente_nombre: block.agente.nombre || '',
    receptor_ruc: (block.receptor && block.receptor.ruc) || '',
    receptor_nombre: (block.receptor && block.receptor.nombre) || '',
    importe_total: block.total || 0,
    doc_tipo: cells[DATA_COLS.docTipo] || '',
    doc_serie: cells[DATA_COLS.serie] || '',
    doc_numero: cells[DATA_COLS.numero] || '',
    doc_fecha: parseDate(cells[DATA_COLS.fecha]),
    total_comprobante: parseAmount(cells[DATA_COLS.total]),
    nro_pago: cells[DATA_COLS.nroPago] || '',
    importe_pagado: parseAmount(cells[DATA_COLS.pagado]),
    monto_retenido: parseAmount(cells[DATA_COLS.retenido]),
    monto_neto: parseAmount(cells[DATA_COLS.neto]),
    currency: 'PEN',
    source: 'excel',
    source_file: meta.fileName,
    raw: {},
  };
}

function readWorkbookRows(file) {
  if (typeof window === 'undefined' || !window.XLSX) {
    return Promise.reject(new Error('La librería de lectura de Excel no está disponible. Recarga la página.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        resolve(rows.map((r) => (Array.isArray(r) ? r : [r])));
      } catch (err) {
        reject(new Error(`No se pudo leer "${file.name}": ${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error(`No se pudo leer "${file.name}".`));
    reader.readAsArrayBuffer(file);
  });
}

function detectKindOf(records) {
  const kinds = new Set(records.map((r) => r.kind).filter(Boolean));
  if (kinds.size === 1) return [...kinds][0];
  return kinds.has('retencion') && kinds.has('percepcion') ? 'mixto' : null;
}

/**
 * Procesa uno o varios archivos (.xls/.xlsx/.csv/.txt) de retenciones/percepciones.
 * @param {File[]} files
 * @param {{ onProgress?: (msg:string)=>void }} opts
 * @returns {Promise<{ files: object[], records: object[], warnings: string[] }>}
 */
export async function parseRetencionFiles(files, opts = {}) {
  const { onProgress = () => {} } = opts;
  const parsedFiles = [];
  const allRecords = [];
  const warnings = [];
  const seen = new Set();

  for (const file of files) {
    const lower = file.name.toLowerCase();
    onProgress(`Leyendo ${file.name}…`);
    try {
      let rows = [];
      if (/\.(xls|xlsx)$/.test(lower)) {
        rows = await readWorkbookRows(file);
      } else if (/\.(csv|txt)$/.test(lower)) {
        const text = decodeText(new Uint8Array(await file.arrayBuffer()));
        rows = parseCsv(text);
      } else {
        warnings.push(`${file.name}: formato no soportado. Sube un Excel (.xls/.xlsx), CSV o TXT.`);
        continue;
      }

      const records = rowsToRecords(rows, { fileName: file.name });
      const fresh = [];
      let duplicates = 0;
      for (const rec of records) {
        rec.dedupe_key = dedupeKey(rec);
        if (seen.has(rec.dedupe_key)) { duplicates += 1; continue; }
        seen.add(rec.dedupe_key);
        fresh.push(rec);
        allRecords.push(rec);
      }
      parsedFiles.push({
        fileName: file.name,
        kind: detectKindOf(fresh),
        records: fresh,
        duplicates,
        warnings: [],
      });
    } catch (err) {
      parsedFiles.push({ fileName: file.name, kind: null, records: [], duplicates: 0, warnings: [err.message] });
      warnings.push(`${file.name}: ${err.message}`);
    }
  }

  onProgress('');
  return { files: parsedFiles, records: allRecords, warnings };
}
