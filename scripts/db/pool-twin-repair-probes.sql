-- 0264 pool-twin-repair probes: the retired name-twin ghost gets his body back.
--
-- What must hold:
--   • a clean-slug ghost (team 'FA') with an untouched `-<id>` twin takes the
--     twin's identity (name/pos/team/ids) and the twin row is deleted — while
--     the roster keeps referencing the clean slug it always held;
--   • still-scheduled weeks rematerialize, so the fixed pos/team reach the
--     weekly pool immediately;
--   • a twin that was itself rostered is NEVER touched (someone deliberately
--     drafted that row) — the pair is skipped whole;
--   • the repair is idempotent — a fixed pair no longer matches;
--   • a signed-in non-admin is refused.
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
  ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
  ('00000000-0000-0000-0000-000000000009', '9@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; snap jsonb;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
    ('00000000-0000-0000-0000-000000000009', '9@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-000000000007';
  perform probe_as('7');

  r := create_native_league('Twin Repair', '2024', 2, 8, 60);
  perform assert_ok(r, 'tw0 fixture league'); lid := (r ->> 'league_id')::uuid;

  -- The pool, seeded the broken way an old buildDraftPool did it:
  --   ghost-guy        — the ghost: clean slug, team FA, the retired twin's id
  --   ghost-guy-222    — the REAL player, disambiguated onto a suffixed slug
  --   loose-end        — a second ghost whose twin someone deliberately drafted
  insert into league_pool (league_id, slug, full_name, pos, team, rank, sleeper_id) values
    (lid, 'ghost-guy',      'Ghost Guy', 'WR', 'FA', 1, '111'),
    (lid, 'ghost-guy-222',  'Ghost Guy', 'RB', 'KC', 2, '222'),
    (lid, 'loose-end',      'Loose End', 'WR', 'FA', 3, '333'),
    (lid, 'loose-end-444',  'Loose End', 'RB', 'SF', 4, '444'),
    (lid, 'plain-fella',    'Plain Fella', 'QB', 'DAL', 5, '555');
  -- Seat 1 drafted the ghost (thinking he was the RB); seat 2 drafted the
  -- REAL loose-end twin on purpose.
  insert into native_roster (league_id, roster_id, slug) values
    (lid, 1, 'ghost-guy'),
    (lid, 2, 'loose-end-444'),
    (lid, 2, 'plain-fella');
  r := native_generate_schedule(lid, 2);
  perform assert_ok(r, 'tw0a schedule + first materialize');
  snap := (select starters_json from sleeper_lineup where league_id = lid and week = 1 and roster_id = 1);
  perform assert_true(snap @> '[{"slug": "ghost-guy", "pos": "WR", "team": "FA"}]',
    'tw0b the ghost pools as WR · FA before the repair');

  -- ══ A NON-ADMIN IS REFUSED ════════════════════════════════════════════════
  perform probe_as('9');
  r := repair_pool_fa_twins();
  perform assert_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'forbidden',
    'tw1 a signed-in non-admin cannot run the repair');

  -- ══ THE REPAIR ════════════════════════════════════════════════════════════
  perform set_config('app.uid', '', false);   -- the migration's maintenance path
  r := repair_pool_fa_twins();
  perform assert_ok(r, 'tw2 repair runs');
  perform assert_true((r ->> 'fixed')::int >= 1, 'tw2a at least our ghost pair fixed');
  perform assert_true((r ->> 'skipped')::int >= 1, 'tw2b …and the drafted twin pair skipped');

  perform assert_true((select pos from league_pool where league_id = lid and slug = 'ghost-guy') = 'RB'
      and (select team from league_pool where league_id = lid and slug = 'ghost-guy') = 'KC'
      and (select sleeper_id from league_pool where league_id = lid and slug = 'ghost-guy') = '222',
    'tw3 the clean slug now carries the real identity');
  perform assert_true(not exists (select 1 from league_pool where league_id = lid and slug = 'ghost-guy-222'),
    'tw3a …and the twin row is gone');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = 1 and slug = 'ghost-guy') = 1,
    'tw3b the roster still holds the slug it drafted');
  perform assert_true((select rank from league_pool where league_id = lid and slug = 'ghost-guy') = 1,
    'tw3c the board position the ADP priced stays');

  -- The deliberately-drafted twin: untouched, whole.
  perform assert_true((select team from league_pool where league_id = lid and slug = 'loose-end') = 'FA'
      and exists (select 1 from league_pool where league_id = lid and slug = 'loose-end-444'),
    'tw4 a rostered twin freezes its pair — nothing moved');

  -- Materialization carried the fix into the scheduled weeks.
  snap := (select starters_json from sleeper_lineup where league_id = lid and week = 1 and roster_id = 1);
  perform assert_true(snap @> '[{"slug": "ghost-guy", "pos": "RB", "team": "KC"}]',
    'tw5 the weekly pool shows RB · KC now');

  -- ══ IDEMPOTENT ════════════════════════════════════════════════════════════
  r := repair_pool_fa_twins();
  perform assert_ok(r, 'tw6 second run is fine');
  perform assert_true(not exists (
      select 1 from league_pool j join league_pool t
        on t.league_id = j.league_id and t.sleeper_id is not null
       and t.slug = j.slug || '-' || t.sleeper_id
      where j.league_id = lid and coalesce(j.team, '') in ('', 'FA')
        and coalesce(t.team, '') not in ('', 'FA')
        and not exists (select 1 from native_roster nr where nr.league_id = t.league_id and nr.slug = t.slug)),
    'tw6a …and no repairable pair remains in the fixture');

  raise notice 'pool-twin-repair probes done';
end $$;

select 'ALL POOL-TWIN-REPAIR PROBES PASSED' as status;
