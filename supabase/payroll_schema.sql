-- ============================================================================
-- FICA Portal — Esquema de PLANILLAS en Supabase
-- ----------------------------------------------------------------------------
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query.
-- Crea las tablas de planillas con aislamiento por EMPRESA (company_id) y RLS.
-- Es idempotente (se puede volver a ejecutar).
-- ============================================================================

-- Helper: ¿el usuario autenticado puede acceder a esta empresa? ---------------
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

-- 1) Colaboradores ----------------------------------------------------------
create table if not exists public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text,
  doc_type text,
  doc_number text,
  name text not null,
  start_date date,
  position text,
  base_salary numeric not null default 0,
  pension_type text not null default 'ONP',
  afp text,
  cuspp text,
  bank_name text,
  bank_account text,
  bank_cci text,
  contract_type text default 'indeterminado',
  contract_end date,
  asignacion_familiar boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2) Períodos (planilla mensual) --------------------------------------------
create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  year int not null,
  month int not null,
  closed boolean not null default false,
  rows jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (company_id, year, month)
);

-- 3) Asistencias ------------------------------------------------------------
create table if not exists public.payroll_attendance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  date date,
  entry text,
  exit_time text,
  tardiness_minutes int not null default 0,
  extra_minutes int not null default 0,
  type text not null default 'normal',
  with_pay boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

-- 4) Vacaciones -------------------------------------------------------------
create table if not exists public.payroll_vacations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  period text,
  days_taken numeric not null default 0,
  date_from date,
  date_to date,
  month_year text,
  note text,
  created_at timestamptz not null default now()
);

-- 5) Liquidaciones (LBS) ----------------------------------------------------
create table if not exists public.payroll_liquidations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid,
  employee_name text,
  fecha_cese date,
  motivo text,
  bruto numeric not null default 0,
  neto numeric not null default 0,
  created_at timestamptz not null default now()
);

-- 6) Estado tributario por período -----------------------------------------
create table if not exists public.payroll_tax_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  year int not null,
  month int not null,
  state text not null default 'pendiente',
  unique (company_id, year, month)
);

-- RLS -----------------------------------------------------------------------
alter table public.payroll_employees enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_attendance enable row level security;
alter table public.payroll_vacations enable row level security;
alter table public.payroll_liquidations enable row level security;
alter table public.payroll_tax_state enable row level security;

-- Políticas por empresa (acceso si el usuario tiene acceso a esa empresa) ----
drop policy if exists "payroll_employees_all" on public.payroll_employees;
create policy "payroll_employees_all" on public.payroll_employees
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

drop policy if exists "payroll_periods_all" on public.payroll_periods;
create policy "payroll_periods_all" on public.payroll_periods
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

drop policy if exists "payroll_attendance_all" on public.payroll_attendance;
create policy "payroll_attendance_all" on public.payroll_attendance
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

drop policy if exists "payroll_vacations_all" on public.payroll_vacations;
create policy "payroll_vacations_all" on public.payroll_vacations
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

drop policy if exists "payroll_liquidations_all" on public.payroll_liquidations;
create policy "payroll_liquidations_all" on public.payroll_liquidations
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

drop policy if exists "payroll_tax_state_all" on public.payroll_tax_state;
create policy "payroll_tax_state_all" on public.payroll_tax_state
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

-- Índices -------------------------------------------------------------------
create index if not exists idx_payroll_employees_company on public.payroll_employees(company_id);
create index if not exists idx_payroll_attendance_company on public.payroll_attendance(company_id);
create index if not exists idx_payroll_vacations_company on public.payroll_vacations(company_id);
create index if not exists idx_payroll_liquidations_company on public.payroll_liquidations(company_id);

-- ============================================================================
-- ADICIONES: régimen laboral (MYPE), cese, bonificaciones y pagos/adelantos
-- ============================================================================

-- Régimen laboral de la empresa: 'general' | 'microempresa' (Ley MYPE)
alter table public.companies
  add column if not exists regimen_laboral text not null default 'general';

-- Fecha de cese del colaborador (fin de vínculo laboral)
alter table public.payroll_employees
  add column if not exists cese date;

-- Tipo de comisión AFP del afiliado: 'flujo' | 'mixta'
alter table public.payroll_employees
  add column if not exists commission_type text default 'flujo';

-- Salud del trabajador: 'ESSALUD' | 'EPS' (define la bonificación extraordinaria 9% vs 6.75%)
alter table public.payroll_employees
  add column if not exists salud text default 'ESSALUD';

-- Bonificaciones / ingresos adicionales del mes
create table if not exists public.payroll_bonuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  year int not null,
  month int not null,
  tipo text not null default 'regular',   -- 'regular' (afecta) | 'extraordinaria' (no afecta)
  concepto text,
  monto numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.payroll_bonuses
  add column if not exists tipo text not null default 'regular';

-- Control de pagos: pagos de conceptos, adelantos y préstamos (descuentos)
create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  year int not null,
  month int not null,
  tipo text not null default 'adelanto',   -- 'pago_concepto' | 'adelanto' | 'prestamo'
  concepto text,
  monto numeric not null default 0,
  comprobante text,
  created_at timestamptz not null default now()
);

alter table public.payroll_bonuses enable row level security;
alter table public.payroll_payments enable row level security;

drop policy if exists "payroll_bonuses_all" on public.payroll_bonuses;
create policy "payroll_bonuses_all" on public.payroll_bonuses
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

