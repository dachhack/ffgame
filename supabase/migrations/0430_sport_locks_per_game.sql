-- 0430 — WHAT THE REVIEW FOUND (v0.621.0): a lock per game, a start that is
-- a start, and pools that follow the directory.
--
--   • sport_slot_lock is keyed per GAME as well as per slot-day: a
--     doubleheader's second game locks the slot again under its own id, and
--     the lines RPCs already join per game.
--   • sport_slug_started ignores a postponed or cancelled game: a puck drop
--     that never happened is not a lock, however far past its clock.
--   • sport_pool_refresh moves every sport league's pool rows to the
--     directory's team, eligibility and primary position — the worker calls
--     it after each sweep. The locks and the DB lock read the pool's team;
--     a traded player with a stale one never locked and never scored.
--
-- Undo: drop function if exists sport_pool_refresh(text); restore 0426's
-- sport_slug_started and sport_slot_lock's four-column key.

alter table sport_slot_lock drop constraint if exists sport_slot_lock_pkey;
alter table sport_slot_lock add primary key (matchup_id, app_user_id, game_date, roster_slot, game_id);

create or replace function sport_slug_started(p_league_id uuid, p_slug text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from league l
      join league_pool lp on lp.league_id = l.id and lp.slug = p_slug and lp.team <> ''
      join sport_game g on g.sport = l.sport and g.season = l.season
                       and (g.home = lp.team or g.away = lp.team)
     where l.id = p_league_id and l.sport <> 'nfl'
       and g.status not in ('postponed', 'cancelled')
       and (
         (g.game_date = (now() at time zone 'America/New_York')::date
          and (g.status in ('live', 'final') or (g.start_utc is not null and g.start_utc <= now())))
         or (g.game_date = (now() at time zone 'America/New_York')::date - 1 and g.status = 'live')
       )
  );
$$;
grant execute on function sport_slug_started(uuid, text) to authenticated;

-- The worker only: every league pool of the sport follows sport_player.
create or replace function sport_pool_refresh(p_sport text) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update league_pool lp
     set team = sp.team, eligible = sp.eligible, pos = sp.pos, full_name = sp.full_name
    from sport_player sp, league l
   where l.id = lp.league_id and l.sport = p_sport
     and sp.sport = p_sport and sp.player_key = lp.slug
     and (lp.team is distinct from sp.team or lp.eligible is distinct from sp.eligible
          or lp.pos is distinct from sp.pos or lp.full_name is distinct from sp.full_name);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sport_pool_refresh(text) from public, anon, authenticated;
grant execute on function sport_pool_refresh(text) to service_role;
