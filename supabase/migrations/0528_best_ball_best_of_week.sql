-- ═══════════════════════════════════════════════════════════════════════════
-- 0528 · BEST BALL, BEST OF THE WEEK (v0.737.1)
--
-- Founder, after ONE GAME (0527): "Let's also build the best of week logic."
-- In a ONE GAME league a 🎯 best-ball spot counts ONE game a week too: the
-- single best posted game among the roster's eligible players, one player
-- per spot, chosen by the worker (sportLeague.js fillBestBallWeek) and
-- redone as games land until the week ends. This is the week-wide write
-- the nightly sport_bb_write_svc (0436) is for one day: every best-ball
-- row of the period for the seat goes, and the week's fill goes in, each
-- row on its own game's date.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function sport_bb_write_week_svc(p_matchup uuid, p_user uuid, p_from date, p_to date, p_slots text[], p_rows jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from sport_slot_lock k
   where k.matchup_id = p_matchup and k.app_user_id = p_user
     and k.game_date between p_from and p_to and k.roster_slot = any (p_slots);
  insert into sport_slot_lock (matchup_id, app_user_id, game_date, roster_slot, player_slug, game_id)
  select p_matchup, p_user, (r ->> 'game_date')::date, r ->> 'roster_slot', r ->> 'player_slug', r ->> 'game_id'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where (r ->> 'roster_slot') = any (p_slots) and (r ->> 'player_slug') is not null and (r ->> 'game_id') is not null
     and (r ->> 'game_date')::date between p_from and p_to
  on conflict (matchup_id, app_user_id, game_date, roster_slot, game_id) do update set player_slug = excluded.player_slug, locked_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sport_bb_write_week_svc(uuid, uuid, date, date, text[], jsonb) from public, anon, authenticated;
grant execute on function sport_bb_write_week_svc(uuid, uuid, date, date, text[], jsonb) to service_role;
