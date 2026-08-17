-- 0178 — CLASSIC LEAGUES PLAY WITH THE LINEUPS OPEN.
--
-- Founder: "Let's make opponent lineups visible pre-kickoff in classic, just
-- like normal fantasy. Nothing is hidden or locks before kick off."
--
-- Classic (0157) exists to be the fantasy people already know, and the fantasy
-- people already know has two properties this database deliberately denied it,
-- because both were built for DRIP:
--
--   1. LINEUPS ARE PUBLIC. Sleeper and ESPN let you read any team's lineup at
--      any time. sealed_pick's select policy handed an opponent's picks over
--      only once `locked` — that is the hidden-pick rule, and the hidden pick
--      IS the drip game. It was never a rule classic asked for.
--   2. EACH PLAYER LOCKS AT HIS OWN KICKOFF ("late swap"). A classic league's
--      whole weekly lineup sat under the pseudo-window 'wk' and sealed the
--      instant ANY window kicked off — so a Thursday night game froze your
--      Sunday running backs. That is not how any normie league behaves.
--
-- Both are fixed HERE, and both are fenced to classic. Drip is untouched:
-- hidden picks and window locks are that game's whole premise, and nothing in
-- this migration can reach a league whose game_mode isn't 'classic'.
--
-- WHAT THIS DOES NOT DO: it does not make a classic lineup editable after that
-- player's game starts. The opposite — it makes the lock FINER, per player
-- rather than per week, which is stricter for late players and looser for
-- early ones.

-- ── Two SECURITY DEFINER helpers ───────────────────────────────────────────
-- RLS policy subqueries run AS THE CALLER, so a policy that reads `league` or
-- `league_membership` directly would be gated by those tables' own policies
-- (or silently answer false where there are none). Same rule the existing
-- is_matchup_participant / co_manages_pick helpers follow.

