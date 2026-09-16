-- 0278: A DROPPED PLAYER LEAVES THE LINEUP (v0.394.0).
--
-- Founder: "if someone assigns a player to a spot but then drops him from
-- their external league or native league, we need to remove them from the
-- spot as long as it is unlocked."
--
-- A pick is a sealed_pick row; the roster it must come from is native_roster
-- (native leagues — a drop is a DELETE, a trade an UPDATE of roster_id) or
-- sleeper_lineup.starters_json (external leagues — the worker's sync rewrites
-- the row and a dropped player is simply no longer in it; native leagues
-- materialize the same row from native_roster, so both paths meet here).
-- 0072's enforce_legal_roster only ever checked the roster at WRITE time; a
-- pick made and then orphaned by a drop stayed put and scored zero.
--
-- "As long as it is unlocked" is the SAME rule the 0178 window-lock trigger
-- applies to a manager's own delete: the row's locked flag, a windowed pick's
-- kickoff less the one-hour lead, and a classic ('wk') pick's own player
-- kickoff. _pick_still_open mirrors it so the cleanup never trips the trigger
-- (which fires on delete too), and each row is deleted under its own guard so
-- a drop can never fail because of its lineup.

create or replace function _pick_still_open(sp sealed_pick, wk int, lg uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare k timestamptz;
begin
  if sp.locked then return false; end if;
  if exists (select 1 from week_lock_hold where league_id = lg and week = wk) then return true; end if;
  if sp.game_window = 'wk' then
    k := classic_pick_lock(sp.matchup_id, sp.player_slug, window_kickoff(wk, 'wk'));
    return k is null or k > now();
  end if;
  k := window_kickoff(wk, sp.game_window);
  return k is null or k - interval '1 hour' > now();
end $$;

/** Drop every still-open pick of one seat on one player. The seat's picks are
 *  the rows its manager (league_membership) or its agent (seat_agent) wrote
 *  on matchups where the seat is a side. Returns how many rows went. */
create or replace function _clear_dropped_picks(p_league uuid, p_roster int, p_slug text) returns int
  language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if p_slug is null then return 0; end if;
  for r in
    select sp as pick, sp.id as pid, m.week
      from sealed_pick sp
      join matchup m on m.id = sp.matchup_id
     where m.league_id = p_league
       and p_roster in (m.home_roster_id, m.away_roster_id)
       and sp.player_slug = p_slug
       and not sp.locked
       and sp.app_user_id in (
         select lm.app_user_id from league_membership lm
          where lm.league_id = p_league and lm.sleeper_roster_id = p_roster and lm.app_user_id is not null
         union
         select sa.agent_user_id from seat_agent sa
          where sa.league_id = p_league and sa.roster_id = p_roster)
  loop
    if not _pick_still_open(r.pick, r.week, p_league) then continue; end if;
    begin
      delete from sealed_pick where id = r.pid;
      n := n + 1;
    exception when check_violation then
      null;   -- the lock trigger knows better than the mirror: leave it
    end;
  end loop;
  return n;
end $$;

-- ── native leagues: a drop (DELETE) or a trade away (UPDATE of roster_id) ──
create or replace function native_roster_clear_picks() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform _clear_dropped_picks(old.league_id, old.roster_id, old.slug);
  return coalesce(new, old);
end $$;
drop trigger if exists native_roster_clear_picks on native_roster;
create trigger native_roster_clear_picks after delete or update of roster_id on native_roster
  for each row execute function native_roster_clear_picks();

-- ── external leagues: the synced roster no longer carries the player ───────
-- EXTERNAL ONLY: a native league's sleeper_lineup row is a materialized copy
-- of native_roster (0252), and the trigger above already answers for native
-- drops — letting a stale or partial copy speak for the roster would clear
-- picks the seat still holds. Guarded against an EMPTY roster too: a sync
-- that came back with nothing is a fetch that failed, not twelve drops.
create or replace function sleeper_lineup_clear_picks() returns trigger
  language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if is_native_league(new.league_id) then return new; end if;
  if new.starters_json is null or jsonb_typeof(new.starters_json) <> 'array'
     or jsonb_array_length(new.starters_json) = 0 then
    return new;
  end if;
  for r in
    select distinct sp.player_slug
      from sealed_pick sp
      join matchup m on m.id = sp.matchup_id
     where m.league_id = new.league_id and m.week = new.week
       and new.roster_id in (m.home_roster_id, m.away_roster_id)
       and sp.player_slug is not null and not sp.locked
       and sp.player_slug not in (
         select coalesce(e ->> 'player_slug', e ->> 'slug')
           from jsonb_array_elements(new.starters_json) e
          where coalesce(e ->> 'player_slug', e ->> 'slug') is not null)
  loop
    perform _clear_dropped_picks(new.league_id, new.roster_id, r.player_slug);
  end loop;
  return new;
end $$;
drop trigger if exists sleeper_lineup_clear_picks on sleeper_lineup;
create trigger sleeper_lineup_clear_picks after insert or update of starters_json on sleeper_lineup
  for each row execute function sleeper_lineup_clear_picks();
