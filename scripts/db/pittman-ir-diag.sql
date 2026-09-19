-- Pittman / IR diagnostic (v0.423.0). Founder: "Michael Pittman is out. Can we
-- make sure his injury status is correct and that players can move him to IR
-- in the classic leagues?"
--
-- Read-only. Three questions:
--   1. what the worker's injury poll currently says about him (and when it
--      last looked), against ESPN's live report;
--   2. which leagues roster him, in which spot, and whether that league has
--      any IR spots at all (a classic league with ir = 0 refuses every stash
--      with "IR is full — 0 spots", which reads as "can't move him");
--   3. the IR tag list each league enforces.
\pset pager off

select 'injury_status rows for pittman' as q;
select player_slug, status, designation_date, return_date, team, source, updated_at, left(comment, 90) as comment
  from injury_status where player_slug like '%pittman%' order by player_slug;

select 'how fresh is the poll overall' as q;
select max(updated_at) as last_upsert, count(*) as rows_total,
       count(*) filter (where status = 'O') as out_rows,
       count(*) filter (where status = 'IR') as ir_rows
  from injury_status;

select 'leagues that roster him' as q;
select l.id, l.name, l.season, league_game_mode(l.id) as mode, nr.roster_id, nr.spot,
       lm.team_name, _roster_shape(l.id) as shape, league_ir_tags(l.id) as ir_tags
  from native_roster nr
  join league l on l.id = nr.league_id
  left join league_membership lm on lm.league_id = l.id and lm.sleeper_roster_id = nr.roster_id
 where nr.slug like '%pittman%'
 order by l.season desc, l.name;

select 'every current-season league and its IR shape' as q;
select l.id, l.name, l.season, league_game_mode(l.id) as mode, _roster_shape(l.id) as shape,
       league_ir_tags(l.id) as ir_tags,
       (select count(*) from league_membership where league_id = l.id and enrolled) as enrolled
  from league l
 where l.season = (select max(season) from league)
 order by l.name;
