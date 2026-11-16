#!/usr/bin/env node
/* ============================================================================
   build-bcrp.js — Descarga el tipo de cambio USD del BCRP y genera
   `data/tc-bcrp.json`, que el portal sirve desde GitHub Pages (mismo origen,
   sin problemas de CORS).

   Uso:
     node scripts/build-bcrp.js [años]

   Serie PD04640PD = "Tipo de cambio - TC Sistema bancario SBS (S/ por US$)
   - Venta", que es la que se usa para convertir operaciones en moneda
   extranjera en el Perú.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const SERIES = 'PD04640PD';
const YEARS = Number(process.argv[2] || 3);

const MONTHS = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

/** Convierte "02.Nov.26" (formato del BCRP) a "2026-11-02". */
function isoFromBcrp(name) {
  let m = String(name).match(/^(\d{1,2})[.\-/]([A-Za-zÁÉÍÓÚáéíóú]{3,})[.\-/](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = MONTHS[m[2].toLowerCase().slice(0, 3)];
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (!month) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  m = String(name).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return '';
}

async function fetchRange(start, end) {
  const url = `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/${SERIES}/json/${start}/${end}/ing`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FICA-Portal/1.0)',
      Accept: 'application/json,text/plain,*/*',
    },
  });
  if (!res.ok) throw new Error(`BCRP respondió HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = `${now.getUTCFullYear() - YEARS}-01-01`;

  console.log(`Consultando BCRP ${SERIES} del ${start} al ${end}…`);
  const data = await fetchRange(start, end);

  const rates = {};
  for (const period of data.periods || []) {
    const iso = isoFromBcrp(period.name);
    const value = String((period.values || [])[0] || '').trim();
    if (!iso || !/^\d+(\.\d+)?$/.test(value)) continue;
    const rate = Number(value);
    if (rate > 0) rates[iso] = rate;
  }

  const dates = Object.keys(rates).sort();
  if (!dates.length) throw new Error('El BCRP no devolvió ninguna tasa válida.');

  const out = {
    source: 'BCRP - TC Sistema bancario SBS (S/ por US$) - Venta',
    series: SERIES,
    updatedAt: new Date().toISOString(),
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    rates,
  };

  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'tc-bcrp.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

  console.log(`OK: ${dates.length} tasas (${dates[0]} → ${dates[dates.length - 1]})`);
  console.log(`Archivo: ${file}`);
})().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
