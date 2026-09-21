-- 0294 probes: re-saving the Combo Drip you already fielded is not fielding
-- a second one.
--
-- Founder, over a board with one Combo Drip on it: "Still this error" —
-- "NOT SAVED — SUN 1PM · 1: Combo Drip is one per unlock — you own 1, buy
-- another to field more". The live boards autosave the whole lineup as one
-- upsert, and the BEFORE INSERT trigger fires on the proposed row before the
-- conflict is found, so the saved row at the same slot counted as a second.
--
-- What must hold, with ONE unlock bought:
--   • the same combodrip row, upserted again, is accepted (the autosave);
--   • a whole-lineup batch carrying it, with other rows around it, is accepted;
--   • MOVING it to another slot in one batch (slot order) is accepted;
--   • a second combodrip at another slot is still refused, with the 0062 words;
--   • turning an existing non-combo row INTO combodrip is still refused;
--   • with TWO bought, two are fielded and re-saved freely.
-- Runs as the manager (RLS + the window-lock trigger apply), in a week the
-- real calendar never covers (92), like the other suites' fixtures.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function cr_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function cr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cr_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
-- The autosave's write, exactly as liveApi sends it: an upsert on the slot key.
create or replace function cr_save(mid uuid, u uuid, rows jsonb) returns void language plpgsql as $$
begin
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id)
  select mid, u, r->>'win', r->>'slot', r->>'slug', r->>'metric' from jsonb_array_elements(rows) r
  on conflict (matchup_id, app_user_id, game_window, roster_slot)
    do update set player_slug = excluded.player_slug, metric_id = excluded.metric_id;
end $$;
-- A write that MUST be refused by the combo cap.
create or replace function cr_refused(mid uuid, u uuid, rows jsonb, msg text) returns void language plpgsql as $$
begin
  perform cr_save(mid, u, rows);
  raise exception 'PROBE FAIL % — accepted', msg;
exception when check_violation then
  if position('Combo Drip is one per unlock' in sqlerrm) = 0 then
    raise exception 'PROBE FAIL % — refused for another reason: %', msg, sqlerrm;
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test.dev')
on conflict (id) do nothing;

do $$
declare lid uuid; code text; mid uuid; d uuid := '00000000-0000-0000-0000-00000000000d';
        e uuid := '00000000-0000-0000-0000-00000000000e'; seat_d int; seat_e int; n int;
begin
  insert into app_user (id, email) values (d, 'd@test.dev'), (e, 'e@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in (d, e);
  perform cr_as('d');
  lid := (create_native_league('Combo Resave', '2026', 4, 7, 60, 'snake', 200, 15, 1,
                               null, null, null, 'drip') ->> 'league_id')::uuid;
  code := (select invite_code from league where id = lid);
  perform cr_as('e'); perform cr_ok(native_join(code, 'CR-E'), 'cr0 e joins');
  select sleeper_roster_id into seat_d from league_membership where league_id = lid and app_user_id = d;
  select sleeper_roster_id into seat_e from league_membership where league_id = lid and app_user_id = e;

  reset role;
  -- Every window is days away, so nothing here is locked.
  insert into nfl_slate (season, week, win, home, away, kickoff) values
    ('2026', 92, 'thu',       'NYJ', 'BUF', now() + interval '2 days'),
    ('2026', 92, 'sun_early', 'PHI', 'DAL', now() + interval '5 days'),
    ('2026', 92, 'sun_late',  'SF',  'LAR', now() + interval '5 days 3 hours')
  on conflict do nothing;
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'cr-thu', 'Thursday Man', 'RB', 'BUF', 1),
    (lid, 'cr-sun', 'Sunday Man',   'WR', 'PHI', 2),
    (lid, 'cr-sun2','Other Sunday', 'RB', 'DAL', 3),
    (lid, 'cr-late','Late Man',     'WR', 'SF',  4)
  on conflict do nothing;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, seat_d, 'cr-thu', 'draft'), (lid, seat_d, 'cr-sun', 'draft'),
    (lid, seat_d, 'cr-sun2', 'draft'), (lid, seat_d, 'cr-late', 'draft');
  update draft set status = 'complete' where league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 92, seat_d, seat_e, 'scheduled') returning id into mid;
  -- ONE Combo Drip bought, as arm_unlock records it.
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (mid, d, 92, '{"unlocks":["unlock-combo-drip"],"unlockQty":{"unlock-combo-drip":1}}');
  perform set_config('probe.cr_mid', mid::text, false);
  perform set_config('probe.cr_lid', lid::text, false);
