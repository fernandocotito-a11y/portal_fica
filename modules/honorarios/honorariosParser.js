/* ============================================================================
   honorariosParser.js — TXT de "Consulta Receptor de Recibos por Honorarios"
   ----------------------------------------------------------------------------
   Lee el TXT que el usuario descarga manualmente desde SUNAT OLE (opción 3: NO
   se automatiza el login). No toca Compras/Ventas ni el registro SIRE.

   Columnas esperadas (separador `|`, con encabezado):
     Fecha de Emisión|Tipo Doc. Emitido|Nro. Doc. Emitido|Estado Doc. Emitido|
     Tipo de Doc. Emisor|Nro. Doc. Emisor|Apellidos y Nombres...|Tipo de Renta|
     Gratuito|Descripción|Observación|Moneda de Operación|Renta Bruta|
     Impuesto a la Renta|Renta Neta|Monto Neto Pendiente de Pago
   ========================================================================== */

import { round2 } from '../payroll/payrollUtils.js';

const utf8 = new TextDecoder('utf-8');
const win1252 = new TextDecoder('windows-1252');

/** Quita tildes y normaliza para comparar encabezados. */
function norm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.\s]+/g, ' ')
    .trim();
}

function decodeText(input) {
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let text = utf8.decode(bytes);
    if (text.includes('\uFFFD')) text = win1252.decode(bytes);
    return text.replace(/^\uFEFF/, '');
  }
  return String(input ?? '').replace(/^\uFEFF/, '');
}

