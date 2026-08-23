-- 0217 — CONTRACTS v1: salary-cap leagues (founder's spec, 2026-08-23).
--
-- A contract is (salary, years) on a rostered player. The founder's rules,
-- and where each lands:
--   · auction bid = the exact salary; the winner assigns a length      → HERE
--   · rookie drafts run LINEAR on a fixed salary scale by round        → HERE
--   · waiver claim = 1yr at the FAAB bid; FA add = 1yr at the $1 min   → HERE
--   · trades carry the contract; the receiver must fit it under cap    → HERE
--   · extensions (85% of market), franchise tags, dead money on cuts   → v2,
--     with the season rollover — all OFFSEASON mechanics, and the
--     rollover_league gate (post-Super-Bowl) means nothing can roll before
--     the offseason pack lands. v1 plays a full season under the cap.
--
-- HOW IT HOOKS IN — triggers, not function re-creates. Every acquisition path
-- already writes native_roster with an `acquired` tag (draft/waiver/fa/
-- commish), and trades UPDATE roster_id in place (0072). Contracts derive
-- from those writes: an insert originates a deal, a move re-homes it, a
-- delete releases it, and a DEFERRED constraint trigger holds every touched
-- team under the cap at commit — deferred because a 2-for-1 trade is
-- transiently over-cap between its two updates and must be judged as a whole.
-- The 0216 lesson applies: this file re-creates NO existing function, so no
-- lineage can be clobbered.
--
-- The cap does NOT police the startup draft ('draft' rows skip the check):
-- the auction budget is the startup discipline, and set_contract_rules
-- refuses a cap smaller than the budget so the two can never disagree.

create table if not exists contract (
  league_id    uuid not null references league(id) on delete cascade,
  slug         text not null,
  roster_id    int  not null,
  salary       int  not null check (salary >= 1),
  years        int  not null check (years between 1 and 9),
  acquired     text not null check (acquired in ('auction', 'rookie', 'draft', 'waiver', 'fa', 'commish')),
  start_season text not null,
  created_at   timestamptz not null default now(),
  primary key (league_id, slug)
);
create index if not exists contract_roster on contract(league_id, roster_id);

alter table contract enable row level security;
drop policy if exists contract_member_read on contract;
create policy contract_member_read on contract for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());
-- writes only through the triggers/RPCs below (security definer)