end $$;

do $$
declare mid uuid := current_setting('probe.cr_mid')::uuid; d uuid := '00000000-0000-0000-0000-00000000000d'; n int;
begin
  set local role authenticated;
  perform cr_as('d');
  -- 1. the first save, then the SAME row again — the autosave's ordinary life.
  perform cr_save(mid, d, '[{"win":"early","slot":"1","slug":"cr-sun","metric":"combodrip"}]');
  perform cr_save(mid, d, '[{"win":"early","slot":"1","slug":"cr-sun","metric":"combodrip"}]');
  select count(*) into n from sealed_pick where matchup_id = mid and app_user_id = d and metric_id = 'combodrip';
  perform cr_true(n = 1, 'cr1 the one Combo Drip re-saved is still one row');
  -- 2. the whole lineup around it.
  perform cr_save(mid, d, '[{"win":"tnf","slot":"1","slug":"cr-thu","metric":"rush"},
                            {"win":"early","slot":"1","slug":"cr-sun","metric":"combodrip"},
                            {"win":"early","slot":"2","slug":"cr-sun2","metric":"rec"}]');
  perform cr_true((select count(*) from sealed_pick where matchup_id = mid and app_user_id = d) = 3, 'cr2 the whole-lineup batch landed');
  -- 3. a SECOND at another slot: refused, in the words the banner prints.
  perform cr_refused(mid, d, '[{"win":"late","slot":"1","slug":"cr-late","metric":"combodrip"}]', 'cr3 a second Combo Drip at another slot');
  -- 4. an UPDATE into a second: refused.
  perform cr_refused(mid, d, '[{"win":"early","slot":"2","slug":"cr-sun2","metric":"combodrip"}]', 'cr4 an existing row turned into a second Combo Drip');
  -- 5. moving it, slot 1 → rush and slot 2 → combodrip, in one batch.
  perform cr_save(mid, d, '[{"win":"early","slot":"1","slug":"cr-sun","metric":"rush"},
                            {"win":"early","slot":"2","slug":"cr-sun2","metric":"combodrip"}]');
  perform cr_true((select roster_slot from sealed_pick where matchup_id = mid and app_user_id = d and metric_id = 'combodrip') = '2',
    'cr5 the Combo Drip moved to slot 2 in one batch');
  reset role;
  -- 6. two bought: two fielded, and re-saved.
  update applied_state set payload_json = payload_json || '{"unlockQty":{"unlock-combo-drip":2}}' where matchup_id = mid and app_user_id = d;
  set local role authenticated;
  perform cr_as('d');
  perform cr_save(mid, d, '[{"win":"early","slot":"1","slug":"cr-sun","metric":"combodrip"},
                            {"win":"early","slot":"2","slug":"cr-sun2","metric":"combodrip"}]');
  perform cr_save(mid, d, '[{"win":"early","slot":"1","slug":"cr-sun","metric":"combodrip"},
                            {"win":"early","slot":"2","slug":"cr-sun2","metric":"combodrip"}]');
  select count(*) into n from sealed_pick where matchup_id = mid and app_user_id = d and metric_id = 'combodrip';
  perform cr_true(n = 2, 'cr6 two owned, two fielded, re-saved');
  -- and a third is still one too many.
  perform cr_refused(mid, d, '[{"win":"late","slot":"1","slug":"cr-late","metric":"combodrip"}]', 'cr7 a third with two owned');
  reset role;
end $$;

drop function if exists cr_ok(jsonb, text), cr_true(boolean, text), cr_as(text), cr_save(uuid, uuid, jsonb), cr_refused(uuid, uuid, jsonb, text);
select 'ALL COMBO-RESAVE PROBES PASSED' as status;
