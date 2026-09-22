-- 0290 probes: the league hears about it.
--
-- Founder: "we need an add/drop log that also includes a waiver report when it
-- runs and a trade report when it happens. All this goes in chat."
--
-- What must hold:
--   • an add posts ONE line, and an add-with-drop is still one line — the
--     register's row trigger sees two roster events and cannot know they are
--     a single decision, which is why these are posted from the RPCs;
--   • a drop posts one line, naming a player the roster no longer holds;
--   • a waiver run posts ONE report covering everything it settled, winners
--     and losers, and NOTHING at all when it settled nothing — the team screen
--     sweeps every fifteen seconds and a chattering league is a broken one;
--   • a trade posts one report, not four roster updates;
--   • every line is the house: author_id null, kind 'txn', a payload the
--     client can render from, and 'Drip Fantasy' as the author on read;
--   • the register (0186) still records all of it — chat is an announcement,
--     not a replacement;
--   • a member can read the lines through chat_messages, which is the only
--     door league_message has.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function tc_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function tc_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tc_eq(a text, b text, msg text) returns void language plpgsql as $$
begin
  if a is distinct from b then raise exception 'PROBE FAIL % — expected %, got %', msg, b, a; end if;
end $$;
create or replace function tc_has(hay text, needle text, msg text) returns void language plpgsql as $$
begin
  if hay is null or position(needle in hay) = 0 then
    raise exception 'PROBE FAIL % — % does not contain %', msg, coalesce(hay, '<null>'), needle;
  end if;
end $$;
create or replace function tc_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000000c' || u, false);
  perform set_config('app.email', 'tc' || u || '@test.dev', false);
end $$;
-- app.uid outlives `reset role`; the server is a thing you ask for explicitly.
create or replace function tc_server() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;
-- Lines the house posted for this league, newest last.
create or replace function tc_lines(lid uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(body order by id), '{}') from league_message
   where league_id = lid and kind = 'txn';
$$;
create or replace function tc_count(lid uuid) returns int language sql stable as $$
  select count(*)::int from league_message where league_id = lid and kind = 'txn';
$$;
create or replace function tc_last(lid uuid) returns text language sql stable as $$
  select body from league_message where league_id = lid and kind = 'txn' order by id desc limit 1;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'tc1@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'tc2@test.dev')
on conflict (id) do nothing;

-- ── fixture: a drafted 2-team league with spare players in the pool ────────
do $$
declare lid uuid; r jsonb; i int; code text;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000000c1', 'tc1@test.dev'),
    ('00000000-0000-0000-0000-0000000000c2', 'tc2@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000000c1';
  perform tc_as('1');
  r := create_native_league('Chatty', '2026', 2, 5, 60, 'snake', 200, 15, 1);
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  -- 0337: this suite predates the weekly waiver schedule, whose default is
  -- now Sleeper's (waivers all week). It tests adds and drops, not the
  -- schedule, so it says plainly that its wire is open.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
    || '{"waiver_days": ["fa","fa","fa","fa","fa","fa","fa"]}'::jsonb where id = lid;
  perform tc_as('2'); perform tc_ok(native_join(code, 'The Seconds'), 'tc0 tc2 joins');
  perform tc_server();
  update league_membership set team_name = 'The Firsts'
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000000c1';
  for i in 1..40 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'tc-' || i, 'Chatty ' || i, (array['QB','RB','WR','TE'])[1 + (i % 4)], 'TCT', i)
      on conflict do nothing;
  end loop;
  perform tc_as('1');
  perform tc_ok(start_draft(lid, '[1,2]'::jsonb), 'tc0a the draft opens');
  perform tc_server();
  for i in 1..40 loop
    exit when (select status from draft where league_id = lid) = 'complete';
    update draft set deadline_at = now() - interval '1 second' where league_id = lid and status = 'live';
    perform draft_tick(lid);
  end loop;
  perform tc_true((select status from draft where league_id = lid) = 'complete', 'tc0b and finishes');
  -- A DRAFT SAYS NOTHING HERE. Forty picks are the draft log's business
  -- (0284); if the wire's announcements leaked into the draft, every new
  -- league would open its chat to a wall of noise before week one.
  perform tc_true(tc_count(lid) = 0, 'tc0c the draft posted no transaction lines');
  perform set_config('probe.tc_lid', lid::text, false);
end $$;

