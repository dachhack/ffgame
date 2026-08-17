-- 0180 probes — THE SEAT AGENT AND THE CLAIM.
--
-- What must hold:
--   • PLUMBING, NOT A MEMBER — seat_agent is invisible to clients: a league
--     member can neither read nor write it (RLS with no policies).
--   • THE CLAIM TRANSFERS — when a human takes an agent-held seat, the
--     agent's sealed_pick rows in that league become the human's (locked
--     history included — only app_user_id changes, which enforce_window_lock
--     exempts by its own rule), and the mapping is retired.
--   • THE HUMAN'S OWN ROWS WIN — on a re-claim, a spot the human still holds
--     from an earlier stay keeps THEIR row; the agent's colliding row drops.
--   • NO AGENT, NO EFFECT — claiming a seat with no agent is a plain
--     membership update; vacating a seat (user → NULL) touches nothing.
--   • SCOPED TO THE LEAGUE — an agent's rows in ANOTHER league do not move.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'sa-commish@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'sa-claimer@test.dev'),
  ('00000000-0000-0000-0000-0000000000a3', 'sa-agent@test.dev'),
  ('00000000-0000-0000-0000-0000000000a4', 'sa-agent2@test.dev')
on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'sa-commish@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'sa-claimer@test.dev'),
  ('00000000-0000-0000-0000-0000000000a3', 'sa-agent@test.dev'),
  ('00000000-0000-0000-0000-0000000000a4', 'sa-agent2@test.dev')
on conflict (id) do nothing;

do $$
declare
  commish constant uuid := '00000000-0000-0000-0000-0000000000a1';
  human   constant uuid := '00000000-0000-0000-0000-0000000000a2';
  agent   constant uuid := '00000000-0000-0000-0000-0000000000a3';
  agent2  constant uuid := '00000000-0000-0000-0000-0000000000a4';
  lid uuid; lid2 uuid; mid uuid; mid2 uuid; other_mid uuid;
  n int; denied boolean;
begin
  -- ── Stage two classic leagues as the server (the worker's shape) ──────────
  insert into league (sleeper_league_id, name, season, provider, settings_json)
    values ('SA-PROBE-1', 'Agent League', '2026', 'native', '{"game_mode":"classic"}'::jsonb) returning id into lid;
  insert into league (sleeper_league_id, name, season, provider, settings_json)
    values ('SA-PROBE-2', 'Agent League 2', '2026', 'native', '{"game_mode":"classic"}'::jsonb) returning id into lid2;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled)
    values (lid, 1, commish, true), (lid, 2, null, false),
           (lid2, 1, commish, true), (lid2, 2, null, false);
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 1, 1, 2, 'scheduled') returning id into mid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 2, 2, 1, 'scheduled') returning id into mid2;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid2, 1, 1, 2, 'scheduled') returning id into other_mid;

  -- Agents on both leagues' seat 2; the worker's lineups, one row LOCKED (a
  -- kicked-off week) and one still open, plus a row in the OTHER league.
  insert into seat_agent (league_id, roster_id, agent_user_id) values (lid, 2, agent), (lid2, 2, agent2);
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, locked)
    values (mid,  agent, 'wk', 'S1', 'locked-man',  true),
           (mid,  agent, 'wk', 'S2', 'open-man',    false),
           (mid2, agent, 'wk', 'S1', 'future-man',  false),
           (other_mid, agent2, 'wk', 'S1', 'other-league-man', false);

  -- The re-claim collision: the human still holds mid2's S1 from an earlier stay.
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, locked)
    values (mid2, human, 'wk', 'S1', 'humans-own-choice', false);

  -- ── PLUMBING, NOT A MEMBER ────────────────────────────────────────────────
  set local role authenticated;
  perform probe_as('1');   -- the commissioner, a real league member
  perform assert_true((select count(*) from seat_agent) = 0, 'sa1 a member reads no agent mappings');
  denied := false;
  begin
    insert into seat_agent (league_id, roster_id, agent_user_id) values (lid, 1, agent);
  exception when others then denied := true; end;
  perform assert_true(denied, 'sa2 a member cannot write a mapping');
  reset role;
  perform assert_true((select count(*) from seat_agent) = 2, 'sa3 the server still sees both');

  -- ── THE CLAIM ─────────────────────────────────────────────────────────────
  update league_membership set app_user_id = '00000000-0000-0000-0000-0000000000a2', enrolled = true
    where league_id = lid and sleeper_roster_id = 2;

  select count(*) into n from sealed_pick where app_user_id = '00000000-0000-0000-0000-0000000000a2';
  perform assert_true(n = 3, 'sa4 the human now holds three rows (locked + open + their own)');
  perform assert_true((select locked from sealed_pick
      where matchup_id = mid and roster_slot = 'S1') = true,
    'sa5 the LOCKED row transferred locked — history under their name');
  perform assert_true((select player_slug from sealed_pick
      where matchup_id = mid2 and roster_slot = 'S1'
        and app_user_id = '00000000-0000-0000-0000-0000000000a2') = 'humans-own-choice',
    'sa6 on a re-claim the human''s own row wins');
  perform assert_true((select count(*) from sealed_pick where app_user_id = '00000000-0000-0000-0000-0000000000a3') = 0,
    'sa7 the agent holds nothing here any more');
  perform assert_true((select count(*) from seat_agent where league_id = lid) = 0,
    'sa8 the mapping is retired');

  -- ── SCOPED TO THE LEAGUE ──────────────────────────────────────────────────
  perform assert_true((select app_user_id from sealed_pick where matchup_id = other_mid and roster_slot = 'S1')
      = '00000000-0000-0000-0000-0000000000a4',
    'sa9 the other league''s agent rows did not move');
  perform assert_true((select count(*) from seat_agent where league_id = lid2) = 1,
    'sa10 the other league''s mapping stands');

  -- ── NO AGENT / VACANCY ────────────────────────────────────────────────────
  update league_membership set app_user_id = null, enrolled = false
    where league_id = lid and sleeper_roster_id = 2;
  perform assert_true((select count(*) from sealed_pick where app_user_id = '00000000-0000-0000-0000-0000000000a2') = 3,
    'sa11 vacating moves nothing — the record stands');
  update league_membership set app_user_id = '00000000-0000-0000-0000-0000000000a2', enrolled = true
    where league_id = lid and sleeper_roster_id = 2;
  perform assert_true((select count(*) from sealed_pick where app_user_id = '00000000-0000-0000-0000-0000000000a2') = 3,
    'sa12 re-claiming an agentless seat is a plain membership update');
end $$;

select 'ALL SEAT-AGENT PROBES PASSED' as result;
