/* ============================================================================
   set-password.js — Establecer contraseña (invitación / reset)
   ----------------------------------------------------------------------------
   Pantalla a la que llegan los usuarios tras hacer clic en el enlace del correo
   (invitación o restablecimiento). Comprueba la sesión y muestra un formulario
   para crear una nueva contraseña (con opción de ver/ocultar), y luego redirige
   al selector de empresa.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, isStrongPassword, showToast } from '../../js/utils.js';

function invalidHtml() {
  return `
    <div class="select-company">
      <header class="select-company__header">
        <img src="./assets/logo-ayf.png" alt="A y F FICA Asociados" class="select-company__logo" />
      </header>
      <main class="select-company__body" style="max-width:440px;">
        <div class="card"><div class="card__body">
          <span class="empty-state__icon" style="display:grid;place-items:center;width:64px;height:64px;color:var(--color-gold);background:var(--color-gold-soft);border-radius:999px;margin-bottom:var(--space-3);">${ICONS.error}</span>
          <h1 class="select-company__title">Enlace no válido</h1>
          <p class="select-company__subtitle">Este enlace no es válido o ya expiró. Solicita uno nuevo desde el inicio de sesión.</p>
          <button type="button" class="btn btn--primary" data-login>${ICONS.arrowRight} Ir al inicio de sesión</button>
        </div></div>
      </main>
    </div>`;
}

function formHtml(email) {
  return `
    <div class="select-company">
      <header class="select-company__header">
        <img src="./assets/logo-ayf.png" alt="A y F FICA Asociados" class="select-company__logo" />
      </header>
      <main class="select-company__body" style="max-width:440px;">
        <div class="card"><div class="card__body">
          <h1 class="select-company__title">Crea tu contraseña</h1>
          <p class="select-company__subtitle">Accederás como <strong>${escapeHtml(email)}</strong>. Define una contraseña segura.</p>
          <form data-form novalidate>
            <div class="form-group">
              <label class="form-label">Nueva contraseña</label>
              <div class="input-wrap">
                <span class="input-wrap__icon">${ICONS.lock}</span>
                <input class="form-input form-input--icon" type="password" autocomplete="new-password"
                  placeholder="Mín. 8 caracteres, mayúscula y número" data-password />
                <button type="button" class="input-wrap__icon input-wrap__icon--right" data-toggle="password"
                  aria-label="Mostrar u ocultar contraseña">${ICONS.eye}</button>
              </div>
              <span class="field-error" data-error-password></span>
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar contraseña</label>
              <div class="input-wrap">
                <span class="input-wrap__icon">${ICONS.lock}</span>
                <input class="form-input form-input--icon" type="password" autocomplete="new-password"
                  placeholder="Repite la contraseña" data-confirm />
                <button type="button" class="input-wrap__icon input-wrap__icon--right" data-toggle="confirm"
                  aria-label="Mostrar u ocultar contraseña">${ICONS.eye}</button>
              </div>
              <span class="field-error" data-error-confirm></span>
            </div>
            <button type="submit" class="btn btn--primary btn--block" data-submit>
              ${ICONS.check} Guardar contraseña
            </button>
          </form>
        </div></div>
      </main>
    </div>`;
}

/** Conecta un botón "ojo" con su input de contraseña. */
function wireToggle(scope, toggleName, input) {
  const btn = scope.querySelector(`[data-toggle="${toggleName}"]`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.innerHTML = isHidden ? ICONS.eyeOff : ICONS.eye;
    btn.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
}

export default {
  title: 'Establecer contraseña',

  render(container, ctx) {
    container.innerHTML = `
      <div class="select-company">
        <header class="select-company__header">
          <img src="./assets/logo-ayf.png" alt="A y F FICA Asociados" class="select-company__logo" />
        </header>
        <main class="select-company__body" style="max-width:440px;">
          <p class="text-muted">Verificando enlace…</p>
        </main>
      </div>`;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        container.innerHTML = invalidHtml();
        container.querySelector('[data-login]').addEventListener('click', () => {
          window.location.hash = '#/login';
        });
        return;
      }

      container.innerHTML = formHtml(session.user.email);
      const form = container.querySelector('[data-form]');
      const passwordInput = container.querySelector('[data-password]');
      const confirmInput = container.querySelector('[data-confirm]');
      const passwordError = container.querySelector('[data-error-password]');
      const confirmError = container.querySelector('[data-error-confirm]');
      const submitBtn = container.querySelector('[data-submit]');

      wireToggle(container, 'password', passwordInput);
      wireToggle(container, 'confirm', confirmInput);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        passwordInput.classList.remove('is-invalid');
        confirmInput.classList.remove('is-invalid');
        passwordError.textContent = '';
        confirmError.textContent = '';

        const password = passwordInput.value;
        const confirm = confirmInput.value;
        let valid = true;

        if (!isStrongPassword(password)) {
          passwordInput.classList.add('is-invalid');
          passwordError.textContent = 'Debe tener al menos 8 caracteres, una mayúscula y un número.';
          valid = false;
        }
        if (password !== confirm) {
          confirmInput.classList.add('is-invalid');
          confirmError.textContent = 'Las contraseñas no coinciden.';
          valid = false;
        }
        if (!valid) return;

        submitBtn.disabled = true;
        try {
          await authService.updatePassword(password);
          showToast('Contraseña establecida correctamente.');
          ctx.navigate('/select-company');
        } catch (err) {
          showToast(err.message, 'error');
          submitBtn.disabled = false;
        }
      });
    })();
  },
};
