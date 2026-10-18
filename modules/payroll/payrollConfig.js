/* ============================================================================
   payrollConfig.js — Parámetros legales y tablas dinámicas (Planillas Perú)
   ----------------------------------------------------------------------------
   Centraliza los valores legales (UIT, RMV, tasas) y las tablas dinámicas:
   - Tabla mensualizada de AFP (comisión flujo/saldo, prima de seguro,
     aporte obligatorio y Remuneración Máxima Asegurable - SBS).
   - Escala progresiva de Renta de 5ª Categoría.

   Nota: son valores de referencia (editables). En producción se actualizan
   cada año/mes según SUNAT y SBS.
   ========================================================================== */

/* ---- UIT (Unidad Impositiva Tributaria) por año ---- */
export const UIT = {
  2023: 4950,
  2024: 5150,
  2025: 5350,
  2026: 5350,
};

/* ---- RMV (Remuneración Mínima Vital) por año ---- */
export const RMV = {
  2023: 1025,
  2024: 1025,
  2025: 1130,
  2026: 1130,
};

/* ---------------------------------------------------------------------------
   Overrides dinámicos (configurables desde la pestaña "Parámetros UIT / RMV").
   Se cargan desde Supabase (tabla `payroll_params`) y pisan el mapa estático.
   -------------------------------------------------------------------------- */
let UIT_OVERRIDES = {};
let RMV_OVERRIDES = {};

/** Establece la UIT de un año (override dinámico). */
export function setUitYear(year, val) {
  const v = num(val);
  const y = Number(year);
  if (Number.isFinite(y) && v > 0) UIT_OVERRIDES[y] = v;
  else delete UIT_OVERRIDES[y];
}

/** Establece la RMV de un año (override dinámico). */
export function setRmvYear(year, val) {
  const v = num(val);
  const y = Number(year);
  if (Number.isFinite(y) && v > 0) RMV_OVERRIDES[y] = v;
  else delete RMV_OVERRIDES[y];
}

/** Limpia los overrides (se invoca antes de recargar desde Supabase). */
export function resetParams() {
  UIT_OVERRIDES = {};
  RMV_OVERRIDES = {};
}

/* ---- Tasas generales ---- */
export const TASAS = {
  essalud: 0.09, // aporte del empleador
  onp: 0.13, // descuento del trabajador (ONP)
  asignacionFamiliar: 0.1, // 10% de la RMV
};

/* ---- Escala progresiva de Renta de 5ª Categoría ---- */
export const RENTA_5TA = {
  deduccionUIT: 7, // deducción legal inicial
  tramos: [
    { hastaUIT: 5, tasa: 0.08 },
    { hastaUIT: 20, tasa: 0.14 },
    { hastaUIT: 35, tasa: 0.17 },
    { hastaUIT: 45, tasa: 0.2 },
    { hastaUIT: Infinity, tasa: 0.3 },
  ],
};

/* ---- AFP: aporte obligatorio y Remuneración Máxima Asegurable (SBS) ---- */
export const AFP_APORTE_OBLIGATORIO = 0.1; // 10%
export const AFP_REM_MAX_ASEGURABLE = 12732.7; // S/ (actualizado vía SBS)

/* ---- Comisiones y primas de seguro por AFP (valores SBS vigentes) ---- */
export const AFP_BASE = [
  { afp: 'HABITAT', comisionFlujo: 0.0147, comisionSaldo: 0.0125, primaSeguro: 0.0137 },
  { afp: 'INTEGRA', comisionFlujo: 0.0155, comisionSaldo: 0.0078, primaSeguro: 0.0137 },
  { afp: 'PRIMA', comisionFlujo: 0.016, comisionSaldo: 0.0125, primaSeguro: 0.0137 },
  { afp: 'PROFUTURO', comisionFlujo: 0.0169, comisionSaldo: 0.0068, primaSeguro: 0.0137 },
];

/** Lista de AFPs disponibles. */
export const AFP_LIST = AFP_BASE.map((a) => a.afp);

/**
 * Genera la tabla mensualizada de AFP para un rango de años.
 * Devuelve filas: { year, month, afp, comisionFlujo, comisionSaldo,
 *                   primaSeguro, aporteObligatorio, remMaxAsegurable }.
 */
export function buildAfpTable(years = [2025, 2026]) {
  const rows = [];
  for (const year of years) {
    for (let month = 1; month <= 12; month++) {
      for (const a of AFP_BASE) {
        rows.push({
          year,
          month,
          afp: a.afp,
          comisionFlujo: a.comisionFlujo,
          comisionSaldo: a.comisionSaldo,
          primaSeguro: a.primaSeguro,
          aporteObligatorio: AFP_APORTE_OBLIGATORIO,
          remMaxAsegurable: AFP_REM_MAX_ASEGURABLE,
        });
      }
    }
  }
  return rows;
}