/** Divide una línea respetando comillas dobles y quitando el `|` final. */
function splitLine(line, delimiter) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  out.push(cell.trim());
  if (delimiter === '|' && out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

function detectDelimiter(text) {
  const first = text.split(/\r?\n/).find((line) => line.trim()) || '';
  const counts = [
    ['|', (first.match(/\|/g) || []).length],
    ['\t', (first.match(/\t/g) || []).length],
    [',', (first.match(/,/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : '|';
}

function parseDate(value) {
  const s = String(value ?? '').trim();
  if (!s || s === '-') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/** Importes con/sin coma de miles: 150.00, 1,200.00, 1.200,00, '-' => 0. */
function parseAmount(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '--') return 0;
  let s = raw
    .replace(/\s/g, '')
    .replace(/S\/\.?/gi, '')
    .replace(/US\$/gi, '')
    .replace(/[()]/g, '');
  const negative = /^-/.test(s) || /^\(.*\)$/.test(raw);
  s = s.replace(/^[+-]/, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(/,/g, '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s.replace(/[^\d.]/g, ''));
  const value2 = Number.isFinite(n) ? n : 0;
  return negative ? -value2 : value2;
}

function parseCurrency(value) {
  const s = norm(value);
  if (!s || /sol|pen/.test(s)) return 'PEN';
  if (/dolar|dólar|usd/.test(s)) return 'USD';
  return String(value || 'PEN').trim().toUpperCase().slice(0, 3);
}

/** Serie = LEFT 4 del comprobante; número = lo que sigue al guion. */
function parseSerieNumero(value) {
  const s = String(value ?? '').trim();
  const serie = s.slice(0, 4);
  const guion = s.indexOf('-');
  const numero = guion >= 0
    ? s.slice(guion + 1).trim()
    : s.slice(4).trim() || s;
  return { serie, numero };
}

/** "E001-46" -> "06|10468771433|01|E001|46|06/12/2024". */
export function dedupeKey(rec) {
  return [
    rec.doc_tipo_codigo || '',
    rec.doc_numero || '',
    rec.tipo_doc_emitido || '',
    rec.serie || '',
    rec.numero || '',
    rec.fecha_emision || '',
  ].join('|');
}

const FIELD_PATTERNS = {
  fecha_emision: [/fecha de emision/, /fecha emision/],
  tipo_doc_emitido: [/tipo doc emitido/, /tipo de documento emitido/, /tipo comprobante/],
  nro_doc_emitido: [/nro doc emitido/, /numero doc emitido/, /nro de documento emitido/],
  estado_doc: [/estado doc emitido/, /estado documento emitido/, /estado doc/],
  tipo_doc_emisor: [/tipo de doc emisor/, /tipo doc emisor/, /tipo documento emisor/],
  doc_numero: [/nro doc emisor/, /numero doc emisor/, /nro de documento emisor/],
  emisor_nombre: [/apellidos y nombres/, /denominacion o razon social del emisor/, /razon social del emisor/],
  tipo_renta: [/tipo de renta/],
  gratuito: [/gratuito/],
  descripcion: [/descripcion/, /concepto/],
  observacion: [/observacion/],
  moneda: [/moneda de operacion/, /moneda/],
  renta_bruta: [/renta bruta/],
  impuesto_renta: [/impuesto a la renta/, /impuesto renta/],
  renta_neta: [/renta neta/],
  pendiente_pago: [/monto neto pendiente de pago/, /pendiente de pago/],
};

function findHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const joined = rows[i].map(norm).join(' ');
    if (/renta bruta/.test(joined) || /fecha de emision/.test(joined)) return i;
  }
  return -1;
}

function mapColumns(header) {
  const map = {};
  header.forEach((cell, index) => {
    const value = norm(cell);
    if (!value || map.__used?.includes(index)) return;
    for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
      if (map[field] !== undefined) continue;
      if (patterns.some((re) => re.test(value))) {
        map[field] = index;
        map.__used = [...(map.__used || []), index];
        break;
      }
    }
  });
  delete map.__used;
  return map;
}

/**
 * Convierte el texto del TXT en registros normalizados.
 * @param {string|ArrayBuffer|Uint8Array} text
 * @param {string} fileName
 * @returns {{records: object[], warnings: string[]}}
 */
export function parseHonorariosTxt(text, fileName = '') {
  const warnings = [];
  const source = decodeText(text);
  if (!source.trim()) return { records: [], warnings: ['El archivo está vacío.'] };

  const delimiter = detectDelimiter(source);
  if (delimiter !== '|') warnings.push(`Delimitador detectado: ${delimiter === '\t' ? 'TAB' : 'coma'}. Se esperaba "|".`);
  const rows = source
    .split(/\r?\n/)
    .map((line) => splitLine(line, delimiter))
    .filter((cells) => cells.some((c) => String(c).trim() !== ''));

  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    return { records: [], warnings: [...warnings, 'No se encontró el encabezado "Renta Bruta" ni "Fecha de Emisión".'] };
  }
  const header = rows[headerIndex];
  const idx = mapColumns(header);
  if (idx.fecha_emision === undefined || idx.renta_bruta === undefined) {
    warnings.push('El encabezado no trae "Fecha de Emisión" o "Renta Bruta"; se extrajeron los campos reconocidos.');
  }

  const get = (cells, field) => (idx[field] === undefined ? '' : String(cells[idx[field]] ?? '').trim());
  const records = [];

  for (const cells of rows.slice(headerIndex + 1)) {
    const joined = cells.join('|');
    if (/^total\b/i.test(joined) || /^\s*totales\s*/i.test(joined)) continue;

    const fecha_emision = parseDate(get(cells, 'fecha_emision'));
    const doc_numero = get(cells, 'doc_numero');
    if (!fecha_emision && !doc_numero) continue;

    const tipo_doc_emisor = get(cells, 'tipo_doc_emisor');
    const digits = doc_numero.replace(/\D/g, '');
    let doc_tipo_codigo = '06';
    if (/^dni$/i.test(tipo_doc_emisor) || digits.length === 8) doc_tipo_codigo = '01';
    else if (digits.length !== 11 && digits.length !== 8) {
      doc_tipo_codigo = '06';
      warnings.push(`Tipo de documento del emisor "${tipo_doc_emisor || '—'}" no reconocido para ${doc_numero || '—'}; se usó código 06 (RUC).`);
    }

    const tipo_doc_emitido = get(cells, 'tipo_doc_emitido').toUpperCase();
    const estado_doc = get(cells, 'estado_doc');
    // "NO ANULADO" es el estado vigente habitual del TXT de SUNAT.
    const estadoUpper = estado_doc.toUpperCase();
    const anulado = estadoUpper.includes('ANULADO') && !/^NO[\s-]*ANULADO/.test(estadoUpper);
    const { serie, numero } = parseSerieNumero(get(cells, 'nro_doc_emitido'));
    const impuesto_renta = parseAmount(get(cells, 'impuesto_renta'));
    const moneda = parseCurrency(get(cells, 'moneda'));

    const raw = {};
    header.forEach((key, i) => {
      const name = String(key ?? '').trim();
      if (name) raw[name] = String(cells[i] ?? '');
    });

    const rec = {
      fecha_emision,
      tipo_doc_emitido,
      nro_doc_emitido: get(cells, 'nro_doc_emitido'),
      estado_doc,
      anulado,
      tipo_doc_emisor,
      doc_tipo_codigo,
      doc_numero,
      emisor_nombre: get(cells, 'emisor_nombre'),
      tipo_renta: get(cells, 'tipo_renta'),
      gratuito: get(cells, 'gratuito'),
      descripcion: get(cells, 'descripcion'),
      observacion: get(cells, 'observacion'),
      moneda,
      renta_bruta: parseAmount(get(cells, 'renta_bruta')),
      impuesto_renta,
      renta_neta: parseAmount(get(cells, 'renta_neta')),
      pendiente_pago: parseAmount(get(cells, 'pendiente_pago')),
      indicador_retencion: impuesto_renta > 0 ? 1 : 0,
      serie,
      numero,
      raw,
      source: 'sunat_rhe',
      source_file: fileName,
    };
    // El TXT no trae fecha de pago real: si no hay saldo pendiente se asume pagado
    // en la fecha de emisión; si hay saldo, queda pendiente hasta que se marque.
    rec.pagado = round2(rec.pendiente_pago) === 0;
    rec.fecha_pago = rec.pagado ? rec.fecha_emision : null;
    rec.dedupe_key = dedupeKey(rec);
    records.push(rec);
  }

  return { records, warnings: [...new Set(warnings)] };
}

export default { parseHonorariosTxt, dedupeKey };
