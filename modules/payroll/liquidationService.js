/* ============================================================================
   liquidationService.js — Liquidación de Beneficios Sociales (Supabase)
   ----------------------------------------------------------------------------
   Cálculo AUTOMÁTICO al cese (sin ingreso manual de días ni montos):
     · CTS trunca: días del período semestral vigente (180 − inasistencias).
     · Vacaciones truncas: proporcional desde el último aniversario.
     · Vacaciones pendientes: años completos no gozados (menos las tomadas).
     · Gratificación trunca: meses del semestre (factor del régimen).
     · Bonificación extraordinaria: 9% / 6.75% (EPS).
     · Renta 5ª: regularización anual real (enero–cese) menos retenciones.
     · Pensión: ONP 13% / AFP (aporte + comisión + prima).
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { num, round2 } from './payrollUtils.js';
import { getRmv, TASAS, laborRules, monthlyCommission } from './payrollConfig.js';
import { activeCompanyId, activeCompany } from './payrollScope.js';
import { attendanceService } from './attendanceService.js';
import { vacationService } from './vacationService.js';
import { gratificacionService } from './gratificacionService.js';
import { calcRow, deriveMonthInputs, inPeriod, getAfpParams } from './payrollService.js';
import { impuestoAnual, uitDelAnio, DEDUCCION_UIT } from './taxService.js';

let cache = [];

export const MOTIVOS_CESE = [
  { value: 'renuncia', label: 'Renuncia voluntaria' },
  { value: 'despido', label: 'Despido' },
  { value: 'mutuo_acuerdo', label: 'Mutuo acuerdo' },
  { value: 'fin_contrato', label: 'Fin de contrato' },
  { value: 'jubilacion', label: 'Jubilación' },
];

/* --------------------------------------------------------------- utilidades */
function map(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name || '',
    fechaCese: r.fecha_cese || '',
    motivo: r.motivo || 'renuncia',
    bruto: num(r.bruto),
    neto: num(r.neto),
    createdAt: r.created_at,
  };
}