/** UIT de un año (override > mapa estático > año más reciente definido). */
export function getUit(year) {
  const y = Number(year) || new Date().getFullYear();
  for (let i = y; i >= y - 10; i -= 1) {
    const v = UIT_OVERRIDES[i] ?? UIT[i];
    if (v != null) return v;
  }
  return UIT[2026] ?? 5350;
}

/** RMV de un año (override > mapa estático > año más reciente definido). */
export function getRmv(year) {
  const y = Number(year) || new Date().getFullYear();
  for (let i = y; i >= y - 10; i -= 1) {
    const v = RMV_OVERRIDES[i] ?? RMV[i];
    if (v != null) return v;
  }
  return RMV[2026] ?? 1130;
}

/* ---- Catálogos auxiliares ---- */
export const TIPOS_DOCUMENTO = [
  { value: 'DNI', label: 'DNI — Documento Nacional de Identidad' },
  { value: 'CE', label: 'Carné de Extranjería' },
  { value: 'PAS', label: 'Pasaporte' },
  { value: 'RUC', label: 'RUC' },
];

export const REGIMENES_PENSION = [
  { value: 'ONP', label: 'ONP (Sistema Nacional de Pensiones)' },
  { value: 'AFP', label: 'AFP (Sistema Privado de Pensiones)' },
];

export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/* ---------------------------------------------------------------------------
   Régimen laboral (Ley MYPE - Ley 28015 / Ley 30056):
   - general:         30 días vac., gratificaciones y CTS al 100%.
   - pequena_empresa: 15 días vac., gratificaciones y CTS al 50%.
   - microempresa:    15 días vac., SIN gratificaciones ni CTS.
   -------------------------------------------------------------------------- */
export const LABOR_RULES = {
  general: { vacationDays: 30, benefitFactor: 1, hasCts: true, label: 'Régimen general' },
  pequena_empresa: { vacationDays: 15, benefitFactor: 0.5, hasCts: true, label: 'Pequeña empresa' },
  microempresa: { vacationDays: 15, benefitFactor: 0, hasCts: false, label: 'Microempresa' },
};

/** Reglas laborales según el régimen de la empresa. */
export function laborRules(regimen) {
  return LABOR_RULES[regimen] || LABOR_RULES.general;
}

/* ---- Tipo de comisión AFP del afiliado ---- */
export const COMMISSION_TYPES = [
  { value: 'flujo', label: 'Comisión sobre flujo (se descuenta la comisión)' },
  { value: 'mixta', label: 'Comisión mixta (flujo 0% — no se descuenta comisión)' },
];

/* ---- Tipo de bonificación (afectación a pensiones) ---- */
export const BONUS_TYPES = [
  { value: 'regular', label: 'Bonificación regular (AFECTA a pensiones/EsSalud)' },
  { value: 'extraordinaria', label: 'Bonificación extraordinaria (NO afecta)' },
];

/* ---- Catálogo de conceptos de bonificación (la afectación viene incluida) ---- */
export const BONUS_CONCEPTS = [
  // Afectas (regulares)
  { value: 'productividad', label: 'Bonificación por productividad', tipo: 'regular' },
  { value: 'asistencia', label: 'Bonificación por asistencia', tipo: 'regular' },
  { value: 'responsabilidad', label: 'Bonificación por responsabilidad', tipo: 'regular' },
  { value: 'tiempo_servicio', label: 'Bonificación por tiempo de servicio', tipo: 'regular' },
  { value: 'turno_nocturno', label: 'Bonificación por turno nocturno / guardia', tipo: 'regular' },
  { value: 'comisiones', label: 'Comisiones', tipo: 'regular' },
  // No afectas (extraordinarias) — Art. 19 del Reglamento de la LIR
  { value: 'cumpleanos', label: 'Bonificación por cumpleaños', tipo: 'extraordinaria' },
  { value: 'matrimonio', label: 'Asignación por matrimonio', tipo: 'extraordinaria' },
  { value: 'nacimiento', label: 'Bonificación por nacimiento de hijo', tipo: 'extraordinaria' },
  { value: 'escolaridad', label: 'Bonificación por escolaridad', tipo: 'extraordinaria' },
  { value: 'fallecimiento', label: 'Bonificación por fallecimiento de familiar', tipo: 'extraordinaria' },
  { value: 'otro', label: 'Otro concepto (escribir)', tipo: 'regular' },
];

/** Comisión mensual (sobre flujo) según el tipo de comisión del afiliado. */
export function monthlyCommission(commissionType, afpParams) {
  return commissionType === 'mixta' ? 0 : num(afpParams.comisionFlujo);
}

function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}
