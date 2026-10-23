-- ═══════════════════════════════════════════════════════════════════════════
-- 0520 · A BYE IS NOT SEALED (v0.732.4)
--
-- Test Wedding, week 7, Friday (founder): "Why can't I move guys on bye out of
-- roster spots?" J. Allen and J. Croskey-Merritt, both on bye, had no ⇄.
--
-- The worker's classicSealAt sealed a bye at the week's FIRST kickoff, so every
-- bye spot sealed at Thursday night's game, and a sealed row is un-writable by
-- its manager (sealed_pick RLS: locked = false). classic_pick_lock (0178) has
-- always called a bye the league pool knows "never locked": it returns NULL.
-- v0.732.3 taught the worker the same (a pooled bye seals at the week's LAST
-- kickoff); this is the one-time repair for the spots it sealed before that.
--
-- On this week's live classic matchups, every sealed spot holding a player for
-- whom classic_pick_lock answers NULL (a pooled bye; an empty spot is 0390's
-- case and already open) opens again, unless the week's last game has begun.
-- The worker re-seals each at the week's last kickoff. Players who have
-- kicked off, and slugs the database can't place, are untouched.
--
-- Lands AFTER the v0.732.3 worker is live: the old worker re-sealed these on
-- every ~25-second tick.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _reopen_sealed_byes() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update sealed_pick s set locked = false, revealed_at = null
    from matchup m
   where m.id = s.matchup_id and m.status = 'live'
     and s.game_window = 'wk' and s.locked
     and s.player_slug is not null
     and s.player_slug !~ '^c-[0-9]+$'   -- college spots seal by their own rule (0372)
     and classic_pick_lock(s.matchup_id, s.player_slug, window_kickoff(m.week, 'wk')) is null
     and coalesce((select max(sl.kickoff) from nfl_slate sl
                    where sl.week = m.week and sl.season = (select max(season) from nfl_slate where week = m.week)) > now(), false);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function _reopen_sealed_byes() from public;

do $$ begin
  raise notice '0520: reopened % classic spot(s) holding a player on bye', _reopen_sealed_byes();
end $$;
