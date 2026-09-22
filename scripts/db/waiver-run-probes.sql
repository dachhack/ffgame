-- 0344 probes: THE WAIVER RUN, OPENED UP.
--   • wr1 a member reads a run; someone outside the league does not;
--   • wr2 the run is found by the CHAT LINE'S OWN timestamp, which is the same
--         instant the claims carry — and by the nearest one, not by equality;
--   • wr3 winners and losers both come back, with the reason each loser lost —
--         the half the 500-character chat line truncates away first;
--   • wr4 a bid is a number in a FAAB league and NULL everywhere else, where a
--         0 would read as "bid nothing" rather than "this league has no bids";
--   • wr5 an instant with no run says so rather than drawing an empty sheet
--         that looks like a run nobody won.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function wr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function wr_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000044' || u, false); perform set_config('app.email', 'wr' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000440' || g)::uuid, 'wr0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000440' || g)::uuid, 'wr0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'wr0%@test.dev';

do $$
declare r jsonb; lid uuid; ran timestamptz; line timestamptz; rep jsonb; seas text := '2026';
begin
  perform wr_as('01');
  r := create_native_league('WaiverRun', seas, 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  -- A settled run, written the way process_waivers writes one: every claim it
  -- decides carries the same processed_at, and the chat line it posts carries
  -- the same instant in created_at because they share a transaction.
  ran := now() - interval '2 hours';
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, status, note, bid, processed_at)
    values (lid, 1, 'josh-allen', 'zach-wilson', 'won',  null,          14, ran),
           (lid, 2, 'josh-allen', null,          'lost', 'outbid',       9, ran),
           (lid, 2, 'tre-tucker', null,          'lost', 'roster full',  3, ran),
           (lid, 1, 'bye-week-guy', null,        'won',  null,           0, ran);
  insert into league_message (league_id, author_id, kind, body, txn, created_at)
    values (lid, null, 'txn', '📋 Waivers ran — …', '{"kind":"waiver","won":2,"lost":2}'::jsonb, ran);
  select g.created_at into line from league_message g
   where g.league_id = lid and g.kind = 'txn' order by g.id desc limit 1;

  -- ── wr1. the door ──
  perform wr_as('02');
  perform wr_true(league_waiver_run(lid, line) ->> 'error' = 'forbidden',
    'wr1 someone not in the league cannot read its wire');
  perform wr_as('01');
  perform wr_true((league_waiver_run(lid, line) ->> 'ok')::boolean, 'wr1 a member can');

  -- ── wr2. found by the chat line's own stamp ──
  rep := league_waiver_run(lid, line);
  perform wr_true((rep ->> 'found')::boolean and (rep ->> 'at')::timestamptz = ran,
    'wr2 the message''s created_at finds the run the claims were stamped with');
  -- NOT equality: these two timestamps agree in the database but travel out as
  -- text and back as a parameter, and a rule that needs that round trip to be
  -- byte-exact fails silently into an empty sheet.
  perform wr_true((league_waiver_run(lid, line + interval '3 seconds') ->> 'found')::boolean,
    'wr2 …and a stamp three seconds off still finds it');
  perform wr_true(not (league_waiver_run(lid, line + interval '30 seconds') ->> 'found')::boolean,
    'wr2 …while half a minute away is a different moment, not this run');

  -- ── wr3. both halves, and the reasons ──
  perform wr_true(jsonb_array_length(rep -> 'won') = 2 and jsonb_array_length(rep -> 'lost') = 2,
    'wr3 winners AND losers come back: ' || rep::text);
  perform wr_true((rep -> 'lost' -> 0 ->> 'why') = 'outbid'
              and (rep -> 'lost' -> 1 ->> 'why') = 'roster full',
    'wr3 each loser carries the reason it lost — the half the 500-char line truncates first');
  perform wr_true((rep -> 'won' -> 0 ->> 'drop_slug') = 'zach-wilson'
              and (rep -> 'won' -> 1 ->> 'drop_slug') is null,
    'wr3 a claim that carried a drop says so, and one that did not stays null');
  perform wr_true((rep -> 'won' -> 0 ->> 'team') is not null,
    'wr3 …and every row is named, so the sheet needs no second call');

  -- ── wr4. the bid means something only where there are bids ──
  perform wr_true(rep ->> 'mode' = 'rolling' and (rep -> 'won' -> 0 -> 'bid') = 'null'::jsonb,
    'wr4 a non-FAAB league serves a NULL bid, not a 0 that reads as "bid nothing"');
  perform wr_true((set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100) ->> 'ok')::boolean,
    'wr4 switch the league to FAAB');
  rep := league_waiver_run(lid, line);
  perform wr_true(rep ->> 'mode' = 'faab' and (rep -> 'won' -> 0 ->> 'bid')::int = 14
              and (rep -> 'lost' -> 0 ->> 'bid')::int = 9,
    'wr4 …and now the bids are numbers, winners and losers alike');
  perform wr_true(jsonb_array_length(rep -> 'order') > 0
              and (rep -> 'order' -> 0 ? 'faab'),
    'wr4 the wire after the run carries what each seat has left: ' || (rep -> 'order')::text);

  -- ── wr5. an instant with no run ──
  rep := league_waiver_run(lid, now() - interval '9 days');
  perform wr_true((rep ->> 'ok')::boolean and (rep ->> 'found')::boolean is false
              and rep -> 'won' = '[]'::jsonb,
    'wr5 an instant with no run says found:false rather than drawing an empty run');
  perform wr_true(league_waiver_run(lid, null) ->> 'error' is not null,
    'wr5 …and no instant at all is refused rather than guessed at');

  delete from league_message where league_id = lid;
  delete from waiver_claim where league_id = lid;
end $$;

select 'ALL WAIVER-RUN PROBES PASS' as result;
drop function if exists wr_true(boolean, text);
drop function if exists wr_as(text);
