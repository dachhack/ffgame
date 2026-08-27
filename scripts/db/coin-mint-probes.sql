-- 0248 probes: a disarm refund must prove the coin was paid.
--
-- The exploit these pin was reproduced live before the fix — five loops of
-- (hero_set_buffs a buff for free) + (disarm_buff to be handed its price)
-- minted 475 coin from a zero balance. So the assertions come in two halves:
-- the mint is DEAD (a free-armed buff refunds nothing), and the legitimate
-- charged round-trip is UNHARMED (arm_buff → disarm_buff still nets to zero,
-- and a second disarm cannot double-refund).
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function cm_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000c1e0' || u, false);
  perform set_config('app.email', 'cm' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c1e01', 'cm1@test.dev')
on conflict (id) do nothing;

do $$
declare
  r    jsonb;
  lg   uuid;
  mid  uuid;
  wk   int;
  bal0 numeric; bal1 numeric; bal2 numeric; bal3 numeric;
  t    int; i int;
begin
  perform cm_as('1');
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000c1e01', 'cm1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000c1e01';

  -- an ordinary DRIP league (power-ups ON), caller is roster 1 and commish
  r := create_native_league('Mint Test', '2026', 4, 5, 60, 'snake');
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: fixture create refused — %', r ->> 'error';
  end if;
  lg := (r ->> 'league_id')::uuid;
  -- seed the pool first: native_roster.slug is a FK into league_pool
  declare pool jsonb := '[]'::jsonb;
  begin
    for i in 1..28 loop
      pool := pool || jsonb_build_object('slug', 'ce-' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
    end loop;
    r := seed_league_pool(lg, pool);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'PROBE FAIL: pool seed refused — %', r ->> 'error';
    end if;
  end;
  update draft set status = 'complete' where league_id = lg;
  for t in 1..4 loop
    for i in 1..5 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lg, t, 'ce-' || ((t - 1) * 5 + i), 'commish');
    end loop;
  end loop;
  r := native_generate_schedule(lg, 14);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: schedule refused — %', r ->> 'error';
  end if;
  select id, week into mid, wk from matchup
    where league_id = lg and 1 in (home_roster_id, away_roster_id) and status = 'scheduled'
    order by week limit 1;
  if mid is null then raise exception 'PROBE FAIL: no scheduled matchup for roster 1'; end if;

  if league_powerups_off(lg) then
    raise exception 'PROBE FAIL: power-ups read as OFF in a plain drip league — the exploit gate is wrong';
  end if;
  -- fund the wallet so the LEGIT arm below can actually charge
  insert into team_wallet (league_id, roster_id, coins) values (lg, 1, 500)
    on conflict (league_id, roster_id) do update set coins = 500;

  -- ══ THE MINT IS DEAD ═══════════════════════════════════════════════════════
  -- Free-arm via hero_set_buffs (writes applied_state, charges nothing), then
  -- disarm. Before 0248 each loop returned 95 coin; now it returns none.
  bal0 := (select coins from team_wallet where league_id = lg and roster_id = 1);
  for i in 1..5 loop
    r := hero_set_buffs(mid, '["counter-nuke"]'::jsonb);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'PROBE FAIL: hero_set_buffs refused — %', r ->> 'error';
    end if;
    r := disarm_buff(mid, 'counter-nuke');
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'PROBE FAIL: disarm refused — %', r ->> 'error';
    end if;
  end loop;
  bal1 := (select coins from team_wallet where league_id = lg and roster_id = 1);
  if bal1 <> bal0 then
    raise exception 'PROBE FAIL: MINT STILL OPEN — 5 free-arm/disarm loops moved the wallet % → % (minted %)',
      bal0, bal1, bal1 - bal0;
  end if;

  -- a single free-arm then disarm also returns exactly nothing
  perform hero_set_buffs(mid, '["insurance"]'::jsonb);
  r := disarm_buff(mid, 'insurance');
  bal2 := (select coins from team_wallet where league_id = lg and roster_id = 1);
  if bal2 <> bal1 then
    raise exception 'PROBE FAIL: a free-armed buff refunded % coin', bal2 - bal1;
  end if;

  -- ══ THE LEGIT CHARGED ROUND-TRIP IS UNHARMED ═══════════════════════════════
  -- arm_buff CHARGES the wallet; disarm returns exactly that, once.
  r := arm_buff(mid, 'counter-nuke');
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception 'PROBE FAIL: arm_buff refused — %', r ->> 'error';
  end if;
  if (select coins from team_wallet where league_id = lg and roster_id = 1) <> bal2 - 95 then
    raise exception 'PROBE FAIL: arm_buff did not charge 95';
  end if;
  r := disarm_buff(mid, 'counter-nuke');           -- returns the 95
  bal3 := (select coins from team_wallet where league_id = lg and roster_id = 1);
  if bal3 <> bal2 then
    raise exception 'PROBE FAIL: a charged arm→disarm did not net to zero (% vs %)', bal3, bal2;
  end if;

  -- and a SECOND disarm of the same (already-refunded) buff returns nothing:
  -- the charge is spent, so there is nothing left to prove.
  perform hero_set_buffs(mid, '["counter-nuke"]'::jsonb);   -- re-add for free
  r := disarm_buff(mid, 'counter-nuke');
  if (select coins from team_wallet where league_id = lg and roster_id = 1) <> bal3 then
    raise exception 'PROBE FAIL: a re-armed, already-paid-back buff double-refunded';
  end if;

  raise notice 'coin-mint probes done';
end $$;
select 'ALL COIN-MINT PROBES PASSED' as result;
