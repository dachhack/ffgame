-- 0387 probes: DEVY SHARES.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function ds_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ds_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function ds_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function ds_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000054' || u, false); perform set_config('app.email', 'ds' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005401', 'ds01@test.dev'), ('00000000-0000-0000-0000-000000005402', 'ds02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005401', 'ds01@test.dev'), ('00000000-0000-0000-0000-000000005402', 'ds02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005401', '00000000-0000-0000-0000-000000005402');
insert into app_admin (email, note) values ('ds01@test.dev', 'devy shares probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text; yr text := extract(year from (now() at time zone 'America/New_York'))::int::text;
        i int; s text;
begin
  perform upsert_college_players((select jsonb_agg(jsonb_build_object('espn_id', (97000 + g)::text, 'full_name', 'Share Kid ' || g,
      'pos', 'WR', 'school_id', '97999', 'school_abbr', 'DSU', 'class_year', 3)) from generate_series(1, 9) g));

  perform ds_as('01');
  r := create_native_league('Devy Shares', yr, 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform ds_ok(r, 'ds0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform ds_as('02'); perform ds_ok(native_join(code, 'DS-2'), 'ds0 join'); perform ds_as('01');

  -- ══ ds1. THE SETTING ══════════════════════════════════════════════════════
  perform ds_err(set_league_devy_mode(lid, 'shares'), 'need college players', 'ds1 shares need COLLEGE');
  perform ds_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'ds1a COLLEGE on');
  perform ds_ok(set_league_devy_mode(lid, 'shares'), 'ds1b shares on');
  perform ds_true(_devy_shares_on(lid) and exists (select 1 from league_message where league_id = lid and txn ->> 'kind' = 'devy_mode'), 'ds1c on, and chat says so');
  perform seed_league_pool(lid, '[{"slug":"ds-n1","full":"Nfl One","pos":"WR","team":"KC"},{"slug":"ds-n2","full":"Nfl Two","pos":"WR","team":"KC"},
                                  {"slug":"ds-n3","full":"Nfl Three","pos":"WR","team":"KC"},{"slug":"ds-g1","full":"Grad One","pos":"WR","team":"BUF"},
                                  {"slug":"ds-g2","full":"Grad Two","pos":"WR","team":"BUF"},{"slug":"c-97009","full":"Share Kid 9","pos":"WR"}]'::jsonb);
  perform ds_true(not exists (select 1 from league_pool where league_id = lid and slug ~ '^c-'), 'ds1d a shares pool takes no college player');

  -- ══ ds2. ALLOTTING ════════════════════════════════════════════════════════
  perform ds_err(allot_devy_shares(lid, 1, 'c-97001', 20), 'locked', 'ds2 before the draft is done, January''s lock still holds');
  update draft set status = 'complete' where league_id = lid;
  perform ds_true(not _devy_shares_locked(lid), 'ds2a this year''s draft done: unlocked');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97001', 20), 'ds2b team 1 maxes Kid 1 first');
  perform ds_err(allot_devy_shares(lid, 1, 'c-97002', 21), '0 to 20', 'ds2c 20 is the most');
  perform ds_as('02');
  perform ds_err(allot_devy_shares(lid, 1, 'c-97002', 5), 'not your team', 'ds2d nobody allots for another team');
  perform ds_ok(allot_devy_shares(lid, 2, 'c-97001', 20), 'ds2e team 2 maxes Kid 1 second');
  perform ds_ok(allot_devy_shares(lid, 2, 'c-97002', 5), 'ds2f team 2 alone on Kid 2 with 5');
  perform ds_as('01');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97003', 4), 'ds2g team 1 alone on Kid 3 with 4');
  for i in 4..7 loop perform ds_ok(allot_devy_shares(lid, 1, 'c-9700' || i, 19), 'ds2h fill'); end loop;
  perform ds_err(allot_devy_shares(lid, 1, 'c-97008', 5), 'a team has 100', 'ds2i 100 is the budget (20+4+76 used)');
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97001') = 1, 'ds2j THE POINT: first to 20 holds the right');
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97002') = 2, 'ds2k the only holder with 5+ holds it');
  perform ds_true(not exists (select 1 from devy_share_rights(_lineage(lid)) where slug = 'c-97003'), 'ds2l a sole holder under 5 holds nothing');
  -- dropping below 20 gives up the place in line
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97001', 19), 'ds2m team 1 drops to 19');
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97001') = 2, 'ds2n the next at 20 inherits');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97001', 20), 'ds2o back to 20…');
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97001') = 2, 'ds2p …but now behind team 2');
  r := devy_shares_state(lid);
  perform ds_true((r ->> 'on')::boolean and (r -> 'used' ->> '1')::int = 100 and jsonb_array_length(r -> 'players') = 7, 'ds2q the league''s view: ' || (r -> 'used')::text);

  -- ══ ds3. THE ROOKIE DRAFT ═════════════════════════════════════════════════
  -- Kid 1 → Grad One (right: team 2), Kid 2 → Grad Two (right: team 2).
  insert into player_alias (old_slug, new_slug, espn_id) values ('c-97001', 'ds-g1', '97001'), ('c-97002', 'ds-g2', '97002')
    on conflict (old_slug) do update set new_slug = excluded.new_slug;
  perform ds_err(allot_devy_shares(lid, 1, 'c-97002', 5), 'turned pro', 'ds3 no new stake on a graduate');
  perform ds_true((select count(*) from devy_reserved(lid) where roster_id = 2) = 2, 'ds3a both graduates reserved for team 2');
  update draft set status = 'pending', current_overall = 1, rounds = 8, keeper_slots = 6, stash_slots = 0, pick_owners = null where league_id = lid;
  perform ds_ok(start_draft(lid, '[1, 2]'::jsonb), 'ds3b the rookie draft opens');
  -- overall 1: team 1
  perform ds_err(native_exec_pick(lid, 'ds-g1', false), 'holds his devy rights', 'ds3c THE POINT: team 1 cannot take team 2''s reservation');
  perform ds_true(native_autopick_slug(lid, 1, 8) not in ('ds-g1', 'ds-g2'), 'ds3d nor will its autopick');
  perform ds_ok(native_exec_pick(lid, 'ds-n1', false), 'ds3e team 1 takes an open player');
  -- overall 2: team 2, two picks left, two reservations → forced
  perform ds_true(_devy_pick_forced(lid, 2), 'ds3f two picks, two reservations: forced');
  perform ds_err(native_exec_pick(lid, 'ds-n2', false), 'reserved players', 'ds3g a forced seat can''t take an open player');
  perform ds_true(native_autopick_slug(lid, 2, 8) in ('ds-g1', 'ds-g2'), 'ds3h autopick takes a reservation');
  perform ds_ok(native_exec_pick(lid, 'ds-g2', false), 'ds3i team 2 takes Grad Two with its first pick');
  -- overall 3: team 2 again (snake)
  perform ds_ok(native_exec_pick(lid, native_autopick_slug(lid, 2, 8), true), 'ds3j …and Grad One with its last');
  perform ds_true(exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = 'ds-g1'), 'ds3k both rights used');
  perform ds_ok(native_exec_pick(lid, 'ds-n2', false), 'ds3l the draft ends');

  -- ══ ds4. CLEARING ═════════════════════════════════════════════════════════
  perform ds_true((select status from draft where league_id = lid) = 'complete', 'ds4 complete');
  perform ds_true(not exists (select 1 from devy_share where lineage = _lineage(lid) and slug in ('c-97001', 'c-97002')),
    'ds4a THE POINT: the graduates'' shares went home');
  perform ds_true((select sum(shares) from devy_share where lineage = _lineage(lid) and roster_id = 1) = 80, 'ds4b team 1 keeps its other stakes (80), 20 back');
  perform ds_true(exists (select 1 from league_message where league_id = lid and txn ->> 'kind' = 'devy_shares_cleared'), 'ds4c chat says so');

  -- ══ ds5. BACK TO SPOTS ════════════════════════════════════════════════════
  perform ds_ok(set_league_devy_mode(lid, 'spots'), 'ds5 spots again');
  perform ds_true(not exists (select 1 from devy_reserved(lid)), 'ds5a shares reserve nobody in a spots league');

  delete from player_alias where old_slug in ('c-97001', 'c-97002');
  delete from devy_share where lineage = _lineage(lid);
  delete from league where id = lid;
  delete from college_player where espn_id like '970%';
  raise notice 'devy shares probes done';
end $$;

select 'ALL DEVY-SHARES PROBES PASSED' as result;
