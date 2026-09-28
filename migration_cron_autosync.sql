-- Run in Supabase SQL Editor.
--
-- Before running: replace YOUR_SUPABASE_URL below with your actual
-- Project URL (Project Settings > API > Project URL — the same one
-- already in your js/config.js, e.g. https://abcdefgh.supabase.co).
--
-- No API key needed here: the sync-external-calendar function must be
-- (re)deployed with --no-verify-jwt for this to work, same as the
-- ical-feed function already is — that's what lets this scheduled job
-- call it without needing to hunt down a service-role/secret key.

-- 1. Enable the two extensions this needs (if this errors, enable them
--    instead via Dashboard -> Database -> Extensions -> search "pg_cron"
--    and "pg_net", then re-run just the schedule call below).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Schedule the sync. Calling the function with an empty body (no
--    household_id) tells it to sync every household's calendars, not
--    just one — this is what makes it a real background job.
select cron.schedule(
  'sync-external-calendars-every-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://reejwbkrfiqorxepcpbh.supabase.co/functions/v1/sync-external-calendar',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- To check it's running: select * from cron.job;
-- To see recent run history: select * from cron.job_run_details order by start_time desc limit 10;
-- To change the interval (e.g. every 15 min instead of 30):
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'sync-external-calendars-every-30-min'), schedule := '*/15 * * * *');
-- To stop it entirely:
--   select cron.unschedule('sync-external-calendars-every-30-min');
