-- 0500 probes: COPIES OF EVERY PLAYER.
--   • cp1 the setting: commissioner only, 1–4, before the draft; it locks when
--         the draft starts; the pool needs only to fill the draft N times over;
--   • cp2 the draft: two teams take the same player, a third can't (every copy
--         taken), and a team can't take him twice;
--   • cp3 free agency: a copy left is an add; one copy per team; the last copy gone;
--   • cp4 a trade can't hand a team a player it already holds;
--   • cp5 the commissioner's remove asks which team when two hold him;
--   • cp6 copies leave out what assumes one owner (contracts, shotgun wedding),
--         both ways round.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function cp_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cp_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cp_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function cp_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000077' || u, false); perform set_config('app.email', 'cpy' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000077' || g)::uuid, 'cpy' || g || '@test.dev' from unnest(array['01','02','03']) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-0000000077' || g)::uuid, 'cpy' || g || '@test.dev' from unnest(array['01','02','03']) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-0000000077%';

do $$
declare r jsonb; lid uuid; code text; d draft%rowtype; pool jsonb := '[]'::jsonb; i int; pick text; n int := 0; t1 text;
begin
  -- ══ cp1. the setting ══
  perform cp_as('01');
  r := create_native_league('Copies', '2026', 3, 5, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform cp_ok(r, 'cp1 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform cp_as('02'); perform cp_ok(native_join(code, 'CP-2'), 'cp1 B joins');
  perform cp_err(set_league_copies(lid, 2), 'commissioner', 'cp1a a manager cannot set copies');
  perform cp_as('03'); perform cp_ok(native_join(code, 'CP-3'), 'cp1 C joins');
  perform cp_as('01');
  for i in 1..8 loop
    pool := pool || jsonb_build_object('slug', 'cp-' || i, 'full', 'Copy ' || i, 'pos', (array['QB','RB','WR','TE','RB','WR','RB','WR'])[i], 'team', 'BUF');
  end loop;
  perform cp_ok(seed_league_pool(lid, pool), 'cp1 an eight-player pool');
  update league set settings_json = settings_json - 'roster_slots' where id = lid;
  perform cp_true(league_copies(lid) = 1, 'cp1b every league starts at one copy');
  perform cp_err(start_draft(lid, '[1,2,3]'::jsonb), 'pool smaller', 'cp1c eight players cannot fill fifteen picks with one copy');
  perform cp_err(set_league_copies(lid, 5), '1 to 4', 'cp1d no more than four');
  perform cp_ok(set_league_copies(lid, 2), 'cp1e two copies');
  perform cp_true(league_copies(lid) = 2, 'cp1f stored');
  perform cp_true((draft_state(lid) ->> 'copies')::int = 2 and (league_game_mode(lid) ->> 'copies')::int = 2,
    'cp1f2 (0501) the draft room and the league''s mode both say two copies');
  perform cp_ok(start_draft(lid, '[1,2,3]'::jsonb), 'cp1g …and the same pool fills the draft twice over');
  perform cp_err(set_league_copies(lid, 3), 'before the draft', 'cp1h copies lock when the draft starts');

  -- ══ cp2. the draft ══ (snake 1,2,3,3,2,1,…)
  perform cp_ok(native_exec_pick(lid, 'cp-1', false), 'cp2 team 1 takes Copy 1');
  perform cp_ok(native_exec_pick(lid, 'cp-1', false), 'cp2a team 2 takes the second copy');
  perform cp_err(native_exec_pick(lid, 'cp-1', false), 'every copy', 'cp2b team 3 cannot — every copy is taken');
  perform cp_ok(native_exec_pick(lid, 'cp-2', false), 'cp2c team 3 takes Copy 2');
  perform cp_err(native_exec_pick(lid, 'cp-2', false), 'already has', 'cp2d team 3 (on the turn) cannot take him twice');
  perform cp_true(native_autopick_slug(lid, 3, 5) is distinct from 'cp-2' and native_autopick_slug(lid, 3, 5) is distinct from 'cp-1',
    'cp2e autopick skips what the seat holds and what is gone');
  loop
    select * into d from draft where league_id = lid;
    exit when d.status <> 'live';
    pick := coalesce(native_queue_pick(lid, draft_on_clock(d)), native_autopick_slug(lid, draft_on_clock(d), d.rounds));
    if pick is null then raise exception 'PROBE FAIL cp2f autopick found nothing at pick %', d.current_overall; end if;
    perform cp_ok(native_exec_pick(lid, pick, true), 'cp2f autodraft pick ' || d.current_overall);
    n := n + 1; exit when n > 40;
  end loop;
  perform cp_true((select count(*) from native_roster where league_id = lid) = 15, 'cp2g fifteen picks made from eight players');
  perform cp_true(not exists (select 1 from native_roster where league_id = lid group by slug having count(*) > 2), 'cp2h no player past two copies');
  perform cp_true(not exists (select 1 from native_roster where league_id = lid group by roster_id, slug having count(*) > 1), 'cp2i no team holds a player twice');

  -- ══ cp3. free agency ══
  perform cp_ok(set_transaction_rules(lid, p_fa_mode => 'open',
    p_waiver_days => '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb, p_waiver_game_hold_dow => -1), 'cp3 free agency open');
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values (lid, 'cp-9', 'Copy 9', 'RB', 'BUF', 9);
  select slug into t1 from native_roster where league_id = lid and roster_id = 1 and slug <> 'cp-1' order by slug limit 1;
  perform cp_ok(add_free_agent(lid, 1, 'cp-9', t1), 'cp3a team 1 adds Copy 9');
  perform cp_err(add_free_agent(lid, 1, 'cp-9', null), 'already has', 'cp3b …and cannot add him again');
  select slug into t1 from native_roster where league_id = lid and roster_id = 2 and slug not in ('cp-1') order by slug limit 1;
  perform cp_ok(add_free_agent(lid, 2, 'cp-9', t1), 'cp3c team 2 adds the second copy');
  select slug into t1 from native_roster where league_id = lid and roster_id = 3 order by slug limit 1;
  perform cp_err(add_free_agent(lid, 3, 'cp-9', t1), 'every copy', 'cp3d team 3 finds every copy taken');
  perform cp_err(submit_waiver_claim(lid, 3, 'cp-9', t1, 0), 'every copy', 'cp3e …nor can claim him');

  -- ══ cp4. trades ══
  perform cp_as('01');
  perform cp_err(propose_trade(lid, 1, 2, '["cp-7"]'::jsonb, '[]'::jsonb, null, null, null), 'already has', 'cp4 cannot hand a team a player it holds');

  -- ══ cp5. the commissioner's remove ══
  perform cp_err(commish_remove_player(lid, 'cp-9'), 'say which team', 'cp5 two holders — which team?');
  perform cp_ok(commish_remove_player(lid, 'cp-9', false, 1), 'cp5a remove team 1''s copy');
  perform cp_true(not exists (select 1 from native_roster where league_id = lid and roster_id = 1 and slug = 'cp-9')
              and exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = 'cp-9'), 'cp5b only that copy goes');
  perform cp_ok(commish_remove_player(lid, 'cp-9', false), 'cp5c one holder left — no team needed');
end $$;

-- ══ cp6. what copies leave out ══
do $$
declare r jsonb; lid uuid; caught boolean := false;
begin
  perform cp_as('01');
  r := create_native_league('Copies Two', '2026', 2, 5, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;
  update league set settings_json = settings_json || '{"salary_cap": 200}'::jsonb where id = lid;
  perform cp_err(set_league_copies(lid, 2), 'contracts', 'cp6 contracts leave copies out');
  update league set settings_json = settings_json - 'salary_cap' where id = lid;
  perform cp_ok(set_league_copies(lid, 3), 'cp6a three copies');
  begin
    update league set settings_json = settings_json || '{"shotgun_wedding": true}'::jsonb where id = lid;
  exception when others then caught := sqlerrm like '%copies%';
  end;
  perform cp_true(caught, 'cp6b …and shotgun wedding cannot be switched on beside them');
  perform cp_ok(set_league_copies(lid, 1), 'cp6c back to one copy');
  update league set settings_json = settings_json || '{"shotgun_wedding": true}'::jsonb where id = lid;
  perform cp_true((select (settings_json ->> 'shotgun_wedding')::boolean from league where id = lid), 'cp6d one copy: shotgun wedding is fine');
end $$;

select 'ALL COPIES PROBES PASSED' as result;
drop function if exists cp_true(boolean, text);
drop function if exists cp_ok(jsonb, text);
drop function if exists cp_err(jsonb, text, text);
drop function if exists cp_as(text);
