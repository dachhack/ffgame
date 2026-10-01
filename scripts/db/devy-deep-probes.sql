-- 0404 probes: THE DEVY MARKET GOES ALL THE WAY DOWN.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function dd_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dd_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000057' || u, false); perform set_config('app.email', 'dd' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000005701', 'dd01@test.dev'), ('00000000-0000-0000-0000-000000005702', 'dd02@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000005701', 'dd01@test.dev'), ('00000000-0000-0000-0000-000000005702', 'dd02@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000005701', '00000000-0000-0000-0000-000000005702');

do $$
declare r jsonb; lid uuid; m jsonb; slugs text[];
begin
  perform set_config('app.uid', '', false);
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '96201', 'full_name', 'Priced Deepkid', 'pos', 'WR', 'school', 'Deep State Owls', 'school_abbr', 'DPST', 'class_year', 2),
    jsonb_build_object('espn_id', '96202', 'full_name', 'Board Deepkid', 'pos', 'RB', 'school', 'Deep State Owls', 'school_abbr', 'DPST', 'class_year', 1),
    jsonb_build_object('espn_id', '96203', 'full_name', 'Nobody Deepkid', 'pos', 'TE', 'school', 'Deep State Owls', 'school_abbr', 'DPST', 'class_year', 1),
    jsonb_build_object('espn_id', '96204', 'full_name', 'Lineman Deepkid', 'pos', 'DL', 'school', 'Deep State Owls', 'school_abbr', 'DPST', 'class_year', 3)));
  insert into college_price (espn_id, rank, base, youth) values ('96201', 4000, 1.5, 0) on conflict (espn_id) do update set rank = 4000;
  insert into stathead_devy (espn_id, name, pos, rank_1qb, as_of) values ('96202', 'Board Deepkid', 'RB', 3500, now())
    on conflict (espn_id) do update set rank_1qb = 3500;

  perform dd_as('01');
  r := create_native_league('Deep Devy', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  m := devy_market(lid, 5000, 'deepkid');
  slugs := array(select e ->> 'slug' from jsonb_array_elements(m) e);
  perform dd_true(slugs = array['c-96201', 'c-96202', 'c-96203'],
    'dd1 the search finds every skill player, priced, then StatHead-ranked, then the rest: ' || m::text);
  perform dd_true((m -> 1 ->> 'sh_rank')::int = 3500 and (m -> 1 ->> 'rank') is null, 'dd1a an unpriced player carries StatHead''s rank');
  perform dd_true((m -> 2 ->> 'price')::numeric = 1, 'dd1b and someone nobody ranks costs the 1-point floor');
  perform dd_true(jsonb_array_length(devy_market(lid, 5000, 'DPST')) = 3, 'dd2 a school abbreviation finds its players');
  perform dd_true(jsonb_array_length(devy_market(lid, 5000, 'deep state')) = 3, 'dd2a and so does the school name');
  perform dd_true(jsonb_array_length(devy_market(lid, 5)) <= 5, 'dd3 the limit holds');

  perform dd_as('02');
  perform dd_true(devy_market(lid, 50, 'deepkid') = '[]'::jsonb, 'dd4 not a member, no list');

  perform dd_as('01');
  delete from league where id = lid;
  perform set_config('app.uid', '', false);
  delete from stathead_devy where espn_id like '962%';
  delete from college_price where espn_id like '962%';
  delete from college_player where espn_id like '962%';
end $$;

select 'ALL DEVY-DEEP PROBES PASSED' as result;
