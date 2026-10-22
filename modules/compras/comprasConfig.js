/* ============================================================================
   comprasConfig.js — Catálogos y estructura del Registro de Compras / Ventas
   ----------------------------------------------------------------------------
   Los encabezados reproducen el formato de la propuesta SIRE de SUNAT. Se usan
   tanto para importar como para exportar el registro en el mismo formato.
   ========================================================================== */

export const KINDS = {
  compra: { key: 'compra', label: 'Compras', singular: 'compra', color: 'blue' },
  venta: { key: 'venta', label: 'Ventas', singular: 'venta', color: 'gold' },
};

export const DOC_TYPES = [
  { value: '01', label: '01 · Factura' },
  { value: '02', label: '02 · Recibo por honorarios' },
  { value: '03', label: '03 · Boleta de venta' },
  { value: '04', label: '04 · Liquidación de compra' },
  { value: '05', label: '05 · Boleta de venta (minorista)' },
  { value: '07', label: '07 · Nota de crédito' },
  { value: '08', label: '08 · Nota de débito' },
  { value: '09', label: '09 · Guía de remisión - remitente' },
  { value: '12', label: '12 · Ticket de máquina registradora' },
  { value: '13', label: '13 · Documento emitido por bancos' },
  { value: '14', label: '14 · Recibo de servicios públicos' },
  { value: '20', label: '20 · Comprobante de retención' },
  { value: '40', label: '40 · Comprobante de percepción' },
  { value: '50', label: '50 · DUA / Declaración aduanera' },
  { value: '99', label: '99 · Otros documentos' },
];

export const DOC_ID_TYPES = [
  { value: '0', label: '0 · Doc. no domiciliado' },
  { value: '1', label: '1 · DNI' },
  { value: '4', label: '4 · Carné de extranjería' },
  { value: '6', label: '6 · RUC' },
  { value: '7', label: '7 · Pasaporte' },
  { value: 'A', label: 'A · Cédula diplomática' },
  { value: 'B', label: 'B · Doc. identidad país residencia' },
  { value: 'C', label: 'C · Doc. identidad país origen' },
  { value: 'D', label: 'D · Doc. identidad extranjero' },
  { value: 'E', label: 'E · Tarjeta Andina' },
];

export const CURRENCIES = [
  { value: 'PEN', label: 'PEN · Soles' },
  { value: 'USD', label: 'USD · Dólares' },
  { value: 'EUR', label: 'EUR · Euros' },
];

export const STATES = [
  { value: '1', label: '1 · Aceptado' },
  { value: '0', label: '0 · No aceptado / observado' },
  { value: '2', label: '2 · Anulado' },
  { value: '3', label: '3 · Rechazado' },
];

export const NOTE_TYPES = [
  { value: '', label: '— Sin nota —' },
  { value: '01', label: '01 · Anulación' },
  { value: '02', label: '02 · Corrección' },
  { value: '03', label: '03 · Devolución' },
  { value: '04', label: '04 · Descuento' },
  { value: '05', label: '05 · Otros' },
];

export const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/* Encabezados exactos de la propuesta SIRE de compras. */
export const COMPRAS_HEADERS = [
  'RUC', 'Apellidos y Nombres o Razón social', 'Periodo', 'CAR SUNAT',
  'Fecha de emisión', 'Fecha Vcto/Pago', 'Tipo CP/Doc.', 'Serie del CDP', 'Año',
  'Nro CP o Doc. Nro Inicial (Rango)', 'Nro Final (Rango)', 'Tipo Doc Identidad',
  'Nro Doc Identidad', 'Apellidos Nombres/ Razón  Social', 'BI Gravado DG',
  'IGV / IPM DG', 'BI Gravado DGNG', 'IGV / IPM DGNG', 'BI Gravado DNG',
  'IGV / IPM DNG', 'Valor Adq. NG', 'ISC', 'ICBPER', 'Otros Trib/ Cargos',
  'Total CP', 'Moneda', 'Tipo de Cambio', 'Fecha Emisión Doc Modificado',
  'Tipo CP Modificado', 'Serie CP Modificado', 'COD. DAM O DSI',
  'Nro CP Modificado', 'Clasif de Bss y Sss', 'ID Proyecto Operadores',
  'PorcPart', 'IMB', 'CAR Orig/ Ind E o I', 'Detracción', 'Tipo de Nota',
  'Est. Comp.', 'Incal', ...Array.from({ length: 39 }, (_, i) => `CLU${i + 1}`),
];

