/* ============================================================================
   fv621.js — Archivos planos para importar en el FV 621 (SUNAT)
   ----------------------------------------------------------------------------
   El Formulario Virtual 621 solo permite importar el detalle de:
     - Casilla 171: percepciones del período.
     - Casilla 179: retenciones del período.
   El resto de casillas (ventas, compras, renta) se prellena desde SIRE.

   Estructura oficial (macro SUNAT):
     Retenciones: 0621{RUC}{AAAAMM}R.TXT
       RUC agente | serie comp. retención | número | fecha | monto retenido |
       tipo doc | serie doc | número doc | fecha doc | total doc |
     Percepciones: 0621{RUC}{AAAAMM}P.TXT
       RUC agente | serie comp. percepción | número | fecha | monto percibido |
       tipo doc | serie doc | número doc | fecha doc | total doc |

   Los importes se emiten con 2 decimales y punto decimal, sin comas, tal como
   los genera la macro oficial de SUNAT.

   Fuente: Ayuda FV 621 (SUNAT) y macro oficial "estructuras_para_percepciones_
   y_retenciones_para_621":
   https://www.sunat.gob.pe/operacLinea/ayudas/Ayuda_621_IGV_Renta_Mensual.pdf
   https://orientacion.sunat.gob.pe/7173-07-macro-para-informacion-de-retenciones-y-percepciones-fv-621
   ========================================================================== */

