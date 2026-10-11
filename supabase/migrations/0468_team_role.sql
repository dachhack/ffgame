-- 0468: WHO THE HEAD COACH IS (v0.667.0).
--
-- Founder: "The head coaches are just listed as Jaguars Head coach and Bears
-- Head coach. Can we get a scan for their names each week."
--
-- The coach is a TEAM UNIT (0171: `jax-hc`), and the projection and the
-- scoring belong to the team, not the person — which is what makes a
-- mid-season firing harmless to every stored lineup. Only the NAME was ever
-- a problem: it was hand-typed into projTeamRoles2026.ts once and shown
-- nowhere, so a pool row read "JAX Head Coach" and nothing else.
--
-- This table is the worker's scan (server/src/poll/coaches.js): ESPN's team
-- directory, one row per unit slug, refreshed with the daily directory
-- refresh (so a Monday firing shows by Tuesday). Shaped like player_depth
-- (0293): global data, worker writes, any signed-in user reads, no RPC to
-- write it.
--
-- `sync_team_role_names` pushes the names into the two places a unit's name
-- is STORED — every league's pool (league_pool.full_name) and the frozen
-- salary boards (pod_salary.name) — so a board built before the scan, or a
-- pool built on the phone from the static list, catches up without a
-- rebuild. Nothing here is read by scoring.

create table if not exists team_role (
  slug       text primary key,     -- `<team>-hc` (punters may follow)
  name       text not null,        -- "Liam Coen"
  team       text not null,        -- our team code, upper ('JAX')
  source     text not null default 'espn',
  updated_at timestamptz not null default now()
);
alter table team_role enable row level security;
drop policy if exists team_role_read on team_role;
create policy team_role_read on team_role
  for select using (auth.uid() is not null);
grant select on team_role to authenticated;

create or replace function sync_team_role_names()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  m int := 0;
begin
  update league_pool lp
     set full_name = tr.name
    from team_role tr
   where lp.slug = tr.slug
     and lp.full_name is distinct from tr.name;
  get diagnostics n = row_count;
  update pod_salary ps
     set name = tr.name
    from team_role tr
   where ps.slug = tr.slug
     and ps.name is distinct from tr.name;
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke all on function sync_team_role_names() from public;
