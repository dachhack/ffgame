-- WHAT THE PLATFORM THINKS ABOUT WHO IS HURT. Read-only. Run via dbquery.yml.
--
-- Founder: "I think Alec Pierce is out but he's listed as D in the platform."
-- He was right, and answering him took pulling both feeds by hand — which is a
-- fine way to answer it once and a poor way to answer it the next time. This is
-- the next time.
--
-- Since v0.489.0 the poller merges ESPN and Sleeper (core/data/injuryMerge.ts):
-- freshness first, the league's own platform on a tie, an explicit ESPN
-- "Active" clearing a flag the other feed still holds — and it PRUNES what
-- neither source designates any more, which before v0.489.0 nothing ever did.
-- `source` on each row records which feed the standing designation came from,
-- so most questions here are answered by grouping on it.
--
-- What each section answers:
--   1. is the table alive, and how stale is it
--   2. who decided the designations standing right now
--   3. every player in a league's POOL carrying one — deliberately the same
--      population 0333 discounts (it joins league_pool too), so this is the
--      list whose designations actually move a projection: O or IR to zero,
--      D to a quarter
--   4. one player by name, for "is X really out?"
--   5. the designations that reach nobody — a sanity check on the prune

\pset pager off

-- ── 1. freshness ────────────────────────────────────────────────────────────
select count(*)                                   as designations,
       max(updated_at)                            as last_poll,
       now() - max(updated_at)                    as age,
       count(*) filter (where status in ('O','IR')) as ruled_out,
       count(*) filter (where status = 'D')       as doubtful,
       count(*) filter (where status = 'Q')       as questionable
from injury_status;

-- ── 2. who decided them ─────────────────────────────────────────────────────
-- 'espn+sleeper' is agreement; a lopsided split toward one source, or no
-- 'sleeper' rows at all, means a feed stopped arriving and nobody noticed.
select source, count(*) as rows, max(updated_at) as last_seen
from injury_status group by source order by rows desc;

-- ── 3. every pooled player carrying a designation ───────────────────────────
-- league_pool, not a roster table, and on purpose: it is what 0333's discount
-- joins, so a row here is a row that changes a number somebody sees. Ordered
-- worst-first, which is the order a commissioner would read it in.
select i.status, i.player_slug, i.team, i.source,
       i.designation_date, i.return_date,
       string_agg(distinct l.name, ', ') as leagues,
       left(coalesce(i.comment, ''), 90) as note
from injury_status i
join league_pool lp on lp.slug = i.player_slug
join league l on l.id = lp.league_id
group by i.status, i.player_slug, i.team, i.source, i.designation_date, i.return_date, i.comment
order by case i.status when 'IR' then 0 when 'O' then 1 when 'D' then 2 else 3 end,
         i.player_slug;

-- ── 4. one player ───────────────────────────────────────────────────────────
-- Edit the slug and re-run for "is X really out?". A slug is the player's name
-- lowercased and hyphenated (alec-pierce, jayden-daniels, amon-ra-st-brown).
select 'alec-pierce' as asked_about,
       i.status, i.source, i.designation_date, i.return_date, i.updated_at, i.comment
from injury_status i where i.player_slug = 'alec-pierce';

-- ── 5. designations no league can use ───────────────────────────────────────
-- A large number is HEALTHY: the feeds cover all 32 teams and the leagues do
-- not, so most of the NFL's injury report belongs to nobody here. A number that
-- GROWS week over week while section 1's count climbs would mean the prune has
-- stopped running — check the worker's `injuries:` log line, which says either
-- "— N cleared" or "— prune SKIPPED, feed incomplete".
select count(*) as designations_outside_every_pool
from injury_status i
where not exists (select 1 from league_pool lp where lp.slug = i.player_slug);
