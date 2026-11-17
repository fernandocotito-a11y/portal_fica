#!/usr/bin/env node
/* ============================================================================
   build-bcrp.js — Descarga el tipo de cambio oficial SUNAT / SBS desde la API
   pública del BCRP y genera `data/tc-bcrp.json`.

   Normativa tributaria SUNAT (Perú):
     - Para Compras (Crédito Fiscal): rige el tipo de cambio promedio COMPRA
       publicado por la SBS al cierre del día hábil anterior.
     - Para Ventas (Débito Fiscal): rige el tipo de cambio promedio VENTA
       publicado por la SBS al cierre del día hábil anterior.
     - Para días no laborables (sábados, domingos y feriados): rige el tipo
       de cambio del último día hábil anterior (forward-fill).
     - La tabla oficial de SUNAT tiene valores para TODOS los días del calendario.

   Series oficiales SBS expuestas por el BCRP:
     - PD04639PD: SBS Compra
     - PD04640PD: SBS Venta
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const SERIES = 'PD04639PD-PD04640PD';
const YEARS = Number(process.argv[2] || 3);

const MONTHS = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

/** Convierte "02.Nov.26" a "2026-11-02". */
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

  console.log(`Consultando tipo de cambio oficial SBS (Compra y Venta) del ${start} al ${end}…`);
  const data = await fetchRange(start, end);

  // 1. Recolectar tasas válidas de los días hábiles devueltos por el BCRP
  const businessDays = new Map();
  for (const period of data.periods || []) {
    const iso = isoFromBcrp(period.name);
    if (!iso) continue;
    const v0 = String((period.values || [])[0] || '').trim();
    const v1 = String((period.values || [])[1] || '').trim();

    const c = /^\d+(\.\d+)?$/.test(v0) ? Number(v0) : 0;
    const v = /^\d+(\.\d+)?$/.test(v1) ? Number(v1) : (c || 0);

    const compra = c > 0 ? c : v;
    const venta = v > 0 ? v : c;

    if (compra > 0 && venta > 0) {
      businessDays.set(iso, { compra, venta });
    }
  }

  const sortedHabil = [...businessDays.keys()].sort();
  if (!sortedHabil.length) throw new Error('El BCRP no devolvió ninguna tasa válida.');

  // 2. Generar el calendario COMPLETO día por día (regla oficial SUNAT: forward-fill)
  // Ningún día queda sin tipo de cambio: sábados, domingos, feriados y días pendientes
  // repiten automáticamente el último día hábil anterior hasta el día de hoy.
  const firstHabil = sortedHabil[0];
  const lastHabil = sortedHabil[sortedHabil.length - 1];
  const todayIso = new Date().toISOString().slice(0, 10);
  const targetEnd = todayIso > lastHabil ? todayIso : lastHabil;

  const startDate = new Date(`${firstHabil}T00:00:00Z`);
  const endDate = new Date(`${targetEnd}T00:00:00Z`);

  const rates = {};
  let lastKnown = null;

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (businessDays.has(iso)) {
      lastKnown = businessDays.get(iso);
    }
    if (lastKnown) {
      rates[iso] = {
        compra: lastKnown.compra,
        venta: lastKnown.venta,
      };
    }
  }

  const dates = Object.keys(rates).sort();

  const out = {
    source: 'SUNAT / SBS (vía BCRP API) - TC Promedio Ponderado Compra y Venta',
    series: {
      compra: 'PD04639PD',
      venta: 'PD04640PD',
    },
    rule: 'Días no laborables (fines de semana y feriados) toman el último día hábil anterior según normativa SUNAT.',
    updatedAt: new Date().toISOString(),
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    totalCalendarDays: dates.length,
    rates,
  };

  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'tc-bcrp.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

  console.log(`OK: ${dates.length} días calendario cubiertos sin huecos (${dates[0]} → ${dates[dates.length - 1]})`);
  console.log(`Archivo: ${file}`);
})().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
