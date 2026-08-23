-- 0219: SALARY MECHANICS, IN-SEASON — the founder's "let's build them all":
-- salary retention on trades, raw cap-space trading, IR cap relief, the
-- league's own market pricer, and one settings surface (set_salary_rules)
-- behind the new 📜 SALARY commissioner section.
--
-- THE MODEL. team_payroll becomes the whole ledger: deals you hold (minus
-- what former teams retained on them, minus IR'd salary when the relief rule
-- is on), plus the salary YOU retained on players you traded away, plus your
-- dead money (0220's cuts write it; rollover carries it). team_cap is the
-- league cap plus your traded cap_adjust. The deferred contract trigger and
-- execute_trade both judge against these, so every mechanic lands in one
-- place.
--
-- CAP TIMING REFINED: the check now waits for the draft room to close.
-- During the startup the seat budget disciplines spending (and a rolled-over
-- contract league's seats start the room already docked their carried
-- payroll — see _start_draft_now below); a mid-draft carriage insert at
-- rollover must not abort the rollover on a cap technicality.
--
-- LINEAGE: propose_trade / execute_trade / _start_draft_now patched from
-- their CURRENT 0190 bodies programmatically. The 8-param propose_trade
-- signature is dropped before the 10-param one lands (the 0175 lesson).

-- ── Ledger tables ────────────────────────────────────────────────────────────
create table if not exists salary_retention (
  league_id  uuid not null references league(id) on delete cascade,
  slug       text not null,
  roster_id  int  not null,             -- the RETAINER (who eats the money)
  amount     int  not null check (amount >= 1),
  created_at timestamptz not null default now(),
  primary key (league_id, slug, roster_id)
);
alter table salary_retention enable row level security;
drop policy if exists salary_retention_read on salary_retention;
create policy salary_retention_read on salary_retention for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());

create table if not exists dead_money (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  slug       text not null,
  amount     int  not null check (amount >= 1),
  years_left int  not null check (years_left >= 1),  -- seasons still charged, this one included
  note       text,
  created_at timestamptz not null default now()
);
alter table dead_money enable row level security;
drop policy if exists dead_money_read on dead_money;
create policy dead_money_read on dead_money for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());
create index if not exists dead_money_league_roster on dead_money (league_id, roster_id);

alter table league_membership add column if not exists cap_adjust int not null default 0;
alter table trade_proposal add column if not exists retain jsonb;
alter table trade_proposal add column if not exists cap_dollars int;

-- ── The settings, one helper each (defaults are the rules until the
-- commissioner says otherwise) ───────────────────────────────────────────────
create or replace function contract_dead_pct(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'contract_dead_pct', '')::int, 30) from league where id = p_league_id;
$$;
create or replace function salary_retention_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'salary_retention')::boolean, true) from league where id = p_league_id;
$$;
create or replace function cap_trading_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'cap_trading')::boolean, false) from league where id = p_league_id;
$$;
create or replace function ir_cap_relief_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'ir_cap_relief')::boolean, false) from league where id = p_league_id;
$$;
create or replace function tag_raise_pct(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'tag_raise_pct', '')::int, 20) from league where id = p_league_id;
$$;
create or replace function ext_discount_pct(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'ext_discount_pct', '')::int, 85) from league where id = p_league_id;
$$;
create or replace function rfa_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'rfa_ok')::boolean, true) from league where id = p_league_id;
$$;

-- ── The league's own market pricer ───────────────────────────────────────────
-- What the position's top of market earns HERE: the average of the five
-- biggest salaries at his position in this league, floor $1. Feeds the
-- franchise tag and extensions (0220) and the cap sheet's value read.
create or replace function contract_market_value(p_league_id uuid, p_slug text) returns int
  language sql stable security definer set search_path = public as $$
  select greatest(1, coalesce((
    select ceil(avg(s.salary))::int from (
      select c.salary from contract c
      join league_pool lp on lp.league_id = c.league_id and lp.slug = c.slug
      where c.league_id = p_league_id
        and lp.pos = (select pos from league_pool where league_id = p_league_id and slug = p_slug)
      order by c.salary desc limit 5
    ) s), 1));
$$;

