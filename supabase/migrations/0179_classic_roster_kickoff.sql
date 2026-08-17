-- 0179 — A CLASSIC PLAYER STOPS MOVING WHEN HIS GAME STARTS.
--
-- Founder: "players [should] not be movable to/from roster spots in classic
-- leagues once their game kicks off."
--
-- 0178 froze the LINEUP that way — sealed_pick writes are refused once that
-- player has kicked off. It left the ROSTER open, and the roster is the other
-- half of the same move: `set_roster_spot` could send a running back to IR at
-- half time, and `drop_player` / `add_free_agent` could cut him outright, both
-- while his game was being played.
--
-- WHY THIS IS MORE THAN TIDINESS — the best-ball exploit. A best-ball spot
-- fills from the ROSTER at scoring time (bestballFill), not from a stored pick.
-- So in a best-ball classic league, ADDING a free agent whose game had already
-- finished would field him retroactively, with his score already known. That is
-- the one move here that could decide a matchup, and it is an ADD rather than a
-- drop — which is why this guards arrivals as well as departures.
--
-- WHY A TRIGGER AND NOT THREE RPC EDITS. `native_roster` is written from
-- fourteen places — draft picks, free agents, waiver processing, trades, taxi
-- and IR moves, commissioner tools, backup assignment. Guarding the three RPCs
-- a manager happens to use today would leave the other doors open and would
-- mean copying three function bodies into this file to add one line each; the
-- last migration nearly shipped a bug doing exactly that (0178 rewrote a
-- trigger from a five-versions-stale copy). One trigger on the table is the
-- whole rule, in one place, and it cannot be bypassed by a path nobody
-- remembered.
--
-- WHAT PASSES THROUGH, and why each one has to:
--   • the SERVER (no auth uid) — the worker seals, materializes and resolves;
--     game ops must never jam. Same exemption enforce_window_lock takes.
--   • an ADMIN — the founder fixing something mid-Sunday is the reason the
--     exemption exists at all.
--   • every DRIP league — its protection is the window lock and hidden picks.
--   • a bye, a player we cannot place, and any game still ahead.

-- ── One source of truth for "when does this player kick off" ────────────────
-- 0178 answered this per MATCHUP; a roster write has no matchup in hand, only a
-- league. Rather than keep two copies of the league_pool → nfl_slate join, the
-- league/week form becomes the implementation and 0178's matchup form delegates
-- to it — so the lineup rule and the roster rule can never drift apart about
-- who has kicked off. Behaviour is unchanged; the 0178 probes still run against
-- the matchup form and still pass.
create or replace function classic_kickoff_for(p_league_id uuid, p_week int, p_slug text)
  returns timestamptz language sql stable security definer set search_path = public as $$
  select min(s.kickoff)
    from league_pool p
    join nfl_slate s
      on s.week = p_week
     and s.season = (select max(season) from nfl_slate where week = p_week)
     and (upper(s.home) = upper(p.team) or upper(s.away) = upper(p.team))
   where p.league_id = p_league_id and p.slug = p_slug and p.team <> '';
$$;

create or replace function classic_player_kickoff(p_matchup uuid, p_slug text) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select classic_kickoff_for(m.league_id, m.week, p_slug)
    from matchup m where m.id = p_matchup;
$$;

-- The week a league is actually PLAYING: the earliest one not yet final. NULL
-- before a schedule exists, which reads as "no week in play" and blocks
-- nothing — the pre-season state, where moving players around is the point.
create or replace function league_live_week(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select min(week) from matchup where league_id = p_league_id and status <> 'final';
$$;

-- Is this player mid-game (or past it) in this league's live week? False for a
-- drip league, a bye, a player we cannot place, or a game still ahead.
create or replace function classic_slug_started(p_league_id uuid, p_slug text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') = 'classic'
     and coalesce(classic_kickoff_for(p_league_id, league_live_week(p_league_id), p_slug) <= now(), false);
$$;
comment on function classic_slug_started(uuid, text) is
  'CLASSIC only: has this player''s game in the league''s live week already started? The gate on every roster move in 0179.';

create or replace function enforce_classic_roster_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
declare rec native_roster; other text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- the server
  if is_admin() then return coalesce(new, old); end if;           -- game ops
  rec := coalesce(new, old);
  if classic_slug_started(rec.league_id, rec.slug) then
    raise exception 'that player''s game has kicked off — he cannot be added, dropped or moved this week'
      using errcode = 'check_violation';
  end if;
  -- An UPDATE that swaps the slug is two moves in one row; check both ends,
  -- for the same reason 0178 checks the outgoing player on a lineup swap.
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    other := old.slug;
    if classic_slug_started(old.league_id, other) then
      raise exception 'that player''s game has kicked off — he cannot be added, dropped or moved this week'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists enforce_classic_roster_lock on native_roster;
create trigger enforce_classic_roster_lock before insert or update or delete on native_roster
  for each row execute function enforce_classic_roster_lock();

grant execute on function classic_kickoff_for(uuid, int, text) to authenticated;
grant execute on function league_live_week(uuid) to authenticated;
grant execute on function classic_slug_started(uuid, text) to authenticated;
