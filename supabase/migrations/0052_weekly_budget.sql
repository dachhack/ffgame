-- 0052: commissioner-defined WEEKLY BUDGET. A league can set a flat weekly coin
-- amount every team is credited each week; the commissioner grants it per week
-- (idempotent, so re-running a week never double-credits). Complements the
-- existing per-team commish_seed_coin grant. All wallet mutation still flows
-- through adjust_wallet, so sum(coin_ledger.delta) == team_wallet.coins holds.

alter table league add column if not exists weekly_budget numeric not null default 0;

-- Surface weekly_budget on the overview RPCs (admin + commissioner dashboards).
create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null, 'lineup_policy', l.lineup_policy,
      'weekly_budget', l.weekly_budget,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function admin_overview() to authenticated;

create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true, 'lineup_policy', l.lineup_policy,
      'weekly_budget', l.weekly_budget,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l where l.commissioner_id = auth.uid() order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function commish_overview() to authenticated;

-- Commissioner/admin sets the league's weekly budget (>= 0; 0 disables it).
create or replace function commish_set_weekly_budget(p_league_id uuid, p_amount numeric)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_amount is null or p_amount < 0 then return jsonb_build_object('ok', false, 'error', 'amount must be >= 0'); end if;
  update league set weekly_budget = p_amount where id = p_league_id;
  return jsonb_build_object('ok', true, 'weekly_budget', p_amount);
end $$;
grant execute on function commish_set_weekly_budget(uuid, numeric) to authenticated;

-- Commissioner/admin grants the league's weekly budget to every team for one week.
-- Idempotent per (league, week, roster) via the ledger idem_key, so pressing it
-- twice — or a later worker run — never double-credits. Returns how many teams
-- were newly credited (0 if already granted or the budget is 0).
create or replace function commish_grant_weekly_budget(p_league_id uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare bud numeric; n int := 0; rid int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_week is null or p_week < 1 then return jsonb_build_object('ok', false, 'error', 'week required'); end if;
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
