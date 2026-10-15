/* ============================================================================
   users.js — Módulo de Gestión de Usuarios (CRUD + RBAC)
   ----------------------------------------------------------------------------
   Permite al Superadministrador listar, crear, editar, activar/desactivar y
   eliminar usuarios secundarios, así como asignarles los módulos a los que
   tendrán acceso. Exclusivo del Superadministrador (protegido por el router).
   ========================================================================== */

import { userService } from '../../services/userService.js';
import { ROLE_LABELS, ROLES, getModule, assignableModules } from '../../js/config.js';
import {
  ICONS,
  initials,
  escapeHtml,
  isValidEmail,
  isStrongPassword,
  showToast,
  confirmDialog,
} from '../../js/utils.js';

/** Genera el HTML de los checkboxes de permisos (módulos asignables). */
function permissionCheckboxesHtml() {
  return assignableModules()
    .map(
      (m) => `
        <label class="permission-item" title="${escapeHtml(m.description)}">
          <input type="checkbox" value="${escapeHtml(m.key)}" data-perm />
          <span class="permission-item__box">${ICONS.check}</span>
          <span class="permission-item__label">${escapeHtml(m.name)}</span>
        </label>`
    )
    .join('');
}

export default {
  title: 'Gestión de Usuarios',

  render(container) {
    let editingId = null;
    let searchTerm = '';

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Gestión de Usuarios</h2>
          <p class="page-heading__subtitle">Administra usuarios secundarios, roles y permisos de acceso.</p>
        </div>
        <button type="button" class="btn btn--primary" data-add>
          ${ICONS.plus} Nuevo usuario
        </button>
      </div>

      <div class="card">
        <div class="table-toolbar" style="padding: var(--space-4) var(--space-5) 0;">
          <div class="table-toolbar__search">
            <span class="input-wrap__icon">${ICONS.search}</span>
            <input class="form-input" type="search" placeholder="Buscar por nombre o correo..." data-search />
          </div>
          <span class="text-muted" style="font-size: var(--font-size-sm);" data-count></span>
        </div>
        <div class="card__body" style="padding-top: var(--space-4);">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Módulos asignados</th>
                  <th>Estado</th>
                  <th style="text-align:right;">Acciones</th>
                </tr>
              </thead>
              <tbody data-tbody></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Modal de crear / editar usuario -->
      <dialog class="modal" data-modal>
        <form data-form novalidate>
          <div class="modal__header">
            <h3 class="modal__title" data-modal-title>Nuevo usuario</h3>
            <button type="button" class="modal__close" data-close aria-label="Cerrar">${ICONS.close}</button>
          </div>
          <div class="modal__body">
            <div class="form-group">
              <label class="form-label">Nombre completo <span class="req">*</span></label>
              <input class="form-input" name="name" placeholder="Ej. Juan Pérez" data-name />
              <span class="field-error" data-error-name></span>
            </div>

            <div class="form-group" data-email-group>
              <label class="form-label">Correo electrónico <span class="req">*</span></label>
              <div class="input-wrap">
                <span class="input-wrap__icon">${ICONS.mail}</span>
                <input class="form-input form-input--icon" type="email" name="email"
                  placeholder="correo@ayffica.com" autocomplete="off" data-email />
              </div>
              <span class="field-error" data-error-email></span>
            </div>

            <div class="form-group" data-password-group>
              <label class="form-label">Contraseña <span class="req">*</span></label>
              <div class="input-wrap">
                <span class="input-wrap__icon">${ICONS.lock}</span>
                <input class="form-input form-input--icon" type="password" name="password"
                  placeholder="Mín. 8 caracteres, mayúscula y número" autocomplete="new-password" data-password />
              </div>
              <span class="field-error" data-error-password></span>
            </div>

            <div class="form-group">
              <label class="form-label">Módulos asignados</label>
              <p class="form-hint" style="margin-bottom: var(--space-3);">
                El usuario secundario solo podrá acceder a los módulos seleccionados.
              </p>
              <div class="permission-grid" data-permissions>${permissionCheckboxesHtml()}</div>
            </div>

            <div class="form-group" data-active-group hidden>
              <label class="checkbox">
                <input type="checkbox" data-active />
                <span class="checkbox__box">${ICONS.check}</span>
                <span>Cuenta activa</span>
              </label>
            </div>
          </div>
          <div class="modal__footer">
            <button type="button" class="btn" data-cancel>Cancelar</button>
            <button type="submit" class="btn btn--primary" data-submit>Crear usuario</button>
          </div>
        </form>
      </dialog>
    `;

    const modal = container.querySelector('[data-modal]');
    const form = container.querySelector('[data-form]');
    const tbody = container.querySelector('[data-tbody]');
    const searchInput = container.querySelector('[data-search]');
    const countEl = container.querySelector('[data-count]');
    const modalTitle = container.querySelector('[data-modal-title]');
    const submitBtn = container.querySelector('[data-submit]');
    const nameInput = container.querySelector('[data-name]');
    const emailInput = container.querySelector('[data-email]');
    const passwordInput = container.querySelector('[data-password]');
    const passwordGroup = container.querySelector('[data-password-group]');
    const activeGroup = container.querySelector('[data-active-group]');
    const activeInput = container.querySelector('[data-active]');
    const nameError = container.querySelector('[data-error-name]');
    const emailError = container.querySelector('[data-error-email]');
    const passwordError = container.querySelector('[data-error-password]');
    const permInputs = container.querySelectorAll('[data-perm]');

    /* --------------------------- Helpers ------------------------------- */
    function filteredUsers() {
      const term = searchTerm.trim().toLowerCase();
      return userService.list().filter((u) => {
        if (!term) return true;
        return (
          u.name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term)
        );
      });
    }

    function permissionsSummary(user) {
      if (user.role === ROLES.SUPERADMIN) {
        return '<span class="chip chip--gold">Acceso total</span>';
      }
      if (!user.permissions || user.permissions.length === 0) {
        return '<span class="text-muted" style="font-size: var(--font-size-xs);">Sin módulos asignados</span>';
      }
      return user.permissions
        .map((key) => {
          const mod = getModule(key);
          return mod ? `<span class="chip">${escapeHtml(mod.name)}</span>` : '';
        })
        .join('');
    }

    function renderTable() {
      const users = filteredUsers();
      countEl.textContent = `Mostrando ${users.length} de ${userService.list().length} usuarios`;

      if (users.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5">
              <div class="empty-state">
                <span class="empty-state__icon">${ICONS.users}</span>
                <div class="empty-state__title">Sin resultados</div>
                <div class="empty-state__desc">No se encontraron usuarios que coincidan con la búsqueda.</div>
              </div>
            </td>
          </tr>`;
        return;
      }

      tbody.innerHTML = users
        .map((user) => {
          const isAdmin = user.role === ROLES.SUPERADMIN;
          const roleBadge = isAdmin ? 'badge--gold' : 'badge--muted';
          const state = isAdmin
            ? '<span class="badge badge--active"><span class="badge__dot"></span>Activo</span>'
            : `
              <label class="switch" title="${user.active ? 'Desactivar' : 'Activar'}">
                <input type="checkbox" data-toggle="${escapeHtml(user.id)}" ${user.active ? 'checked' : ''} />
                <span class="switch__track"></span>
                <span class="switch__thumb"></span>
              </label>`;
          const actions = isAdmin
            ? '<span class="text-muted" style="font-size: var(--font-size-xs);">Protegido</span>'
            : `
              <button type="button" class="icon-btn" data-edit="${escapeHtml(user.id)}" title="Editar">${ICONS.edit}</button>
              <button type="button" class="icon-btn icon-btn--danger" data-delete="${escapeHtml(user.id)}" title="Eliminar">${ICONS.trash}</button>`;

          return `
            <tr>
              <td>
                <div class="table__cell-user">
                  <span class="table__avatar">${escapeHtml(initials(user.name))}</span>
                  <div>
                    <div class="table__name">${escapeHtml(user.name)}</div>
                    <div class="table__email">${escapeHtml(user.email)}</div>
                  </div>
                </div>
              </td>
              <td><span class="badge ${roleBadge}"><span class="badge__dot"></span>${escapeHtml(ROLE_LABELS[user.role])}</span></td>
              <td>${permissionsSummary(user)}</td>
              <td>${state}</td>
              <td>
                <div class="table__actions" style="justify-content:flex-end;">${actions}</div>
              </td>
            </tr>`;
        })
        .join('');
    }

    /* ----------------------- Apertura del modal ------------------------ */
    function clearErrors() {
      [nameInput, emailInput, passwordInput].forEach((inp) => inp.classList.remove('is-invalid'));
      nameError.textContent = '';
      emailError.textContent = '';
      passwordError.textContent = '';
    }

    function openCreate() {
      editingId = null;
      modalTitle.textContent = 'Nuevo usuario';
      submitBtn.textContent = 'Crear usuario';
      emailInput.disabled = false;
      form.reset();
      clearErrors();
      passwordGroup.hidden = false;
      activeGroup.hidden = true;
      activeInput.checked = true;
      permInputs.forEach((inp) => (inp.checked = false));
      modal.showModal();
      nameInput.focus();
    }

    function openEdit(id) {
      const user = userService.getById(id);
      if (!user || user.role === ROLES.SUPERADMIN) return;
      editingId = id;
      modalTitle.textContent = 'Editar usuario';
      submitBtn.textContent = 'Guardar cambios';
      clearErrors();
      nameInput.value = user.name;
      emailInput.value = user.email;
      emailInput.disabled = true;
      passwordGroup.hidden = true;
      activeGroup.hidden = false;
      activeInput.checked = user.active;
      permInputs.forEach((inp) => {
        inp.checked = user.permissions.includes(inp.value);
      });
      modal.showModal();
      nameInput.focus();
    }

    function closeModal() {
      modal.close();
    }

    /* --------------------------- Validación ---------------------------- */
    function getSelectedPermissions() {
      return Array.from(permInputs)
        .filter((inp) => inp.checked)
        .map((inp) => inp.value);
    }

    function validate() {
      let valid = true;
      clearErrors();

      if (!nameInput.value.trim()) {
        nameInput.classList.add('is-invalid');
        nameError.textContent = 'El nombre es obligatorio.';
        valid = false;
      }

      // El correo y la contraseña solo se validan al crear (no al editar).
      if (!editingId) {
        const email = emailInput.value.trim();
        if (!email) {
          emailInput.classList.add('is-invalid');
          emailError.textContent = 'El correo electrónico es obligatorio.';
          valid = false;
        } else if (!isValidEmail(email)) {
          emailInput.classList.add('is-invalid');
          emailError.textContent = 'Ingresa un correo electrónico válido.';
          valid = false;
        } else if (userService.findByEmail(email)) {
          emailInput.classList.add('is-invalid');
          emailError.textContent = 'Ya existe un usuario con ese correo.';
          valid = false;
        }

        if (!passwordInput.value) {
          passwordInput.classList.add('is-invalid');
          passwordError.textContent = 'La contraseña es obligatoria.';
          valid = false;
        } else if (!isStrongPassword(passwordInput.value)) {
          passwordInput.classList.add('is-invalid');
          passwordError.textContent = 'Debe tener al menos 8 caracteres, una mayúscula y un número.';
          valid = false;
        }
      }

      return valid;
    }

    /* ---------------------------- Eventos ------------------------------ */
    // "Nuevo usuario"
    container.querySelector('[data-add]').addEventListener('click', openCreate);

    // Cierre del modal
    container.querySelector('[data-close]').addEventListener('click', closeModal);
    container.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeModal();
    });

    // Limpieza de errores al escribir
    nameInput.addEventListener('input', () => {
      nameInput.classList.remove('is-invalid');
      nameError.textContent = '';
    });
    emailInput.addEventListener('input', () => {
      emailInput.classList.remove('is-invalid');
      emailError.textContent = '';
    });
    passwordInput.addEventListener('input', () => {
      passwordInput.classList.remove('is-invalid');
      passwordError.textContent = '';
    });

    // Búsqueda
    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value;
      renderTable();
    });

    // Envío del formulario
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validate()) return;

      const name = nameInput.value.trim();
      const permissions = getSelectedPermissions();

      try {
        if (editingId) {
          userService.update(editingId, {
            name,
            permissions,
            active: activeInput.checked,
          });
          showToast('Usuario actualizado correctamente.');
        } else {
          userService.create({
            name,
            email: emailInput.value.trim(),
            password: passwordInput.value,
            permissions,
          });
          showToast('Usuario creado correctamente.');
        }
        closeModal();
        renderTable();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Delegación de eventos sobre la tabla (editar, eliminar, toggle).
    tbody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      const deleteBtn = e.target.closest('[data-delete]');

      if (editBtn) {
        openEdit(editBtn.dataset.edit);
        return;
      }

      if (deleteBtn) {
        const user = userService.getById(deleteBtn.dataset.delete);
        if (!user) return;
        const ok = await confirmDialog({
          title: 'Eliminar usuario',
          message: `¿Seguro que deseas eliminar a "${user.name}"? Esta acción no se puede deshacer.`,
          confirmText: 'Eliminar',
          danger: true,
        });
        if (ok) {
          try {
            userService.remove(user.id);
            showToast('Usuario eliminado correctamente.');
            renderTable();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      }
    });

    tbody.addEventListener('change', (e) => {
      const toggle = e.target.closest('[data-toggle]');
      if (!toggle) return;
      try {
        const user = userService.toggleActive(toggle.dataset.toggle);
        showToast(
          user.active ? 'Usuario activado.' : 'Usuario desactivado.',
          user.active ? 'success' : 'info'
        );
        renderTable();
      } catch (err) {
        showToast(err.message, 'error');
        renderTable();
      }
    });

    /* --------------------------- Render inicial ------------------------ */
    renderTable();
  },
};
