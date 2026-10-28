-- ============================================================================
-- FICA Portal — Declaraciones SUNAT (Liquidación IGV / Renta mensual)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1) Supabase Dashboard -> SQL Editor -> New query
--   2) Pega TODO este contenido y pulsa "Run".
--   3) Recarga el portal. El módulo "Declaraciones SUNAT" deja el modo local.
--
-- Guarda únicamente los datos manuales (saldos iniciales y ajustes por mes).
-- Los importes calculados se obtienen en cada carga desde Compras/Ventas y
-- Retenciones/Percepciones, por lo que nunca quedan desincronizados.
-- ============================================================================

-- 1) Saldos iniciales / configuración del ejercicio --------------------------
create table if not exists public.declaraciones_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  anio int not null check (anio between 2000 and 2100),
  saldo_igv_anterior numeric(14, 2) not null default 0,
  percepciones_ant numeric(14, 2) not null default 0,
  retenciones_ant numeric(14, 2) not null default 0,
  uit numeric(14, 2) not null default 5400,
  coeficiente_renta numeric(6, 4) not null default 0,
  is_manual_initial_balance boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, anio)
);

-- 2) Ajustes manuales por periodo --------------------------------------------
create table if not exists public.tax_declaration_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  anio int not null check (anio between 2000 and 2100),
  mes int not null check (mes between 1 and 12),
  pagos_previos numeric(14, 2) not null default 0,
  intereses numeric(14, 2) not null default 0,
  pagos_previos_renta numeric(14, 2) not null default 0,
  intereses_renta numeric(14, 2) not null default 0,
  estado text not null default 'calculado' check (estado in ('calculado', 'cerrado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, anio, mes)
);

-- 3) RLS ---------------------------------------------------------------------
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

alter table public.declaraciones_balances enable row level security;
alter table public.tax_declaration_periods enable row level security;

drop policy if exists "declaraciones_balances_all" on public.declaraciones_balances;
create policy "declaraciones_balances_all" on public.declaraciones_balances
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

drop policy if exists "tax_declaration_periods_all" on public.tax_declaration_periods;
create policy "tax_declaration_periods_all" on public.tax_declaration_periods
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

-- 4) Índices ------------------------------------------------------------------
create index if not exists idx_decl_balances_company on public.declaraciones_balances(company_id, anio);
create index if not exists idx_decl_periods_company on public.tax_declaration_periods(company_id, anio, mes);

-- 5) Permisos -----------------------------------------------------------------
grant select, insert, update, delete on public.declaraciones_balances to authenticated;
grant select, insert, update, delete on public.tax_declaration_periods to authenticated;
