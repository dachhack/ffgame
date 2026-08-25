-- Which weeks does each IMPORTED league actually have synced rosters for?
--
-- Asked for v0.356.18. MY TEAM on an external league reads the newest
-- sleeper_lineup row for your seat, and until now that meant the newest by
-- WEEK NUMBER — which preseason board weeks (101-103) always win, because they
-- are numbered above the real season. Those rows are not a roster at all:
-- admin_seed_preseason_pool (0101) writes every seat the same deep slate-team
-- pool. The fix reads real weeks only.
--
-- This asks the question that fix depends on: IS THERE A REAL WEEK TO READ? If
-- an imported league has preseason rows and no real ones, MY TEAM will honestly
-- say "no synced roster yet" — and the answer would be to pull the roster from
-- the platform live rather than from the sync.
--
-- Read-only. Nothing here writes.
select
  l.name,
  coalesce(l.provider, 'native')                                   as provider,
  l.season,
  count(*) filter (where sl.week <= 100)                           as real_week_rows,
  max(sl.week) filter (where sl.week <= 100)                       as newest_real_week,
  count(*) filter (where sl.week > 100)                            as preseason_rows,
  count(distinct sl.roster_id)                                     as seats_with_any_row
from league l
join sleeper_lineup sl on sl.league_id = l.id
where coalesce(l.provider, 'native') <> 'native'
group by l.id, l.name, l.provider, l.season
order by l.season desc, l.name;
