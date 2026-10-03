-- AUP Work Scholars: database schema, row level security and helpers.
-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor > New query).

create extension if not exists "pgcrypto";

create type public.user_role as enum ('student', 'supervisor', 'admin');

-- Tables -------------------------------------------------------------------

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.user_role not null default 'student',
  department_id uuid references public.departments(id) on delete set null,
  student_id text,
  work_assignment text,
  hourly_rate numeric(8,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index profiles_department_idx on public.profiles(department_id);
create index profiles_role_idx on public.profiles(role);

create table public.time_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  time_in timestamptz not null default now(),
  time_out timestamptz,
  note text,
  overridden_by uuid references public.profiles(id) on delete set null,
  override_reason text,
  created_at timestamptz not null default now(),
  constraint time_out_after_in check (time_out is null or time_out >= time_in)
);
create index time_logs_student_idx on public.time_logs(student_id, time_in desc);
-- A student can only have one open (not yet clocked out) log at a time.
create unique index time_logs_one_open_per_student
  on public.time_logs(student_id) where time_out is null;

-- Weekly recurring schedule. day_of_week: 0 = Sunday ... 6 = Saturday
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  label text,
  created_at timestamptz not null default now(),
  constraint schedule_end_after_start check (end_time > start_time)
);
create index schedules_student_idx on public.schedules(student_id);

-- Payments made to a student. Balance = earned - payouts.
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  note text,
  paid_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create index payouts_student_idx on public.payouts(student_id, paid_at desc);

-- Helper functions (security definer so RLS policies can use them safely) ----

create or replace function public.get_my_role()
returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.get_my_department()
returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid()
$$;

-- True when the caller is a supervisor and the given student is in their department.
create or replace function public.is_my_dept_student(sid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me, public.profiles s
    where me.id = auth.uid()
      and me.role = 'supervisor'
      and s.id = sid
      and s.role = 'student'
      and s.department_id is not null
      and s.department_id = me.department_id
  )
$$;

-- New auth users always start as an unassigned student. Roles and departments
-- are set afterwards by the server using the service role key, never from
-- client supplied metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Students can only clock in "now" and clock out "now". Admins can edit freely.
create or replace function public.enforce_student_clock()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_role() = 'student' then
    if tg_op = 'INSERT' then
      new.time_in := now();
      new.time_out := null;
      new.overridden_by := null;
      new.override_reason := null;
    else
      if new.student_id <> old.student_id or new.time_in <> old.time_in then
        raise exception 'Students cannot change recorded times';
      end if;
      new.time_out := now();
      new.overridden_by := old.overridden_by;
      new.override_reason := old.override_reason;
    end if;
  end if;
  return new;
end;
$$;

create trigger time_logs_enforce_student_clock
  before insert or update on public.time_logs
  for each row execute function public.enforce_student_clock();

-- Row level security ---------------------------------------------------------

alter table public.departments enable row level security;
alter table public.profiles    enable row level security;
alter table public.time_logs   enable row level security;
alter table public.schedules   enable row level security;
alter table public.payouts     enable row level security;

-- departments
create policy "departments: read" on public.departments
  for select to authenticated using (true);
create policy "departments: admin write" on public.departments
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- profiles
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles: supervisor reads department students" on public.profiles
  for select to authenticated using (public.is_my_dept_student(id));
create policy "profiles: admin all" on public.profiles
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- time_logs
create policy "time_logs: read" on public.time_logs
  for select to authenticated using (
    student_id = auth.uid()
    or public.is_my_dept_student(student_id)
    or public.get_my_role() = 'admin'
  );
create policy "time_logs: student clock in" on public.time_logs
  for insert to authenticated
  with check (student_id = auth.uid() and public.get_my_role() = 'student');
create policy "time_logs: student clock out" on public.time_logs
  for update to authenticated
  using (student_id = auth.uid() and time_out is null and public.get_my_role() = 'student')
  with check (student_id = auth.uid());
create policy "time_logs: admin all" on public.time_logs
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- schedules
create policy "schedules: read" on public.schedules
  for select to authenticated using (
    student_id = auth.uid()
    or public.is_my_dept_student(student_id)
    or public.get_my_role() = 'admin'
  );
create policy "schedules: supervisor write" on public.schedules
  for all to authenticated
  using (public.is_my_dept_student(student_id))
  with check (public.is_my_dept_student(student_id));
create policy "schedules: admin all" on public.schedules
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- payouts
create policy "payouts: read" on public.payouts
  for select to authenticated using (
    student_id = auth.uid()
    or public.is_my_dept_student(student_id)
    or public.get_my_role() = 'admin'
  );
create policy "payouts: admin write" on public.payouts
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- Creating your first administrator --------------------------------------------
-- 1. Dashboard > Authentication > Users > Add user (email + password, auto confirm).
-- 2. Run:  update public.profiles set role = 'admin' where email = 'you@example.com';
