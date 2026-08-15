-- Did the resolver ADOPT the orphaned lineups? (companion to
-- vacated-seat-diag.sql — that one finds orphaned sealed picks; this one reads
-- the worker's OUTPUT for the affected matchups. Adoption never rewrites
-- sealed_pick, so the orphan rows stay "orphaned" in the table by design; the
-- proof it worked is the away/home score and the orphan's slugs appearing in
-- matchup_state.slot_scores.) Read-only. Run via dbquery.yml.

with orphaned as (
  select distinct m.id as matchup_id, l.name as league, m.week, m.status
  from sealed_pick sp
  join matchup m on m.id = sp.matchup_id
  join league  l on l.id = m.league_id
  left join league_membership hm on hm.league_id = m.league_id and hm.sleeper_roster_id = m.home_roster_id
  left join league_membership am on am.league_id = m.league_id and am.sleeper_roster_id = m.away_roster_id
  where sp.locked and sp.player_slug is not null
    and sp.app_user_id is distinct from hm.app_user_id
    and sp.app_user_id is distinct from am.app_user_id
)
select
  o.league, o.week, o.status,
  ms.game_window,
  ms.home_score,
  ms.away_score,
  ms.updated_at,
  (select string_agg(s->>'slot' || ':' || coalesce(s->>'slug','—') || '=' || coalesce(s->>'score','0'), ', ')
     from jsonb_array_elements(coalesce(ms.slot_scores, '[]'::jsonb)) s
    where s->>'side' = 'away') as away_slots
from orphaned o
left join matchup_state ms on ms.matchup_id = o.matchup_id
order by o.league, ms.game_window;
