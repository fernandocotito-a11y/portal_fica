/* ============================================================================
   companies.js — Módulo de Gestión de Empresas (CRUD, Supabase)
   ----------------------------------------------------------------------------
   Superadministrador: crea, edita, activa/desactiva y elimina empresas.
   ========================================================================== */

import { companyService } from '../../services/companyService.js';
import { ICONS, initials, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

export default {
  title: 'Gestión de Empresas',

  render(container) {
    let editingId = null;
    let searchTerm = '';

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Gestión de Empresas</h2>
          <p class="page-heading__subtitle">Crea y administra las empresas que accederán al portal.</p>
        </div>
        <button type="button" class="btn btn--primary" data-add>${ICONS.plus} Nueva empresa</button>
      </div>

      <div class="card">
        <div class="table-toolbar" style="padding: var(--space-4) var(--space-5) 0;">
          <div class="table-toolbar__search">
            <span class="input-wrap__icon">${ICONS.search}</span>
            <input class="form-input" type="search" placeholder="Buscar por razón social o RUC..." data-search />
          </div>
          <span class="text-muted" style="font-size: var(--font-size-sm);" data-count></span>
        </div>
        <div class="card__body" style="padding-top: var(--space-4);">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>RUC</th>
                  <th>Estado</th>
                  <th style="text-align:right;">Acciones</th>
                </tr>
              </thead>
              <tbody data-tbody></tbody>
            </table>
          </div>
        </div>
      </div>

      <dialog class="modal" data-modal>
        <form data-form novalidate>
          <div class="modal__header">
            <h3 class="modal__title" data-modal-title>Nueva empresa</h3>
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
            <div class="form-group" data-active-group hidden>
              <label class="checkbox">
                <input type="checkbox" data-active />
                <span class="checkbox__box">${ICONS.check}</span>
                <span>Empresa activa</span>
              </label>
            </div>
          </div>
          <div class="modal__footer">
            <button type="button" class="btn" data-cancel>Cancelar</button>
            <button type="submit" class="btn btn--primary" data-submit>Crear empresa</button>
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
    const rucInput = container.querySelector('[data-ruc]');
    const activeGroup = container.querySelector('[data-active-group]');
    const activeInput = container.querySelector('[data-active]');
    const nameError = container.querySelector('[data-error-name]');
    const rucError = container.querySelector('[data-error-ruc]');

    function filteredCompanies() {
      const term = searchTerm.trim().toLowerCase();
      return companyService.list().filter((c) => {
        if (!term) return true;
        return c.name.toLowerCase().includes(term) || c.ruc.includes(term);
      });
    }

    function renderTable() {
      const companies = filteredCompanies();
      countEl.textContent = `Mostrando ${companies.length} de ${companyService.list().length} empresas`;

      if (companies.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4">
              <div class="empty-state">
                <span class="empty-state__icon">${ICONS.building}</span>
                <div class="empty-state__title">Sin resultados</div>
                <div class="empty-state__desc">No se encontraron empresas que coincidan con la búsqueda.</div>
              </div>
            </td>
          </tr>`;
        return;
      }

      tbody.innerHTML = companies
        .map(
          (c) => `
            <tr>
              <td>
                <div class="table__cell-user">
                  <span class="table__avatar" style="background:linear-gradient(135deg,var(--color-gold),var(--color-gold-bright));">${escapeHtml(initials(c.name))}</span>
                  <div><div class="table__name">${escapeHtml(c.name)}</div></div>
                </div>
              </td>
              <td><code>${escapeHtml(c.ruc)}</code></td>
              <td>
                <label class="switch" title="${c.active ? 'Desactivar' : 'Activar'}">
                  <input type="checkbox" data-toggle="${escapeHtml(c.id)}" ${c.active ? 'checked' : ''} />
                  <span class="switch__track"></span>
                  <span class="switch__thumb"></span>
                </label>
              </td>
              <td>
                <div class="table__actions" style="justify-content:flex-end;">
                  <button type="button" class="icon-btn" data-edit="${escapeHtml(c.id)}" title="Editar">${ICONS.edit}</button>
                  <button type="button" class="icon-btn icon-btn--danger" data-delete="${escapeHtml(c.id)}" title="Eliminar">${ICONS.trash}</button>
                </div>
              </td>
            </tr>`
        )
        .join('');
    }

    async function load() {
      await companyService.refresh();
      renderTable();
    }

    function clearErrors() {
      nameInput.classList.remove('is-invalid');
      rucInput.classList.remove('is-invalid');
      nameError.textContent = '';
      rucError.textContent = '';
    }

    function openCreate() {
      editingId = null;
      modalTitle.textContent = 'Nueva empresa';
      submitBtn.textContent = 'Crear empresa';
      form.reset();
      clearErrors();
      activeGroup.hidden = true;
      activeInput.checked = true;
      modal.showModal();
      nameInput.focus();
    }

    function openEdit(id) {
      const company = companyService.getById(id);
      if (!company) return;
      editingId = id;
      modalTitle.textContent = 'Editar empresa';
      submitBtn.textContent = 'Guardar cambios';
      clearErrors();
      nameInput.value = company.name;
      rucInput.value = company.ruc;
      activeGroup.hidden = false;
      activeInput.checked = company.active;
      modal.showModal();
      nameInput.focus();
    }

    function closeModal() {
      modal.close();
    }

    function validate() {
      let valid = true;
      clearErrors();

      if (!nameInput.value.trim()) {
        nameInput.classList.add('is-invalid');
        nameError.textContent = 'La razón social es obligatoria.';
        valid = false;
      }

      const ruc = rucInput.value.trim();
      if (!ruc) {
        rucInput.classList.add('is-invalid');
        rucError.textContent = 'El RUC es obligatorio.';
        valid = false;
      } else if (!/^\d{11}$/.test(ruc)) {
        rucInput.classList.add('is-invalid');
        rucError.textContent = 'El RUC debe tener 11 dígitos.';
        valid = false;
      }

      return valid;
    }

    container.querySelector('[data-add]').addEventListener('click', openCreate);
    container.querySelector('[data-close]').addEventListener('click', closeModal);
    container.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeModal();
    });

    nameInput.addEventListener('input', () => {
      nameInput.classList.remove('is-invalid');
      nameError.textContent = '';
    });
    rucInput.addEventListener('input', () => {
      rucInput.classList.remove('is-invalid');
      rucError.textContent = '';
    });

    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value;
      renderTable();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) return;

      const name = nameInput.value.trim();
      const ruc = rucInput.value.trim();
      submitBtn.disabled = true;

      try {
        if (editingId) {
          await companyService.update(editingId, { name, ruc, active: activeInput.checked });
          showToast('Empresa actualizada correctamente.');
        } else {
          await companyService.create({ name, ruc });
          showToast('Empresa creada correctamente.');
        }
        closeModal();
        renderTable();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    tbody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      const deleteBtn = e.target.closest('[data-delete]');

      if (editBtn) {
        openEdit(editBtn.dataset.edit);
        return;
      }

      if (deleteBtn) {
        const company = companyService.getById(deleteBtn.dataset.delete);
        if (!company) return;
        const ok = await confirmDialog({
          title: 'Eliminar empresa',
          message: `¿Seguro que deseas eliminar a "${company.name}"? Esta acción no se puede deshacer.`,
          confirmText: 'Eliminar',
          danger: true,
        });
        if (ok) {
          try {
            await companyService.remove(company.id);
            showToast('Empresa eliminada correctamente.');
            renderTable();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      }
    });

    tbody.addEventListener('change', async (e) => {
      const toggle = e.target.closest('[data-toggle]');
      if (!toggle) return;
      try {
        const company = await companyService.toggleActive(toggle.dataset.toggle);
        showToast(company.active ? 'Empresa activada.' : 'Empresa desactivada.', company.active ? 'success' : 'info');
        renderTable();
      } catch (err) {
        showToast(err.message, 'error');
        renderTable();
      }
    });

    load();
  },
};
