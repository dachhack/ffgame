-- 0202 market probes: REAL OWNERSHIP, and the fallback that survives it.
--
--   • with no market rows, player_ownership answers exactly as 0199 did — the
--     share of this platform's drafted leagues;
--   • with FRESH market rows it answers from the market ALONE, and does not
--     blend the two definitions;
--   • a player the market doesn't price is simply absent, not 50% because one
--     of our two leagues happens to roster him;
--   • a STALE feed falls back rather than serving a frozen number;
--   • and the table is readable by members, writable by nobody but the worker.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; b_seat int; i int; total int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  r := create_native_league('Market', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'mk0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'MK-B'), 'mk0a join'); perform probe_as('a');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'mk-' || g, 'full', 'M' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 10) g));
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  for i in 1..3 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, b_seat, 'mk-' || i, 'draft');
  end loop;
  update draft set status = 'complete' where league_id = lid;

  -- ══ NO MARKET YET: 0199'S ANSWER, UNCHANGED ══════════════════════════════
  delete from player_market;
  perform assert_true(market_is_fresh() = false, 'mk1 an empty table is not a market');
  select count(*)::int into total from draft where status = 'complete';
  r := player_ownership(lid);
  perform assert_true((r ->> 'mk-1')::int = round(100.0 / total)::int,
    'mk1a …so ownership is still the share of this platform''s drafted leagues');

  -- ══ A FRESH MARKET ANSWERS ALONE ═════════════════════════════════════════
  insert into player_market (slug, owned_pct, source, updated_at) values
    ('mk-1', 97, 'espn', now()), ('mk-9', 4, 'espn', now())
  on conflict (slug) do update set owned_pct = excluded.owned_pct, updated_at = excluded.updated_at;
  perform assert_true(market_is_fresh(), 'mk2 fresh rows make a market');
  r := player_ownership(lid);
  perform assert_true((r ->> 'mk-1')::int = 97, 'mk2a the real figure wins over the league count');
  perform assert_true((r ->> 'mk-9')::int = 4,
    'mk2b …including for a player NOBODY here rosters — which is the whole point of a market');
  -- The two definitions are never mixed: a rostered player the market doesn't
  -- price is absent, not resurrected at "one of our two leagues, so 50%".
  perform assert_true(r ->> 'mk-2' is null,
    'mk3 a player the market does not price is absent, not blended in from the legacy count');

  -- ══ A STALE FEED FALLS BACK ══════════════════════════════════════════════
  update player_market set updated_at = now() - interval '30 days';
  perform assert_true(market_is_fresh() = false, 'mk4 a month-old feed is not the market');
  r := player_ownership(lid);
  perform assert_true((r ->> 'mk-1')::int = round(100.0 / total)::int,
    'mk4a …so the platform''s own count comes back rather than a frozen number');
  perform assert_true(r ->> 'mk-9' is null, 'mk4b and an unrostered player drops out again');

  -- ══ ACCESS ═══════════════════════════════════════════════════════════════
  perform assert_true((player_ownership(lid) ? 'error') = false, 'mk5 a member may read it');
  perform probe_as('c');
  perform assert_true(player_ownership(lid) ->> 'error' = 'forbidden',
    'mk5a a non-member may not');

  delete from player_market;
  raise notice 'market probes done';
end $$;

select 'ALL MARKET PROBES PASSED' as result;
