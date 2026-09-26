-- 0377 probes: THE LINEUP AFTER THE DRAFT, AND AUTOPICK FILLS IT FIRST.
--
--   • autopick takes the best player who can START while a starting spot is
--     open (positions, level, filters), then the bench by rank; kicker-only
--     spots wait for the last rounds; a flagged spot is left to the manager;
--   • after the draft the lineup can change between weeks: saved lineups in
--     changed spots are cleared (future weeks only), the bench grows so no
--     team goes illegal, the roster size follows, and chat hears about it;
--   • a live draft or a week under way refuses; a rename is always free.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function la_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function la_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function la_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function la_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000050' || u, false); perform set_config('app.email', 'la' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005001', 'la01@test.dev'),
  ('00000000-0000-0000-0000-000000005002', 'la02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005001', 'la01@test.dev'),
  ('00000000-0000-0000-0000-000000005002', 'la02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-000000005002');

do $$
declare r jsonb; lid uuid; code text; m4 uuid; m5 uuid; ua uuid := '00000000-0000-0000-0000-000000005001';
begin
  perform la_as('01');
  r := create_native_league('Lineup After', '2031', 2, 6, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform la_ok(r, 'la0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform la_as('02'); perform la_ok(native_join(code, 'LA-2'), 'la0 join'); perform la_as('01');
  perform la_ok(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["RB","WR","TE"]}]'::jsonb), 'la0 QB, RB, WR, FLEX');
  perform la_ok(set_league_roster_shape(lid, 2, 0, 0), 'la0 two bench');
  -- Running backs rank best, then receivers, then the quarterbacks and tight ends.
  perform seed_league_pool(lid, '[
    {"slug":"la-rb1","full":"Rb One","pos":"RB","team":"KC","exp":3},{"slug":"la-rb2","full":"Rb Two","pos":"RB","team":"KC","exp":3},
    {"slug":"la-rb3","full":"Rb Three","pos":"RB","team":"KC","exp":3},{"slug":"la-rb4","full":"Rb Four","pos":"RB","team":"KC","exp":3},
    {"slug":"la-wr1","full":"Wr One","pos":"WR","team":"KC","exp":3},{"slug":"la-wr2","full":"Wr Two","pos":"WR","team":"KC","exp":3},
    {"slug":"la-wr3","full":"Wr Three","pos":"WR","team":"KC","exp":3},
    {"slug":"la-qb1","full":"Qb One","pos":"QB","team":"KC","exp":3},{"slug":"la-qb2","full":"Qb Two","pos":"QB","team":"KC","exp":3},
    {"slug":"la-te1","full":"Te One","pos":"TE","team":"KC","exp":3},{"slug":"la-te2","full":"Te Two","pos":"TE","team":"KC","exp":3},
    {"slug":"la-k1","full":"K One","pos":"K","team":"KC"}]'::jsonb);

  -- ══ la1. AUTOPICK: THE LINEUP FIRST ══════════════════════════════════════
  perform la_true(native_autopick_slug(lid, 1, 6) = 'la-rb1', 'la1 an empty roster takes the best player');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'la-rb1'), (lid, 1, 'la-rb2');
  perform la_true(jsonb_array_length(_autopick_open_spots(lid, 1)) = 2, 'la1a two RBs fill the RB spot and the FLEX: QB and WR open');
  perform la_true(native_autopick_slug(lid, 1, 6) = 'la-wr1', 'la1b THE POINT: a WR for the open WR spot, not a third RB ranked above him');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'la-wr1');
  perform la_true(native_autopick_slug(lid, 1, 6) = 'la-qb1', 'la1c then the quarterback, ranked below every back');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'la-qb1');
  perform la_true(native_autopick_slug(lid, 1, 6) = 'la-rb3', 'la1d every starter in place: the bench goes by rank');
  -- Filters and levels decide who fits.
  perform la_true(_autopick_spot_fits('{"pos":["WR"],"teams":["BUF"]}', 'WR', 'nfl', 'KC', 3) = false
              and _autopick_spot_fits('{"pos":["WR"],"teams":["KC"]}', 'WR', 'nfl', 'KC', 3), 'la1e a spot''s team filter');
  perform la_true(_autopick_spot_fits('{"pos":["RB"],"level":"college"}', 'RB', 'college', '', null)
              and not _autopick_spot_fits('{"pos":["RB"],"level":"college"}', 'RB', 'nfl', 'KC', 3)
              and not _autopick_spot_fits('{"pos":["RB"],"level":"nfl"}', 'RB', 'college', '', null), 'la1f a spot''s level');
  perform la_true(not _autopick_spot_fits('{"pos":["RB"],"max_exp":0}', 'RB', 'nfl', 'KC', 3)
              and not _autopick_spot_fits('{"pos":["RB"],"flags":["Rookie"]}', 'RB', 'nfl', 'KC', 0), 'la1g tenure filters, and a flagged spot never matches');
  delete from native_roster where league_id = lid;
  -- A kicker spot waits for the last rounds (0195), even while open.
  perform la_ok(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["RB","WR","TE"]},{"pos":["K"]}]'::jsonb), 'la1h add a K spot');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'la-rb1'), (lid, 1, 'la-rb2'), (lid, 1, 'la-wr1'), (lid, 1, 'la-qb1');
  perform la_true(jsonb_array_length(_autopick_open_spots(lid, 1)) = 0, 'la1i a kicker-only spot is not counted as open');
  perform la_true(native_autopick_slug(lid, 1, 7) = 'la-rb3', 'la1j …so the bench fills by rank');
  perform la_true(native_autopick_slug(lid, 1, 5) = 'la-k1', 'la1k and the kicker comes in the last round');
  delete from native_roster where league_id = lid;
  perform la_ok(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["RB","WR","TE"]}]'::jsonb), 'la1l back to four');

  -- ══ la2. A DRAFTED LEAGUE, TWO WEEKS ══════════════════════════════════════
  insert into native_roster (league_id, roster_id, slug) values
    (lid, 1, 'la-qb1'), (lid, 1, 'la-rb1'), (lid, 1, 'la-wr1'), (lid, 1, 'la-rb2'), (lid, 1, 'la-wr2'), (lid, 1, 'la-te1'),
    (lid, 2, 'la-qb2'), (lid, 2, 'la-rb3'), (lid, 2, 'la-wr3');
  update draft set status = 'live' where league_id = lid;
  perform la_err(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["TE"]},{"pos":["WR"]},{"pos":["RB","WR","TE"]}]'::jsonb),
    'can change once the draft is over', 'la2 a live draft keeps its lineup');
  perform la_ok(set_league_classic_slots(lid, '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["RB"]},{"pos":["WR"]},{"pos":["RB","WR","TE"]}]'::jsonb),
    'la2a …but a rename is free');
  update draft set status = 'complete' where league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at, home_final, away_final)
    values (lid, 4, 1, 2, 'final', now() - interval '6 days', 100, 90) returning id into m4;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
    values (lid, 5, 1, 2, 'scheduled', now() - interval '1 hour') returning id into m5;
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values
    (m4, ua, 'wk', 'S2', 'la-rb1'),
    (m5, ua, 'wk', 'S1', 'la-qb1'), (m5, ua, 'wk', 'S2', 'la-rb1'), (m5, ua, 'wk', 'S3', 'la-wr1'), (m5, ua, 'wk', 'S4', 'la-rb2');

  -- ══ la3. BETWEEN WEEKS ONLY ═══════════════════════════════════════════════
  perform la_err(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["TE"]},{"pos":["WR"]},{"pos":["RB","WR","TE"]}]'::jsonb),
    'Week 5 is under way', 'la3 a week that has kicked off holds the lineup');
  update matchup set lock_at = now() + interval '2 days' where id = m5;

  -- ══ la4. THE CHANGE ═══════════════════════════════════════════════════════
  r := set_league_classic_slots(lid, '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["TE"]},{"pos":["WR"]},{"pos":["RB","WR","TE"]},{"pos":["RB","WR","TE"]}]'::jsonb);
  perform la_ok(r, 'la4 RB → TE, and a second FLEX');
  perform la_true((r ->> 'picks_cleared')::int = 1, 'la4a one saved pick sat in a changed spot: ' || r::text);
  perform la_true((select array_agg(roster_slot order by roster_slot) from sealed_pick where matchup_id = m5) = array['S1', 'S3', 'S4'],
    'la4b THE POINT: S2 (RB → TE) is cleared for Week 5; the rest stand');
  perform la_true(exists (select 1 from sealed_pick where matchup_id = m4 and roster_slot = 'S2'), 'la4c a played week is untouched');
  perform la_true((select rounds from draft where league_id = lid) = 7 and (r ->> 'rounds')::int = 7, 'la4d the roster grows by the new spot (5 + 2)');
  perform la_true((select body from league_message where league_id = lid order by id desc limit 1)
    = 'Starting lineup changed by the commissioner: Signal Caller · RB · WR · FLEX → Signal Caller · TE · WR · FLEX · FLEX. Saved lineups in the changed spots were cleared — check your lineup.',
    'la4e the league hears about it, old → new: ' || (select body from league_message where league_id = lid order by id desc limit 1));

  -- ══ la5. FEWER SPOTS: THE BENCH GROWS SO NOBODY IS ILLEGAL ════════════════
  perform la_err(set_league_classic_slots(lid, '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["WR"]}]'::jsonb),
    'no spot in that lineup would start one', 'la5 a lineup with no spot for the RBs teams hold is refused');
  r := set_league_classic_slots(lid, '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["RB","WR","TE"]}]'::jsonb);
  perform la_ok(r, 'la5 down to two starters: QB and a FLEX');
  perform la_true((r ->> 'bench_grew')::int = 2 and (select settings_json -> 'roster_shape' ->> 'bench' from league where id = lid) = '4',
    'la5a team 1 holds six active players: 2 starters + a bench of 4');
  perform la_true(roster_illegal_reason(lid, 1) is null, 'la5b …and is legal: ' || coalesce(roster_illegal_reason(lid, 1), ''));
  perform la_true((select array_agg(roster_slot order by roster_slot) from sealed_pick where matchup_id = m5) = array['S1'],
    'la5c S2 (TE → FLEX) and the removed S3–S5 are cleared');
  perform la_true((select body from league_message where league_id = lid order by id desc limit 1) like '%The bench grew by 2 so every team stays legal.%',
    'la5d the bench change is announced with it');

  -- ══ la6. WHAT STAYS AS IT WAS ═════════════════════════════════════════════
  r := set_league_classic_slots(lid, '[{"pos":["QB"],"label":"QB1"},{"pos":["RB","WR","TE"]}]'::jsonb);
  perform la_ok(r, 'la6 a rename after the draft');
  perform la_true((select count(*) from league_message where league_id = lid and txn ->> 'kind' = 'lineup') = 2, 'la6a …posts nothing');
  perform la_err(set_league_classic_slots(lid, '[]'::jsonb), 'edit its spots instead', 'la6b a drafted league cannot drop its lineup spec');
  perform la_as('02');
  perform la_err(set_league_classic_slots(lid, '[{"pos":["QB"]}]'::jsonb), 'commissioner only', 'la6c a member cannot');

  delete from league where id = lid;
  raise notice 'lineup-after-draft probes done';
end $$;

select 'ALL LINEUP-AFTER-DRAFT PROBES PASSED' as result;
