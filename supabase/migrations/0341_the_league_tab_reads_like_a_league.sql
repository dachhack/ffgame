-- ═══════════════════════════════════════════════════════════════════════════
-- 0341 · THE LEAGUE TAB READS LIKE A LEAGUE — one week's scoreboard
--
-- Founder, with Sleeper's LEAGUE tab open beside ours: "Let's follow the
-- sleeper convention for my league. Matchups summary, rankings, then activity.
-- Put all the league settings and info that is there now in a chip up by the
-- league name."
--
-- Ours was a MENU: twelve tiles, each a door to a sheet. Sleeper's is a PAGE —
-- this week's games, the table, what the league just did — and the settings
-- are one gear in the corner. The second reads as a league; the first reads as
-- a filing cabinet, and you have to open a drawer before anything tells you
-- what is happening.
--
-- The tiles are not lost: they move behind the gear, which is where a person
-- looks for them anyway. What the page needs is the one thing no endpoint
-- served — every matchup in a week, with a score, for anybody in the league.
--
-- `leagueResults` reads `matchup.home_final/away_final`, and those are NULL
-- until the week is stamped, so a league-wide board showed dashes all Sunday.
-- The live totals exist: the worker publishes per-window rows into
-- `matchup_state` and the participants' own boards read them. This sums them.
--
-- NOTHING SEALED LEAKS, and it is the same argument v0.456.1 made for the
-- opponent's cards: the worker writes a window's row only once that window has
-- KICKED OFF (resolve.js `started(win)`), which is the same moment the
-- sealed_select RLS opens the opponent's real picks. A window nobody has
-- played has no row to sum. And this returns TOTALS ONLY — never `slot_scores`
-- — so it says what the score is, never who is in the lineup. The public read
-- API's own matchups endpoint (0326) already publishes the same pair of
-- numbers to anonymous callers for an opted-in league; this serves them to a
-- MEMBER, live, which is strictly narrower.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function league_week_scoreboard(p_league_id uuid, p_week int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wk int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  wk := p_week;
  if wk is null then
    -- The week the league is PLAYING: the lowest one still unfinished, else
    -- the last one there is. A board that opens on week 1 in November is a
    -- board nobody reads.
    select min(week) into wk from matchup where league_id = p_league_id and status <> 'final';
    if wk is null then select max(week) into wk from matchup where league_id = p_league_id; end if;
  end if;
  if wk is null then return jsonb_build_object('ok', true, 'week', null, 'games', '[]'::jsonb); end if;

  return jsonb_build_object('ok', true, 'week', wk,
    -- Which weeks exist at all, so a pager knows its ends without a second
    -- call and cannot step onto a week this league does not have.
    'weeks', coalesce((select jsonb_agg(distinct week order by week) from matchup where league_id = p_league_id), '[]'::jsonb),
    -- Ordered by the home seat, which is stable week to week; a uuid is not
    -- an order, it just looks like one until the rows move.
    'games', coalesce((select jsonb_agg(g order by g.ord) from (
      select m.home_roster_id as ord, jsonb_build_object(
        'matchup_id', m.id,
        'status', m.status,
        'playoff', m.is_playoff, 'consolation', m.is_consolation, 'label', m.playoff_label,
        'home', jsonb_build_object('roster_id', m.home_roster_id,
          'team', _txn_team(p_league_id, m.home_roster_id),
          -- THE FINAL WHERE THERE IS ONE, THE RUNNING TOTAL WHERE THERE IS
          -- NOT. Both are the same number at the whistle — the stamped final
          -- IS the sum of these rows — so the board does not jump when a week
          -- closes; it just stops moving.
          'points', coalesce(m.home_final,
            (select round(sum(s.home_score), 2) from matchup_state s where s.matchup_id = m.id)),
          'live', m.home_final is null
            and exists (select 1 from matchup_state s where s.matchup_id = m.id)),
        'away', jsonb_build_object('roster_id', m.away_roster_id,
          'team', _txn_team(p_league_id, m.away_roster_id),
          'points', coalesce(m.away_final,
            (select round(sum(s.away_score), 2) from matchup_state s where s.matchup_id = m.id)),
          'live', m.away_final is null
            and exists (select 1 from matchup_state s where s.matchup_id = m.id))) as g
        from matchup m
       where m.league_id = p_league_id and m.week = wk
    ) g), '[]'::jsonb));
end $$;
grant execute on function league_week_scoreboard(uuid, int) to authenticated;
