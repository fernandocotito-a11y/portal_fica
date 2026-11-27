/* ============================================================================
   honorariosPdtService.js — PDT 601 (archivos .ps4 / .4ta) y asiento mensual
   ----------------------------------------------------------------------------
   Formato validado con la macro del usuario (separador `|` y `|` final):
     .ps4  (7 campos):  06|10472193762|0|0|0|1|0|
     .4ta  (11 campos): 06|10472193762|R|E001|105|1500|01/09/2026|01/09/2026|0||
   El RUC del nombre del archivo es de la EMPRESA ACTIVA, no del emisor.
   Solo se declaran recibos PAGADOS cuya FECHA DE PAGO esté en el mes: se
    excluyen anulados, impagos y recibos pagados en otro mes.
   ========================================================================== */

import { accountingBridgeService } from '../payroll/accountingBridgeService.js';
import { round2, downloadText, downloadBlob } from '../payroll/payrollUtils.js';

async function loadJSZip() {
  const mod = await import('https://esm.sh/jszip@3');
  return mod.default || mod;
}

/** Acepta YYYY-MM-DD y DD/MM/AAAA; devuelve YYYY-MM-DD. */
function normalizeIsoDate(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/** Si no vienen año/mes, se toma el mes de pago del primer recibo pagado. */
function resolvePeriod(rows, year, month) {
  if (year && month) {
    return { yyyy: String(year).padStart(4, '0'), mm: String(month).padStart(2, '0') };
  }
  const first = (Array.isArray(rows) ? rows : [])
    .map((r) => normalizeIsoDate(r.fecha_pago))
    .find(Boolean);
  return first ? { yyyy: first.slice(0, 4), mm: first.slice(5, 7) } : { yyyy: '', mm: '' };
}

/** Recibos declarables: vigentes, PAGADOS y con pago en el mes seleccionado. */
function paraPdt(rows, year, month) {
  const { yyyy, mm } = resolvePeriod(rows, year, month);
  if (!yyyy || !mm) return [];
  const prefix = `${yyyy}-${mm}`;
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (r.anulado || r.pagado !== true) return false;
    return normalizeIsoDate(r.fecha_pago).startsWith(prefix);
  });
}

/** Detalle de exclusiones para los toasts. */
function exclusionStats(rows, year, month) {
  const { yyyy, mm } = resolvePeriod(rows, year, month);
  const prefix = yyyy && mm ? `${yyyy}-${mm}` : '';
  const stats = { anulados: 0, impagos: 0, otroMes: 0 };
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (r.anulado) { stats.anulados += 1; return; }
    const pago = normalizeIsoDate(r.fecha_pago);
    if (r.pagado !== true || !pago) { stats.impagos += 1; return; }
    if (prefix && !pago.startsWith(prefix)) stats.otroMes += 1;
  });
  return stats;
}

function isoToDdMmYyyy(value) {
  const iso = normalizeIsoDate(value);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Importe del PDT 601: valor numérico normal (sin convertir a centavos). */
function formatPdtAmount(value) {
  const n = round2(Number(value) || 0);
  return Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(2);
}

function penOf(row, field) {
  const pen = Number(row[`${field}_pen`]);
  return Number.isFinite(pen) ? pen : Number(row[field] || 0);
}

/** Divide "APELLIDO PATERNO APELLIDO MATERNO NOMBRES" en tres campos. */
export function splitDniName(name, warnings = []) {
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    return {
      paterno: tokens[0],
      materno: tokens[1],
      nombres: tokens.slice(2).join(' '),
    };
  }
  if (tokens.length === 2) {
    return { paterno: tokens[0], materno: '0', nombres: tokens[1] };
  }
  if (tokens.length === 1) {
    return { paterno: tokens[0], materno: '0', nombres: '0' };
  }
  warnings.push(`No se pudo dividir el nombre del emisor "${name || '—'}" en apellidos y nombres; se dejaron ceros en el PS4.`);
  return { paterno: '0', materno: '0', nombres: '0' };
}

