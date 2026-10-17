/* ============================================================================
   companies.js — Módulo de Gestión de Empresas (CRUD, Supabase)
   ----------------------------------------------------------------------------
   Superadministrador: crea, edita, activa/desactiva y elimina empresas, con
   sus datos tributarios (tipo de contribuyente, régimen, IGV, agentes).
   ========================================================================== */

import { companyService } from '../../services/companyService.js';
import { COMPANY_OPTIONS, REGIMEN_LABORAL, optionLabel } from '../../js/config.js';
import { ICONS, initials, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

/** Genera las <option> de un catálogo. */
function optionsHtml(list, selected) {
  return list
    .map(
      (o) =>
        `<option value="${escapeHtml(o.value)}"${o.value === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    )
    .join('');
}

export default {
  title: 'Gestión de Empresas',

  render(container) {
    let editingId = null;
    let searchTerm = '';

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Gestión de Empresas</h2>
          <p class="page-heading__subtitle">Crea y administra las empresas y sus datos tributarios.</p>
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
                  <th>Régimen</th>
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
              <label class="form-label">Razón social / Nombre comercial <span class="req">*</span></label>
              <input class="form-input" name="name" placeholder="Ej. Empresa Ejemplo S.A.C." data-name />
              <span class="field-error" data-error-name></span>
            </div>

            <div class="form-group">
              <label class="form-label">RUC <span class="req">*</span></label>
              <input class="form-input" name="ruc" inputmode="numeric" maxlength="11" placeholder="11 dígitos" data-ruc />
              <span class="field-error" data-error-ruc></span>
            </div>

            <div class="form-group">
              <label class="form-label">Tipo de contribuyente <span class="req">*</span></label>
              <select class="form-input" data-tipo>
                ${optionsHtml(COMPANY_OPTIONS.tipoContribuyente, 'juridica')}
              </select>
            </div>

            <div class="form-group" data-sociedad-group>
              <label class="form-label">Tipo de sociedad</label>
              <select class="form-input" data-sociedad>
                <option value="">— Selecciona —</option>
                ${optionsHtml(COMPANY_OPTIONS.tipoSociedad, '')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Régimen tributario <span class="req">*</span></label>
              <select class="form-input" data-regimen>
                ${optionsHtml(COMPANY_OPTIONS.regimenTributario, 'RG')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Afectación IGV / IVA <span class="req">*</span></label>
              <select class="form-input" data-igv>
                ${optionsHtml(COMPANY_OPTIONS.afectacionIgv, 'general')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Régimen laboral <span class="req">*</span></label>
              <select class="form-input" data-labor>
                ${optionsHtml(REGIMEN_LABORAL, 'general')}
              </select>
              <p class="form-hint">Afecta vacaciones, gratificaciones y CTS según la Ley MYPE.</p>
            </div>

            <div class="form-group">
              <label class="form-label">Agente de Retención / Percepción (SUNAT)</label>
              <label class="checkbox" style="margin-bottom: var(--space-2);">
                <input type="checkbox" data-retencion />
                <span class="checkbox__box">${ICONS.check}</span>
                <span>Agente de Retención (3% IGV)</span>
              </label>
              <label class="checkbox">
                <input type="checkbox" data-percepcion />
                <span class="checkbox__box">${ICONS.check}</span>
                <span>Agente de Percepción</span>
              </label>
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
    const tipoSelect = container.querySelector('[data-tipo]');
    const sociedadGroup = container.querySelector('[data-sociedad-group]');
    const sociedadSelect = container.querySelector('[data-sociedad]');
    const regimenSelect = container.querySelector('[data-regimen]');
    const igvSelect = container.querySelector('[data-igv]');
    const laborSelect = container.querySelector('[data-labor]');
    const retencionInput = container.querySelector('[data-retencion]');
    const percepcionInput = container.querySelector('[data-percepcion]');
    const activeGroup = container.querySelector('[data-active-group]');
    const activeInput = container.querySelector('[data-active]');
    const nameError = container.querySelector('[data-error-name]');
    const rucError = container.querySelector('[data-error-ruc]');

    /* --------------------------- Helpers ------------------------------- */
    function filteredCompanies() {
      const term = searchTerm.trim().toLowerCase();
      return companyService.list().filter((c) => {
        if (!term) return true;
        return c.name.toLowerCase().includes(term) || c.ruc.includes(term);
      });
    }

    function updateSociedadVisibility() {
      sociedadGroup.hidden = tipoSelect.value !== 'juridica';
    }

    function regimenBadge(value) {
      const label = optionLabel(COMPANY_OPTIONS.regimenTributario, value);
      return `<span class="badge badge--gold" title="${escapeHtml(label)}">${escapeHtml(value)}</span>`;
    }

    function agentChips(c) {
      const chips = [];
      if (c.agente_retencion) chips.push('<span class="chip">Retención</span>');
      if (c.agente_percepcion) chips.push('<span class="chip">Percepción</span>');
      return chips.join('');
    }

    function renderTable() {
      const companies = filteredCompanies();
      countEl.textContent = `Mostrando ${companies.length} de ${companyService.list().length} empresas`;

      if (companies.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5">
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
                  <div>
                    <div class="table__name">${escapeHtml(c.name)}</div>
                    <div class="table__email">${escapeHtml(
                      optionLabel(COMPANY_OPTIONS.tipoContribuyente, c.tipo_contribuyente) +
                        (c.tipo_sociedad ? ' · ' + c.tipo_sociedad : '')
                    )}</div>
                  </div>
                </div>
              </td>
              <td><code>${escapeHtml(c.ruc)}</code></td>
              <td>${regimenBadge(c.regimen_tributario)} ${agentChips(c)}</td>
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
      tipoSelect.value = 'juridica';
      regimenSelect.value = 'RG';
      igvSelect.value = 'general';
      laborSelect.value = 'general';
      retencionInput.checked = false;
      percepcionInput.checked = false;
      activeGroup.hidden = true;
      activeInput.checked = true;
      updateSociedadVisibility();
      modal.showModal();
      nameInput.focus();
    }

    function openEdit(id) {
      const c = companyService.getById(id);
      if (!c) return;
      editingId = id;
      modalTitle.textContent = 'Editar empresa';
      submitBtn.textContent = 'Guardar cambios';
      clearErrors();
      nameInput.value = c.name || '';
      rucInput.value = c.ruc || '';
      tipoSelect.value = c.tipo_contribuyente || 'juridica';
      sociedadSelect.value = c.tipo_sociedad || '';
      regimenSelect.value = c.regimen_tributario || 'RG';
      igvSelect.value = c.afectacion_igv || 'general';
      laborSelect.value = c.regimen_laboral || 'general';
      retencionInput.checked = !!c.agente_retencion;
      percepcionInput.checked = !!c.agente_percepcion;
      activeGroup.hidden = false;
      activeInput.checked = c.active;
      updateSociedadVisibility();
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

    /* ---------------------------- Eventos ------------------------------ */
    container.querySelector('[data-add]').addEventListener('click', openCreate);
    container.querySelector('[data-close]').addEventListener('click', closeModal);
    container.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeModal();
    });

    // Auto-detección del tipo de contribuyente por el prefijo del RUC.
    rucInput.addEventListener('input', () => {
      rucInput.classList.remove('is-invalid');
      rucError.textContent = '';
      const v = rucInput.value.trim();
      if (v.startsWith('10')) tipoSelect.value = 'natural';
      else if (v.startsWith('20')) tipoSelect.value = 'juridica';
      updateSociedadVisibility();
    });
    nameInput.addEventListener('input', () => {
      nameInput.classList.remove('is-invalid');
      nameError.textContent = '';
    });
    tipoSelect.addEventListener('change', updateSociedadVisibility);

    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value;
      renderTable();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) return;

      const fields = {
        name: nameInput.value.trim(),
        ruc: rucInput.value.trim(),
        tipo_contribuyente: tipoSelect.value,
        tipo_sociedad: tipoSelect.value === 'juridica' ? sociedadSelect.value || null : null,
        regimen_tributario: regimenSelect.value,
        afectacion_igv: igvSelect.value,
        regimen_laboral: laborSelect.value,
        agente_retencion: retencionInput.checked,
        agente_percepcion: percepcionInput.checked,
      };
      submitBtn.disabled = true;

      try {
        if (editingId) {
          await companyService.update(editingId, { ...fields, active: activeInput.checked });
          showToast('Empresa actualizada correctamente.');
        } else {
          await companyService.create(fields);
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
