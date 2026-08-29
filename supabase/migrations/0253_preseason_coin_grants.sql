-- 0253: commissioner coin grants land where the league is actually playing.
--
-- Founder, mid-preseason, after granting himself 500: "granted myself drip coin
-- but it didn't take." It HAD taken — into team_wallet, the season purse — but
-- his board was PRE 4, and practice weeks run 0115's throwaway per-week wallet,
-- so the chip never moved. The commissioner's one lever silently paid an account
-- no current board reads.
--
-- The ruling: "Let's set coin to the regular season wallet after the preseason
-- is over. So adjustments now take, but they wipe after this week."
--
-- So grants follow the board:
--   · league_practice_week(league) — the practice week currently in play (the
--     earliest week > 100 whose matchups aren't all final), null once the
--     preseason is over or was never opened. The single routing predicate.
--   · commish_seed_coin — while a practice week is in play, the grant seeds and
--     credits THAT week's practice_wallet (clamped at 0 on claw-backs) and says
--     so ({practice: true, week}). Otherwise the 0046 season path, unchanged.
--     Practice grants stay off the coin ledger on purpose: the purse they touch
--     dies with the week, exactly like practice spending (0115).
--   · admin_league_wallets — the commissioner's table shows the SAME purse the
--     grants move: during practice, every seat's practice balance (un-seeded
--     seats read the full weekly budget, mirroring 0115's my_wallet); after,
--     the season wallets as before.
--
-- The 0110/0115 invariants hold: nothing here moves team_wallet on a practice
-- week, and no practice balance outlives its week — the wipe is the existing
-- per-week keying plus _clone_preseason_weeks/set_preseason_practice cleanup.

create or replace function league_practice_week(p_league_id uuid) returns int
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id) or is_league_member(p_league_id)) then
    return null;
  end if;
  return (select min(week) from matchup
           where league_id = p_league_id and is_practice_week(week) and status <> 'final');
end $$;
grant execute on function league_practice_week(uuid) to authenticated;

create or replace function commish_seed_coin(p_league_id uuid, p_roster_id int, p_amount numeric)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare bal numeric; pw int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_amount is null or p_amount = 0 then return jsonb_build_object('ok', false, 'error', 'amount required'); end if;
  pw := (select min(week) from matchup
          where league_id = p_league_id and is_practice_week(week) and status <> 'final');
  if pw is not null then
    -- Seed-then-credit so an untouched seat starts from the week's budget, and
    -- clamp at 0 so a claw-back can't drive a throwaway purse negative.
    perform ensure_practice_wallet(p_league_id, p_roster_id, pw);
    update practice_wallet set coins = greatest(0, coins + p_amount), updated_at = now()
      where league_id = p_league_id and roster_id = p_roster_id and week = pw;
    select coins into bal from practice_wallet
      where league_id = p_league_id and roster_id = p_roster_id and week = pw;
    return jsonb_build_object('ok', true, 'balance', coalesce(bal, 0), 'practice', true, 'week', pw);
  end if;
  -- null idem → always applies (each grant is additive, not deduped).
  perform adjust_wallet(p_league_id, p_roster_id, null, null, p_amount, 'commish_seed', null);
  select coins into bal from team_wallet where league_id = p_league_id and roster_id = p_roster_id;
  return jsonb_build_object('ok', true, 'balance', coalesce(bal, 0));
end $$;
grant execute on function commish_seed_coin(uuid, int, numeric) to authenticated;

create or replace function admin_league_wallets(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; pw int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  pw := (select min(week) from matchup
          where league_id = p_league_id and is_practice_week(week) and status <> 'final');
  if pw is not null then
    -- Every seat, from membership: an un-seeded practice purse reads the full
    -- weekly budget (its row only appears on the first spend/grant — 0115).
    select coalesce(jsonb_agg(jsonb_build_object('roster_id', m.rid, 'coins', coalesce(w.coins, practice_budget())) order by m.rid), '[]'::jsonb)
      into result
      from (select distinct sleeper_roster_id as rid from league_membership where league_id = p_league_id) m
      left join practice_wallet w
        on w.league_id = p_league_id and w.roster_id = m.rid and w.week = pw;
    return result;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('roster_id', roster_id, 'coins', coins) order by roster_id), '[]'::jsonb)
    into result from team_wallet where league_id = p_league_id;
  return result;
end $$;
grant execute on function admin_league_wallets(uuid) to authenticated;

-- The app's commissioner table reads each seat's `coin` from admin_league_members
-- (0130), so its balance column follows the same routing. Body is 0215's, with
-- the coin expression made practice-aware.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb; pw int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  pw := (select min(week) from matchup
          where league_id = p_league_id and is_practice_week(week) and status <> 'final');
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username,
    'avatar', m.avatar_url, 'claim_email', m.claim_email,
    'coin', case when pw is not null then coalesce(p.coins, practice_budget()) else coalesce(w.coins, 0) end,
    'division', m.division,
    'drifted', (
      coalesce(l.provider, 'sleeper') = 'sleeper'
      and m.enrolled
      and m.claim_email is null
      and u.sleeper_user_id is distinct from m.sleeper_owner_id
    )
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m
    join league l on l.id = m.league_id
    left join app_user u on u.id = m.app_user_id
    left join team_wallet w on w.league_id = m.league_id and w.roster_id = m.sleeper_roster_id
    left join practice_wallet p on p.league_id = m.league_id and p.roster_id = m.sleeper_roster_id and p.week = pw
  where m.league_id = p_league_id;
  return result;
end $$;