/** Parsea 'YYYY-MM-DD' sin desfase UTC. */
function parseISO(iso) {
  const s = String(iso || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}
function toUTC(p) {
  return Date.UTC(p.y, p.m - 1, p.d);
}
function isoOf(p) {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
/** Días trabajados incluyendo ambos extremos. */
function daysInclusive(a, b) {
  return Math.max(0, Math.round((toUTC(b) - toUTC(a)) / 86400000) + 1);
}
/** Días transcurridos entre dos fechas (sin contar el día final). */
function elapsedDays(a, b) {
  return Math.max(0, Math.round((toUTC(b) - toUTC(a)) / 86400000));
}
function laterOf(a, b) {
  return toUTC(a) >= toUTC(b) ? a : b;
}
/** Años completos de servicio. */
function completedYears(start, end) {
  let y = end.y - start.y;
  if (end.m < start.m || (end.m === start.m && end.d < start.d)) y -= 1;
  return Math.max(0, y);
}

/** Período CTS (depósito de mayo: 01/11–30/04 · depósito de noviembre: 01/05–31/10). */
function ctsPeriodo(cese) {
  if (cese.m >= 5 && cese.m <= 10) {
    return {
      nombre: `Noviembre ${cese.y}`,
      start: { y: cese.y, m: 5, d: 1 },
      end: { y: cese.y, m: 10, d: 31 },
    };
  }
  if (cese.m >= 11) {
    return {
      nombre: `Mayo ${cese.y + 1}`,
      start: { y: cese.y, m: 11, d: 1 },
      end: { y: cese.y + 1, m: 4, d: 30 },
    };
  }
  return {
    nombre: `Mayo ${cese.y}`,
    start: { y: cese.y - 1, m: 11, d: 1 },
    end: { y: cese.y, m: 4, d: 30 },
  };
}

/**
 * Vacaciones:
 *  · pendientes = días de años completos − días ya gozados.
 *  · truncas = proporcional del año en curso (desde el último aniversario).
 *  Si se gozaron días del año en curso, se descuentan de las truncas.
 */
function vacationAccrual(start, cese, baseDays, taken) {
  const years = completedYears(start, cese);
  const anniv = { y: start.y + years, m: start.m, d: start.d };

  let months = (cese.y - anniv.y) * 12 + (cese.m - anniv.m);
  let days = cese.d - anniv.d;
  if (days < 0) {
    months -= 1;
    days += 30;
  }
  months = Math.max(0, months);
  days = Math.max(0, days);

  let truncas = round2((months / 12) * baseDays + (days / 360) * baseDays);
  truncas = round2(Math.min(baseDays, Math.max(0, truncas)));

  const accruedCompleted = round2(years * baseDays);
  const pendientes = round2(Math.max(0, accruedCompleted - taken));
  const exceso = round2(Math.max(0, taken - accruedCompleted));
  truncas = round2(Math.max(0, truncas - exceso));

  return { years, truncated: truncas, pending: pendientes, accruedCompleted };
}

export const liquidationService = {
  async refresh() {
    const cid = activeCompanyId();
    if (!cid) {
      cache = [];
      return;
    }
    const { data } = await supabase.from('payroll_liquidations').select('*').eq('company_id', cid).order('created_at', { ascending: false });
    cache = (data || []).map(map);
  },

  list() {
    return cache.slice();
  },

  async save(liq) {
    const row = {
      company_id: activeCompanyId(),
      employee_id: liq.employeeId || null,
      employee_name: liq.employeeName || null,
      fecha_cese: liq.fechaCese || null,
      motivo: liq.motivo || 'renuncia',
      bruto: num(liq.bruto),
      neto: num(liq.neto),
    };
    const { data: saved, error } = await supabase.from('payroll_liquidations').insert(row).select().single();
    if (error) throw new Error(error.message);
    const rec = map(saved);
    cache.unshift(rec);
    return rec;
  },

  async remove(id) {
    const { error } = await supabase.from('payroll_liquidations').delete().eq('id', id);
    if (error) throw new Error(error.message);
    cache = cache.filter((r) => r.id !== id);
  },

  /* ------------------------------------------------------------------ Cálculo */
  /**
   * Liquidación automática al cese.
   * @param {Object} emp   Colaborador (payrollService)
   * @param {Object} opts  { fechaCese, motivo }
   */
  calcLiquidacion(emp, opts = {}) {
    const cese = parseISO(opts.fechaCese);
    if (!cese) throw new Error('Indica una fecha de cese válida.');
    const start = parseISO(emp.startDate);
    if (!start) throw new Error('El colaborador no tiene fecha de ingreso registrada.');
    if (toUTC(start) > toUTC(cese)) throw new Error('La fecha de cese no puede ser anterior a la fecha de ingreso.');

    const company = activeCompany();
    const rules = laborRules(company && company.regimen_laboral);
    const year = cese.y;

    /* ------------------------------- Remuneración ------------------------------ */
    const asig = emp.asignacionFamiliar ? round2(getRmv(year) * TASAS.asignacionFamiliar) : 0;
    const basico = round2(num(emp.baseSalary));
    const base = round2(basico + asig);
    const daily = round2(base / 30);

    /* ---------------------------------- CTS ---------------------------------- */
    const periodo = ctsPeriodo(cese);
    const ctsStart = laterOf(periodo.start, start);
    let ctsUnpaid = 0;
    if (rules.hasCts) {
      attendanceService.list(emp.id).forEach((r) => {
        const d = String(r.date || '').slice(0, 10);
        if (!d || d < isoOf(ctsStart) || d > isoOf(cese)) return;
        if (r.withPay === false && ['falta', 'descanso_medico', 'licencia'].includes(r.type)) ctsUnpaid += 1;
      });
    }
    const ctsDias = rules.hasCts ? Math.min(180, Math.max(0, daysInclusive(ctsStart, cese) - ctsUnpaid)) : 0;
    const sexto = round2(base / 6);
    const ctsBase = round2(base + sexto);
    const ctsMonto = rules.hasCts ? round2((ctsBase / 360) * ctsDias) : 0;

    /* ------------------------------ Vacaciones ------------------------------- */
    const taken = round2(vacationService.list(emp.id).reduce((s, r) => s + num(r.daysTaken), 0));
    const vac = vacationAccrual(start, cese, rules.vacationDays, taken);
    const vacTruncas = round2(daily * vac.truncated);
    const vacPendientes = round2(daily * vac.pending);

    /* ----------------------------- Gratificación ----------------------------- */
    const semStart = cese.m <= 6 ? { y: cese.y, m: 1, d: 1 } : { y: cese.y, m: 7, d: 1 };
    const semPayMonth = cese.m <= 6 ? 7 : 12;
    const gStart = laterOf(semStart, start);
    const diasGrati = elapsedDays(gStart, cese);
    const mesesGrati = Math.min(6, Math.max(0, round2(diasGrati / 30)));
    const yaPagada = gratificacionService.hasRegistered(emp.id, year, semPayMonth);
    const gratiTrunca = yaPagada ? 0 : round2((base / 6) * mesesGrati * rules.benefitFactor);
    const tasaBono = emp.salud === 'EPS' ? 0.0675 : 0.09;
    const bonoExtra = round2(gratiTrunca * tasaBono);

    const bruto = round2(ctsMonto + vacTruncas + vacPendientes + gratiTrunca + bonoExtra);
    const afecto = round2(vacTruncas + vacPendientes + gratiTrunca);

    /* -------------------------------- Pensión -------------------------------- */
    let pension = 0;
    let pensionLabel = '—';
    if (emp.pensionType === 'ONP') {
      pension = round2(afecto * TASAS.onp);
      pensionLabel = 'ONP 13%';
    } else if (emp.pensionType === 'AFP') {
      const p = getAfpParams(year, cese.m, emp.afp);
      const baseAfp = Math.min(afecto, num(p.remMaxAsegurable, afecto));
      const comision = monthlyCommission(emp.commissionType, p);
      pension = round2(baseAfp * (p.aporteObligatorio + comision + p.primaSeguro));
      pensionLabel = `AFP ${emp.afp || ''} · ${emp.commissionType === 'mixta' ? 'mixta' : 'flujo'}`.trim();
    }

    /* -------------------------------- Renta 5ª ------------------------------- */
    const uit = uitDelAnio(year);
    const empRenta = { ...emp, cese: '' }; // incluye el mes de cese aunque ya esté marcado
    let remuneraciones = 0;
    let retenciones = 0;
    for (let m = 1; m <= cese.m; m += 1) {
      if (!inPeriod(empRenta, year, m)) continue;
      const row = calcRow(empRenta, deriveMonthInputs(empRenta, year, m), year, m);
      remuneraciones = round2(remuneraciones + num(row.remAsegurable));
      retenciones = round2(retenciones + num(row.renta5ta));
    }
    const gratPagadas = round2(
      gratificacionService
        .list(emp.id)
        .filter((g) => g.year === year && g.month <= cese.m)
        .reduce((s, g) => s + num(g.monto), 0)
    );
    const rentaBruta = round2(remuneraciones + gratPagadas + afecto);
    const deduccion = round2(DEDUCCION_UIT * uit);
    const rni = round2(Math.max(0, rentaBruta - deduccion));
    const impuesto = impuestoAnual(rni, uit);
    const renta5ta = round2(Math.max(0, impuesto - retenciones));

    const deducciones = round2(pension + renta5ta);
    const neto = round2(bruto - deducciones);

    return {
      employee: emp,
      year,
      fechaCese: isoOf(cese),
      motivo: opts.motivo || 'renuncia',
      regimen: rules.label,
      laborRules: rules,
      basico,
      asignacionFamiliar: asig,
      base,
      cts: {
        base: ctsBase,
        sexto,
        diasCts: ctsDias,
        monto: ctsMonto,
        periodo: periodo.nombre,
        aplica: rules.hasCts,
      },
      vacaciones: {
        daily,
        truncas: vacTruncas,
        pendientes: vacPendientes,
        diasTruncas: vac.truncated,
        diasPendientes: vac.pending,
        aniosCompletos: vac.years,
        gozadas: taken,
      },
      gratificacion: {
        monto: gratiTrunca,
        mesesGrati,
        tasaBono,
        bonoExtra,
        yaPagada,
        semestre: cese.m <= 6 ? `Enero–Junio ${year}` : `Julio–Diciembre ${year}`,
      },
      rentaDetalle: {
        uit,
        remuneraciones,
        gratificaciones: gratPagadas,
        liquidacionAfecta: afecto,
        rentaBruta,
        deduccion,
        rni,
        impuestoAnual: impuesto,
        retencionesAcumuladas: retenciones,
        renta5ta,
      },
      bruto,
      deducciones: { pension, pensionLabel, renta5ta, total: deducciones },
      neto,
    };
  },
};