-- ── 1. an add is one line, and so is an add that carries a drop ───────────
do $$
declare lid uuid := current_setting('probe.tc_lid')::uuid; seat int; add1 text; add2 text; held text; before int;
begin
  perform tc_as('1');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000000c1';
  before := tc_count(lid);
  select lp.slug into add1 from league_pool lp
    where lp.league_id = lid
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  -- a roster with room takes him outright
  select slug into held from native_roster where league_id = lid and roster_id = seat limit 1;
  perform tc_ok(drop_player(lid, seat, held), 'tc1 a drop to make room');
  perform tc_true(tc_count(lid) = before + 1, 'tc1a the drop posted exactly one line');
  perform tc_has(tc_last(lid), 'The Firsts', 'tc1b naming the team');
  perform tc_has(tc_last(lid), 'dropped', 'tc1c and saying what happened');
  perform tc_has(tc_last(lid), _txn_player(lid, held),
    'tc1d and naming a player the roster no longer holds');

  perform tc_ok(add_free_agent(lid, seat, add1), 'tc2 a plain add');
  perform tc_true(tc_count(lid) = before + 2, 'tc2a one more line, not two');
  perform tc_has(tc_last(lid), 'added', 'tc2b it reads as an add');
  perform tc_true(position('dropped' in tc_last(lid)) = 0,
    'tc2c and says nothing about a drop, because there was none');

  -- THE CASE THE ROW TRIGGER CANNOT SEE: one decision, two roster events.
  select lp.slug into add2 from league_pool lp
    where lp.league_id = lid and lp.waived_until is null
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  select slug into held from native_roster where league_id = lid and roster_id = seat
    and slug <> add1 limit 1;
  perform tc_ok(add_free_agent(lid, seat, add2, held), 'tc3 an add that carries its drop');
  perform tc_true(tc_count(lid) = before + 3, 'tc3a is still ONE line');
  perform tc_has(tc_last(lid), 'added', 'tc3b naming the add');
  perform tc_has(tc_last(lid), 'dropped', 'tc3c and the drop, on the same line');
  perform tc_has(tc_last(lid), _txn_player(lid, add2), 'tc3d with the player who arrived');
  perform tc_has(tc_last(lid), _txn_player(lid, held), 'tc3e and the one who left');
end $$;

-- ── 2. the house voice, and the payload the client renders from ───────────
do $$
declare lid uuid := current_setting('probe.tc_lid')::uuid; m league_message%rowtype; j jsonb;
begin
  perform tc_as('1');
  select * into m from league_message where league_id = lid and kind = 'txn' order by id desc limit 1;
  perform tc_true(m.author_id is null, 'tc4 the house posted it, not a member');
  perform tc_eq(m.kind, 'txn', 'tc4a under its own kind');
  perform tc_true(m.txn is not null, 'tc4b carrying a payload');
  perform tc_eq(m.txn ->> 'kind', 'add', 'tc4c that names the event');
  perform tc_true((m.txn ->> 'drop') is not null, 'tc4d including the drop leg');
  j := _chat_message_json(m, '00000000-0000-0000-0000-0000000000c1');
  perform tc_eq(j ->> 'author', 'Drip Fantasy', 'tc5 and reads as the house');
  perform tc_true((j -> 'txn') is not null, 'tc5a with the payload on the way out');
  perform tc_true((j ->> 'mine')::boolean is false, 'tc5b nobody owns it');
  perform tc_true((j ->> 'mentions_me')::boolean is false, 'tc5c and it mentions nobody');
  -- the only door league_message has
  perform tc_true((chat_messages(lid) -> 'messages') is not null, 'tc6 chat_messages answers');
  perform tc_true(exists (select 1 from jsonb_array_elements(chat_messages(lid) -> 'messages') e
                          where e ->> 'kind' = 'txn'),
    'tc6a and a member can read the transaction lines through it');
  -- the register still has all of it: an announcement is not a replacement
  perform tc_true((select count(*) from league_txn where league_id = lid and kind in ('add','drop')) >= 3,
    'tc7 the register kept its own record');
end $$;

-- ── 3. a waiver run is ONE report, and silence when nothing settled ───────
do $$
declare lid uuid := current_setting('probe.tc_lid')::uuid; seat int; seat2 int;
        pick text; pick2 text; d1 text; d2 text; before int; r jsonb;
