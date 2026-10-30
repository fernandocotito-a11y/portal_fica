/* ============================================================================
   reportesService.js — Datos consolidados de todas las empresas accesibles
   ----------------------------------------------------------------------------
   A diferencia de los módulos operativos, este servicio NO usa la empresa
   activa: consulta en Supabase todas las empresas que el usuario puede ver
   (RLS + perfil). El superadministrador recibe todas; un usuario secundario,
   solo las empresas asignadas a su perfil.

   Las consultas son de solo lectura y tolerantes a tablas que aún no existan:
   si un módulo no está migrado, el reporte se genera con el resto y muestra
   una advertencia, en lugar de quedar en blanco.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { buildCompanyReport } from './reportesEngine.js';

const PAGE_SIZE = 1000;

function isMissingTable(error) {
  const msg = String(error?.message || error || '');
  return /could not find the table|schema cache|does not exist|no existe la tabla|relation .* does not exist/i.test(msg);
}

function groupByCompany(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row.company_id) continue;
    if (!map.has(row.company_id)) map.set(row.company_id, []);
    map.get(row.company_id).push(row);
  }
  return map;
}

async function fetchAll(table, select, configure) {
  const out = [];
  let from = 0;
  for (;;) {
    let query = supabase.from(table).select(select);
    if (configure) query = configure(query);
    const { data, error } = await query
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += chunk.length;
  }
  return out;
}

async function safeFetch(label, fn, warnings) {
  try {
    return await fn();
  } catch (error) {
    if (isMissingTable(error)) {
      warnings.push(`${label}: la tabla todavía no existe en Supabase; se omitió del consolidado.`);
    } else {
      warnings.push(`${label}: ${error.message || error}`);
    }
    return [];
  }
}

/** Construye el reporte con filas ya descargadas (función probada y reutilizable). */
export function buildReport(companies, raw, year, warnings = []) {
  const taxByCompany = groupByCompany(raw.taxRows || []);
  const retentionByCompany = groupByCompany(raw.retentionRows || []);
  const employeesByCompany = groupByCompany(raw.employees || []);
  const periodsByCompany = groupByCompany(raw.periods || []);
  const balancesByCompany = groupByCompany(raw.balances || []);
  const declByCompany = groupByCompany(raw.declRows || []);

  const reports = (companies || []).map((company) => buildCompanyReport(company, {
    taxRows: taxByCompany.get(company.id) || [],
    retentionRows: retentionByCompany.get(company.id) || [],
    employees: employeesByCompany.get(company.id) || [],
    periods: periodsByCompany.get(company.id) || [],
    balances: (balancesByCompany.get(company.id) || [])[0] || null,
    declRows: declByCompany.get(company.id) || [],
  }, year));

  return {
    year: Number(year),
    generatedAt: new Date().toISOString(),
    companies: reports,
    warnings: [...new Set(warnings)],
  };
}

export const reportesService = {
  /**
   * Carga el consolidado del ejercicio para todas las empresas accesibles.
   * @param {number} year
   * @returns {Promise<{year:number, generatedAt:string, companies:Array, warnings:string[]}>}
   */
  async load(year) {
    const y = Number(year) || new Date().getFullYear();
    const companies = authService.availableCompanies().filter((c) => c.active !== false);
    const warnings = [];

    if (!companies.length) {
      return {
        year: y,
        generatedAt: new Date().toISOString(),
        companies: [],
        warnings: ['No tienes empresas activas asignadas a tu usuario.'],
      };
    }

    const ids = companies.map((c) => c.id);
    const inCompanies = (query) => query.in('company_id', ids);
    const yearTax = (query) => inCompanies(query).gte('period', `${y}01`).lte('period', `${y}12`);

    const [taxRows, retentionRows, employees, periods, balances, declRows] = await Promise.all([
      safeFetch('Compras y ventas', () => fetchAll(
        'tax_records',
        'id,company_id,kind,period,issue_date,doc_type,series,number,counterparty_name,doc_id_number,total,taxed_base,discount_base,igv,discount_igv,taxed_base_ng,igv_ng,taxed_base_dng,igv_dng,acq_value_ng,exonerated,unaffected,isc,icbper,other_taxes,currency,exchange_rate,source',
        yearTax,
      ), warnings),
      safeFetch('Retenciones y percepciones', () => fetchAll(
        'tax_retention_records',
        'id,company_id,kind,period,monto_retenido,total_comprobante,importe_pagado,monto_neto,comprobante_serie,comprobante_numero,agente_nombre,receptor_nombre',
        yearTax,
      ), warnings),
      safeFetch('Planillas · colaboradores', () => fetchAll(
        'payroll_employees',
        '*',
        inCompanies,
      ), warnings),
      safeFetch('Planillas · períodos', () => fetchAll(
        'payroll_periods',
        'id,company_id,year,month,closed,rows',
        (query) => inCompanies(query).eq('year', y),
      ), warnings),
      safeFetch('Declaraciones · saldos iniciales', () => fetchAll(
        'declaraciones_balances',
        'id,company_id,anio,saldo_igv_anterior,percepciones_ant,retenciones_ant,uit,coeficiente_renta',
        (query) => inCompanies(query).eq('anio', y),
      ), warnings),
      safeFetch('Declaraciones · control de períodos', () => fetchAll(
        'tax_declaration_periods',
        'id,company_id,anio,mes,pagos_previos,pagos_previos_renta,intereses,intereses_renta,fecha_declaracion,fecha_vencimiento,interes_manual,estado',
        (query) => inCompanies(query).eq('anio', y),
      ), warnings),
    ]);

    return buildReport(companies, {
      taxRows, retentionRows, employees, periods, balances, declRows,
    }, y, warnings);
  },
};
