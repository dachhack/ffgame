-- 0110: PRESEASON PRACTICE — make the preseason board weeks genuinely THROWAWAY,
-- and put turning them on within a commissioner's reach.
--
-- 0054 gave leagues real preseason matchups at offset board weeks 101-103 and
-- 0101 gave those weeks a deep (backups-included) pick pool, but everything the
-- games PRODUCED still landed in the real season:
--
--   1. league_standings counted preseason finals → practice W/L and PF polluted
--      the standings AND the playoff seeding built from them (0073).
--   2. resolve banked each side's weekly drip-coin into the persistent team
--      wallet regardless of week → three weeks of practice funded real Week-1
--      power-ups.
--   3. power-ups bought/armed in practice charged that same wallet and moved
--      team_inventory, which is keyed (league_id, roster_id) with no week.
--   4. commish_grant_weekly_budget happily credited a preseason week.
--
-- The rule this migration establishes: **a practice week never moves real coin
-- or real inventory, and never appears in a record.** Power-ups are free and
-- unlimited while practising (the charge is short-circuited, not refused, so a
-- broke team can still exercise the whole board); nothing carries out.
--
-- Practice = board week > 100, mirroring PRESEASON_BASE in src/data/nflSlate.ts.

-- ── the shared predicate ─────────────────────────────────────────────────────
-- Every guard below routes through these two so "what counts as practice" has a
-- single definition. A null week (the season wallet seed) is NOT practice.
create or replace function is_practice_week(p_week int) returns boolean
  language sql immutable as $$ select coalesce(p_week, 0) > 100 $$;

