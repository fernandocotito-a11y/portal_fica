/* ============================================================================
   app.js — Punto de entrada de la aplicación
   ----------------------------------------------------------------------------
   Inicializa la sesión (Supabase Auth) y arranca el enrutador. Es el único
   script que se carga como <script type="module">.

   Maneja además los enlaces de correo (invitación / recuperación de contraseña):
   Supabase añade los tokens a la URL y aquí decidimos llevar al usuario a la
   pantalla de crear contraseña (#/set-password).
   ========================================================================== */

import { authService } from '../services/authService.js';
import { initRouter } from './router.js';

// Capturamos la URL ANTES de que Supabase procese/limpie los tokens del enlace.
const INCOMING_URL = window.location.href;
const IS_AUTH_LINK = /access_token=|refresh_token=|error=|type=(recovery|invite|signup)/.test(INCOMING_URL);

/** Arranque de la aplicación. */
async function bootstrap() {
  // 1) Restaura la sesión de Supabase y precarga perfil + empresas.
  await authService.init();

  // 2) Si venimos de un enlace de correo, vamos a establecer contraseña.
  if (IS_AUTH_LINK && window.location.hash !== '#/set-password') {
    window.location.hash = '#/set-password';
  }

  // 3) Arranca el enrutador (carga la vista según el hash actual).
  initRouter();
}

// Evita errores de ejecución prematura: espera a que el DOM esté listo.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
