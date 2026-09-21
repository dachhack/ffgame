-- 0284/0285 probes: the draft log, and a clock that runs out.
--
-- What must hold:
--   • every kind of thing that happens in a draft leaves one line, with the
--     right kind and the right actor: start, a hand pick, a forced pick, an
--     autopick, a pause and resume, an undo, an edit, a reset, and a person
--     toggling autodraft;
--   • a LIVE HUMAN whose deadline is behind us is flipped to autodraft by the
--     tick, once, with one 'timeout' line (not a second 'autodraft_on'), and
--     is pushed — while a practice room flips and logs but does not push;
--   • a reset leaves ONE line, not one per pick it wiped;
--   • the read is members-only, ordered, and pages by id.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function dl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function dl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dl_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000d1c0' || u, false);
  perform set_config('app.email', 'dl' || u || '@test.dev', false);
end $$;
create or replace function dl_server() returns void language plpgsql as $$
begin perform set_config('app.uid', '', false); perform set_config('app.email', '', false); end $$;
-- how many lines of a kind, for a league
create or replace function dl_n(l uuid, k text) returns int language sql as $$
  select count(*)::int from draft_event where league_id = l and kind = k $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d1c01', 'dl1@test.dev'),
  ('00000000-0000-0000-0000-0000000d1c02', 'dl2@test.dev'),
  ('00000000-0000-0000-0000-0000000d1c09', 'dl9@test.dev')
on conflict (id) do nothing;

-- ── fixture: 4 seats, two people, order fixed so every turn is predictable ──
do $$
declare lid uuid; r jsonb; i int; code text;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000d1c01', 'dl1@test.dev'),
    ('00000000-0000-0000-0000-0000000d1c02', 'dl2@test.dev'),
    ('00000000-0000-0000-0000-0000000d1c09', 'dl9@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000d1c01';
  perform dl_as('1');
  r := create_native_league('Draft Log', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform dl_ok(r, 'dl0 league created');
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform dl_as('2'); perform dl_ok(native_join(code, 'DL-C'), 'dl0a c joins as seat 2');
  reset role;
  for i in 1..60 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'dl-' || i, 'DL ' || i, (array['QB','RB','WR','TE'])[1 + (i % 4)], 'DLT', i)
      on conflict do nothing;
  end loop;
  -- seats 1 (b) and 2 (c) are people; 3 and 4 are empty. Round one runs
  -- 1,2,3,4; round two comes back 4,3,2,1.
  update draft set draft_order = '[1,2,3,4]'::jsonb where league_id = lid;
  perform set_config('probe.dl_lid', lid::text, false);
  perform dl_true((select count(*) from draft_event where league_id = lid) = 0,
    'dl0b nothing is logged before anything happens');
end $$;

-- ── 1. start, a hand pick, a forced pick, the empty seats' autopicks ──────
do $$
declare lid uuid := current_setting('probe.dl_lid')::uuid; r jsonb; e record;
begin
  perform dl_as('1');
  perform dl_ok(start_draft(lid), 'dl1 the draft starts');
  perform dl_true(dl_n(lid, 'start') = 1, 'dl1a and that is one START line');
  select * into e from draft_event where league_id = lid and kind = 'start';
  perform dl_true(e.detail -> 'order' = '[1,2,3,4]'::jsonb, 'dl1b carrying the order it opened with');

  -- seat 1 picks for itself
  perform dl_ok(make_draft_pick(lid, 'dl-1'), 'dl2 seat 1 picks by hand');
  select * into e from draft_event where league_id = lid and kind = 'pick';
  perform dl_true(e.roster_id = 1 and e.slug = 'dl-1' and e.overall = 1 and e.round = 1
              and e.actor = '00000000-0000-0000-0000-0000000d1c01',
    'dl2a logged as a PICK by that seat, with the pick number and round');

  -- the commissioner picks FOR seat 2 — the actor is not the seat's manager
  perform dl_ok(commish_force_pick(lid, 'dl-2'), 'dl3 the commissioner forces seat 2''s pick');
  select * into e from draft_event where league_id = lid and kind = 'forced';
  perform dl_true(e.roster_id = 2 and e.slug = 'dl-2' and e.overall = 2,
    'dl3a logged as FORCED, against the seat it was made for');
  perform dl_true(dl_n(lid, 'pick') = 1, 'dl3b and not as a plain pick');

  -- seats 3 and 4 have nobody: the worker's tick picks for them, and for 4
  -- and 3 again coming back in round two, then waits on seat 2 (a person).
  perform dl_server();
  perform dl_ok(draft_tick(lid), 'dl4 the worker ticks');
  perform dl_true(dl_n(lid, 'autopick') = 4, 'dl4a four AUTOPICK lines — the two empty seats, twice');
  perform dl_true(dl_n(lid, 'timeout') = 0, 'dl4b and no timeout: nobody was late, nobody was there');
  perform dl_true((select current_overall from draft where league_id = lid) = 7
              and draft_on_clock((select d from draft d where d.league_id = lid)) = 2,
    'dl4c the room is waiting on seat 2 at pick 7');
end $$;

-- ── 2. a person's clock runs out ──────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.dl_lid')::uuid; e record;
        c uuid := '00000000-0000-0000-0000-0000000d1c02';
