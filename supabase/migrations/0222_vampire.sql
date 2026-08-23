-- 0222 — 🧛 VAMPIRE LEAGUES + the register keeps the WHY.
--
-- THE FORMAT. One seat is the Vampire: it cannot sign from the street or the
-- wire (0221's seat guard enforces that at the roster door), and instead,
-- when it WINS a head-to-head week, it steals one player from the defeated
-- team's active roster — giving one of its own back, one steal per win,
-- while the win is fresh (only the latest completed week counts). Trades
-- stay legal for everyone; the vampire's whole game is winning.
--
-- THE COMMISSIONER'S HAND (the founder: "commish can option to approve risky
-- moves"). settings_json.steal_review = the trade_review pattern applied to
-- steals: ON means a steal lands as a PENDING claim the commissioner rules
-- on (commish_rule_steal approves or vetoes); OFF executes immediately. The
-- ruling, either way, is one register row — as is the steal itself ('steal'
-- kind, taught to the roster trigger in 0221).
--
-- Also here: the 0220 front-office tools re-created with register rows —
-- tags, extensions, RFA resolutions, retained salary and traded cap dollars
-- all print in the league register now, which closes the founder's "capture
-- major automated league movements, waiver actions, and commish actions".
-- (Waiver wins already print with their bid; eliminations and releases came
-- with 0221.)

-- 'steal' joins the acquisition vocabulary (the register and the contract
-- triggers already read `acquired`; the check just hadn't met a vampire).
alter table native_roster drop constraint if exists native_roster_acquired_check;
alter table native_roster add constraint native_roster_acquired_check
  check (acquired in ('draft', 'waiver', 'fa', 'commish', 'trade', 'keeper', 'steal'));

create table if not exists vampire_steal (
  id           bigint generated always as identity primary key,
  league_id    uuid not null references league(id) on delete cascade,
  week         int  not null,
  vampire      int  not null,
  victim       int  not null,
  take_slug    text not null,
  give_slug    text not null,
  status       text not null default 'pending' check (status in ('pending', 'executed', 'vetoed')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
alter table vampire_steal enable row level security;
drop policy if exists vampire_steal_read on vampire_steal;
create policy vampire_steal_read on vampire_steal for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());
create unique index if not exists vampire_steal_one_per_week
  on vampire_steal (league_id, week) where status in ('pending', 'executed');

-- ── The seat and the switch ──────────────────────────────────────────────────
create or replace function vampire_seat(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select nullif(settings_json ->> 'vampire_roster', '')::int from league where id = p_league_id;
$$;
create or replace function steal_review_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'steal_review')::boolean, false) from league where id = p_league_id;
$$;

create or replace function set_vampire(p_league_id uuid, p_roster_id int, p_steal_review boolean default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_format(p_league_id) <> 'vampire' then
    return jsonb_build_object('ok', false, 'error', 'set the league format to vampire first');
  end if;
  if p_roster_id is not null and not exists (select 1 from league_membership
      where league_id = p_league_id and sleeper_roster_id = p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'no such seat');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_roster_id is null then '{}'::jsonb
              else jsonb_build_object('vampire_roster', p_roster_id) end
      || case when p_steal_review is null then '{}'::jsonb
              else jsonb_build_object('steal_review', p_steal_review) end
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'vampire', vampire_seat(p_league_id),
    'steal_review', steal_review_on(p_league_id));
end $$;
grant execute on function set_vampire(uuid, int, boolean) to authenticated;

-- ── The steal ────────────────────────────────────────────────────────────────
-- Internal executor: the 1-for-1 swap, seat-legality checked both ways with
-- the same roster-shape rule trades use, logged as 'steal' by the trigger.
create or replace function _execute_steal(p_id bigint)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare s vampire_steal%rowtype; err text;
begin
  select * into s from vampire_steal where id = p_id;
  if not found or s.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'no pending steal');
  end if;
  if not exists (select 1 from native_roster where league_id = s.league_id and roster_id = s.victim and slug = s.take_slug)
     or not exists (select 1 from native_roster where league_id = s.league_id and roster_id = s.vampire and slug = s.give_slug) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the steal was declared — declare it again');
  end if;
  err := coalesce(trade_cap_error(s.league_id, s.vampire, jsonb_build_array(s.give_slug), jsonb_build_array(s.take_slug)),
                  trade_cap_error(s.league_id, s.victim, jsonb_build_array(s.take_slug), jsonb_build_array(s.give_slug)));
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  update native_roster set roster_id = s.vampire, acquired = 'steal'
    where league_id = s.league_id and slug = s.take_slug;
  update native_roster set roster_id = s.victim, acquired = 'steal'
    where league_id = s.league_id and slug = s.give_slug;
  update vampire_steal set status = 'executed', resolved_at = now() where id = p_id;
  perform native_materialize(s.league_id);
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;

-- The vampire declares. Validates the fresh win, the victim, the pieces; then
-- either executes or parks for the commissioner's ruling (steal_review).
create or replace function vampire_steal(p_league_id uuid, p_take_slug text, p_give_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare vamp int; wk int; mu matchup%rowtype; victim int; won boolean; sid bigint; r jsonb;
begin
  vamp := vampire_seat(p_league_id);
  if league_format(p_league_id) <> 'vampire' or vamp is null then
    return jsonb_build_object('ok', false, 'error', 'no vampire in this league');
  end if;
  if not (owns_roster(p_league_id, vamp) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the vampire feeds');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':steal'));
  -- the LATEST fully-final week is the only fresh win
  select max(week) into wk from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if wk is null then return jsonb_build_object('ok', false, 'error', 'no completed week yet'); end if;
  select * into mu from matchup
    where league_id = p_league_id and week = wk
      and vamp in (home_roster_id, away_roster_id) limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'the vampire had no matchup in week ' || wk); end if;
  won := case when mu.home_roster_id = vamp then mu.home_final > mu.away_final
              else mu.away_final > mu.home_final end;
  if not won then return jsonb_build_object('ok', false, 'error', 'no fresh blood — the vampire lost week ' || wk); end if;
  victim := case when mu.home_roster_id = vamp then mu.away_roster_id else mu.home_roster_id end;
  if exists (select 1 from vampire_steal
      where league_id = p_league_id and week = wk and status in ('pending', 'executed')) then
    return jsonb_build_object('ok', false, 'error', 'one steal per win — week ' || wk || ' is already fed on');
  end if;
  if not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = victim and slug = p_take_slug
        and coalesce(spot, 'active') = 'active') then
    return jsonb_build_object('ok', false, 'error', 'steal from the beaten team''s active roster');
  end if;
  if not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = vamp and slug = p_give_slug) then
    return jsonb_build_object('ok', false, 'error', 'give back one of your own');
  end if;
  insert into vampire_steal (league_id, week, vampire, victim, take_slug, give_slug)
    values (p_league_id, wk, vamp, victim, p_take_slug, p_give_slug)
    returning id into sid;
  if steal_review_on(p_league_id) then
    return jsonb_build_object('ok', true, 'status', 'pending', 'week', wk,
      'note', 'awaiting the commissioner''s ruling');
  end if;
  r := _execute_steal(sid);
  if not coalesce((r ->> 'ok')::boolean, false) then
    delete from vampire_steal where id = sid;   -- a refused immediate steal never happened
    return r;
  end if;
  return r || jsonb_build_object('week', wk);
