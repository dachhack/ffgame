-- #1188 probe (v0.659.1). Read-only. Run via dbquery.yml.
--
-- A Kickoff League manager: "Trying to swap Jonah Coleman for Saquon on IR for
-- waiver add purposes and it won't let me swap/move Jonah off without dropping
-- someone." The fix (0461 swap_roster_spot) assumes the dead end: IR full AND
-- the active roster full, so neither half of the swap could go first. This
-- says whether that was this team's state, and whether Saquon was IR-eligible.
\pset pager off

-- 1. the two players: whose roster, which spot, what the injury table says
select nr.roster_id, lm.team_name, nr.slug, nr.spot, i.status as injury, i.source, i.updated_at
from native_roster nr
join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
left join league_membership lm on lm.league_id = nr.league_id and lm.sleeper_roster_id = nr.roster_id
left join injury_status i on i.player_slug = nr.slug
where nr.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0'
  and (lp.full_name ilike 'jonah coleman' or lp.full_name ilike 'saquon barkley');

-- 2. that team's spots against the league's shape: full IR + full active = the dead end
with team as (
  select nr.roster_id from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and lp.full_name ilike 'jonah coleman' limit 1)
select nr.spot, count(*) as held,
       case nr.spot when 'active' then _classic_starters('5ae08e35-c852-42a6-b944-69779cb012d0') + coalesce((_roster_shape('5ae08e35-c852-42a6-b944-69779cb012d0') ->> 'bench')::int, 0)
                    else coalesce((_roster_shape('5ae08e35-c852-42a6-b944-69779cb012d0') ->> nr.spot)::int, 0) end as cap
from native_roster nr join team on team.roster_id = nr.roster_id
where nr.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0'
group by nr.spot order by nr.spot;

-- 3. which designations this league lets onto IR and OUT
select league_ir_tags('5ae08e35-c852-42a6-b944-69779cb012d0') as ir_tags,
       league_out_tags('5ae08e35-c852-42a6-b944-69779cb012d0') as out_tags;