begin
  perform dl_server();
  perform dl_true(seat_is_live_human(lid, 2), 'dl5 seat 2 is a live human — the room waits on them');
  update draft set deadline_at = now() - interval '1 second' where league_id = lid;
  perform dl_ok(draft_tick(lid), 'dl5a …until the tick finds the deadline behind it');

  perform dl_true((select autodraft from league_membership where league_id = lid and sleeper_roster_id = 2),
    'dl6 the seat is on AUTODRAFT now');
  perform dl_true(not seat_is_live_human(lid, 2), 'dl6a so the room no longer waits on it');
  perform dl_true(dl_n(lid, 'timeout') = 1, 'dl7 one TIMEOUT line');
  select * into e from draft_event where league_id = lid and kind = 'timeout';
  perform dl_true(e.roster_id = 2 and e.overall = 7 and e.round = 2 and e.actor is null,
    'dl7a naming the seat, the pick it missed and the round, by the clock');
  perform dl_true(dl_n(lid, 'autodraft_on') = 0,
    'dl7b and NOT a second autodraft_on line — the flip is the timeout');
  perform dl_true(exists (select 1 from draft_pick where league_id = lid and overall = 7 and roster_id = 2 and auto),
    'dl7c the pick it missed was made for it');
  perform dl_true(dl_n(lid, 'autopick') = 5, 'dl7d as an autopick');
  -- and the person is told
  perform dl_true(exists (select 1 from push_outbox
                    where app_user_id = c and kind = 'draft'
                      and dedupe_key = 'draft:' || lid || ':timeout:2:7'
                      and body like 'Your clock ran out on pick 7%'),
    'dl8 the manager who timed out is pushed, once, keyed to that pick');
end $$;

-- ── 3. the person takes it back, and toggles are logged ───────────────────
do $$
declare lid uuid := current_setting('probe.dl_lid')::uuid;
begin
  perform dl_as('2');
  perform dl_ok(set_autodraft(lid, 2, false), 'dl9 seat 2 turns autodraft off');
  perform dl_true(dl_n(lid, 'autodraft_off') = 1, 'dl9a logged as AUTODRAFT_OFF');
  perform dl_ok(set_autodraft(lid, 2, true), 'dl9b and on again');
  perform dl_true(dl_n(lid, 'autodraft_on') = 1, 'dl9c logged as AUTODRAFT_ON — a person did this one');
  perform dl_ok(set_autodraft(lid, 2, false), 'dl9d and off, for what follows');
  perform dl_true(seat_is_live_human(lid, 2), 'dl9e they are a live human again');
end $$;

