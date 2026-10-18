/* ============================================================================
   paramsService.js — Parámetros legales por año (UIT y RMV) en Supabase
   ----------------------------------------------------------------------------
   La UIT y la RMV son valores nacionales que cambian cada año. Aquí se pueden
   configurar por año (ej. 2027) y se guardan en la tabla global `payroll_params`.
   ========================================================================== */

import { supabase } from '../../js/supabase.js';
import { setUitYear, setRmvYear, resetParams, UIT, RMV, getUit, getRmv } from './payrollConfig.js';

const cache = {}; // year -> { uit, rmv, custom }

export const paramsService = {
  /** Carga los parámetros desde Supabase y los aplica como overrides. */
  async refresh() {
    resetParams();
    const { data, error } = await supabase.from('payroll_params').select('*');
    if (error) throw new Error(error.message);
    (data || []).forEach((r) => {
      const y = Number(r.year);
      if (!Number.isFinite(y)) return;
      cache[y] = { uit: Number(r.uit), rmv: Number(r.rmv), custom: true };
      if (r.uit != null) setUitYear(y, r.uit);
      if (r.rmv != null) setRmvYear(y, r.rmv);
    });
  },

  /** Años disponibles (rango alrededor del actual + personalizados + defaults). */
  availableYears() {
    const Y = new Date().getFullYear();
    const set = new Set();
    for (let y = Y - 3; y <= Y + 3; y += 1) set.add(y);
    Object.keys(cache).map(Number).forEach((y) => set.add(y));
    Object.keys(UIT).map(Number).forEach((y) => set.add(y));
    Object.keys(RMV).map(Number).forEach((y) => set.add(y));
    return Array.from(set).sort((a, b) => a - b);
  },

  /** Lista de años con su UIT/RMV efectiva y si es personalizado. */
  list() {
    return this.availableYears().map((y) => ({
      year: y,
      uit: getUit(y),
      rmv: getRmv(y),
      custom: !!cache[y],
    }));
  },

  /** Guarda (o actualiza) UIT y RMV de un año. */
  async save(year, uit, rmv) {
    const y = Number(year);
    const u = Number(uit);
    const r = Number(rmv);
    if (!Number.isFinite(y) || !(u > 0) || !(r > 0)) {
      throw new Error('Año, UIT y RMV deben ser números válidos y mayores a 0.');
    }
    const { error } = await supabase
      .from('payroll_params')
      .upsert({ year: y, uit: u, rmv: r, updated_at: new Date().toISOString() }, { onConflict: 'year' });
    if (error) throw new Error(error.message);
    cache[y] = { uit: u, rmv: r, custom: true };
    setUitYear(y, u);
    setRmvYear(y, r);
  },

  /** Elimina la configuración personalizada de un año (vuelve al default). */
  async remove(year) {
    const y = Number(year);
    const { error } = await supabase.from('payroll_params').delete().eq('year', y);
    if (error) throw new Error(error.message);
    delete cache[y];
    await this.refresh();
  },
};