/** Contracts are ON when the league carries a salary_cap. */
create or replace function contracts_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'salary_cap') is not null, false) from league where id = p_league_id;
$$;
create or replace function league_salary_cap(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select nullif(settings_json ->> 'salary_cap', '')::int from league where id = p_league_id;
$$;
create or replace function contract_years_max(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(settings_json ->> 'contract_years_max', '')::int, 4) from league where id = p_league_id;
$$;
create or replace function team_payroll(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(sum(salary), 0)::int from contract
  where league_id = p_league_id and roster_id = p_roster_id;
$$;

/** The v1 rookie/startup scale, by round: $12 / $6 / $3 / $1. Deliberately a
 *  function so a later release can make it a league setting without touching
 *  the trigger that calls it. */
create or replace function contract_rookie_scale(p_round int) returns int
  language sql immutable as $$
  select case when p_round <= 1 then 12 when p_round = 2 then 6 when p_round = 3 then 3 else 1 end;
$$;

-- ── Origination: a roster insert becomes a deal ──────────────────────────────
create or replace function _contract_originate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare sal int; yrs int := 1; how text; pk record; seas text; d draft%rowtype;
begin
  if not contracts_on(new.league_id) then return new; end if;
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
      -- a pick-owner (rookie) draft deals 3-year scale contracts; a plain
      -- startup snake/linear deals 1-year scale deals the manager may extend
      -- into multi-year via set_contract_years while the room is open
      how := case when d.pick_owners is not null then 'rookie' else 'draft' end;
      if how = 'rookie' then yrs := least(3, contract_years_max(new.league_id)); end if;
    end if;
  elsif new.acquired = 'waiver' then
    -- process_waivers inserts the roster row BEFORE flipping the claim to
    -- 'won' (0199 order), so the claim being executed is still 'pending'
    -- here — accept either state, newest first.
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
    set roster_id = excluded.roster_id;   -- re-add of a cut player: keep terms? No — a fresh row was deleted on cut; conflict = same-txn churn, keep the standing deal's home current
  return new;
end $$;
drop trigger if exists contract_originate on native_roster;
create trigger contract_originate after insert on native_roster
  for each row execute function _contract_originate();

-- ── A trade (or commish move) re-homes the deal, terms intact ────────────────
create or replace function _contract_rehome() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not contracts_on(new.league_id) then return new; end if;
  update contract set roster_id = new.roster_id
    where league_id = new.league_id and slug = new.slug;
  return new;
end $$;
drop trigger if exists contract_rehome on native_roster;
create trigger contract_rehome after update of roster_id on native_roster
  for each row execute function _contract_rehome();

-- ── A cut releases the deal (dead money is the v2 offseason pack) ────────────
create or replace function _contract_release() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  delete from contract where league_id = old.league_id and slug = old.slug;
  return old;
end $$;
drop trigger if exists contract_release on native_roster;
create trigger contract_release after delete on native_roster
  for each row execute function _contract_release();

-- ── THE CAP, judged at commit ────────────────────────────────────────────────
-- Deferred so a multi-player trade is weighed whole. The trigger sits on the
-- CONTRACT table, not native_roster: the contract row is what carries the
-- salary, so by the time this event fires the deal it is judging exists —
-- true in deferred mode at commit AND if constraints are forced immediate.
-- (On native_roster the cap check would fire before _contract_originate had
-- written the deal, and the newest salary would never be counted.)
-- Draft-table rows ('draft'/'rookie'/'auction') are exempt: the auction
-- budget already disciplines the startup (set_contract_rules keeps cap ≥
-- budget while the room is open) and the rookie scale is league law, not a
-- manager's choice.
create or replace function _contract_cap_check() returns trigger
  language plpgsql security definer set search_path = public as $$
declare cap int; pay int; nm text;
begin
  -- the exemption covers the ORIGINATING insert only: a later trade of the
  -- same deal is an UPDATE of roster_id, and the receiver must fit it
  if (tg_op = 'INSERT' and new.acquired in ('draft', 'rookie', 'auction'))
     or not contracts_on(new.league_id) then return null; end if;
  cap := league_salary_cap(new.league_id);
  pay := team_payroll(new.league_id, new.roster_id);
  if pay > cap then
    select team_name into nm from league_membership
      where league_id = new.league_id and sleeper_roster_id = new.roster_id;
    raise exception 'salary cap exceeded — % at $% of $%', coalesce(nm, 'team ' || new.roster_id), pay, cap;
  end if;
  return null;
end $$;
drop trigger if exists contract_cap_check on native_roster;
drop trigger if exists contract_cap_check on contract;
create constraint trigger contract_cap_check
  after insert or update of roster_id, salary on contract
  deferrable initially deferred
  for each row execute function _contract_cap_check();

-- ── Commissioner switches the cap on (or off) ────────────────────────────────
create or replace function set_contract_rules(p_league_id uuid, p_cap int default null, p_years_max int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ym int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if p_cap is null then
    update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'salary_cap') - 'contract_years_max'
      where id = p_league_id;
    return jsonb_build_object('ok', true, 'contracts', false);
  end if;
  if p_cap < 1 or p_cap > 100000 then
    return jsonb_build_object('ok', false, 'error', 'cap must be $1–$100000');
  end if;
  select * into d from draft where league_id = p_league_id;
  -- Only while the startup room could still spend: once the draft is done the
  -- budget is history and the commissioner may tighten the cap below it.
  if found and d.mode = 'auction' and d.status <> 'complete' and p_cap < d.budget then
    return jsonb_build_object('ok', false, 'error', 'cap must be at least the auction budget ($' || d.budget || ') — the startup spend has to fit under it');
  end if;
  ym := coalesce(p_years_max, 4);
  if ym < 1 or ym > 9 then return jsonb_build_object('ok', false, 'error', 'max contract length must be 1–9 years'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('salary_cap', p_cap, 'contract_years_max', ym)
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'contracts', true, 'salary_cap', p_cap, 'contract_years_max', ym);
end $$;
grant execute on function set_contract_rules(uuid, int, int) to authenticated;

-- ── The winner assigns a length (the founder's "manager's choice") ───────────
-- While the draft room is open the OWNING manager sets 1..max years on their
-- own auction/startup deals — that is the assignment prompt, RPC-shaped.
-- After the room closes it becomes a commissioner tool (rookie-scale years
-- are fixed by the scale; only the commish may override those, ever).
create or replace function set_contract_years(p_league_id uuid, p_slug text, p_years int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; d draft%rowtype; is_owner boolean;
begin
  select * into c from contract where league_id = p_league_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'no contract for that player'); end if;
  if p_years is null or p_years < 1 or p_years > contract_years_max(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'length must be 1–' || contract_years_max(p_league_id) || ' years');
  end if;
  select * into d from draft where league_id = p_league_id;
  is_owner := exists (select 1 from league_membership m
    where m.league_id = p_league_id and m.sleeper_roster_id = c.roster_id
      and m.app_user_id = auth.uid() and m.enrolled);
  if is_admin() or is_league_commish(p_league_id) then
    null;  -- the commissioner may always correct a deal
  elsif not is_owner then
    return jsonb_build_object('ok', false, 'error', 'not your contract');
  elsif c.acquired = 'rookie' then
    return jsonb_build_object('ok', false, 'error', 'rookie-scale lengths are fixed by the scale');
  elsif found and d.status = 'complete' then
    return jsonb_build_object('ok', false, 'error', 'lengths lock when the draft room closes — ask your commissioner');
  end if;
  update contract set years = p_years where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'years', p_years);
end $$;
grant execute on function set_contract_years(uuid, text, int) to authenticated;

-- ── The cap sheet — one read for badges, payrolls and room ───────────────────
create or replace function league_contracts(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not contracts_on(p_league_id) then return jsonb_build_object('contracts', false); end if;
  return jsonb_build_object(
    'contracts', true,
    'salary_cap', league_salary_cap(p_league_id),
    'years_max', contract_years_max(p_league_id),
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'roster_id', c.roster_id, 'salary', c.salary,
        'years', c.years, 'acquired', c.acquired) order by c.roster_id, c.salary desc, c.slug)
      from contract c where c.league_id = p_league_id), '[]'::jsonb),
    'payrolls', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'payroll', team_payroll(p_league_id, m.sleeper_roster_id)) order by m.sleeper_roster_id)
      from league_membership m where m.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function league_contracts(uuid) to authenticated;
