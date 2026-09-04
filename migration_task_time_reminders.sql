-- Run in Supabase SQL Editor.

-- 1. Optional time-of-day on a task (for reminders / calendar precision)
alter table tasks add column if not exists due_time time;

-- 2. How far before due_time/due_date to fire a calendar reminder alarm
--    none | 5m | 30m | 1h | 2h | 1d
alter table tasks add column if not exists remind_before text not null default 'none';

-- 3. Allow household members to delete history entries (the app only shows
--    the delete button to non-kid profiles, but RLS just checks household
--    membership like everywhere else in this schema)
create policy "delete household history" on task_history
  for delete using (household_id in (select my_household_ids()));
