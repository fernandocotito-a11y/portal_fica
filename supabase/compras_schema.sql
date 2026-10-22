-- ============================================================================
-- FICA Portal — Registro de Compras y Ventas (SIRE)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1) Supabase Dashboard -> SQL Editor -> New query
--   2) Pega TODO este contenido y pulsa "Run".
--   3) Recarga el portal. La pestaña Compras y Ventas dejará el modo local.
-- Incluye tax_records, tax_import_batches y el directorio tax_suppliers.
-- ============================================================================

-- 1) Lotes de importación -----------------------------------------------------
create table if not exists public.tax_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text not null,
  kind text not null default '' check (kind in ('compra', 'venta', '')),
  periods text[] not null default '{}',
  total_rows int not null default 0,
  imported_rows int not null default 0,
  skipped_rows int not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 2) Registro de comprobantes -------------------------------------------------
create table if not exists public.tax_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  import_batch_id uuid references public.tax_import_batches(id) on delete cascade,
  kind text not null check (kind in ('compra', 'venta')),
  period text not null,

  -- Datos del emisor / empresa
  ruc_empresa text,
  razon_social_empresa text,
  car_sunat text,

  -- Comprobante
  issue_date date,
  due_date date,
  doc_type text,
  series text,
  year text,
  number text,
  number_final text,

  -- Contraparte
  doc_id_type text,
  doc_id_number text,
  counterparty_name text,

  -- Importes
  export_value numeric not null default 0,
  taxed_base numeric not null default 0,
  discount_base numeric not null default 0,
  igv numeric not null default 0,
  discount_igv numeric not null default 0,
  taxed_base_ng numeric not null default 0,
  igv_ng numeric not null default 0,
  taxed_base_dng numeric not null default 0,
  igv_dng numeric not null default 0,
  acq_value_ng numeric not null default 0,
  exonerated numeric not null default 0,
  unaffected numeric not null default 0,
  isc numeric not null default 0,
  ivap_base numeric not null default 0,
  ivap numeric not null default 0,
  icbper numeric not null default 0,
  other_taxes numeric not null default 0,
  total numeric not null default 0,
  currency text not null default 'PEN',
  exchange_rate numeric not null default 1,

  -- Notas / documentos modificados
  modified_date date,
  modified_doc_type text,
  modified_series text,
  modified_number text,
  note_type text,
  state text,
  operation_type text,
  dam text,
  clu text,

  -- Metadatos
  raw jsonb not null default '{}'::jsonb,
  source text not null default 'sire',
  source_file text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);

-- 3) Directorio de proveedores ------------------------------------------------
create table if not exists public.tax_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doc_id_type text not null default '6',
  doc_id_number text not null,
  name text not null,
  trade_name text,
  address text,
  email text,
  phone text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, doc_id_number)
);

-- 4) RLS ---------------------------------------------------------------------
-- Helper de acceso por empresa. payroll_schema.sql ya lo define; se replica
-- aquí para que este script funcione también de forma independiente.
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

alter table public.tax_import_batches enable row level security;
alter table public.tax_records enable row level security;
alter table public.tax_suppliers enable row level security;

drop policy if exists "tax_import_batches_all" on public.tax_import_batches;
create policy "tax_import_batches_all" on public.tax_import_batches
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

drop policy if exists "tax_records_all" on public.tax_records;
create policy "tax_records_all" on public.tax_records
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

drop policy if exists "tax_suppliers_all" on public.tax_suppliers;
create policy "tax_suppliers_all" on public.tax_suppliers
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

-- 5) Índices ------------------------------------------------------------------
create index if not exists idx_tax_records_company on public.tax_records(company_id);
create index if not exists idx_tax_records_company_kind_period on public.tax_records(company_id, kind, period);
create index if not exists idx_tax_records_doc on public.tax_records(company_id, doc_id_number);
create index if not exists idx_tax_records_dedupe on public.tax_records(company_id, dedupe_key);
create index if not exists idx_tax_batches_company on public.tax_import_batches(company_id, created_at desc);
create index if not exists idx_tax_suppliers_company on public.tax_suppliers(company_id, name);

-- 6) Trigger updated_at -------------------------------------------------------
create or replace function public.touch_tax_record()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_tax_record on public.tax_records;
create trigger trg_touch_tax_record
  before update on public.tax_records
  for each row execute function public.touch_tax_record();

create or replace function public.touch_tax_supplier()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_tax_supplier on public.tax_suppliers;
create trigger trg_touch_tax_supplier
  before update on public.tax_suppliers
  for each row execute function public.touch_tax_supplier();

-- 7) Permisos -----------------------------------------------------------------
grant select, insert, update, delete on public.tax_records to authenticated;
grant select, insert, update, delete on public.tax_import_batches to authenticated;
grant select, insert, update, delete on public.tax_suppliers to authenticated;
