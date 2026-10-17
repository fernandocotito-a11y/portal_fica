/* ============================================================================
   payrollService.js — Motor de cálculo laboral (Perú) + persistencia (mock)
   ----------------------------------------------------------------------------
   - Fórmulas: total bruto, aportes del trabajador (ONP / AFP), Renta de 5ª
     categoría, Essalud, Seguro Vida Ley y neto a pagar.
   - Persistencia en LocalStorage (mock persistente): colaboradores, tabla AFP
     mensualizada y planillas por período (con opción de "cerrar" el mes).
   ========================================================================== */

import {
  TASAS,
  RENTA_5TA,
  AFP_BASE,
  buildAfpTable,
  getUit,
  getRmv,
} from './payrollConfig.js';

/* ------------------------------------------------------------------ utils */
function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* --------------------------------------------------------- localStorage */
const K_EMPLOYEES = 'fica.payroll.employees';
const K_AFPTABLE = 'fica.payroll.afpTable';
const K_PERIODS = 'fica.payroll.periods';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* noop */
  }
}

/* ================================================================ MOTOR === */

/** Devuelve los parámetros AFP de un período concreto. */
export function getAfpParams(year, month, afp) {
  const table = read(K_AFPTABLE, null) || buildAfpTable();
  const found = table.find((r) => r.year === year && r.month === month && r.afp === afp);
  if (found) return found;
  const base = AFP_BASE.find((a) => a.afp === afp) || AFP_BASE[0];
  return { ...base, aporteObligatorio: 0.1, remMaxAsegurable: 10400 };
}

/** Renta de 5ª categoría: estimación de la retención mensual (anual / 12). */
export function calcRenta5taMensual(annualRem, uit) {
  const base = Math.max(0, annualRem - RENTA_5TA.deduccionUIT * uit);
  let tax = 0;
  let prev = 0;
  for (const t of RENTA_5TA.tramos) {
    const limite = t.hastaUIT === Infinity ? Infinity : t.hastaUIT * uit;
    if (base > prev) tax += (Math.min(base, limite) - prev) * t.tasa;
    prev = limite;
    if (base <= limite) break;
  }
  return round2(tax / 12);
}

/**
 * Calcula una fila de planilla para un colaborador.
 * @param {Object} emp    Colaborador (sueldo base, régimen, AFP…).
 * @param {Object} inputs Valores editables del período (días, bonos, etc.).
 */
export function calcRow(emp, inputs = {}, year, month) {
  const uit = getUit(year);
  const rmv = getRmv(year);

  const days = clamp(num(inputs.days, 30), 0, 30);
  const basico = round2(num(emp.baseSalary) * (days / 30));
  const asigFamiliar = emp.asignacionFamiliar ? round2(rmv * TASAS.asignacionFamiliar) : 0;
  const vacaciones = round2(num(inputs.vacation));
  const bonificaciones = round2(num(inputs.bonuses));
  const totalBruto = round2(basico + asigFamiliar + vacaciones + bonificaciones);

  const remAsegurable = round2(basico + asigFamiliar);

  // Aporte del trabajador (pensión)
  let pension = 0;
  let pensionLabel = '—';
  if (emp.pensionType === 'ONP') {
    pension = round2(remAsegurable * TASAS.onp);
    pensionLabel = 'ONP 13%';
  } else if (emp.pensionType === 'AFP') {
    const p = getAfpParams(year, month, emp.afp);
    const baseAfp = Math.min(remAsegurable, num(p.remMaxAsegurable, remAsegurable));
    pension = round2(baseAfp * (num(p.aporteObligatorio, 0.1) + num(p.comisionFlujo) + num(p.primaSeguro)));
    pensionLabel = `AFP ${emp.afp || ''}`.trim();
  }

  const renta5ta = calcRenta5taMensual(remAsegurable * 12, uit);
  const tardanzas = round2(num(inputs.tardanzas));
  const prestamos = round2(num(inputs.loans));
  const totalRetenciones = round2(pension + renta5ta + tardanzas + prestamos);

  // Aportes del empleador
  const essalud = round2(remAsegurable * TASAS.essalud);
  const vidaLey = round2(num(inputs.vidaLey));
  const totalAportes = round2(essalud + vidaLey);

  const neto = round2(totalBruto - totalRetenciones);

  return {
    days,
    basico,
    asigFamiliar,
    vacaciones,
    bonificaciones,
    totalBruto,
    remAsegurable,
    pension,
    pensionLabel,
    renta5ta,
    tardanzas,
    prestamos,
    totalRetenciones,
    essalud,
    vidaLey,
    totalAportes,
    neto,
  };
}

