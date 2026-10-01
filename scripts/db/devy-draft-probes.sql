-- 0411 probes: THE DEVY DRAFT — devy rounds at the end of the draft; college
-- players in them and only in them; devy picks that trade.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function dd_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dd_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function dd_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function dd_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000061' || u, false); perform set_config('app.email', 'dd' || u || '@test.dev', false); end $$;
-- run the draft to the end by autopick, the way draft_tick does
create or replace function dd_autodraft(p_lid uuid) returns int language plpgsql as $$
declare d draft%rowtype; pick text; r jsonb; n int := 0;
begin
  loop
    select * into d from draft where league_id = p_lid;
    exit when d.status <> 'live';
    pick := coalesce(native_queue_pick(p_lid, draft_on_clock(d)), native_autopick_slug(p_lid, draft_on_clock(d), d.rounds));
    if pick is null then raise exception 'PROBE FAIL autopick found nothing at pick %', d.current_overall; end if;
    r := native_exec_pick(p_lid, pick, true);
    if not coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL autopick % refused at pick %: %', pick, d.current_overall, r; end if;
    n := n + 1;
    exit when n > 500;
  end loop;
  return n;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000006101', 'dd01@test.dev'), ('00000000-0000-0000-0000-000000006102', 'dd02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000006101', 'dd01@test.dev'), ('00000000-0000-0000-0000-000000006102', 'dd02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-0000000061%';
