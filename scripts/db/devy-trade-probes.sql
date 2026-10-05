-- 0397 probes: DEVY SHARES TRADE (and rounds 4–7 pay 2).
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function dt_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dt_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function dt_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function dt_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000055' || u, false); perform set_config('app.email', 'dt' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005501', 'dt01@test.dev'), ('00000000-0000-0000-0000-000000005502', 'dt02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005501', 'dt01@test.dev'), ('00000000-0000-0000-0000-000000005502', 'dt02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005501', '00000000-0000-0000-0000-000000005502');
insert into app_admin (email, note) values ('dt01@test.dev', 'devy trade probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text; lin text; tid uuid; ma timestamptz; yr text := extract(year from (now() at time zone 'America/New_York'))::int::text;
begin
  perform upsert_college_players((select jsonb_agg(jsonb_build_object('espn_id', (98000 + g)::text, 'full_name', 'Trade Kid ' || g,
      'pos', 'WR', 'school_id', '98999', 'school_abbr', 'DTU', 'class_year', 3)) from generate_series(1, 5) g));
  perform dt_true((_devy_share_rules() -> 'round_price' ->> '4')::int = 2 and (_devy_share_rules() -> 'round_price' ->> '7')::int = 2
              and (_devy_share_rules() -> 'round_price' ->> '3')::int = 5, 'dt0 THE TWEAK: rounds 4–7 pay 2, round 3 still 5');

  perform dt_as('01');
  r := create_native_league('Devy Trades', yr, 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic', 'keeper', 2);
  perform dt_ok(r, 'dt0a league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code'; lin := _lineage(lid);
  perform dt_as('02'); perform dt_ok(native_join(code, 'DT-2'), 'dt0b join'); perform dt_as('01');
  perform dt_ok(set_league_position_access(lid, '["COLLEGE"]'::jsonb), 'dt0c COLLEGE on');
  perform dt_ok(set_league_devy_mode(lid, 'shares'), 'dt0d shares on');
  update draft set status = 'complete', completed_at = now() where league_id = lid;

  -- team 1: 20 of Kid 1 (maxed, first in line), 10 of Kid 2. team 2: 20 of Kid 1 (second in line).
  perform dt_ok(allot_devy_shares(lid, 1, 'c-98001', 20), 'dt1 team 1 maxes Kid 1');
  perform dt_ok(allot_devy_shares(lid, 1, 'c-98002', 10), 'dt1a team 1 holds 10 of Kid 2');
  ma := (select maxed_at from devy_share where lineage = lin and roster_id = 1 and slug = 'c-98001');
  perform dt_as('02');
  perform dt_ok(allot_devy_shares(lid, 2, 'c-98001', 20), 'dt1b team 2 maxes Kid 1, second');
  perform dt_ok(allot_devy_shares(lid, 2, 'c-98003', 20), 'dt1c team 2 maxes Kid 3');
  perform dt_as('01');

  -- ══ dt2. PROPOSING ═════════════════════════════════════════════════════════
  perform dt_err(propose_multi_trade(lid, '[{"roster":1,"send":[]},{"roster":2,"send":[]}]'::jsonb), '3–8 teams', 'dt2 two teams with no shares is an ordinary offer');
  perform dt_err(propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98002","shares":11,"to":2}]},{"roster":2,"send_devy_cash":[{"amount":5,"to":1}]}]'::jsonb),
    'holds 10 shares', 'dt2a nobody sends shares they don''t hold');
  perform dt_err(propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98002","shares":5,"to":2}]},{"roster":2,"send_devy_cash":[{"amount":500,"to":1}]}]'::jsonb),
    'devy cash', 'dt2b nobody sends cash they don''t have');
  -- the deal: team 1 sends its whole Kid-2 stake (10) and 5 devy cash; team 2 sends 10 of Kid 3.
  r := propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98002","shares":10,"to":2}],"send_devy_cash":[{"amount":5,"to":2}]},
                                  {"roster":2,"send_shares":[{"slug":"c-98003","shares":10,"to":1}]}]'::jsonb, 'shares for shares');
  perform dt_ok(r, 'dt2c THE POINT: a two-team share trade files'); tid := (r ->> 'trade_id')::uuid;
  perform dt_true((select jsonb_array_length(send_shares) from trade_leg where trade_id = tid and roster_id = 1) = 1, 'dt2d the shares ride the leg');
  perform dt_true(_trade_summary(tid) like '%10 shares of Trade Kid 2%' and _trade_summary(tid) like '%5 devy cash%', 'dt2e the summary names them: ' || _trade_summary(tid));

  -- ══ dt3. ACCEPTING ═════════════════════════════════════════════════════════
  perform dt_as('02');
  r := respond_trade(tid, true);
  perform dt_true((select status from trade_proposal where id = tid) = 'executed', 'dt3 accepted and executed: ' || r::text);
  perform dt_true((select shares from devy_share where lineage = lin and roster_id = 2 and slug = 'c-98002') = 10
              and (select cost from devy_share where lineage = lin and roster_id = 2 and slug = 'c-98002') = 10
              and not exists (select 1 from devy_share where lineage = lin and roster_id = 1 and slug = 'c-98002'), 'dt3a the whole stake moved, cost and all');
  perform dt_true((select shares from devy_share where lineage = lin and roster_id = 1 and slug = 'c-98003') = 10
              and (select shares from devy_share where lineage = lin and roster_id = 2 and slug = 'c-98003') = 10, 'dt3b half of a maxed stake moved');
  perform dt_true((select maxed_at from devy_share where lineage = lin and roster_id = 2 and slug = 'c-98003') is null,
    'dt3c …and the seller dropped out of line');
  perform dt_true(_devy_cash(lin, 1) = 100 - 20 - 10 - 5 and _devy_cash(lin, 2) = 100 - 20 - 20 + 5, 'dt3d the cash moved');

  -- ══ dt4. A WHOLE MAXED STAKE KEEPS ITS PLACE ═══════════════════════════════
  -- team 1 is first in line on Kid 1; team 2 second. Team 1 sells its whole stake to a
  -- third party? Only two seats here — so team 1 sends the whole stake to team 2 and
  -- takes 20 cash back: team 2 can't hold 40, so that is refused at filing? It's
  -- refused at execution (a stake past 20).
  perform dt_as('01');
  r := propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98001","shares":20,"to":2}]},{"roster":2,"send_devy_cash":[{"amount":1,"to":1}]}]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform dt_as('02');
  r := respond_trade(tid, true);
  perform dt_true((select status from trade_proposal where id = tid) <> 'executed', 'dt4 no stake passes 20 shares: ' || r::text);
  -- team 2 sells its Kid-1 stake first; then team 1's whole stake arrives with its place
  perform dt_ok(allot_devy_shares(lid, 2, 'c-98001', 0), 'dt4a team 2 sells Kid 1');
  perform dt_as('01');
  r := propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98001","shares":20,"to":2}]},{"roster":2,"send_devy_cash":[{"amount":1,"to":1}]}]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform dt_as('02');
  perform respond_trade(tid, true);
  perform dt_true((select maxed_at from devy_share where lineage = lin and roster_id = 2 and slug = 'c-98001') = ma,
    'dt4b THE POINT: a whole maxed stake carries its place in line');
  perform dt_true((select roster_id from devy_share_rights(lin) where slug = 'c-98001') = 2, 'dt4c …and with it the right');

  -- ══ dt4x. A MIXED DEAL: a player, shares and devy cash in one trade (0398) ══
  perform dt_as('01');
  perform dt_ok(commish_top_up_pool(lid, '[{"slug":"dt-vet","full":"Nfl Vet","pos":"RB","team":"KC"}]'::jsonb), 'dt4w a vet in the pool');
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 2, 'dt-vet', 'commish');
  perform dt_as('01');
  r := propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98003","shares":4,"to":2}],"send_devy_cash":[{"amount":2.5,"to":2}]},
                                  {"roster":2,"send":[{"slug":"dt-vet","to":1}]}]'::jsonb, 'a vet for shares');
  perform dt_ok(r, 'dt4x THE POINT: a player for shares and cash files as one trade'); tid := (r ->> 'trade_id')::uuid;
  perform dt_as('02');
  perform respond_trade(tid, true);
  perform dt_true((select status from trade_proposal where id = tid) = 'executed'
              and exists (select 1 from native_roster where league_id = lid and roster_id = 1 and slug = 'dt-vet')
              and (select shares from devy_share where lineage = lin and roster_id = 2 and slug = 'c-98003') = 14,
    'dt4y the player crossed one way, the shares the other');
  perform dt_true(_trade_summary(tid) like '%Nfl Vet%' and _trade_summary(tid) like '%4 shares of Trade Kid 3%', 'dt4z one summary names both: ' || _trade_summary(tid));

  -- ══ dt5. WHEN SHARES DON'T TRADE ═══════════════════════════════════════════
  insert into player_alias (old_slug, new_slug, espn_id, draft_round) values ('c-98003', 'dt-g3', '98003', 4) on conflict (old_slug) do nothing;
  perform dt_as('01');
  perform dt_err(propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98003","shares":5,"to":2}]},{"roster":2,"send_devy_cash":[{"amount":1,"to":1}]}]'::jsonb),
    'turned pro', 'dt5 a graduate''s shares settle at the draft, not by trade');
  delete from player_alias where old_slug = 'c-98003';
  update draft set status = 'live' where league_id = lid;
  perform dt_err(propose_multi_trade(lid, '[{"roster":1,"send_shares":[{"slug":"c-98003","shares":5,"to":2}]},{"roster":2,"send_devy_cash":[{"amount":1,"to":1}]}]'::jsonb),
    'during the draft', 'dt5a not during a live draft');
  update draft set status = 'complete' where league_id = lid;
  perform dt_true(exists (select 1 from jsonb_array_elements(league_trades(lid)) t, jsonb_array_elements(t -> 'legs') l
                           where jsonb_array_length(l -> 'send_shares') > 0), 'dt5b the trade list shows shares on the legs');

  delete from devy_share where lineage = lin;
  delete from devy_cash where lineage = lin;
  delete from league where id = lid;
  delete from college_player where espn_id like '980%';
  raise notice 'devy trade probes done';
end $$;

select 'ALL DEVY-TRADE PROBES PASSED' as result;