-- ── team_payroll v3: the whole ledger ────────────────────────────────────────
create or replace function team_payroll(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select
    -- deals held: salary minus what former teams retained; IR'd deals come
    -- off the books when the relief rule is on
    coalesce((select sum(greatest(1, c.salary - coalesce((
          select sum(sr.amount) from salary_retention sr
          where sr.league_id = c.league_id and sr.slug = c.slug), 0)))
      from contract c
      left join native_roster nr on nr.league_id = c.league_id and nr.slug = c.slug
      where c.league_id = p_league_id and c.roster_id = p_roster_id
        and not (ir_cap_relief_on(p_league_id) and coalesce(nr.spot, 'active') = 'ir')), 0)::int
    -- ghosts: salary you retained on players you sent away
    + coalesce((select sum(amount) from salary_retention
        where league_id = p_league_id and roster_id = p_roster_id), 0)::int
    -- dead money from cuts (0220 writes it; rollover decrements it)
    + coalesce((select sum(amount) from dead_money
        where league_id = p_league_id and roster_id = p_roster_id), 0)::int;
$$;

-- ── team_cap: the league cap plus traded room ────────────────────────────────
create or replace function team_cap(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(league_salary_cap(p_league_id), 0)
       + coalesce((select cap_adjust from league_membership
           where league_id = p_league_id and sleeper_roster_id = p_roster_id), 0);
$$;

-- ── The cap check judges against the TEAM's cap, once the room closes ────────
create or replace function _contract_cap_check() returns trigger
  language plpgsql security definer set search_path = public as $$
declare cap int; pay int; nm text;
begin
  if not contracts_on(new.league_id) then return null; end if;
  -- While the draft room runs, the seat budget is the discipline (a rolled
  -- contract league's seats start pre-docked); the cap takes over at close.
  if coalesce((select status from draft where league_id = new.league_id), '') <> 'complete' then
    return null;
  end if;
  cap := team_cap(new.league_id, new.roster_id);
  pay := team_payroll(new.league_id, new.roster_id);
  if pay > cap then
    select team_name into nm from league_membership
      where league_id = new.league_id and sleeper_roster_id = new.roster_id;
    raise exception 'salary cap exceeded — % at $% of $%', coalesce(nm, 'team ' || new.roster_id), pay, cap;
  end if;
  return null;
end $$;

-- ── set_salary_rules: the 📜 SALARY section's engine ─────────────────────────
-- Nulls leave a knob alone; every non-null lands. Commissioner only; the cap
-- itself stays on set_contract_rules (its budget gate is draft-aware).
create or replace function set_salary_rules(
  p_league_id uuid,
  p_dead_pct int default null,
  p_retention boolean default null,
  p_cap_trading boolean default null,
  p_ir_relief boolean default null,
  p_tag_raise_pct int default null,
  p_ext_discount_pct int default null,
  p_rfa boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare patch jsonb := '{}'::jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not contracts_on(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'turn contracts on first — these rules hang off the cap');
  end if;
  if p_dead_pct is not null then
    if p_dead_pct < 0 or p_dead_pct > 100 then
      return jsonb_build_object('ok', false, 'error', 'dead money must be 0–100% of salary');
    end if;
    patch := patch || jsonb_build_object('contract_dead_pct', p_dead_pct);
  end if;
  if p_tag_raise_pct is not null then
    if p_tag_raise_pct < 0 or p_tag_raise_pct > 100 then
      return jsonb_build_object('ok', false, 'error', 'tag raise must be 0–100%');
    end if;
    patch := patch || jsonb_build_object('tag_raise_pct', p_tag_raise_pct);
  end if;
  if p_ext_discount_pct is not null then
    if p_ext_discount_pct < 50 or p_ext_discount_pct > 100 then
      return jsonb_build_object('ok', false, 'error', 'extension discount must be 50–100% of market');
    end if;
    patch := patch || jsonb_build_object('ext_discount_pct', p_ext_discount_pct);
  end if;
  if p_retention is not null then patch := patch || jsonb_build_object('salary_retention', p_retention); end if;
  if p_cap_trading is not null then patch := patch || jsonb_build_object('cap_trading', p_cap_trading); end if;
  if p_ir_relief is not null then patch := patch || jsonb_build_object('ir_cap_relief', p_ir_relief); end if;
  if p_rfa is not null then patch := patch || jsonb_build_object('rfa_ok', p_rfa); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || patch where id = p_league_id;
  return jsonb_build_object('ok', true,
    'dead_pct', contract_dead_pct(p_league_id),
    'retention', salary_retention_on(p_league_id),
    'cap_trading', cap_trading_on(p_league_id),
    'ir_relief', ir_cap_relief_on(p_league_id),
    'tag_raise_pct', tag_raise_pct(p_league_id),
    'ext_discount_pct', ext_discount_pct(p_league_id),
    'rfa', rfa_on(p_league_id));
end $$;
grant execute on function set_salary_rules(uuid, int, boolean, boolean, boolean, int, int, boolean) to authenticated;

-- ── Trades carry retention and cap dollars (0190 bodies, patched) ────────────
-- The 0175 overload lesson: the 8-param signature must go before the 10-param
-- one exists, or every 8-arg call becomes ambiguous.
drop function if exists propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb);
create or replace function propose_trade(
  p_league_id uuid, p_from_roster int, p_to_roster int,
  p_give jsonb, p_get jsonb, p_note text default null,
  p_give_picks jsonb default null, p_get_picks jsonb default null,
  p_retain jsonb default null, p_cap_dollars int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; gp jsonb; tp jsonb; err text; el jsonb;
        rt jsonb := '[]'::jsonb; rslug text; ramt int; rtr int; c contract%rowtype; already int;
begin
  if not (owns_roster(p_league_id, p_from_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_from_roster = p_to_roster
     or not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'pick another team to trade with');
  end if;
  begin
    gp := _clean_trade_picks(p_league_id, p_give_picks);
    tp := _clean_trade_picks(p_league_id, p_get_picks);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  -- The commissioner's switch, checked once for both halves.
  if (jsonb_array_length(gp) > 0 or jsonb_array_length(tp) > 0)
     and not league_pick_trading(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the commissioner has pick trading turned off');
  end if;
  if jsonb_typeof(p_give) <> 'array' or jsonb_typeof(p_get) <> 'array'
     or jsonb_array_length(p_give) > 10 or jsonb_array_length(p_get) > 10
     or jsonb_array_length(gp) > 10 or jsonb_array_length(tp) > 10
     or (jsonb_array_length(p_give) + jsonb_array_length(p_get)
      + jsonb_array_length(gp) + jsonb_array_length(tp) < 1 and coalesce(p_cap_dollars, 0) = 0) then
    return jsonb_build_object('ok', false, 'error', 'a trade moves 1–10 players or picks each way');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_give || p_get))
     <> jsonb_array_length(p_give) + jsonb_array_length(p_get) then
    return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
  end if;
  if (select count(distinct value) from jsonb_array_elements(gp || tp))
     <> jsonb_array_length(gp) + jsonb_array_length(tp) then
    return jsonb_build_object('ok', false, 'error', 'a pick can only appear once');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_from_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only offer your own players');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only ask for their players');
  end if;
  err := _pick_ownership_error(p_league_id, p_from_roster, gp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only offer picks you own — ' || err); end if;
  err := _pick_ownership_error(p_league_id, p_to_roster, tp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only ask for picks they own — ' || err); end if;
  -- MID-DRAFT: a pick already used is a player now, and the pick on the clock
  -- is being spent as we speak. Neither is a thing to put in an offer.
  for el in select * from jsonb_array_elements(gp || tp) loop
    err := _pick_locked_error(p_league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end loop;
  -- Salary retention (0219): the sender eats part of a traded deal. Each term
  -- names a player IN the trade; the retainer is whichever side holds him now.
  if p_retain is not null and jsonb_array_length(coalesce(p_retain, '[]'::jsonb)) > 0 then
    if not contracts_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'salary retention needs a contract league');
    end if;
    if not salary_retention_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the commissioner has salary retention turned off');
    end if;
    for el in select * from jsonb_array_elements(p_retain) loop
      rslug := el ->> 'slug'; ramt := coalesce((el ->> 'amount')::int, 0);
      if p_give ? rslug then rtr := p_from_roster;
      elsif p_get ? rslug then rtr := p_to_roster;
      else return jsonb_build_object('ok', false, 'error', 'retention only applies to players in this trade');
      end if;
      select * into c from contract where league_id = p_league_id and slug = rslug;
      if not found then return jsonb_build_object('ok', false, 'error', 'no contract to retain on ' || rslug); end if;
      select coalesce(sum(amount), 0) into already from salary_retention
        where league_id = p_league_id and slug = rslug;
      if ramt < 1 or already + ramt > c.salary - 1 then
        return jsonb_build_object('ok', false, 'error',
          'retention on ' || rslug || ' must be $1–$' || (c.salary - 1 - already) || ' — the receiver pays at least $1');
      end if;
      rt := rt || jsonb_build_object('slug', rslug, 'amount', ramt, 'roster', rtr);
    end loop;
  end if;
  -- Raw cap-space trading (0219): dollars as an asset. Positive = the proposer
  -- sends cap room; negative asks for it. Behind the commissioner's switch.
  if coalesce(p_cap_dollars, 0) <> 0 then
    if not contracts_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'cap-space trading needs a contract league');
    end if;
    if not cap_trading_on(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'the commissioner has cap-space trading turned off');
    end if;
    if abs(p_cap_dollars) > 100000 then
      return jsonb_build_object('ok', false, 'error', 'cap dollars must be within $100000');
    end if;
  end if;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, give_picks, get_picks, note, created_by, retain, cap_dollars)
    values (p_league_id, p_from_roster, p_to_roster, p_give, p_get, gp, tp,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
            case when jsonb_array_length(rt) > 0 then rt else null end, nullif(coalesce(p_cap_dollars, 0), 0))
    returning id into tid;
  return jsonb_build_object('ok', true, 'trade_id', tid);
end $$;
grant execute on function propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb, jsonb, int) to authenticated;

create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; d draft%rowtype; err text; el jsonb; lseas text; ov int; knd text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug))
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
  end if;
  if _pick_ownership_error(t.league_id, t.from_roster, t.give_picks) is not null
     or _pick_ownership_error(t.league_id, t.to_roster, t.get_picks) is not null then
    return jsonb_build_object('ok', false, 'error', 'picks moved since the deal was struck — re-propose');
  end if;
  -- Re-checked at EXECUTE, not just at propose: an offer made three picks ago
  -- can be accepted after the clock has passed the very pick it moves.
  for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
    err := _pick_locked_error(t.league_id, el ->> 'season', (el ->> 'round')::int, (el ->> 'orig')::int);
    if err is not null then return jsonb_build_object('ok', false, 'error', err || ' — re-propose'); end if;
  end loop;
  err := coalesce(trade_cap_error(t.league_id, t.from_roster, t.give, t.get),
                  trade_cap_error(t.league_id, t.to_roster, t.get, t.give));
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  update native_roster nr set roster_id = t.to_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.from_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.give));
  update native_roster nr set roster_id = t.from_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.to_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.get));
  for el in select * from jsonb_array_elements(t.give_picks) loop
    update pick_asset set owner_roster = t.to_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;
  for el in select * from jsonb_array_elements(t.get_picks) loop
    update pick_asset set owner_roster = t.from_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;

  -- Keep the running draft's own copy in step.
  select * into d from draft where league_id = t.league_id;
  select season into lseas from league where id = t.league_id;
  if d.pick_owners is not null then
    for el in select * from jsonb_array_elements(coalesce(t.give_picks, '[]'::jsonb) || coalesce(t.get_picks, '[]'::jsonb)) loop
      if (el ->> 'season') = lseas then
        select kind into knd from pick_asset where league_id = t.league_id
          and season = el ->> 'season' and round = (el ->> 'round')::int
          and original_roster = (el ->> 'orig')::int;
        ov := _pick_overall(t.league_id, (el ->> 'round')::int, (el ->> 'orig')::int,
                            coalesce(knd, 'startup') = 'startup');
        if ov is not null and ov >= 1 and ov <= jsonb_array_length(d.pick_owners) then
          d.pick_owners := jsonb_set(d.pick_owners, array[(ov - 1)::text],
            to_jsonb((select owner_roster from pick_asset where league_id = t.league_id
                      and season = el ->> 'season' and round = (el ->> 'round')::int
                      and original_roster = (el ->> 'orig')::int)));
        end if;
      end if;
    end loop;
    update draft set pick_owners = d.pick_owners where league_id = t.league_id;
  end if;

  -- Retention lands as ghost lines on the retainer's books (0219).
  for el in select * from jsonb_array_elements(coalesce(t.retain, '[]'::jsonb)) loop
    insert into salary_retention (league_id, slug, roster_id, amount)
      values (t.league_id, el ->> 'slug', (el ->> 'roster')::int, (el ->> 'amount')::int)
      on conflict (league_id, slug, roster_id) do update
        set amount = salary_retention.amount + excluded.amount;
  end loop;
  -- Cap dollars move like a pick (0219). Judged immediately below, so a pure
  -- cash deal cannot slip past the contract trigger (which only watches
  -- contract rows).
  if coalesce(t.cap_dollars, 0) <> 0 then
    update league_membership set cap_adjust = cap_adjust - t.cap_dollars
      where league_id = t.league_id and sleeper_roster_id = t.from_roster;
    update league_membership set cap_adjust = cap_adjust + t.cap_dollars
      where league_id = t.league_id and sleeper_roster_id = t.to_roster;
  end if;
  if contracts_on(t.league_id) then
    if team_payroll(t.league_id, t.from_roster) > team_cap(t.league_id, t.from_roster) then
      raise exception 'salary cap exceeded — team % at $% of $%', t.from_roster,
        team_payroll(t.league_id, t.from_roster), team_cap(t.league_id, t.from_roster);
    end if;
    if team_payroll(t.league_id, t.to_roster) > team_cap(t.league_id, t.to_roster) then
      raise exception 'salary cap exceeded — team % at $% of $%', t.to_roster,
        team_payroll(t.league_id, t.to_roster), team_cap(t.league_id, t.to_roster);
    end if;
  end if;
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;

