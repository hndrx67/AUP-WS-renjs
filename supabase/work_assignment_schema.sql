-- Adds the student's work assignment/position shown to department members.
alter table public.profiles
  add column if not exists work_assignment text;
