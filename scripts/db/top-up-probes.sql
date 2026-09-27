-- 0386 probes: TOPPING UP A LEAGUE'S POOL.
--
--   • after the draft (where seed_league_pool refuses) the commissioner adds
--     the players the pool lacks, ranked after everyone, as free agents;
--   • nothing already there is removed, re-ranked or doubled — by slug,
--     Sleeper id, ESPN id or a graduated devy alias;
--   • college rows only with COLLEGE on; members can't; the league hears it.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function tu_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tu_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tu_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000053' || u, false); perform set_config('app.email', 'tu' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005301', 'tu01@test.dev'), ('00000000-0000-0000-0000-000000005302', 'tu02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005301', 'tu01@test.dev'), ('00000000-0000-0000-0000-000000005302', 'tu02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005302');
insert into app_admin (email, note) values ('tu01@test.dev', 'top-up probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text;
begin
  perform tu_as('01');
  r := create_native_league('Top Up', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform tu_ok(r, 'tu0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform tu_as('02'); perform tu_ok(native_join(code, 'TU-2'), 'tu0 join'); perform tu_as('01');
  perform tu_ok(seed_league_pool(lid, '[{"slug":"tu-alpha","full":"Tu Alpha","pos":"RB","team":"KC","sleeper_id":"95001","espn_id":"96001"},
                                        {"slug":"tu-beta","full":"Tu Beta","pos":"WR","team":"BUF"}]'::jsonb), 'tu0 seed');
  update draft set status = 'complete' where league_id = lid;
  perform tu_true((seed_league_pool(lid, '[{"slug":"tu-gamma","full":"Tu Gamma","pos":"TE","team":"NYJ"}]'::jsonb) ->> 'ok')::boolean is false,
    'tu0a the seed refuses after the draft — the gap this closes');

  -- ══ tu1. ADDING THE MISSING ═══════════════════════════════════════════════
  r := commish_top_up_pool(lid, '[{"slug":"tu-beta","full":"Tu Beta","pos":"WR","team":"BUF"},
                                   {"slug":"tu-gamma","full":"Tu Gamma","pos":"TE","team":"NYJ"},
                                   {"slug":"tu-alpha-2","full":"Tu Alpha","pos":"RB","team":"KC","sleeper_id":"95001"},
                                   {"slug":"tu-alpha-3","full":"Tu Alpha","pos":"RB","team":"KC","espn_id":"96001"},
                                   {"slug":"tu-delta","full":"Tu Delta","pos":"QB","team":"MIA"},
                                   {"slug":"tu-bad","full":"Tu Bad","pos":"OL","team":"MIA"},
                                   {"slug":"c-95901","full":"College Kid","pos":"WR"}]'::jsonb);
  perform tu_ok(r, 'tu1 top up');
  perform tu_true((r ->> 'added')::int = 2, 'tu1a only Gamma and Delta are new (no dupes by slug / sleeper / espn, no OL, no college without COLLEGE): ' || r::text);
  perform tu_true((select rank from league_pool where league_id = lid and slug = 'tu-gamma') = 3
              and (select rank from league_pool where league_id = lid and slug = 'tu-delta') = 4
              and (select rank from league_pool where league_id = lid and slug = 'tu-alpha') = 1,
    'tu1b newcomers rank after everyone, in the order given; the old ranks stand');
  perform tu_true((select waived_until from league_pool where league_id = lid and slug = 'tu-gamma') is null, 'tu1c a newcomer is a free agent');
  perform tu_true(exists (select 1 from league_message where league_id = lid and kind = 'txn' and txn ->> 'kind' = 'pool_top_up'
                           and body like 'The commissioner added 2 players to the pool.%'), 'tu1d the league hears about it');
  r := commish_top_up_pool(lid, '[{"slug":"tu-gamma","full":"Tu Gamma","pos":"TE","team":"NYJ"}]'::jsonb);
  perform tu_true((r ->> 'added')::int = 0 and (select count(*) from league_message where league_id = lid and txn ->> 'kind' = 'pool_top_up') = 1,
    'tu1e nothing new: nothing added, no chat line');

  -- ══ tu2. COLLEGE AND A GRADUATE ═══════════════════════════════════════════
  perform tu_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'tu2 COLLEGE on');
  insert into player_alias (old_slug, new_slug, espn_id) values ('c-95902', 'tu-delta', '95902') on conflict do nothing;
  r := commish_top_up_pool(lid, '[{"slug":"c-95901","full":"College Kid","pos":"WR"},{"slug":"c-95902","full":"Grad Kid","pos":"QB"}]'::jsonb);
  perform tu_true((r ->> 'added')::int = 1 and exists (select 1 from league_pool where league_id = lid and slug = 'c-95901' and espn_id = '95901'),
    'tu2a the college player lands; the graduate already in the pool as an NFL player does not: ' || r::text);

  -- ══ tu3. WHO MAY ══════════════════════════════════════════════════════════
  perform tu_as('02');
  perform tu_true(commish_top_up_pool(lid, '[{"slug":"tu-eps","full":"Tu Eps","pos":"K","team":"KC"}]'::jsonb) ->> 'error' = 'commissioner only', 'tu3 a member cannot');

  delete from player_alias where old_slug = 'c-95902';
  delete from league where id = lid;
  raise notice 'top-up probes done';
end $$;

select 'ALL TOP-UP PROBES PASSED' as result;
