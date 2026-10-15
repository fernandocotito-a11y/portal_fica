/* ============================================================================
   login.js — Módulo de autenticación (Supabase)
   ----------------------------------------------------------------------------
   Inicio de sesión por email/contraseña y envío de enlace para restablecer la
   contraseña ("¿Olvidaste tu contraseña?"). Alerta roja solo en caso de error
   y alerta verde cuando el enlace se envía correctamente.
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
            <div class="alert alert--success" data-success hidden>
              ${ICONS.success}<span data-success-msg></span>
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
    const success = container.querySelector('[data-success]');
    const successMsg = container.querySelector('[data-success-msg]');
    const submitBtn = container.querySelector('[data-submit]');
    const togglePassword = container.querySelector('[data-toggle-password]');
    const forgotBtn = container.querySelector('[data-forgot]');

    const hideAlerts = () => {
      alert.hidden = true;
      success.hidden = true;
    };
    const showError = (msg) => {
      alertMsg.textContent = msg;
      alert.hidden = false;
      success.hidden = true;
    };
    const showSuccess = (msg) => {
      successMsg.textContent = msg;
      success.hidden = false;
      alert.hidden = true;
    };

    togglePassword.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      togglePassword.innerHTML = isHidden ? ICONS.eyeOff : ICONS.eye;
      togglePassword.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });

    emailInput.addEventListener('input', () => {
      emailInput.classList.remove('is-invalid');
      emailError.textContent = '';
      hideAlerts();
    });
    passwordInput.addEventListener('input', () => {
      passwordInput.classList.remove('is-invalid');
      passwordError.textContent = '';
      hideAlerts();
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
      hideAlerts();

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
        showError(err.message);
        submitBtn.disabled = false;
      }
    });

    forgotBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      hideAlerts();
      if (!isValidEmail(email)) {
        emailInput.classList.add('is-invalid');
        emailError.textContent = 'Escribe tu correo para enviarte el enlace.';
        emailInput.focus();
        return;
      }
      forgotBtn.disabled = true;
      try {
        // ¿El correo está registrado? Si no, avisamos de inmediato.
        const registered = await authService.isEmailRegistered(email);
        if (registered === false) {
          showError('Este correo no está registrado en el portal. Pide al administrador que te invite.');
          return;
        }
        await authService.requestPasswordReset(email);
        showSuccess('Listo. Te enviamos un enlace a tu correo para restablecer tu contraseña.');
      } catch (err) {
        showError(err.message);
      } finally {
        forgotBtn.disabled = false;
      }
    });
  },
};