insert into app_admin (email, note) values ('dd01@test.dev', 'devy draft probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; dyn uuid; code text; d draft%rowtype; pool jsonb := '[]'::jsonb; i int; nr int; st jsonb;
        lseas text; fut text; o jsonb;
begin
  -- ══ dd1. A STARTUP WITH A DEVY BLOCK ══
  perform dd_as('01');
  r := create_native_league('Devy Draft', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform dd_as('02'); perform dd_ok(native_join(code, 'DD-2'), 'dd0 join'); perform dd_as('01');
  perform dd_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'dd0 COLLEGE on');
  update league set settings_json = settings_json - 'roster_slots' where id = lid;
  perform dd_err(set_devy_rounds(lid, 1), 'devy spots', 'dd1 devy rounds need devy spots');
  perform dd_ok(set_league_roster_shape(lid, 1, 0, 0, 0, 2), 'dd1a two devy spots');
  perform dd_err(set_devy_rounds(lid, 3), '0–2', 'dd1b no more devy rounds than devy spots');
  perform dd_ok(set_devy_rounds(lid, 2), 'dd1c two devy rounds');
  select draft.rounds into nr from draft where league_id = lid;
  -- a pool: plenty of NFL, six college
  for i in 1..40 loop
    pool := pool || jsonb_build_object('slug', 'dd-n' || i, 'full', 'Nfl ' || i,
      'pos', (array['QB','RB','WR','TE','K','DEF','RB','WR'])[1 + (i % 8)], 'team', 'BUF');
  end loop;
  for i in 1..6 loop
    pool := pool || jsonb_build_object('slug', 'c-96100' || i, 'full', 'College ' || i, 'pos', 'WR');
  end loop;
  perform dd_ok(seed_league_pool(lid, pool), 'dd1d pool');
  st := draft_state(lid);
  perform dd_true((st ->> 'devy_rounds')::int = 2 and (st ->> 'rounds')::int = nr,
    'dd1e pending: the plan says 2 devy rounds, same total length (got ' || (st ->> 'rounds') || ' of ' || nr || ')');
  perform dd_ok(start_draft(lid, '[1,2]'::jsonb), 'dd1f start');
  select * into d from draft where league_id = lid;
  perform dd_true(d.devy_rounds = 2 and d.devy_from = (nr - 2) * 2 + 1 and jsonb_array_length(d.pick_owners) = nr * 2,
    'dd1g the block is the last two rounds (from ' || d.devy_from || ')');
  perform dd_true((draft_state(lid) ->> 'devy_from')::int = d.devy_from, 'dd1h the room is told');
  perform dd_err(native_exec_pick(lid, 'c-961001', false), 'devy rounds', 'dd2 a college player before the block is refused');
  -- the queue skips what this pick can't take
  insert into draft_queue (league_id, roster_id, slug, pos) values (lid, 1, 'c-961002', 1), (lid, 1, 'dd-n3', 2);
  perform dd_true(native_queue_pick(lid, 1) = 'dd-n3', 'dd2a the queue skips the college player in an NFL round');
  delete from draft_queue where league_id = lid;
  -- run to the block
  loop
    select * into d from draft where league_id = lid;
    exit when d.current_overall >= d.devy_from;
    perform dd_ok(native_exec_pick(lid, native_autopick_slug(lid, draft_on_clock(d), d.rounds), true), 'dd3 main-round autopick');
  end loop;
  perform dd_true(not exists (select 1 from draft_pick where league_id = lid and slug ~ '^c-'), 'dd3a the main rounds took no college player');
  perform dd_err(native_exec_pick(lid, 'dd-n40', false), 'devy round', 'dd3b an NFL player in the block is refused');
  perform dd_true(native_autopick_slug(lid, draft_on_clock(d), d.rounds) ~ '^c-', 'dd3c autopick takes a college player in the block');
  perform dd_true(dd_autodraft(lid) = 4, 'dd3d four devy picks');
  perform dd_true((select status from draft where league_id = lid) = 'complete', 'dd3e the draft completes');
  perform dd_true((select count(*) from native_roster where league_id = lid and spot = 'devy') = 4
    and (select count(*) from native_roster where league_id = lid and spot = 'devy' and roster_id = 1) = 2,
    'dd3f every team''s devy spots are filled by the block');

  -- ══ dd4. DEVY PICKS THAT TRADE ══
  r := create_native_league('Devy Dynasty', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic', 'dynasty');
  perform dd_ok(r, 'dd4 a dynasty league'); dyn := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform dd_as('02'); perform dd_ok(native_join(code, 'DD-2'), 'dd4 join'); perform dd_as('01');
  perform dd_ok(set_league_position_access(dyn, '["COLLEGE"]'::jsonb), 'dd4 COLLEGE on');
  update league set settings_json = settings_json - 'roster_slots' where id = dyn;
  perform dd_ok(set_league_roster_shape(dyn, 1, 0, 0, 0, 2), 'dd4 devy spots');
  perform dd_ok(set_rookie_rounds(dyn, 2), 'dd4a two rookie rounds');
  fut := _future_pick_season(dyn);
  perform dd_ok(set_devy_rounds(dyn, 2), 'dd4b two devy rounds');
  perform dd_true((select count(*) from pick_asset where league_id = dyn and season = fut and round > 100) = 4,
    'dd4c next year''s devy picks exist: rounds 101–102 for both teams');
  perform dd_ok(set_rookie_rounds(dyn, 3), 'dd4d rookie rounds change');
  perform dd_true((select count(*) from pick_asset where league_id = dyn and season = fut and round > 100) = 4
    and (select count(*) from pick_asset where league_id = dyn and season = fut and round < 100) = 6,
    'dd4e the devy picks are untouched by the rookie setting');
  -- a trade moves team 1's devy 1st to team 2
  update pick_asset set owner_roster = 2 where league_id = dyn and season = fut and round = 101 and original_roster = 1;
  perform dd_err(set_devy_rounds(dyn, 0), 'trades already moved devy picks', 'dd4f a traded devy pick can''t be deleted by a setting');
  perform dd_ok(set_devy_rounds(dyn, 1), 'dd4g shrinking to the traded round is fine');
  perform dd_true((select count(*) from pick_asset where league_id = dyn and season = fut and round > 100) = 2, 'dd4h round 102 went');

  -- this season's draft, run on assets: rookie rounds then the devy block,
  -- each pick its owner's
  select season into lseas from league where id = dyn;
  perform dd_ok(_provision_pick_assets(dyn, lseas, 1), 'dd5 own-season assets: one rookie round (+ devy)');
  update pick_asset set owner_roster = 2 where league_id = dyn and season = lseas and round = 101 and original_roster = 1;
  pool := '[]'::jsonb;
  for i in 1..10 loop pool := pool || jsonb_build_object('slug', 'dd-d' || i, 'full', 'Dyn ' || i, 'pos', 'RB', 'team', 'KC'); end loop;
  for i in 1..4 loop pool := pool || jsonb_build_object('slug', 'c-96110' || i, 'full', 'Dcol ' || i, 'pos', 'RB'); end loop;
  perform dd_ok(seed_league_pool(dyn, pool), 'dd5a pool');
  st := draft_state(dyn);
  perform dd_true((st ->> 'rounds')::int = 2, 'dd5b pending preview counts rounds, not the highest asset round (got ' || (st ->> 'rounds') || ')');
  perform dd_ok(start_draft(dyn, '[1,2]'::jsonb), 'dd5c start');
  select * into d from draft where league_id = dyn;
  perform dd_true(d.pick_owners = '[1,2,2,2]'::jsonb and d.devy_from = 3,
    'dd5d one rookie round, then the devy round — team 2 owns team 1''s devy pick (got ' || d.pick_owners::text || ')');
  -- mid-draft, the devy picks are where the block puts them
  perform dd_true(_pick_overall(dyn, 101, 1, false) = 3 and _pick_overall(dyn, 101, 2, false) = 4, 'dd5e a devy pick knows its place in the block');
  perform dd_true(_pick_locked_error(dyn, lseas, 101, 1) is null, 'dd5f not used yet: tradeable');
  perform dd_true(dd_autodraft(dyn) = 4, 'dd5g four picks');
  perform dd_true((select count(*) from native_roster where league_id = dyn and roster_id = 2 and spot = 'devy') = 2,
    'dd5h the traded devy pick made a devy player for its owner');

  -- a devy market league can't have devy rounds
  update league set settings_json = settings_json || '{"devy_mode":"shares"}'::jsonb where id = lid;
  perform dd_err(set_devy_rounds(lid, 1), 'devy market', 'dd6 shares leagues reserve through shares');
  perform dd_true(_devy_rounds(lid) = 0, 'dd6a and none runs');
  raise notice 'devy draft probes done';
end $$;

select 'ALL DEVY-DRAFT PROBES PASSED' as result;