/** Suma los totales de un conjunto de filas calculadas. */
export function sumTotals(rows) {
  const keys = [
    'basico', 'asigFamiliar', 'vacaciones', 'bonificaciones', 'totalBruto',
    'pension', 'renta5ta', 'tardanzas', 'prestamos', 'totalRetenciones',
    'essalud', 'vidaLey', 'totalAportes', 'neto',
  ];
  const acc = {};
  keys.forEach((k) => (acc[k] = 0));
  rows.forEach((r) => keys.forEach((k) => (acc[k] = round2(acc[k] + num(r[k])))));
  return acc;
}

/* ============================================================= SERVICIO === */

export const payrollService = {
  /* ------------------------- Tabla AFP (parámetros) -------------------- */
  ensureAfpTable() {
    if (!read(K_AFPTABLE, null)) write(K_AFPTABLE, buildAfpTable());
  },
  getAfpTable() {
    this.ensureAfpTable();
    return read(K_AFPTABLE, []);
  },

  /* --------------------------- Colaboradores --------------------------- */
  listEmployees() {
    return read(K_EMPLOYEES, []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  getEmployee(id) {
    return read(K_EMPLOYEES, []).find((e) => e.id === id) || null;
  },
  createEmployee(data) {
    const list = read(K_EMPLOYEES, []);
    const emp = {
      id: uuid(),
      code: String(data.code || '').trim(),
      docType: data.docType || 'DNI',
      docNumber: String(data.docNumber || '').trim(),
      name: String(data.name || '').trim(),
      startDate: data.startDate || '',
      position: String(data.position || '').trim(),
      baseSalary: num(data.baseSalary),
      pensionType: data.pensionType === 'AFP' ? 'AFP' : 'ONP',
      afp: data.pensionType === 'AFP' ? data.afp || 'HABITAT' : null,
      asignacionFamiliar: !!data.asignacionFamiliar,
      active: data.active !== false,
      createdAt: new Date().toISOString(),
    };
    list.push(emp);
    write(K_EMPLOYEES, list);
    return emp;
  },
  updateEmployee(id, patch) {
    const list = read(K_EMPLOYEES, []);
    const i = list.findIndex((e) => e.id === id);
    if (i === -1) throw new Error('Colaborador no encontrado.');
    list[i] = { ...list[i], ...patch, id };
    write(K_EMPLOYEES, list);
    return list[i];
  },
  removeEmployee(id) {
    write(K_EMPLOYEES, read(K_EMPLOYEES, []).filter((e) => e.id !== id));
  },

  /* ------------------------ Planillas por período ---------------------- */
  periodKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
  },
  getPeriodInputs(year, month) {
    const periods = read(K_PERIODS, {});
    return periods[this.periodKey(year, month)] || { closed: false, rows: {} };
  },
  /** Guarda las entradas editables de un período. */
  savePeriodInputs(year, month, rows, closed = false) {
    const periods = read(K_PERIODS, {});
    const key = this.periodKey(year, month);
    periods[key] = { closed, rows };
    write(K_PERIODS, periods);
  },
  /** Marca la planilla del mes como cerrada. */
  closePeriod(year, month, rows) {
    this.savePeriodInputs(year, month, rows, true);
  },
  isClosed(year, month) {
    return !!this.getPeriodInputs(year, month).closed;
  },
};
