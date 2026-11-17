-- ============================================================================
-- FICA Portal — Migración: Tipos de cambio SUNAT Globales (Compartidos)
-- ----------------------------------------------------------------------------
-- Ejecutar en el SQL Editor de Supabase.
-- Hace que los tipos de cambio sean universales para todas las empresas del portal,
-- eliminando la necesidad de cargarlos o sincronizarlos empresa por empresa.
-- Es completamente idempotente. Luego recarga el portal con Ctrl+Shift+R.
-- ============================================================================

create table if not exists public.tax_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  rate_date date not null,
  currency text not null default 'USD',
  rate numeric(14, 4) not null check (rate > 0),
  source text not null default 'sunat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Asegurar que company_id sea opcional (nulo = tipo de cambio global compartido)
alter table public.tax_exchange_rates alter column company_id drop not null;

-- Deduplicar registros previos por fecha y moneda antes de consolidar.
-- Se conserva el registro manual más reciente; si no hay manuales, el más
-- reciente. Así no se pierde ningún ajuste hecho a mano al pasar a global.
delete from public.tax_exchange_rates a
using public.tax_exchange_rates b
where a.rate_date = b.rate_date
  and a.currency = b.currency
  and (
    (a.source <> 'manual' and b.source = 'manual')
    or (a.source <> 'manual' and b.source <> 'manual'
        and (a.updated_at, a.id) < (b.updated_at, b.id))
    or (a.source = 'manual' and b.source = 'manual'
        and (a.updated_at, a.id) < (b.updated_at, b.id))
  );

-- Convertir registros existentes por empresa a tipos de cambio globales
update public.tax_exchange_rates
set company_id = null
where company_id is not null;

-- Índice único global por fecha y moneda
create unique index if not exists idx_tax_exchange_rates_date_curr_unique
  on public.tax_exchange_rates(rate_date, currency);

-- El índice por empresa ya no aplica: el tipo de cambio es único para el grupo
drop index if exists public.idx_tax_exchange_rates_company_date;

-- RLS
alter table public.tax_exchange_rates enable row level security;

-- Política: todos los usuarios autenticados acceden y gestionan los tipos de cambio globales
drop policy if exists "tax_exchange_rates_all" on public.tax_exchange_rates;
create policy "tax_exchange_rates_all" on public.tax_exchange_rates
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create index if not exists idx_tax_exchange_rates_date
  on public.tax_exchange_rates(rate_date desc, currency);

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
