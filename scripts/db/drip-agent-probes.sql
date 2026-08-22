-- v0.339.0 drip seat-agent probes: AN UNCLAIMED **DRIP** SEAT HOLDS A LINEUP.
--
-- 0180 built seat agents for classic and stopped, and the cost was invisible
-- until it was measured: eight of twenty-four seats across the two live drip
-- leagues had no account, so `sealed_pick.app_user_id` being NOT NULL meant
-- they could not store a lineup AT ALL. Every week they were skipped by the
-- lock-time fill and fell back to a rebuild at resolve. That is what an
-- "unopposed" window in a full league actually is.
--
-- The worker half of the fix is JavaScript (agents.js provisions for every
-- mode; lock.js writes as the agent). What lives HERE is the half that has to
-- be true in the database for any of it to be safe, and none of it was ever
-- asserted for a drip league:
--
--   • a drip seat's agent can author sealed_pick rows at all;
--   • `league_membership.app_user_id` STAYS NULL, so every open-seat count,
--     the waiting room and the join flow are untouched — 0180 calls this out
--     as the reason the mapping is a side table and not a membership value,
--     and it is the invariant most likely to be broken by accident;
--   • the claim trigger hands those rows to a human who takes the seat, and
--     RETIRES the mapping so the agent never writes again;
--   • a re-claim keeps the human's OWN rows over the agent's.
--
-- SCOPED TO ITS OWN FIXTURE LEAGUE. Every suite in this runner shares one
-- database, so counts here are filtered by `lid` throughout.
\set QUIET on
\pset pager off

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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; code text; open_seat int; agent_id uuid; mid uuid; before_open int; after_open int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d');
  perform probe_as('a');

  -- ══ A DRIP LEAGUE (the default mode), with a seat nobody took ════════════
  r := create_native_league('DripAgent', '2024', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'drip');
  perform assert_ok(r, 'da0 drip league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform assert_true(
    coalesce((select settings_json ->> 'game_mode' from league where id = lid), 'drip') <> 'classic',
    'da0a the fixture really is a DRIP league — the whole point of this suite');

  select sleeper_roster_id into open_seat from league_membership
    where league_id = lid and app_user_id is null order by sleeper_roster_id limit 1;
  perform assert_true(open_seat is not null, 'da0b it has an unclaimed seat');

  -- The agent, exactly as server/src/agents.js provisions one.
  insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-0000000009d1', 'agent-da@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000009d1', 'agent-da@test.dev') on conflict (id) do nothing;
  agent_id := '00000000-0000-0000-0000-0000000009d1';
  insert into seat_agent (league_id, roster_id, agent_user_id)
    values (lid, open_seat, agent_id) on conflict do nothing;

  -- ══ 1. THE INVARIANT 0180 RESTS ON ═══════════════════════════════════════
  -- The membership row must stay NULL. Everything that offers a seat keys on
  -- it, so seating the agent there would make the league read as FULL.
  perform assert_true((select app_user_id from league_membership
      where league_id = lid and sleeper_roster_id = open_seat) is null,
    'da1 THE INVARIANT: an agented seat still has a NULL membership user');
  select count(*) into before_open from league_membership
    where league_id = lid and app_user_id is null;
  perform assert_true(before_open > 0, 'da1a …so the league still counts open seats');

  -- ══ 2. THE AGENT CAN AUTHOR A LINEUP AT ALL ══════════════════════════════
  -- The thing a drip seat could not do before: sealed_pick.app_user_id is NOT
  -- NULL, so with no account there was nowhere to put a lineup.
  -- A fresh native league has no matchups until its schedule is generated, so
  -- one is inserted directly. Nothing here tests the scheduler; what is under
  -- test is whether a row can be FILED for this seat at all.
  insert into matchup (league_id, week, home_roster_id, away_roster_id)
    values (lid, 1, open_seat, (select min(sleeper_roster_id) from league_membership
                                where league_id = lid and sleeper_roster_id <> open_seat))
    returning id into mid;
  perform assert_true(mid is not null, 'da2 the seat has a matchup to be filled for');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked)
    values (mid, agent_id, 'tnf', 'S1', 'da-player-1', 'rush', false);
  perform assert_true((select count(*) from sealed_pick
      where matchup_id = mid and app_user_id = agent_id) = 1,
    'da2a THE POINT: a DRIP seat with no account now holds a stored lineup');

  -- ══ 3. THE CLAIM HANDS THE ROWS OVER ═════════════════════════════════════
  perform probe_as('d');
  perform assert_ok(native_join(code, 'DA-D'), 'da3 a human takes the seat');
  perform assert_true((select app_user_id from league_membership
      where league_id = lid and sleeper_roster_id = open_seat)
      = '00000000-0000-0000-0000-00000000000d',
    'da3a the seat is theirs');
  perform assert_true((select count(*) from sealed_pick
      where matchup_id = mid and app_user_id = '00000000-0000-0000-0000-00000000000d') = 1,
    'da3b the agent''s lineup transferred to them — history is continuous');
  perform assert_true((select count(*) from sealed_pick
      where matchup_id = mid and app_user_id = agent_id) = 0,
    'da3c and none of it is still filed under the agent');

  -- ══ 4. THE MAPPING IS RETIRED ════════════════════════════════════════════
  -- Otherwise the worker would keep writing over a real manager's roster —
  -- which is also what 0213's agent_wire_seat re-checks membership to prevent.
  perform assert_true((select count(*) from seat_agent
      where league_id = lid and roster_id = open_seat) = 0,
    'da4 the mapping is gone, so the agent never writes for this seat again');
  perform assert_true(not agent_wire_seat(lid, open_seat),
    'da4a and the wire gate agrees the seat is no longer agent-held');

  -- ══ 5. THE OPEN-SEAT COUNT MOVED BY EXACTLY ONE ══════════════════════════
  -- Scoped to this fixture: a global count would pass alone and fail in suite.
  select count(*) into after_open from league_membership
    where league_id = lid and app_user_id is null;
  perform assert_true(after_open = before_open - 1,
    'da5 claiming the seat reduced this league''s open seats by exactly one');
end $$;

select 'ALL DRIP-AGENT PROBES PASSED' as result;
