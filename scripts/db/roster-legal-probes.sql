-- 0360 probes: THE ROSTER HAS TO BE LEGAL.
--   • a healed player on IR makes the roster illegal: no add, no lineup
--     write; moving him to active is allowed and fixes it;
--   • no injury feed at all (an empty table) judges nobody;
--   • a taxi player past the experience ceiling: illegal until moved;
--   • a shelf over its spots, and an active roster over its seats;
--   • league_roster_issues (members) and league_illegal_rosters (worker).
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function rl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function rl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function rl_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function rl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000023' || u, false);
      perform set_config('app.email', 'rl' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002301', 'rl01@test.dev'), ('00000000-0000-0000-0000-000000002302', 'rl02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000002301', 'rl01@test.dev'), ('00000000-0000-0000-0000-000000002302', 'rl02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000002301', '00000000-0000-0000-0000-000000002302');
insert into nfl_slate (season, week, win, home, away, kickoff) values ('2026', 95, 'sun_early', 'PHI', 'DAL', now() + interval '3 days')
on conflict do nothing;

do $$
declare r jsonb; lid uuid; code text; b int; bu uuid := '00000000-0000-0000-0000-000000002302'; mid uuid; saved_inj int;
begin
  perform rl_as('01');
  r := create_native_league('Legal', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform rl_ok(r, 'l0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform rl_as('02'); perform rl_ok(native_join(code, 'RL-B'), 'l0 B joins');
  perform rl_as('01');
  perform rl_ok(set_league_classic_slots(lid, '[{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'l0 two starters');
  perform rl_ok(set_league_roster_shape(lid, 1, 1, 1), 'l0 one bench, one taxi, one IR');
  perform rl_ok(set_taxi_rules(lid, 0, false), 'l0 rookies-only taxi');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'rl-' || g, 'full', 'Legal Player ' || g, 'pos', case when g % 2 = 0 then 'RB' else 'WR' end,
             'team', 'PHI', 'exp', case when g = 5 then 0 else 4 end))
    from generate_series(1, 20) g));
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = bu;
  insert into native_roster (league_id, roster_id, slug, acquired, spot) values
    (lid, b, 'rl-1', 'draft', 'active'), (lid, b, 'rl-2', 'draft', 'active'), (lid, b, 'rl-4', 'draft', 'ir'), (lid, b, 'rl-5', 'draft', 'taxi');
  update draft set status = 'complete' where league_id = lid;
  perform rl_ok(set_transaction_rules(lid, p_fa_mode => 'open',
    p_waiver_days => '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb, p_waiver_game_hold_dow => -1), 'l0 free agency open');
  insert into injury_status (player_slug, status) values ('rl-4', 'IR'), ('someone-else', 'Q')
    on conflict (player_slug) do update set status = excluded.status;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    select lid, 95, sleeper_roster_id, b, 'scheduled' from league_membership where league_id = lid and sleeper_roster_id <> b
    returning id into mid;
  perform rl_true(roster_illegal_reason(lid, b) is null, 'l0 legal to start: ' || coalesce(roster_illegal_reason(lid, b), ''));

  -- ── l1. he heals ──
  delete from injury_status where player_slug = 'rl-4';
  perform rl_true(roster_illegal_reason(lid, b) = 'Legal Player 4 is on IR but isn''t designated IR/O any more — move him off IR or drop him',
    'l1 said: ' || coalesce(roster_illegal_reason(lid, b), '∅'));
  perform rl_as('02');
  perform rl_refused(add_free_agent(lid, b, 'rl-10', null), 'isn''t designated', 'l1 no pickups');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values (mid, bu, 'wk', 'S1', 'rl-2');
    raise exception 'PROBE FAIL l1 — a lineup was written with an illegal roster';
  exception when others then
    if sqlerrm like 'PROBE FAIL%' then raise; end if;
  end;
  perform rl_ok(set_roster_spot(lid, 'rl-4', 'active'), 'l1 the fix is allowed');
  perform rl_true(roster_illegal_reason(lid, b) is null, 'l1 legal again');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values (mid, bu, 'wk', 'S1', 'rl-2');

  -- ── l2. no feed judges nobody ──
  insert into injury_status (player_slug, status) values ('rl-4', 'IR') on conflict (player_slug) do update set status = 'IR';
  perform rl_ok(set_roster_spot(lid, 'rl-4', 'ir'), 'l2 back on IR');
  create temp table rl_inj as select * from injury_status;
  delete from injury_status;
  perform rl_true(roster_illegal_reason(lid, b) is null, 'l2 an empty feed flags nobody');
  insert into injury_status select * from rl_inj;

  -- ── l3. the taxi rookie is a rookie no more ──
  update league_pool set exp = 1 where league_id = lid and slug = 'rl-5';
  perform rl_true(roster_illegal_reason(lid, b) like 'Legal Player 5 is on the taxi squad with 1 year (the limit is 0)%',
    'l3 said: ' || coalesce(roster_illegal_reason(lid, b), '∅'));
  perform rl_ok(set_roster_spot(lid, 'rl-5', 'active'), 'l3 off the taxi');
  perform rl_true(roster_illegal_reason(lid, b) is null, 'l3 legal');

  -- ── l4. a shelf over its spots; the active roster over its seats ──
  update league_pool set exp = 0 where league_id = lid and slug in ('rl-6', 'rl-8');
  insert into native_roster (league_id, roster_id, slug, acquired, spot) values (lid, b, 'rl-6', 'commish', 'taxi'), (lid, b, 'rl-8', 'commish', 'taxi');
  perform rl_true(roster_illegal_reason(lid, b) = 'the taxi squad holds 2 (limit 1) — move or drop 1', 'l4 taxi: ' || coalesce(roster_illegal_reason(lid, b), '∅'));
  delete from native_roster where league_id = lid and slug in ('rl-6', 'rl-8');
  -- Three seats (two starters, one bench) and the taxi's one spot open: four
  -- active is the draft's normal overflow, five is one too many.
  insert into native_roster (league_id, roster_id, slug, acquired, spot) values (lid, b, 'rl-6', 'commish', 'active');
  perform rl_true(roster_illegal_reason(lid, b) is null, 'l4 four active in three seats + an open taxi spot is legal: ' || coalesce(roster_illegal_reason(lid, b), '∅'));
  insert into native_roster (league_id, roster_id, slug, acquired, spot) values (lid, b, 'rl-8', 'commish', 'active');
  perform rl_true(roster_illegal_reason(lid, b) = 'the active roster holds 5 (room for 4) — drop or stash 1', 'l4 active: ' || coalesce(roster_illegal_reason(lid, b), '∅'));

  -- ── l5. the reads ──
  perform rl_as('01');
  r := league_roster_issues(lid);
  perform rl_true(r -> 'issues' ->> b::text like 'the active roster holds 5%' and jsonb_typeof(r -> 'issues') = 'object'
    and (select count(*) from jsonb_object_keys(r -> 'issues')) = 1, 'l5 league issues: ' || r::text);
  perform rl_true((select count(*) from league_illegal_rosters(array[lid]) x where x.roster_id = b) = 1, 'l5 the worker read');
  perform rl_as('02');
  perform rl_ok(drop_player(lid, b, 'rl-6'), 'l5 a drop always works');
  perform rl_ok(drop_player(lid, b, 'rl-8'), 'l5 and another');
  perform rl_true(roster_illegal_reason(lid, b) is null, 'l5 legal after the drop');
end $$;
select 'ALL ROSTER-LEGAL PROBES PASS';
