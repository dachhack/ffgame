-- 0194 edit-a-made-pick probes.
--
--   • a pick can be REPLACED in place — same seat, same overall — with the old
--     player handed back to the pool and the new one on the roster;
--   • a pick can be REMOVED, leaving the cell empty and the seat one short,
--     without renumbering anything or moving the clock;
--   • the seat's POSITION LIMITS are re-checked, counting the player being
--     replaced as already gone, and a refused edit changes nothing at all;
--   • and every obvious wrong turn is refused: a member, an overall with no
--     pick, a player already rostered, a player outside the pool.
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
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; first_pick draft_pick%rowtype; seat int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  r := create_native_league('Fix My Pick', '2024', 2, 6, 60);
  perform assert_ok(r, 'ep0 create'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'EP-B'), 'ep0a join');
  perform probe_as('a');
  -- A pool with two positions, so the cap check has something to bite on.
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'ep-rb' || g, 'full', 'RB ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 30) g));
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', s, 'full', s, 'pos', p, 'team', 'KC'))
    from (values ('ep-rb1','RB'),('ep-rb2','RB'),('ep-rb3','RB'),('ep-rb4','RB'),('ep-rb5','RB'),
                 ('ep-rb6','RB'),('ep-rb7','RB'),('ep-rb8','RB'),('ep-rb9','RB'),('ep-rb10','RB'),
                 ('ep-rb11','RB'),('ep-rb12','RB'),('ep-rb13','RB'),('ep-rb14','RB'),('ep-rb15','RB'),
                 ('ep-qb1','QB'),('ep-qb2','QB'),('ep-qb3','QB'),('ep-qb4','QB'),('ep-qb5','QB')) v(s, p)));
  perform assert_ok(start_draft(lid, null), 'ep1 draft starts');

  -- Two picks on the board.
  perform assert_ok(commish_force_pick(lid, 'ep-rb1'), 'ep1a pick 1');
  perform assert_ok(commish_force_pick(lid, 'ep-rb2'), 'ep1b pick 2');
  select * into first_pick from draft_pick where league_id = lid and overall = 1;
  seat := first_pick.roster_id;
  perform assert_true(first_pick.slug = 'ep-rb1', 'ep1c pick 1 is who we think');

  -- ══ REFUSALS ═════════════════════════════════════════════════════════════
  perform probe_as('b');
  perform assert_err(commish_edit_pick(lid, 1, 'ep-rb3'), 'commissioner only', 'ep2 a member cannot edit a pick');
  perform probe_as('a');
  perform assert_err(commish_edit_pick(lid, 99, 'ep-rb3'), 'no pick at that overall', 'ep2a an empty overall');
  perform assert_err(commish_edit_pick(lid, 1, 'ep-rb2'), 'already on a roster', 'ep2b a player somebody else holds');
  perform assert_err(commish_edit_pick(lid, 1, 'nobody-at-all'), 'not in this league', 'ep2c a player outside the pool');
  perform assert_err(commish_edit_pick(lid, 1, 'ep-rb1'), 'already the pick', 'ep2d replacing him with himself');
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 1) = 'ep-rb1',
    'ep2e every refusal left the pick alone');

  -- ══ REPLACE ══════════════════════════════════════════════════════════════
  r := commish_edit_pick(lid, 1, 'ep-qb1');
  perform assert_ok(r, 'ep3 replace pick 1');
  perform assert_true(r ->> 'action' = 'replaced' and r ->> 'was' = 'ep-rb1', 'ep3a it says what it did');
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 1) = 'ep-qb1',
    'ep3b the board shows the new player');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = seat and slug = 'ep-qb1'),
    'ep3c and he is on the seat''s roster');
  perform assert_true(not exists (select 1 from native_roster where league_id = lid and slug = 'ep-rb1'),
    'ep3d while the old player went back to the pool');
  -- Same overall, same seat: nothing renumbered.
  perform assert_true((select roster_id from draft_pick where league_id = lid and overall = 1) = seat,
    'ep3e the pick still belongs to the seat that made it');

  -- ══ POSITION LIMITS STILL BITE ═══════════════════════════════════════════
  -- One QB per roster; the seat now holds ep-qb1, so a second is refused…
  perform assert_ok(set_roster_rules(lid, null, '{"QB":1,"RB":null,"WR":null,"TE":null,"K":null,"DEF":null}'::jsonb),
    'ep4 QB limit of 1');
  perform assert_ok(commish_force_pick(lid, 'ep-rb4'), 'ep4a a third pick for the other seat');
  -- …but replacing the QB he already has with a DIFFERENT QB must be allowed,
  -- because the one being replaced is on his way out.
  r := commish_edit_pick(lid, 1, 'ep-qb2');
  perform assert_ok(r, 'ep4b QB-for-QB is legal — the outgoing one does not count against the cap');
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 1) = 'ep-qb2', 'ep4c swapped');

  -- ══ REMOVE ═══════════════════════════════════════════════════════════════
  r := commish_edit_pick(lid, 1, null);
  perform assert_ok(r, 'ep5 remove pick 1');
  perform assert_true(r ->> 'action' = 'removed', 'ep5a it says so');
  perform assert_true(not exists (select 1 from draft_pick where league_id = lid and overall = 1),
    'ep5b the cell is empty');
  perform assert_true(not exists (select 1 from native_roster where league_id = lid and slug = 'ep-qb2'),
    'ep5c and the player is back in the pool');
  -- The picks around it are untouched — no renumbering, no shuffling up.
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 2, 'ep5d the other picks stand');
  perform assert_true(exists (select 1 from draft_pick where league_id = lid and overall = 2 and slug = 'ep-rb2'),
    'ep5e including the one that came after it');
  -- And the removed player can be drafted again by anyone.
  perform assert_ok(commish_edit_pick(lid, 2, 'ep-qb2'), 'ep5f the freed player is available again');

  raise notice 'edit-pick probes done';
end $$;

select 'ALL EDIT-PICK PROBES PASSED' as result;
