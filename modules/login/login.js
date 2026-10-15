/* ============================================================================
   login.js — Módulo de autenticación
   ----------------------------------------------------------------------------
   Pantalla de acceso con validación de campos, opción de "recordar sesión" y
   estética formal acorde a la identidad corporativa. Al autenticarse redirige
   al panel principal.
   ========================================================================== */

import { authService } from '../../services/authService.js';
import { ICONS, isValidEmail, isNonEmpty, showToast } from '../../js/utils.js';

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
                  <input
                    class="form-input form-input--icon"
                    id="login-email"
                    name="email"
                    type="email"
                    autocomplete="username"
                    placeholder="correo@ayffica.com"
                    data-email
                  />
                </div>
                <span class="field-error" data-error-email></span>
              </div>

              <div class="form-group">
                <label class="form-label" for="login-password">Contraseña</label>
                <div class="input-wrap">
                  <span class="input-wrap__icon">${ICONS.lock}</span>
                  <input
                    class="form-input form-input--icon"
                    id="login-password"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    placeholder="••••••••"
                    data-password
                  />
                  <button type="button" class="input-wrap__icon input-wrap__icon--right" data-toggle-password
                    aria-label="Mostrar u ocultar contraseña">${ICONS.eye}</button>
                </div>
                <span class="field-error" data-error-password></span>
              </div>

              <div class="form-group">
                <label class="checkbox">
                  <input type="checkbox" name="remember" checked />
                  <span class="checkbox__box">${ICONS.check}</span>
                  <span>Recordar sesión en este equipo</span>
                </label>
              </div>

              <button type="submit" class="btn btn--primary btn--block" data-submit>
                ${ICONS.arrowRight} Iniciar sesión
              </button>
            </form>

            <div class="login__hint">
              <strong>Credenciales de prueba</strong><br />
              Correo: <code>admin@ayffica.com</code><br />
              Contraseña: <code>Admin123*</code>
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

    /* ---- Mostrar / ocultar contraseña ---- */
    togglePassword.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      togglePassword.innerHTML = isHidden ? ICONS.eyeOff : ICONS.eye;
      togglePassword.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });

    /* ---- Limpieza de errores al escribir ---- */
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

    /* ---- Envío del formulario ---- */
    form.addEventListener('submit', (e) => {
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

      const remember = form.elements.remember.checked;
      submitBtn.disabled = true;

      try {
        authService.login(email, password, remember);
        ctx.navigate('/select-company');
      } catch (err) {
        alertMsg.textContent = err.message;
        alert.hidden = false;
        submitBtn.disabled = false;
      }
    });
  },
};
