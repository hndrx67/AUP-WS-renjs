-- Run once after schema.sql to enable editable account profiles.
alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists avatar_path text,
  add column if not exists cover_path text;
