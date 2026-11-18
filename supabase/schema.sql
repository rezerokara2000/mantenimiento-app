-- =====================================================================
-- Gestión de Mantenimiento: esquema Supabase / PostgreSQL
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

create extension if not exists "pgcrypto";

-- 1) Tipos de evento ----------------------------------------------------
create table if not exists public.event_types (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

insert into public.event_types (name)
values ('Limabar'), ('Evento')
on conflict (name) do nothing;

-- 2) Eventos ------------------------------------------------------------
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  location      text not null,
  event_date    date not null,
  end_date      date not null,
  event_type_id uuid references public.event_types(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.events add column if not exists end_date date;
update public.events set end_date = event_date where end_date is null;
alter table public.events alter column end_date set not null;
create index if not exists events_date_idx on public.events (event_date);

-- 3) Personal (solo first_name es obligatorio) ------------------------
create table if not exists public.staff (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text,
  dni         text,
  age         int check (age is null or (age between 14 and 100)),
  affiliation text,
  is_active   boolean not null default true
);
-- DNI único solo cuando se ingresa (los NULL no chocan entre sí)
create unique index if not exists staff_dni_unique
  on public.staff (dni) where dni is not null and dni <> '';

-- 4) Asignaciones / asistencia -------------------------------------------
create table if not exists public.event_assignments (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.events(id) on delete cascade,
  event_day date not null,
  staff_id  uuid not null references public.staff(id)  on delete cascade,
  shift     text not null check (shift in ('DIA', 'NOCHE')),
  attended  boolean not null default false,
  status    text not null default 'FALTA' check (status in ('ASISTIO', 'FALTA', 'VACACIONES')),
  notes     text,
  -- una persona puede aparecer una vez por turno y fecha del evento
  constraint event_assignments_event_day_unique unique (event_id, event_day, staff_id, shift)
);
alter table public.event_assignments add column if not exists event_day date;
update public.event_assignments a
set event_day = e.event_date
from public.events e
where a.event_id = e.id and a.event_day is null;
alter table public.event_assignments alter column event_day set not null;

-- Actualiza instalaciones existentes sin cambiar los datos históricos de asistencia.
alter table public.event_assignments add column if not exists status text;
update public.event_assignments
set status = case when attended then 'ASISTIO' else 'FALTA' end
where status is null;
alter table public.event_assignments alter column status set default 'FALTA';
alter table public.event_assignments alter column status set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_assignments_status_check'
      and conrelid = 'public.event_assignments'::regclass
  ) then
    alter table public.event_assignments
      add constraint event_assignments_status_check
      check (status in ('ASISTIO', 'FALTA', 'VACACIONES'));
  end if;
end $$;
alter table public.event_assignments
  drop constraint if exists event_assignments_event_id_staff_id_shift_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_assignments_event_day_unique'
      and conrelid = 'public.event_assignments'::regclass
  ) then
    alter table public.event_assignments
      add constraint event_assignments_event_day_unique
      unique (event_id, event_day, staff_id, shift);
  end if;
end $$;
create index if not exists assignments_event_idx on public.event_assignments (event_id);
create index if not exists assignments_staff_idx on public.event_assignments (staff_id);

-- 5) Seguridad (RLS) ------------------------------------------------------
-- IMPORTANTE: estas políticas permiten acceso total a quien tenga la anon key.
-- Es un punto de partida para uso interno. Para producción, agrega
-- Supabase Auth y reemplaza "anon" por "authenticated".
alter table public.event_types       enable row level security;
alter table public.events            enable row level security;
alter table public.staff             enable row level security;
alter table public.event_assignments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['event_types','events','staff','event_assignments'] loop
    execute format('drop policy if exists "acceso_total_%1$s" on public.%1$s', t);
    execute format(
      'create policy "acceso_total_%1$s" on public.%1$s for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;
