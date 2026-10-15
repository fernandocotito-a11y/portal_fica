/* ============================================================================
   utils.js — Utilidades transversales del portal
   ----------------------------------------------------------------------------
   Helpers de DOM, seguridad (escape de HTML), validación, formato de fechas,
   identificadores, hashing de contraseñas (mock) y notificaciones toast.
   ========================================================================== */

/** Selecciona el primer elemento que coincida con `selector` (opcionalmente dentro de `root`). */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** Selecciona todos los elementos que coincidan con `selector`. */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/** Genera un identificador único (suficiente para un entorno mock/local). */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Hashing de contraseña NO criptográfico, únicamente para el mock local.
 * En producción debe sustituirse por autenticación real en el backend
 * (bcrypt/argon2 + tokens JWT). Evita guardar contraseñas en texto plano.
 */
export function hashPassword(input) {
  const salt = 'fica::v1::';
  const str = salt + String(input);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Escapa caracteres especiales para evitar inyección de HTML (XSS). */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/** Devuelve las iniciales (hasta 2) de un nombre completo. */
export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Formatea una fecha ISO a formato legible en español (dd/mm/aaaa). */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Valida un correo electrónico con una expresión regular estándar. */
export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim());
}

/** Valida la política mínima de contraseña: 8+ caracteres, mayúscula y número. */
export function isStrongPassword(value) {
  return /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(String(value));
}

/** Valida el campo de contraseña del login (no bloquea política, solo no vacío). */
export function isNonEmpty(value) {
  return String(value).trim().length > 0;
}

/* ---------------------------------------------------------------------------
   Notificaciones toast
   -------------------------------------------------------------------------- */
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/** Muestra una notificación flotante. `type`: success | error | info. */
export function showToast(message, type = 'success') {
  const container = getToastContainer();
  const icon = ICONS[type === 'error' ? 'error' : type === 'info' ? 'info' : 'success'];

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg">${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  setTimeout(remove, 3200);
}

/* ---------------------------------------------------------------------------
   Diálogo de confirmación (basado en <dialog> nativo)
   -------------------------------------------------------------------------- */
export function confirmDialog({ title = 'Confirmar', message = '¿Estás seguro?', confirmText = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.innerHTML = `
      <div class="modal__header">
        <h3 class="modal__title">${escapeHtml(title)}</h3>
        <button type="button" class="modal__close" data-close aria-label="Cerrar">${ICONS.close}</button>
      </div>
      <div class="modal__body">
        <p style="color: var(--color-text-secondary); line-height: 1.6;">${escapeHtml(message)}</p>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn" data-cancel>Cancelar</button>
        <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-ok>${escapeHtml(confirmText)}</button>
      </div>
    `;

    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    dialog.querySelector('[data-ok]').addEventListener('click', () => finish(true));
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-close]').addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(false);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/* ---------------------------------------------------------------------------
   Iconos SVG (trazo, 24x24)
   -------------------------------------------------------------------------- */
const svg = (inner) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  menu: svg('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
  chevronRight: svg('<path d="m9 6 6 6-6 6"/>'),
  logout: svg('<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5c2.8.3 5 2.3 5 5.5"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  lock: svg('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  eye: svg('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3 3.7M6.6 6.6C3.8 8.4 2 12 2 12s3.5 6.5 10 6.5c1.4 0 2.7-.3 3.9-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  check: svg('<path d="m5 12 5 5L20 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  shield: svg('<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/>'),
  success: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  error: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  building: svg('<rect x="5" y="3" width="6" height="18"/><path d="M11 7h7a1 1 0 0 1 1 1v13"/><path d="M3 21h18"/><path d="M8 7h.01M8 11h.01M8 15h.01M14 11h.01M14 15h.01"/>'),
  briefcase: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>'),
};
