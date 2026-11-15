-- ═══════════════════════════════════════════════════════════════════════════
-- 0530 · MASON IN FOR WALKER (ops, week 10)
--
-- A Gridiron Gang member, Sunday of week 10, a minute after the 1 PM
-- kickoffs: "this is the league where I am trying to sub walker out … want
-- to replace with mason on the app". He had asked an hour earlier, inside the
-- locked hour, and the free Player Swap of 0529 went to his seat in another
-- league. Founder: "Let's put Mason in for Walker for him."
--
-- The pick itself is changed (not a swap entry), so the man put in scores his
-- whole game, as he would have had the lineup been set before the lock. The
-- metric stays. Guarded, and it says what it found either way:
--   • the seat is found by the md5 of the member's handle (no name here);
--   • exactly one of his week's picks is a "walker", and exactly one player
--     on his roster is a "mason" who is not already in his lineup;
--   • both men play in the SAME window (a drip spot only scores a player
--     whose team is in that window) — otherwise nothing is changed and the
--     windows are printed, to be moved by hand.
-- Once only: after it lands there is no "walker" pick left to match.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare lg uuid := '798acff0-e0bb-4e11-9e1b-4a3bb29525bd'; rid int; uid uuid; mid uuid; wk int;
        r record; n_out int; n_in int; pick sealed_pick; inslug text; out_team text; in_team text; out_win text; in_win text;
begin
  select m.sleeper_roster_id, m.app_user_id into rid, uid
    from league_membership m join app_user u on u.id = m.app_user_id
   where m.league_id = lg
     and 'd9d815ac44afa63563f0ecc60c48e84a' in (md5(lower(coalesce(u.sleeper_username, ''))), md5(lower(coalesce(u.display_name, ''))));
  if rid is null then raise notice '0530: no such member in that league — nothing changed'; return; end if;
  select id, week into mid, wk from matchup
   where league_id = lg and rid in (home_roster_id, away_roster_id) and status = 'live' order by week desc limit 1;
  if mid is null then raise notice '0530: seat % has no live matchup — nothing changed', rid; return; end if;
  raise notice '0530: seat %, week %, matchup %', rid, wk, mid;
  for r in select game_window, roster_slot, player_slug, metric_id, locked from sealed_pick
            where matchup_id = mid and app_user_id = uid order by game_window, roster_slot loop
    raise notice '0530:   pick % / % = % (%)%', r.game_window, r.roster_slot, r.player_slug, r.metric_id, case when r.locked then ' locked' else '' end;
  end loop;

  select count(*) into n_out from sealed_pick where matchup_id = mid and app_user_id = uid and player_slug ilike '%walker%';
  select count(*) into n_in from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
   where sl.league_id = lg and sl.week = wk and sl.roster_id = rid and e ->> 'player_slug' ilike '%mason%'
     and not exists (select 1 from sealed_pick sp where sp.matchup_id = mid and sp.app_user_id = uid and sp.player_slug = e ->> 'player_slug');
  for r in select e ->> 'player_slug' as slug, e ->> 'pos' as pos, e ->> 'grp' as grp
             from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
            where sl.league_id = lg and sl.week = wk and sl.roster_id = rid
              and (e ->> 'player_slug' ilike '%mason%' or e ->> 'player_slug' ilike '%walker%') loop
    raise notice '0530:   roster % (% · %)', r.slug, r.pos, r.grp;
  end loop;
  if n_out <> 1 or n_in <> 1 then
    raise notice '0530: % walker pick(s), % mason(s) free on the roster — need exactly one of each; nothing changed', n_out, n_in; return;
  end if;
  select * into pick from sealed_pick where matchup_id = mid and app_user_id = uid and player_slug ilike '%walker%';
  select e ->> 'player_slug' into inslug from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
   where sl.league_id = lg and sl.week = wk and sl.roster_id = rid and e ->> 'player_slug' ilike '%mason%'
     and not exists (select 1 from sealed_pick sp where sp.matchup_id = mid and sp.app_user_id = uid and sp.player_slug = e ->> 'player_slug');

  -- Each man's team (the worker's override, the league's pool, this week's
  -- price sheet, the depth chart — first that knows him), then its window.
  select coalesce((select team from player_team_override where slug = pick.player_slug),
                  (select team from league_pool where league_id = lg and slug = pick.player_slug),
                  (select team from pod_salary where season = '2026' and week = wk and slug = pick.player_slug limit 1),
                  (select team from player_depth where slug = pick.player_slug limit 1)) into out_team;
  select coalesce((select team from player_team_override where slug = inslug),
                  (select team from league_pool where league_id = lg and slug = inslug),
                  (select team from pod_salary where season = '2026' and week = wk and slug = inslug limit 1),
                  (select team from player_depth where slug = inslug limit 1)) into in_team;
  select win into out_win from nfl_slate where season = '2026' and week = wk and out_team in (home, away) limit 1;
  select win into in_win from nfl_slate where season = '2026' and week = wk and in_team in (home, away) limit 1;
  raise notice '0530: out % (% · window %) in spot % / %, in % (% · window %)', pick.player_slug, out_team, out_win, pick.game_window, pick.roster_slot, inslug, in_team, in_win;
  if in_win is null or in_win <> pick.game_window then
    raise notice '0530: the man going in does not play in window % — nothing changed', pick.game_window; return;
  end if;

  update sealed_pick set player_slug = inslug where id = pick.id;
  raise notice '0530: done — % is in for % in % / %, metric % kept', inslug, pick.player_slug, pick.game_window, pick.roster_slot, pick.metric_id;
end $$;
