-- Household Task Manager — Supabase schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)

create extension if not exists "pgcrypto";

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  avatar_color text not null default '#7F77DD',
  pin text,                          -- optional 4-digit PIN for kid profiles
  is_kid boolean not null default false,
  points integer not null default 0,
  theme text not null default 'bold',
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  notes text,
  category text not null default 'chore',      -- chore | task
  assigned_to uuid references members(id) on delete set null,
  created_by uuid references members(id) on delete set null,
  due_date date,
  due_time time,
  recurrence text not null default 'none',      -- none | daily | weekly | weekdays
  remind_before text not null default 'none',   -- none | 5m | 30m | 1h | 2h | 1d
  points integer not null default 10,
  status text not null default 'pending',       -- pending | done
  completed_at timestamptz,
  completed_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table task_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  task_id uuid,
  title text not null,
  member_id uuid,
  member_name text,
  action text not null,               -- completed | created | deleted
  points integer not null default 0,
  occurred_at timestamptz not null default now()
);

-- Row Level Security: a signed-in parent can only see/edit rows in
-- households where they have a member row with auth_user_id = auth.uid()
alter table households enable row level security;
alter table members enable row level security;
alter table tasks enable row level security;
alter table task_history enable row level security;

create or replace function my_household_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select household_id from members where auth_user_id = auth.uid();
$$;

create policy "select own household" on households
  for select using (id in (select my_household_ids()));
create policy "update own household" on households
  for update using (id in (select my_household_ids()));

create policy "select household members" on members
  for select using (household_id in (select my_household_ids()));
create policy "insert household members" on members
  for insert with check (household_id in (select my_household_ids()));
create policy "update household members" on members
  for update using (household_id in (select my_household_ids()));
create policy "delete household members" on members
  for delete using (household_id in (select my_household_ids()));

create policy "select household tasks" on tasks
  for select using (household_id in (select my_household_ids()));
create policy "insert household tasks" on tasks
  for insert with check (household_id in (select my_household_ids()));
create policy "update household tasks" on tasks
  for update using (household_id in (select my_household_ids()));
create policy "delete household tasks" on tasks
  for delete using (household_id in (select my_household_ids()));

create policy "select household history" on task_history
  for select using (household_id in (select my_household_ids()));
create policy "insert household history" on task_history
  for insert with check (household_id in (select my_household_ids()));
create policy "delete household history" on task_history
  for delete using (household_id in (select my_household_ids()));

-- Special-case: a brand-new signed-in user has no member row yet, so
-- my_household_ids() is empty and they'd be locked out of creating one.
-- Allow inserting a household + first member as long as the member row
-- being created has auth_user_id = auth.uid().
create policy "create new household" on households
  for insert with check (true);

create policy "create first member for self" on members
  for insert with check (auth_user_id = auth.uid() or household_id in (select my_household_ids()));

-- Signup/join go through these functions (not raw inserts) so that the
-- household + member rows are created atomically, avoiding an RLS
-- chicken-and-egg problem: insert().select() tries to read the new row
-- back immediately, but the SELECT policy above depends on a member row
-- that doesn't exist yet at that instant.
create or replace function create_household(hh_name text, member_name text)
returns table(household_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household households;
begin
  insert into households (name) values (hh_name) returning * into new_household;
  insert into members (household_id, auth_user_id, display_name, avatar_color, is_kid)
  values (new_household.id, auth.uid(), member_name, '#7F77DD', false);
  return query select new_household.id, new_household.invite_code;
end;
$$;

create or replace function join_household(code text, member_name text)
returns table(household_id uuid, household_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  hh households;
begin
  select * into hh from households where invite_code = code;
  if hh.id is null then
    raise exception 'Invite code not found';
  end if;
  insert into members (household_id, auth_user_id, display_name, avatar_color, is_kid)
  values (hh.id, auth.uid(), member_name, '#D85A30', false);
  return query select hh.id, hh.name;
end;
$$;

grant execute on function create_household(text, text) to authenticated;
grant execute on function join_household(text, text) to authenticated;
