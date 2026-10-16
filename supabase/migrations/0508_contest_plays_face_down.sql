-- 0508: POWER-UPS STAY FACE DOWN WITH THEIR CARDS (v0.730.3)
--
-- Founder, over a Weekly Cointest matchup with every card still on its back
-- but "TEAM ⚡ UP" under both squads and "⚡ UP" on both RB1s: "Don't show that
-- opponent or other teams have power ups applied until cards flip over."
-- v0.730.2 hid them in both apps; then "yes, hide them on the server too".
--
-- contest_matchup handed out the other side's whole contest_play list from the
-- week's first kickoff (0484, kept through 0491), and contest_plays did the
-- same for any seat. Now another squad's play leaves the server only when the
-- card it rides has turned for the viewer — the same moment the card's pick
-- does in _contest_sealed_entry:
--
--   · a play on one of its own spots: once that spot's player has kicked off
--     (or the viewer's Spy shows that spot);
--   · a team play (no spot): once any of its spots has turned;
--   · a Spy or Jinx it aimed across the table: once the player on the spot it
--     hit has kicked off (for the viewer's own spot, that is when it turns for them);
--   · the phantom: from the week's first kickoff, when its spot starts scoring.
--
-- A seat's own plays are always open to it. The commissioner's and an
-- admin's contest_plays read stays open (0484), as before.
-- Twin of core contestSpotPlayShown / contestSquadPlaysShown / contestGhostShown.

create or replace function _contest_visible_plays(p_league uuid, p_week int, p_roster int, p_opp int, p_season text, p_open boolean, p_spy text default null) returns jsonb
  language sql stable security definer set search_path = public as $$
  with lu as (
    select sl.roster_id, e ->> 'slot' as slot, e ->> 'player_slug' as slug
      from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) e
     where sl.league_id = p_league and sl.week = p_week and sl.roster_id in (p_roster, p_opp)
  ), up as (   -- this roster's spots that have turned for the viewer
    select lu.slot from lu
     where lu.roster_id = p_roster and (_dfs_player_locked(p_season, p_week, lu.slug) or (p_spy is not null and lu.slot = p_spy))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', c.play_id, 'slot', c.slot, 'proj', c.proj, 'price', c.price, 'at', c.armed_at) order by c.armed_at, c.id), '[]'::jsonb)
    from contest_play c
   where c.league_id = p_league and c.week = p_week and c.roster_id = p_roster
     and (p_open
       or (c.play_id = 'ghost' and coalesce(_week_first_lock(p_season, p_week) <= now(), false))
       or (c.slot is null and exists (select 1 from up))
       or (c.play_id in ('spy', 'jinx') and exists (select 1 from lu where lu.roster_id = p_opp and lu.slot = c.slot and _dfs_player_locked(p_season, p_week, lu.slug)))
       or (c.slot is not null and c.play_id not in ('spy', 'jinx', 'ghost') and c.slot in (select up.slot from up)));
$$;
revoke all on function _contest_visible_plays(uuid, int, int, int, text, boolean, text) from public, anon, authenticated;

/** A seat's armed plays: mine any time; another's as its cards turn (0508). */
create or replace function contest_plays(p_league uuid, p_week int, p_roster int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; rid int; open_ boolean; opp int; plays jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  rid := coalesce(p_roster, me.sleeper_roster_id);
  if rid is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  open_ := rid in (select s.sleeper_roster_id from _my_contest_seats(p_league) s) or is_league_commish(p_league) or is_admin();
  if open_ then
    plays := _contest_plays_json(p_league, p_week, rid);
  else
    select case when x.home_roster_id = rid then x.away_roster_id else x.home_roster_id end into opp
      from matchup x where x.league_id = p_league and x.week = p_week and rid in (x.home_roster_id, x.away_roster_id) limit 1;
    plays := _contest_visible_plays(p_league, p_week, rid, opp, lg.season, false);
  end if;
  return jsonb_build_object('ok', true, 'roster_id', rid, 'week', p_week,
    -- 'sealed' says only that this seat's list is filtered, never whether anything was held back
    'sealed', not open_,
    'plays', plays);
end $$;

create or replace function contest_matchup(p_league uuid, p_week int default null, p_matchup uuid default null, p_roster int default null, p_season text default '2026')
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; st matchup_state; started boolean; spots jsonb; mine int; seats int[]; spy text;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  mine := me.sleeper_roster_id;
  seats := array(select s.sleeper_roster_id from _my_contest_seats(p_league) s);
  wk := coalesce(p_week, lg.contest_week,
    (select min(week) from matchup where league_id = p_league and status <> 'final'),
    (select max(week) from matchup where league_id = p_league), _contest_week(p_season));
  started := coalesce(_week_first_lock(p_season, wk) <= now(), false);
  if p_matchup is not null then
    select * into m from matchup where id = p_matchup and league_id = p_league and week = wk;
  elsif p_roster is not null then
    select * into m from matchup where league_id = p_league and week = wk and p_roster in (home_roster_id, away_roster_id) limit 1;
  elsif mine is not null then
    select * into m from matchup where league_id = p_league and week = wk and mine in (home_roster_id, away_roster_id) limit 1;
  end if;
  if m.id is null then
    select * into m from matchup where league_id = p_league and week = wk order by is_playoff desc, playoff_round, bracket_pos, home_roster_id limit 1;
  end if;
  -- `me` is the seat of mine in the matchup shown (a member with several
  -- seats looks at one of them at a time), else my first.
  if m.id is not null then
    mine := case when m.home_roster_id = any(seats) then m.home_roster_id when m.away_roster_id = any(seats) then m.away_roster_id else mine end;
  end if;
  if m.id is not null then select * into st from matchup_state where matchup_id = m.id and game_window = 'wk'; end if;
  -- SPY (0485): my spy's spot shows me the opponent's pick there before his kickoff
  if m.id is not null and mine is not null and mine in (m.home_roster_id, m.away_roster_id) then
    select c.slot into spy from contest_play c where c.league_id = p_league and c.week = wk and c.roster_id = mine and c.play_id = 'spy' limit 1;
    -- SMOKE (0491): their Smoke on that spot keeps it sealed from my Spy
    if spy is not null and exists (select 1 from contest_play c where c.league_id = p_league and c.week = wk and c.play_id = 'smoke' and c.slot = spy
                                      and c.roster_id = case when m.home_roster_id = mine then m.away_roster_id else m.home_roster_id end) then spy := null; end if;
  end if;
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'me', mine, 'slots', spots,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'), 'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'scoring_classic', lg.settings_json -> 'scoring_classic', 'ppr', coalesce((lg.settings_json ->> 'ppr')::numeric, 1),
    'matchup', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'status', m.status, 'home', m.home_roster_id, 'away', m.away_roster_id,
      'home_team', _txn_team(p_league, m.home_roster_id), 'away_team', _txn_team(p_league, m.away_roster_id),
      'home_final', m.home_final, 'away_final', m.away_final, 'home_tb', m.home_tb, 'away_tb', m.away_tb,
      'playoff', m.is_playoff, 'label', m.playoff_label,
      'home_plays', _contest_visible_plays(p_league, wk, m.home_roster_id, m.away_roster_id, p_season, m.home_roster_id = any(seats), case when m.home_roster_id <> mine then spy end),   -- 0508
      'away_plays', case when m.away_roster_id = m.home_roster_id then '[]'::jsonb else _contest_visible_plays(p_league, wk, m.away_roster_id, m.home_roster_id, p_season, m.away_roster_id = any(seats), case when m.away_roster_id <> mine then spy end) end,   -- 0508
      'home_entry', _contest_sealed_entry(p_league, wk, m.home_roster_id, p_season, m.home_roster_id = any(seats), case when m.home_roster_id <> mine then spy end),
      'away_entry', case when m.away_roster_id = m.home_roster_id then null else _contest_sealed_entry(p_league, wk, m.away_roster_id, p_season, m.away_roster_id = any(seats), case when m.away_roster_id <> mine then spy end) end,
      'state', case when st.matchup_id is null or not started then null else jsonb_build_object('home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end) end,
    'matchups', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'home', x.home_roster_id, 'away', x.away_roster_id,
                 'home_team', _txn_team(p_league, x.home_roster_id), 'away_team', _txn_team(p_league, x.away_roster_id),
                 'status', x.status, 'label', x.playoff_label, 'consolation', x.is_consolation,
                 'home_score', coalesce(x.home_final, xs.home_score), 'away_score', coalesce(x.away_final, xs.away_score),
                 'mine', x.home_roster_id = any(seats) or x.away_roster_id = any(seats))
               order by (x.home_roster_id = any(seats) or x.away_roster_id = any(seats)) desc, x.is_consolation, x.bracket_pos, x.home_roster_id)
      from matchup x left join matchup_state xs on xs.matchup_id = x.id and xs.game_window = 'wk'
      where x.league_id = p_league and x.week = wk), '[]'::jsonb));
end $$;
