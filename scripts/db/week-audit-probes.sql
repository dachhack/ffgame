-- 0302 probes: THE WEEKLY MATCHUP AUDIT — who actually played the week.
--
-- The audit is only worth having if its attributions are right, so the
-- fixture plants one of everything and asserts each lands in its own bucket:
--
--   • a HUMAN seat that set two slots itself, had a third filled by the
--     worker (actor NULL under the human's uid), and one slot left empty;
--   • an AI seat (controller 'ai', no account) whose lineup exists only in
--     matchup_state.slot_scores — never stored as rows;
--   • an unclaimed seat with a seat_agent whose rows the worker wrote;
--   • a started player who is OUT, a started player on BYE (a team the week's
--     slate does not list), transactions from the human, the wire and the
--     commissioner, waiver claims from the human and the AI seat, a chat line
--     and a shop spend.
--
-- SCOPED TO THE FIXTURE LEAGUE: every suite shares one database, so nothing
-- here asserts a global count. The league's season is one the real slate
-- never covers, so the window falls back to the matchup's lock_at (planted at
-- now()) and the probe's `now()` rows fall inside it; the bye check plants its
-- own slate rows for that season (kickoff in the future: 0058's window lock
-- reads the newest season's kickoffs for the week, and this IS the newest).
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function wa_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

do $$
declare
  lg uuid; mid uuid; mid2 uuid;
  ua uuid := '00000000-0000-0000-0000-0000000a0d01';   -- the human manager
  ux uuid := '00000000-0000-0000-0000-0000000a0d02';   -- the commissioner (another human)
  ag uuid := '00000000-0000-0000-0000-0000000a0d03';   -- the seat agent
  r jsonb; l jsonb; th jsonb; ta jsonb; tg jsonb; te jsonb; n int;
begin
  insert into auth.users (id, email) values (ua, 'wa-human@test.dev'), (ux, 'wa-commish@test.dev'), (ag, 'wa-agent@test.dev')
    on conflict (id) do nothing;
  insert into app_user (id, email, display_name) values
    (ua, 'wa-human@test.dev', 'Human Manager'), (ux, 'wa-commish@test.dev', 'The Commish'), (ag, 'wa-agent@test.dev', 'Auto-managed')
    on conflict (id) do nothing;

  -- A native drip league in a season no slate covers: seats 1 (human), 2 (AI,
  -- nobody), 3 (unclaimed + agent), 4 (nobody, no agent).
  insert into league (id, sleeper_league_id, name, season, provider, invite_code, commissioner_id, settings_json)
  values (gen_random_uuid(), 'WEEK-AUDIT-PROBE', 'Audit League', '2077', 'native', 'WKAU0001', ux,
          '{"game_mode":"drip","format":"standard"}'::jsonb)
  returning id into lg;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name, controller) values
    (lg, 1, ua, true, 'Humans', 'human'),
    (lg, 2, null, false, 'Robots', 'ai'),
    (lg, 3, null, false, 'Ghosts', 'human'),
    (lg, 4, null, false, 'Nobody', 'human');
  insert into seat_agent (league_id, roster_id, agent_user_id) values (lg, 3, ag);
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, lock_at, home_final, away_final)
  values (gen_random_uuid(), lg, 3, 1, 2, 'final', now(), 101.5, 88.0) returning id into mid;
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, lock_at, home_final, away_final)
  values (gen_random_uuid(), lg, 3, 3, 4, 'final', now(), 50.0, 0) returning id into mid2;

  -- Pool rows carry the players' teams: 'zzz-bye-back' plays for a team the
  -- planted week-3 slate does not list.
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lg, 'wa-human-one', 'Human One', 'RB', 'KC', 1),
    (lg, 'wa-human-two', 'Human Two', 'WR', 'KC', 2),
    (lg, 'wa-fill-three', 'Fill Three', 'WR', 'PHI', 3),
    (lg, 'wa-out-man', 'Out Man', 'RB', 'PHI', 4),
    (lg, 'zzz-bye-back', 'Bye Back', 'RB', 'DAL', 5),
    (lg, 'wa-agent-one', 'Agent One', 'QB', 'KC', 6),
    (lg, 'wa-ai-one', 'Ai One', 'QB', 'PHI', 7),
    (lg, 'wa-wire-add', 'Wire Add', 'TE', 'KC', 8),
    (lg, 'wa-human-add', 'Human Add', 'TE', 'KC', 9);
  insert into nfl_slate (season, week, home, away, win, kickoff) values
    ('2077', 3, 'KC', 'PHI', 'snf', now() + interval '2 days')
    on conflict do nothing;
  insert into injury_status (player_slug, status) values ('wa-out-man', 'O')
    on conflict (player_slug) do update set status = 'O';

  -- ── the HUMAN sets two slots (a browser write: actor = their uid) ─────────
  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'wa-human@test.dev', false);
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked) values
    (mid, ua, 'early', 'S1', 'wa-human-one', 'rush', true),
    (mid, ua, 'early', 'S2', 'wa-human-two', 'recyd', true);
  -- …and one they started who is OUT, plus one on BYE — their own calls.
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked) values
    (mid, ua, 'late', 'S1', 'wa-out-man', 'rush', true),
    (mid, ua, 'snf', 'S1', 'zzz-bye-back', 'rush', true);
  -- a chat line and a claim from the human
  insert into league_message (league_id, author_id, body) values (lg, ua, 'set my lineup!');
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, bid, status) values (lg, 1, 'wa-human-add', null, 3, 'won');

  -- ── the WORKER (service role: actor NULL) fills the human's fifth slot ────
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked) values
    (mid, ua, 'mnf', 'S1', 'wa-fill-three', 'recyd', true);
  -- …and writes the AGENT seat's lineup
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked) values
    (mid2, ag, 'early', 'S1', 'wa-agent-one', 'passyd', true);
  -- the AI seat's lineup exists only as the resolver's slot rows
  insert into matchup_state (matchup_id, game_window, home_score, away_score, slot_scores) values
    (mid, 'early', 40, 30, '[{"side":"home","slot":"S1","slug":"wa-human-one","metric":"rush","score":20},
                            {"side":"home","slot":"S2","slug":"wa-human-two","metric":"recyd","score":20},
                            {"side":"away","slot":"S1","slug":"wa-ai-one","metric":"passyd","score":30}]'::jsonb),
    (mid, 'mnf', 10, 0, '[{"side":"home","slot":"S1","slug":"wa-fill-three","metric":"recyd","score":10}]'::jsonb);
  -- transactions: the human's own FA add (actor = them), the wire's add for
  -- the AI seat (actor NULL), a waiver win processed for the human (actor
  -- NULL on a held seat), and a commissioner move (kind commish, actor them).
  insert into league_txn (league_id, kind, roster_id, slug, actor) values
    (lg, 'add', 1, 'wa-human-add', ua),
    (lg, 'waiver', 1, 'wa-human-two', null),
    (lg, 'add', 2, 'wa-wire-add', null),
    (lg, 'commish', 4, 'wa-agent-one', ux);
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, bid, status) values (lg, 2, 'wa-wire-add', null, 0, 'lost');
  -- the human bought something this week — an EXTRA SLOT (0027): their board
  -- is nine wide, everyone else's eight (0303).
  insert into coin_ledger (league_id, roster_id, matchup_id, week, delta, reason, idem_key) values
    (lg, 1, mid, 3, -20, 'spend:extra-slot', 'wa-probe-spend-' || lg::text);
  insert into applied_state (matchup_id, app_user_id, week, payload_json) values
    (mid, ua, 3, '{"extra": 1}'::jsonb);

  -- ── not an admin → refused ───────────────────────────────────────────────
  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'wa-human@test.dev', false);
  r := admin_week_audit(3, '2077');
  perform wa_true(not (r ->> 'ok')::boolean, 'wa0 a non-admin was refused');

  insert into app_admin (email) values ('wa-human@test.dev') on conflict do nothing;
  r := admin_week_audit(3, '2077');
  perform wa_true((r ->> 'ok')::boolean, 'wa1 the admin gets the audit: ' || r::text);
  perform wa_true((r ->> 'week')::int = 3 and r ->> 'season' = '2077', 'wa1a it audits the week and season asked for');

  select x into l from jsonb_array_elements(r -> 'leagues') x where x ->> 'league_id' = lg::text;
  perform wa_true(l is not null, 'wa2 the fixture league is in the audit');
  perform wa_true((l -> 'seats' ->> 'total')::int = 4 and (l -> 'seats' ->> 'human')::int = 1
              and (l -> 'seats' ->> 'ai')::int = 1 and (l -> 'seats' ->> 'agent')::int = 1
              and (l -> 'seats' ->> 'empty')::int = 1,
    'wa2a seats are counted by kind (human/ai/agent/empty): ' || (l -> 'seats')::text);
  perform wa_true((l -> 'seats' ->> 'active')::int = 1, 'wa2b exactly one seat was ACTIVE this week (the human)');
  perform wa_true((l ->> 'matchups')::int = 2 and (l ->> 'finals')::int = 2, 'wa2c two matchups, both final');

  select x into th from jsonb_array_elements(l -> 'teams') x where (x ->> 'roster_id')::int = 1;
  select x into ta from jsonb_array_elements(l -> 'teams') x where (x ->> 'roster_id')::int = 2;
  select x into tg from jsonb_array_elements(l -> 'teams') x where (x ->> 'roster_id')::int = 3;
  select x into te from jsonb_array_elements(l -> 'teams') x where (x ->> 'roster_id')::int = 4;

  -- ── 3. THE SOURCE OF EVERY FIELDED SLOT ─────────────────────────────────
  -- The human set four slots themselves (two good, one OUT, one BYE) and the
  -- worker filled a fifth under their own uid — the audit log's NULL actor is
  -- what tells those apart.
  perform wa_true((th -> 'lineup' -> 'sources' ->> 'player')::int = 4,
    'wa3 four slots were set by the PLAYER: ' || (th -> 'lineup')::text);
  perform wa_true((th -> 'lineup' -> 'sources' ->> 'auto')::int = 1,
    'wa3a one slot was filled by the COMPUTER (worker write on a human seat): ' || (th -> 'lineup')::text);
  perform wa_true((th -> 'lineup' ->> 'fielded')::int = 5 and (th -> 'lineup' ->> 'expected')::int = 9
              and (th -> 'lineup' ->> 'empty')::int = 4,
    'wa3b 5 of 9 fielded (base 8 + the bought slot, 0303) → 4 EMPTY: ' || (th -> 'lineup')::text);
  perform wa_true((ta -> 'lineup' -> 'sources' ->> 'ai')::int = 1 and (ta -> 'lineup' ->> 'fielded')::int = 1,
    'wa3c the AI seat''s resolver-only lineup counts as AI: ' || (ta -> 'lineup')::text);
  perform wa_true((tg -> 'lineup' -> 'sources' ->> 'agent')::int = 1,
    'wa3d the unclaimed seat''s worker rows count as AGENT: ' || (tg -> 'lineup')::text);
  perform wa_true((te -> 'lineup' ->> 'fielded')::int = 0 and (te -> 'lineup' ->> 'empty')::int = 8,
    'wa3e a seat with nothing behind it is all empty: ' || (te -> 'lineup')::text);
  perform wa_true((ta -> 'lineup' ->> 'expected')::int = 8 and (tg -> 'lineup' ->> 'expected')::int = 8,
    'wa3e2 only the seat that bought the slot is judged against nine (0303)');
  perform wa_true(th ->> 'kind' = 'human' and ta ->> 'kind' = 'ai' and tg ->> 'kind' = 'agent' and te ->> 'kind' = 'empty',
    'wa3f seat kinds are named');
  perform wa_true(th ->> 'manager' = 'Human Manager', 'wa3g the human seat names its manager');

  -- The bought slot survives the window override too (it is the board, not
  -- activity) — asserted in wa8a below via fielded/expected.
  -- ── 4. OUT and BYE starters, named, with who started them ────────────────
  perform wa_true(jsonb_array_length(th -> 'lineup' -> 'out_started') = 1
              and th -> 'lineup' -> 'out_started' -> 0 ->> 'slug' = 'wa-out-man'
              and th -> 'lineup' -> 'out_started' -> 0 ->> 'source' = 'player',
    'wa4 the OUT starter is named with its source: ' || (th -> 'lineup' -> 'out_started')::text);
  perform wa_true(jsonb_array_length(th -> 'lineup' -> 'bye_started') = 1
              and th -> 'lineup' -> 'bye_started' -> 0 ->> 'slug' = 'zzz-bye-back',
    'wa4a the BYE starter is named (DAL is not on the week''s slate): ' || (th -> 'lineup' -> 'bye_started')::text);
  perform wa_true(jsonb_array_length(ta -> 'lineup' -> 'bye_started') = 0 and jsonb_array_length(ta -> 'lineup' -> 'out_started') = 0,
    'wa4b a healthy KC/PHI lineup flags nothing');
  perform wa_true((l -> 'lineup' ->> 'out_started')::int = 1 and (l -> 'lineup' ->> 'bye_started')::int = 1
              and (l -> 'lineup' ->> 'empty')::int = 4 + 7 + 7 + 8 and (l -> 'lineup' ->> 'expected')::int = 9 + 8 + 8 + 8,
    'wa4c the league rolls its teams up: ' || (l -> 'lineup')::text);

  -- ── 5. MOVES BY SOURCE ───────────────────────────────────────────────────
  perform wa_true((th -> 'activity' -> 'txns' ->> 'player')::int = 2,
    'wa5 the human''s FA add and their processed waiver are both PLAYER moves: ' || (th -> 'activity' -> 'txns')::text);
  perform wa_true((ta -> 'activity' -> 'txns' ->> 'ai')::int = 1,
    'wa5a the wire''s add for the AI seat is an AI move: ' || (ta -> 'activity' -> 'txns')::text);
  perform wa_true((te -> 'activity' -> 'txns' ->> 'commish')::int = 1,
    'wa5b the commissioner''s move is a COMMISH move: ' || (te -> 'activity' -> 'txns')::text);
  perform wa_true((l -> 'activity' -> 'txns' ->> 'player')::int = 2 and (l -> 'activity' -> 'txns' ->> 'ai')::int = 1
              and (l -> 'activity' -> 'txns' ->> 'commish')::int = 1,
    'wa5c the league totals moves by source: ' || (l -> 'activity' -> 'txns')::text);

  -- ── 6. WAIVER CLAIMS: player vs AI ───────────────────────────────────────
  perform wa_true((l -> 'activity' -> 'claims' ->> 'player')::int = 1 and (l -> 'activity' -> 'claims' ->> 'ai')::int = 1,
    'wa6 one claim from a player, one from the AI: ' || (l -> 'activity' -> 'claims')::text);
  perform wa_true((l -> 'activity' -> 'claims_won' ->> 'player')::int = 1 and (l -> 'activity' -> 'claims_won' ->> 'ai') is null,
    'wa6a only the player''s claim was won: ' || (l -> 'activity' -> 'claims_won')::text);
  perform wa_true((th -> 'activity' -> 'claims' ->> 'won')::int = 1 and (ta -> 'activity' -> 'claims' ->> 'lost')::int = 1,
    'wa6b each seat sees its own claims by status');

  -- ── 7. ACTIVITY: edits, chat, shop, last active ─────────────────────────
  perform wa_true((th -> 'activity' ->> 'pick_edits')::int = 4,
    'wa7 the human''s own pick writes are counted (4), the worker''s are not: ' || (th -> 'activity')::text);
  perform wa_true((th -> 'activity' ->> 'chat')::int = 1 and (th -> 'activity' ->> 'shop')::int = 1
              and (th -> 'activity' ->> 'shop_coin')::numeric = 20,
    'wa7a chat and shop spend ride along: ' || (th -> 'activity')::text);
  perform wa_true((th -> 'activity' ->> 'active')::boolean and not (ta -> 'activity' ->> 'active')::boolean
              and not (tg -> 'activity' ->> 'active')::boolean,
    'wa7b only a human seat can be active; bots are never "active"');
  perform wa_true(th -> 'activity' ->> 'last_active_at' is not null, 'wa7c the human has a last-active stamp');
  perform wa_true(th ->> 'result' = 'W' and ta ->> 'result' = 'L' and (th ->> 'pf')::numeric = 101.5,
    'wa7d results ride along: ' || th::text);

  -- ── 8. THE WINDOW GATES ACTIVITY ─────────────────────────────────────────
  -- Ask for a window that ended yesterday: the same league shows no activity,
  -- while its lineup (which is not time-gated) reads the same.
  r := admin_week_audit(3, '2077', now() - interval '3 days', now() - interval '1 day');
  select x into l from jsonb_array_elements(r -> 'leagues') x where x ->> 'league_id' = lg::text;
  select x into th from jsonb_array_elements(l -> 'teams') x where (x ->> 'roster_id')::int = 1;
  perform wa_true((th -> 'activity' ->> 'pick_edits')::int = 0 and (th -> 'activity' ->> 'chat')::int = 0
              and (th -> 'activity' -> 'txns') = '{}'::jsonb and (th -> 'activity' ->> 'claims_n')::int = 0,
    'wa8 an explicit window outside the activity shows no edits, chat, moves or claims: ' || (th -> 'activity')::text);
  -- The shop is keyed by WEEK (coin_ledger.week), not by the clock — a spend
  -- for week 3 is week 3's whatever window is asked for.
  perform wa_true((th -> 'activity' ->> 'shop')::int = 1, 'wa8b …while the week''s shop spend stays (week-keyed)');
  perform wa_true((th -> 'lineup' ->> 'fielded')::int = 5 and (th -> 'lineup' ->> 'expected')::int = 9, 'wa8a …but the lineup is what it was');

  -- ── 9. WEEK DEFAULTS TO THE LATEST FINAL WEEK OF THE SEASON ─────────────
  r := admin_week_audit(null, '2077');
  perform wa_true((r ->> 'week')::int = 3, 'wa9 week null → the latest week with a final: ' || (r ->> 'week'));

  -- ── 10. IT REPAIRS NOTHING ───────────────────────────────────────────────
  select count(*) into n from sealed_pick where matchup_id in (mid, mid2);
  perform wa_true(n = 6, 'wa10 the audit changed no pick rows');

  delete from app_admin where email = 'wa-human@test.dev';
  delete from coin_ledger where league_id = lg;
  delete from league where id = lg;   -- cascades the fixture
  delete from nfl_slate where season = '2077';
  delete from injury_status where player_slug = 'wa-out-man';
  delete from app_user where id in (ua, ux, ag);
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
  raise notice 'week-audit probes done';
end $$;
select 'ALL WEEK-AUDIT PROBES PASSED' as result;