/* Encabezados exactos de la propuesta SIRE de ventas. */
export const VENTAS_HEADERS = [
  'Ruc', 'Razon Social', 'Periodo', 'CAR SUNAT', 'Fecha de emisión',
  'Fecha Vcto/Pago', 'Tipo CP/Doc.', 'Serie del CDP',
  'Nro CP o Doc. Nro Inicial (Rango)', 'Nro Final (Rango)',
  'Tipo Doc Identidad', 'Nro Doc Identidad',
  'Apellidos Nombres/ Razón Social', 'Valor Facturado Exportación',
  'BI Gravada', 'Dscto BI', 'IGV / IPM', 'Dscto IGV / IPM', 'Mto Exonerado',
  'Mto Inafecto', 'ISC', 'BI Grav IVAP', 'IVAP', 'ICBPER', 'Otros Tributos',
  'Total CP', 'Moneda', 'Tipo Cambio', 'Fecha Emisión Doc Modificado',
  'Tipo CP Modificado', 'Serie CP Modificado', 'Nro CP Modificado',
  'ID Proyecto Operadores Atribución', 'Tipo de Nota', 'Est. Comp',
  'Valor FOB Embarcado', 'Valor OP Gratuitas', 'Tipo Operación', 'DAM / CP', 'CLU',
];

export const HEADERS = { compra: COMPRAS_HEADERS, venta: VENTAS_HEADERS };

/** Normaliza un encabezado: sin tildes, minúsculas y espacios simples. */
export function normHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Mapa canónico por tipo. Las claves son los encabezados normalizados. */
const COMMON = {
  ruc_empresa: ['ruc'],
  razon_social_empresa: ['apellidos y nombres o razon social', 'razon social'],
  period: ['periodo'],
  car_sunat: ['car sunat'],
  issue_date: ['fecha de emision'],
  due_date: ['fecha vcto pago'],
  doc_type: ['tipo cp doc'],
  series: ['serie del cdp'],
  number: ['nro cp o doc nro inicial rango'],
  number_final: ['nro final rango'],
  doc_id_type: ['tipo doc identidad'],
  doc_id_number: ['nro doc identidad'],
  counterparty_name: ['apellidos nombres razon social'],
  total: ['total cp'],
  currency: ['moneda'],
  exchange_rate: ['tipo de cambio', 'tipo cambio'],
  modified_date: ['fecha emision doc modificado'],
  modified_doc_type: ['tipo cp modificado'],
  modified_series: ['serie cp modificado'],
  modified_number: ['nro cp modificado'],
  note_type: ['tipo de nota'],
  state: ['est comp'],
};

const COMPRA_FIELDS = {
  ...COMMON,
  year: ['ano'],
  taxed_base: ['bi gravado dg'],
  igv: ['igv ipm dg'],
  taxed_base_ng: ['bi gravado dgng'],
  igv_ng: ['igv ipm dgng'],
  taxed_base_dng: ['bi gravado dng'],
  igv_dng: ['igv ipm dng'],
  acq_value_ng: ['valor adq ng'],
  isc: ['isc'],
  icbper: ['icbper'],
  other_taxes: ['otros trib cargos'],
  dam: ['cod dam o dsi'],
  clu: ['clu'],
};

const VENTA_FIELDS = {
  ...COMMON,
  export_value: ['valor facturado exportacion'],
  taxed_base: ['bi gravada'],
  discount_base: ['dscto bi'],
  igv: ['igv ipm'],
  discount_igv: ['dscto igv ipm'],
  exonerated: ['mto exonerado'],
  unaffected: ['mto inafecto'],
  isc: ['isc'],
  ivap_base: ['bi grav ivap'],
  ivap: ['ivap'],
  icbper: ['icbper'],
  other_taxes: ['otros tributos'],
  operation_type: ['tipo operacion'],
  dam: ['dam cp'],
  clu: ['clu'],
};