/** Quita tildes y normaliza espacios para comparar textos. */
function norm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte ISO (YYYY-MM-DD) o dd/mm/aaaa al formato SUNAT dd/mm/aaaa. */
export function toDdMmYyyy(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${String(m[1]).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}/${y}`;
  }
  return '';
}

/** Código de tipo de comprobante de pago que acepta el FV 621. */
export function sunatDocCode(value, kind = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return '99';
  const numeric = raw.match(/^0?(\d{1,2})$/);
  if (numeric) {
    const code = numeric[1].padStart(2, '0');
    if (['01', '07', '08', '12', '55', '99'].includes(code)) {
      return code === '55' && kind === 'retencion' ? '99' : code;
    }
  }
  const n = norm(raw);
  if (n.includes('factura')) return '01';
  if (n.includes('nota de credito') || n === 'nc') return '07';
  if (n.includes('nota de debito') || n === 'nd') return '08';
  if (n.includes('ticket')) return '12';
  if (n.includes('dua') || n.includes('aduanas')) {
    return kind === 'retencion' ? '99' : '55';
  }
  return '99';
}

/** Serie de 4 posiciones: R001, F001, 0001… */
function cleanSerie(value) {
  let s = String(value ?? '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  if (/^\d+$/.test(s)) s = s.padStart(4, '0');
  else {
    const m = s.match(/^([A-Z]+)(\d+)$/);
    if (m) s = `${m[1]}${m[2].length < 3 ? m[2].padStart(3, '0') : m[2]}`;
  }
  return s.slice(0, 4);
}

/** Número de comprobante: conserva ceros a la izquierda y limita posiciones. */
function cleanNumber(value, max = 8) {
  let s = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
  if (!s) return '';
  if (/^\d+$/.test(s) && s.length < 8) s = s.padStart(8, '0');
  return s.slice(0, max);
}

function periodOf(rows, fallback) {
  const raw = String(fallback || rows.find((r) => r && r.period)?.period || '');
  const p = raw.replace(/\D/g, '').slice(0, 6);
  return /^\d{6}$/.test(p) ? p : '';
}

function periodFirstDate(period) {
  return period ? `01/${period.slice(4, 6)}/${period.slice(0, 4)}` : '';
}

function comprobanteKey(rec) {
  return [rec.comprobante_serie, rec.comprobante_numero]
    .map((v) => String(v ?? '').toUpperCase().trim())
    .join('|');
}

/**
 * Genera el TXT que se sube en la casilla 171 (percepciones) o 179
 * (retenciones) del Formulario Virtual 621.
 *
 * @param {'retencion'|'percepcion'} kind
 * @param {Array<object>} rows Registros de tax_retention_records.
 * @param {{ruc?: string, period?: string, expectedTotal?: number}} options
 * @returns {{fileName:string,text:string,count:number,total:number,skipped:number,warnings:string[],prefix:string,period:string,ruc:string,kind:string}}
 */
export function buildFv621Txt(kind, rows, options = {}) {
  const type = kind === 'percepcion' ? 'percepcion' : 'retencion';
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const period = periodOf(list, options.period);
  if (!period) {
    throw new Error('No se pudo determinar el período (AAAAMM) de los registros.');
  }

  const ruc = String(options.ruc || list[0]?.receptor_ruc || '')
    .replace(/\D/g, '')
    .slice(0, 11);
  if (ruc.length !== 11) {
    throw new Error('La empresa no tiene un RUC de 11 dígitos para nombrar el archivo.');
  }

  const prefix = type === 'percepcion' ? 'P' : 'R';
  const fileName = `0621${ruc}${period}${prefix}.TXT`;
  const defaultDate = periodFirstDate(period);
  const warnings = [];
  const skipped = [];

  /* Si el reporte no trajo el monto por documento pero sí el total del
     comprobante, se usa ese total una sola vez para no duplicarlo. */
  const groups = new Map();
  for (const rec of list) {
    const key = comprobanteKey(rec) || `row-${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  const normalized = [];
  for (const group of groups.values()) {
    const sumAmount = group.reduce((sum, r) => sum + Number(r.monto_retenido || 0), 0);
    const groupTotal = Number(group[0]?.importe_total || 0);
    const fallbackAmount = sumAmount > 0 ? 0 : groupTotal;
    group.forEach((rec, index) => {
      let amount = Number(rec.monto_retenido || 0);
      if (!amount && fallbackAmount && index === 0) amount = fallbackAmount;
      const total = Number(rec.total_comprobante || 0)
        || Number(rec.importe_pagado || 0)
        || (Number(rec.monto_neto || 0) + amount);
      normalized.push({ rec, amount, total });
    });
  }

  const lines = [];
  const seen = new Set();
  for (const { rec, amount, total } of normalized) {
    const agenteRuc = String(rec.agente_ruc || '').replace(/\D/g, '').slice(0, 11);
    const compSerie = cleanSerie(rec.comprobante_serie);
    const compNumero = cleanNumber(rec.comprobante_numero, 8);
    const compFecha = toDdMmYyyy(rec.comprobante_fecha)
      || toDdMmYyyy(rec.doc_fecha)
      || defaultDate;
    const docTipo = sunatDocCode(rec.doc_tipo, type);
    const docSerie = cleanSerie(rec.doc_serie) || compSerie;
    const docNumero = cleanNumber(rec.doc_numero, docTipo === '99' ? 15 : 8) || compNumero;
    const docFecha = toDdMmYyyy(rec.doc_fecha) || compFecha;
    const docTotal = total > 0 ? total : amount;

    const missing = [];
    if (agenteRuc.length !== 11) missing.push('RUC del agente inválido');
    if (!compSerie) missing.push('serie del comprobante vacía');
    if (!compNumero) missing.push('número del comprobante vacío');
    if (!compFecha) missing.push('fecha del comprobante vacía');
    if (!docSerie) missing.push('serie del documento vacía');
    if (!docNumero) missing.push('número del documento vacío');
    if (!docFecha) missing.push('fecha del documento vacía');
    if (!(amount > 0)) missing.push('monto retenido/percibido en cero o negativo');
    if (!(docTotal > 0)) missing.push('total del documento en cero');

    if (missing.length) {
      skipped.push({ rec, missing });
      continue;
    }

    const line = [
      agenteRuc,
      compSerie,
      compNumero,
      compFecha,
      amount.toFixed(2),
      docTipo,
      docSerie,
      docNumero,
      docFecha,
      docTotal.toFixed(2),
    ].join('|') + '|';

    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  if (!lines.length) {
    const detail = skipped.length
      ? ` Se omitieron ${skipped.length} registro(s): ${[...new Set(skipped.flatMap((s) => s.missing))].join(', ')}.`
      : '';
    throw new Error(`No hay registros válidos para generar el TXT de ${type === 'percepcion' ? 'percepciones' : 'retenciones'}.${detail}`);
  }

  const total = lines.reduce((sum, line) => sum + Number(line.split('|')[4] || 0), 0);
  const expected = Number(options.expectedTotal);
  if (Number.isFinite(expected) && Math.abs(total - expected) > 0.01) {
    warnings.push(`El TXT suma S/ ${total.toFixed(2)} y el PDT muestra S/ ${expected.toFixed(2)}. Revisa los registros importados.`);
  }
  if (skipped.length) {
    warnings.push(`${skipped.length} registro(s) se omitieron por datos incompletos: ${[...new Set(skipped.flatMap((s) => s.missing))].join(', ')}.`);
  }

  return {
    fileName,
    text: `${lines.join('\r\n')}\r\n`,
    count: lines.length,
    total: Math.round(total * 100) / 100,
    skipped: skipped.length,
    warnings,
    prefix,
    period,
    ruc,
    kind: type,
  };
}
