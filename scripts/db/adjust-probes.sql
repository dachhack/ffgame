-- 0355 probes: THE COMMISSIONER CORRECTS A STAT.
--   • the commissioner adjusts one player's week: saved, the league told, and
--     `rescore` false while the week has no finals;
--   • a second save on the same player-week replaces, not adds;
--   • on a stamped week the answer says a re-score is needed;
--   • 0 removes it (and says what it was); removing nothing is quiet;
--   • refusals: a manager, a drip league, no reason, out of range, a week the
--     league doesn't have, a player not in the pool;
--   • any member reads the week's adjustments; only the commissioner's search
--     finds players, rostered first, with the team that has him.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function aj_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function aj_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function aj_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function aj_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000018' || u, false);
      perform set_config('app.email', 'aj' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001801', 'aj01@test.dev'), ('00000000-0000-0000-0000-000000001802', 'aj02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001801', 'aj01@test.dev'), ('00000000-0000-0000-0000-000000001802', 'aj02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001802');

do $$
declare r jsonb; lid uuid; dlid uuid; code text; b int; n int; line text;
begin
  perform aj_as('01');
  r := create_native_league('Adjusted', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform aj_ok(r, 'a0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform aj_as('02'); perform aj_ok(native_join(code, 'AJ-B'), 'a0 B joins');
  perform aj_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'aj-' || g, 'full', 'Adjust Player ' || g, 'pos', 'WR', 'team', 'AJJ', 'exp', 0))
    from generate_series(1, 20) g));
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001802';
  -- Weeks the real slate doesn't cover, planted by hand: a generated schedule
  -- starts at the league's current week, which depends on what ran before.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    select lid, w, min(sleeper_roster_id), max(sleeper_roster_id), 'scheduled'
      from league_membership, generate_series(96, 97) w where league_id = lid group by w;
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, b, 'aj-12', 'draft');

  -- ── a1. the commissioner adjusts ──
  r := commish_set_player_adjustment(lid, 96, 'aj-12', 6, 'TD credited to the wrong receiver');
  perform aj_ok(r, 'a1 adjust');
  perform aj_true((r ->> 'rescore')::boolean = false, 'a1 an unstamped week needs no re-score');
  perform aj_true((select points from player_adjustment where league_id = lid and week = 96 and slug = 'aj-12') = 6, 'a1 stored');
  select body into line from league_message where league_id = lid order by created_at desc, id desc limit 1;
  perform aj_true(line = '✏️ The commissioner adjusted Adjust Player 12''s week 96 score by +6.0 — TD credited to the wrong receiver',
    'a1 the league is told: ' || coalesce(line, '∅'));

  -- ── a2. a second save replaces ──
  perform aj_ok(commish_set_player_adjustment(lid, 96, 'aj-12', -2.25, 'fumble reassigned'), 'a2 replace');
  perform aj_true((select count(*) from player_adjustment where league_id = lid) = 1, 'a2 still one row');
  perform aj_true((select points from player_adjustment where league_id = lid and slug = 'aj-12') = -2.3, 'a2 replaced, one decimal');

  -- ── a3. a stamped week says it needs a re-score ──
  update matchup set home_final = 100, away_final = 90, status = 'final' where league_id = lid and week = 97;
  r := commish_set_player_adjustment(lid, 97, 'aj-3', 1.5, 'stat correction');
  perform aj_ok(r, 'a3 adjust week 97');
  perform aj_true((r ->> 'rescore')::boolean, 'a3 a stamped week needs a re-score');

  -- ── a4. reads ──
  perform aj_as('02');
  r := league_player_adjustments(lid, 96, 'Adjust');
  perform aj_ok(r, 'a4 a member reads');
  perform aj_true(jsonb_array_length(r -> 'adjustments') = 1 and r #>> '{adjustments,0,slug}' = 'aj-12', 'a4 week 96 only');
  perform aj_true(jsonb_array_length(r -> 'found') = 0, 'a4 a member''s search finds nothing');
  perform aj_true(jsonb_array_length(league_player_adjustments(lid) -> 'adjustments') = 2, 'a4 every week without p_week');
  perform aj_as('01');
  r := league_player_adjustments(lid, 96, 'Adjust Player 1');
  perform aj_true(r #>> '{found,0,slug}' = 'aj-12' and r #>> '{found,0,owner}' = 'AJ-B', 'a4 rostered first, with his team: ' || (r -> 'found')::text);

  -- ── a5. refusals ──
  perform aj_as('02');
  perform aj_refused(commish_set_player_adjustment(lid, 96, 'aj-12', 3, 'x'), 'commissioner only', 'a5 a manager');
  perform aj_as('01');
  perform aj_refused(commish_set_player_adjustment(lid, 96, 'aj-12', 3, '  '), 'say why', 'a5 no reason');
  perform aj_refused(commish_set_player_adjustment(lid, 96, 'aj-12', 51, 'x'), 'between -50', 'a5 too many');
  perform aj_refused(commish_set_player_adjustment(lid, 96, 'aj-12', -50.5, 'x'), 'between -50', 'a5 too few');
  perform aj_refused(commish_set_player_adjustment(lid, 99, 'aj-12', 3, 'x'), 'no week 99', 'a5 no such week');
  perform aj_refused(commish_set_player_adjustment(lid, 96, 'nobody', 3, 'x'), 'pool', 'a5 not in the pool');
  r := create_native_league('Dripping', '2026', 2, 8, 60, 'snake', 200, 15, 1);
  dlid := (r ->> 'league_id')::uuid;
  perform aj_refused(commish_set_player_adjustment(dlid, 1, 'aj-12', 3, 'x'), 'classic', 'a5 a drip league');

  -- ── a6. removal ──
  select count(*) into n from league_message where league_id = lid;
  r := commish_set_player_adjustment(lid, 96, 'aj-12', 0, null);
  perform aj_ok(r, 'a6 remove');
  perform aj_true(not exists (select 1 from player_adjustment where league_id = lid and week = 96), 'a6 gone');
  select body into line from league_message where league_id = lid order by created_at desc, id desc limit 1;
  perform aj_true(line = '✏️ The commissioner removed the week 96 adjustment on Adjust Player 12 (was -2.3)', 'a6 in words: ' || line);
  r := commish_set_player_adjustment(lid, 96, 'aj-12', 0, null);
  perform aj_true((r ->> 'removed')::boolean = false, 'a6 removing nothing');
  perform aj_true((select count(*) from league_message where league_id = lid) = n + 1, 'a6 and quietly');
end $$;
select 'ALL ADJUST PROBES PASS';
