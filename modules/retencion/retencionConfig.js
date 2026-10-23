/* ============================================================================
   retencionConfig.js — Catálogos y estructura de Retenciones / Percepciones
   ----------------------------------------------------------------------------
   El reporte "Consulta de Comprobantes Emitidos/Recibidos" de SUNAT trae, por
   cada Comprobante de Retención/Percepción, una o varias líneas de documento
   (facturas, notas de crédito, etc.). Aquí se definen los catálogos y las
   etiquetas para el reporte ordenado y la exportación.
   ========================================================================== */

export const KINDS = {
  retencion: { key: 'retencion', label: 'Retenciones', singular: 'retención', color: 'blue' },
  percepcion: { key: 'percepcion', label: 'Percepciones', singular: 'percepción', color: 'gold' },
};

/** Encabezados del reporte exportable (formato legible, no SUNAT). */
export const EXPORT_HEADERS = [
  'Periodo', 'Comprobante', 'Fecha comprobante', 'Estado', 'Tasa %',
  'Agente RUC', 'Agente', 'Receptor RUC', 'Receptor',
  'Tipo documento', 'Serie', 'Número', 'Fecha documento',
  'Total comprobante', 'Nro. pago', 'Importe pagado', 'Monto retenido', 'Monto neto',
];

/** Convierte un registro a fila CSV del reporte. */
export function recordToReportRow(rec) {
  return [
    rec.period || '',
    `${rec.comprobante_serie || ''}-${rec.comprobante_numero || ''}`,
    rec.comprobante_fecha || '',
    rec.estado || '',
    Number(rec.tasa || 0).toFixed(2),
    rec.agente_ruc || '',
    rec.agente_nombre || '',
    rec.receptor_ruc || '',
    rec.receptor_nombre || '',
    rec.doc_tipo || '',
    rec.doc_serie || '',
    rec.doc_numero || '',
    rec.doc_fecha || '',
    Number(rec.total_comprobante || 0).toFixed(2),
    rec.nro_pago || '',
    Number(rec.importe_pagado || 0).toFixed(2),
    Number(rec.monto_retenido || 0).toFixed(2),
    Number(rec.monto_neto || 0).toFixed(2),
  ];
}

export function kindLabel(kind) {
  return (KINDS[kind] || {}).label || kind || '—';
}
