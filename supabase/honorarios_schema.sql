-- ============================================================================
-- FICA Portal — Módulo Recibos por Honorarios Electrónicos (RHE / PDT 601)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1) Supabase Dashboard -> SQL Editor -> New query
--   2) Pega TODO este contenido y pulsa "Run".
--   3) Recarga el portal con Ctrl+Shift+R.
-- Crea las tablas de importación del TXT de "Consulta Receptor de Recibos por
-- Honorarios Electrónicos" de SUNAT, la maestra concepto -> cuenta PCGE y la
-- configuración del asiento mensual. Es idempotente.
-- El RUC del nombre del PDT se toma de la EMPRESA ACTIVA (no del emisor).
-- ============================================================================

create table if not exists public.honorarios_recibos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  fecha_emision date,
  tipo_doc_emitido text,
  nro_doc_emitido text,
  estado_doc text,
  anulado boolean not null default false,

  tipo_doc_emisor text,
  doc_tipo_codigo text not null default '06',
  doc_numero text,
  emisor_nombre text,
  tipo_renta text,
  gratuito text,
  descripcion text,
  observacion text,
  moneda text not null default 'PEN',

  -- Importes en la moneda original del TXT.
  renta_bruta numeric(14,2),
  impuesto_renta numeric(14,2),
  renta_neta numeric(14,2),
  pendiente_pago numeric(14,2),

  -- Importes solarizados (PEN) para PDT y asiento contable.
  renta_bruta_pen numeric(14,2),
  impuesto_renta_pen numeric(14,2),
  renta_neta_pen numeric(14,2),
  tc numeric(12,4),
  tc_fecha date,

  indicador_retencion integer not null default 0,
  fecha_pago date,
  serie text,
  numero text,
  cuenta_gasto text,
  cuenta_gasto_nombre text,

  raw jsonb not null default '{}'::jsonb,
  source text not null default 'sunat_rhe',
  source_file text,
  import_batch_id uuid,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (company_id, dedupe_key)
);

create table if not exists public.honorarios_conceptos_cuentas (
  company_id uuid not null references public.companies(id) on delete cascade,
  concepto text not null,
  cuenta_gasto text not null,
  denominacion text,
  palabras_clave text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (company_id, concepto)
);

create table if not exists public.honorarios_asiento_config (
  company_id uuid primary key references public.companies(id) on delete cascade,
  cuenta_retencion text not null default '40173',
  cuenta_pago text not null default '4111',
  updated_at timestamptz not null default now()
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

alter table public.honorarios_recibos enable row level security;
alter table public.honorarios_conceptos_cuentas enable row level security;
alter table public.honorarios_asiento_config enable row level security;

drop policy if exists "honorarios_recibos_all" on public.honorarios_recibos;
create policy "honorarios_recibos_all" on public.honorarios_recibos
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

drop policy if exists "honorarios_conceptos_cuentas_all" on public.honorarios_conceptos_cuentas;
create policy "honorarios_conceptos_cuentas_all" on public.honorarios_conceptos_cuentas
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

drop policy if exists "honorarios_asiento_config_all" on public.honorarios_asiento_config;
create policy "honorarios_asiento_config_all" on public.honorarios_asiento_config
  for all using (public.can_access_company(company_id))
  with check (public.can_access_company(company_id));

-- Índices ------------------------------------------------------------------
create index if not exists idx_honorarios_recibos_company_fecha
  on public.honorarios_recibos(company_id, fecha_emision);
create index if not exists idx_honorarios_recibos_company_dedupe
  on public.honorarios_recibos(company_id, dedupe_key);
create index if not exists idx_honorarios_recibos_company_source_file
  on public.honorarios_recibos(company_id, source_file);
create index if not exists idx_honorarios_conceptos_company
  on public.honorarios_conceptos_cuentas(company_id, concepto);

-- Trigger updated_at -------------------------------------------------------
create or replace function public.touch_honorarios_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_honorarios_recibos on public.honorarios_recibos;
create trigger trg_touch_honorarios_recibos
  before update on public.honorarios_recibos
  for each row execute function public.touch_honorarios_updated_at();

drop trigger if exists trg_touch_honorarios_conceptos on public.honorarios_conceptos_cuentas;
create trigger trg_touch_honorarios_conceptos
  before update on public.honorarios_conceptos_cuentas
  for each row execute function public.touch_honorarios_updated_at();

drop trigger if exists trg_touch_honorarios_config on public.honorarios_asiento_config;
create trigger trg_touch_honorarios_config
  before update on public.honorarios_asiento_config
  for each row execute function public.touch_honorarios_updated_at();

-- Permisos -----------------------------------------------------------------
grant select, insert, update, delete on public.honorarios_recibos to authenticated;
grant select, insert, update, delete on public.honorarios_conceptos_cuentas to authenticated;
grant select, insert, update, delete on public.honorarios_asiento_config to authenticated;

-- No se siembran filas: la lista de conceptos -> cuenta PCGE se entrega como
-- valores genéricos editables desde la propia interfaz (6241 legales, 6242
-- auditoría, 6243 consultoría, 6251 capacitación, 6291 otros servicios).
