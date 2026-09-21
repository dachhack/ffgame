-- ─────────────────────────────────────────────────────────────────────────────
-- rookie-spot-pickup-diag.sql — did a mid-week pickup reach the best-ball fill?
--
-- READ ONLY. Run through dbquery.yml, or:
--   psql "$DATABASE_URL" -f scripts/db/rookie-spot-pickup-diag.sql
--
-- Mooney's Rehab Facility (Kickoff League), Sunday night: "confused on why it
-- doesn't look like Coleman counted for my rookie best ball spot. App is
-- showing me it counted Chris Bell who had 0 today … waivers look like they
-- processed at 2 pm so I guess he didn't count on my roster before he played."
--
-- Two readers, two answers to check:
--   • THE BOARD reads the week's pool (sleeper_lineup.starters_json), which
--     native_materialize stops refreshing once the week has left 'scheduled'
--     — so a Sunday pickup is not in it, and the board's own fill cannot see
--     him. That is a display problem.
--   • THE RESOLVER reads native_roster (active) with league_pool.exp for the
--     rookie-only spot's tenure filter (a null exp is refused). Its answer is
--     matchup_state.slot_scores. That is the score.
-- Sections: the claim and the roster row; both pool rows (exp!); whether the
-- week's sleeper_lineup carries him; the matchup and the best-ball slot's
-- scored row; the slate's kickoff for his team.
-- ─────────────────────────────────────────────────────────────────────────────
\set QUIET on
\set lg_name 'Kickoff%'
\set team_name 'Mooney%'
\set pick 'jonah-coleman'
\set other 'chris-bell'

with lg as (select id, name, settings_json from league where lower(name) like lower(:'lg_name') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower(:'team_name') limit 1)
select 'claim' as section, wc.add_slug, wc.drop_slug, wc.bid, wc.status, wc.created_at, wc.processed_at, wc.clears_at
from lg cross join seat
join waiver_claim wc on wc.league_id = lg.id and wc.roster_id = seat.sleeper_roster_id and wc.add_slug in (:'pick', :'other')
order by wc.created_at desc;

with lg as (select id from league where lower(name) like lower(:'lg_name') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower(:'team_name') limit 1)
select 'roster' as section, nr.slug, nr.spot, nr.acquired, nr.added_at, lp.pos, lp.team, lp.exp, lp.sleeper_id
from lg cross join seat
join native_roster nr on nr.league_id = lg.id and nr.roster_id = seat.sleeper_roster_id and nr.slug in (:'pick', :'other')
join league_pool lp on lp.league_id = lg.id and lp.slug = nr.slug;

with lg as (select id from league where lower(name) like lower(:'lg_name') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower(:'team_name') limit 1),
     wk as (select mu.week from lg cross join seat join matchup mu on mu.league_id = lg.id and seat.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
            where mu.week between 1 and 18 and mu.status in ('scheduled', 'live') order by mu.week limit 1)
select 'week pool' as section, sl.week, e ->> 'slug' as slug, e ->> 'pos' as pos, e ->> 'team' as team
from lg cross join seat cross join wk
join sleeper_lineup sl on sl.league_id = lg.id and sl.week = wk.week and sl.roster_id = seat.sleeper_roster_id
cross join lateral jsonb_array_elements(sl.starters_json) e
where coalesce(e ->> 'slug', e ->> 'player_slug') in (:'pick', :'other');

with lg as (select id from league where lower(name) like lower(:'lg_name') order by created_at desc limit 1),
     seat as (select m.* from lg join league_membership m on m.league_id = lg.id where lower(m.team_name) like lower(:'team_name') limit 1),
     mu as (select mu.* from lg cross join seat join matchup mu on mu.league_id = lg.id and seat.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
            where mu.week between 1 and 18 and mu.status in ('scheduled', 'live') order by mu.week limit 1)
select 'scored' as section, mu.week, mu.status, ms.game_window, ms.updated_at,
       case when mu.home_roster_id = seat.sleeper_roster_id then 'home' else 'away' end as my_side,
       r ->> 'slot' as slot, r ->> 'slug' as slug, (r ->> 'score')::numeric as score
from mu cross join seat
join matchup_state ms on ms.matchup_id = mu.id
cross join lateral jsonb_array_elements(ms.slot_scores) r
where r ->> 'side' = case when mu.home_roster_id = seat.sleeper_roster_id then 'home' else 'away' end
order by r ->> 'slot';

with lg as (select id from league where lower(name) like lower(:'lg_name') order by created_at desc limit 1),
     wk as (select mu.week from lg join matchup mu on mu.league_id = lg.id where mu.week between 1 and 18 and mu.status in ('scheduled', 'live') order by mu.week limit 1)
select 'kickoffs' as section, s.season, s.week, s.away, s.home, s.win, s.kickoff
from wk join nfl_slate s on s.week = wk.week
where s.season = (select max(season) from nfl_slate where week = wk.week)
  and (s.home in ('SEA', 'TEN') or s.away in ('SEA', 'TEN'))
order by s.kickoff;
