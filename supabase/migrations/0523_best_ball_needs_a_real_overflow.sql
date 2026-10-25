-- ═══════════════════════════════════════════════════════════════════════════
-- 0523 · BEST BALL GOES OFF ONLY FOR A REAL OVERFLOW (v0.733.1)
--
-- Kickoff League, week 7: Mooney's K, D/ST and Rookie Only Bestball spots
-- read "BEST BALL — OFF" because Tank Dell healed while on IR (ops 082:
-- "Tank Dell is on IR but isn't designated IR/O any more"). Founder: "healthy
-- guys in IR shouldn't block the best ball action … The whole point of the
-- rule is to not allow people to have more spots than allotted to choose from
-- when making the best ball calculations."
--
-- A stashed player (IR, OUT, taxi) is never a best-ball candidate, so a stash
-- problem — a healed IR player, an OUT spot without the designation, a taxi
-- veteran, a shelf over its size — gives the fill nothing extra to choose
-- from. Best ball now goes off only when the CANDIDATE pool is too big:
--   • more active players than the active seats allow (seats + open taxi
--     spots, 0360's own formula), or
--   • a college player outside the devy spots in a non-mixed league (0366),
--     who stands on the active roster as an extra candidate.
-- roster_illegal_reason is unchanged and still freezes adds and lineup
-- changes until the roster is fixed; only the best-ball switch moves.
--
-- league_illegal_rosters (the worker's read, used only to switch best ball
-- off, resolve.js) now lists just those seats; league_roster_issues keeps
-- every seat's reason for the boards' banner and adds `bestball_off`.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function roster_bestball_off(p_league_id uuid, p_roster_id integer) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; sh jsonb; seats int; dv int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return false; end if;
  sh := _roster_shape(p_league_id);
  dv := coalesce((sh ->> 'devy')::int, 0);
  -- a college player standing where a pro would (0366, as 0440 judges it)
  if dv > 0 and not league_is_mixed(p_league_id) and exists (
    select 1 from native_roster nr
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
       and nr.slug ~ '^c-[0-9]+$' and nr.spot <> 'devy') then
    return true;
  end if;
  -- more active players than the active seats allow (0360's formula)
  seats := league_active_seats(p_league_id);
  if seats is not null and sh <> '{}'::jsonb then
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'active';
    cap := seats + greatest(coalesce((sh ->> 'taxi')::int, 0)
             - (select count(*)::int from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'taxi'), 0);
    if cnt > cap then return true; end if;
  elsif sh = '{}'::jsonb then
    -- No shelves: every player is active, so the whole roster over the rounds.
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
    if cnt > d.rounds then return true; end if;
  end if;
  return false;
end $$;
revoke all on function roster_bestball_off(uuid, integer) from public, anon;
grant execute on function roster_bestball_off(uuid, integer) to authenticated, service_role;

-- The boards: every seat's reason (the banner, the lineup freeze) and which
-- seats' best ball is off.
create or replace function league_roster_issues(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'issues', coalesce((
      select jsonb_object_agg(m.sleeper_roster_id::text, r)
        from league_membership m, lateral roster_illegal_reason(p_league_id, m.sleeper_roster_id) r
       where m.league_id = p_league_id and m.sleeper_roster_id is not null and r is not null), '{}'::jsonb),
    'bestball_off', coalesce((
      select jsonb_object_agg(m.sleeper_roster_id::text, true)
        from league_membership m
       where m.league_id = p_league_id and m.sleeper_roster_id is not null
         and roster_bestball_off(p_league_id, m.sleeper_roster_id)), '{}'::jsonb));
end $$;
grant execute on function league_roster_issues(uuid) to authenticated;

-- The worker's once-a-tick read, used only to switch best ball off.
create or replace function league_illegal_rosters(p_league_ids uuid[]) returns table (league_id uuid, roster_id int, reason text)
  language sql stable security definer set search_path = public as $$
  select m.league_id, m.sleeper_roster_id, roster_illegal_reason(m.league_id, m.sleeper_roster_id)
    from league_membership m
   where m.league_id = any(p_league_ids) and m.sleeper_roster_id is not null
     and roster_bestball_off(m.league_id, m.sleeper_roster_id);
$$;
revoke all on function league_illegal_rosters(uuid[]) from public, anon, authenticated;
grant execute on function league_illegal_rosters(uuid[]) to service_role;
