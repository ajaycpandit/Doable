-- Run this in Supabase SQL Editor. Fixes the RLS error on signup/join by
-- doing the household + member inserts atomically, bypassing the
-- insert-then-select-back RLS check that was failing.

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
