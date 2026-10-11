-- 0479: THE MATCHUP, AS CARDS (v0.677.0). Founder: "incorporate the card
-- theme into the weekly contest leagues. So on the matchup screen your cards
-- down one column with your opponent's card backs down the other side, then
-- they flip at kickoff … Let's make it so you can view different weeks and
-- different matchups in the smaller leagues in the matchup tab."
--
-- contest_state (0466/0469) answers for MY matchup only. This answers for
-- any matchup of a week — the one I'm in by default, or one I point at (its
-- id, or a seat in it) — with both squads, each player sealed until his
-- kickoff (0470's _dfs_player_locked) unless the squad is the caller's own,
-- the week's live or final scores, and the week's whole list of matchups for
-- the picker. A leaderboard league's rows are self-paired: one squad, and
-- the list is every seat that has one.

-- A seat's squad for a week: as saved when it is the reader's own, else each
-- player sealed until his kickoff — the rule contest_state applied to the
-- opponent (0469), now for any seat.
create or replace function _contest_sealed_entry(p_league uuid, p_week int, p_roster int, p_season text, p_open boolean) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_agg(case when p_open or _dfs_player_locked(p_season, p_week, e ->> 'player_slug') then e
                        else jsonb_build_object('slot', e -> 'slot', 'sealed', true) end order by ord)
    from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) with ordinality x(e, ord)
   where sl.league_id = p_league and sl.week = p_week and sl.roster_id = p_roster;
$$;
create or replace function contest_matchup(p_league uuid, p_week int default null, p_matchup uuid default null, p_roster int default null, p_season text default '2026')
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; st matchup_state; started boolean; spots jsonb; mine int;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  mine := me.sleeper_roster_id;
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
  if m.id is not null then select * into st from matchup_state where matchup_id = m.id and game_window = 'wk'; end if;
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'me', mine, 'slots', spots,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'), 'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'matchup', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'status', m.status, 'home', m.home_roster_id, 'away', m.away_roster_id,
      'home_team', _txn_team(p_league, m.home_roster_id), 'away_team', _txn_team(p_league, m.away_roster_id),
      'home_final', m.home_final, 'away_final', m.away_final, 'home_tb', m.home_tb, 'away_tb', m.away_tb,
      'playoff', m.is_playoff, 'label', m.playoff_label,
      'home_entry', _contest_sealed_entry(p_league, wk, m.home_roster_id, p_season, m.home_roster_id = mine),
      'away_entry', case when m.away_roster_id = m.home_roster_id then null else _contest_sealed_entry(p_league, wk, m.away_roster_id, p_season, m.away_roster_id = mine) end,
      'state', case when st.matchup_id is null or not started then null else jsonb_build_object('home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end) end,
    'matchups', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'home', x.home_roster_id, 'away', x.away_roster_id,
                 'home_team', _txn_team(p_league, x.home_roster_id), 'away_team', _txn_team(p_league, x.away_roster_id),
                 'status', x.status, 'label', x.playoff_label, 'consolation', x.is_consolation,
                 'home_score', coalesce(x.home_final, xs.home_score), 'away_score', coalesce(x.away_final, xs.away_score),
                 'mine', mine in (x.home_roster_id, x.away_roster_id))
               order by (mine in (x.home_roster_id, x.away_roster_id)) desc, x.is_consolation, x.bracket_pos, x.home_roster_id)
      from matchup x left join matchup_state xs on xs.matchup_id = x.id and xs.game_window = 'wk'
      where x.league_id = p_league and x.week = wk), '[]'::jsonb));
end $$;

revoke all on function _contest_sealed_entry(uuid, int, int, text, boolean) from public, anon, authenticated;
revoke all on function contest_matchup(uuid, int, uuid, int, text) from public, anon;
grant execute on function contest_matchup(uuid, int, uuid, int, text) to authenticated;