end $$;
grant execute on function vampire_steal(uuid, text, text) to authenticated;

-- The ruling (steal_review): approve executes, veto voids. One register row
-- either way — the league sees the commissioner acted.
create or replace function commish_rule_steal(p_league_id uuid, p_steal_id bigint, p_approve boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare s vampire_steal%rowtype; r jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into s from vampire_steal where id = p_steal_id and league_id = p_league_id;
  if not found or s.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'no pending steal');
  end if;
  if not p_approve then
    update vampire_steal set status = 'vetoed', resolved_at = now() where id = p_steal_id;
    insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
    values (p_league_id, 'commish', s.vampire, s.take_slug, s.victim, 'steal vetoed');
    return jsonb_build_object('ok', true, 'status', 'vetoed');
  end if;
  r := _execute_steal(p_steal_id);
  return r;
end $$;
grant execute on function commish_rule_steal(uuid, bigint, boolean) to authenticated;

-- ── The vampire's window, for the UI ─────────────────────────────────────────
create or replace function vampire_state(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare vamp int; wk int; mu matchup%rowtype; victim int; won boolean := false;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if league_format(p_league_id) <> 'vampire' then return jsonb_build_object('vampire', false); end if;
  vamp := vampire_seat(p_league_id);
  select max(week) into wk from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if vamp is not null and wk is not null then
    select * into mu from matchup
      where league_id = p_league_id and week = wk
        and vamp in (home_roster_id, away_roster_id) limit 1;
    if found then
      won := case when mu.home_roster_id = vamp then mu.home_final > mu.away_final
                  else mu.away_final > mu.home_final end;
      victim := case when mu.home_roster_id = vamp then mu.away_roster_id else mu.home_roster_id end;
    end if;
  end if;
  return jsonb_build_object(
    'vampire', true,
    'seat', vamp,
    'steal_review', steal_review_on(p_league_id),
    'week', wk,
    'won', won,
    'victim', case when won then victim end,
    'fed', wk is not null and exists (select 1 from vampire_steal
      where league_id = p_league_id and week = wk and status in ('pending', 'executed')),
    'steals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'week', v.week, 'victim', v.victim, 'take', v.take_slug,
        'give', v.give_slug, 'status', v.status) order by v.week desc)
      from vampire_steal v where v.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function vampire_state(uuid) to authenticated;

-- ── The 0220 tools, re-created with their register rows ──────────────────────
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
  -- the register keeps the money terms (0222): who eats what, and cap moved
  for el in select * from jsonb_array_elements(coalesce(t.retain, '[]'::jsonb)) loop
    insert into league_txn (league_id, kind, roster_id, slug, note)
    values (t.league_id, 'retained', (el ->> 'roster')::int, el ->> 'slug',
            '$' || (el ->> 'amount') || ' retained in trade');
  end loop;
  if coalesce(t.cap_dollars, 0) <> 0 then
    insert into league_txn (league_id, kind, roster_id, slug, from_roster, note)
    values (t.league_id, 'cap',
            case when t.cap_dollars > 0 then t.to_roster else t.from_roster end, '',
            case when t.cap_dollars > 0 then t.from_roster else t.to_roster end,
            '$' || abs(t.cap_dollars) || ' of cap room traded');
  end if;
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;

