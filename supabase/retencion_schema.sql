-- ============================================================================
-- FICA Portal — Módulo Agentes de Retención / Percepción
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1) Supabase Dashboard -> SQL Editor -> New query
--   2) Pega TODO este contenido y pulsa "Run".
--   3) Recarga el portal con Ctrl+Shift+R.
-- Crea la tabla tax_retention_records (retenciones y percepciones importadas).
-- ============================================================================

create table if not exists public.tax_retention_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  kind text not null check (kind in ('retencion', 'percepcion')),
  period text not null,

  -- Comprobante de retención / percepción
  comprobante_serie text,
  comprobante_numero text,
  comprobante_fecha date,
  estado text,
  tasa numeric not null default 0,

  -- Agente (emisor) y receptor
  agente_ruc text,
  agente_nombre text,
  receptor_ruc text,
  receptor_nombre text,
  importe_total numeric not null default 0,

  -- Documento (factura, nota de crédito, etc.)
  doc_tipo text,
  doc_serie text,
  doc_numero text,
  doc_fecha date,
  total_comprobante numeric not null default 0,
  nro_pago text,
  importe_pagado numeric not null default 0,
  monto_retenido numeric not null default 0,
  monto_neto numeric not null default 0,

  currency text not null default 'PEN',
  raw jsonb not null default '{}'::jsonb,
  source text not null default 'excel',
  source_file text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (company_id, dedupe_key)
);

-- RLS ----------------------------------------------------------------------
create or replace function public.can_access_company(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_superadmin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p_company = any (p.companies)
    );
$$;

alter table public.tax_retention_records enable row level security;

drop policy if exists "tax_retention_records_all" on public.tax_retention_records;
create policy "tax_retention_records_all" on public.tax_retention_records
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

-- Índices ------------------------------------------------------------------
create index if not exists idx_tax_retention_company on public.tax_retention_records(company_id);
create index if not exists idx_tax_retention_company_period on public.tax_retention_records(company_id, kind, period);
create index if not exists idx_tax_retention_company_dedupe on public.tax_retention_records(company_id, dedupe_key);

-- Trigger updated_at -------------------------------------------------------
create or replace function public.touch_tax_retention_record()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_tax_retention_record on public.tax_retention_records;
create trigger trg_touch_tax_retention_record
  before update on public.tax_retention_records
  for each row execute function public.touch_tax_retention_record();

-- Permisos -----------------------------------------------------------------
grant select, insert, update, delete on public.tax_retention_records to authenticated;
