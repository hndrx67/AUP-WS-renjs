-- Run once after schema.sql. Establishes tuition balances and an auditable
-- transfer ledger. Existing payouts are kept as settled legacy withdrawals.

alter table public.profiles
  add column if not exists school_tuition_balance numeric(10,2) not null default 0 check (school_tuition_balance >= 0),
  add column if not exists financials_started_at timestamptz not null default now(),
  add column if not exists personal_wallet_opening_balance numeric(10,2) not null default 0 check (personal_wallet_opening_balance >= 0);

-- Lock the applicable rate when a time record is completed so later rate
-- changes do not rewrite already earned tuition credit.
alter table public.time_logs add column if not exists earning_rate numeric(8,2);
update public.time_logs t
set earning_rate = p.hourly_rate
from public.profiles p
where p.id = t.student_id and t.time_out is not null and t.earning_rate is null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payouts' and column_name = 'legacy_wallet_settled'
  ) then
    alter table public.payouts add column legacy_wallet_settled boolean not null default true;
    alter table public.payouts alter column legacy_wallet_settled set default false;
  end if;
end;
$$;

create or replace function public.capture_time_log_earning_rate()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.time_out is not null and new.earning_rate is null then
    select hourly_rate into new.earning_rate from public.profiles where id = new.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists time_logs_capture_earning_rate on public.time_logs;
create trigger time_logs_capture_earning_rate
  before insert or update on public.time_logs
  for each row execute function public.capture_time_log_earning_rate();

-- Existing payouts were paid under the previous earned-minus-payout model.
-- Seed an equal opening wallet amount so these historic withdrawals remain settled.
update public.profiles p
set personal_wallet_opening_balance = coalesce(x.total_paid, 0)
from (
  select student_id, sum(amount) as total_paid
  from public.payouts
  where legacy_wallet_settled = true
  group by student_id
) x
where p.id = x.student_id;

create table if not exists public.wallet_transfers (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  note text,
  allocated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists wallet_transfers_student_idx on public.wallet_transfers(student_id, allocated_at desc);

alter table public.wallet_transfers enable row level security;
drop policy if exists "wallet transfers: read" on public.wallet_transfers;
create policy "wallet transfers: read" on public.wallet_transfers
  for select to authenticated using (
    student_id = auth.uid()
    or public.is_my_dept_student(student_id)
    or public.get_my_role() = 'admin'
  );

create or replace function public.allocate_student_wallet(
  p_student_id uuid, p_amount numeric, p_note text, p_actor_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_student public.profiles%rowtype;
  v_actor public.profiles%rowtype;
  v_earned numeric;
  v_transferred numeric;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'Enter an amount greater than zero with up to two decimals'; end if;
  select * into v_actor from public.profiles where id = p_actor_id and is_active;
  if not found or v_actor.role not in ('admin', 'supervisor') then raise exception 'Not authorized'; end if;
  select * into v_student from public.profiles where id = p_student_id and role = 'student' for update;
  if not found then raise exception 'Student not found'; end if;
  if v_actor.role = 'supervisor' and (v_actor.department_id is null or v_student.department_id is null or v_student.department_id <> v_actor.department_id) then
    raise exception 'Student is outside your department';
  end if;

  select coalesce(sum(greatest(0, extract(epoch from (t.time_out - greatest(t.time_in, v_student.financials_started_at))) / 3600 * coalesce(t.earning_rate, v_student.hourly_rate))), 0)
    into v_earned from public.time_logs t
    where t.student_id = p_student_id and t.time_out is not null and t.time_out > v_student.financials_started_at;
  select coalesce(sum(w.amount), 0) into v_transferred
    from public.wallet_transfers w where w.student_id = p_student_id and w.allocated_at >= v_student.financials_started_at;

  if p_amount > greatest(0, v_earned - v_student.school_tuition_balance - v_transferred) then
    raise exception 'Allocation exceeds the available tuition credit';
  end if;

  insert into public.wallet_transfers(student_id, amount, note, created_by)
  values (p_student_id, p_amount, nullif(btrim(p_note), ''), p_actor_id);
end;
$$;

create or replace function public.record_student_withdrawal(
  p_student_id uuid, p_amount numeric, p_note text, p_actor_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_student public.profiles%rowtype;
  v_actor public.profiles%rowtype;
  v_wallet numeric;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'Enter an amount greater than zero with up to two decimals'; end if;
  select * into v_actor from public.profiles where id = p_actor_id and is_active;
  if not found or v_actor.role not in ('admin', 'supervisor') then raise exception 'Not authorized'; end if;
  select * into v_student from public.profiles where id = p_student_id and role = 'student' for update;
  if not found then raise exception 'Student not found'; end if;
  if v_actor.role = 'supervisor' and (v_actor.department_id is null or v_student.department_id is null or v_student.department_id <> v_actor.department_id) then
    raise exception 'Student is outside your department';
  end if;

  select v_student.personal_wallet_opening_balance
       + coalesce((select sum(w.amount) from public.wallet_transfers w where w.student_id = p_student_id), 0)
       - coalesce((select sum(p.amount) from public.payouts p where p.student_id = p_student_id), 0)
    into v_wallet;
  if p_amount > v_wallet then raise exception 'Withdrawal exceeds the available personal wallet balance'; end if;

  insert into public.payouts(student_id, amount, note, created_by)
  values (p_student_id, p_amount, nullif(btrim(p_note), ''), p_actor_id);
end;
$$;

create or replace function public.set_student_tuition_balance(
  p_student_id uuid, p_amount numeric, p_actor_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_student public.profiles%rowtype;
  v_actor public.profiles%rowtype;
begin
  if p_amount is null or p_amount < 0 or p_amount <> round(p_amount, 2) then raise exception 'Tuition balance must be zero or more, with up to two decimals'; end if;
  select * into v_actor from public.profiles where id = p_actor_id and is_active;
  if not found or v_actor.role not in ('admin', 'supervisor') then raise exception 'Not authorized'; end if;
  select * into v_student from public.profiles where id = p_student_id and role = 'student' for update;
  if not found then raise exception 'Student not found'; end if;
  if v_actor.role = 'supervisor' and (v_actor.department_id is null or v_student.department_id is null or v_student.department_id <> v_actor.department_id) then
    raise exception 'Student is outside your department';
  end if;

  update public.profiles
  set school_tuition_balance = p_amount, financials_started_at = now()
  where id = p_student_id;
end;
$$;

create or replace function public.delete_student_withdrawal(p_payout_id uuid, p_actor_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles%rowtype;
  v_student public.profiles%rowtype;
  v_payout public.payouts%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_id and is_active;
  if not found or v_actor.role <> 'admin' then raise exception 'Only administrators can delete withdrawals'; end if;
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  select * into v_student from public.profiles where id = v_payout.student_id for update;
  if found and v_payout.legacy_wallet_settled then
    update public.profiles
    set personal_wallet_opening_balance = greatest(0, personal_wallet_opening_balance - v_payout.amount)
    where id = v_student.id;
  end if;
  delete from public.payouts where id = p_payout_id;
end;
$$;

revoke all on function public.allocate_student_wallet(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.record_student_withdrawal(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.set_student_tuition_balance(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.delete_student_withdrawal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.allocate_student_wallet(uuid, numeric, text, uuid) to service_role;
grant execute on function public.record_student_withdrawal(uuid, numeric, text, uuid) to service_role;
grant execute on function public.set_student_tuition_balance(uuid, numeric, uuid) to service_role;
grant execute on function public.delete_student_withdrawal(uuid, uuid) to service_role;
