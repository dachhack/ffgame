-- 0468 team_role probes (read-only): did the coach scan land, and did the
-- names reach the pools and the salary boards?
\set QUIET on
\pset pager off
select count(*) as coaches, min(updated_at) as first_scan, max(updated_at) as last_scan from team_role;
select slug, name, team from team_role order by slug limit 40;
select slug, full_name, count(*) as leagues from league_pool where slug like '%-hc' group by slug, full_name order by slug;
select season, week, slug, name, proj from pod_salary where slug like '%-hc' order by week desc, slug limit 40;
