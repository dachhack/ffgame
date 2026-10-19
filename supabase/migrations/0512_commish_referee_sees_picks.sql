-- 0512 · THE COMMISSIONER WHO ISN'T PLAYING SEES EVERY PICK (v0.730.25)
--
-- Founder: "I'm commish but not playing in Monday Showdown. When you are
-- commish, but not playing in the league, let you see the picks by any team."
-- contest_matchup seals another squad's picks (and its plays) until each
-- player kicks off (0479, 0485, 0508), and a commissioner with no seat was
-- "another squad" to everyone. A commissioner who holds no seat in the league
-- plays nobody, so nothing they see can help a squad: both sides of every
-- matchup now come back open to them, picks and plays, before kickoff. A
-- commissioner who also plays still sees only their own squad early, as
-- every player does. Body: 0508's, with `ref`.

create or replace function contest_matchup(p_league uuid, p_week int default null, p_matchup uuid default null, p_roster int default null, p_season text default '2026')
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; st matchup_state; started boolean; spots jsonb; mine int; seats int[]; spy text; ref boolean;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  mine := me.sleeper_roster_id;
  -- THE REFEREE (0512): a commissioner with no seat here plays nobody, so
  -- nothing they see can help a squad — every pick and play is open to them.
  ref := me.id is null and is_league_commish(p_league);
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
      'home_plays', _contest_visible_plays(p_league, wk, m.home_roster_id, m.away_roster_id, p_season, m.home_roster_id = any(seats) or ref, case when m.home_roster_id <> mine then spy end),   -- 0508, 0512
      'away_plays', case when m.away_roster_id = m.home_roster_id then '[]'::jsonb else _contest_visible_plays(p_league, wk, m.away_roster_id, m.home_roster_id, p_season, m.away_roster_id = any(seats) or ref, case when m.away_roster_id <> mine then spy end) end,   -- 0508, 0512
      'home_entry', _contest_sealed_entry(p_league, wk, m.home_roster_id, p_season, m.home_roster_id = any(seats) or ref, case when m.home_roster_id <> mine then spy end),
      'away_entry', case when m.away_roster_id = m.home_roster_id then null else _contest_sealed_entry(p_league, wk, m.away_roster_id, p_season, m.away_roster_id = any(seats) or ref, case when m.away_roster_id <> mine then spy end) end,
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
