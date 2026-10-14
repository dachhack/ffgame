-- 0502 probes: RELEGATION — tiers of linked leagues.
--   • rl1 building a ladder: commissioner of every tier, same season, no league twice
--   • rl2 the order each method reads (standings, points, playoffs, promotion playoff)
--   • rl3 a member of any tier sees the whole ladder and who would move
--   • rl4 the rollover, 'roster' mode: every tier rolls, the worst goes down,
--         the best comes up, and their kept players travel (or stay behind)
--   • rl5 all or nothing: a tier that can't roll stops the whole ladder
--   • rl6 'redraft' mode: a mover's new seat starts empty; everyone else keeps
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function rl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function rl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function rl_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function rl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000079' || u, false); perform set_config('app.email', 'rl' || u || '@test.dev', false); end $$;
create or replace function rl_autodraft(p_lid uuid) returns void language plpgsql as $$
declare d draft%rowtype; pick text; r jsonb; n int := 0;
begin
  loop
    select * into d from draft where league_id = p_lid;
    exit when d.status <> 'live';
    pick := coalesce(native_queue_pick(p_lid, draft_on_clock(d)), native_autopick_slug(p_lid, draft_on_clock(d), d.rounds));
    r := native_exec_pick(p_lid, pick, true);
    if not coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL autopick % refused: %', pick, r; end if;
    n := n + 1; exit when n > 500;
  end loop;
end $$;
-- a 3-week season with a known table: records 1 > 2 > 3 > 4; points 1 > 2 > 4 > 3
create or replace function rl_season(p_lid uuid) returns void language plpgsql as $$
begin
  delete from matchup where league_id = p_lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (p_lid, 1, 1, 2, 'final', 100, 90), (p_lid, 1, 3, 4, 'final', 80, 75),
    (p_lid, 2, 1, 3, 'final', 100, 95), (p_lid, 2, 2, 4, 'final', 90, 85),
    (p_lid, 3, 1, 4, 'final', 100, 99), (p_lid, 3, 2, 3, 'final', 90, 60);
end $$;
create or replace function rl_league(p_name text, p_season text, p_a text, p_b text, p_c text) returns uuid language plpgsql as $$
declare r jsonb; lid uuid; code text; pool jsonb := '[]'::jsonb; i int;
begin
  perform rl_as('01');
  r := create_native_league(p_name, p_season, 4, 5, 60);
  perform rl_ok(r, 'fixture ' || p_name); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform rl_as(p_a); perform rl_ok(native_join(code, p_name || '-' || p_a), 'join ' || p_a);
  perform rl_as(p_b); perform rl_ok(native_join(code, p_name || '-' || p_b), 'join ' || p_b);
  perform rl_as(p_c); perform rl_ok(native_join(code, p_name || '-' || p_c), 'join ' || p_c);
  perform rl_as('01');
  for i in 1..40 loop
    pool := pool || jsonb_build_object('slug', 'rl-' || lpad(i::text, 2, '0'), 'full', 'Rl ' || i,
      'pos', (array['QB','RB','WR','TE','RB','WR'])[1 + (i % 6)], 'team', 'BUF', 'exp', 3);
  end loop;
  perform rl_ok(seed_league_pool(lid, pool), 'pool ' || p_name);
  perform rl_ok(set_keeper_count(lid, 2), 'keepers ' || p_name);
  perform rl_ok(start_draft(lid, '[1,2,3,4]'::jsonb), 'start ' || p_name);
  perform rl_autodraft(lid);
  perform rl_season(lid);
  return lid;
end $$;

insert into auth.users (id, email)
  select ('00000000-0000-0000-0000-0000000079' || lpad(i::text, 2, '0'))::uuid, 'rl' || lpad(i::text, 2, '0') || '@test.dev'
  from generate_series(1, 9) i on conflict (id) do nothing;
insert into app_user (id, email)
  select ('00000000-0000-0000-0000-0000000079' || lpad(i::text, 2, '0'))::uuid, 'rl' || lpad(i::text, 2, '0') || '@test.dev'
  from generate_series(1, 9) i on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
  where id::text like '00000000-0000-0000-0000-0000000079%';

do $$
declare a uuid; b uuid; c uuid; r jsonb; lad uuid; st jsonb; na uuid; nb uuid; kept4 text[]; held_b text[];
        a4user uuid; b1user uuid; b1name text; ok boolean;
