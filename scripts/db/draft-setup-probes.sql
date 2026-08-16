-- 0176 draft-setup probes: change the draft before it starts, set the order
-- in advance, and the 48h pick-clock constraint fix.
--
-- What must hold:
--   • set_draft_setup is commissioner-only and PENDING-ONLY;
--   • nulls mean "unchanged", so one field can move without restating the rest;
--   • the target state is validated as a WHOLE (switching to auction with a
--     stored budget smaller than the roster must be refused, not stored);
--   • settings_json.mode follows draft.mode, or the league preview lies;
--   • set_draft_order accepts a full order, randomises on null, refuses a
--     partial one, and freezes at the draft;
--   • start_draft HONOURS a pre-set order, but rechecks it against the
--     current seats and falls back to random when it's stale;
--   • a 48h pick clock survives the INSERT (0064's CHECK said 24h while the
--     RPC and the UI both promised 48 — reproduced before it was fixed).
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
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text; ord jsonb; i int;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');

  -- ds0: THE CONSTRAINT FIX. A 48-hour pick clock is exactly what the create
  -- screen's SLOW pace offers at its maximum; before 0176 this raised
  -- draft_pick_seconds_check and no league was created at all.
  r := create_native_league('Slow Draft League', '2026', 4, 12, 172800);
  perform assert_ok(r, 'ds0 48h pick clock creates');
  perform assert_true((select pick_seconds from draft where league_id = (r ->> 'league_id')::uuid) = 172800,
    'ds0a stored at 48h');

  r := create_native_league('Setup League', '2026', 4, 7, 60);
  perform assert_ok(r, 'ds1 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'DS-C'), 'ds1a c joins');

  -- permissions
  perform assert_err(set_draft_setup(lid, 120), 'commissioner only', 'ds2 member refused');
  perform assert_err(set_draft_order(lid), 'commissioner only', 'ds2a member refused on order');

  -- ds3: nulls leave everything alone; one field moves on its own
  perform probe_as('b');
  r := set_draft_setup(lid, 120);
  perform assert_ok(r, 'ds3 pick clock changes');
  perform assert_true((r ->> 'pick_seconds')::int = 120, 'ds3a new clock');
  perform assert_true(r ->> 'mode' = 'snake', 'ds3b mode untouched by a clock-only call');
  perform assert_true((r ->> 'budget')::int = 200, 'ds3c budget untouched');

  -- ds4: validation mirrors create
  perform assert_err(set_draft_setup(lid, 5), 'pick clock', 'ds4 clock floor');
  perform assert_err(set_draft_setup(lid, 200000), 'pick clock', 'ds4a clock ceiling');
  perform assert_err(set_draft_setup(lid, null, 'lottery'), 'snake or auction', 'ds4b unknown mode');
  perform assert_true((select pick_seconds from draft where league_id = lid) = 120,
    'ds4c a refused call changed nothing');

  -- ds5: THE WHOLE-STATE CHECK. Rounds is 7, so a $5 budget can't cover the
  -- roster — switching to auction must be refused even though 'auction' alone
  -- and 5 alone are each individually shaped fine.
  perform assert_ok(set_draft_setup(lid, null, null, 5), 'ds5 budget stored while still snake');
  perform assert_err(set_draft_setup(lid, null, 'auction'), 'budget must cover', 'ds5a auction refused on the stored budget');
  perform assert_true((select mode from draft where league_id = lid) = 'snake', 'ds5b still snake after the refusal');
  -- …and the same call succeeds when the budget comes with it
  r := set_draft_setup(lid, null, 'auction', 100, 20, 2);
  perform assert_ok(r, 'ds5c auction with a workable budget');
  perform assert_true(r ->> 'mode' = 'auction' and (r ->> 'max_lots')::int = 2, 'ds5d auction knobs stored');
  perform assert_err(set_draft_setup(lid, null, null, null, null, 9), 'lots at once', 'ds5e lots ceiling');

  -- ds6: the league LISTING must follow, or a joiner previews the wrong draft
  perform assert_true((select settings_json ->> 'mode' from league where id = lid) = 'auction',
    'ds6 settings_json.mode follows draft.mode');
  perform assert_ok(set_draft_setup(lid, null, 'snake'), 'ds6a back to snake');
  perform assert_true((select settings_json ->> 'mode' from league where id = lid) = 'snake', 'ds6b and back again');

  -- ds7: the order, set in advance and readable before the draft starts
  perform assert_err(set_draft_order(lid, '[1,2]'::jsonb), 'every roster once', 'ds7 partial order refused');
  perform assert_err(set_draft_order(lid, '[1,2,3,3]'::jsonb), 'every roster once', 'ds7a duplicate refused');
  perform assert_err(set_draft_order(lid, '[1,2,3,99]'::jsonb), 'every roster once', 'ds7b stranger refused');
  r := set_draft_order(lid, '[4,3,2,1]'::jsonb);
  perform assert_ok(r, 'ds7c explicit order saves');
  perform assert_true((select draft_order from draft where league_id = lid) = '[4,3,2,1]'::jsonb,
    'ds7d visible on the draft row before it starts');
  -- null randomises: still every roster exactly once
  r := set_draft_order(lid);
  perform assert_ok(r, 'ds7e null randomises');
  perform assert_true(jsonb_array_length(r -> 'order') = 4, 'ds7f four seats');
  perform assert_true((select count(distinct v.x) from (select (jsonb_array_elements_text(r -> 'order'))::int as x) v) = 4,
    'ds7g each seat exactly once');

  -- ds8: START HONOURS THE PRE-SET ORDER
  perform assert_ok(set_draft_order(lid, '[2,4,1,3]'::jsonb), 'ds8 set the reveal order');
  perform assert_ok(seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'ds-p' || g, 'full', 'DS P' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 40) g)), 'ds8a pool seeded');
  r := start_draft(lid);
  perform assert_ok(r, 'ds8b draft starts');
  perform assert_true(r -> 'order' = '[2,4,1,3]'::jsonb, 'ds8c started on the order the league was shown');
  perform assert_true((r ->> 'preset')::boolean, 'ds8d and says so');
  -- waiver priority is reverse draft order — proves the honoured order is the
  -- one that actually drove the league, not just what the result echoed
  perform assert_true((select waiver_priority from league_membership
    where league_id = lid and sleeper_roster_id = 2) = 4, 'ds8e first picker gets last waiver priority');

  -- ds9: everything freezes once the draft is live
  perform assert_err(set_draft_setup(lid, 300), 'locks once the draft starts', 'ds9 setup frozen');
  perform assert_err(set_draft_order(lid), 'locks once the draft starts', 'ds9a order frozen');

  -- ds10: a STALE pre-set order is not trusted. Set an order, then add a seat;
  -- honouring the old list would drop the new team out of the draft entirely.
  r := create_native_league('Stale Order League', '2026', 3, 7, 60);
  perform assert_ok(r, 'ds10 create');
  lid := (r ->> 'league_id')::uuid;
  perform assert_ok(set_draft_order(lid, '[3,1,2]'::jsonb), 'ds10a order for three seats');
  reset role;
  insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
  values (lid, 4, 'Late Team', false);
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'st-p' || g, 'full', 'ST P' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 40) g)), 'ds10b pool seeded');
  r := start_draft(lid);
  perform assert_ok(r, 'ds10c starts anyway');
  perform assert_true((r ->> 'preset')::boolean is not true, 'ds10d stale order NOT honoured');
  perform assert_true(jsonb_array_length(r -> 'order') = 4, 'ds10e every seat drafted, including the late one');
  perform assert_true((select count(distinct v.x) from (select (jsonb_array_elements_text(r -> 'order'))::int as x) v) = 4,
    'ds10f and each exactly once');

  -- ds11: an explicit order passed to start_draft still wins over a pre-set one
  r := create_native_league('Explicit Wins League', '2026', 3, 7, 60);
  perform assert_ok(r, 'ds11 create');
  lid := (r ->> 'league_id')::uuid;
  perform assert_ok(set_draft_order(lid, '[1,2,3]'::jsonb), 'ds11a pre-set');
  perform assert_ok(seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'ew-p' || g, 'full', 'EW P' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 40) g)), 'ds11b pool seeded');
  r := start_draft(lid, '[3,2,1]'::jsonb);
  perform assert_ok(r, 'ds11c starts');
  perform assert_true(r -> 'order' = '[3,2,1]'::jsonb, 'ds11d the call''s order wins');
end $$;

select 'ALL DRAFT-SETUP PROBES PASSED' as status;
