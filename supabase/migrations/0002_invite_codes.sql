-- 0002: league invite codes.
--
-- The commissioner imports the league once and gets a short shareable code; each
-- leaguemate signs in (magic-link), redeems the code, and is matched to their own
-- roster in that league and enrolled. This replaces "everyone independently finds
-- and imports the league" with a single gated entry point for the closed pilot.
--
-- Redemption runs through a SECURITY DEFINER function (not direct table writes),
-- so a browser client never needs write access to league_membership. The client
-- resolves the player's Sleeper identity via the Sleeper API (it already can) and
-- passes it in; trusted-pilot model = we trust the claimed Sleeper id (light
-- anti-cheat, by decision).

-- Short, human-shareable code (8 hex chars, uppercased), e.g. "A1B2C3D4".
create or replace function gen_invite_code() returns text
  language sql volatile as $$
  select upper(substring(replace(gen_random_uuid()::text, '-', '') for 8));
$$;

alter table league add column if not exists commissioner_id uuid references app_user(id) on delete set null;
alter table league add column if not exists invite_code text unique default gen_invite_code();
-- Backfill any leagues imported before this migration.
update league set invite_code = gen_invite_code() where invite_code is null;

-- Look up a league by code so the client can show "You're joining <name>" before
-- the user commits. Authenticated-only; returns just the public-ish summary.
create or replace function league_by_invite(code text)
  returns table (league_id uuid, name text, season text)
  language sql stable security definer set search_path = public as $$
  select id, name, season from league where invite_code = upper(trim(code));
$$;

-- Redeem an invite: link the caller to their roster in the league and enroll them.
-- Returns { ok, ... } JSON. p_sleeper_user_id / p_sleeper_username come from the
-- client having resolved the Sleeper username via the Sleeper API.
create or replace function redeem_invite(code text, p_sleeper_user_id text, p_sleeper_username text)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  lg  league%rowtype;
  mem league_membership%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into lg from league where invite_code = upper(trim(code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid code');
  end if;

  -- Record the Sleeper link on the caller's account (one Sleeper id per account).
  begin
    update app_user
      set sleeper_user_id = p_sleeper_user_id, sleeper_username = p_sleeper_username
      where id = auth.uid();
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'that Sleeper account is already linked to another login');
  end;

  -- Find the caller's roster in this league by Sleeper owner id.
  select * into mem from league_membership
    where league_id = lg.id and sleeper_owner_id = p_sleeper_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'your Sleeper account is not a manager in this league');
  end if;

  update league_membership
    set app_user_id = auth.uid(), enrolled = true
    where id = mem.id;

  return jsonb_build_object('ok', true,
    'league_id', lg.id, 'roster_id', mem.sleeper_roster_id, 'team', mem.team_name);
end $$;

-- Let signed-in users call these RPCs (and only these — tables stay RLS-guarded).
grant execute on function league_by_invite(text) to authenticated;
grant execute on function redeem_invite(text, text, text) to authenticated;
