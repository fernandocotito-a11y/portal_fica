/* ============================================================================
   config.js — Configuración global y registro de módulos del portal
   ----------------------------------------------------------------------------
   Centraliza identidad corporativa, roles y el catálogo de módulos (activos y
   futuros). Añadir un módulo nuevo solo requiere registrarlo aquí: aparece
   automáticamente en el sidebar, el dashboard y el selector de permisos.
   ========================================================================== */

/* ---- Identidad de la aplicación ---- */
export const APP = {
  name: 'FICA Portal',
  company: 'A y F FICA Asociados S.A.C.',
  version: '1.1.0',
  tagline: 'Consultoría contable, tributaria, inventarios y software empresarial',
  services: ['Contabilidad', 'Tributación', 'Inventarios', 'Software empresarial'],
};

/* ---- Roles del sistema (RBAC) ---- */
export const ROLES = {
  SUPERADMIN: 'superadmin',
  SECONDARY: 'secondary',
};

export const ROLE_LABELS = {
  [ROLES.SUPERADMIN]: 'Superadministrador',
  [ROLES.SECONDARY]: 'Usuario Secundario',
};

/* ---------------------------------------------------------------------------
   Registro de módulos.
   `status`: 'active'  -> funcional en la Fase 1
             'config'  -> "Listo para configurar" (estructura conectada)
             'soon'    -> "Próximamente" (maqueta)
   `adminOnly`: visible únicamente para el Superadministrador.
   -------------------------------------------------------------------------- */