create or replace function franchise_tag(p_league_id uuid, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; err text; price int;
begin
  err := _offseason_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select * into c from contract where league_id = p_league_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'no contract for that player'); end if;
  if not (owns_roster(p_league_id, c.roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your player');
  end if;
  if c.years > 1 then return jsonb_build_object('ok', false, 'error', 'the tag is for expiring deals — this one has years left'); end if;
  if c.tagged then return jsonb_build_object('ok', false, 'error', 'already tagged'); end if;
  if exists (select 1 from contract where league_id = p_league_id and roster_id = c.roster_id and tagged) then
    return jsonb_build_object('ok', false, 'error', 'one tag per team per offseason');
  end if;
  price := greatest(contract_market_value(p_league_id, p_slug),
                    ceil(c.salary * (100 + tag_raise_pct(p_league_id)) / 100.0)::int);
  update contract set salary = price, tagged = true
    where league_id = p_league_id and slug = p_slug;
  insert into league_txn (league_id, kind, roster_id, slug, note)
  values (p_league_id, 'tag', c.roster_id, p_slug, 'franchise tagged — $' || price || ' for 1yr');
  return jsonb_build_object('ok', true, 'slug', p_slug, 'salary', price, 'years', 1, 'tagged', true);
end $$;

create or replace function extend_contract(p_league_id uuid, p_slug text, p_years int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; err text; price int;
begin
  err := _offseason_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if p_years is null or p_years < 1 or p_years > 3 then
    return jsonb_build_object('ok', false, 'error', 'extensions run 1–3 years');
  end if;
  select * into c from contract where league_id = p_league_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'no contract for that player'); end if;
  if not (owns_roster(p_league_id, c.roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your player');
  end if;
  if c.years > 1 then return jsonb_build_object('ok', false, 'error', 'extensions are for expiring deals — this one has years left'); end if;
  if c.tagged then return jsonb_build_object('ok', false, 'error', 'tagged players play the tag year — no extension on top'); end if;
  if exists (select 1 from rfa_tender where league_id = p_league_id and slug = p_slug and status = 'open') then
    return jsonb_build_object('ok', false, 'error', 'this player is tendered — resolve the RFA first');
  end if;
  price := greatest(1, ceil(contract_market_value(p_league_id, p_slug) * ext_discount_pct(p_league_id) / 100.0)::int);
  update contract set salary = price, years = p_years + 1
    where league_id = p_league_id and slug = p_slug;
  insert into league_txn (league_id, kind, roster_id, slug, note)
  values (p_league_id, 'extension', c.roster_id, p_slug,
          'extended — $' || price || ' for ' || p_years || 'yr at ' || ext_discount_pct(p_league_id) || '% of market');
  return jsonb_build_object('ok', true, 'slug', p_slug, 'salary', price, 'years', p_years,
    'note', 'carries ' || p_years || 'yr into next season');
end $$;

create or replace function rfa_resolve(p_league_id uuid, p_slug text, p_match boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t rfa_tender%rowtype; err text;
begin
  err := _offseason_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select * into t from rfa_tender where league_id = p_league_id and slug = p_slug;
  if not found or t.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'no open tender on that player');
  end if;
  if not (owns_roster(p_league_id, t.roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your tender');
  end if;
  if t.offer_roster is null then
    return jsonb_build_object('ok', false, 'error', 'no offer to answer — withdraw by letting the tender lapse at rollover');
  end if;
  -- Either way the deal re-prices at the offer, stored years+1 so the
  -- rollover lands it at the offered length.
  update contract set salary = t.offer_salary, years = t.offer_years + 1
    where league_id = p_league_id and slug = p_slug;
  if p_match then
    update rfa_tender set status = 'matched' where league_id = p_league_id and slug = p_slug;
    insert into league_txn (league_id, kind, roster_id, slug, note)
    values (p_league_id, 'rfa', t.roster_id, p_slug,
            'RFA matched — $' || t.offer_salary || ' for ' || t.offer_years || 'yr');
    return jsonb_build_object('ok', true, 'status', 'matched', 'salary', t.offer_salary, 'years', t.offer_years);
  end if;
  -- the movement leg logs through the roster trigger; this row keeps the WHY
  perform set_config('app.txn_kind', 'rfa', true);
  perform set_config('app.txn_note', 'RFA walked — $' || t.offer_salary || ' for ' || t.offer_years || 'yr', true);
  update native_roster set roster_id = t.offer_roster
    where league_id = p_league_id and slug = p_slug;
  perform set_config('app.txn_kind', '', true);
  perform set_config('app.txn_note', '', true);
  update rfa_tender set status = 'walked' where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'status', 'walked', 'to_roster', t.offer_roster,
    'salary', t.offer_salary, 'years', t.offer_years);
end $$;