begin
  a := rl_league('Premier', '2024', '02', '03', '04');
  b := rl_league('Championship', '2024', '05', '06', '07');
  c := rl_league('Other year', '2023', '08', '09', '06');

  -- ══ rl1. building a ladder ══
  perform rl_as('02');
  perform rl_err(create_league_ladder('Pyramid', array[a, b]), 'commissioner of every tier', 'rl1 a manager can''t link leagues');
  perform rl_as('01');
  perform rl_err(create_league_ladder('Pyramid', array[a]), 'at least two', 'rl1a one league isn''t a ladder');
  perform rl_err(create_league_ladder('Pyramid', array[a, a]), 'one tier', 'rl1b the same league twice');
  perform rl_err(create_league_ladder('Pyramid', array[a, c]), 'same season', 'rl1c different seasons');
  perform rl_err(create_league_ladder('Pyramid', array[a, b], 'standings', 4), 'too few', 'rl1d can''t move more teams than a tier has');
  perform rl_err(create_league_ladder('Pyramid', array[a, b], 'vibes'), 'unknown method', 'rl1e methods are the four');
  r := create_league_ladder('Pyramid', array[a, b], 'standings', 1, 'roster');
  perform rl_ok(r, 'rl1f two tiers, one team each way, rosters travel'); lad := (r ->> 'ladder_id')::uuid;
  perform rl_err(create_league_ladder('Again', array[b, a]), 'another ladder', 'rl1g a league is in one ladder');

  -- ══ rl2. the order each method reads ══
  perform rl_true(_ladder_rank(a, 'standings') = array[1,2,3,4], 'rl2 standings: by record (got ' || _ladder_rank(a, 'standings')::text || ')');
  perform rl_true(_ladder_rank(a, 'points') = array[1,2,4,3], 'rl2a points: by points scored (got ' || _ladder_rank(a, 'points')::text || ')');
  perform rl_true(_ladder_rank(b, 'playoffs') = array[1,2,3,4], 'rl2b no playoffs played: the standings');
  -- the Championship's playoffs: 3 beat 2 in the final; the consolation ladder ended 4, 1
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final, is_playoff, playoff_round)
    values (b, 15, 2, 3, 'final', 80, 90, true, 1);
  update league set settings_json = settings_json || '{"playoff_champion": 3, "playoff_bracket": {"consolation": [4, 1]}}'::jsonb where id = b;
  perform rl_true(_ladder_rank(b, 'playoffs') = array[3,2,4,1], 'rl2c playoffs: champion, runner-up, then the consolation ladder (got ' || _ladder_rank(b, 'playoffs')::text || ')');
  st := _ladder_movers(lad);
  perform rl_true(st -> 0 -> 'down' = '[4]'::jsonb and st -> 1 -> 'up' = '[1]'::jsonb and st -> 0 -> 'up' = '[]'::jsonb and st -> 1 -> 'down' = '[]'::jsonb,
    'rl2d standings: the Premier''s last goes down, the Championship''s first comes up (got ' || st::text || ')');
  perform rl_ok(set_ladder_rules(lad, 'points'), 'rl2e method: points');
  perform rl_true(_ladder_movers(lad) -> 0 -> 'down' = '[3]'::jsonb, 'rl2f points: the fewest points goes down');
  perform rl_ok(set_ladder_rules(lad, 'playoffs'), 'rl2g method: playoffs');
  perform rl_true(_ladder_movers(lad) -> 1 -> 'up' = '[3]'::jsonb, 'rl2h playoffs: the champion comes up');
  perform rl_ok(set_ladder_rules(lad, 'promotion_playoff', 2), 'rl2i promotion playoff, two each way');
  st := _ladder_movers(lad);
  perform rl_true(st -> 1 -> 'up' = '[1, 3]'::jsonb and st -> 0 -> 'down' = '[4, 3]'::jsonb,
    'rl2j promotion playoff: the best record goes up, then the playoff winner; relegation by record (got ' || st::text || ')');
  perform rl_ok(set_ladder_rules(lad, 'standings', 1), 'rl2k back to standings, one each way');
  perform rl_as('02');
  perform rl_err(set_ladder_rules(lad, 'points'), 'commissioner of every tier', 'rl2l a manager can''t change the rules');

  -- ══ rl3. what a member of the lower tier sees ══
  perform rl_as('05');
  st := league_ladder_state(b);
  perform rl_true(st -> 'ladder' ->> 'name' = 'Pyramid' and (st ->> 'tier')::int = 2 and jsonb_array_length(st -> 'tiers') = 2
    and st -> 'tiers' -> 0 -> 'down' = '[4]'::jsonb and not (st -> 'ladder' ->> 'can_edit')::boolean,
    'rl3 a Championship member sees both tiers and who''d go down from the Premier (got ' || st::text || ')');
  perform rl_true(st -> 'tiers' -> 0 -> 'names' ->> '4' = 'Premier-04', 'rl3a with team names');
  perform rl_as('08');
  perform rl_err(league_ladder_state(b), 'forbidden', 'rl3b an outsider sees nothing');

  -- ══ rl4. the rollover, rosters travel ══
  perform rl_as('01');
  select array_agg(slug order by slug) into kept4 from _keeper_resolve(a, 2) where roster_id = 4;
  a4user := (select app_user_id from league_membership where league_id = a and sleeper_roster_id = 4);
  b1user := (select app_user_id from league_membership where league_id = b and sleeper_roster_id = 1);
  b1name := (select team_name from league_membership where league_id = b and sleeper_roster_id = 1);
  r := ladder_rollover(lad);
  perform rl_ok(r, 'rl4 the ladder rolls over');
  na := (select league_id from league_ladder_tier where ladder_id = lad and tier = 1);
  nb := (select league_id from league_ladder_tier where ladder_id = lad and tier = 2);
  perform rl_true(na <> a and nb <> b and (select season from league where id = na) = '2025' and (select season from league where id = nb) = '2025',
    'rl4a the ladder now points at next season''s leagues');
  perform rl_true((select app_user_id from league_membership where league_id = nb and sleeper_roster_id = 1) = a4user
    and (select team_name from league_membership where league_id = nb and sleeper_roster_id = 1) = 'Premier-04',
    'rl4b the Premier''s last place took the Championship''s top seat');
  perform rl_true((select app_user_id from league_membership where league_id = na and sleeper_roster_id = 4) = b1user
    and (select team_name from league_membership where league_id = na and sleeper_roster_id = 4) is not distinct from b1name,
    'rl4c the Championship winner took the Premier''s empty seat');
  -- rosters: the relegated team's keepers went down with it, unless the
  -- Championship already had them on another team
  select array_agg(slug order by slug) into held_b from native_roster where league_id = nb and roster_id <> 1;
  perform rl_true((select coalesce(array_agg(slug order by slug), '{}') from native_roster where league_id = nb and roster_id = 1)
      = (select coalesce(array_agg(k order by k), '{}') from unnest(kept4) k where not k = any(coalesce(held_b, '{}'))),
    'rl4d its kept players travel where the new league has a copy free');
  perform rl_true((select left_behind from league_ladder_move where ladder_id = lad and direction = 'down')
      = (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from unnest(kept4) k where k = any(coalesce(held_b, '{}'))),
    'rl4e and the rest are named as left behind');
  perform rl_true((select count(*) from native_roster where league_id = na and roster_id = 2) = 2
    and (select count(*) from native_roster where league_id = nb and roster_id = 3) = 2, 'rl4f teams that didn''t move keep their keepers');
  perform rl_true((select count(*) from league_ladder_move where ladder_id = lad and season = '2024') = 2, 'rl4g both moves are on the record');
  perform rl_true(jsonb_array_length(r -> 'moves') = 2, 'rl4h and in the answer');
  -- a tier that can't roll raises, so nothing the ladder did before it stands
  ok := false;
  begin
    perform ladder_rollover(lad);
  exception when others then
    ok := position('never finished' in sqlerrm) > 0;
  end;
  perform rl_true(ok, 'rl4i next season hasn''t been drafted — the ladder refuses');

  -- ══ rl5. all or nothing ══
  perform rl_true((select count(*) from league where id in (select league_id from league_ladder_tier where ladder_id = lad)
                    and season = '2025') = 2 and _rollover_target(na) is null and _rollover_target(nb) is null,
    'rl5 the refused rollover left no tier half-rolled');

  -- ══ rl6. 'redraft' mode ══
  insert into app_admin (email, note) values ('rl01@test.dev', 'relegation probe') on conflict (email) do nothing;
  perform rl_ok(set_ladder_rules(lad, null, null, 'redraft'), 'rl6 roster mode: redraft');
  perform rl_ok(start_draft(na, '[1,2,3,4]'::jsonb), 'rl6a the 2025 Premier drafts');
  perform rl_autodraft(na); perform rl_season(na);
  perform rl_ok(start_draft(nb, '[1,2,3,4]'::jsonb), 'rl6b the 2025 Championship drafts');
  perform rl_autodraft(nb); perform rl_season(nb);
  r := ladder_rollover(lad);
  perform rl_ok(r, 'rl6c the second rollover');
  na := (select league_id from league_ladder_tier where ladder_id = lad and tier = 1);
  nb := (select league_id from league_ladder_tier where ladder_id = lad and tier = 2);
  perform rl_true((select count(*) from native_roster where league_id = na and roster_id = 4) = 0
    and (select count(*) from native_roster where league_id = nb and roster_id = 1) = 0,
    'rl6d the movers'' new seats start empty');
  perform rl_true((select count(*) from native_roster where league_id = na and roster_id = 2) = 2, 'rl6e everyone else keeps');
  perform rl_ok(start_draft(na, '[1,2,3,4]'::jsonb), 'rl6f and the draft starts with an empty seat among keepers');
  perform rl_autodraft(na);
  perform rl_true((select count(*) from native_roster where league_id = na and roster_id = 4) >= 3, 'rl6g the empty seat drafts');

  perform rl_ok(delete_league_ladder(lad), 'rl7 the ladder can be taken down');
  perform rl_true(not exists (select 1 from league_ladder_tier where ladder_id = lad), 'rl7a and its tiers go with it');
  raise notice 'relegation probes done';
end $$;

select 'ALL RELEGATION PROBES PASSED' as result;
