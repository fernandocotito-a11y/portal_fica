-- ============================================================================
-- FICA Portal — Migración: Directorio de proveedores (Compras)
-- ----------------------------------------------------------------------------
-- Ejecutar UNA VEZ si ya ejecutaste supabase/compras_schema.sql antes.
-- Es idempotente. Luego recarga el portal con Ctrl+Shift+R.
-- ============================================================================

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

alter table public.tax_suppliers enable row level security;

drop policy if exists "tax_suppliers_all" on public.tax_suppliers;
create policy "tax_suppliers_all" on public.tax_suppliers
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

create index if not exists idx_tax_suppliers_company on public.tax_suppliers(company_id, name);

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

grant select, insert, update, delete on public.tax_suppliers to authenticated;
