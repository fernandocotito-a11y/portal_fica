/* ============================================================================
   complianceAuditService.js — Motor de auditoría preventiva y alertas
   ----------------------------------------------------------------------------
   Valida consistencia legal antes de emitir/declarar:
     1. Vencimiento de contratos a plazo fijo (aviso a 30 días).
     2. Récord vacacional vencido (riesgo de triple vacacional).
     3. Base mínima de EsSalud (9% de la RMV).
     4. Límite legal de descuentos (inembargable).
   ========================================================================== */

import { vacationService } from './vacationService.js';
import { num, round2 } from './payrollUtils.js';
import { getRmv } from './payrollConfig.js';

const MS_DAY = 86400000;

export const complianceAuditService = {
  /**
   * Ejecuta la auditoría y devuelve la lista de alertas.
   * @param {Array} rows [{ employee, calc }]
   * @param {Object} period { year, month }
   */
  audit(rows, period, { today = new Date() } = {}) {
    const rmv = getRmv(period.year);
    const alerts = [];

    rows.forEach(({ employee, calc }) => {
      /* 1) Contratos a plazo fijo por vencer (30 días) */
      if (employee.contractType === 'plazo_fijo' && employee.contractEnd) {
        const end = new Date(employee.contractEnd);
        if (!Number.isNaN(end.getTime())) {
          const days = Math.ceil((end.getTime() - today.getTime()) / MS_DAY);
          if (days < 0) {
            alerts.push({ level: 'danger', type: 'contrato', employee: employee.name, message: `Contrato VENCIDO el ${employee.contractEnd} (hace ${Math.abs(days)} día(s)). Regularizar.` });
          } else if (days <= 30) {
            alerts.push({ level: 'warning', type: 'contrato', employee: employee.name, message: `Contrato por vencer en ${days} día(s) (${employee.contractEnd}).` });
          }
        }
      }

      /* 2) Récord vacacional */
      if (employee.startDate) {
        const start = new Date(employee.startDate);
        const meses = Math.floor((today.getTime() - start.getTime()) / (MS_DAY * 30.44));
        const acumulados = round2((Math.max(0, meses) / 12) * 30);
        const gozados = round2(vacationService.list(employee.id).reduce((s, r) => s + num(r.daysTaken), 0));
        const pendientes = round2(Math.max(0, acumulados - gozados));
        if (meses >= 12 && pendientes > 0) {
          const vencido = meses >= 24;
          alerts.push({
            level: vencido ? 'danger' : 'info',
            type: 'vacaciones',
            employee: employee.name,
            message: `Vacaciones pendientes: ${pendientes} día(s). ${vencido ? 'Récord vencido — riesgo de indemnización (triple vacacional).' : 'Programar goce.'}`,
          });
        }
      }

      /* 3) Base mínima de EsSalud */
      if (num(calc.remAsegurable) < rmv) {
        alerts.push({
          level: 'info',
          type: 'essalud',
          employee: employee.name,
          message: `Remuneración asegurable (S/ ${num(calc.remAsegurable).toFixed(2)}) menor a la RMV (S/ ${rmv}); corresponde base mínima para EsSalud.`,
        });
      }

      /* 4) Límite de descuentos (inembargable = 1 RMV) */
      const descuentos = round2(num(calc.prestamos) + num(calc.pension) + num(calc.renta5ta) + num(calc.tardanzas));
      if (descuentos > 0 && num(calc.neto) < rmv) {
        alerts.push({
          level: 'warning',
          type: 'descuentos',
          employee: employee.name,
          message: `El neto (S/ ${num(calc.neto).toFixed(2)}) queda por debajo de la RMV por descuentos de préstamos/adelantos; revisar límite legal inembargable.`,
        });
      }
    });

    return alerts;
  },

  /** Cuenta alertas por nivel. */
  summarize(alerts) {
    return {
      total: alerts.length,
      danger: alerts.filter((a) => a.level === 'danger').length,
      warning: alerts.filter((a) => a.level === 'warning').length,
      info: alerts.filter((a) => a.level === 'info').length,
    };
  },
};
