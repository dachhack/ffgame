-- 0115: practice weeks get their OWN weekly coin budget (120), instead of power-ups
-- simply being free.
--
-- 0110 made practice spending free — short-circuited before the balance guard so a
-- broke team could still exercise the whole board. That protected the real wallet,
-- but it taught the wrong game: with everything free the right move is always "arm
-- everything", which is exactly the habit that bankrupts a manager in Week 1. The
-- economy IS the decision the pilot most needs playtested, and free practice skips
-- it entirely.
--
-- So practice now has a parallel, throwaway economy: a PRACTICE WALLET keyed
-- (league, roster, BOARD WEEK), seeded at 120 the first time it's touched, spent at
-- real prices, and thrown away with the practice weeks. The real team_wallet is
-- still never moved by a practice week — that invariant from 0110 is untouched, and
-- its probes still pass. The two economies simply don't meet.
--
-- Per WEEK, not per league: each practice week starts fresh at 120, so a manager who
-- overspends in PRE 2 isn't crippled for PRE 3, and nothing accumulates into a
-- stockpile the real season never grants. Practice EARNINGS remain unbanked — the
-- weekly drip-coin from a practice game credits nothing, since it would only ever
-- arrive after that week's budget stopped mattering.

create or replace function practice_budget() returns numeric language sql immutable as $$ select 120::numeric $$;
grant execute on function practice_budget() to authenticated;

create table if not exists practice_wallet (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  week       int  not null,
  coins      numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (league_id, roster_id, week)
);
alter table practice_wallet enable row level security;
create policy practice_wallet_read on practice_wallet for select using (
  exists (select 1 from league_membership lm
           where lm.league_id = practice_wallet.league_id and lm.app_user_id = auth.uid())
);
grant select on practice_wallet to authenticated;

-- Balance for one (league, roster, practice week), seeding the week's budget on
-- first touch. Internal: reached only through the SECURITY DEFINER functions below.
create or replace function ensure_practice_wallet(p_league_id uuid, p_roster_id int, p_week int)
  returns numeric language plpgsql security definer set search_path = public as $$
declare c numeric;
begin
  if not is_practice_week(p_week) then return 0; end if;
  insert into practice_wallet (league_id, roster_id, week, coins)
    values (p_league_id, p_roster_id, p_week, practice_budget())
  on conflict (league_id, roster_id, week) do nothing;
  select coins into c from practice_wallet
    where league_id = p_league_id and roster_id = p_roster_id and week = p_week;
  return coalesce(c, 0);
end $$;
revoke all on function ensure_practice_wallet(uuid, int, int) from public;

