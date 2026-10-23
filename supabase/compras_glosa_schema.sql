-- ============================================================================
-- FICA Portal — Migración: Glosa / observación por comprobante (Compras y Ventas)
-- ----------------------------------------------------------------------------
-- Ejecutar UNA VEZ si ya creaste public.tax_records antes.
-- Es idempotente. Luego recarga el portal con Ctrl+Shift+R.
-- ============================================================================

alter table public.tax_records add column if not exists glosa text;
