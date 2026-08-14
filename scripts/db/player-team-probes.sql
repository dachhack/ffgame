-- 0142 player-team-override probes: global read, worker-only write.
--
-- What must hold:
--   • any signed-in user reads the whole table (it is global NFL data, not
--     league data);
--   • no signed-in user writes it — only the worker (service role, bypasses
--     RLS) publishes rows;
--   • a NULL team is a storable, readable answer (free agent), distinct from
--     a row's absence.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

-- ── 0. the worker (service role / no RLS) publishes: a trade and a cut ──────
insert into player_team_override (slug, team) values
  ('traded-guy', 'KC'),
  ('cut-guy', null)
on conflict (slug) do update set team = excluded.team, updated_at = now();

-- ── 1. any signed-in user reads both, including the NULL answer ─────────────
do $$
declare n int; cut_team text; cut_found boolean;
begin
  set local role authenticated;
  perform probe_as('b');
  select count(*) into n from player_team_override where slug in ('traded-guy', 'cut-guy');
  perform assert_true(n = 2, 'pt1 signed-in reads the table');
  select team, true into cut_team, cut_found from player_team_override where slug = 'cut-guy';
  perform assert_true(cut_found and cut_team is null, 'pt2 null team is a readable answer');
  reset role;
end $$;

-- ── 2. signed-in users cannot write (worker-only channel) ───────────────────
do $$
declare denied boolean := false;
begin
  set local role authenticated;
  perform probe_as('b');
  begin
    insert into player_team_override (slug, team) values ('forged-guy', 'DAL');
  exception when insufficient_privilege or others then denied := true;
  end;
  perform assert_true(denied, 'pt3 authenticated cannot insert');
  denied := false;
  begin
    update player_team_override set team = 'DAL' where slug = 'traded-guy';
    -- RLS without an update policy silently updates 0 rows rather than
    -- erroring — either way the row must be unchanged.
    denied := not exists (select 1 from player_team_override where slug = 'traded-guy' and team = 'DAL');
  exception when insufficient_privilege or others then denied := true;
  end;
  perform assert_true(denied, 'pt4 authenticated cannot update');
  reset role;
  perform assert_true((select team from player_team_override where slug = 'traded-guy') = 'KC',
    'pt5 the worker''s row survived untouched');
end $$;

select 'ALL PLAYER-TEAM PROBES PASSED' as result;
