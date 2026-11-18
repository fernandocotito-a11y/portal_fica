#!/usr/bin/env node
/* ============================================================================
   build-legal-params.js — UIT (SUNAT) y RMV (BCRP / MTPE) desde internet
   ----------------------------------------------------------------------------
   Genera `data/parametros-legales.json`, que el portal lee desde el mismo
   dominio (GitHub Pages) sin problemas de CORS. GitHub Actions ejecuta este
   script periódicamente y confirma el archivo actualizado.

   Fuentes:
     - UIT:  https://www.sunat.gob.pe/indicestasas/uit.html
     - RMV:  serie PN02124PM del BCRP (Remuneración Mínima Vital nominal)
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const UIT_URL = 'https://www.sunat.gob.pe/indicestasas/uit.html';
const RMV_SERIES = 'PN02124PM';
const RMV_BASE = 'https://estadisticas.bcrp.gob.pe/estadisticas/series/api';

const MONTHS = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte "5,500" o "5.500" a 5500. */
function parsePeNumber(value) {
  const s = stripTags(value).replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s.replace(',', '.'));
}

function parseUit(html) {
  const result = {};
  for (const rowMatch of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 2) continue;
    const year = Number(String(cells[0]).replace(/[^\d]/g, ''));
    if (!Number.isFinite(year) || year < 1990) continue;
    const value = parsePeNumber(cells[1]);
    if (value > 0) result[year] = value;
  }
  return result;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FICA-Portal/1.0)',
      Accept: 'text/html,application/json,text/plain,*/*',
    },
  });
  if (!res.ok) throw new Error(`${url} respondió HTTP ${res.status}`);
  return res.text();
}

async function fetchRmv() {
  const now = new Date();
  const startYear = now.getUTCFullYear() - 5;
  const endYear = now.getUTCFullYear();
  const url = `${RMV_BASE}/${RMV_SERIES}/json/${startYear}-1/${endYear}-12`;
  const text = await fetchText(url);
  let endIdx = text.indexOf('}<br');
  if (endIdx === -1) endIdx = text.indexOf('}<font');
  const jsonStr = endIdx !== -1 ? text.substring(0, endIdx + 1) : text;
  const data = JSON.parse(jsonStr);

  const monthly = {};
  const yearly = {};
  for (const period of data.periods || []) {
    const name = String(period.name || '');
    const m = name.match(/^([A-Za-zÁÉÍÓÚáéíóú]{3,})[.\-/]?\s*(\d{4})$/);
    if (!m) continue;
    const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const year = Number(m[2]);
    const value = Number(String((period.values || [])[0] || '').trim());
    if (!month || !Number.isFinite(year) || !(value > 0)) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    monthly[key] = value;
    yearly[year] = value; // los períodos llegan en orden ascendente
  }
  return { monthly, yearly };
}

(async () => {
  console.log('Consultando UIT oficial en SUNAT…');
  const uitHtml = await fetchText(UIT_URL);
  const uit = parseUit(uitHtml);
  if (!Object.keys(uit).length) throw new Error('SUNAT no devolvió filas de UIT reconocibles.');

  console.log('Consultando RMV oficial en el BCRP…');
  const { monthly, yearly } = await fetchRmv();
  if (!Object.keys(yearly).length) throw new Error('El BCRP no devolvió valores de RMV.');

  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'parametros-legales.json');

  // Si los valores no cambiaron, se conserva `updatedAt`. Así una edición
  // manual no pierde prioridad solo porque el robot volvió a consultar.
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_err) { /* primer run */ }
  // Se conservan los años históricos si la fuente deja de listarlos.
  const mergedUit = { ...(previous?.uit || {}), ...uit };
  const mergedRmv = { ...(previous?.rmv || {}), ...yearly };
  const mergedMonthly = { ...(previous?.rmvMonthly || {}), ...monthly };

  const same = !!previous
    && JSON.stringify(previous.uit || {}) === JSON.stringify(mergedUit)
    && JSON.stringify(previous.rmv || {}) === JSON.stringify(mergedRmv)
    && JSON.stringify(previous.rmvMonthly || {}) === JSON.stringify(mergedMonthly);

  const out = {
    source: 'SUNAT (UIT) y BCRP / MTPE (RMV)',
    sources: {
      uit: UIT_URL,
      rmv: `${RMV_BASE}/${RMV_SERIES}`,
    },
    rule: 'La UIT es anual. La RMV puede cambiar a mitad de año y se aplica por mes en la planilla.',
    updatedAt: same && previous.updatedAt ? previous.updatedAt : new Date().toISOString(),
    uit: mergedUit,
    rmv: mergedRmv,
    rmvMonthly: mergedMonthly,
  };

  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

  const years = Object.keys(mergedUit).sort();
  const latestUit = years[years.length - 1];
  const rmvYears = Object.keys(mergedRmv).sort();
  const latestRmv = rmvYears[rmvYears.length - 1];
  console.log(`OK: UIT ${latestUit} = S/ ${mergedUit[latestUit]} · RMV ${latestRmv} = S/ ${mergedRmv[latestRmv]}`);
  console.log(`Archivo: ${file}`);
})().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
