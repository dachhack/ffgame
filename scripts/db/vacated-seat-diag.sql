-- Diagnostic: are there sealed picks on live/final matchups whose app_user_id
-- is NOT the current membership of that seat? (The "Allen shows yards but 0
-- points" hypothesis: the board reveals every sealed_pick row on the matchup;
-- the resolver only fields rows matching the seat's CURRENT app_user_id, so a
-- vacated/reassigned seat's picks render but never score.)
-- Read-only. Run via dbquery.yml.

-- 1) Every matchup that has orphaned locked picks: rows whose author is not on
--    either seat's current membership.
select
  l.name                             as league,
  m.week,
  m.status,
  m.id                               as matchup_id,
  sp.app_user_id                     as pick_author,
  hm.app_user_id                     as home_user_now,
  am.app_user_id                     as away_user_now,
  count(*)                           as orphaned_locked_picks,
  array_agg(distinct sp.player_slug) filter (where sp.player_slug ilike '%allen%') as allen_slugs
from sealed_pick sp
join matchup m  on m.id = sp.matchup_id
join league  l  on l.id = m.league_id
left join league_membership hm on hm.league_id = m.league_id and hm.sleeper_roster_id = m.home_roster_id
left join league_membership am on am.league_id = m.league_id and am.sleeper_roster_id = m.away_roster_id
where sp.locked
  and sp.player_slug is not null
  and sp.app_user_id is distinct from hm.app_user_id
  and sp.app_user_id is distinct from am.app_user_id
group by l.name, m.week, m.status, m.id, sp.app_user_id, hm.app_user_id, am.app_user_id
order by l.name, m.week;

-- 2) The Josh Allen rows specifically, wherever they are, with seat context.
select
  l.name          as league,
  m.week,
  m.status,
  sp.app_user_id  as pick_author,
  sp.game_window,
  sp.roster_slot,
  sp.locked,
  case when sp.app_user_id = hm.app_user_id then 'HOME (current)'
       when sp.app_user_id = am.app_user_id then 'AWAY (current)'
       else 'ORPHAN — author not on either seat' end as seat_match,
  hm.controller as home_ctl, am.controller as away_ctl
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league  l on l.id = m.league_id
left join league_membership hm on hm.league_id = m.league_id and hm.sleeper_roster_id = m.home_roster_id
left join league_membership am on am.league_id = m.league_id and am.sleeper_roster_id = m.away_roster_id
where sp.player_slug ilike '%josh-allen%'
order by l.name, m.week, sp.game_window;
