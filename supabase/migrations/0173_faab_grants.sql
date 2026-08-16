-- 0173 · PER-TEAM FAAB WALLETS + GRANTS — "waivers when it's faab, we need to
-- list all the teams and current wallet and allow grants per team and overall
-- grants."
--
-- What already existed: league_membership.faab_budget (NULL = untouched = the
-- league default), member_faab() to read a seat's effective balance, and
-- native_team_state's waiver_order[].faab to list them. What did NOT exist was
-- any way to CHANGE one seat's balance — the only lever was the league-wide
-- budget in set_transaction_rules, which RESETS every team. So a commissioner
-- could not correct one bad bid, pay out a bet, or hand a late joiner a stake
-- without wiping the league's balances.
--
-- Grants are ADDITIVE, like the drip-coin grant they sit beside: a negative
-- amount claws back, and the result floors at 0 so a claw-back can't push a
-- seat negative (the claim resolver assumes bids never exceed the balance).
-- p_roster_id NULL grants EVERY team in one statement — the "overall grant".
--
-- REFUSED OUTSIDE FAAB MODE, deliberately: switching waiver mode resets every
-- faab_budget to NULL, so a grant made while the league is on rolling waivers
-- would silently evaporate the moment FAAB is turned on. Better to say so.

create or replace function commish_grant_faab(p_league_id uuid, p_roster_id int default null, p_amount int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare mode text; n int; rows jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('ok', false, 'error', 'amount required');
  end if;
  if abs(p_amount) > 100000 then
    return jsonb_build_object('ok', false, 'error', 'amount out of range');
  end if;
  select coalesce(settings_json ->> 'waiver_mode', 'rolling') into mode
    from league where id = p_league_id;
  if mode is null then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if mode <> 'faab' then
    return jsonb_build_object('ok', false, 'error',
      'set waivers to FAAB first — switching modes resets every balance');
  end if;
  if p_roster_id is not null and not exists (
    select 1 from league_membership
    where league_id = p_league_id and sleeper_roster_id = p_roster_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'no such team');
  end if;

  -- One statement, whether it's a single seat or the whole league. NULL
  -- budgets materialise to the league default first, so a grant means the
  -- same thing to a team that has spent and one that hasn't.
  update league_membership m
     set faab_budget = greatest(0, least(100000,
           coalesce(m.faab_budget, league_faab_budget(p_league_id)) + p_amount))
   where m.league_id = p_league_id
     and (p_roster_id is null or m.sleeper_roster_id = p_roster_id);
  get diagnostics n = row_count;

  select coalesce(jsonb_agg(jsonb_build_object(
      'roster_id', m.sleeper_roster_id, 'team', m.team_name,
      'faab', member_faab(p_league_id, m.sleeper_roster_id))
      order by m.sleeper_roster_id), '[]'::jsonb)
    into rows from league_membership m where m.league_id = p_league_id;
  return jsonb_build_object('ok', true, 'granted', n, 'teams', rows);
end $$;
grant execute on function commish_grant_faab(uuid, int, int) to authenticated;

-- Commissioner/admin read of every seat's FAAB, independent of waiver mode so
-- the editor can show balances the moment FAAB is selected (native_team_state
-- blanks them outside FAAB mode, and it is a member-facing call besides).
create or replace function league_faab_wallets(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'budget', league_faab_budget(p_league_id),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'faab', member_faab(p_league_id, m.sleeper_roster_id),
        'touched', m.faab_budget is not null)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id));
end $$;
grant execute on function league_faab_wallets(uuid) to authenticated;
