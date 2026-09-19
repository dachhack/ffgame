-- 0213 agent-wire probes: AN UNCLAIMED SEAT WORKS THE WIRE — AND ONLY IT.
--
-- The planner's policy is asserted in JS (scripts/check-seat-waivers.mjs); what
-- can only be proved here is the AUTHORIZATION BOUNDARY, which is the part with
-- teeth. The worker gets to call `submit_waiver_claim` and `add_free_agent` for
-- a seat nobody holds. Every one of these must hold, or the feature is a way to
-- transact over a real manager's roster:
--
--   • the worker (service role, auth.uid() IS NULL) CAN claim for an agent seat;
--   • it CANNOT for a seat a human holds, even though a seat_agent row exists —
--     the membership re-check, not the mapping, is what guarantees this;
--   • a signed-in user cannot borrow the worker's branch by calling the RPC for
--     someone else's roster;
--   • all of 0199's validation still binds the worker — seats, drops, flags,
--     FAAB balance — because it is the SAME function, not a parallel path;
--   • and the commissioner's switch defaults ON and can be turned off.
--
-- SCOPED TO ITS OWN FIXTURE LEAGUE THROUGHOUT. Every suite in this runner
-- shares one database, so a global assertion ("exactly one agent seat") passes
-- alone and fails in the suite. Every count below is filtered by `lid`.
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
-- The WORKER: no uid at all. This is the whole point of the new branch, and
-- `set_config('app.uid', '')` is how the shim spells a null auth.uid().
create or replace function probe_as_worker() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; code text; b_seat int; open_seat int; i int; agent_id uuid; okd boolean;
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

  -- ══ A CLASSIC LEAGUE WITH ONE HUMAN SEAT AND ONE EMPTY ═══════════════════
  r := create_native_league('AgentWire', '2024', 3, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'aw0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'AW-B'), 'aw0a B takes a seat'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'aw0b three starting spots');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 0), 'aw0c two bench, no taxi/IR');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'aw-' || g, 'full', 'P' || g, 'pos', 'RB', 'team', 'KC', 'exp', 0))
    from generate_series(1, 40) g));

  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  -- The seat NOBODY joined: membership row exists with a null app_user_id.
  select sleeper_roster_id into open_seat from league_membership
    where league_id = lid and app_user_id is null order by sleeper_roster_id limit 1;
  perform assert_true(open_seat is not null, 'aw0d the league has an unclaimed seat to agent');

  -- Rosters for both, and a completed draft so transactions are legal at all.
  for i in 1..4 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, b_seat, 'aw-' || i, 'draft');
  end loop;
  for i in 5..8 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, open_seat, 'aw-' || i, 'draft');
  end loop;
  update draft set status = 'complete' where league_id = lid;

  -- The agent, as server/src/agents.js provisions it.
  insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-0000000009a1', 'agent-aw@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000009a1', 'agent-aw@test.dev') on conflict (id) do nothing;
  agent_id := '00000000-0000-0000-0000-0000000009a1';
  insert into seat_agent (league_id, roster_id, agent_user_id)
    values (lid, open_seat, agent_id) on conflict do nothing;

  -- ══ 1. THE GATE ITSELF ═══════════════════════════════════════════════════
  perform assert_true(agent_wire_seat(lid, open_seat),
    'aw1 an unclaimed seat with an agent row is wire-eligible');
  perform assert_true(not agent_wire_seat(lid, b_seat),
    'aw1a a seat a human holds is NOT, because it has no agent row');

  -- ══ 2. THE WORKER MAY TRANSACT FOR THE AGENT SEAT ════════════════════════
  perform probe_as_worker();
  perform assert_ok(add_free_agent(lid, open_seat, 'aw-20', null),
    'aw2 the worker signs a free agent for the seat nobody holds');
  perform assert_true((select count(*) from native_roster
      where league_id = lid and roster_id = open_seat and slug = 'aw-20') = 1,
    'aw2a and the player actually landed on that roster');

  update league_pool set waived_until = now() + interval '1 day' where league_id = lid and slug = 'aw-21';
  perform assert_ok(submit_waiver_claim(lid, open_seat, 'aw-21', 'aw-5', 0),
    'aw2b and files a waiver claim with a drop');
  perform assert_true((select count(*) from waiver_claim
      where league_id = lid and roster_id = open_seat and status = 'pending') = 1,
    'aw2c exactly one pending claim FOR THIS FIXTURE seat');

  -- ══ 2d. THE DUPLICATE THE WORKER NOW AVOIDS (v0.338.1) ═══════════════════
  -- The planner is deterministic, so a seat with an unresolved claim re-derives
  -- the same plan on the next sweep. This is what the database answers, and it
  -- is why the worker counts OUTSTANDING claims rather than only the ones it
  -- files this run: without that it re-filed and was refused every 25 seconds
  -- from filing until the waiver run.
  perform assert_err(submit_waiver_claim(lid, open_seat, 'aw-21', 'aw-5', 0), 'already pending',
    'aw2d a second claim on the same player is refused while the first is pending');
  perform assert_true((select count(*) from waiver_claim
      where league_id = lid and roster_id = open_seat and status = 'pending') = 1,
    'aw2e …and the refusal left exactly one pending claim, not two');

  -- ══ 3. THE BOUNDARY: NOT A SEAT A HUMAN HOLDS ════════════════════════════
  -- This is the assertion the whole design hangs on.
  perform assert_err(add_free_agent(lid, b_seat, 'aw-22', null), 'forbidden',
    'aw3 THE POINT: the worker cannot sign for a seat a human holds');
  update league_pool set waived_until = now() + interval '1 day' where league_id = lid and slug = 'aw-23';
  perform assert_err(submit_waiver_claim(lid, b_seat, 'aw-23', 'aw-1', 0), 'forbidden',
    'aw3a nor claim for one');

  -- ══ 4. A STALE MAPPING CANNOT OUTLIVE THE CLAIM ══════════════════════════
  -- Force the failure 0180's trigger is supposed to prevent: a seat_agent row
  -- pointing at a seat a human now holds. The membership re-check must refuse
  -- regardless, which is why agent_wire_seat joins rather than trusting the row.
  insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-0000000009a2', 'agent-aw2@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000009a2', 'agent-aw2@test.dev') on conflict (id) do nothing;
  insert into seat_agent (league_id, roster_id, agent_user_id)
    values (lid, b_seat, '00000000-0000-0000-0000-0000000009a2') on conflict do nothing;
  perform assert_true(not agent_wire_seat(lid, b_seat),
    'aw4 a stale agent row on a HELD seat is still not wire-eligible');
  perform assert_err(add_free_agent(lid, b_seat, 'aw-22', null), 'forbidden',
    'aw4a and the worker is still refused — the membership check, not the mapping, is the guarantee');
  delete from seat_agent where league_id = lid and roster_id = b_seat;

  -- ══ 5. A SIGNED-IN USER CANNOT BORROW THE WORKER'S BRANCH ════════════════
  -- C is not even in this league.
  perform probe_as('c');
  perform assert_err(add_free_agent(lid, open_seat, 'aw-24', null), 'forbidden',
    'aw5 a signed-in stranger cannot transact for the agent seat');
  perform probe_as('b');
  perform assert_err(add_free_agent(lid, open_seat, 'aw-24', null), 'forbidden',
    'aw5a nor can another MANAGER in the same league');

  -- ══ 6. 0199'S VALIDATION STILL BINDS THE WORKER ══════════════════════════
  -- The same function, so the same rules — this is the reason there is no
  -- parallel agent path. The agent seat is at its five active seats now.
  perform probe_as_worker();
  perform assert_err(add_free_agent(lid, open_seat, 'aw-25', null), 'active roster is full',
    'aw6 the seat cap judges the worker exactly as it judges a manager');
  -- Deliberately asserted as an INVARIANT rather than a message: with the seat
  -- already full, the seat-cap check answers before the drop-ownership check
  -- does, so pinning the wording would pin the order of two unrelated guards.
  -- What must be true either way is that another seat's player is untouched.
  perform assert_true(not coalesce(
      (add_free_agent(lid, open_seat, 'aw-26', 'aw-1') ->> 'ok')::boolean, false),
    'aw6a a drop naming ANOTHER seat''s player is refused');
  perform assert_true((select count(*) from native_roster
      where league_id = lid and roster_id = b_seat and slug = 'aw-1') = 1,
    'aw6a2 …and that player is still on the roster that owns him');

  -- A commissioner flag binds it too (0144).
  perform probe_as('a');
  perform assert_ok(set_player_flag(lid, 'aw-27', 'do not add', '{"no_add": true}'::jsonb),
    'aw6b commissioner flags a player no-add');
  perform probe_as_worker();
  -- A flag is enforced by a TRIGGER (enforce_flag_roster, 0144) that RAISES —
  -- it is not a returned {ok:false}. That is worth knowing beyond this probe:
  -- it is precisely why the planner drops no_add players itself instead of
  -- letting the database answer, since a raise here would abort the worker's
  -- whole sweep rather than costing it one claim.
  okd := false;
  begin
    perform add_free_agent(lid, open_seat, 'aw-27', 'aw-6');
    okd := true;
  exception when others then
    perform assert_true(position('flag' in lower(sqlerrm)) > 0,
      'aw6c refused, but by something other than the flag: ' || sqlerrm);
  end;
  perform assert_true(not okd, 'aw6c2 a flagged player is never added for an agent seat');

  -- ══ 7. THE COMMISSIONER'S SWITCH ═════════════════════════════════════════
  perform assert_true(league_agent_waivers(lid),
    'aw7 agent waivers default ON for a league that has never set them');
  perform probe_as('a');
  perform assert_ok(set_transaction_rules(lid, null, null, null, null, null, null, null, null, null, false),
    'aw7a the commissioner turns them off');
  perform assert_true(not league_agent_waivers(lid), 'aw7b …and the switch reads off');
  perform assert_ok(set_transaction_rules(lid, null, null, null, null, null, null, null, null, null, true),
    'aw7c and back on');
  perform assert_true(league_agent_waivers(lid), 'aw7d …and reads on again');
  -- The switch is a WORKER-side policy, not an authorization: turning it off
  -- must not change what the RPC allows, or a commissioner toggling it would
  -- silently invalidate claims already filed. The worker simply stops asking.
  perform assert_ok(set_transaction_rules(lid, null, null, null, null, null, null, null, null, null, false),
    'aw7e off again');
  perform probe_as_worker();
  perform assert_ok(add_free_agent(lid, open_seat, 'aw-28', 'aw-7'),
    'aw7f the RPC still permits the worker — the switch gates the SWEEP, not the gate');

  -- ══ 8. NOTHING LEAKED INTO ANOTHER SUITE'S LEAGUE ════════════════════════
  perform assert_true((select count(*) from seat_agent where league_id = lid) = 1,
    'aw8 this fixture leaves exactly one agent mapping behind');
