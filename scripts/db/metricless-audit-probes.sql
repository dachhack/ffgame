-- 0211 probes: the metricless-pick audit.
--
-- The audit's whole job is to be believed, so what these check is that it
-- counts the RIGHT rows: a classic null is correct and must not appear, a
-- locked row must sort first (it is the unfixable one), and an agent row must
-- be counted separately because autoLineup should make it impossible.
\set QUIET on
\pset pager off
set client_min_messages = notice;

do $$
declare
  lg uuid; mid uuid;
  ua uuid;
  r jsonb; n int;
begin
  ua := '00000000-0000-0000-0000-0000000f0001';
  insert into auth.users (id, email) values (ua, 'mp1@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values (ua, 'mp1@test.dev') on conflict (id) do nothing;

  insert into league (id, sleeper_league_id, name, season, provider, invite_code, commissioner_id)
  values (gen_random_uuid(), 'METRICLESS-PROBE', 'Audit League', '2026', 'native', 'MTRC0001', ua)
  returning id into lg;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name, controller)
  values (lg, 1, ua, true, 'Audit Team', 'human');
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status)
  values (gen_random_uuid(), lg, 3, 1, 2, 'live') returning id into mid;

  -- A GOOD pick, a BAD pick, and a CLASSIC null (which is correct, not a find).
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked)
  values (mid, ua, 'tnf', 'S1', 'jack-bech',        'recyd', false),
         (mid, ua, 'tnf', 'S2', 'david-montgomery',  null,   true),
         (mid, ua, 'classic', 'RB1', 'someone-else', null,   false),
         -- 0212: an EMPTY STRING is equally dead and equally invisible — `??`
         -- falls through on null only, so '' reaches the card and fails the
         -- render test with no null anywhere in sight.
         (mid, ua, 'snf', 'S3', 'empty-string-man',  '',     false);

  -- Not an admin → refused. The audit reads every league in the system.
  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'mp1@test.dev', false);
  r := admin_metricless_picks();
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: a non-admin ran the audit'; end if;

  insert into app_admin (email) values ('mp1@test.dev') on conflict do nothing;
  r := admin_metricless_picks();
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: admin refused: %', r; end if;

  -- 1. It finds the bad one and ONLY the bad one — the classic null is correct
  --    and would drown the signal if counted.
  --
  --    SCOPED TO THIS FIXTURE'S LEAGUE, not the whole table: every probe suite
  --    in this run shares one database and several of them leave metricless
  --    picks behind, so a global count here would assert the shape of the other
  --    suites rather than of this one. (That the audit sees them all is itself
  --    correct — it is a cross-league audit.)
  select count(*) into n from jsonb_array_elements(r -> 'picks') p
    where p ->> 'league' = 'Audit League';
  if n <> 2 then
    raise exception 'PROBE FAIL: expected 2 metricless picks (one null, one empty string) in the fixture league, got % — %', n, r -> 'picks';
  end if;
  if (select count(*) from jsonb_array_elements(r -> 'picks') p where p ->> 'win' = 'classic') <> 0 then
    raise exception 'PROBE FAIL: a classic null was reported as a finding';
  end if;
  if (select count(*) from jsonb_array_elements(r -> 'picks') p
        where p ->> 'league' = 'Audit League' and p ->> 'player_slug' = 'david-montgomery') <> 1 then
    raise exception 'PROBE FAIL: the null-metric row was not reported — %', r -> 'picks';
  end if;
  if (select count(*) from jsonb_array_elements(r -> 'picks') p
        where p ->> 'league' = 'Audit League' and p ->> 'player_slug' = 'empty-string-man') <> 1 then
    raise exception 'PROBE FAIL: an EMPTY-STRING metric was missed — %', r -> 'picks';
  end if;

  -- 2. The LOCKED flag rides along: that is the difference between a warning
  --    and a window the manager can no longer save.
  if not (select (p ->> 'locked')::boolean from jsonb_array_elements(r -> 'picks') p
            where p ->> 'league' = 'Audit League' and p ->> 'player_slug' = 'david-montgomery') then
    raise exception 'PROBE FAIL: the locked flag did not survive';
  end if;

  -- 3. THE READING THAT POINTS AT THE CAUSE. The seat has a sibling slot WITH a
  --    metric, so it was set up properly and then lost one — 0024/0026/0062,
  --    not a manager who never finished.
  if (select (p ->> 'sibling_slots_with_metric')::int from jsonb_array_elements(r -> 'picks') p
        where p ->> 'league' = 'Audit League' and p ->> 'player_slug' = 'david-montgomery') <> 1 then
    raise exception 'PROBE FAIL: sibling count wrong — %', r -> 'picks';
  end if;

  -- 4. Grouped by team, with the controller, so "one workflow slip" and "a code
  --    path writing nulls" look different at a glance.
  if (select count(*) from jsonb_array_elements(r -> 'by_team') t
        where t ->> 'league' = 'Audit League' and t ->> 'team' = 'Audit Team' and (t ->> 'n')::int = 2) <> 1 then
    raise exception 'PROBE FAIL: by_team did not name the team — %', r -> 'by_team';
  end if;

  -- 5. An AGENT row is counted apart, because autoLineup should make it
  --    impossible — one appearing means a DIFFERENT bug.
  --    Asserted as a DELTA for the same shared-database reason as above.
  n := (r ->> 'agent_rows')::int;
  update league_membership set controller = 'ai' where league_id = lg and app_user_id = ua;
  r := admin_metricless_picks();
  if (r ->> 'agent_rows')::int <> n + 2 then
    raise exception 'PROBE FAIL: flipping the seat to AI did not move agent_rows by 2 (% → %)', n, r ->> 'agent_rows';
  end if;

  -- 6. The cap is honest about itself rather than quietly showing less. With
  --    more findings than the cap, `truncated` must say so — a silently short
  --    audit reads as "that is all of them", which is the worst thing an audit
  --    can imply.
  r := admin_metricless_picks(1);
  if jsonb_array_length(r -> 'picks') <> 1 then
    raise exception 'PROBE FAIL: the cap was not applied — % rows', jsonb_array_length(r -> 'picks');
  end if;
  if (r ->> 'total')::int > 1 and not (r ->> 'truncated')::boolean then
    raise exception 'PROBE FAIL: capped output did not report truncated (total %)', r ->> 'total';
  end if;

  -- 7. IT REPAIRS NOTHING. An audit that edits sealed lineups is not an audit.
  if (select metric_id from sealed_pick where matchup_id = mid and roster_slot = 'S2') is not null then
    raise exception 'PROBE FAIL: the audit wrote a metric';
  end if;
  if (select count(*) from sealed_pick where matchup_id = mid) <> 4 then
    raise exception 'PROBE FAIL: the audit changed the pick rows';
  end if;

  delete from sealed_pick where matchup_id = mid;
  delete from matchup where id = mid;
  delete from league_membership where league_id = lg;
  delete from league where id = lg;
  delete from app_admin where email = 'mp1@test.dev';
  delete from app_user where id = ua;
  raise notice 'metricless-audit probes done';
end $$;
select 'ALL METRICLESS-AUDIT PROBES PASSED' as result;
