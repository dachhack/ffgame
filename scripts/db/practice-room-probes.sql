-- 0281 probes: a practice room is this league's draft, from your seat.
--
-- What must hold:
--   • ANY enrolled member can make one — not just the commissioner, and
--     crucially not only people carrying the `native` feature flag, since
--     native_join has never required it (that gate move is the migration);
--   • it inherits the game mode, roster size, draft mode, clocks and caps, and
--     the source league's POOL, row for row;
--   • the slot you ask for is the slot you pick from;
--   • the real league is not touched in any way;
--   • it is a mock: no joining, deletable, and old ones sweep themselves.
\set QUIET on
\pset pager off

create or replace function pr_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function pr_no(r jsonb, want text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, true) is not false then
    raise exception 'PROBE FAIL % — expected a refusal, got %', msg, r;
  end if;
  if position(want in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — refused for the wrong reason: %', msg, r ->> 'error';
  end if;
end $$;
create or replace function pr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function pr_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000c0c0' || u, false);
  perform set_config('app.email', 'pr' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0c01', 'pr1@test.dev'),
  ('00000000-0000-0000-0000-0000000c0c02', 'pr2@test.dev'),
  ('00000000-0000-0000-0000-0000000c0c03', 'pr3@test.dev'),
  ('00000000-0000-0000-0000-0000000c0c09', 'pr9@test.dev')
on conflict (id) do nothing;

-- ── fixture: a CLASSIC 4-team league, pool seeded, draft not yet started ───
do $$
declare lid uuid; r jsonb; i int; code text;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000c0c01', 'pr1@test.dev'),
    ('00000000-0000-0000-0000-0000000c0c02', 'pr2@test.dev'),
    ('00000000-0000-0000-0000-0000000c0c03', 'pr3@test.dev'),
    ('00000000-0000-0000-0000-0000000c0c09', 'pr9@test.dev') on conflict (id) do nothing;
  -- ONLY the commissioner carries the native flag. pr2 and pr3 join by code,
  -- exactly as a real playtester does — and the practice room has to work for
  -- them, which is the reason the builder's gate moved in 0281.
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000c0c01';
  perform pr_as('1');
  r := create_native_league('Practice Source', '2026', 4, 8, 45, 'snake', 200, 15, 1,
                            null, null, '{"QB": 2}'::jsonb, 'classic');
  perform pr_ok(r, 'pr0 a classic source league is created');
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform set_config('probe.pr_lid', lid::text, false);
  perform pr_as('2'); perform pr_ok(native_join(code, 'Second Team'), 'pr0a pr2 joins by code');
  perform pr_as('3'); perform pr_ok(native_join(code, 'Third Team'), 'pr0b pr3 joins by code');
  perform pr_true(not has_native(), 'pr0c and a joiner does NOT carry the native flag');
  reset role;
  for i in 1..60 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'pr-' || i, 'PR ' || i, (array['QB','RB','WR','TE'])[1 + (i % 4)], 'PRT', i)
      on conflict do nothing;
  end loop;
  -- a pool row only this league has, to prove the copy is THIS board
  update league_pool set full_name = 'Repaired Twin' where league_id = lid and slug = 'pr-7';
end $$;

-- ── 1. a plain member, no flag, no badge, gets a room of their own ─────────
do $$
declare lid uuid := current_setting('probe.pr_lid')::uuid; mid uuid; r jsonb; n int;
begin
  perform pr_as('2');
  perform pr_true(not has_native(), 'pr1 pr2 still has no native flag');
  perform pr_true(not is_league_commish(lid), 'pr1a and is not the commissioner');
  perform pr_no(create_native_league('Nope', '2026', 4), 'invite-only',
    'pr1b — and cannot create a real league, so the gate still guards what it guarded');
  r := create_mock_from_league(lid, 3);
  perform pr_ok(r, 'pr2 but CAN open a practice room');
  mid := (r ->> 'league_id')::uuid;
  perform set_config('probe.pr_mid', mid::text, false);

  perform pr_true((select is_mock from league where id = mid), 'pr3 it is a mock');
  perform pr_true((r ->> 'slot')::int = 3, 'pr4 at the slot asked for');
  perform pr_true((select settings_json ->> 'game_mode' from league where id = mid) = 'classic',
    'pr5 CLASSIC, like the league it practises — not the drip default');
  perform pr_true((select settings_json -> 'pos_caps' from league where id = mid) = '{"QB": 2}'::jsonb,
    'pr6 with the same position caps');
  perform pr_true((select rounds = 8 and pick_seconds = 45 and mode = 'snake'
                     from draft where league_id = mid), 'pr7 same roster size, clock and mode');
  perform pr_true((select keeper_slots = 0 and stash_slots = 0 from draft where league_id = mid),
    'pr8 and no keepers — a practice room drafts the whole roster');

  -- the board is the league's board, not a rebuilt one
  select count(*) into n from league_pool where league_id = mid;
  perform pr_true(n = 60, 'pr9 the whole pool came across');
  perform pr_true((select full_name from league_pool where league_id = mid and slug = 'pr-7') = 'Repaired Twin',
    'pr10 including the edit only this league''s pool carries');

  -- the room wears the league's names
  perform pr_true((select count(*) from league_membership
                    where league_id = mid and controller = 'ai') = 3, 'pr11 three AI seats');
  perform pr_true(exists (select 1 from league_membership
                    where league_id = mid and team_name = 'Third Team' and controller = 'ai'),
    'pr12 named after the people you actually play with');
  perform pr_true((select team_name from league_membership where league_id = mid and sleeper_roster_id = 1) = 'Second Team',
    'pr13 and you keep your own team name');
end $$;

-- ── 2. the slot you asked for is the slot you pick from ───────────────────
do $$
declare mid uuid := current_setting('probe.pr_mid')::uuid; d draft%rowtype; oc int;
begin
  perform pr_as('2');
  select * into d from draft where league_id = mid;
  perform pr_true((d.draft_order ->> 2)::int = 1, 'pr14 seat 1 sits third in the order');
  perform pr_ok(start_draft(mid), 'pr15 the practice draft starts');
  select * into d from draft where league_id = mid;
  perform pr_true((d.draft_order ->> 2)::int = 1, 'pr16 and start_draft honoured that order');
  oc := draft_on_clock(d);
  perform pr_true(oc <> 1, 'pr17 so the first pick is not yours — you are third');
  -- every other seat is in the order exactly once
  perform pr_true((select count(distinct v.x) from (
      select (jsonb_array_elements_text(d.draft_order))::int as x) v) = 4,
    'pr18 and all four seats are in it, once each');
end $$;

-- ── 3. the real league is untouched ───────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.pr_lid')::uuid; mid uuid := current_setting('probe.pr_mid')::uuid;
begin
  perform pr_as('2');
  perform pr_true((select status from draft where league_id = lid) = 'pending',
    'pr19 the real draft has not started');
  perform pr_true((select count(*) from league_pool where league_id = lid) = 60,
    'pr20 the real pool is unchanged');
  perform pr_true((select count(*) from native_roster where league_id = lid) = 0,
    'pr21 nothing was drafted into the real league');
  perform pr_true(not exists (select 1 from league_membership
                    where league_id = lid and controller = 'ai'),
    'pr22 and no real seat was handed to a bot');
  perform pr_true(not (select is_mock from league where id = lid), 'pr23 the real league is still real');
  -- a practice room has no season, which is what keeps 0179/0280 out of it
  perform pr_true((select count(*) from matchup where league_id = mid) = 0, 'pr24 the room has no schedule');
  perform pr_true(league_live_week(mid) is null, 'pr25 so it has no live week at all');
end $$;

-- ── 4. the ways in are closed ─────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.pr_lid')::uuid; mid uuid := current_setting('probe.pr_mid')::uuid;
        code text;
begin
  select invite_code into code from league where id = mid;
  perform pr_as('9');
  perform pr_no(native_join(code, 'Gatecrash'), 'solo practice', 'pr26 nobody can join a practice room');
  perform pr_no(create_mock_from_league(lid, 1), 'not in that league',
    'pr27 and a stranger cannot practise your league''s draft');
  perform pr_as('2');
  perform pr_no(create_mock_from_league(mid, 1), 'already a practice room',
    'pr28 a practice room cannot be practised');
  -- everyone gets their OWN room: pr3's is a different league entirely
  perform pr_as('3');
  perform pr_true(((create_mock_from_league(lid, 1)) ->> 'league_id')::uuid <> mid,
    'pr29 a second member gets their own room, not a share of this one');
end $$;

-- ── 5. a league with no pool has nothing to practise ──────────────────────
do $$
declare lid uuid; r jsonb;
begin
  perform pr_as('1');
  r := create_native_league('Unseeded', '2026', 4, 8, 45);
  lid := (r ->> 'league_id')::uuid;
  perform pr_no(create_mock_from_league(lid, 1), 'not seeded yet',
    'pr30 an unseeded league is refused, rather than opening an empty room');
end $$;

-- ── 6. rooms are litter, and sweep themselves ─────────────────────────────
do $$
declare lid uuid := current_setting('probe.pr_lid')::uuid; mid uuid := current_setting('probe.pr_mid')::uuid;
        old_mine uuid; old_theirs uuid; r jsonb;
begin
  perform pr_as('2');
  old_mine := ((create_mock_from_league(lid, 2)) ->> 'league_id')::uuid;
  perform pr_as('3');
  old_theirs := ((create_mock_from_league(lid, 2)) ->> 'league_id')::uuid;
  reset role;
  update league set created_at = now() - interval '9 days' where id in (old_mine, old_theirs);
  -- pr2 opens another room: their own stale one goes, pr3's does not
  perform pr_as('2');
  perform pr_ok(create_mock_from_league(lid, 4), 'pr31 another room opens');
  perform pr_true(not exists (select 1 from league where id = old_mine),
    'pr32 and swept the caller''s own stale room');
  perform pr_true(exists (select 1 from league where id = old_theirs),
    'pr33 while leaving someone else''s alone');
  perform pr_true(exists (select 1 from league where id = lid),
    'pr34 and never a real league');
  -- and you can always bin one yourself
  perform pr_ok(delete_mock_draft(mid), 'pr35 a room is deletable by its owner');
  -- as the real league's COMMISSIONER, so the refusal is the is_mock guard and
  -- not the permission check standing in front of it.
  perform pr_as('1');
  perform pr_no(delete_mock_draft(lid), 'not a mock draft', 'pr36 a real league is not');
  reset role;
  raise notice 'practice-room probes done';
end $$;

select 'ALL PRACTICE-ROOM PROBES PASSED' as status;
