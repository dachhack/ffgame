-- 0293 probes: the depth chart table.
--
-- Global worker-written data, exactly like player_team_override (0142): any
-- signed-in user reads it, nobody but the service role writes it. Small
-- surface, but the RLS is the whole contract — a client that could write here
-- could promote itself to QB1 for every league at once.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function pd_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function pd_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000000d' || u, false);
  perform set_config('app.email', 'pd' || u || '@test.dev', false);
end $$;
create or replace function pd_server() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'pd1@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'pd1@test.dev') on conflict (id) do nothing;

-- ── the shape ──────────────────────────────────────────────────────────────
do $$
begin
  perform pd_server();
  delete from player_depth where slug like 'pd-%';
  insert into player_depth (slug, team, pos, depth) values
    ('pd-qb1', 'SEA', 'QB', 1), ('pd-qb2', 'SEA', 'QB', 2), ('pd-rb1', 'KC', 'RB', 1);
  perform pd_true((select count(*) from player_depth where slug like 'pd-%') = 3,
    'pd1 the worker can write the chart');
  perform pd_true((select depth from player_depth where slug = 'pd-qb1') = 1,
    'pd1a rank 1 is the starter');
  -- slug is the key: a player holds ONE rank, and a re-publish replaces it
  -- rather than stacking a second.
  insert into player_depth (slug, team, pos, depth) values ('pd-qb1', 'SEA', 'QB', 3)
    on conflict (slug) do update set depth = excluded.depth, updated_at = now();
  perform pd_true((select count(*) from player_depth where slug = 'pd-qb1') = 1,
    'pd2 a re-publish replaces rather than stacks');
  perform pd_true((select depth from player_depth where slug = 'pd-qb1') = 3,
    'pd2a with the new rank');
end $$;

-- ── who may read, who may write ────────────────────────────────────────────
do $$
declare n int;
begin
  set local role authenticated;
  perform pd_as('1');
  select count(*) into n from player_depth where slug like 'pd-%';
  perform pd_true(n = 3, 'pd3 a signed-in member reads the whole chart');

  -- NOBODY signed in writes it. A client that could would own every league's
  -- idea of who starts.
  begin
    insert into player_depth (slug, team, pos, depth) values ('pd-hack', 'SEA', 'QB', 1);
    raise exception 'PROBE FAIL pd4 a member inserted a depth row';
  exception when insufficient_privilege or others then null; end;
  perform pd_true(not exists (select 1 from player_depth where slug = 'pd-hack'),
    'pd4a and nothing landed');

  begin
    update player_depth set depth = 1 where slug = 'pd-qb2';
    exception when others then null; end;
  perform pd_true((select depth from player_depth where slug = 'pd-qb2') = 2,
    'pd5 nor can a member re-rank somebody');
  reset role;
  perform pd_server();
  delete from player_depth where slug like 'pd-%';
  raise notice 'player-depth probes done';
end $$;

select 'ALL PLAYER-DEPTH PROBES PASSED' as status;
