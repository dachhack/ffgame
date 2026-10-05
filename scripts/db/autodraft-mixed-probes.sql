-- 0441 probes: THE AUTODRAFT IN A MIXED LEAGUE.
--
--   • with IR spots (a stash the draft never fills), the kicker and defense
--     still arrive in the last rounds — the picks left are rounds − stash;
--   • a college starting spot earns two-deep: after the NFL bench depth the
--     autodraft takes college players until it holds two per college spot,
--     then goes back to the NFL rank picks.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function ad_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ad_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function ad_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000059' || u, false); perform set_config('app.email', 'ad' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000005901', 'ad01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000005901', 'ad01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id = '00000000-0000-0000-0000-000000005901';

insert into college_player (espn_id, full_name, pos, school_abbr, class_year, active, division) values
  ('98911', 'Depth Back', 'RB', 'ADU', 2, true, 'FBS'), ('98912', 'Depth Wideout', 'WR', 'ADU', 3, true, 'FBS'),
  ('98913', 'Depth Tight', 'TE', 'ADU', 3, true, 'FBS'), ('98914', 'Depth Back Two', 'RB', 'ADU', 4, true, 'FBS'),
  ('98915', 'Depth Wideout Two', 'WR', 'ADU', 2, true, 'FBS')
  on conflict (espn_id) do update set full_name = excluded.full_name, pos = excluded.pos, class_year = excluded.class_year, active = excluded.active, division = excluded.division;

-- A pool: six of every NFL position (K and DEF included), then the college players.
create or replace function ad_pool() returns jsonb language sql as $$
  select (select jsonb_agg(jsonb_build_object('slug', 'ad-' || p.pos || '-' || i, 'full', 'Ad ' || p.pos || ' ' || i, 'pos', p.pos, 'team', 'KC') order by p.ord, i)
            from (values ('QB', 1), ('RB', 2), ('WR', 3), ('TE', 4), ('K', 5), ('DEF', 6)) p(pos, ord), generate_series(1, 6) i)
      || (select jsonb_agg(jsonb_build_object('slug', 'c-' || cp.espn_id, 'full', cp.full_name, 'pos', cp.pos) order by cp.espn_id)
            from college_player cp where cp.espn_id in ('98911', '98912', '98913', '98914', '98915'))
$$;

do $$
declare r jsonb; a uuid; b uuid; rounds int; stash int; need int; i int; e text; pick text; ppos text;
begin
  perform ad_as('01');

  -- ══ ad1. K AND D/ST ARRIVE DESPITE AN IR STASH ═══════════════════════════
  r := create_native_league('AD Stash', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  a := (r ->> 'league_id')::uuid;
  perform ad_ok(commish_setup_college(a, 'mixed', 1, 0, false), 'ad1 a mixed league with one college spot');
  perform ad_ok(set_league_roster_shape(a, (_roster_shape(a) ->> 'bench')::int, 0, 2, 0, 0), 'ad1a two IR spots — a stash the draft never fills');
  perform ad_ok(seed_league_pool(a, ad_pool()), 'ad1b pool');
  select d.rounds, d.stash_slots into rounds, stash from draft d where d.league_id = a;
  perform ad_true(stash = 2 and rounds = 10 + (_roster_shape(a) ->> 'bench')::int + 2, 'ad1c rounds carry the stash (' || rounds || ', stash ' || stash || ')');
  -- the team has made every pick but its last two: starters (no K/DEF) and bench
  foreach e in array array['ad-QB-1', 'ad-RB-1', 'ad-RB-2', 'ad-WR-1', 'ad-WR-2', 'ad-TE-1', 'ad-RB-3', 'c-98911'] loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, e, 'draft');
  end loop;
  need := rounds - stash - 2;
  foreach e in array array['ad-WR-3', 'ad-WR-4', 'ad-WR-5', 'ad-WR-6', 'ad-TE-2', 'ad-TE-3', 'ad-TE-4', 'ad-QB-2', 'ad-QB-3', 'ad-RB-4', 'ad-RB-5'] loop
    exit when (select count(*) from native_roster where league_id = a and roster_id = 1) >= need;
    insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, e, 'draft');
  end loop;
  perform ad_true((select count(*) from native_roster where league_id = a and roster_id = 1) = need, 'ad1c2 the team holds all but its last two drafted picks (' || need || ')');
  pick := native_autopick_slug(a, 1, rounds);
  select lp.pos into ppos from league_pool lp where lp.league_id = a and lp.slug = pick;
  perform ad_true(ppos = 'K', 'ad1d two picks left of the ones the draft makes: the kicker (got ' || coalesce(pick, 'null') || ')');
  insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, pick, 'draft');
  pick := native_autopick_slug(a, 1, rounds);
  select lp.pos into ppos from league_pool lp where lp.league_id = a and lp.slug = pick;
  perform ad_true(ppos = 'DEF', 'ad1e …then the defense (got ' || coalesce(pick, 'null') || ')');

  -- ══ ad2. COLLEGE GOES TWO DEEP ═══════════════════════════════════════════
  r := create_native_league('AD Depth', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  b := (r ->> 'league_id')::uuid;
  perform ad_ok(commish_setup_college(b, 'mixed', 2, 0, false), 'ad2 a mixed league with two college spots');
  perform ad_ok(set_league_roster_shape(b, 16, 0, 0, 0, 0), 'ad2a a deep bench');
  perform ad_ok(seed_league_pool(b, ad_pool()), 'ad2b pool');
  select d.rounds into rounds from draft d where d.league_id = b;
  -- every NFL starting spot filled and the NFL bench depth met (two per spot: QB 2, RB 6, WR 6, TE 4), K and DEF in, one college player per college spot
  foreach e in array array['ad-QB-1', 'ad-QB-2', 'ad-RB-1', 'ad-RB-2', 'ad-RB-3', 'ad-RB-4', 'ad-RB-5', 'ad-RB-6',
                           'ad-WR-1', 'ad-WR-2', 'ad-WR-3', 'ad-WR-4', 'ad-WR-5', 'ad-WR-6', 'ad-TE-1', 'ad-TE-2', 'ad-TE-3', 'ad-TE-4',
                           'ad-K-1', 'ad-DEF-1', 'c-98911', 'c-98912'] loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (b, 1, e, 'draft');
  end loop;
  perform ad_true(jsonb_array_length(_autopick_open_spots(b, 1)) = 0, 'ad2c no starting spot is open');
  pick := native_autopick_slug(b, 1, rounds);
  perform ad_true(pick ~ '^c-[0-9]+$', 'ad2d with two college players for two college spots, the next pick is a college player (got ' || coalesce(pick, 'null') || ')');
  insert into native_roster (league_id, roster_id, slug, acquired) values (b, 1, pick, 'draft');
  pick := native_autopick_slug(b, 1, rounds);
  perform ad_true(pick ~ '^c-[0-9]+$', 'ad2e …and the one after (got ' || coalesce(pick, 'null') || ')');
  insert into native_roster (league_id, roster_id, slug, acquired) values (b, 1, pick, 'draft');
  pick := native_autopick_slug(b, 1, rounds);
  perform ad_true(pick !~ '^c-[0-9]+$', 'ad2f at two per college spot, the rank picks are NFL again (got ' || coalesce(pick, 'null') || ')');

  delete from league where id in (a, b);
  raise notice 'autodraft-mixed probes done';
end $$;

delete from college_player where espn_id in ('98911', '98912', '98913', '98914', '98915');
drop function if exists ad_pool();

select 'ALL AUTODRAFT-MIXED PROBES PASSED' as result;
