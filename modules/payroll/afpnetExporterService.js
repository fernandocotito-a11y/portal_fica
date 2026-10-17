/* ============================================================================
   afpnetExporterService.js — Exportador formal para AFPnet
   ----------------------------------------------------------------------------
   Genera el archivo plano (.txt) para declarar aportes previsionales en AFPnet.

   Columnas normativas (separadas por "|"):
     Secuencia | CUSPP | Tipo doc | Nro doc | Apellidos y Nombres | Relación
     Laboral (S/N) | Inicio RL (S/N) | Cese RL (S/N) | Excepción de Aportar |
     Remuneración Asegurable | Aporte Voluntario | Tipo de Trabajo (N)

   Validaciones: limpieza de texto (sin caracteres especiales) y tope de la
   Remuneración Máxima Asegurable (SBS).
   ========================================================================== */

import { amount2, sanitizeText, downloadText } from './payrollUtils.js';
import { getAfpParams } from './payrollService.js';

function yyyymm(period) {
  return `${period.year}${String(period.month).padStart(2, '0')}`;
}

export const afpnetExporterService = {
  /**
   * Construye el archivo AFPnet.
   * @param {Array} rows [{ employee, calc }]
   * @param {Object} period { year, month }
   * @returns {{ text: string, warnings: string[] }}
   */
  build(rows, period) {
    const warnings = [];
    const lines = [];
    let seq = 1;

    // Solo afiliados a AFP.
    const afpRows = rows.filter(({ employee }) => employee.pensionType === 'AFP');

    afpRows.forEach(({ employee, calc }) => {
      if (!employee.cuspp) {
        warnings.push(`${employee.name}: sin CUSPP (obligatorio para AFPnet).`);
      }
      if (!employee.docNumber || employee.docNumber.length < 8) {
        warnings.push(`${employee.name}: número de documento incompleto.`);
      }

      const params = getAfpParams(period.year, period.month, employee.afp);
      const tope = params.remMaxAsegurable;
      let rem = Number(calc?.remAsegurable || 0);
      if (rem > tope) {
        warnings.push(`${employee.name}: remuneración ${rem} supera el tope SBS (${tope}); se ajustó al tope.`);
        rem = tope;
      }

      lines.push(
        [
          seq++, // Secuencia correlativa
          employee.cuspp || '', // CUSPP
          employee.docType === 'DNI' ? '01' : employee.docType, // Tipo doc (01=DNI)
          employee.docNumber || '', // Nro documento
          sanitizeText(employee.name).toUpperCase(), // Apellidos y Nombres
          'S', // Relación laboral
          'S', // Inicio de RL
          'N', // Cese de RL
          '', // Excepción de aportar
          amount2(rem), // Remuneración asegurable
          amount2(0), // Aporte voluntario
          'N', // Tipo de trabajo (N = normal)
        ].join('|')
      );
    });

    const header = `AFP|${yyyymm(period)}|${afpRows.length} afiliado(s)`;
    const text = [header, ...lines].join('\r\n');
    return { text, warnings, count: afpRows.length };
  },

  download(rows, period) {
    const { text, warnings } = this.build(rows, period);
    downloadText(`AFPNET_${yyyymm(period)}.txt`, text);
    return warnings;
  },
};
