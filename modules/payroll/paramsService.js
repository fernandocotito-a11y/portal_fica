/* ============================================================================
   paramsService.js — Compatibilidad con el nombre anterior
   ----------------------------------------------------------------------------
   La UIT y la RMV ya no son exclusivas de Planillas: son parámetros nacionales
   que se administran en Administración → Parámetros. El servicio real vive en
   `services/legalParamsService.js`.
   ========================================================================== */

export { legalParamsService as paramsService } from '../../services/legalParamsService.js';
