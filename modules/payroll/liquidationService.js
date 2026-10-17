/* ============================================================================
   liquidationService.js — Liquidación de Beneficios Sociales (LBS)
   ----------------------------------------------------------------------------
   Calcula la liquidación al cese del trabajador:
     - CTS trunca.
     - Vacaciones truncas + vacaciones pendientes no gozadas.
     - Gratificación trunca semestral + bono extraordinario 9%.
     - Deducciones (aporte pensionario y regularización de Renta de 5ª).
   Genera una hoja de liquidación lista para imprimir/firmar.
   ========================================================================== */

import { num, round2, uuid, storeRead, storeWrite } from './payrollUtils.js';
import { getRmv, TASAS } from './payrollConfig.js';
import { scopedKey } from './payrollScope.js';

const K = 'liquidations';
const readS = (fb) => storeRead(scopedKey(K), fb);
const writeS = (v) => storeWrite(scopedKey(K), v);

export const MOTIVOS_CESE = [
  { value: 'renuncia', label: 'Renuncia voluntaria' },
  { value: 'despido', label: 'Despido' },
  { value: 'mutuo_acuerdo', label: 'Mutuo acuerdo' },
  { value: 'fin_contrato', label: 'Fin de contrato' },
  { value: 'jubilacion', label: 'Jubilación' },
];

export const liquidationService = {
  list() {
    return readS( []).slice().reverse();
  },

  save(liq) {
    const all = readS( []);
    const rec = { id: uuid(), createdAt: new Date().toISOString(), ...liq };
    all.push(rec);
    writeS( all);
    return rec;
  },

  remove(id) {
    writeS( readS( []).filter((r) => r.id !== id));
  },

  /**
   * Calcula la liquidación.
   * @param {Object} emp  Colaborador.
   * @param {Object} opts
   *   year, fechaCese, motivo
   *   diasCts            días computables de CTS trunca (desde el último depósito)
   *   mesesGrati         meses completos del semestre para gratificación trunca (0-6)
   *   vacProporcionales  días de vacaciones truncas (proporcionales)
   *   vacPendientes      días de vacaciones no gozadas
   *   tipoBono           'ESSALUD' | 'EPS'
   *   remuneracionMes    remuneración del mes del cese (para regularización)
   */
  calcLiquidacion(emp, opts = {}) {
    const year = opts.year || new Date().getFullYear();
    const asig = emp.asignacionFamiliar ? round2(getRmv(year) * TASAS.asignacionFamiliar) : 0;
    const basico = round2(num(emp.baseSalary));
    const base = round2(basico + asig);

    // 1) CTS trunca: base + 1/6 de la última gratificación (aproximado con base/6)
    const sexto = round2(base / 6);
    const ctsBase = round2(base + sexto);
    const diasCts = num(opts.diasCts, 0);
    const ctsTrunca = round2((ctsBase / 360) * diasCts);

    // 2) Vacaciones truncas + pendientes
    const daily = round2(base / 30);
    const vacTruncas = round2(daily * num(opts.vacProporcionales, 0));
    const vacPendientes = round2(daily * num(opts.vacPendientes, 0));

    // 3) Gratificación trunca + bono extraordinario
    const mesesGrati = Math.min(Math.max(num(opts.mesesGrati, 0), 0), 6);
    const gratiTrunca = round2((base / 6) * mesesGrati);
    const tasaBono = opts.tipoBono === 'EPS' ? 0.0675 : 0.09;
    const bonoExtra = round2(gratiTrunca * tasaBono);

    // Bruto
    const bruto = round2(ctsTrunca + vacTruncas + vacPendientes + gratiTrunca + bonoExtra);

    // 4) Deducciones: aporte pensionario sobre el afecto (vacaciones + gratificación)
    const afecto = round2(vacTruncas + vacPendientes + gratiTrunca);
    let pension = 0;
    let pensionLabel = '—';
    if (emp.pensionType === 'ONP') {
      pension = round2(afecto * TASAS.onp);
      pensionLabel = 'ONP 13%';
    } else if (emp.pensionType === 'AFP') {
      pension = round2(afecto * 0.1); // aporte obligatorio (la comisión/prima se aplican aparte)
      pensionLabel = `AFP ${emp.afp || ''} (aporte 10%)`.trim();
    }
    const renta5ta = round2(num(opts.renta5taRegularizacion, 0));
    const deducciones = round2(pension + renta5ta);

    const neto = round2(bruto - deducciones);

    return {
      employee: emp,
      year,
      fechaCese: opts.fechaCese || '',
      motivo: opts.motivo || 'renuncia',
      basico,
      asignacionFamiliar: asig,
      base,
      cts: { base: ctsBase, sexto, diasCts, monto: ctsTrunca },
      vacaciones: { daily, truncas: vacTruncas, pendientes: vacPendientes, diasTruncas: num(opts.vacProporcionales, 0), diasPendientes: num(opts.vacPendientes, 0) },
      gratificacion: { monto: gratiTrunca, mesesGrati, tasaBono, bonoExtra },
      bruto,
      deducciones: { pension, pensionLabel, renta5ta, total: deducciones },
      neto,
    };
  },
};
