/* ============================================================================
   login.js — Módulo de autenticación (Supabase)
   ----------------------------------------------------------------------------
   Inicio de sesión por email/contraseña y envío de enlace para restablecer la
   contraseña ("¿Olvidaste tu contraseña?"). La sesión la gestiona Supabase y
   se mantiene iniciada en el dispositivo.
   ========================================================================== */

import { authService } from '../../services/authService.js';
import { ICONS, isValidEmail, isNonEmpty } from '../../js/utils.js';

export default {
  title: 'Iniciar sesión',

  render(container, ctx) {
    container.innerHTML = `
      <div class="login">
        <div class="login__brand">
          <img class="login__brand-logo" src="./assets/logo-ayf.png" alt="A y F FICA Asociados" />
          <h1>A y F FICA <span>Asociados</span></h1>
          <p>Consultoría contable, tributaria, inventarios y software empresarial.</p>
          <div class="login__brand-tags">
            <span class="login__brand-tag">Contabilidad</span>
            <span class="login__brand-tag">Tributación</span>
            <span class="login__brand-tag">Inventarios</span>
            <span class="login__brand-tag">Software empresarial</span>
          </div>
        </div>

        <div class="login__panel">
          <div class="login__card">
            <div class="login__card-header">
              <h2>Iniciar sesión</h2>
              <p>Ingresa tus credenciales para acceder al portal.</p>
            </div>

            <div class="alert alert--error" data-alert hidden>
              ${ICONS.error}<span data-alert-msg></span>
            </div>

            <form data-form novalidate>
              <div class="form-group">
                <label class="form-label" for="login-email">Correo electrónico</label>
                <div class="input-wrap">
                  <span class="input-wrap__icon">${ICONS.mail}</span>
                  <input class="form-input form-input--icon" id="login-email" name="email" type="email"
                    autocomplete="username" placeholder="correo@ayffica.com" data-email />
                </div>
                <span class="field-error" data-error-email></span>
              </div>

              <div class="form-group">
                <label class="form-label" for="login-password">Contraseña</label>
                <div class="input-wrap">
                  <span class="input-wrap__icon">${ICONS.lock}</span>
                  <input class="form-input form-input--icon" id="login-password" name="password" type="password"
                    autocomplete="current-password" placeholder="••••••••" data-password />
                  <button type="button" class="input-wrap__icon input-wrap__icon--right" data-toggle-password
                    aria-label="Mostrar u ocultar contraseña">${ICONS.eye}</button>
                </div>
                <span class="field-error" data-error-password></span>
              </div>

              <button type="submit" class="btn btn--primary btn--block" data-submit>
                ${ICONS.arrowRight} Iniciar sesión
              </button>

              <div class="text-center mt-4">
                <button type="button" class="btn btn--ghost btn--sm" data-forgot>
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            </form>

            <div class="login__hint">
              <strong>¿Primera vez?</strong><br />
              Si aún no tienes contraseña, usa <em>“¿Olvidaste tu contraseña?”</em> y
              recibirás un enlace en tu correo para crearla.
            </div>
          </div>
        </div>
      </div>
    `;

    const form = container.querySelector('[data-form]');
    const emailInput = container.querySelector('[data-email]');
    const passwordInput = container.querySelector('[data-password]');
    const emailError = container.querySelector('[data-error-email]');
    const passwordError = container.querySelector('[data-error-password]');
    const alert = container.querySelector('[data-alert]');
    const alertMsg = container.querySelector('[data-alert-msg]');
    const submitBtn = container.querySelector('[data-submit]');
    const togglePassword = container.querySelector('[data-toggle-password]');
    const forgotBtn = container.querySelector('[data-forgot]');

    togglePassword.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      togglePassword.innerHTML = isHidden ? ICONS.eyeOff : ICONS.eye;
      togglePassword.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });

    emailInput.addEventListener('input', () => {
      emailInput.classList.remove('is-invalid');
      emailError.textContent = '';
      alert.hidden = true;
    });
    passwordInput.addEventListener('input', () => {
      passwordInput.classList.remove('is-invalid');
      passwordError.textContent = '';
      alert.hidden = true;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      let valid = true;
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      emailInput.classList.remove('is-invalid');
      passwordInput.classList.remove('is-invalid');
      emailError.textContent = '';
      passwordError.textContent = '';
      alert.hidden = true;

      if (!isNonEmpty(email)) {
        emailInput.classList.add('is-invalid');
        emailError.textContent = 'El correo electrónico es obligatorio.';
        valid = false;
      } else if (!isValidEmail(email)) {
        emailInput.classList.add('is-invalid');
        emailError.textContent = 'Ingresa un correo electrónico válido.';
        valid = false;
      }
      if (!isNonEmpty(password)) {
        passwordInput.classList.add('is-invalid');
        passwordError.textContent = 'La contraseña es obligatoria.';
        valid = false;
      }
      if (!valid) return;

      submitBtn.disabled = true;
      try {
        await authService.login(email, password);
        ctx.navigate('/select-company');
      } catch (err) {
        alertMsg.textContent = err.message;
        alert.hidden = false;
        submitBtn.disabled = false;
      }
    });

    forgotBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!isValidEmail(email)) {
        emailInput.classList.add('is-invalid');
        emailError.textContent = 'Escribe tu correo para enviarte el enlace.';
        emailInput.focus();
        return;
      }
      forgotBtn.disabled = true;
      try {
        await authService.requestPasswordReset(email);
        alertMsg.textContent = 'Te enviamos un enlace a tu correo para restablecer la contraseña.';
        alert.hidden = false;
      } catch (err) {
        alertMsg.textContent = err.message;
        alert.hidden = false;
      } finally {
        forgotBtn.disabled = false;
      }
    });
  },
};