export const FIELDS = { compra: COMPRA_FIELDS, venta: VENTA_FIELDS };

/** Devuelve el campo canónico de un encabezado, o null. */
export function fieldFor(kind, header) {
  const n = normHeader(header);
  for (const [field, aliases] of Object.entries(FIELDS[kind])) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

/** Etiqueta corta para tipos de comprobante. */
export function docTypeLabel(value) {
  const v = String(value || '').padStart(2, '0');
  return (DOC_TYPES.find((d) => d.value === v) || {}).label || value || '—';
}

/** Etiqueta de estado. */
export function stateLabel(value) {
  return (STATES.find((s) => s.value === String(value)) || {}).label || value || '—';
}

/** Periodo YYYYMM -> "Septiembre 2026". */
export function periodLabel(period) {
  const p = String(period || '').replace(/\D/g, '').slice(0, 6);
  if (p.length !== 6) return '—';
  return `${MONTHS[Number(p.slice(4, 6)) - 1] || ''} ${p.slice(0, 4)}`.trim();
}

/** Periodo YYYYMM -> YYYY-MM (para input type=month). */
export function periodToInput(period) {
  const p = String(period || '').replace(/\D/g, '').slice(0, 6);
  return p.length === 6 ? `${p.slice(0, 4)}-${p.slice(4, 6)}` : '';
}

export function inputToPeriod(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

/* ---------------------------------------------------------------------------
   Bases del registro de compras / ventas
   ---------------------------------------------------------------------------
   El SIRE separa varios subtotales. Para el registro estándar se consolidan:
   - Base gravada: bases afectas al IGV.
   - Base no gravada: exonerada, inafecta, exportación, valor no gravado y
     bases de otros tributos (IVAP), más ISC, ICBPER y otros cargos/tributos.
     Es decir, todo importe que no forma la base del IGV.
   Los descuentos de ventas se muestran netos.
   ------------------------------------------------------------------------- */

const n = (value) => Number(value || 0);

export function baseGravadaOf(rec, kind = rec?.kind) {
  if (kind === 'compra') {
    return n(rec?.taxed_base) + n(rec?.taxed_base_ng) + n(rec?.taxed_base_dng);
  }
  return n(rec?.taxed_base) - n(rec?.discount_base);
}

/** Base no gravada sin ISC, ICBPER ni otros cargos (componente SIRE). */
export function nonTaxedBaseOf(rec, kind = rec?.kind) {
  if (kind === 'compra') return n(rec?.acq_value_ng);
  return n(rec?.export_value) + n(rec?.exonerated) + n(rec?.unaffected) + n(rec?.ivap_base);
}

/** Cargos que no forman base del IGV y que se muestran dentro de la base no gravada. */
export function taxChargesOf(rec) {
  return n(rec?.isc) + n(rec?.icbper) + n(rec?.other_taxes);
}

/**
 * Base no gravada del registro estándar: componente no gravado del SIRE más
 * ISC, ICBPER y otros cargos/tributos. La base gravada sigue siendo el importe
 * afecto al IGV.
 */
export function baseNoGravadaOf(rec, kind = rec?.kind) {
  return nonTaxedBaseOf(rec, kind) + taxChargesOf(rec);
}

export function igvOf(rec, kind = rec?.kind) {
  if (kind === 'compra') return n(rec?.igv) + n(rec?.igv_ng) + n(rec?.igv_dng);
  return n(rec?.igv) - n(rec?.discount_igv);
}

export function totalBaseOf(rec, kind = rec?.kind) {
  return baseGravadaOf(rec, kind) + baseNoGravadaOf(rec, kind);
}

/** Lista de periodos disponibles alrededor de un año. */
export function periodsForYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}${String(i + 1).padStart(2, '0')}`);
}
