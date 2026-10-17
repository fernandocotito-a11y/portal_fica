/* ============================================================================
   bankingService.js — Interfaz para dispersión de pagos bancarios
   ----------------------------------------------------------------------------
   Genera planillas de pago electrónico masivo (Telecrédito / Interbank / Alfin)
   de haberes y CTS, con soporte de cuenta y CCI interbancario.

   Formato (texto plano, "|"):
     Tipo doc | Nro doc | Nombre | Banco | Cuenta/CCI | Importe neto | Glosa
   ========================================================================== */

import { amount2, sanitizeText, downloadText } from './payrollUtils.js';

function yyyymm(period) {
  return `${period.year}${String(period.month).padStart(2, '0')}`;
}

export const bankingService = {
  /** Valida las cuentas del colaborador según el modo (cuenta o CCI). */
  validate(rows, useCci) {
    const warnings = [];
    rows.forEach(({ employee }) => {
      const acc = useCci ? employee.bankCci : employee.bankAccount;
      if (!acc) {
        warnings.push(`${employee.name}: sin ${useCci ? 'CCI' : 'cuenta bancaria'}.`);
        return;
      }
      const digits = String(acc).replace(/\D/g, '');
      if (useCci && digits.length !== 20) {
        warnings.push(`${employee.name}: el CCI debe tener 20 dígitos (tiene ${digits.length}).`);
      }
      if (!useCci && (digits.length < 10 || digits.length > 20)) {
        warnings.push(`${employee.name}: cuenta bancaria con longitud inusual (${digits.length}).`);
      }
    });
    return warnings;
  },

  /**
   * Planilla de pago de HABERES.
   * @param {Array} rows [{ employee, calc }]
   * @param {Object} period { year, month }
   * @param {Object} opts { useCci }
   */
  buildHaberes(rows, period, { useCci = true } = {}) {
    const warnings = this.validate(rows, useCci);
    const glosa = `HABERES ${String(period.month).padStart(2, '0')}/${period.year}`;
    const lines = [];

    rows.forEach(({ employee, calc }) => {
      const cta = useCci ? employee.bankCci : employee.bankAccount;
      if (!cta) return;
      lines.push(
        [
          employee.docType || 'DNI',
          employee.docNumber || '',
          sanitizeText(employee.name).toUpperCase(),
          sanitizeText(employee.bankName || '').toUpperCase(),
          String(cta).replace(/\s/g, ''),
          amount2(calc?.neto || 0),
          glosa,
        ].join('|')
      );
    });

    const text = [`HABERES|${yyyymm(period)}|${lines.length} abono(s)`, ...lines].join('\r\n');
    return { text, warnings, count: lines.length };
  },

  /**
   * Planilla de pago de CTS.
   * @param {Array} ctsRows [{ employee, cts: { monto } }]
   */
  buildCts(ctsRows, period, { useCci = true } = {}) {
    const glosa = `CTS ${period.year}`;
    const lines = [];
    const warnings = [];

    ctsRows.forEach(({ employee, cts }) => {
      const cta = useCci ? employee.bankCci : employee.bankAccount;
      if (!cta) {
        warnings.push(`${employee.name}: sin ${useCci ? 'CCI' : 'cuenta'} para abonar CTS.`);
        return;
      }
      lines.push(
        [
          employee.docType || 'DNI',
          employee.docNumber || '',
          sanitizeText(employee.name).toUpperCase(),
          sanitizeText(employee.bankName || '').toUpperCase(),
          String(cta).replace(/\s/g, ''),
          amount2(cts?.monto || 0),
          glosa,
        ].join('|')
      );
    });

    const text = [`CTS|${period.year}|${lines.length} abono(s)`, ...lines].join('\r\n');
    return { text, warnings, count: lines.length };
  },

  downloadHaberes(rows, period, opts) {
    const { text, warnings } = this.buildHaberes(rows, period, opts);
    downloadText(`BANCO_HABERES_${yyyymm(period)}.txt`, text);
    return warnings;
  },
  downloadCts(ctsRows, period, opts) {
    const { text, warnings } = this.buildCts(ctsRows, period, opts);
    downloadText(`BANCO_CTS_${period.year}.txt`, text);
    return warnings;
  },
};
