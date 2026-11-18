/* ============================================================================
   parametros.js — Administración · Parámetros nacionales (UIT / RMV)
   ----------------------------------------------------------------------------
   Una sola pantalla para los valores que comparten Planillas, Declaraciones y
   los reportes de Compras/Ventas. Los valores oficiales se actualizan desde
   `data/parametros-legales.json` (GitHub Actions consulta SUNAT y el BCRP).
   ========================================================================== */

import { legalParamsService } from '../../services/legalParamsService.js';
import { authService } from '../../services/authService.js';
import { ICONS, escapeHtml, showToast, confirmDialog } from '../../js/utils.js';

const money = (value) =>
  `S/ ${Number(value || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function dateLabel(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value));
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function sourceBadge(row) {
  if (row.source === 'manual') return '<span class="badge badge--gold">Manual</span>';
  if (row.source === 'official') return '<span class="badge badge--active">Oficial</span>';
  return '<span class="badge badge--muted">Referencial</span>';
}

function rmvDetail(row) {
  const history = row.rmvHistory || [];
  if (history.length < 2) return '';
  return history
    .map((h) => {
      const [year, month] = h.from.split('-');
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('es-PE', {
        month: 'short',
        year: 'numeric',
      });
      return `${label}: ${money(h.value)}`;
    })
    .join(' · ');
}

export default {
  title: 'Parámetros nacionales',

  render(container) {
    let rows = [];
    let selectedYear = new Date().getFullYear();
    let syncing = false;

    container.innerHTML = `
      <div class="page-heading">
        <div>
          <h2 class="page-heading__title">Parámetros nacionales</h2>
          <p class="page-heading__subtitle">
            UIT y Remuneración Mínima Vital para todas las empresas. Se usan en Planillas,
            Declaraciones SUNAT y reportes de Compras/Ventas.
          </p>
        </div>
        <span class="badge badge--gold">Administración</span>
      </div>

      <div class="card" data-sync-card>
        <div class="card__body" style="display:flex;gap:var(--space-4);align-items:flex-start;justify-content:space-between;flex-wrap:wrap;">
          <div>
            <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
              <strong>Actualización oficial</strong>
              <span class="badge badge--active" data-sync-badge>Automática</span>
            </div>
            <p class="text-muted" style="margin:0;font-size:var(--font-size-sm);" data-sync-info>
              Consultando los valores oficiales de SUNAT y del BCRP…
            </p>
            <p class="form-hint" style="margin-top:var(--space-2);" data-sync-detail></p>
          </div>
          <button type="button" class="btn btn--primary" data-sync>
            ${ICONS.arrowRight} Sincronizar ahora
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <div class="card__title">Valores por año</div>
            <div class="card__subtitle">La UIT y la RMV son únicas para todo el país; no se repiten por empresa.</div>
          </div>
        </div>
        <div class="card__body">
          <form data-form style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--space-4);align-items:end;">
            <div class="form-group" style="margin:0;">
              <label class="form-label">Año <span class="req">*</span></label>
              <input class="form-input" type="number" min="2000" max="2100" step="1" name="year" data-year />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">UIT (S/) <span class="req">*</span></label>
              <input class="form-input" type="number" min="0" step="0.01" name="uit" data-uit />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">RMV (S/) <span class="req">*</span></label>
              <input class="form-input" type="number" min="0" step="0.01" name="rmv" data-rmv />
            </div>
            <div class="form-group" style="margin:0;">
              <button type="submit" class="btn btn--primary" data-save>Guardar parámetros</button>
            </div>
          </form>
          <p class="form-hint" data-form-hint style="margin-top:var(--space-3);">
            Los valores oficiales tienen prioridad. Un ajuste manual guardado después de la última
            sincronización se respeta hasta la siguiente actualización oficial.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <div class="card__title">Historial de parámetros</div>
            <div class="card__subtitle">Los cambios de RMV a mitad de año se aplican por mes en la planilla.</div>
          </div>
        </div>
        <div class="card__body" style="padding-top:0;">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Año</th>
                  <th>UIT</th>
                  <th>RMV</th>
                  <th>Origen</th>
                  <th>Actualizado</th>
                  <th style="text-align:right;">Acciones</th>
                </tr>
              </thead>
              <tbody data-tbody>
                <tr><td colspan="6"><div class="empty-state"><div class="empty-state__desc">Cargando parámetros…</div></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p class="text-muted" style="font-size:var(--font-size-sm);">
        Fuentes: SUNAT (UIT) y BCRP / MTPE (RMV). El archivo
        <code>data/parametros-legales.json</code> se actualiza automáticamente desde internet.
      </p>
    `;

    const form = container.querySelector('[data-form]');
    const yearInput = container.querySelector('[data-year]');
    const uitInput = container.querySelector('[data-uit]');
    const rmvInput = container.querySelector('[data-rmv]');
    const tbody = container.querySelector('[data-tbody]');
    const syncBtn = container.querySelector('[data-sync]');
    const syncInfo = container.querySelector('[data-sync-info]');
    const syncDetail = container.querySelector('[data-sync-detail]');
    const syncBadge = container.querySelector('[data-sync-badge]');
    const formHint = container.querySelector('[data-form-hint]');
    const canEdit = authService.isSuperAdmin();

    function findRow(year) {
      return rows.find((r) => Number(r.year) === Number(year));
    }

    function fillForm(year) {
      selectedYear = Number(year) || new Date().getFullYear();
      const row = findRow(selectedYear);
      yearInput.value = String(selectedYear);
      uitInput.value = row ? Number(row.uit).toFixed(2) : legalParamsService.getUit(selectedYear).toFixed(2);
      rmvInput.value = row ? Number(row.rmv).toFixed(2) : legalParamsService.getRmv(selectedYear).toFixed(2);
      const detail = row ? rmvDetail(row) : '';
      formHint.innerHTML = detail
        ? `RMV del año: ${escapeHtml(detail)}. Al calcular un mes se usa el valor vigente desde ese mes.`
        : 'Los valores oficiales tienen prioridad. Un ajuste manual guardado después de la última sincronización se respeta hasta la siguiente actualización oficial.';
    }

    function renderSync() {
      const official = legalParamsService.official;
      const updated = official?.updatedAt ? dateLabel(official.updatedAt) : '—';
      const stale = official?.stale;
      syncBadge.className = `badge ${stale ? 'badge--gold' : 'badge--active'}`;
      syncBadge.textContent = stale ? 'Respaldo local' : 'Automática';
      syncInfo.textContent = official
        ? `Última actualización oficial: ${updated}. Fuente: ${official.source || 'SUNAT / BCRP'}.`
        : 'Aún no se han consultado los valores oficiales.';
      const err = legalParamsService.lastError;
      syncDetail.textContent = err
        ? `No se pudo leer Supabase (${err}). Se muestran los valores oficiales incluidos en el portal.`
        : 'La consulta se repite automáticamente cada 12 horas y también al abrir esta pantalla.';
    }

    function renderTable() {
      if (!rows.length) {
        tbody.innerHTML = `
          <tr><td colspan="6">
            <div class="empty-state">
              <div class="empty-state__title">Sin parámetros</div>
              <div class="empty-state__desc">Guarda la UIT y la RMV del año para comenzar.</div>
            </div>
          </td></tr>`;
        return;
      }

      tbody.innerHTML = rows
        .slice()
        .sort((a, b) => b.year - a.year)
        .map((row) => {
          const detail = rmvDetail(row);
          return `
            <tr>
              <td><strong>${row.year}</strong></td>
              <td>${money(row.uit)}</td>
              <td>
                ${money(row.rmv)}
                ${detail ? `<div class="text-muted" style="font-size:var(--font-size-xs);margin-top:2px;">${escapeHtml(detail)}</div>` : ''}
              </td>
              <td>${sourceBadge(row)}</td>
              <td class="text-muted">${dateLabel(row.updatedAt)}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button type="button" class="btn btn--sm" data-edit="${row.year}">Editar</button>
                ${row.custom ? `<button type="button" class="btn btn--sm" data-reset="${row.year}">Quitar ajuste</button>` : ''}
              </td>
            </tr>`;
        })
        .join('');
    }

    async function load({ force = false } = {}) {
      try {
        await legalParamsService.refresh({ force });
        rows = legalParamsService.list();
        renderSync();
        renderTable();
        fillForm(selectedYear);
      } catch (err) {
        showToast(`No se pudieron cargar los parámetros: ${err.message}`, 'error');
      }
    }

    async function autoSync() {
      if (!canEdit || syncing) return;
      syncing = true;
      try {
        const result = await legalParamsService.autoSyncIfStale();
        if (result?.skipped) return;
        if (result?.changes?.length) {
          const years = result.changes.map((c) => c.year).join(', ');
          showToast(`Parámetros oficiales actualizados: ${years}.`, 'info');
        }
        // Aunque no cambien los valores, la sincronización puede haber
        // recuperado la conexión y actualizado la fecha/origen oficial.
        await load({ force: true });
      } catch (err) {
        // No bloquea el portal si no hay internet o falta ejecutar el esquema.
        syncBadge.className = 'badge badge--gold';
        syncBadge.textContent = 'Sin sincronizar';
        syncDetail.textContent = `No se pudo sincronizar (${err.message}). Se mantienen los valores guardados.`;
      } finally {
        syncing = false;
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!canEdit) {
        showToast('Solo el superadministrador puede modificar los parámetros.', 'error');
        return;
      }
      try {
        await legalParamsService.save(
          Number(yearInput.value),
          Number(uitInput.value),
          Number(rmvInput.value)
        );
        showToast(`Parámetros ${yearInput.value} guardados.`);
        await load({ force: true });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    yearInput.addEventListener('change', () => fillForm(yearInput.value));

    syncBtn.addEventListener('click', async () => {
      if (!canEdit || syncing) return;
      syncing = true;
      syncBtn.disabled = true;
      try {
        const result = await legalParamsService.syncOfficial();
        const count = result.changes.length;
        showToast(
          count
            ? `Sincronización completa: ${count} año(s) actualizado(s).`
            : 'Los parámetros ya estaban al día.',
          'success'
        );
        await load({ force: true });
      } catch (err) {
        showToast(`No se pudo sincronizar: ${err.message}`, 'error');
      } finally {
        syncing = false;
        syncBtn.disabled = false;
      }
    });

    tbody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        fillForm(editBtn.dataset.edit);
        yearInput.focus();
        return;
      }
      const resetBtn = e.target.closest('[data-reset]');
      if (!resetBtn) return;
      const year = Number(resetBtn.dataset.reset);
      const ok = await confirmDialog({
        title: 'Quitar ajuste',
        message: `Se eliminará el ajuste guardado para ${year}. Si existe un valor oficial, se usará ese valor.`,
        confirmText: 'Quitar ajuste',
        danger: true,
      });
      if (!ok) return;
      try {
        await legalParamsService.remove(year);
        showToast(`Ajuste de ${year} eliminado.`);
        await load({ force: true });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    if (!canEdit) {
      form.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
      syncBtn.hidden = true;
    }

    // Primera carga: valores guardados + intento de sincronización automática.
    load().then(() => autoSync());
  },
};
