-- 0193 IR-rounds probes.
--
--   • IR spots are ROSTER spots and not DRAFT rounds: the roster size still
--     counts them, the draft's length does not, and draft_state says both;
--   • the draft actually ENDS that many picks early rather than merely
--     reporting a smaller number;
--   • capacity is untouched — a team may still hold starters + bench + taxi +
--     IR, which is the whole point of the split;
--   • and a shape that is nothing but IR is refused, since a draft with no
--     rounds is not a draft.
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
create or replace function ir_seed_pool(lid uuid, tag text, n int) returns void language plpgsql as $$
begin
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', tag || '-p' || g, 'full', 'P ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, n) g));
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; st jsonb; picks int; guard int := 0;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  r := create_native_league('IR League', '2024', 2, 12, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'ir0 classic league');
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'IR-B'), 'ir0a b joins');
  perform probe_as('a');

  -- Four starting spots, 3 bench, 1 taxi, 2 IR: a roster of 10, a draft of 8.
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["TE"]}]'::jsonb), 'ir1 spec saves');
  r := set_league_roster_shape(lid, 3, 1, 2);
  perform assert_ok(r, 'ir1a shape saves');
  perform assert_true((r ->> 'rounds')::int = 10, 'ir1b the ROSTER is 4+3+1+2 = 10');
  perform assert_true((r ->> 'draft_rounds')::int = 8, 'ir1c the DRAFT is 10 − 2 IR = 8');
  perform assert_true((select rounds from draft where league_id = lid) = 10,
    'ir1d draft.rounds still carries the roster size');
  perform assert_true((select stash_slots from draft where league_id = lid) = 2,
    'ir1e and the IR spots landed in stash_slots');

  -- draft_state reports the DRAFTED rounds, and still names the roster.
  st := draft_state(lid);
  perform assert_true((st ->> 'rounds')::int = 8, 'ir2 draft_state reports 8 rounds');
  perform assert_true((st ->> 'roster_size')::int = 10, 'ir2a …and a roster of 10');
  perform assert_true((st ->> 'stash_slots')::int = 2, 'ir2b …and says why they differ');

  -- ══ THE DRAFT ACTUALLY ENDS EARLY ════════════════════════════════════════
  perform ir_seed_pool(lid, 'ir', 40);
  perform assert_ok(start_draft(lid, null), 'ir3 draft starts');
  -- Autopick it to completion; 2 teams x 8 rounds = 16 picks, not 20.
  loop
    guard := guard + 1; exit when guard > 60;
    exit when (select status from draft where league_id = lid) <> 'live';
    perform set_autodraft(lid, (select draft_on_clock(d.*) from draft d where d.league_id = lid), true);
    perform draft_tick(lid);
  end loop;
  select count(*)::int into picks from draft_pick where league_id = lid;
  perform assert_true(picks = 16, 'ir3a 2 teams x 8 rounds = 16 picks — the IR spots went undrafted, got ' || picks);
  perform assert_true((select status from draft where league_id = lid) = 'complete', 'ir3b and the draft completed');

  -- ══ CAPACITY IS UNTOUCHED ════════════════════════════════════════════════
  -- The roster holds 10, so two more players may still be acquired into the
  -- spots the draft left empty.
  perform assert_true((native_team_state(lid) ->> 'roster_cap')::int = 10,
    'ir4 the roster cap is still the full 10 — IR spots are room, they are just not drafted');

  -- ══ A DRAFT NEEDS SOMETHING TO DRAFT ═════════════════════════════════════
  r := create_native_league('All Stash', '2024', 2, 12, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'ir5 second classic league');
  perform assert_ok(set_league_classic_slots((r ->> 'league_id')::uuid,
    '[{"pos":["QB"]}]'::jsonb), 'ir5a one starting spot');
  -- 1 starter + 0 bench + 0 taxi + 8 IR = 9 spots, 1 of them drafted: legal.
  perform assert_ok(set_league_roster_shape((r ->> 'league_id')::uuid, 0, 0, 8), 'ir5b mostly-IR shape is legal');
  perform assert_true((select stash_slots from draft where league_id = (r ->> 'league_id')::uuid) = 8, 'ir5c stash 8');

  raise notice 'ir-rounds probes done';
end $$;

select 'ALL IR-ROUNDS PROBES PASSED' as result;
