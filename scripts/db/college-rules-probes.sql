-- 0383 probes: CONFERENCE, TIER AND CLASS RULES.
--
--   • a spot can take college players from given conferences / tiers and
--     classes ("SEC flex", "SR+ spot"); bad values, an NFL-only level, or a
--     league without college players are refused;
--   • the league's pool filter carries the same rules;
--   • the directory hands out each player's conference and tier, and
--     college_meta_for the facts the worker's auto-slot checks;
--   • autodraft fills a rule spot only with a player who passes it.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function cr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cr_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cr_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function cr_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000052' || u, false); perform set_config('app.email', 'cr' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005201', 'cr01@test.dev'), ('00000000-0000-0000-0000-000000005202', 'cr02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005201', 'cr01@test.dev'), ('00000000-0000-0000-0000-000000005202', 'cr02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005201', '00000000-0000-0000-0000-000000005202');
insert into app_admin (email, note) values ('cr01@test.dev', 'college rules probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text;
begin
  -- Schools and players: an SEC senior, an SEC freshman, a MAC senior.
  perform upsert_college_schools('[{"school_id":"95001","school_abbr":"CRSEC","conference":"SEC","conf_id":8,"tier":"P4"},
                                   {"school_id":"95002","school_abbr":"CRMAC","conference":"MAC","conf_id":15,"tier":"G5"}]'::jsonb);
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '95101', 'full_name', 'Sec Senior', 'pos', 'WR', 'school_id', '95001', 'school_abbr', 'CRSEC', 'class_year', 4),
    jsonb_build_object('espn_id', '95102', 'full_name', 'Sec Frosh', 'pos', 'WR', 'school_id', '95001', 'school_abbr', 'CRSEC', 'class_year', 1),
    jsonb_build_object('espn_id', '95103', 'full_name', 'Mac Senior', 'pos', 'WR', 'school_id', '95002', 'school_abbr', 'CRMAC', 'class_year', 5)));

  perform cr_as('01');
  r := create_native_league('College Rules', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform cr_ok(r, 'cr0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform cr_as('02'); perform cr_ok(native_join(code, 'CR-2'), 'cr0 join'); perform cr_as('01');

  -- ══ cr1. A SPOT'S RULE ═════════════════════════════════════════════════════
  r := set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB","WR","TE"],"confs":["SEC"]}]'::jsonb);
  perform cr_true((r ->> 'ok')::boolean is false and r ->> 'error' like 'conference and class spots need college players%', 'cr1 no college players, no college rule');
  perform cr_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'cr1a COLLEGE on');
  r := set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB","WR","TE"],"confs":["SEC"],"label":"SEC FLEX"},{"pos":["RB","WR","TE"],"confs":["MAC"]},{"pos":["WR"],"classes":[4]}]'::jsonb);
  perform cr_ok(r, 'cr1b an SEC flex, a MAC flex and a SR+ receiver');
  perform cr_true(r -> 'slots' -> 1 -> 'confs' = '["SEC"]'::jsonb and r -> 'slots' -> 3 -> 'classes' = '[4]'::jsonb, 'cr1c stored as given: ' || (r -> 'slots')::text);
  perform cr_err(set_league_classic_slots(lid, '[{"pos":["WR"],"confs":["Ivy"]}]'::jsonb), 'unknown conference: Ivy', 'cr1d an unknown conference');
  perform cr_err(set_league_classic_slots(lid, '[{"pos":["WR"],"classes":[5]}]'::jsonb), 'a class is 1 (FR) to 4 (SR+)', 'cr1e a class past SR+');
  perform cr_ok(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB","WR","TE"],"confs":["SEC"],"label":"SEC FLEX"},{"pos":["RB","WR","TE"],"confs":["MAC"]},{"pos":["WR"],"classes":[4]}]'::jsonb), 'cr1f back');

  -- ══ cr2. WHO PASSES ════════════════════════════════════════════════════════
  perform cr_true(_college_rule_ok('{"confs":["SEC"]}', 'c-95101') and not _college_rule_ok('{"confs":["SEC"]}', 'c-95103'), 'cr2 SEC takes the SEC player, not the MAC one');
  perform cr_true(_college_rule_ok('{"confs":["P4"]}', 'c-95102') and _college_rule_ok('{"confs":["G5"]}', 'c-95103') and _college_rule_ok('{"confs":["FBS"]}', 'c-95103'), 'cr2a tiers, and FBS takes every FBS school');
  perform cr_true(_college_rule_ok('{"classes":[4]}', 'c-95103') and not _college_rule_ok('{"classes":[4]}', 'c-95102'), 'cr2b SR+: a fifth-year counts, a freshman does not');
  perform cr_true(not _college_rule_ok('{"confs":["SEC"]}', 'josh-allen') and _college_rule_ok('{}', 'josh-allen'), 'cr2c a rule spot is college-only; no rule, no bar');
  r := college_meta_for(array['c-95101', 'c-95103']);
  perform cr_true(r -> 'c-95101' ->> 'conf' = 'SEC' and (r -> 'c-95103' ->> 'cls')::int = 5, 'cr2d the worker gets the facts: ' || r::text);
  r := college_directory(array['WR'], 2000);
  perform cr_true((select e ->> 'conference' = 'MAC' and e ->> 'tier' = 'G5' from jsonb_array_elements(r) e where e ->> 'espn_id' = '95103'), 'cr2e the directory names the conference');

  -- ══ cr3. AUTODRAFT RESPECTS THE RULE ═══════════════════════════════════════
  perform cr_ok(set_league_classic_slots(lid, '[{"pos":["RB","WR","TE"],"confs":["SEC"]}]'::jsonb), 'cr3 one SEC flex');
  -- The MAC senior ranks first; the SEC senior second.
  perform seed_league_pool(lid, '[{"slug":"c-95103","full":"Mac Senior","pos":"WR"},{"slug":"c-95101","full":"Sec Senior","pos":"WR"},{"slug":"c-95102","full":"Sec Frosh","pos":"WR"}]'::jsonb);
  perform cr_true(native_autopick_slug(lid, 1, 3) = 'c-95101', 'cr3a THE POINT: the open SEC spot takes the best SEC player, not the better MAC one');

  -- ══ cr4. THE LEAGUE'S RULE ═════════════════════════════════════════════════
  perform cr_ok(set_league_pool_filter(lid, '{"confs":["MAC","SEC"],"classes":[3,4]}'::jsonb), 'cr4 MAC and SEC, juniors and up');
  perform cr_true((select settings_json -> 'pool_filter' from league where id = lid) = '{"confs": ["MAC", "SEC"], "classes": [3, 4]}'::jsonb, 'cr4a stored');
  perform cr_err(set_league_pool_filter(lid, '{"confs":["Big East"]}'::jsonb), 'unknown conference', 'cr4b an unknown conference');
  perform cr_ok(set_league_pool_filter(lid, '{"confs":["FBS"]}'::jsonb), 'cr4c Division I (FBS) only');
  perform cr_as('02');
  perform cr_err(set_league_pool_filter(lid, '{"confs":["SEC"]}'::jsonb), 'commissioner only', 'cr4d a member cannot');

  delete from league where id = lid;
  delete from college_player where espn_id like '951%';
  delete from college_school where school_id like '9500%';
  raise notice 'college rules probes done';
end $$;

select 'ALL COLLEGE-RULES PROBES PASSED' as result;
