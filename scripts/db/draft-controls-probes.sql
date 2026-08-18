-- 0191 draft-controls probes.
--
--   • RESET clears the picks and the drafted rows and reopens the room — and
--     KEEPS the keepers, which is the one thing a reset must not undo (they
--     were never drafted);
--   • reset is typed, and a wrong word leaves every pick where it was;
--   • MOVING a team slides the others rather than swapping one out, works while
--     the draft is live, and takes the on-clock seat with it;
--   • AUTODRAFT PICKS THROUGH A PAUSE while everyone else waits — and the clock
--     stays frozen, so the pause still means what it says.
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
create or replace function dc_seed_pool(lid uuid, tag text) returns void language plpgsql as $$
begin
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', tag || '-p' || g, 'full', 'P ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 80) g));
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; code text; ord jsonb; a_seat int; b_seat int; c_seat int;
  n int; before_oc int; after_oc int; made int; picks_before int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                 '00000000-0000-0000-0000-00000000000c');

  perform probe_as('a');
  r := create_native_league('Control Room', '2024', 3, 6, 60);
  perform assert_ok(r, 'dc0 create'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'B'), 'dc0a');
  perform probe_as('c'); perform assert_ok(native_join(code, 'C'), 'dc0b');
  perform probe_as('a');
  perform dc_seed_pool(lid, 'dc');
  select array_to_json(array_agg(sleeper_roster_id order by sleeper_roster_id))::jsonb into ord
    from league_membership where league_id = lid;
  n := jsonb_array_length(ord);
  a_seat := (ord ->> 0)::int; b_seat := (ord ->> 1)::int; c_seat := (ord ->> 2)::int;
  perform assert_ok(set_draft_order(lid, ord), 'dc0c order fixed');

  -- A keeper on the board BEFORE the draft — the row a reset must not touch.
  insert into league_pool (league_id, slug, full_name, pos, team, rank)
    values (lid, 'dc-keeper', 'Kept Man', 'RB', 'PHI', 999) on conflict do nothing;
  insert into native_roster (league_id, roster_id, slug, acquired)
    values (lid, a_seat, 'dc-keeper', 'keeper') on conflict do nothing;

  perform assert_ok(start_draft(lid, null), 'dc1 draft starts');

  -- ══ MOVE A TEAM'S POSITION, MID-DRAFT ════════════════════════════════════
  before_oc := (select draft_on_clock(d.*) from draft d where d.league_id = lid);
  perform assert_true(before_oc = a_seat, 'dc2 the first seat is on the clock');
  perform probe_as('b');
  perform assert_err(commish_move_draft_slot(lid, a_seat, 3), 'commissioner only', 'dc2a members cannot reseat');
  perform probe_as('a');
  perform assert_err(commish_move_draft_slot(lid, a_seat, 9), 'position must be', 'dc2b out of range refused');
  perform assert_err(commish_move_draft_slot(lid, 999, 1), 'not in the order', 'dc2c unknown team refused');
  r := commish_move_draft_slot(lid, a_seat, 3);
  perform assert_ok(r, 'dc2d move the first seat to last');
  perform assert_true((r -> 'order' ->> 2)::int = a_seat, 'dc2e it landed last');
  -- Sliding, not swapping: the other two keep their relative order.
  perform assert_true((r -> 'order' ->> 0)::int = b_seat and (r -> 'order' ->> 1)::int = c_seat,
    'dc2f the others slid up rather than one being swapped out');
  after_oc := (select draft_on_clock(d.*) from draft d where d.league_id = lid);
  perform assert_true(after_oc = b_seat, 'dc2g the clock followed the new order');

  -- ══ AUTODRAFT THROUGH A PAUSE ════════════════════════════════════════════
  perform assert_ok(commish_pause_draft(lid), 'dc3 paused');
  select count(*)::int into picks_before from draft_pick where league_id = lid;
  -- Nobody is on autodraft yet: a tick must do nothing at all.
  r := draft_tick(lid);
  perform assert_true((select count(*)::int from draft_pick where league_id = lid) = picks_before,
    'dc3a a paused draft with no autodraft seats makes no picks');

  -- Put the seat on the clock on autodraft; now the tick picks for it.
  after_oc := (select draft_on_clock(d.*) from draft d where d.league_id = lid);
  perform assert_ok(set_autodraft(lid, after_oc, true), 'dc3b autodraft on for the seat on the clock');
  r := draft_tick(lid);
  perform assert_true((select count(*)::int from draft_pick where league_id = lid) > picks_before,
    'dc3c the autodraft seat picked WHILE PAUSED');
  perform assert_true((select paused from draft where league_id = lid) is true,
    'dc3d the draft is still paused');
  perform assert_true((select deadline_at from draft where league_id = lid) is null,
    'dc3e and the clock is still frozen');
  -- The seat AFTER it is a human with autodraft off, so the run stops there.
  perform assert_true(
    (select count(*) from league_membership m
      where m.league_id = lid
        and m.sleeper_roster_id = (select draft_on_clock(d.*) from draft d where d.league_id = lid)
        and not m.autodraft) = 1,
    'dc3f it stopped at the first seat that had not asked for it');
  perform assert_ok(commish_resume_draft(lid), 'dc3g resumed');

  -- ══ RESET ════════════════════════════════════════════════════════════════
  perform probe_as('b');
  perform assert_err(commish_reset_draft(lid, 'RESET'), 'commissioner only', 'dc4 members cannot reset');
  perform probe_as('a');
  perform assert_err(commish_reset_draft(lid, 'yes'), 'type RESET', 'dc4a the word has to be typed');
  perform assert_err(commish_reset_draft(lid, null), 'type RESET', 'dc4b null refused');
  perform assert_true((select count(*) from draft_pick where league_id = lid) > 0,
    'dc4c the refusals left every pick where it was');

  r := commish_reset_draft(lid, '  reset  ');   -- case + whitespace forgiving
  perform assert_ok(r, 'dc5 reset');
  perform assert_true((r ->> 'picks_cleared')::int > 0, 'dc5a it said how many picks went');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 0, 'dc5b picks gone');
  perform assert_true((select count(*) from native_roster where league_id = lid and acquired = 'draft') = 0,
    'dc5c drafted players off the rosters');
  perform assert_true((select count(*) from native_roster where league_id = lid and acquired = 'keeper') = 1,
    'dc5d THE KEEPER SURVIVED — it was never drafted');
  perform assert_true((select status from draft where league_id = lid) = 'pending', 'dc5e room reopened');
  perform assert_true((select current_overall from draft where league_id = lid) = 1, 'dc5f back on pick 1');
  perform assert_true((select pick_owners from draft where league_id = lid) is null, 'dc5g owner list cleared');
  perform assert_err(commish_reset_draft(lid, 'reset'), 'has not started', 'dc5h resetting a pending draft is refused');

  -- …and it can be run again from scratch.
  perform assert_ok(start_draft(lid, null), 'dc6 the draft starts over');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 0, 'dc6a a clean room');

  raise notice 'draft-controls probes done';
end $$;

select 'ALL DRAFT-CONTROLS PROBES PASSED' as result;