export function buildPs4(rows, warnings = [], year, month) {
  const lines = [];
  const seen = new Set();
  paraPdt(rows, year, month).forEach((row) => {
    const key = `${row.doc_tipo_codigo || '06'}|${row.doc_numero || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const code = row.doc_tipo_codigo === '01' ? '01' : '06';
    let paterno = '0';
    let materno = '0';
    let nombres = '0';
    if (code === '01') {
      const parts = splitDniName(row.emisor_nombre, warnings);
      paterno = parts.paterno;
      materno = parts.materno;
      nombres = parts.nombres;
    }
    lines.push([code, row.doc_numero || '', paterno, materno, nombres, '1', '0'].join('|') + '|');
  });
  return lines.join('\r\n');
}

/** RH -> R, NC -> N; cualquier otro comprobante se deja como su inicial. */
function pdtDocType(value) {
  const s = String(value || 'RH').trim().toUpperCase();
  if (s === 'RH') return 'R';
  if (s === 'NC') return 'N';
  return s.slice(0, 1);
}

export function build4ta(rows, warnings = [], year, month) {
  return paraPdt(rows, year, month).map((row) => {
    const fields = [
      row.doc_tipo_codigo === '01' ? '01' : '06',
      row.doc_numero || '',
      pdtDocType(row.tipo_doc_emitido),
      row.serie || '',
      row.numero || '',
      formatPdtAmount(penOf(row, 'renta_bruta')),
      isoToDdMmYyyy(row.fecha_emision),
      isoToDdMmYyyy(row.fecha_pago),
      Number(row.indicador_retencion) > 0 ? '1' : '0',
      '',
      '',
    ];
    return fields.join('|') + '|';
  }).join('\r\n');
}

export function buildFileName(companyRuc, year, month, ext) {
  const ruc = String(companyRuc || '').replace(/\D/g, '');
  const yyyy = String(year || '').padStart(4, '0');
  const mm = String(month || '').padStart(2, '0');
  const suffix = String(ext || '').replace(/^\./, '');
  return `0601${yyyy}${mm}${ruc}.${suffix}`;
}

/** Descarga los dos TXT del PDT 601 con una pausa entre ellos. */
export function downloadPdt(company, rows, year, month) {
  const warnings = [];
  const ps4 = buildPs4(rows, warnings, year, month);
  const fourta = build4ta(rows, warnings, year, month);
  const ps4Name = buildFileName(company?.ruc, year, month, 'ps4');
  const fourtaName = buildFileName(company?.ruc, year, month, '4ta');
  downloadText(ps4Name, ps4, 'text/plain');
  setTimeout(() => downloadText(fourtaName, fourta, 'text/plain'), 300);
  return {
    ps4Name,
    fourtaName,
    count: paraPdt(rows, year, month).length,
    excluded: exclusionStats(rows, year, month),
    warnings: [...new Set(warnings)],
  };
}

/** Descarga un solo TXT del PDT 601 (ps4 o 4ta) para los botones sueltos. */
export function downloadPdtSingle(company, rows, year, month, ext) {
  const warnings = [];
  const suffix = String(ext || '').replace(/^\./, '').toLowerCase();
  if (suffix !== 'ps4' && suffix !== '4ta') {
    throw new Error(`Extensión PDT no soportada: ${ext || '—'}. Usa ps4 o 4ta.`);
  }
  const content = suffix === 'ps4'
    ? buildPs4(rows, warnings, year, month)
    : build4ta(rows, warnings, year, month);
  const fileName = buildFileName(company?.ruc, year, month, suffix);
  downloadText(fileName, content, 'text/plain');
  return {
    fileName,
    count: paraPdt(rows, year, month).length,
    excluded: exclusionStats(rows, year, month),
    warnings: [...new Set(warnings)],
  };
}

/** Un solo clic: ZIP con los dos TXT, evita el bloqueo de descargas automáticas. */
export async function downloadPdtZip(company, rows, year, month) {
  const warnings = [];
  const ps4 = buildPs4(rows, warnings, year, month);
  const fourta = build4ta(rows, warnings, year, month);
  const ps4Name = buildFileName(company?.ruc, year, month, 'ps4');
  const fourtaName = buildFileName(company?.ruc, year, month, '4ta');
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  zip.file(ps4Name, ps4);
  zip.file(fourtaName, fourta);
  const blob = await zip.generateAsync({ type: 'blob' });
  const zipName = `PDT601_${year}${String(month).padStart(2, '0')}_${company?.ruc || 'sinruc'}.zip`;
  downloadBlob(zipName, blob);
  return {
    zipName,
    ps4Name,
    fourtaName,
    count: paraPdt(rows, year, month).length,
    excluded: exclusionStats(rows, year, month),
    warnings: [...new Set(warnings)],
  };
}

function accountName(accounts, cuenta, fallback) {
  const found = (accounts || []).find((a) => String(a.cuenta_gasto || a.cuenta || '') === String(cuenta));
  return found?.denominacion || found?.nombre || found?.concepto || fallback;
}

/**
 * Asiento MENSUAL: recibos PAGADOS en el mes de pago, en una sola transacción.
 * Debe: cuentas de gasto por concepto. Haber: retenciones y pago.
 */
export function buildAsiento(rows, config = {}, accounts = [], year, month) {
  const warnings = [];
  const { yyyy, mm } = resolvePeriod(rows, year, month);
  const list = paraPdt(rows, year, month);
  const period = yyyy && mm ? `${yyyy}${mm}` : String(list[0]?.period || '');
  const lines = [];

  if (!list.length) warnings.push('No hay recibos PAGADOS con fecha de pago en el mes seleccionado para generar el asiento.');

  const groups = new Map();
  let sinCuenta = 0;
  list.forEach((row) => {
    let cuenta = String(row.cuenta_gasto || '').trim();
    if (!cuenta) { cuenta = '6291'; sinCuenta += 1; }
    groups.set(cuenta, round2((groups.get(cuenta) || 0) + penOf(row, 'renta_bruta')));
  });
  if (sinCuenta) {
    warnings.push(`${sinCuenta} recibo(s) sin cuenta de gasto: se usó la cuenta genérica 6291 (Otros servicios).`);
  }
  groups.forEach((debe, cuenta) => {
    if (!debe) return;
    lines.push({
      cuenta,
      nombre: accountName(accounts, cuenta, 'Servicios prestados por terceros'),
      debe,
      haber: 0,
    });
  });

  const retencionCuenta = String(config.cuenta_retencion || '40173').trim() || '40173';
  const pagoCuenta = String(config.cuenta_pago || '4111').trim() || '4111';
  const totalRetencion = round2(list.reduce((sum, row) => sum + penOf(row, 'impuesto_renta'), 0));
  const totalPago = round2(list.reduce((sum, row) => sum + penOf(row, 'renta_neta'), 0));
  if (totalRetencion) {
    lines.push({
      cuenta: retencionCuenta,
      nombre: accountName(accounts, retencionCuenta, 'Retenciones de renta de cuarta categoría'),
      debe: 0,
      haber: totalRetencion,
    });
  }
  if (totalPago) {
    lines.push({
      cuenta: pagoCuenta,
      nombre: accountName(accounts, pagoCuenta, 'Honorarios por pagar'),
      debe: 0,
      haber: totalPago,
    });
  }

  const totalDebe = round2(lines.reduce((sum, line) => sum + line.debe, 0));
  const totalHaber = round2(lines.reduce((sum, line) => sum + line.haber, 0));
  if (totalDebe !== totalHaber) {
    warnings.push(`El asiento no cuadra: diferencia de ${round2(totalDebe - totalHaber).toFixed(2)}. Revisa la retención y la renta neta del TXT.`);
  }

  return {
    period,
    count: list.length,
    excluded: exclusionStats(rows, year, month),
    lines,
    totalDebe,
    totalHaber,
    balanced: totalDebe === totalHaber,
    warnings: [...new Set(warnings)],
  };
}

export function downloadAsiento(entry, company, year, month) {
  const yyyy = String(year || '').padStart(4, '0');
  const mm = String(month || '').padStart(2, '0');
  const ruc = String(company?.ruc || '').replace(/\D/g, '');
  const fileName = `ASIENTO_HONORARIOS_${yyyy}${mm}${ruc ? `_${ruc}` : ''}.csv`;
  downloadText(fileName, accountingBridgeService.toCSV(entry, company), 'text/csv');
  return {
    fileName,
    count: entry.count || 0,
    excluded: entry.excluded || { anulados: 0, impagos: 0, otroMes: 0 },
  };
}

export default { buildPs4, build4ta, buildFileName, downloadPdt, buildAsiento, downloadAsiento };
