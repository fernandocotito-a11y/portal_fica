-- ============================================================================
-- FICA Portal — Migración: Tipos de cambio SUNAT (Compras y Ventas)
-- ----------------------------------------------------------------------------
-- Ejecutar UNA VEZ si ya ejecutaste supabase/compras_schema.sql antes.
-- Es idempotente. Luego recarga el portal con Ctrl+Shift+R.
-- ============================================================================

create table if not exists public.tax_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rate_date date not null,
  currency text not null default 'USD',
  rate numeric(14, 4) not null check (rate > 0),
  source text not null default 'sunat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rate_date, currency)
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

alter table public.tax_exchange_rates enable row level security;

drop policy if exists "tax_exchange_rates_all" on public.tax_exchange_rates;
create policy "tax_exchange_rates_all" on public.tax_exchange_rates
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

create index if not exists idx_tax_exchange_rates_company_date
  on public.tax_exchange_rates(company_id, rate_date desc, currency);

create or replace function public.touch_tax_exchange_rate()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_tax_exchange_rate on public.tax_exchange_rates;
create trigger trg_touch_tax_exchange_rate
  before update on public.tax_exchange_rates
  for each row execute function public.touch_tax_exchange_rate();

grant select, insert, update, delete on public.tax_exchange_rates to authenticated;
