/* ============================================================================
   payrollScope.js — Empresa activa del módulo de Planillas
   ----------------------------------------------------------------------------
   Aísla los datos de planillas por EMPRESA. Con Supabase, cada fila lleva su
   `company_id`, por lo que todo el módulo se filtra por la empresa activa.
   ========================================================================== */

import { authService } from '../../services/authService.js';

/** Devuelve el ID de la empresa activa (o null si no hay ninguna). */
export function activeCompanyId() {
  const c = authService.activeCompany ? authService.activeCompany() : null;
  return c && c.id ? c.id : null;
}
