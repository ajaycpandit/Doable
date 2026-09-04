-- Run in Supabase SQL Editor. Adds a per-household secret token used to
-- authorize the public iCal subscribe feed (calendar apps can't send
-- auth headers, so the token lives in the URL itself instead).

alter table households
  add column if not exists calendar_token text not null
  default substr(md5(random()::text || clock_timestamp()::text), 1, 20);
