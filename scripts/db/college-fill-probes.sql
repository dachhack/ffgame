-- 0438 probes: COLLEGE ON FILLS THE POOL.
--
--   • switching COLLEGE on puts the directory's college players in the pool,
--     after the draft too, ranked after everyone, as free agents, and the
--     league hears it;
--   • nothing doubles on a second switch; the devy market gets none;
--   • switching COLLEGE off drops the college players nobody holds and keeps
--     the one a roster does.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function cf_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cf_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cf_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000054' || u, false); perform set_config('app.email', 'cf' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005401', 'cf01@test.dev'), ('00000000-0000-0000-0000-000000005402', 'cf02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005401', 'cf01@test.dev'), ('00000000-0000-0000-0000-000000005402', 'cf02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005401', '00000000-0000-0000-0000-000000005402');
insert into app_admin (email, note) values ('cf01@test.dev', 'college-fill probe admin') on conflict (email) do nothing;

-- Two college players the directory will list, and one it will not (inactive).
insert into college_player (espn_id, full_name, pos, school_abbr, class_year, active, division) values
  ('98801', 'Fill Quarterback', 'QB', 'CFU', 3, true, 'FBS'),
  ('98802', 'Fill Receiver', 'WR', 'CFU', 2, true, 'FBS'),
  ('98803', 'Fill Gone', 'RB', 'CFU', 4, false, 'FBS')
  on conflict (espn_id) do update set full_name = excluded.full_name, pos = excluded.pos, class_year = excluded.class_year,
    active = excluded.active, division = excluded.division;

do $$
declare r jsonb; lid uuid; lid2 uuid; code text; top int;
begin
  perform cf_as('01');
  r := create_native_league('College Fill', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform cf_ok(r, 'cf0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform cf_as('02'); perform cf_ok(native_join(code, 'CF-2'), 'cf0 join'); perform cf_as('01');
  perform cf_ok(seed_league_pool(lid, '[{"slug":"cf-alpha","full":"Cf Alpha","pos":"RB","team":"KC"},
                                        {"slug":"cf-beta","full":"Cf Beta","pos":"WR","team":"BUF"}]'::jsonb), 'cf0 seed');
  update draft set status = 'complete' where league_id = lid;
  select max(rank) into top from league_pool where league_id = lid;

  -- ══ cf1. COLLEGE ON, AFTER THE DRAFT: THE POOL FILLS ═══════════════════════
  r := set_league_position_access(lid, '["COLLEGE"]'::jsonb);
  perform cf_ok(r, 'cf1 COLLEGE on');
  perform cf_true((r ->> 'college_added')::int >= 2, 'cf1a the reply counts the college players added: ' || r::text);
  perform cf_true(exists (select 1 from league_pool where league_id = lid and slug = 'c-98801' and espn_id = '98801' and pos = 'QB' and level = 'college')
              and exists (select 1 from league_pool where league_id = lid and slug = 'c-98802'),
    'cf1b the active college players are in the pool under their c- slugs');
  perform cf_true(not exists (select 1 from league_pool where league_id = lid and slug = 'c-98803'), 'cf1c an inactive one is not');
  perform cf_true((select min(rank) from league_pool where league_id = lid and level = 'college') > top
              and (select max(rank) from league_pool where league_id = lid and slug in ('cf-alpha', 'cf-beta')) = top,
    'cf1d college players rank after everyone; the NFL ranks stand');
  perform cf_true((select waived_until from league_pool where league_id = lid and slug = 'c-98801') is null, 'cf1e a college player lands as a free agent');
  perform cf_true(exists (select 1 from league_message where league_id = lid and kind = 'txn' and txn ->> 'kind' = 'pool_top_up'
                           and (txn ->> 'college')::boolean and body like '%college players are in the player pool now%'),
    'cf1f the league hears about it');

  -- ══ cf2. AGAIN: NOTHING DOUBLES ═══════════════════════════════════════════
  r := set_league_position_access(lid, '["COLLEGE", "FB"]'::jsonb);
  perform cf_ok(r, 'cf2 another flip with COLLEGE still on');
  perform cf_true((r ->> 'college_added')::int = 0
              and (select count(*) from league_pool where league_id = lid and slug = 'c-98801') = 1,
    'cf2a COLLEGE already on adds nothing: ' || r::text);
  perform cf_true((commish_top_up_pool(lid, '[{"slug":"c-98801","full":"Fill Quarterback","pos":"QB"}]'::jsonb) ->> 'added')::int = 0,
    'cf2b a top-up offering him again adds nothing');

  -- ══ cf3. THE DEVY MARKET GETS NONE ════════════════════════════════════════
  r := create_native_league('College Market', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic', 'keeper', 2);   -- 0442: the market needs seasons
  perform cf_ok(r, 'cf3 league'); lid2 := (r ->> 'league_id')::uuid;
  perform cf_ok(seed_league_pool(lid2, '[{"slug":"cf-gamma","full":"Cf Gamma","pos":"TE","team":"NYJ"}]'::jsonb), 'cf3 seed');
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"devy_mode": "shares"}'::jsonb where id = lid2;
  r := set_league_position_access(lid2, '["COLLEGE"]'::jsonb);
  perform cf_ok(r, 'cf3 COLLEGE on in a shares league');
  perform cf_true((r ->> 'college_added')::int = 0 and not exists (select 1 from league_pool where league_id = lid2 and level = 'college'),
    'cf3a the market keeps college players out of the pool: ' || r::text);

  -- ══ cf4. COLLEGE OFF: THE UNHELD LEAVE, THE HELD STAYS ════════════════════
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 1, 'c-98801', 'fa');
  r := set_league_position_access(lid, '["FB"]'::jsonb);
  perform cf_ok(r, 'cf4 COLLEGE off');
  perform cf_true((r ->> 'college_removed')::int >= 1
              and exists (select 1 from league_pool where league_id = lid and slug = 'c-98801')
              and not exists (select 1 from league_pool where league_id = lid and slug = 'c-98802'),
    'cf4a the rostered college player stays in the pool; the free one leaves: ' || r::text);

  -- ══ cf5. WHO MAY ══════════════════════════════════════════════════════════
  perform cf_as('02');
  perform cf_true(set_league_position_access(lid, '["COLLEGE"]'::jsonb) ->> 'error' = 'admin only', 'cf5 a member cannot');

  delete from league where id in (lid, lid2);
  raise notice 'college-fill probes done';
end $$;

delete from college_player where espn_id in ('98801', '98802', '98803');

select 'ALL COLLEGE-FILL PROBES PASSED' as result;
