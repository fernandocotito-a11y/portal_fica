/* ============================================================================
   app.js — Punto de entrada de la aplicación
   ----------------------------------------------------------------------------
   Inicializa la sesión (Supabase Auth) y arranca el enrutador. Es el único
   script que se carga como <script type="module">.
   ========================================================================== */

import { authService } from '../services/authService.js';
import { initRouter } from './router.js';

/** Arranque de la aplicación. */
async function bootstrap() {
  // 1) Restaura la sesión de Supabase y precarga perfil + empresas.
  await authService.init();

  // 2) Arranca el enrutador (carga la vista según el hash actual).
  initRouter();
}

// Evita errores de ejecución prematura: espera a que el DOM esté listo.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
