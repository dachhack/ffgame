-- 0265 pool-doctor probes: one row's identity, rewritten in place.
--
-- What must hold:
--   • commissioner (or admin) only, native leagues only, the row must exist,
--     the position must be poolable;
--   • the rewrite changes WHO the slug is — name/pos/team/ids — never the
--     slug itself, and the roster row referencing it is untouched;
--   • scheduled weeks rematerialize so the fixed identity pools immediately;
--   • when the new sleeper_id already sits on ANOTHER row, that row is
--     absorbed only if nothing references it — a rostered duplicate refuses
--     the repair and names the row.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
  ('00000000-0000-0000-0000-000000000009', '9@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; snap jsonb;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
    ('00000000-0000-0000-0000-000000000009', '9@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-000000000007';
  perform probe_as('7');

  r := create_native_league('Pool Doctor', '2024', 2, 8, 60);
  perform assert_ok(r, 'pd0 fixture league'); lid := (r ->> 'league_id')::uuid;
  insert into league_pool (league_id, slug, full_name, pos, team, rank, sleeper_id) values
    (lid, 'lone-ghost',   'Lone Ghost',   'WR', 'FA',  1, '1111'),   -- retired twin squatting
    (lid, 'busy-body',    'Busy Body',    'RB', 'KC',  2, '2222'),   -- the live twin, ALSO pooled…
    (lid, 'second-ghost', 'Second Ghost', 'WR', 'FA',  3, '3333'),   -- …of this second ghost
    (lid, 'innocent',     'Innocent Man', 'QB', 'DAL', 4, '4444');
  insert into native_roster (league_id, roster_id, slug) values
    (lid, 1, 'lone-ghost'),
    (lid, 2, 'busy-body');
  r := native_generate_schedule(lid, 2);
  perform assert_ok(r, 'pd0a schedule + materialize');

  -- ══ GATES ═════════════════════════════════════════════════════════════════
  perform probe_as('9');
  r := commish_repair_pool_row(lid, 'lone-ghost', 'Real Guy', 'RB', 'KC', null, 3, '5555');
  perform assert_err(r, 'forbidden', 'pd1 a stranger cannot hold the pen');
  perform probe_as('7');
  r := commish_repair_pool_row(lid, 'nobody-here', 'Real Guy', 'RB', 'KC');
  perform assert_err(r, 'no such pool player', 'pd2 the row must exist');
  r := commish_repair_pool_row(lid, 'lone-ghost', 'Real Guy', 'OL', 'KC');
  perform assert_err(r, 'bad position', 'pd3 the position whitelist holds');

  -- ══ THE REWRITE ═══════════════════════════════════════════════════════════
  r := commish_repair_pool_row(lid, 'lone-ghost', 'Real Guy', 'RB', 'KC', '99999', 3, '5555');
  perform assert_ok(r, 'pd4 the commissioner rewrites the ghost');
  perform assert_true((select full_name from league_pool where league_id = lid and slug = 'lone-ghost') = 'Real Guy'
      and (select pos from league_pool where league_id = lid and slug = 'lone-ghost') = 'RB'
      and (select team from league_pool where league_id = lid and slug = 'lone-ghost') = 'KC'
      and (select sleeper_id from league_pool where league_id = lid and slug = 'lone-ghost') = '5555'
      and (select espn_id from league_pool where league_id = lid and slug = 'lone-ghost') = '99999'
      and (select exp from league_pool where league_id = lid and slug = 'lone-ghost') = 3,
    'pd4a the row IS the live player now');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = 1 and slug = 'lone-ghost') = 1,
    'pd4b the roster still holds the slug it drafted');
  snap := (select starters_json from sleeper_lineup where league_id = lid and week = 1 and roster_id = 1);
  perform assert_true(snap @> '[{"slug": "lone-ghost", "pos": "RB", "team": "KC"}]',
    'pd4c the weekly pool shows the repair immediately');

  -- ══ ABSORBING A DUPLICATE ═════════════════════════════════════════════════
  -- busy-body (id 2222) is ROSTERED — pointing second-ghost at 2222 must
  -- refuse rather than silently reassign seat 2's player.
  r := commish_repair_pool_row(lid, 'second-ghost', 'Busy Body', 'RB', 'KC', null, null, '2222');
  perform assert_err(r, 'in use', 'pd5 a rostered duplicate refuses the repair');
  perform assert_true((select team from league_pool where league_id = lid and slug = 'second-ghost') = 'FA',
    'pd5a …and nothing moved');
  -- Free the duplicate, then the same repair absorbs it.
  delete from native_roster where league_id = lid and roster_id = 2 and slug = 'busy-body';
  r := commish_repair_pool_row(lid, 'second-ghost', 'Busy Body', 'RB', 'KC', null, null, '2222');
  perform assert_ok(r, 'pd6 an unreferenced duplicate is absorbed');
  perform assert_true(not exists (select 1 from league_pool where league_id = lid and slug = 'busy-body'),
    'pd6a …the duplicate row is gone');
  perform assert_true((select sleeper_id from league_pool where league_id = lid and slug = 'second-ghost') = '2222',
    'pd6b …and the ghost wears its identity');

  raise notice 'pool-doctor probes done';
end $$;

select 'ALL POOL-DOCTOR PROBES PASSED' as status;
