-- ============================================================================
-- FICA Portal — Credenciales de API SUNAT (módulo SIRE)
-- ----------------------------------------------------------------------------
-- Guarda, por empresa, las credenciales del Servicio Web API del SIRE SUNAT.
-- NO se expone al navegador: RLS sin políticas => solo el service role (la
-- Edge Function sunat-sire) puede leer/escribir estas credenciales.
-- ----------------------------------------------------------------------------
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> Run.
-- ============================================================================

create table if not exists public.sunat_credentials (
  company_id uuid primary key references public.companies(id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  username text not null,   -- RUC del contribuyente
  password text not null,   -- Clave SOL
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS sin políticas: ni anon ni authenticated pueden acceder. Solo el service
-- role (supabaseAdmin) dentro de la Edge Function lee/escribe.
alter table public.sunat_credentials enable row level security;

create or replace function public.touch_sunat_credentials()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_sunat_credentials on public.sunat_credentials;
create trigger trg_touch_sunat_credentials
  before update on public.sunat_credentials
  for each row execute function public.touch_sunat_credentials();
