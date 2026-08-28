-- Rehearsal roster: which league do I point the simulator / stamp lever at?
-- Lists recent native leagues with exactly what the dress-rehearsal tooling
-- needs to target one — the id (simulate.yml's `league` input), the format
-- (guillotine/vampire/standard), whether 🧪 LIVE TEST is on (the sandbox gate
-- both levers require), the scheduled week span, and how far the season has
-- progressed (stamped weeks). Read-only. Run via dbquery.yml.

select
  l.id                                   as league_id,
  l.name,
  l.season,
  coalesce(l.settings_json ->> 'format', 'standard')      as format,
  coalesce(l.settings_json ->> 'game_mode', 'drip')       as game_mode,
  l.is_mock,
  (l.test_live_at is not null)           as live_test,
  (select count(*) from league_membership m where m.league_id = l.id)          as seats,
  (select count(*) from league_membership m
     where m.league_id = l.id and m.eliminated_week is not null)               as eliminated,
  (select min(week) from matchup mu where mu.league_id = l.id)                 as first_week,
  (select max(week) from matchup mu where mu.league_id = l.id)                 as last_week,
  (select count(distinct week) from matchup mu
     where mu.league_id = l.id and mu.status = 'final'
       and mu.home_final is not null and mu.away_final is not null)            as final_weeks,
  l.created_at::date                     as created
from league l
where l.provider = 'native'
order by l.created_at desc
limit 20;
