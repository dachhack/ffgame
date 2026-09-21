-- 0329 probes: THIS WEEK'S NUMBER, AND THE NEWS.
--   • the worker's upserts are idempotent and update in place;
--   • a league reads the week's projections keyed by ITS slugs, through the
--     espn_id crosswalk, and a player without one is simply absent rather
--     than zero;
--   • the news feed is filtered to players this league actually holds, and
--     one story tagging two of them appears once with both named;
--   • a stranger reads neither; a public league's API may.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function wp_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function wp_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000019' || u, false); perform set_config('app.email', 'wp' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001901', 'wp01@test.dev'), ('00000000-0000-0000-0000-000000001902', 'wp02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001901', 'wp01@test.dev'), ('00000000-0000-0000-0000-000000001902', 'wp02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001901', '00000000-0000-0000-0000-000000001902');

do $$
declare r jsonb; lid uuid; seas text;
begin
  perform wp_as('01');
  r := create_native_league('WeekProj', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform wp_true((r ->> 'ok')::boolean, 'wp0 league'); lid := (r ->> 'league_id')::uuid;
  select season into seas from league where id = lid;
  -- Two players with a crosswalk id and one without.
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id) values
    (lid, 'wp-star', 'Star Player', 'RB', 'WPH', 1, '111'),
    (lid, 'wp-other', 'Other Player', 'WR', 'WPH', 2, '222'),
    (lid, 'wp-nobody', 'No Crosswalk', 'TE', 'WPH', 3, null);

  -- ── wp1. the worker's write ──
  r := upsert_week_projections(seas, 3, jsonb_build_array(
    jsonb_build_object('espn_id', '111', 'pts', 18.4, 'line', jsonb_build_object('ruYd', 80, 'ruTd', 0.6)),
    jsonb_build_object('espn_id', '222', 'pts', 11.1, 'line', jsonb_build_object('reYd', 60, 'rec', 5)),
    jsonb_build_object('espn_id', '999', 'pts', 9.9, 'line', null)));
  perform wp_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 3, 'wp1 three rows written');
  r := upsert_week_projections(seas, 3, jsonb_build_array(
    jsonb_build_object('espn_id', '111', 'pts', 19.9, 'line', jsonb_build_object('ruYd', 90))));
  perform wp_true((select pts from nfl_week_proj where season = seas and week = 3 and espn_id = '111') = 19.9,
    'wp1 a second poll updates in place');
  perform wp_true((select count(*) from nfl_week_proj where season = seas and week = 3) = 3,
    'wp1 and does not duplicate');

  -- ── wp2. the league reads its own slugs ──
  r := league_week_projections(lid, 3);
  perform wp_true((r ->> 'ok')::boolean, 'wp2 the league reads it');
  perform wp_true((r -> 'projections' ->> 'wp-star')::numeric = 19.9
    and (r -> 'projections' ->> 'wp-other')::numeric = 11.1, 'wp2 keyed by OUR slugs, through the crosswalk');
  perform wp_true(not (r -> 'projections' ? 'wp-nobody'), 'wp2 a player with no crosswalk id is absent, not zero');
  perform wp_true(not (r -> 'projections' ? '999'), 'wp2 and a projection for nobody in this league is not in it');
  perform wp_true((league_week_projections(lid, 4) -> 'projections') = '{}'::jsonb,
    'wp2 a week nobody has polled is empty, not an error');

  -- ── wp3. the news ──
  r := upsert_player_news(jsonb_build_array(
    jsonb_build_object('id', 'n1', 'at', (now() - interval '1 hour')::text,
      'headline', 'Star Player limited in practice', 'summary', 'ankle', 'url', 'https://x/1',
      'athletes', jsonb_build_array('111')),
    jsonb_build_object('id', 'n2', 'at', now()::text,
      'headline', 'Two of them are out', 'summary', '', 'url', 'https://x/2',
      'athletes', jsonb_build_array('111', '222')),
    jsonb_build_object('id', 'n3', 'at', now()::text,
      'headline', 'Somebody else entirely', 'summary', '', 'url', 'https://x/3',
      'athletes', jsonb_build_array('999'))));
  perform wp_true((r ->> 'ok')::boolean and (r ->> 'rows')::int = 3, 'wp3 three items written');
  r := league_news(lid);
  perform wp_true(jsonb_array_length(r -> 'news') = 2, 'wp3 only the two about this league''s players');
  perform wp_true((r -> 'news' -> 0 ->> 'headline') = 'Two of them are out', 'wp3 newest first');
  perform wp_true(jsonb_array_length(r -> 'news' -> 0 -> 'players') = 2,
    'wp3 a story tagging two of them names both, once');
  perform wp_true(jsonb_array_length(player_news_for('111')) = 2
    and jsonb_array_length(player_news_for('222')) = 1, 'wp3 one player''s own headlines');
  -- an edit in place rather than a duplicate
  perform upsert_player_news(jsonb_build_array(jsonb_build_object('id', 'n1', 'at', now()::text,
    'headline', 'Star Player FULL practice', 'athletes', jsonb_build_array('111'))));
  perform wp_true((select headline from player_news where id = 'n1') = 'Star Player FULL practice'
    and (select count(*) from player_news) = 3, 'wp3 a corrected headline replaces itself');

  -- ── wp4. who may read it ──
  -- A league that lives here is public by default (0327), so an outsider CAN
  -- read both; opting out shuts them, which is the same door the API uses.
  perform wp_as('02');
  perform wp_true((league_week_projections(lid, 3) ->> 'ok')::boolean, 'wp4 a public league answers anyone');
  perform wp_true((league_news(lid) ->> 'ok')::boolean, 'wp4 news too');
  perform wp_as('01');
  perform wp_true((commish_set_public_api(lid, false) ->> 'ok')::boolean, 'wp4 the commissioner opts out');
  perform wp_as('02');
  perform wp_true(league_week_projections(lid, 3) ->> 'error' = 'forbidden', 'wp4 now a stranger reads no projections');
  perform wp_true(league_news(lid) ->> 'error' = 'forbidden', 'wp4 nor the news');
  perform wp_as('01');
  perform wp_true((league_week_projections(lid, 3) ->> 'ok')::boolean, 'wp4 the league''s own members always could');
end $$;

select 'ALL WEEK-PROJ PROBES PASS' as result;
drop function if exists wp_true(boolean, text);
drop function if exists wp_as(text);
