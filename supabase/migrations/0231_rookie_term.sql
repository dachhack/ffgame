-- 0231: rookie deals run the league's own term
--
-- Founder: "should rookies have a pre-set contract duration? Maybe a
-- default of 4 but commish can set a different period."
--
-- They had one — a hardcoded least(3, max). Three was arbitrary; the NFL's
-- actual rookie contract is FOUR years, so that becomes the default, and
-- the number becomes a league setting the commissioner can turn
-- (rookie_contract_years, clamped to the league's max deal length at both
-- set time and sign time). Rookie-scale SALARIES and the no-manager-edits
-- rule are unchanged — only the term is now the league's to choose.

create or replace function rookie_contract_years(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select settings_json ->> 'rookie_contract_years'
                          from league where id = p_league_id), '')::int, 4);
$$;

-- Commissioner: how many years a rookie-scale deal signs for.
create or replace function set_rookie_years(p_league_id uuid, p_years int)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not contracts_on(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'this league does not play with contracts');
  end if;
  if p_years is null or p_years < 1 or p_years > contract_years_max(p_league_id) then
    return jsonb_build_object('ok', false, 'error',
      'rookie deals must run 1–' || contract_years_max(p_league_id) || ' years (the league max)');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('rookie_contract_years', p_years)
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'rookie_years', p_years);
end $$;
grant execute on function set_rookie_years(uuid, int) to authenticated;

create or replace function _contract_originate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare sal int; yrs int := 1; how text; pk record; seas text; d draft%rowtype;
begin
  if not contracts_on(new.league_id) then return new; end if;
  -- Rollover carriage owns 'keeper' rows: the carried deal (real salary,
  -- real years) is inserted by rollover_league right after these rows land.
  -- A $1 street deal here would squat on that slot.
  if new.acquired = 'keeper' then return new; end if;
  select season into seas from league where id = new.league_id;
  if new.acquired = 'draft' then
    select * into d from draft where league_id = new.league_id;
    select price, round into pk from draft_pick
      where league_id = new.league_id and slug = new.slug
      order by overall desc limit 1;
    if pk.price is not null then
      sal := greatest(1, pk.price); how := 'auction';           -- the bid IS the salary
    else
      sal := contract_rookie_scale(coalesce(pk.round, 99));     -- scale by round
      how := case when d.pick_owners is not null then 'rookie' else 'draft' end;
      -- 0231: rookie deals run the league's own term — default 4, the NFL's
      -- real rookie-contract length, commissioner-settable in 📜 SALARY.
      if how = 'rookie' then yrs := least(rookie_contract_years(new.league_id), contract_years_max(new.league_id)); end if;
    end if;
  elsif new.acquired = 'waiver' then
    select greatest(1, coalesce(bid, 0)) into sal from waiver_claim
      where league_id = new.league_id and roster_id = new.roster_id
        and add_slug = new.slug and status in ('pending', 'won')
      order by created_at desc limit 1;
    sal := coalesce(sal, 1); how := 'waiver';                   -- the FAAB bid, else the $1 min
  elsif new.acquired = 'fa' then
    sal := 1; how := 'fa';
  else
    sal := 1; how := 'commish';
  end if;
  insert into contract (league_id, slug, roster_id, salary, years, acquired, start_season)
  values (new.league_id, new.slug, new.roster_id, sal, yrs, how, coalesce(seas, ''))
  on conflict (league_id, slug) do update
    set roster_id = excluded.roster_id;
  return new;
end $$;

create or replace function league_contracts(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare my_rid int; dl timestamptz;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not contracts_on(p_league_id) then return jsonb_build_object('contracts', false); end if;
  select sleeper_roster_id into my_rid from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled limit 1;
  dl := _contract_lock_deadline(p_league_id);
  return jsonb_build_object(
    'contracts', true,
    'salary_cap', league_salary_cap(p_league_id),
    'years_max', contract_years_max(p_league_id),
    -- 0229: 'locked' is the CALLER's — lengths stay assignable after the room
    -- closes until this seat locks (or the deadline passes). Kept as the one
    -- flag existing clients read; the lock machinery rides alongside.
    'locked', coalesce((select status from draft where league_id = p_league_id) = 'complete', true)
      and (my_rid is null
           or coalesce((select contracts_locked from league_membership
                        where league_id = p_league_id and sleeper_roster_id = my_rid), false)
           or (dl is not null and now() >= dl)),
    'my_locked', coalesce((select contracts_locked from league_membership
                           where league_id = p_league_id and sleeper_roster_id = my_rid), false),
    'lock_deadline', dl,
    'locks', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m2.sleeper_roster_id, 'locked',
        m2.contracts_locked or (dl is not null and now() >= dl)) order by m2.sleeper_roster_id)
      from league_membership m2 where m2.league_id = p_league_id), '[]'::jsonb),
    'offseason', _season_over(p_league_id) or is_admin(),
    'rules', jsonb_build_object(
      'dead_pct', contract_dead_pct(p_league_id),
      'retention', salary_retention_on(p_league_id),
      'cap_trading', cap_trading_on(p_league_id),
      'ir_relief', ir_cap_relief_on(p_league_id),
      'tag_raise_pct', tag_raise_pct(p_league_id),
      'ext_discount_pct', ext_discount_pct(p_league_id),
      'rfa', rfa_on(p_league_id),
      'rookie_years', rookie_contract_years(p_league_id)),
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'roster_id', c.roster_id, 'salary', c.salary,
        'years', c.years, 'acquired', c.acquired, 'tagged', c.tagged,
        'mkt', player_market_value(p_league_id, c.slug),  -- 0230: HIS price, not his position's
        'retained', coalesce((select sum(sr.amount) from salary_retention sr
            where sr.league_id = c.league_id and sr.slug = c.slug), 0)
        ) order by c.roster_id, c.salary desc, c.slug)
      from contract c where c.league_id = p_league_id), '[]'::jsonb),
    'retentions', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', sr.roster_id, 'slug', sr.slug, 'amount', sr.amount) order by sr.roster_id, sr.slug)
      from salary_retention sr where sr.league_id = p_league_id), '[]'::jsonb),
    'dead', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', dm.roster_id, 'slug', dm.slug, 'amount', dm.amount,
        'years_left', dm.years_left, 'note', dm.note) order by dm.roster_id, dm.amount desc)
      from dead_money dm where dm.league_id = p_league_id), '[]'::jsonb),
    'tenders', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', rt.slug, 'roster_id', rt.roster_id, 'status', rt.status,
        'offer_roster', rt.offer_roster, 'offer_salary', rt.offer_salary,
        'offer_years', rt.offer_years) order by rt.created_at)
      from rfa_tender rt where rt.league_id = p_league_id), '[]'::jsonb),
    'payrolls', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'payroll', team_payroll(p_league_id, m.sleeper_roster_id),
        'cap', team_cap(p_league_id, m.sleeper_roster_id),
        'cap_adjust', m.cap_adjust) order by m.sleeper_roster_id)
      from league_membership m where m.league_id = p_league_id), '[]'::jsonb));
end $$;