begin
  perform tc_as('1');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000000c1';
  select sleeper_roster_id into seat2 from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000000c2';
  -- FAAB, and free agency shut, so a claim is the only way in (0288/0289)
  perform tc_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100),
    'tc8 the league runs FAAB');
  perform tc_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'tc8a with no free agency');

  before := tc_count(lid);
  perform tc_ok(process_waivers(lid), 'tc9 a sweep with nothing pending');
  perform tc_true(tc_count(lid) = before,
    'tc9a says NOTHING — this runs every fifteen seconds from the team screen');

  -- both seats bid on the same man, and each also claims one of their own
  select lp.slug into pick from league_pool lp
    where lp.league_id = lid
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  select slug into d1 from native_roster where league_id = lid and roster_id = seat limit 1;
  select slug into d2 from native_roster where league_id = lid and roster_id = seat2 limit 1;
  perform tc_ok(submit_waiver_claim(lid, seat, pick, d1, 9), 'tc10 seat one bids $9');
  perform tc_as('2');
  perform tc_ok(submit_waiver_claim(lid, seat2, pick, d2, 3), 'tc10a seat two bids $3');

  -- 0289 parks them against a clock; this run is about the REPORT, so bring
  -- the clock forward rather than waiting for the league's waiver day.
  perform tc_server();
  update waiver_claim set clears_at = now() - interval '1 minute'
    where league_id = lid and status = 'pending';
  perform tc_as('1');
  before := tc_count(lid);
  r := process_waivers(lid);
  perform tc_ok(r, 'tc11 the run settles them');
  perform tc_true((r ->> 'won')::int = 1 and (r ->> 'lost')::int = 1, 'tc11a one winner, one loser');
  perform tc_true(tc_count(lid) = before + 1,
    'tc11b and posts ONE report for the run, not one line per claim');
  perform tc_has(tc_last(lid), 'Waivers ran', 'tc11c which says so');
  perform tc_has(tc_last(lid), 'The Firsts won', 'tc11d naming the winner');
  perform tc_has(tc_last(lid), '$9', 'tc11e and the winning bid');
  perform tc_has(tc_last(lid), 'Missed', 'tc11f while the loser is in the same line');
  perform tc_has(tc_last(lid), 'The Seconds', 'tc11g by name');
  perform tc_has(tc_last(lid), 'outbid', 'tc11h with the reason');
  perform tc_has(tc_last(lid), 'dropping', 'tc11i and the drop the winner made room with');

  -- and the sweep right after settles nothing, so it says nothing
  before := tc_count(lid);
  perform tc_ok(process_waivers(lid), 'tc12 the next sweep');
  perform tc_true(tc_count(lid) = before, 'tc12a is silent again');
end $$;

-- ── 4. a trade is one report ──────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.tc_lid')::uuid; seat int; seat2 int;
        mine text; theirs text; tid uuid; before int; r jsonb;
begin
  perform tc_as('1');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000000c1';
  select sleeper_roster_id into seat2 from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000000c2';
  select slug into mine from native_roster where league_id = lid and roster_id = seat limit 1;
  select slug into theirs from native_roster where league_id = lid and roster_id = seat2 limit 1;
  before := tc_count(lid);
  r := propose_trade(lid, seat, seat2, to_jsonb(array[mine]), to_jsonb(array[theirs]));
  perform tc_ok(r, 'tc13 a deal is offered');
  tid := (r ->> 'trade_id')::uuid;
  perform tc_true(tc_count(lid) = before,
    'tc13a and an OFFER says nothing — a deal nobody accepted is not news');
  perform tc_as('2');
  perform tc_ok(respond_trade(tid, true), 'tc14 the other seat accepts');
  perform tc_true(tc_count(lid) = before + 1,
    'tc14a one report for a deal that is four roster updates underneath');
  perform tc_has(tc_last(lid), 'Trade', 'tc14b it reads as a trade');
  perform tc_has(tc_last(lid), 'The Firsts', 'tc14c naming one side');
  perform tc_has(tc_last(lid), 'The Seconds', 'tc14d and the other');
  perform tc_has(tc_last(lid), _txn_player(lid, mine), 'tc14e with the player going out');
  perform tc_has(tc_last(lid), _txn_player(lid, theirs), 'tc14f and the one coming back');
  perform tc_true((select txn ->> 'kind' from league_message where league_id = lid
                    and kind = 'txn' order by id desc limit 1) = 'trade',
    'tc14g under the trade payload');
  perform tc_server();
  raise notice 'txn-chat probes done';
end $$;

select 'ALL TXN-CHAT PROBES PASSED' as status;
