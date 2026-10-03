-- AUP Work Scholars: seed the first administrator account.
-- Run AFTER supabase/schema.sql, in the Supabase SQL editor.
-- Safe to run again: if the email already exists it is only promoted to admin
-- (the password is NOT changed in that case).

do $$
declare
  -- >>> EDIT THESE THREE VALUES BEFORE RUNNING <<<
  v_email     text := 'redacted';
  v_password  text := 'redacted';
  v_full_name text := 'redacted';
  -- >>> -------------------------------------- <<<

  v_user_id uuid;
begin
  if v_email like 'CHANGE_ME%' or v_password like 'CHANGE_ME%' then
    raise exception 'Edit v_email and v_password at the top of this script first.';
  end if;
  if length(v_password) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;

  v_email := lower(trim(v_email));
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', v_full_name),
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text, 'email',
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      now(), now(), now()
    );
  end if;

  -- The on_auth_user_created trigger from schema.sql creates the profile as a student.
  -- Promote it to administrator.
  update public.profiles
     set role = 'admin',
         full_name = case when full_name = split_part(v_email, '@', 1) then v_full_name else full_name end,
         department_id = null,
         is_active = true
   where id = v_user_id;

  if not found then
    raise exception 'No profile row exists for %. Did you run schema.sql first?', v_email;
  end if;

  raise notice 'Administrator ready: %', v_email;
end $$;
