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
declare r jsonb; lid uuid; nxt uuid; code text; yr text := extract(year from (now() at time zone 'America/New_York'))::int::text;
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

  -- ══ ds2. PRICES (0396: a smooth curve, no demand) ═════════════════════════
  perform ds_true(_college_curve(10) = 10 and _college_curve(20) = 8 and _college_curve(40) = 6 and _college_curve(80) = 4
              and _college_curve(160) = 2 and _college_curve(320) = 1 and _college_curve(null) = 1, 'ds2 the curve: 10 at #10, −2 each doubling, floor 1');
  insert into college_price (espn_id, rank, base, youth) values ('97002', 10, 10, 0), ('97006', 10, 10, 0), ('97007', 150, 2.17, 1)
    on conflict (espn_id) do update set rank = excluded.rank, base = excluded.base, youth = excluded.youth;
  perform ds_true(_devy_price(null, 'c-97007') = 2.50 and _devy_price(null, 'c-97001') = 1, 'ds2a a young riser ×1.15; unranked 1');

  -- ══ ds3. BUYING, THE CAP, THE LOCK ════════════════════════════════════════
  perform ds_err(allot_devy_shares(lid, 1, 'c-97001', 20), 'locked', 'ds3 before the league''s first draft is done, the lock holds');
  update draft set status = 'complete', completed_at = now() where league_id = lid;
  perform ds_true(not _devy_shares_locked(lid), 'ds3a a draft completed after Jan 15: unlocked');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97001', 20), 'ds3b team 1 maxes Kid 1 first (20 × 1)');
  perform ds_err(allot_devy_shares(lid, 1, 'c-97006', 7), '6 more share', 'ds3c THE CAP: 7 shares at 10 passes 60 — 6 maxes him');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97006', 6), 'ds3d 6 at 10 = 60: maxed by spend');
  perform ds_true((select maxed_at is not null from devy_share where lineage = _lineage(lid) and roster_id = 1 and slug = 'c-97006'), 'ds3e maxed at 6 shares');
  perform ds_err(allot_devy_shares(lid, 1, 'c-97006', 7), 'maxed', 'ds3f a maxed stake takes no more');
  perform ds_true(_devy_cash(_lineage(lid), 1) = 20, 'ds3g team 1: 100 − 20 − 60 = 20');
  perform ds_as('02');
  perform ds_err(allot_devy_shares(lid, 1, 'c-97002', 5), 'not your team', 'ds3h nobody allots for another team');
  perform ds_ok(allot_devy_shares(lid, 2, 'c-97001', 20), 'ds3i team 2 maxes Kid 1 second');
  perform ds_ok(allot_devy_shares(lid, 2, 'c-97002', 5), 'ds3j team 2 alone on Kid 2: 5 × 10 = 50');
  perform ds_ok(allot_devy_shares(lid, 2, 'c-97005', 5), 'ds3k …and 5 on Kid 5 at 1');
  perform ds_as('01');

  -- ══ ds4. RIGHTS ════════════════════════════════════════════════════════════
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97001') = 1, 'ds4 first to max holds it');
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97002') = 2, 'ds4a the only QUALIFIED team (5+, 15+ spent) holds it');
  perform ds_true(not exists (select 1 from devy_share_rights(_lineage(lid)) where slug = 'c-97005'), 'ds4b 5 shares for 5 points isn''t qualified: no right');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97002', 1), 'ds4c THE SPOILER: team 1 buys 1 share of Kid 2');
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97002') = 2, 'ds4d THE POINT: an unqualified stake no longer erases a sole right');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97002', 0), 'ds4e sold back');
  -- a qualified rival breaks it — unless it qualified in the week before a lock
  insert into devy_share (lineage, roster_id, slug, shares, cost, qual_at) values (_lineage(lid), 1, 'c-97002', 5, 50, now() - interval '30 days');
  perform ds_true(not exists (select 1 from devy_share_rights(_lineage(lid)) where slug = 'c-97002'), 'ds4f two qualified teams: no sole right');
  update devy_share set qual_at = _devy_lock_after(now()) - interval '2 days' where lineage = _lineage(lid) and roster_id = 1 and slug = 'c-97002';
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97002') = 2, 'ds4g a rival who qualified in the quiet week doesn''t break it');
  delete from devy_share where lineage = _lineage(lid) and roster_id = 1 and slug = 'c-97002';
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97001', 19), 'ds4h team 1 drops to 19');
  perform ds_true((select roster_id from devy_share_rights(_lineage(lid)) where slug = 'c-97001') = 2, 'ds4i the next to max inherits');
  perform ds_ok(allot_devy_shares(lid, 1, 'c-97001', 20), 'ds4j back to 20, now behind');

  -- ══ ds5. GUARDS ════════════════════════════════════════════════════════════
  update devy_cash set cash = 195 where lineage = _lineage(lid) and roster_id = 1;
  perform ds_err(allot_devy_shares(lid, 1, 'c-97006', 0), 'tops out', 'ds5 a sale past 200 is refused, not shaved');
  update devy_cash set cash = 20 where lineage = _lineage(lid) and roster_id = 1;
  insert into league (sleeper_league_id, season, name, provider, settings_json)
    select sleeper_league_id, (season::int + 1)::text, name, provider, settings_json from league where id = lid returning id into nxt;
  perform ds_err(allot_devy_shares(lid, 1, 'c-97006', 0), 'last season', 'ds5a THE POINT: last season''s league row moves no shares');
  perform ds_err(set_league_devy_mode(lid, 'spots'), 'last season', 'ds5b …nor flips the mode');
  delete from league where id = nxt;
  perform ds_ok(set_league_devy_start_cash(lid, 150), 'ds5c the commissioner sets a new team''s cash');
  perform ds_true(_devy_cash(_lineage(lid), 9) = 150 and _devy_cash(_lineage(lid), 1) = 20, 'ds5d a new seat starts at 150; a seat with a book keeps it');
  r := create_native_league('Devy Auction', yr, 2, 8, 60, 'auction', 200, 15, 1, null, null, null, 'classic');
  perform ds_ok(set_league_position_access((r ->> 'league_id')::uuid, '["COLLEGE"]'::jsonb), 'ds5e auction COLLEGE on');
  perform ds_err(set_league_devy_mode((r ->> 'league_id')::uuid, 'shares'), 'auction', 'ds5f no shares in an auction league');
  delete from league where id = (r ->> 'league_id')::uuid;
  -- Kid 5 leaves college: sellable at his last price, refunded half at the draft
  update college_player set active = false where espn_id = '97005';
  perform ds_as('02');
  perform ds_ok(allot_devy_shares(lid, 2, 'c-97005', 4), 'ds5g a player who left can still be sold');
  perform ds_err(allot_devy_shares(lid, 2, 'c-97005', 5), 'left college', 'ds5h …not bought');
  perform ds_as('01');

  -- ══ ds6. GRADUATION REACHES A SHARES LEAGUE ═══════════════════════════════
  perform ds_true(exists (select 1 from graduation_candidates() where espn_id = '97006'), 'ds6 THE POINT: a player held only in shares is a graduation candidate');
  r := graduate_college_player('97006', 'ds-g6', 'Grad Six', 'WR', 'KC', null, 2);
  perform ds_true((select draft_round from player_alias where old_slug = 'c-97006') = 2, 'ds6a …and graduates with his round, with no pool holding him: ' || r::text);
  delete from player_alias where old_slug = 'c-97006';
  -- Kid 1 → Grad One (R1), Kid 2 → Grad Two (R3)
  insert into player_alias (old_slug, new_slug, espn_id, draft_round) values ('c-97001', 'ds-g1', '97001', 1), ('c-97002', 'ds-g2', '97002', 3)
    on conflict (old_slug) do update set new_slug = excluded.new_slug, draft_round = excluded.draft_round;
  perform ds_err(allot_devy_shares(lid, 1, 'c-97002', 5), 'turned pro', 'ds6b no new stake on a graduate');
  perform ds_true((select roster_id from devy_reserved(lid) where slug = 'ds-g1') = 2 and (select roster_id from devy_reserved(lid) where slug = 'ds-g2') = 2,
    'ds6c both graduates reserved for team 2');
  begin
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 1, 'ds-g2', 'fa');
    raise exception 'PROBE FAIL ds6d a reserved graduate was picked up off the wire';
  exception when others then
    if sqlerrm like 'PROBE FAIL%' then raise; end if;
  end;

  -- ══ ds7. THE ROOKIE DRAFT ══════════════════════════════════════════════════
  update devy_cash set cash = 190 where lineage = _lineage(lid) and roster_id = 1;
  update draft set status = 'pending', current_overall = 1, rounds = 8, keeper_slots = 6, stash_slots = 0, pick_owners = null, completed_at = null where league_id = lid;
  perform ds_ok(start_draft(lid, '[1, 2]'::jsonb), 'ds7 the rookie draft opens');
  perform ds_err(set_league_devy_mode(lid, 'spots'), 'during the draft', 'ds7a no mode change mid-draft');
  perform ds_err(native_exec_pick(lid, 'ds-g1', false), 'holds his devy rights', 'ds7b team 1 cannot take team 2''s reservation');
  perform ds_ok(native_exec_pick(lid, 'ds-n1', false), 'ds7c team 1 takes an open player');
  perform ds_true(_devy_pick_forced(lid, 2), 'ds7d two picks, two reservations: forced');
  perform ds_err(native_exec_pick(lid, 'ds-n2', false), 'reserved players', 'ds7e a forced seat can''t take an open player');
  perform ds_ok(native_exec_pick(lid, 'ds-g2', false), 'ds7f team 2 takes Grad Two');
  perform ds_ok(native_exec_pick(lid, native_autopick_slug(lid, 2, 8), true), 'ds7g …and Grad One by autopick');
  perform ds_true(exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = 'ds-g1'), 'ds7h both rights used');
  perform ds_ok(native_exec_pick(lid, 'ds-n2', false), 'ds7i the draft ends');

  -- ══ ds8. PAYOUT AND REFUND ═════════════════════════════════════════════════
  perform ds_true(not exists (select 1 from devy_share where lineage = _lineage(lid) and slug in ('c-97001', 'c-97002', 'c-97005')),
    'ds8 graduates and the departed are settled');
  -- team 1: 20 Kid-1 shares cost 20 → R1 8 × 20 = 160, capped at 3 × 20 = 60, NOT capped at 200: 190 + 60
  perform ds_true(_devy_cash(_lineage(lid), 1) = 250, 'ds8a THE POINT: R1 pays 8 a share (3× cap), past the 200 cash cap: ' || _devy_cash(_lineage(lid), 1));
  -- team 2: 100 − 20 − 50 − 5 + 1 (sold 1 Kid-5) = 26; + 60 (Kid 1) + 50 (Kid 2: max(10, R3 5) × 5) + 2 (half of Kid 5's 4)
  perform ds_true(_devy_cash(_lineage(lid), 2) = 138, 'ds8b college price beats R3; half back on the departed: ' || _devy_cash(_lineage(lid), 2));
  perform ds_true(exists (select 1 from league_message where league_id = lid and txn ->> 'kind' = 'devy_shares_cleared'), 'ds8c chat says so');

  -- ══ ds9. LEAVING SHARES CASHES OUT ═════════════════════════════════════════
  perform ds_ok(set_league_devy_mode(lid, 'spots'), 'ds9 spots again');
  perform ds_true(not exists (select 1 from devy_share where lineage = _lineage(lid)) and _devy_cash(_lineage(lid), 1) = 310,
    'ds9a Kid 6 (6 shares at 10, cost 60) cashed out at 60: ' || _devy_cash(_lineage(lid), 1));

  delete from player_alias where old_slug in ('c-97001', 'c-97002', 'c-97006');
  delete from devy_share where lineage = _lineage(lid);
  delete from devy_cash where lineage = _lineage(lid);
  delete from college_price where espn_id like '970%';
  delete from league where id = lid;
  delete from college_player where espn_id like '970%';
  raise notice 'devy shares probes done';
end $$;

select 'ALL DEVY-SHARES PROBES PASSED' as result;
