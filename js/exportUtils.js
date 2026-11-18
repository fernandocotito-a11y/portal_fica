/* ============================================================================
   exportUtils.js — Exportaciones tabuladas (Excel .xlsx y CSV)
   ----------------------------------------------------------------------------
   Centraliza la generación de libros Excel con SheetJS para que los reportes
   del portal se abran directamente en columnas, sin depender de "Texto en
   columnas" ni del separador regional de Excel.

   SheetJS se carga globalmente desde index.html. Si por alguna razón no está
   disponible, `ensureXlsx()` lo carga de forma dinámica desde vendor/.
   ========================================================================== */

import { decodeHtmlEntities } from './utils.js';

const XLSX_URL = new URL('../vendor/xlsx.full.min.js', import.meta.url).href;
let xlsxPromise = null;

/** Devuelve la instancia global de SheetJS, cargándola si es necesario. */
export function ensureXlsx() {
  if (typeof window !== 'undefined' && window.XLSX) {
    return Promise.resolve(window.XLSX);
  }
  if (xlsxPromise) return xlsxPromise;
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('SheetJS no está disponible fuera del navegador.'));
  }

  xlsxPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = XLSX_URL;
    script.async = true;
    script.onload = () => {
      if (window.XLSX) {
        resolve(window.XLSX);
      } else {
        xlsxPromise = null;
        reject(new Error('No se pudo inicializar SheetJS.'));
      }
    };
    script.onerror = () => {
      xlsxPromise = null;
      reject(new Error('No se pudo cargar el generador de Excel.'));
    };
    document.head.appendChild(script);
  });

  return xlsxPromise;
}

/** Limpia un valor para una celda: decodifica entidades HTML y conserva números. */
export function cleanCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return decodeHtmlEntities(String(value));
}

function aoaOf(spec) {
  const headers = Array.isArray(spec?.headers) ? spec.headers : [];
  const rows = Array.isArray(spec?.rows) ? spec.rows : [];
  return headers.length ? [headers, ...rows] : rows;
}

function sheetNameOf(name, index, used) {
  const fallback = `Hoja ${index + 1}`;
  const base = String(name || fallback)
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || fallback;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const extra = ` (${suffix})`;
    candidate = `${base.slice(0, 31 - extra.length)}${extra}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function fileNameOf(fileName) {
  const base = String(fileName || 'reporte')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim() || 'reporte';
  return /\.xlsx$/i.test(base) ? base : `${base.replace(/\.(csv|xls)$/i, '')}.xlsx`;
}

/**
 * Genera y descarga un libro .xlsx.
 *
 * @param {string} fileName Nombre del archivo (se fuerza la extensión .xlsx).
 * @param {Array<{name:string, headers?:Array, rows:Array<Array>, widths?:number[], numberFormat?:string, autoFilter?:boolean}>} sheets
 */
export async function downloadXlsx(fileName, sheets) {
  const list = Array.isArray(sheets) ? sheets : [sheets];
  if (!list.length) throw new Error('No hay hojas para exportar.');

  const XLSX = await ensureXlsx();
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  list.forEach((spec, index) => {
    const aoa = aoaOf(spec);
    if (!aoa.length) return;

    const ws = XLSX.utils.aoa_to_sheet(aoa.map((row) => row.map(cleanCell)));
    const columns = aoa.reduce((max, row) => Math.max(max, row.length), 0);

    if (Array.isArray(spec.widths) && spec.widths.length) {
      ws['!cols'] = spec.widths.map((width) => ({
        wch: Math.max(8, Math.min(60, Number(width) || 12)),
      }));
    }

    if (spec.autoFilter !== false && aoa.length > 1 && columns > 0) {
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: aoa.length - 1, c: columns - 1 },
        }),
      };
    }

    if (spec.numberFormat) {
      Object.keys(ws).forEach((address) => {
        if (address.startsWith('!')) return;
        const cell = ws[address];
        if (cell && cell.t === 'n' && Number.isFinite(cell.v)) cell.z = spec.numberFormat;
      });
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetNameOf(spec.name, index, usedNames));
  });

  if (!wb.SheetNames.length) throw new Error('No hay datos para exportar.');
  XLSX.writeFile(wb, fileNameOf(fileName), { bookType: 'xlsx' });
  return fileNameOf(fileName);
}