end $$;

-- ══ 9. AN AI SEAT NOBODY HOLDS WORKS THE WIRE TOO (0298, v0.425.0) ═══════
-- A seat whose controller is 'ai' is never agented (agents.js — its lineup is
-- composed at resolve by aiSide), so before 0298 the worker could not
-- transact for it at all: a bot vampire that sat out the draft (0268) kept an
-- empty roster all season. The gate now admits it — on the SAME "nobody at
-- the seat" rule, so a manager on 🤖 auto-pilot keeps their roster.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; code text; bot_seat int; idle_seat int; d_seat int; i int;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d');
  perform probe_as('a');

  r := create_native_league('AgentWireAI', '2024', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'aw9 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('d'); perform assert_ok(native_join(code, 'AW-D'), 'aw9a D takes a seat'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'aw9b three starting spots');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 0), 'aw9c two bench, no taxi/IR');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'awai-' || g, 'full', 'P' || g, 'pos', 'RB', 'team', 'KC', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into d_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000d';
  -- two seats nobody joined: one becomes the bot, one stays an idle human seat
  select min(sleeper_roster_id) into bot_seat from league_membership where league_id = lid and app_user_id is null;
  select max(sleeper_roster_id) into idle_seat from league_membership where league_id = lid and app_user_id is null;
  perform assert_true(bot_seat is not null and idle_seat is not null and bot_seat <> idle_seat,
    'aw9d two unclaimed seats to work with');
  perform assert_ok(set_team_controller(lid, bot_seat, 'ai'), 'aw9e the commissioner flips one to 🤖');
  update draft set status = 'complete' where league_id = lid;

  -- the gate: the bot seat with NO seat_agent row is eligible; the idle
  -- human seat with no agent row is not (it will be, once agents.js mints one)
  perform assert_true((select count(*) from seat_agent where league_id = lid) = 0,
    'aw9f no agent rows in this fixture — the AI branch is the only way in');
  perform assert_true(agent_wire_seat(lid, bot_seat),
    'aw9g an AI seat nobody holds is wire-eligible without an agent row');
  perform assert_true(not agent_wire_seat(lid, idle_seat),
    'aw9h an unclaimed HUMAN seat without an agent row still is not');
  perform assert_true(not agent_wire_seat(lid, d_seat),
    'aw9i a seat a human holds is not');

  -- the worker signs for the bot — into an EMPTY roster, which is exactly the
  -- bot-vampire shape (it never drafted)
  perform probe_as_worker();
  perform assert_ok(add_free_agent(lid, bot_seat, 'awai-1', null),
    'aw9j the worker signs a free agent for the AI seat');
  perform assert_true((select count(*) from native_roster
      where league_id = lid and roster_id = bot_seat and slug = 'awai-1') = 1,
    'aw9k and the player landed on the bot''s roster');
  perform assert_err(add_free_agent(lid, idle_seat, 'awai-2', null), 'forbidden',
    'aw9l but not for the idle human seat that has no agent row');

  -- a manager on auto-pilot keeps their roster: D flips their OWN team to 🤖
  -- and the worker still may not transact over it
  perform probe_as('d');
  perform assert_ok(set_team_controller(lid, d_seat, 'ai'), 'aw9m D sets their own team to auto-pilot');
  perform assert_true(not agent_wire_seat(lid, d_seat),
    'aw9n …and the gate still says no — a human is at that seat');
  perform probe_as_worker();
  perform assert_err(add_free_agent(lid, d_seat, 'awai-3', null), 'forbidden',
    'aw9o the worker cannot sign for a human on auto-pilot');

  -- a signed-in outsider cannot borrow the worker's branch for the bot seat
  perform probe_as('b');
  perform assert_err(add_free_agent(lid, bot_seat, 'awai-4', null), 'forbidden',
    'aw9p a signed-in non-member cannot act for the bot seat');

  -- handing the bot back to a human controller closes the gate again
  perform probe_as('a');
  perform assert_ok(set_team_controller(lid, bot_seat, 'human'), 'aw9q the commissioner hands the seat back');
  perform assert_true(not agent_wire_seat(lid, bot_seat),
    'aw9r …and the worker''s way in is gone with the flag');

  -- the vampire wire lock binds the bot like anyone else: a non-vampire bot
  -- is refused, the bot VAMPIRE is not (0272 wire_block_reason, same answer)
  perform assert_ok(set_team_controller(lid, bot_seat, 'ai'), 'aw9s bot again');
  perform assert_ok(set_league_format(lid, 'vampire'), 'aw9t the league goes vampire');
  perform assert_ok(set_vampires(lid, to_jsonb(array[idle_seat]), null, true), 'aw9u the idle seat is the vampire, wire locked');
  perform assert_true(wire_block_reason(lid, bot_seat) is not null,
    'aw9v a non-vampire bot is shut out under the wire lock (the sweep asks this and moves on)');
  perform assert_true(wire_block_reason(lid, idle_seat) is null,
    'aw9w the vampire seat is not');
  perform probe_as_worker();
  perform assert_err(add_free_agent(lid, bot_seat, 'awai-5', null), 'wire belongs to the vampire',
    'aw9x and the RPC refuses the bot the same way');
  perform probe_as('a');
  perform assert_ok(set_vampires(lid, to_jsonb(array[bot_seat]), null, true), 'aw9y the bot becomes the vampire');
  perform probe_as_worker();
  perform assert_ok(add_free_agent(lid, bot_seat, 'awai-5', null),
    'aw9z a bot vampire builds from the pool under its own wire lock');
end $$;

-- ══ 10. THE WORKER STASHES ON IR, ON THE SAME TERMS (0299, v0.426.0) ═════
-- set_roster_spot admitted the seat's owner, the commissioner and an admin —
-- never the worker — so a seat the worker tends could sign and drop but not
-- stash. Now the 0213 branch, and every 0198 rule still binds it.
do $$
declare
  r jsonb; lid uuid; code text; bot_seat int; d_seat int; i int;
begin
  perform probe_as('a');
  r := create_native_league('AgentWireIR', '2024', 3, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'aw10 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('d'); perform assert_ok(native_join(code, 'AW-D2'), 'aw10a D takes a seat'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'aw10b three starting spots');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 2), 'aw10c two bench, two IR places');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'awir-' || g, 'full', 'P' || g, 'pos', 'RB', 'team', 'KC', 'exp', 0))
    from generate_series(1, 20) g));
  select sleeper_roster_id into d_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000d';
  select min(sleeper_roster_id) into bot_seat from league_membership where league_id = lid and app_user_id is null;
  perform assert_ok(set_team_controller(lid, bot_seat, 'ai'), 'aw10d the unclaimed seat becomes a bot');
  for i in 1..5 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, bot_seat, 'awir-' || i, 'draft');
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, d_seat, 'awir-' || (10 + i), 'draft');
  end loop;
  update draft set status = 'complete' where league_id = lid;
  insert into injury_status (player_slug, status) values ('awir-1', 'O'), ('awir-2', 'Q'), ('awir-11', 'O')
    on conflict (player_slug) do update set status = excluded.status;

  perform probe_as_worker();
  perform assert_ok(set_roster_spot(lid, 'awir-1', 'ir'),
    'aw10e the worker stashes the bot''s ruled-out player on IR');
  perform assert_true((select spot from native_roster where league_id = lid and slug = 'awir-1') = 'ir',
    'aw10f …and he is on IR');
  perform assert_err(set_roster_spot(lid, 'awir-2', 'ir'), 'IR is for players designated',
    'aw10g a questionable player is refused — 0198''s list binds the worker');
  perform assert_err(set_roster_spot(lid, 'awir-11', 'ir'), 'forbidden',
    'aw10h and D''s ruled-out player is not the worker''s to move');
  perform assert_ok(add_free_agent(lid, bot_seat, 'awir-8', null),
    'aw10i the freed active place takes a signing without a drop');
  update injury_status set status = 'Q' where player_slug = 'awir-1';
  perform assert_err(set_roster_spot(lid, 'awir-1', 'active'), 'active roster is full',
    'aw10j a healed player cannot come back while the active roster is full (0198, unchanged)');
  perform assert_ok(add_free_agent(lid, bot_seat, 'awir-9', 'awir-8'),
    'aw10k (a swap keeps the count where it is)');
  perform probe_as('a');
  perform assert_ok(set_team_controller(lid, bot_seat, 'human'), 'aw10l the seat handed back');
  perform probe_as_worker();
  perform assert_err(set_roster_spot(lid, 'awir-1', 'active'), 'forbidden',
    'aw10m …and the worker may no longer move its players');
end $$;

select 'ALL AGENT-WIRE PROBES PASSED' as result;