create or replace function matchup_is_practice(p_matchup_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_practice_week((select week from matchup where id = p_matchup_id));
$$;
grant execute on function is_practice_week(int) to authenticated;
grant execute on function matchup_is_practice(uuid) to authenticated;

-- ── 1. standings + playoff seeding ignore practice weeks ─────────────────────
-- Body is 0073's, with the week filter added to both halves of the union.
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa)
      order by z.w desc, z.pf desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa
      from league_membership m
      left join (
        select x.rid, count(*) filter (where x.us > x.them) as w,
               count(*) filter (where x.us < x.them) as l,
               count(*) filter (where x.us = x.them) as t,
               sum(x.us) as pf, sum(x.them) as pa
        from (
          select mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
          union all
          select mu.away_roster_id, mu.away_final, mu.home_final
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;
grant execute on function league_standings(uuid) to authenticated;

-- ── 2/3. the wallet never moves on a practice week ───────────────────────────
-- adjust_wallet is the single choke point every credit and debit runs through
-- (credit_wallet, spend_from_wallet, the worker's AI budget pass), so the guard
-- lives here first: no ledger row, no balance change, ever, for a practice week.
create or replace function adjust_wallet(p_league_id uuid, p_roster_id int, p_matchup_id uuid, p_week int, p_delta numeric, p_reason text, p_idem text)
  returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if is_practice_week(p_week) then return false; end if;
  insert into coin_ledger (league_id, roster_id, matchup_id, week, delta, reason, idem_key)
    values (p_league_id, p_roster_id, p_matchup_id, p_week, p_delta, p_reason, p_idem)
    on conflict (idem_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  insert into team_wallet (league_id, roster_id, coins) values (p_league_id, p_roster_id, p_delta)
    on conflict (league_id, roster_id) do update set coins = team_wallet.coins + p_delta, updated_at = now();
  return true;
end $$;

-- Earnings: a practice week banks nothing. Reported ok so the resolver's
-- idempotent credit path stays quiet rather than logging a failure every tick.
create or replace function credit_wallet(p_league_id uuid, p_roster_id int, p_matchup_id uuid, p_week int, p_delta numeric, p_reason text default 'earn')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare key text; applied boolean;
begin
  if p_delta is null then return jsonb_build_object('ok', false, 'error', 'null delta'); end if;
  if is_practice_week(p_week) then return jsonb_build_object('ok', true, 'credited', false, 'practice', true); end if;
  key := coalesce(p_matchup_id::text, p_league_id::text) || ':' || p_reason || ':' || p_roster_id;
  applied := adjust_wallet(p_league_id, p_roster_id, p_matchup_id, p_week, p_delta, p_reason, key);
  return jsonb_build_object('ok', true, 'credited', applied);
end $$;

-- Spending: FREE in practice, and short-circuited BEFORE the balance guard —
-- a team with 0 coin must still be able to arm everything and learn the game.
-- Callers only read `ok`, so charged: 0 flows through arm_buff/arm_unlock/
-- wallet_buy_powerup unchanged.
create or replace function spend_from_wallet(p_league_id uuid, p_roster_id int, p_price numeric, p_matchup_id uuid, p_week int, p_reason text, p_idem text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  if p_price is null or p_price <= 0 then return jsonb_build_object('ok', true, 'charged', 0); end if;
  if is_practice_week(p_week) then return jsonb_build_object('ok', true, 'charged', 0, 'practice', true); end if;
  select coins into bal from team_wallet where league_id = p_league_id and roster_id = p_roster_id for update;
  if coalesce(bal, 0) < p_price then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', coalesce(bal, 0), 'price', p_price);
  end if;
  if not adjust_wallet(p_league_id, p_roster_id, p_matchup_id, p_week, -p_price, p_reason, p_idem) then
    return jsonb_build_object('ok', true, 'charged', 0, 'dup', true);
  end if;
  return jsonb_build_object('ok', true, 'charged', p_price);
end $$;

-- Inventory is keyed by TEAM with no week (0048), so practice must not touch it
-- in EITHER direction: a free practice buy can't mint a real owned item, and
-- arming one in practice can't burn something bought for the season. The client
-- mirrors inventory optimistically for the session, so the board still behaves
-- normally while practising; a reload shows the untouched real inventory.
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
  select coins into bal from team_wallet where league_id = m.league_id and roster_id = rid;
  if is_practice_week(m.week) then
    return jsonb_build_object('ok', true, 'balance', coalesce(bal, 0), 'charged', 0, 'practice', true);
  end if;
  perform bump_inventory(m.league_id, rid, p_powerup_id, 1);
  return jsonb_build_object('ok', true, 'balance', coalesce(bal, 0), 'charged', price);
end $$;

create or replace function consume_inventory(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid;
begin
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if matchup_is_practice(p_matchup_id) then return jsonb_build_object('ok', true, 'practice', true); end if;
  select league_id into lg from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  return jsonb_build_object('ok', true, 'qty', bump_inventory(lg, rid, p_powerup_id, -1));
end $$;

create or replace function refund_inventory(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; lg uuid;
begin
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if matchup_is_practice(p_matchup_id) then return jsonb_build_object('ok', true, 'practice', true); end if;
  select league_id into lg from matchup where id = p_matchup_id;
  rid := caller_roster(p_matchup_id);
  return jsonb_build_object('ok', true, 'qty', bump_inventory(lg, rid, p_powerup_id, 1));
end $$;

-- ── 4. the weekly budget can't be granted for a practice week ────────────────
-- adjust_wallet would already refuse; this says so out loud instead of
-- reporting a silent "0 credited" the commissioner would read as a bug.
create or replace function commish_grant_weekly_budget(p_league_id uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare bud numeric; n int := 0; rid int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_week is null or p_week < 1 then return jsonb_build_object('ok', false, 'error', 'week required'); end if;
  if is_practice_week(p_week) then
    return jsonb_build_object('ok', false, 'error', 'preseason practice weeks don''t earn or spend real coin');
  end if;
  select weekly_budget into bud from league where id = p_league_id;
  if coalesce(bud, 0) <= 0 then return jsonb_build_object('ok', true, 'credited', 0, 'weekly_budget', coalesce(bud, 0)); end if;
  for rid in select distinct sleeper_roster_id from league_membership where league_id = p_league_id loop
    if adjust_wallet(p_league_id, rid, null, p_week, bud,
        'weekly_budget', 'weekly_budget:' || p_league_id::text || ':' || p_week::text || ':' || rid::text) then
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'credited', n, 'weekly_budget', bud);
end $$;
grant execute on function commish_grant_weekly_budget(uuid, int) to authenticated;

-- ── the one-click: a COMMISSIONER can open practice ──────────────────────────
-- 0054's toggle and 0101's pool seeder were both super-admin, in that order, on
-- two buttons — and the pool had to be re-seeded after every re-toggle or seats
-- would field Week-1 starters who don't take preseason snaps. Both now accept
-- the league's commissioner, and the client drives them as one action
-- (liveApi enablePreseasonPractice → set_preseason_practice + a seed per week).

-- Shared body for both entry points; auth is the caller's job.
create or replace function _set_preseason(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ts timestamptz; n int := 0;
begin
  if p_on then
    -- The clone copies Week 1, so an unsynced league would silently get nothing.
    if not exists (select 1 from matchup where league_id = p_league_id and week = 1) then
      return jsonb_build_object('ok', false, 'error', 'no Week-1 matchups to clone — sync the season first');
    end if;
    update league set preseason_at = now() where id = p_league_id returning preseason_at into ts;
    n := _clone_preseason_weeks(p_league_id);
  else
    update league set preseason_at = null where id = p_league_id returning preseason_at into ts;
    delete from sealed_pick   where matchup_id in (select id from matchup where league_id = p_league_id and week in (101,102,103));
    delete from matchup_state where matchup_id in (select id from matchup where league_id = p_league_id and week in (101,102,103));
    delete from applied_state where matchup_id in (select id from matchup where league_id = p_league_id and week in (101,102,103));
    delete from matchup        where league_id = p_league_id and week in (101,102,103);
    delete from sleeper_lineup where league_id = p_league_id and week in (101,102,103);
  end if;
  return jsonb_build_object('ok', true, 'preseason_at', ts, 'matchups', n);
end $$;

-- Internal only. Both helpers are SECURITY DEFINER with no auth check of their
-- own, and CREATE FUNCTION grants EXECUTE to PUBLIC by default — without these
-- revokes any signed-in user could call them directly and clone (or wipe) the
-- preseason weeks of a league they have nothing to do with. _clone_preseason_
-- weeks has been exposed that way since 0054; closing it here.
revoke all on function _set_preseason(uuid, boolean) from public;
revoke all on function _clone_preseason_weeks(uuid) from public;

create or replace function admin_set_preseason(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return _set_preseason(p_league_id, p_on);
end $$;
grant execute on function admin_set_preseason(uuid, boolean) to authenticated;

create or replace function set_preseason_practice(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return _set_preseason(p_league_id, p_on);
end $$;
grant execute on function set_preseason_practice(uuid, boolean) to authenticated;

-- 0101's pool seeder, opened to the commissioner. admin_seed_preseason_pool is
-- kept as a delegating alias so any older client keeps working.
create or replace function seed_preseason_pool(p_league_id uuid, p_week int, p_pool jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not is_practice_week(p_week) or p_week > 103 then
    return jsonb_build_object('ok', false, 'error', 'preseason board weeks only (101-103)');
  end if;
  if jsonb_typeof(p_pool) is distinct from 'array' or jsonb_array_length(p_pool) = 0 then
    return jsonb_build_object('ok', false, 'error', 'pool must be a non-empty array');
  end if;
  if jsonb_array_length(p_pool) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large');
  end if;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    select p_league_id, p_week, m.sleeper_roster_id, p_pool
      from league_membership m where m.league_id = p_league_id
  on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'league has no seats'); end if;
  return jsonb_build_object('ok', true, 'seats', n, 'pool', jsonb_array_length(p_pool));
end $$;
grant execute on function seed_preseason_pool(uuid, int, jsonb) to authenticated;

create or replace function admin_seed_preseason_pool(p_league_id uuid, p_week int, p_pool jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return seed_preseason_pool(p_league_id, p_week, p_pool);
end $$;
grant execute on function admin_seed_preseason_pool(uuid, int, jsonb) to authenticated;

-- The commissioner's own card reads from commish_overview, which never carried
-- the mode stamps — so a commish-flipped league showed no 🏈 chip and the
-- control couldn't tell it was already on. Body is 0104's plus the two stamps.
create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider, 'avatar_url', l.avatar_url,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true, 'lineup_policy', l.lineup_policy,
      'weekly_budget', l.weekly_budget,
      'test_live_at', l.test_live_at,
      'preseason_at', l.preseason_at,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l where l.commissioner_id = auth.uid() order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function commish_overview() to authenticated;
