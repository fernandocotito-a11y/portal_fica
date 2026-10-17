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
export const AFP_REM_MAX_ASEGURABLE = 10400; // S/ aprox. (editable)

/* ---- Comisiones y primas de seguro por AFP (referenciales) ---- */
export const AFP_BASE = [
  { afp: 'HABITAT', comisionFlujo: 0.0147, comisionSaldo: 0.0125, primaSeguro: 0.0137 },
  { afp: 'INTEGRA', comisionFlujo: 0.0155, comisionSaldo: 0.013, primaSeguro: 0.013 },
  { afp: 'PRIMA', comisionFlujo: 0.016, comisionSaldo: 0.0125, primaSeguro: 0.0125 },
  { afp: 'PROFUTURO', comisionFlujo: 0.0169, comisionSaldo: 0.012, primaSeguro: 0.012 },
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

/** Devuelve la UIT de un año (con fallback al más reciente definido). */
export function getUit(year) {
  return UIT[year] ?? UIT[2026];
}

/** Devuelve la RMV de un año (con fallback al más reciente definido). */
export function getRmv(year) {
  return RMV[year] ?? RMV[2026];
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
   Régimen laboral (Ley MYPE): afecta vacaciones, gratificaciones y CTS.
   - general: 30 días de vacaciones, beneficios 100%, con CTS.
   - microempresa: 15 días de vacaciones, beneficios 50%, SIN CTS.
   -------------------------------------------------------------------------- */
export const REGIMEN_LABORAL = [
  { value: 'general', label: 'Régimen general (30 días vac., beneficios 100%, con CTS)' },
  { value: 'microempresa', label: 'Microempresa / MYPE (15 días vac., beneficios 50%, sin CTS)' },
];

export const LABOR_RULES = {
  general: { vacationDays: 30, benefitFactor: 1, hasCts: true, label: 'Régimen general' },
  microempresa: { vacationDays: 15, benefitFactor: 0.5, hasCts: false, label: 'Microempresa' },
};

/** Reglas laborales según el régimen de la empresa. */
export function laborRules(regimen) {
  return LABOR_RULES[regimen] || LABOR_RULES.general;
}
