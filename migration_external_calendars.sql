-- Run in Supabase SQL Editor.
-- Lets household members add a read-only Google/Apple calendar feed that
-- gets cached and displayed (not editable) on the Doable calendar.

create table external_calendars (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,   -- whose calendar this is (optional)
  label text not null,
  feed_url text not null,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now()
);

create table external_events (
  id uuid primary key default gen_random_uuid(),
  external_calendar_id uuid not null references external_calendars(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  uid text not null,             -- UID from the source ICS, used to de-dupe on re-sync
  title text,
  event_date date not null,      -- the date it falls on (all-day, or the date part of a timed event)
  event_time time,               -- null for all-day events
  unique (external_calendar_id, uid)
);

alter table external_calendars enable row level security;
alter table external_events enable row level security;

create policy "select household external calendars" on external_calendars
  for select using (household_id in (select my_household_ids()));
create policy "insert household external calendars" on external_calendars
  for insert with check (household_id in (select my_household_ids()));
create policy "update household external calendars" on external_calendars
  for update using (household_id in (select my_household_ids()));
create policy "delete household external calendars" on external_calendars
  for delete using (household_id in (select my_household_ids()));

-- external_events is only ever written by the sync Edge Function, which
-- uses the service role key and so bypasses RLS entirely — members only
-- need read access here.
create policy "select household external events" on external_events
  for select using (household_id in (select my_household_ids()));
