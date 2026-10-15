-- ============================================================================
-- FICA Portal — Esquema de base de datos (Supabase)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1. Supabase Dashboard -> SQL Editor -> New query
--   2. Pega TODO este contenido y pulsa "Run".
--   3. (Opcional) Después de crear el usuario admin, ejecuta el bloque
--      "PROMOVER SUPERADMIN" que está al final.
-- ============================================================================

-- 1) Tabla de empresas -------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ruc text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2) Tabla de perfiles (1:1 con auth.users) ---------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  role text not null default 'secondary' check (role in ('superadmin','secondary')),
  permissions text[] not null default '{}',
  companies uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3) Trigger: crea el perfil automáticamente al crearse un usuario -----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email, 'secondary')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Helper: ¿el usuario autenticado es superadmin? --------------------------
create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin' and active = true
  );
$$;

-- 5) Políticas de seguridad (RLS) -------------------------------------------
alter table public.companies enable row level security;
alter table public.profiles enable row level security;

-- Empresas: lectura (superadmin ve todas; el secundario solo las suyas activas)
drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies
  for select using (
    public.is_superadmin()
    or (
      active = true
      and id in ( select unnest(companies) from public.profiles where id = auth.uid() )
    )
  );

-- Empresas: solo el superadmin escribe
drop policy if exists "companies_insert" on public.companies;
create policy "companies_insert" on public.companies for insert with check (public.is_superadmin());
drop policy if exists "companies_update" on public.companies;
create policy "companies_update" on public.companies for update using (public.is_superadmin());
drop policy if exists "companies_delete" on public.companies;
create policy "companies_delete" on public.companies for delete using (public.is_superadmin());

-- Perfiles: cada usuario ve el suyo; el superadmin ve todos
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (public.is_superadmin() or id = auth.uid());

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert with check (public.is_superadmin() or id = auth.uid());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (public.is_superadmin() or id = auth.uid());

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles
  for delete using (public.is_superadmin());

-- 6) Semilla: empresa inicial (editable desde el panel) ----------------------
insert into public.companies (name, ruc)
select 'A y F FICA Asociados S.A.C.', '20123456789'
where not exists (select 1 from public.companies);

-- ============================================================================
-- PROMOVER SUPERADMIN
-- ----------------------------------------------------------------------------
-- Después de crear el usuario admin en: Dashboard -> Authentication -> Users
-- -> Add user (correo admin@ayffica.com), ejecuta esto para darle rol total:
-- ============================================================================
-- update public.profiles
-- set role = 'superadmin', active = true, name = 'Administrador Principal'
-- where id = (select id from auth.users where email = 'admin@ayffica.com');