-- Spending: a practice week now DEBITS the practice wallet at the real price, and
-- refuses when the week's budget is spent — the whole point is that the budget
-- bites. The real wallet is still never touched on a practice week.
create or replace function spend_from_wallet(p_league_id uuid, p_roster_id int, p_price numeric, p_matchup_id uuid, p_week int, p_reason text, p_idem text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  if p_price is null or p_price <= 0 then return jsonb_build_object('ok', true, 'charged', 0); end if;
  if is_practice_week(p_week) then
    bal := ensure_practice_wallet(p_league_id, p_roster_id, p_week);
    if bal < p_price then
      return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', bal, 'price', p_price, 'practice', true);
    end if;
    update practice_wallet set coins = coins - p_price, updated_at = now()
      where league_id = p_league_id and roster_id = p_roster_id and week = p_week;
    return jsonb_build_object('ok', true, 'charged', p_price, 'practice', true);
  end if;
  select coins into bal from team_wallet where league_id = p_league_id and roster_id = p_roster_id for update;
  if coalesce(bal, 0) < p_price then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', coalesce(bal, 0), 'price', p_price);
  end if;
  if not adjust_wallet(p_league_id, p_roster_id, p_matchup_id, p_week, -p_price, p_reason, p_idem) then
    return jsonb_build_object('ok', true, 'charged', 0, 'dup', true);
  end if;
  return jsonb_build_object('ok', true, 'charged', p_price);
end $$;

-- Refunds (disarm, back-out, sell) go back to the same throwaway purse, capped at
-- the week's budget so a refund can never mint practice coin. credit_wallet still
-- refuses to move the REAL wallet on a practice week — that guard is 0110's and
-- stays exactly as it was.
create or replace function credit_wallet(p_league_id uuid, p_roster_id int, p_matchup_id uuid, p_week int, p_delta numeric, p_reason text default 'earn')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare key text; applied boolean;
begin
  if p_delta is null then return jsonb_build_object('ok', false, 'error', 'null delta'); end if;
  if is_practice_week(p_week) then
    -- Only refunds return to the purse. Weekly drip-coin EARNINGS stay unbanked:
    -- they'd land after the week they could have been spent in.
    if p_reason like 'refund:%' then
      perform ensure_practice_wallet(p_league_id, p_roster_id, p_week);
      update practice_wallet set coins = least(coins + p_delta, practice_budget()), updated_at = now()
        where league_id = p_league_id and roster_id = p_roster_id and week = p_week;
      return jsonb_build_object('ok', true, 'credited', true, 'practice', true);
    end if;
    return jsonb_build_object('ok', true, 'credited', false, 'practice', true);
  end if;
  key := coalesce(p_matchup_id::text, p_league_id::text) || ':' || p_reason || ':' || p_roster_id;
  applied := adjust_wallet(p_league_id, p_roster_id, p_matchup_id, p_week, p_delta, p_reason, key);
  return jsonb_build_object('ok', true, 'credited', applied);
end $$;

-- The board reads its balance through these two, so a practice matchup shows the
-- practice purse rather than the season wallet the player can't spend there.
create or replace function my_wallet(p_matchup_id uuid) returns numeric
  language plpgsql stable security definer set search_path = public as $$
declare m matchup%rowtype; rid int; c numeric;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return 0; end if;
  rid := caller_roster(p_matchup_id);
  if rid is null then return 0; end if;
  if is_practice_week(m.week) then
    select coins into c from practice_wallet
      where league_id = m.league_id and roster_id = rid and week = m.week;
    -- Un-seeded reads as the full budget; the row appears on the first spend.
    return coalesce(c, practice_budget());
  end if;
  return coalesce((select w.coins from team_wallet w where w.league_id = m.league_id and w.roster_id = rid), 0);
end $$;

create or replace function ensure_wallet(p_matchup_id uuid) returns numeric
  language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; rid int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found or not is_matchup_participant(p_matchup_id) then return 0; end if;
  rid := caller_roster(p_matchup_id);
  if rid is null then return 0; end if;
  if is_practice_week(m.week) then return ensure_practice_wallet(m.league_id, rid, m.week); end if;
  -- Season seed: p_week NULL, deliberately not a practice week, so a manager who
  -- only ever opens a practice board still gets their real starting balance.
  perform credit_wallet(m.league_id, rid, null, null, wallet_seed(), 'seed');
  return my_wallet(p_matchup_id);
end $$;

grant execute on function my_wallet(uuid) to authenticated;
grant execute on function ensure_wallet(uuid) to authenticated;

-- The purse is throwaway: it dies with the weeks it belongs to. Both the rebuild
-- (per week, skipping already-played ones) and the off-switch (every practice
-- week) drop it, so no practice balance outlives its week.
create or replace function _clone_preseason_weeks(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wk int; src int; made int := 0; total int := 0;
  ids uuid[]; seats int[]; seeded int[] := '{}'; skipped int[] := '{}';
  seas text; last_kick timestamptz; i int;
begin
  select season into seas from league where id = p_league_id;

  foreach wk in array preseason_board_weeks() loop
    select max(kickoff) into last_kick from nfl_slate where season = seas and week = wk;
    if last_kick is not null and last_kick + interval '4 hours' < now() then
      skipped := skipped || wk;
      continue;
    end if;

    select array_agg(id) into ids from matchup where league_id = p_league_id and week = wk;
    if ids is not null then
      delete from sealed_pick   where matchup_id = any(ids);
      delete from matchup_state where matchup_id = any(ids);
      delete from applied_state where matchup_id = any(ids);
      delete from matchup        where id = any(ids);
    end if;
    delete from sleeper_lineup   where league_id = p_league_id and week = wk;
    delete from practice_wallet  where league_id = p_league_id and week = wk;

    select array_agg(sleeper_roster_id order by md5(p_league_id::text || ':' || wk::text || ':' || sleeper_roster_id::text))
      into seats
      from (select distinct sleeper_roster_id from league_membership where league_id = p_league_id) s;
    if seats is null or array_length(seats, 1) < 2 then
      continue;
    end if;

    made := 0;
    i := 1;
    while i + 1 <= array_length(seats, 1) loop
      insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
        values (p_league_id, wk, null, seats[i], seats[i + 1], 'scheduled', null);
      made := made + 1;
      i := i + 2;
    end loop;
    total := total + made;

    src := wk - 100;
    if not exists (select 1 from sleeper_lineup where league_id = p_league_id and week = src) then
      src := 1;
    end if;
    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
      select league_id, wk, roster_id, starters_json
        from sleeper_lineup where league_id = p_league_id and week = src;

    seeded := seeded || wk;
  end loop;

  return jsonb_build_object('weeks', to_jsonb(seeded), 'skipped', to_jsonb(skipped),
                            'matchups', total, 'per_week', made);
end $$;

create or replace function _set_preseason(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ts timestamptz; r jsonb; wks int[] := preseason_board_weeks(); n int;
begin
  if p_on then
    select count(distinct sleeper_roster_id) into n from league_membership where league_id = p_league_id;
    if coalesce(n, 0) < 2 then
      return jsonb_build_object('ok', false, 'error', 'league needs at least two seats to pair a practice matchup');
    end if;
    update league set preseason_at = now() where id = p_league_id returning preseason_at into ts;
    r := _clone_preseason_weeks(p_league_id);
    if jsonb_array_length(r -> 'weeks') = 0 then
      update league set preseason_at = null where id = p_league_id;
      return jsonb_build_object('ok', false, 'error', 'every preseason week has already been played');
    end if;
    return jsonb_build_object('ok', true, 'preseason_at', ts,
      'matchups', r -> 'per_week', 'weeks', r -> 'weeks', 'skipped', r -> 'skipped');
  end if;
  update league set preseason_at = null where id = p_league_id returning preseason_at into ts;
  delete from sealed_pick    where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from matchup_state  where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from applied_state  where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from matchup        where league_id = p_league_id and week = any(wks);
  delete from sleeper_lineup where league_id = p_league_id and week = any(wks);
  delete from practice_wallet where league_id = p_league_id and week = any(wks);
  return jsonb_build_object('ok', true, 'preseason_at', ts, 'matchups', 0, 'weeks', '[]'::jsonb);
end $$;

revoke all on function _set_preseason(uuid, boolean) from public;
revoke all on function _clone_preseason_weeks(uuid) from public;

-- wallet_buy_powerup: the charge is real again in practice, so it reports what it
-- cost. Inventory stays untouched on a practice week (0110) — a purse purchase must
-- not mint an item the season keeps.
create or replace function wallet_buy_powerup(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; rid int; price numeric; sp jsonb; bal numeric;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  rid := caller_roster(p_matchup_id);
  price := powerup_price(p_powerup_id);
  if price >= 9999 then return jsonb_build_object('ok', false, 'error', 'unknown powerup'); end if;
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:' || p_powerup_id, null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', coalesce(sp->'balance', to_jsonb(0)), 'price', price);
  end if;
  bal := my_wallet(p_matchup_id);
  if is_practice_week(m.week) then
    return jsonb_build_object('ok', true, 'balance', bal, 'charged', price, 'practice', true);
  end if;
  perform bump_inventory(m.league_id, rid, p_powerup_id, 1);
  return jsonb_build_object('ok', true, 'balance', bal, 'charged', price);
end $$;
