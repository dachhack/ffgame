-- #1396, Kickoff League chat: "while all these adds on 10/18 shouldn't they be
-- locked after games?" — Team 2 added Ty Johnson (Sun 17:30 UTC) and Ryan
-- Flournoy (Sun 21:37 UTC); Steelers added Dohnte Meyers (Mon 01:35 UTC). 0487
-- holds every unowned player on waivers from his team's kickoff to the hold-day
-- run, so an instant ADD after his kickoff should be refused. Each add: kind
-- (add vs waiver), who did it (a person or the worker), the player's team code,
-- that team's week-6 kickoff, and whether the add came after it. Read only;
-- seats by number, no member names.
\pset pager off
set search_path = public;
\echo '── the league''s wire settings'
select l.id, l.season, league_fa_mode(l.id) as fa_mode, waiver_game_hold_dow_effective(l.id) as hold_dow,
       league_waiver_clear_min(l.id) as clear_min
  from league l where l.id = '5ae08e35-c852-42a6-b944-69779cb012d0';
\echo '── adds and claims, Sat 10/17 → now'
select t.at, t.kind, t.roster_id as seat, t.actor is null as by_worker,
       t.slug, lp.full_name, lp.pos, lp.team,
       (select min(s.kickoff) from nfl_slate s where s.season = '2026' and s.week = 6
         and (_nfl_team(s.home) = _nfl_team(lp.team) or _nfl_team(s.away) = _nfl_team(lp.team))) as team_kickoff,
       (select bool_or(s.kickoff <= t.at) from nfl_slate s where s.season = '2026' and s.week = 6
         and (_nfl_team(s.home) = _nfl_team(lp.team) or _nfl_team(s.away) = _nfl_team(lp.team))) as after_kickoff,
       lp.waived_until as waived_until_now
  from league_txn t left join league_pool lp on lp.league_id = t.league_id and lp.slug = t.slug
 where t.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and t.at >= '2026-10-17' and t.kind in ('add', 'waiver')
 order by t.at;
\echo '── seats: who holds them (a person or the CPU)'
select m.sleeper_roster_id as seat, m.controller, m.app_user_id is not null as has_account
  from league_membership m where m.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' order by 1;
\echo '── claims on those players'
select wc.add_slug, wc.roster_id as seat, wc.status, wc.created_at, wc.clears_at, wc.processed_at
  from waiver_claim wc
 where wc.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and wc.created_at >= '2026-10-16'
 order by wc.created_at;
\echo '── week-6 slate'
select home, away, kickoff from nfl_slate where season = '2026' and week = 6 order by kickoff;