-- ── 4. pause, resume, undo, edit ──────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.dl_lid')::uuid; e record; b uuid := '00000000-0000-0000-0000-0000000d1c01';
begin
  perform dl_as('1');
  perform dl_ok(commish_pause_draft(lid), 'dl10 pause');
  perform dl_ok(commish_resume_draft(lid), 'dl10a resume');
  perform dl_true(dl_n(lid, 'pause') = 1 and dl_n(lid, 'resume') = 1, 'dl10b one line each');
  select * into e from draft_event where league_id = lid and kind = 'pause';
  perform dl_true(e.actor = b and e.overall = 8, 'dl10c the pause names who and where');

  -- undo the last pick (seat 2's autopick at 7)
  perform dl_ok(commish_undo_pick(lid), 'dl11 undo the last pick');
  select * into e from draft_event where league_id = lid and kind = 'removed';
  perform dl_true(e.overall = 7 and e.roster_id = 2 and e.actor = b,
    'dl11a logged as REMOVED: which pick, whose, by whom');
  perform dl_true(dl_n(lid, 'removed') = 1, 'dl11b once');

  -- edit pick 1 in place
  perform dl_ok(commish_edit_pick(lid, 1, 'dl-50'), 'dl12 edit pick 1 to another player');
  select * into e from draft_event where league_id = lid and kind = 'edit';
  perform dl_true(e.overall = 1 and e.slug = 'dl-50' and e.detail ->> 'from' = 'dl-1',
    'dl12a logged as EDIT, with where it came from');
end $$;

-- ── 5. the read ───────────────────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.dl_lid')::uuid; r jsonb; ev jsonb; last_id bigint; tl jsonb;
begin
  perform dl_as('2');
  r := draft_log(lid);
  perform dl_ok(r, 'dl13 a member reads the log');
  ev := r -> 'events';
  perform dl_true(jsonb_array_length(ev) = (select count(*) from draft_event where league_id = lid),
    'dl13a every line comes back');
  perform dl_true((ev -> 0 ->> 'kind') = 'start', 'dl13b oldest first');
  select x into tl from jsonb_array_elements(ev) x where x ->> 'kind' = 'timeout';
  perform dl_true(tl ->> 'team' = 'DL-C' and (tl ->> 'actor_role') = 'server',
    'dl13c the timeout line names the team and credits the clock');
  select x into tl from jsonb_array_elements(ev) x where x ->> 'kind' = 'forced';
  perform dl_true(tl ->> 'player' = 'DL 2' and tl ->> 'actor_role' = 'commish',
    'dl13d the forced line names the player and credits the commissioner');
  -- paging by id
  last_id := (ev -> (jsonb_array_length(ev) - 1) ->> 'id')::bigint;
  perform dl_true(jsonb_array_length(draft_log(lid, last_id) -> 'events') = 0,
    'dl13e nothing after the last id');
  perform dl_true(jsonb_array_length(draft_log(lid, last_id - 1) -> 'events') = 1,
    'dl13f exactly one after the one before it');
  perform dl_as('9');
  perform dl_true(coalesce(((draft_log(lid)) ->> 'ok')::boolean, true) is false,
    'dl14 a stranger is refused');
end $$;

-- ── 6. a reset is ONE line, and a practice room flips but does not push ───
do $$
declare lid uuid := current_setting('probe.dl_lid')::uuid; mid uuid; r jsonb; before int;
begin
  perform dl_as('1');
  before := (select count(*) from draft_pick where league_id = lid);
  perform dl_true(before > 1, 'dl15 several picks stand before the reset');
  perform dl_ok(commish_reset_draft(lid, 'reset'), 'dl15a the commissioner resets the draft');
  perform dl_true(dl_n(lid, 'reset') = 1, 'dl15b ONE reset line');
  perform dl_true(dl_n(lid, 'removed') = 1, 'dl15c and the wiped picks did not each log a removal');

  -- practice room: same clock, same flip, same log line — no push
  r := create_mock_from_league(lid, 1);
  perform dl_ok(r, 'dl16 a practice room opens');
  mid := (r ->> 'league_id')::uuid;
  perform dl_ok(start_draft(mid), 'dl16a and starts');
  perform dl_server();
  update draft set deadline_at = now() - interval '1 second' where league_id = mid;
  perform dl_ok(draft_tick(mid), 'dl16b the tick finds the practising manager late');
  perform dl_true((select autodraft from league_membership where league_id = mid and sleeper_roster_id = 1),
    'dl16c the seat flips');
  perform dl_true(dl_n(mid, 'timeout') = 1, 'dl16d the room''s log says so');
  perform dl_true(not exists (select 1 from push_outbox where dedupe_key like 'draft:' || mid || ':timeout:%'),
    'dl16e but nobody is pushed about a practice room');
  reset role;
  raise notice 'draft-log probes done';
end $$;

select 'ALL DRAFT-LOG PROBES PASSED' as status;
