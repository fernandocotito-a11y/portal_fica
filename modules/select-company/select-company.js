/* ============================================================================
   select-company.js — Selector de empresa (Supabase)
   ----------------------------------------------------------------------------
   Pantalla posterior al login donde el usuario elige con qué empresa trabajar.
   - Superadministrador: ve todas las empresas y puede crear una nueva.
   - Usuario secundario: ve solo las empresas que le asignaron.
   ========================================================================== */

import { authService } from '../../services/authService.js';
import { companyService } from '../../services/companyService.js';
import { ICONS, escapeHtml, showToast } from '../../js/utils.js';

function newCompanyModalHtml() {
  return `
    <dialog class="modal" data-modal>
      <form data-form novalidate>
        <div class="modal__header">
          <h3 class="modal__title">Nueva empresa</h3>
          <button type="button" class="modal__close" data-close aria-label="Cerrar">${ICONS.close}</button>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label class="form-label">Razón social <span class="req">*</span></label>
            <input class="form-input" name="name" placeholder="Ej. Empresa Ejemplo S.A.C." data-name />
            <span class="field-error" data-error-name></span>
          </div>
          <div class="form-group">
            <label class="form-label">RUC <span class="req">*</span></label>
            <input class="form-input" name="ruc" inputmode="numeric" maxlength="11" placeholder="11 dígitos" data-ruc />
            <span class="field-error" data-error-ruc></span>
          </div>
        </div>
        <div class="modal__footer">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn--primary" data-submit>Crear empresa</button>
        </div>
      </form>
    </dialog>`;
}

export default {
  title: 'Seleccionar empresa',

  render(container, ctx) {
    const user = authService.currentUser();
    const isAdmin = authService.isSuperAdmin();
    const firstName = user ? user.name.trim().split(/\s+/)[0] : '';

    function render() {
      const active = authService.activeCompany();
      const companies = authService.availableCompanies();
      const activeId = active ? active.id : null;

      const cards = companies
        .map((c) => {
          const isSelected = c.id === activeId;
          return `
            <button type="button" class="module-card company-card ${isSelected ? 'is-selected' : ''}" data-company="${escapeHtml(c.id)}">
              <div class="module-card__top">
                <span class="module-card__icon">${ICONS.building}</span>
                <span class="badge badge--active"><span class="badge__dot"></span>Activa</span>
              </div>
              <div class="module-card__name">${escapeHtml(c.name)}</div>
              <div class="module-card__desc">RUC ${escapeHtml(c.ruc)}</div>
              <div class="module-card__foot">
                <span class="text-muted" style="font-size: var(--font-size-xs);">${isSelected ? 'Empresa actual' : 'Ingresar al panel'}</span>
                <span style="display:inline-flex;align-items:center;gap:6px;color:var(--color-gold);font-size:var(--font-size-xs);font-weight:600;">
                  ${isSelected ? 'Continuar' : 'Ingresar'} ${ICONS.arrowRight}
                </span>
              </div>
            </button>`;
        })
        .join('');

      const listHtml =
        companies.length === 0
          ? `<div class="card">
              <div class="empty-state">
                <span class="empty-state__icon">${ICONS.building}</span>
                <div class="empty-state__title">Sin empresas asignadas</div>
                <div class="empty-state__desc">No tienes empresas asignadas. Contacta al administrador para que te dé acceso.</div>
              </div>
            </div>`
          : `<div class="module-grid">${cards}</div>`;

      container.innerHTML = `
        <div class="select-company">
          <header class="select-company__header">
            <img src="./assets/logo-ayf.png" alt="A y F FICA Asociados" class="select-company__logo" />
            <button type="button" class="btn btn--ghost" data-logout>${ICONS.logout} Cerrar sesión</button>
          </header>
          <main class="select-company__body">
            <h1 class="select-company__title">Hola, ${escapeHtml(firstName || 'Usuario')}</h1>
            <p class="select-company__subtitle">Selecciona la empresa con la que deseas trabajar.</p>
            ${isAdmin ? `<div class="select-company__actions"><button type="button" class="btn btn--primary" data-new>${ICONS.plus} Nueva empresa</button></div>` : ''}
            ${listHtml}
          </main>
        </div>
        ${isAdmin ? newCompanyModalHtml() : ''}
      `;

      container.querySelectorAll('[data-company]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (authService.setActiveCompany(btn.dataset.company)) {
            ctx.navigate('/dashboard');
          } else {
            showToast('No puedes acceder a esa empresa.', 'error');
          }
        });
      });

      container.querySelector('[data-logout]').addEventListener('click', () => {
        authService.logout().then(() => {
          window.location.hash = '#/login';
        });
      });

      if (isAdmin) {
        container.querySelector('[data-new]').addEventListener('click', () => {
          container.querySelector('[data-modal]').showModal();
          container.querySelector('[data-name]').focus();
        });
        wireNewCompanyModal(container, render);
      }
    }

    function wireNewCompanyModal(scope, rerender) {
      const modal = scope.querySelector('[data-modal]');
      const form = scope.querySelector('[data-form]');
      const nameInput = scope.querySelector('[data-name]');
      const rucInput = scope.querySelector('[data-ruc]');
      const nameError = scope.querySelector('[data-error-name]');
      const rucError = scope.querySelector('[data-error-ruc]');
      const submitBtn = scope.querySelector('[data-submit]');

      const close = () => modal.close();
      modal.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
      });
      scope.querySelector('[data-close]').addEventListener('click', close);
      scope.querySelector('[data-cancel]').addEventListener('click', close);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        nameInput.classList.remove('is-invalid');
        rucInput.classList.remove('is-invalid');
        nameError.textContent = '';
        rucError.textContent = '';

        const name = nameInput.value.trim();
        const ruc = rucInput.value.trim();
        let valid = true;

        if (!name) {
          nameInput.classList.add('is-invalid');
          nameError.textContent = 'La razón social es obligatoria.';
          valid = false;
        }
        if (!ruc) {
          rucInput.classList.add('is-invalid');
          rucError.textContent = 'El RUC es obligatorio.';
          valid = false;
        } else if (!/^\d{11}$/.test(ruc)) {
          rucInput.classList.add('is-invalid');
          rucError.textContent = 'El RUC debe tener 11 dígitos.';
          valid = false;
        }
        if (!valid) return;

        submitBtn.disabled = true;
        try {
          await companyService.create({ name, ruc });
          showToast('Empresa creada correctamente.');
          form.reset();
          close();
          rerender();
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          submitBtn.disabled = false;
        }
      });
    }

    render();
  },
};