const ic = (inner) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const MODULES = [
  {
    key: 'dashboard',
    name: 'Panel Principal',
    description: 'Resumen general y accesos directos del portal.',
    icon: ic('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    status: 'active',
    adminOnly: false,
    group: 'core',
  },
  {
    key: 'users',
    name: 'Gestión de Usuarios',
    description: 'Usuarios secundarios, roles y permisos (RBAC).',
    icon: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5c2.8.3 5 2.3 5 5.5"/>'),
    status: 'active',
    adminOnly: true,
    group: 'admin',
  },
  {
    key: 'companies',
    name: 'Gestión de Empresas',
    description: 'Crea y administra las empresas del portal.',
    icon: ic('<rect x="5" y="3" width="6" height="18"/><path d="M11 7h7a1 1 0 0 1 1 1v13"/><path d="M3 21h18"/><path d="M8 7h.01M8 11h.01M8 15h.01M14 11h.01M14 15h.01"/>'),
    status: 'active',
    adminOnly: true,
    group: 'admin',
  },
  {
    key: 'planillas',
    name: 'Planillas',
    description: 'Control de planillas PLAME / T-Registro.',
    icon: ic('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9z"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4"/>'),
    status: 'active',
    adminOnly: false,
    group: 'operations',
  },
  {
    key: 'compras',
    name: 'Compras y Ventas',
    description: 'Registro SUNAT de compras y ventas con importación SIRE.',
    icon: ic('<circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 3h2l2.5 12h9.5l2-7H6"/>'),
    status: 'active',
    adminOnly: false,
    group: 'operations',
  },
  {
    key: 'sire',
    name: 'SIRE',
    description: 'Conexión en línea con SUNAT para actualizar compras y ventas.',
    icon: ic('<path d="M12 16V5"/><path d="m7 10 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
    status: 'active',
    adminOnly: false,
    group: 'operations',
  },
  {
    key: 'retenciones',
    name: 'Agentes de Retención',
    description: 'Importación de retenciones y percepciones SUNAT con reporte ordenado.',
    icon: ic('<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
    status: 'active',
    adminOnly: false,
    group: 'operations',
  },
  {
    key: 'declaraciones',
    name: 'Declaraciones SUNAT',
    description: 'Liquidación mensual de IGV y Renta (FV 621).',
    icon: ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    status: 'active',
    adminOnly: false,
    group: 'operations',
  },
  {
    key: 'reportes',
    name: 'Reportes Gerenciales',
    description: 'Consolidado multiamercial, comparativo tributario y simulación intercompany.',
    icon: ic('<path d="M4 20h16"/><rect x="6" y="10" width="3" height="10" rx="1"/><rect x="11" y="6" width="3" height="14" rx="1"/><rect x="16" y="12" width="3" height="8" rx="1"/>'),
    status: 'active',
    adminOnly: false,
    group: 'operations',
  },
];

/** Etiquetas legibles para cada estado de módulo. */
export const STATUS_LABELS = {
  active: 'Activo',
  config: 'Listo para configurar',
  soon: 'Próximamente',
};

/** Devuelve el módulo registrado por su clave. */
export function getModule(key) {
  return MODULES.find((m) => m.key === key);
}

/** Módulos que pueden asignarse como permiso a un usuario secundario. */
export function assignableModules() {
  return MODULES.filter((m) => !m.adminOnly && m.key !== 'dashboard');
}

/* ---------------------------------------------------------------------------
   Catálogos de datos tributarios de la empresa.
   -------------------------------------------------------------------------- */
export const COMPANY_OPTIONS = {
  tipoContribuyente: [
    { value: 'juridica', label: 'Persona Jurídica (RUC 20)' },
    { value: 'natural', label: 'Persona Natural con Negocio (RUC 10)' },
  ],
  tipoSociedad: [
    { value: 'SAC', label: 'S.A.C. — Sociedad Anónima Cerrada' },
    { value: 'SRL', label: 'S.R.L. — Sociedad Comercial de Responsabilidad Limitada' },
    { value: 'EIRL', label: 'E.I.R.L. — Empresa Individual de Responsabilidad Limitada' },
    { value: 'SA', label: 'S.A. — Sociedad Anónima' },
    { value: 'SAA', label: 'S.A.A. — Sociedad Anónima Abierta' },
    { value: 'SCS', label: 'S.C.S. — Sociedad en Comandita Simple' },
    { value: 'OTRO', label: 'Otra forma societaria' },
  ],
  regimenTributario: [
    { value: 'NRUS', label: 'NRUS — Nuevo Régimen Único Simplificado' },
    { value: 'RER', label: 'RER — Régimen Especial de Renta' },
    { value: 'RMT', label: 'RMT — Régimen MYPE Tributario' },
    { value: 'RG', label: 'RG — Régimen General' },
  ],
  afectacionIgv: [
    { value: 'general', label: 'General (18%)' },
    { value: 'amazonia', label: 'Amazonía / Exonerado' },
    { value: 'igv_justo', label: 'IGV Justo (prórroga 90 días)' },
  ],
};

/* ---------------------------------------------------------------------------
   Regímenes laborales (Ley MYPE - Ley 28015 / Ley 30056):
   - Microempresa (≤10 trabajadores): 15 días vac., SIN gratificaciones ni CTS.
   - Pequeña empresa (11-100 trabajadores): 15 días vac., gratif. y CTS al 50%.
   - Régimen general (>100 trabajadores): 30 días vac., gratif. y CTS al 100%.
   -------------------------------------------------------------------------- */
export const REGIMEN_LABORAL = [
  { value: 'general', label: 'Régimen general (30 días vac., gratif. 100% y CTS)' },
  { value: 'pequena_empresa', label: 'Pequeña empresa (15 días vac., gratif. 50%, sin CTS)' },
  { value: 'microempresa', label: 'Microempresa (15 días vac., sin gratificaciones ni CTS)' },
];

/** Devuelve la etiqueta legible de una opción de catálogo. */
export function optionLabel(list, value) {
  const found = list.find((o) => o.value === value);
  return found ? found.label : value || '—';
}

/**
 * Devuelve el hash de navegación de un módulo.
 * Centraliza qué claves tienen vista propia y cuáles usan el placeholder.
 */
export function moduleHash(key) {
  if (key === 'dashboard') return '#/dashboard';
  if (key === 'users') return '#/users';
  if (key === 'companies') return '#/companies';
  if (key === 'planillas') return '#/payroll';
  if (key === 'compras') return '#/compras';
  if (key === 'retenciones') return '#/retencion';
  if (key === 'sire') return '#/sire';
  if (key === 'declaraciones') return '#/declaraciones';
  if (key === 'reportes') return '#/reportes';
  return `#/module/${key}`;
}
