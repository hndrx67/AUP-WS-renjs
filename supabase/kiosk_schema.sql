-- Install after schema.sql to enable the unauthenticated shared time clock.
-- The app calls this function with the server-only service role client.

create or replace function public.kiosk_toggle_time(p_student_id text)
returns table (
  student_name text,
  student_number text,
  action text,
  time_in timestamptz,
  time_out timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_log public.time_logs%rowtype;
  v_matches integer;
  v_action text;
begin
  if p_student_id is null or btrim(p_student_id) = '' then
    raise exception 'Student ID is required';
  end if;

  select count(*) into v_matches
  from public.profiles p
  where p.student_id = btrim(p_student_id)
    and p.role = 'student'
    and p.is_active = true;

  if v_matches = 0 then
    raise exception 'No active student found';
  elsif v_matches > 1 then
    raise exception 'Student ID is not unique';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.student_id = btrim(p_student_id)
    and p.role = 'student'
    and p.is_active = true
  for update;

  select t.* into v_log
  from public.time_logs t
  where t.student_id = v_profile.id
    and t.time_out is null
  for update;

  if found then
    update public.time_logs t
    set time_out = now()
    where t.id = v_log.id
    returning t.* into v_log;
    v_action := 'clocked_out';
  else
    insert into public.time_logs (student_id, time_in)
    values (v_profile.id, now())
    returning * into v_log;
    v_action := 'clocked_in';
  end if;

  return query select v_profile.full_name, v_profile.student_id, v_action, v_log.time_in, v_log.time_out;
end;
$$;

revoke all on function public.kiosk_toggle_time(text) from public, anon, authenticated;
grant execute on function public.kiosk_toggle_time(text) to service_role;
