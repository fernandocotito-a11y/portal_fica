/* ============================================================================
   payrollScope.js — Segmentación de datos por empresa
   ----------------------------------------------------------------------------
   Todas las claves de LocalStorage del módulo de Planillas se prefijan con el
   ID de la EMPRESA ACTIVA, de modo que cada empresa tenga su propia planilla
   (colaboradores, períodos, asistencias, etc.).

   Así, al cambiar de empresa, los datos cambian automáticamente.
   ========================================================================== */

import { authService } from '../../services/authService.js';

/** Devuelve el ID de la empresa activa (o un marcador si no hay ninguna). */
export function currentCompanyId() {
  const c = authService.activeCompany ? authService.activeCompany() : null;
  return c && c.id ? c.id : 'sin-empresa';
}

/** Construye una clave de LocalStorage aislada por empresa. */
export function scopedKey(base) {
  return `fica.payroll.${currentCompanyId()}.${base}`;
}
