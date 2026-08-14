-- 0144 flag-rules probes: flags that BITE (docs/flag-rules.md).
--
-- What must hold:
--   • rules ride the flag: stored sanitized, read back via player_flags;
--   • no_add refuses FA adds at the DATA (trigger), kills pending waiver
--     claims as LOST-with-note (never aborts the sweep);
--   • no_trade refuses trade execution at the DATA;
--   • draft/commish acquisitions ALWAYS pass — the override tools stay
--     overrides;
--   • no_start refuses a manager's sealed pick; the server (no uid) is
--     exempt so game ops never jam;
--   • bulk applies one label + one rule set to many; empty label bulk-clears;
--   • sanitize strips junk keys and clamps bonuses.
\set QUIET on
\pset pager off

grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
create or replace function probe_uid(u text) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-00000000000' || u)::uuid
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

-- ── 0. fixture: b commissions, c joins; pool + rosters + a matchup ──────────
do $$
declare r jsonb; lid uuid; code text; bseat int; cseat int; mid uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Flag Rules League', '2026', 4, 7, 60);
  perform assert_ok(r, 'f0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.fr_lid', lid::text, false);
  perform probe_as('c'); perform assert_ok(native_join(code, 'FR-C'), 'f1 c joins');
  select sleeper_roster_id into bseat from league_membership where league_id = lid and app_user_id = probe_uid('b');
  select sleeper_roster_id into cseat from league_membership where league_id = lid and app_user_id = probe_uid('c');
  perform set_config('probe.fr_b', bseat::text, false);
  perform set_config('probe.fr_c', cseat::text, false);

  update draft set status = 'complete' where league_id = lid;
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'fr1', 'Untouchable Guy', 'WR', 'SEA', 1),
    (lid, 'fr2', 'Benched Guy', 'RB', 'KC', 2),
    (lid, 'fr3', 'Free Guy', 'TE', 'DAL', 3),
    (lid, 'fr4', 'Waiver Guy', 'QB', 'BUF', 4);
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, bseat, 'fr1', 'draft'),
    (lid, bseat, 'fr2', 'draft');
  update league_pool set waived_until = now() - interval '1 hour' where league_id = lid and slug = 'fr4';
end $$;

-- ── 1. rules store sanitized and read back ──────────────────────────────────
do $$
declare lid uuid := current_setting('probe.fr_lid')::uuid; r jsonb; f jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  r := set_player_flag(lid, 'fr3', 'do not add', '{"no_add": true, "junk_key": true, "bonus_mult": 99, "bonus_pts": -50}'::jsonb);
  perform assert_ok(r, 'f2 flag with rules');
  select e -> 'rules' into f from jsonb_array_elements(player_flags(lid)) e where e ->> 'slug' = 'fr3';
  perform assert_true((f ->> 'no_add')::boolean, 'f3 rule stored');
  perform assert_true(f -> 'junk_key' is null, 'f4 junk key stripped');
  perform assert_true((f ->> 'bonus_mult')::numeric = 3 and (f ->> 'bonus_pts')::int = -10, 'f5 bonuses clamped');
  reset role;
end $$;

-- ── 2. no_add: FA add refused at the data; commish override still works ─────
do $$
declare lid uuid := current_setting('probe.fr_lid')::uuid;
        cseat int := current_setting('probe.fr_c')::int; blocked boolean := false;
begin
  set local role authenticated;
  perform probe_as('c');
  begin
    perform add_free_agent(lid, cseat, 'fr3');
  exception when others then blocked := sqlerrm like '%not addable%';
  end;
  perform assert_true(blocked, 'f6 FA add refused with the flag reason');
  perform assert_true(not exists (select 1 from native_roster where league_id = lid and slug = 'fr3'), 'f7 nothing landed');
  -- the commissioner's override tool bypasses (acquired = 'commish')
  perform probe_as('b');
  perform assert_ok(commish_move_player(lid, 'fr3', cseat), 'f8 commish move bypasses no_add');
  reset role;
  -- reset for later probes (as superuser — league_pool/native_roster RLS
  -- silently no-ops caller-role writes)
  delete from native_roster where league_id = lid and slug = 'fr3';
  update league_pool set waived_until = null where league_id = lid and slug = 'fr3';
end $$;

-- ── 3. no_add on waivers: pending claim marks LOST, sweep survives ──────────
do $$
declare lid uuid := current_setting('probe.fr_lid')::uuid;
        cseat int := current_setting('probe.fr_c')::int; r jsonb;
