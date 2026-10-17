/* ============================================================================
   sunatExporterService.js — Estructuras planas SUNAT (PLAME / T-Registro)
   ----------------------------------------------------------------------------
   Genera los archivos .jor (jornada laboral) y .rem (remuneraciones) con la
   información del período, listos para importar en el PDT Planilla Electrónica.

   Formato: archivo de texto plano, campos separados por "|" (pipe), una línea
   por registro. Nota: verificar contra el Anexo oficial vigente antes de la
   carga definitiva en el PDT (los layouts SUNAT se actualizan periódicamente).
   ========================================================================== */

import { amount2, downloadText } from './payrollUtils.js';
import { MESES } from './payrollConfig.js';

/** Códigos de concepto SUNAT usados en la planilla mensual. */
export const SUNAT_CONCEPTOS = [
  { code: '0121', key: 'basico', label: 'Sueldo básico' },
  { code: '0201', key: 'asigFamiliar', label: 'Asignación familiar' },
  { code: '0107', key: 'vacaciones', label: 'Remuneración vacacional' },
  { code: '0400', key: 'gratificacion', label: 'Gratificación' },
  { code: '0313', key: 'bonificaciones', label: 'Otras bonificaciones' },
];

function yyyymm(period) {
  return `${period.year}${String(period.month).padStart(2, '0')}`;
}

export const sunatExporterService = {
  /**
   * Estructura de Jornada Laboral (.jor).
   * @param {Array} rows [{ employee, calc, attendance }]
   */
  buildJor(rows, period) {
    const lines = [`JOR|${yyyymm(period)}`];
    rows.forEach(({ employee, calc, attendance }) => {
      const att = attendance || {};
      const diasLab = Math.round(calc?.days ?? 30);
      const diasSubsidiados = att.absentWithPay || 0; // descansos médicos con goce
      const diasNoLab = att.absentWithoutPay || 0; // no laborados sin goce
      const horasOrd = diasLab * 8;
      const horasExtra = Math.round(((att.extraMinutes || 0) / 60) * 100) / 100;
      lines.push(
        [
          employee.docNumber || '',
          diasLab,
          diasSubsidiados,
          diasNoLab,
          horasOrd,
          horasExtra,
        ].join('|')
      );
    });
    return lines.join('\r\n');
  },

  /**
   * Estructura de Remuneraciones (.rem).
   * @param {Array} rows [{ employee, calc }]
   */
  buildRem(rows, period) {
    const lines = [`REM|${yyyymm(period)}`];
    rows.forEach(({ employee, calc }) => {
      SUNAT_CONCEPTOS.forEach((c) => {
        const monto = Number(calc?.[c.key] || 0);
        if (monto > 0) {
          // dni|codigo|devengado|pagado
          lines.push([employee.docNumber || '', c.code, amount2(monto), amount2(monto)].join('|'));
        }
      });
    });
    return lines.join('\r\n');
  },

  downloadJor(rows, period) {
    downloadText(`PLAME_JOR_${yyyymm(period)}.jor`, this.buildJor(rows, period));
  },
  downloadRem(rows, period) {
    downloadText(`PLAME_REM_${yyyymm(period)}.rem`, this.buildRem(rows, period));
  },
};
