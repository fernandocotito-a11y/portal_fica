-- ============================================================================
-- FICA Portal — Control de pago de Recibos por Honorarios (PDT 601)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1) Supabase Dashboard -> SQL Editor -> New query
--   2) Pega TODO este contenido y pulsa "Run".
--   3) Recarga el portal con Ctrl+Shift+R.
-- Agrega el flag `pagado` y el índice por empresa/pago/fecha para que el PDT 601
-- y el asiento solo incluyan recibos PAGADOS en el mes de pago seleccionado.
-- Es idempotente: se puede ejecutar varias veces sin duplicar nada.
--
-- IMPORTANTE: el TXT de SUNAT no trae la fecha de pago real. Los recibos con
-- "Monto Neto Pendiente de Pago = 0" se marcan como pagados con fecha de pago =
-- fecha de emisión; los demás quedan pendientes hasta que se marquen en el módulo.
-- ============================================================================

alter table public.honorarios_recibos
  add column if not exists pagado boolean not null default false;

update public.honorarios_recibos
  set pagado = true
  where coalesce(pendiente_pago, 0) = 0 and fecha_pago is not null and pagado = false;

create index if not exists idx_honorarios_recibos_company_pago
  on public.honorarios_recibos(company_id, pagado, fecha_pago);