create or replace function matchup_is_classic(p_matchup uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
    from matchup m
    join league l on l.id = m.league_id
   where m.id = p_matchup;
$$;
comment on function matchup_is_classic(uuid) is
  'Is this matchup played in a CLASSIC (normie) league? The gate on every open-lineup rule in 0178.';

-- Membership in the matchup's LEAGUE — wider than is_matchup_participant,
-- which only knows the two seats playing each other. Normal fantasy shows the
-- whole league every lineup, not just your own opponent's.
create or replace function is_league_member_of_matchup(p_matchup uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from matchup m
      join league_membership lm on lm.league_id = m.league_id
     where m.id = p_matchup
       and lm.app_user_id = auth.uid()
  );
$$;

-- ── 1. Open lineups ────────────────────────────────────────────────────────
-- The added clause is the ONLY widening: your own rows and the locked-opponent
-- rule are reproduced verbatim from 0001, so a drip league reads exactly as it
-- did before this file existed.
drop policy if exists sealed_select on sealed_pick;
create policy sealed_select on sealed_pick
  for select using (
    app_user_id = auth.uid()
    or (locked and is_matchup_participant(matchup_id))
    -- 0178: a classic league's lineups are public to its own members, sealed
    -- or not. Still LEAGUE-scoped — this is "normal fantasy", not "the world".
    or (matchup_is_classic(matchup_id) and is_league_member_of_matchup(matchup_id))
  );

-- ── 2. Per-player locking ──────────────────────────────────────────────────
-- When does the player in a classic pick actually kick off?
--
-- The join is league_pool → nfl_slate: the pool is the league's own player
-- list (seeded at creation, kept current by the commissioner's reseed) and
-- carries each player's NFL team; the slate carries each team's kickoff. Both
-- are already maintained for other reasons, so this adds no new upkeep.
--
-- NULL is the honest answer in three cases, and all three mean ALLOW:
--   • the slate for that week isn't loaded yet (nothing has kicked off);
--   • the player is on a BYE (no game to be late for);
--   • the league has no pool row for that slug — a Sleeper-IMPORTED classic
--     league, which has no league_pool at all. Those leagues keep the worker's
--     seal as their only lock (see server/src/lock.js), exactly as they did
--     before this migration; the trigger simply can't speak for them.
create or replace function classic_player_kickoff(p_matchup uuid, p_slug text) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select min(s.kickoff)
    from matchup m
    join league_pool p on p.league_id = m.league_id and p.slug = p_slug
    join nfl_slate s
      on s.week = m.week
     and s.season = (select max(season) from nfl_slate where week = m.week)
     and (upper(s.home) = upper(p.team) or upper(s.away) = upper(p.team))
   where m.id = p_matchup
     and p.team <> '';
$$;
comment on function classic_player_kickoff(uuid, text) is
  'Kickoff of the game the given player plays in this matchup''s week, via league_pool.team → nfl_slate. NULL = no slate, a bye, or an unknown player: all "not locked".';

-- When is ONE side of a classic write locked? Three different answers, and
-- collapsing any two of them is a bug:
--   • NO PLAYER (an empty spot, or clearing one) — nothing to be late for, so
--     never locked. Getting this wrong would stop a manager clearing a Sunday
--     spot on Saturday just because Thursday's game had been played.
--   • A PLACEABLE player — his own kickoff. The feature.
--   • A player on a BYE — his team is known and simply isn't playing, so there
--     is no kickoff to be late for: never locked, same as an empty spot.
--   • A player we CANNOT place (a slug the pool doesn't know, or a
--     Sleeper-imported league with no pool at all) — the WEEK's first kickoff,
--     which is exactly what every classic pick obeyed before this migration.
--     Unknown has to resolve to the STRICTER rule; the looser one would leave
--     an unresolvable slug swappable all week.
create or replace function classic_pick_lock(p_matchup uuid, p_slug text, p_week_kick timestamptz)
  returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when p_slug is null then null
    when classic_player_kickoff(p_matchup, p_slug) is not null
      then classic_player_kickoff(p_matchup, p_slug)
    when exists (
      select 1 from matchup m
        join league_pool p on p.league_id = m.league_id and p.slug = p_slug and p.team <> ''
       where m.id = p_matchup)
      then null                       -- known player, no game this week: a bye
    else p_week_kick                  -- unplaceable: the pre-0178 week-wide rule
  end;
$$;

-- The window-lock trigger, taught about 'wk'.
--
-- BASED ON 0136's definition, not 0058's: the week_lock_hold escape (0134) and
-- the 1-hour lead (0102) are load-bearing for DRIP and have to survive a file
-- that is only here to change classic. Everything outside the classic branch is
-- that version verbatim.
create or replace function enforce_window_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
declare k timestamptz; k_new timestamptz; k_old timestamptz; wkk timestamptz;
        wk int; lg uuid; rec sealed_pick;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  rec := coalesce(new, old);
  if tg_op = 'UPDATE'
     and new.player_slug  is not distinct from old.player_slug
     and new.metric_id    is not distinct from old.metric_id
     and new.game_window  is not distinct from old.game_window
     and new.roster_slot  is not distinct from old.roster_slot then
    return new;
  end if;
  select week, league_id into wk, lg from matchup where id = rec.matchup_id;
  if exists (select 1 from week_lock_hold where league_id = lg and week = wk) then return coalesce(new, old); end if;

  -- ── CLASSIC: per player, at his own kickoff, with no lead (0178) ──────────
  if rec.game_window = 'wk' then
    wkk := window_kickoff(wk, 'wk');
    k_new := case when tg_op = 'DELETE' then null else classic_pick_lock(new.matchup_id, new.player_slug, wkk) end;
    -- The OUTGOING player is checked too. Without this a manager could pull a
    -- running back at half time once he'd fumbled — the exact move late swap
    -- exists to forbid — and a DELETE would be a swap with the second half
    -- missing, dropping someone who has already played.
    k_old := case when tg_op in ('UPDATE', 'DELETE') then classic_pick_lock(old.matchup_id, old.player_slug, wkk) end;
    -- EITHER side having kicked off locks the write, so this is the EARLIER of
    -- the two, not the later. (A greatest() here reads plausibly and is wrong:
    -- swapping a kicked-off player for one who plays Sunday would take the
    -- Sunday kickoff and wave the whole thing through.)
    k := least(coalesce(k_new, 'infinity'::timestamptz), coalesce(k_old, 'infinity'::timestamptz));
    -- NO 1-hour lead here, deliberately: "nothing locks before kick off".
    if k <> 'infinity'::timestamptz and k <= now() then
      raise exception 'that player has already kicked off (%) — classic lineups lock player by player',
        k using errcode = 'check_violation';
    end if;
    return coalesce(new, old);
  end if;

  k := window_kickoff(wk, rec.game_window);
  if k is not null and k - interval '1 hour' <= now() then
    raise exception 'window % is locked — lineups lock 1h before its % kickoff', rec.game_window, k
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists enforce_window_lock on sealed_pick;
create trigger enforce_window_lock before insert or update or delete on sealed_pick
  for each row execute function enforce_window_lock();

grant execute on function matchup_is_classic(uuid) to authenticated;
grant execute on function is_league_member_of_matchup(uuid) to authenticated;
grant execute on function classic_player_kickoff(uuid, text) to authenticated;
grant execute on function classic_pick_lock(uuid, text, timestamptz) to authenticated;