drop policy if exists "payroll_payments_all" on public.payroll_payments;
create policy "payroll_payments_all" on public.payroll_payments
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

create index if not exists idx_payroll_bonuses_company on public.payroll_bonuses(company_id);
create index if not exists idx_payroll_payments_company on public.payroll_payments(company_id);

-- ============================================================================
-- PARÁMETROS AFP por mes (globales; los publica la SBS cada mes)
-- ============================================================================
create table if not exists public.afp_rates (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null,
  afp text not null,
  comision_flujo numeric not null default 0,
  comision_saldo numeric not null default 0,
  prima_seguro numeric not null default 0,
  aporte_obligatorio numeric not null default 0.1,
  rem_max_asegurable numeric not null default 12732.70,
  updated_at timestamptz not null default now(),
  unique (year, month, afp)
);

alter table public.afp_rates enable row level security;

-- Lectura: cualquier usuario autenticado (son parámetros públicos)
drop policy if exists "afp_rates_select" on public.afp_rates;
create policy "afp_rates_select" on public.afp_rates for select using (auth.uid() is not null);

-- Escritura: solo el superadministrador
drop policy if exists "afp_rates_write" on public.afp_rates;
create policy "afp_rates_write" on public.afp_rates
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ============================================================================
-- PARÁMETROS LEGALES POR AÑO (UIT y RMV) — globales
-- ============================================================================
create table if not exists public.payroll_params (
  year integer primary key,
  uit numeric,
  rmv numeric,
  updated_at timestamptz not null default now()
);

alter table public.payroll_params enable row level security;

-- Lectura: cualquier usuario autenticado (parámetros públicos)
drop policy if exists "payroll_params_select" on public.payroll_params;
create policy "payroll_params_select" on public.payroll_params
  for select using (auth.uid() is not null);

-- Escritura: solo el superadministrador
drop policy if exists "payroll_params_write" on public.payroll_params;
create policy "payroll_params_write" on public.payroll_params
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ============================================================================
-- GRATIFICACIONES registradas (julio/diciembre) — van en planilla aparte
-- ============================================================================
create table if not exists public.payroll_gratificaciones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  year int not null,
  month int not null,          -- 7 (julio) o 12 (diciembre)
  monto numeric not null default 0,
  bonificacion numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, employee_id, year, month)
);

alter table public.payroll_gratificaciones enable row level security;

drop policy if exists "payroll_gratificaciones_all" on public.payroll_gratificaciones;
create policy "payroll_gratificaciones_all" on public.payroll_gratificaciones
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

create index if not exists idx_payroll_gratificaciones_company on public.payroll_gratificaciones(company_id);

-- ============================================================================
-- PRÉSTAMOS con cuotas — se descuentan automáticamente en la planilla
-- ============================================================================
create table if not exists public.payroll_loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  descripcion text,
  monto numeric not null default 0,
  n_cuotas int not null default 1 check (n_cuotas > 0),
  start_year int not null,
  start_month int not null check (start_month between 1 and 12),
  created_at timestamptz not null default now()
);

alter table public.payroll_loans enable row level security;

drop policy if exists "payroll_loans_all" on public.payroll_loans;
create policy "payroll_loans_all" on public.payroll_loans
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

create index if not exists idx_payroll_loans_company on public.payroll_loans(company_id);
create index if not exists idx_payroll_loans_employee on public.payroll_loans(employee_id);

-- ============================================================================
-- HORARIOS DE TRABAJO por rango de fechas — base para tardanzas y horas extras
-- ============================================================================
-- Marca si el registro de asistencia usa minutos manuales (true) o los
-- calcula automáticamente contra el horario vigente (false).
-- Se ejecuta una sola vez: si la columna ya existe, no vuelve a migrar.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payroll_attendance'
       and column_name = 'manual'
  ) then
    alter table public.payroll_attendance
      add column manual boolean not null default false;

    -- Los registros creados antes de los horarios automáticos tenían minutos
    -- de tardanza/extra ingresados a mano: se conservan como ajuste manual
    -- para que el nuevo cálculo automático no los ponga en cero.
    update public.payroll_attendance
       set manual = true
     where tardiness_minutes > 0 or extra_minutes > 0;
  end if;
end $$;

create table if not exists public.payroll_work_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  entry_time time not null,
  exit_time time not null,
  break_minutes int not null default 0 check (break_minutes >= 0),
  work_days int[] not null default '{1,2,3,4,5}'::int[],
  tolerance_minutes int not null default 0 check (tolerance_minutes >= 0),
  round_minutes int not null default 1 check (round_minutes in (1, 5, 10, 15, 30)),
  tardiness_enabled boolean not null default true,
  overtime_enabled boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  constraint payroll_work_schedules_range check (effective_to is null or effective_to >= effective_from),
  constraint payroll_work_schedules_days check (work_days <@ ARRAY[1,2,3,4,5,6,7]::int[])
);

alter table public.payroll_work_schedules enable row level security;

drop policy if exists "payroll_work_schedules_all" on public.payroll_work_schedules;
create policy "payroll_work_schedules_all" on public.payroll_work_schedules
  for all using (public.can_access_company(company_id)) with check (public.can_access_company(company_id));

create index if not exists idx_payroll_work_schedules_company
  on public.payroll_work_schedules(company_id, effective_from);
