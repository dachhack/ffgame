-- #1311: why a 1-for-1 waiver claim (CAR Defense) lost "roster over limits".
-- Read only. Seats (roster ids), not team or member names: the log is public.
-- "roster over limits" is roster_illegal_reason() on the roster BEFORE the
-- swap, so the question is what made the claimant's roster illegal.
\pset pager off
set search_path = public;

\echo '── 1. the week''s claims in this league'
select id, roster_id, add_slug, drop_slug, bid, status, note, processed_at
from waiver_claim
where league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and processed_at > now() - interval '3 days'
order by processed_at, id;

\echo '── 2. roster_illegal_reason now, for every seat with a lost claim'
select c.roster_id, roster_illegal_reason(c.league_id, c.roster_id) as illegal_now
from (select distinct league_id, roster_id from waiver_claim
      where league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and status = 'lost'
        and processed_at > now() - interval '3 days') c;

\echo '── 3. those seats'' stashed players (IR / OUT / taxi / devy) and their injury rows'
select nr.roster_id, nr.spot, nr.slug, lp.full_name, lp.exp,
       i.status as inj_status, i.source, i.updated_at as inj_updated,
       classic_slug_started(nr.league_id, nr.slug) as started
from native_roster nr
join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
left join injury_status i on i.player_slug = nr.slug
where nr.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and nr.spot <> 'active'
  and nr.roster_id in (select roster_id from waiver_claim
      where league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and status = 'lost'
        and processed_at > now() - interval '3 days')
order by nr.roster_id, nr.spot, nr.slug;

\echo '── 4. the league''s IR / OUT tags, roster shape and per-spot counts'
select league_ir_tags('5ae08e35-c852-42a6-b944-69779cb012d0') as ir_tags,
       league_out_tags('5ae08e35-c852-42a6-b944-69779cb012d0') as out_tags,
       _roster_shape('5ae08e35-c852-42a6-b944-69779cb012d0') as shape,
       league_active_seats('5ae08e35-c852-42a6-b944-69779cb012d0') as active_seats;
select roster_id, spot, count(*) from native_roster
where league_id = '5ae08e35-c852-42a6-b944-69779cb012d0'
group by roster_id, spot order by roster_id, spot;

\echo '── 5. injury rows for those stashed players keyed by a JSON object (the v0.489.0 bug)'
select i.player_slug, i.status, i.updated_at
from native_roster nr
join injury_status i on i.player_slug like '{"slug":"' || nr.slug || '"%'
where nr.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and nr.spot in ('ir', 'out');
