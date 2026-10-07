-- Read-only diagnostic (dbquery.yml): did a classic league's autodraft know
-- its lineup? For every classic league with a draft, say whether it carries a
-- builder spec (settings_json.roster_slots — the only lineup the autopick
-- reads), the 0161 counts, or neither; then each roster's draft picks in
-- order with their positions, so a lineup that drafted by rank alone (a
-- starting spot left empty while the bench filled) is visible at a glance.
-- Nothing personal: league names, seat numbers, player slugs and positions.
\pset pager off

select l.name, l.season, l.id as league_id,
       coalesce(l.settings_json ->> 'game_mode', 'drip') as game_mode,
       l.settings_json ->> 'bullseye' as bullseye,
       jsonb_typeof(l.settings_json -> 'roster_slots') as roster_slots,
       l.settings_json -> 'roster_classic' as roster_classic,
       d.status as draft, d.rounds, d.stash_slots
  from league l
  join draft d on d.league_id = l.id
 where coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
   and l.created_at > now() - interval '14 days'
 order by l.created_at desc
 limit 20;

-- The most recent classic league's seats, pick by pick.
with lg as (
  select l.id from league l join draft d on d.league_id = l.id
   where coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
     and l.created_at > now() - interval '14 days'
   order by l.created_at desc limit 1
)
select nr.roster_id, nr.added_at, lp.pos, nr.slug, nr.spot, nr.acquired
  from native_roster nr
  join lg on lg.id = nr.league_id
  left join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
 order by nr.roster_id, nr.added_at;
