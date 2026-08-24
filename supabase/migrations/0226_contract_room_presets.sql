-- 0226: contract leagues preset FAAB waivers
--
-- Founder: "Let's auto set contract league waivers to FAAB bidding."
--
-- One respin of _apply_continuity (0218 body), one addition: the contract
-- preset now lands waiver_mode='faab' with faab_budget = the salary cap.
-- In a contract league the winning waiver bid IS the player's signing
-- salary, so a priority wire would hand market-priced players to whoever
-- lost last, for free — blind bidding is the only wire that prices them.
-- The FAAB budget equals the cap so both wallets speak the same currency.
-- Runs at creation (create_native_league calls through) AND when an
-- existing league switches to a contract type; a waiver mode the
-- commissioner already chose is never overwritten.
--
-- (The companion "deep bench" preset is client-side — the creation forms
-- default a contract league's roster to cover everyone the AI market
-- prices above the $1 floor, but an explicitly chosen size always wins.)

create or replace function _apply_continuity(p_league_id uuid, p_mode text, p_n int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; d draft%rowtype; n int; s int; r jsonb; base text; cap int; ym int; capkeys jsonb;
begin
  select * into lg from league where id = p_league_id;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if coalesce(p_mode, '') not in ('redraft', 'keeper', 'dynasty', 'contract', 'contract_dynasty') then
    return jsonb_build_object('ok', false, 'error', 'continuity must be redraft, keeper, dynasty, contract or contract_dynasty');
  end if;
  base := case p_mode when 'contract' then 'redraft' when 'contract_dynasty' then 'dynasty' else p_mode end;
  -- the cap a contract mode lands: keep a cap the league already runs,
  -- else the auction budget (bids-as-salaries must fit), else $200
  cap := coalesce(nullif(lg.settings_json ->> 'salary_cap', '')::int,
                  case when d.mode = 'auction' then d.budget else 200 end);
  ym := coalesce(nullif(lg.settings_json ->> 'contract_years_max', '')::int, 4);
  capkeys := case when p_mode in ('contract', 'contract_dynasty')
    then jsonb_build_object('salary_cap', cap, 'contract_years_max', ym)
      -- FAAB rides the contract preset (0226, founder: "auto set contract
      -- league waivers to FAAB bidding") — the winning bid IS the signing
      -- salary, and a priority wire would hand market-priced players to
      -- whoever lost last, for free. The season budget is the cap, so both
      -- wallets speak the same currency. A waiver mode the league already
      -- chose is kept: this is a preset, not a mandate.
      || case when coalesce(nullif(lg.settings_json ->> 'waiver_mode', ''), '') = ''
           then jsonb_build_object('waiver_mode', 'faab', 'faab_budget', cap)
           else '{}'::jsonb end
    else '{}'::jsonb end;

  if base in ('redraft', 'keeper') then
    -- these families hold no pick assets — clear the futures, but never a traded one
    if exists (select 1 from pick_asset pa
               where pa.league_id = p_league_id and pa.season > lg.season
                 and pa.owner_roster <> pa.original_roster) then
      return jsonb_build_object('ok', false, 'error',
        'trades already moved future picks — undo those first');
    end if;
    delete from pick_asset where league_id = p_league_id and season > lg.season;
  end if;

  if base = 'redraft' then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        - 'continuity' - 'dynasty' - 'keeper_count' - 'rookie_rounds'
        - 'salary_cap' - 'contract_years_max'
        || case when p_mode = 'contract'
             then jsonb_build_object('continuity', 'contract') || capkeys
             else '{}'::jsonb end
      where id = p_league_id;
    return jsonb_build_object('ok', true, 'continuity', p_mode,
      'contracts', p_mode = 'contract');
  end if;

  if base = 'keeper' then
    if p_n is null or p_n < 1 or p_n > d.rounds - 1 then
      return jsonb_build_object('ok', false, 'error',
        'keepers must be 1–' || (d.rounds - 1) || ' (the roster holds ' || d.rounds || ')');
    end if;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        - 'dynasty' - 'rookie_rounds' - 'salary_cap' - 'contract_years_max'
        || jsonb_build_object('continuity', 'keeper', 'keeper_count', p_n)
      where id = p_league_id;
    return jsonb_build_object('ok', true, 'continuity', 'keeper', 'keeper_count', p_n);
  end if;

  -- dynasty family (dynasty / contract_dynasty)
  if lg.season !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'league season "' || coalesce(lg.season, '') || '" isn''t a year');
  end if;
  n := coalesce(p_n, 3);
  if n < 1 or n > least(10, d.rounds - 1) then
    return jsonb_build_object('ok', false, 'error',
      'rookie rounds must be 1–' || least(10, d.rounds - 1));
  end if;
  -- three years of futures, each round a tradeable asset from this moment
  for s in 1..3 loop
    r := _provision_pick_assets(p_league_id, ((lg.season)::int + s)::text, n);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      - 'salary_cap' - 'contract_years_max'
      || jsonb_build_object('continuity', p_mode, 'dynasty', true,
                            'rookie_rounds', n, 'keeper_count', d.rounds - n)
      || capkeys
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'continuity', p_mode, 'rookie_rounds', n,
    'keeper_count', d.rounds - n, 'contracts', p_mode = 'contract_dynasty',
    'seasons', jsonb_build_array(((lg.season)::int + 1)::text, ((lg.season)::int + 2)::text, ((lg.season)::int + 3)::text));
end $$;