begin
  update league_pool set waived_until = now() + interval '1 minute' where league_id = lid and slug = 'fr4';
  set local role authenticated;
  perform probe_as('c');
  r := submit_waiver_claim(lid, cseat, 'fr4');
  perform assert_ok(r, 'f9 claim on unflagged player accepted');
  perform probe_as('b');
  perform assert_ok(set_player_flag(lid, 'fr4', 'suspended', '{"no_add": true}'::jsonb), 'f10 flag lands while claim pends');
  reset role;
  update league_pool set waived_until = now() - interval '1 hour' where league_id = lid and slug = 'fr4';
  set local role authenticated;
  perform probe_as('b');
  r := process_waivers(lid);
  perform assert_ok(r, 'f11 sweep survives the flag');
  perform assert_true((select status from waiver_claim where league_id = lid and add_slug = 'fr4' order by created_at desc limit 1) = 'lost',
    'f12 claim lost, not granted');
  perform assert_true((select note from waiver_claim where league_id = lid and add_slug = 'fr4' order by created_at desc limit 1) like '%flagged%',
    'f13 lost with the commissioner note');
  reset role;
end $$;

-- ── 4. no_trade: execution refused at the data ──────────────────────────────
do $$
declare lid uuid := current_setting('probe.fr_lid')::uuid;
        bseat int := current_setting('probe.fr_b')::int;
        cseat int := current_setting('probe.fr_c')::int;
        r jsonb; tid uuid; blocked boolean := false;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_player_flag(lid, 'fr1', 'franchise-tagged', '{"no_trade": true}'::jsonb), 'f14 no_trade flag');
  r := propose_trade(lid, bseat, cseat, '["fr1"]'::jsonb, '[]'::jsonb);
  perform assert_ok(r, 'f15 proposing still works (the gate is at execution)');
  tid := (r ->> 'trade_id')::uuid;
  perform probe_as('c');
  begin
    perform respond_trade(tid, true);
  exception when others then blocked := sqlerrm like '%not tradeable%';
  end;
  perform assert_true(blocked, 'f16 execution refused with the flag reason');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = bseat and slug = 'fr1'),
    'f17 player never moved');
  reset role;
end $$;

-- ── 5. no_start: manager pick refused; the server stays exempt ──────────────
do $$
declare lid uuid := current_setting('probe.fr_lid')::uuid;
        bseat int := current_setting('probe.fr_b')::int;
        cseat int := current_setting('probe.fr_c')::int;
        mid uuid; blocked boolean := false;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_player_flag(lid, 'fr2', 'ruled ineligible', '{"no_start": true}'::jsonb), 'f18 no_start flag');
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 5, bseat, cseat, 'scheduled') returning id into mid;
  set local role authenticated;
  perform probe_as('b');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid, probe_uid('b'), 'snf', 'S1', 'fr2');
  exception when others then blocked := sqlerrm like '%not startable%';
  end;
  perform assert_true(blocked, 'f19 manager pick refused');
  reset role;
  -- the server (no uid) still writes freely — auto-lineups never jam
  perform set_config('app.uid', '', false);
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, probe_uid('b'), 'snf', 'S1', 'fr2');
  perform assert_true(true, 'f20 server writes exempt');
  perform probe_as('b');
end $$;

-- ── 6. bulk: one call, many players; empty label bulk-clears ────────────────
do $$
declare lid uuid := current_setting('probe.fr_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  r := set_player_flags_bulk(lid, array['fr3', 'fr4'], 'holdout', '{"no_start": true, "no_trade": true}'::jsonb);
  perform assert_ok(r, 'f21 bulk set');
  perform assert_true((r ->> 'count')::int = 2, 'f22 both applied');
  perform assert_true((select count(*) from player_flag where league_id = lid
      and coalesce((rules ->> 'no_start')::boolean, false) and label = 'holdout') = 2, 'f23 same label+rules on both');
  perform probe_as('c');
  r := set_player_flags_bulk(lid, array['fr3'], 'coup', '{}'::jsonb);
  perform assert_true(not coalesce((r ->> 'ok')::boolean, false), 'f24 member cannot bulk');
  perform probe_as('b');
  r := set_player_flags_bulk(lid, array['fr3', 'fr4'], null, '{}'::jsonb);
  perform assert_ok(r, 'f25 empty label bulk-clears');
  perform assert_true(not exists (select 1 from player_flag where league_id = lid and slug in ('fr3', 'fr4')), 'f26 cleared');
  reset role;
end $$;

select 'ALL FLAG-RULES PROBES PASSED' as result;