-- _start_draft_now v-next: 0193's CURRENT body (0190's was already superseded
-- by 0192/0193 — the lineage check caught it), plus the payroll pre-dock.
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int; snake_kind boolean;
  pool_n int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  if d.rounds - d.keeper_slots - d.stash_slots < 1 then
    return jsonb_build_object('ok', false, 'error',
      'no rounds left to draft — keepers and IR spots fill the whole roster');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v.x) from (select (jsonb_array_elements_text(p_order))::int as x) v
        where v.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v
           where v.x = any(ids)) = n
    then
      ord := d.draft_order; preset := true;
    else
      select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
    end if;
  end if;

  -- Owned picks: this league's own season carries assets ⇒ an explicit
  -- per-overall owner list, each pick owned by its asset's holder.
  --
  -- WHICH WAY THE ROUNDS RUN IS THE ASSET'S KIND (0190). A ROOKIE pick means
  -- "round 3, Team X's slot", so its draft runs LINEAR — 0183's rule, and its
  -- reasoning: snaking would relabel that pick every other round. A STARTUP
  -- pick is a slot in a snake that managers already know the shape of, so its
  -- draft snakes. With every asset still at its original owner, the startup
  -- walk below reproduces the plain snake order EXACTLY, which is what lets a
  -- league turn pick trading on without changing how it drafts.
  select season into lseas from league where id = p_league_id;
  if d.mode = 'snake' and exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = lseas) then
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas;
    owners := '[]'::jsonb;
    for r in 1..maxr loop
      for i in 0..(n - 1) loop
        -- even rounds reverse, but only for a startup draft
        orig := (ord ->> (case when coalesce(snake_kind, false) and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots - d.stash_slots) * n;
  end if;

  -- THE POOL HAS TO FILL THE DRAFT — the check that was already doing the work
  -- the round cap got the credit for. What changes in 0192 is that it SAYS THE
  -- NUMBERS: at 25 rounds "pool smaller than the draft" was a nudge, at 99 it
  -- has to tell you whether to trim one round or forty.
  select count(*) into pool_n from league_pool lp
    where lp.league_id = p_league_id
      and not exists (select 1 from native_roster nr
                      where nr.league_id = lp.league_id and nr.slug = lp.slug);
  if pool_n < total_picks then
    return jsonb_build_object('ok', false, 'error',
      format('pool smaller than the draft — it needs %s picks (%s rounds x %s teams) and the pool holds %s players; lower the roster size or re-seed a bigger pool',
             total_picks, d.rounds - d.keeper_slots - d.stash_slots, n, pool_n));
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership m set draft_budget = case
      -- a contract league's carried payroll (rolled-over deals, dead money)
      -- already spent part of this seat's money — the room only gets the rest
      when contracts_on(p_league_id)
        then greatest(1, d.budget - team_payroll(p_league_id, m.sleeper_roster_id))
      else d.budget end
    where m.league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null);
end $$;
