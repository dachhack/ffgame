-- 0513 · ONE CONTEST MATCHUP, FOR ANYONE WITH THE LINK (v0.730.26)
--
-- Founder: "can we make a link to show the one match up in that league on a
-- website for anyone not logged in? It's deciding a tie in one of my leagues
-- and other league mates might want to follow it."
--
-- public_contest_matchup(matchup id) is contest_matchup (0479…0512) as an
-- outsider sees it — no seat, no Spy, not the commissioner: each pick stays
-- sealed until its player kicks off and each play follows the same reveal
-- rule (_contest_sealed_entry / _contest_visible_plays with p_open false), so
-- the link shows a squad no earlier than the other side sees it. Granted to
-- anon. The gate follows the public API's (0327): a league whose
-- commissioner turned public reads off is not served, nor a mock; with no
-- choice made, a contest league is open (it lives here). There is no list — a
-- matchup is readable only by whoever holds its id (a v4 UUID). Player names
-- come with each pick that has turned (from the week's salary board, public
-- game data); the per-spot score rows carry no player id, so a sealed spot's
-- zero can't name him.

create or replace function public_contest_matchup(p_matchup uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare m matchup; lg league; st matchup_state; started boolean; spots jsonb; home jsonb; away jsonb; names jsonb;
begin
  select * into m from matchup where id = p_matchup;
  if m.id is null then return jsonb_build_object('ok', false, 'error', 'no such matchup'); end if;
  select * into lg from league where id = m.league_id;
  -- The gate (0327's spirit): an explicit public_api choice wins either way; absent it, a contest
  -- league is open — it lives here (provider 'pod' is Drip's own, not an import, though
  -- league_public_api only counts 'native' as home).
  if lg.id is null or not _is_contest(lg) or coalesce(lg.is_mock, false) or not coalesce((lg.settings_json ->> 'public_api')::boolean, true) then
    return jsonb_build_object('ok', false, 'error', 'this matchup isn''t public');
  end if;
  started := coalesce(_week_first_lock(lg.season, m.week) <= now(), false);
  select * into st from matchup_state where matchup_id = m.id and game_window = 'wk';
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  home := _contest_sealed_entry(lg.id, m.week, m.home_roster_id, lg.season, false, null);
  away := case when m.away_roster_id = m.home_roster_id then null else _contest_sealed_entry(lg.id, m.week, m.away_roster_id, lg.season, false, null) end;
  select coalesce(jsonb_object_agg(ps.slug, jsonb_build_object('name', ps.name, 'pos', ps.pos, 'team', ps.team, 'proj', ps.proj)), '{}'::jsonb)
    into names from pod_salary ps
   where ps.season = lg.season and ps.week = m.week
     and ps.slug in (select e ->> 'player_slug' from jsonb_array_elements(coalesce(home, '[]'::jsonb) || coalesce(away, '[]'::jsonb)) e where e ->> 'player_slug' is not null);
  return jsonb_build_object('ok', true, 'league', lg.name, 'week', m.week, 'started', started,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg), 'slots', spots,
    'status', m.status, 'playoff', m.is_playoff, 'label', m.playoff_label,
    'home_team', _txn_team(lg.id, m.home_roster_id), 'away_team', _txn_team(lg.id, m.away_roster_id),
    'home_final', m.home_final, 'away_final', m.away_final,
    'home_entry', home, 'away_entry', away,
    'home_plays', _contest_visible_plays(lg.id, m.week, m.home_roster_id, m.away_roster_id, lg.season, false, null),
    'away_plays', case when m.away_roster_id = m.home_roster_id then '[]'::jsonb else _contest_visible_plays(lg.id, m.week, m.away_roster_id, m.home_roster_id, lg.season, false, null) end,
    'names', names,
    'state', case when st.matchup_id is null or not started then null else jsonb_build_object('home', st.home_score, 'away', st.away_score,
      'slots', (select coalesce(jsonb_agg(x - 'slug' - 'player_slug'), '[]'::jsonb) from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x)) end);
end $$;
grant execute on function public_contest_matchup(uuid) to anon, authenticated;
