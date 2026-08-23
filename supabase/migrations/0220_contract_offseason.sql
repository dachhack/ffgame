-- 0220: THE CONTRACT OFFSEASON — multi-year deals survive the rollover, cuts
-- leave dead money, and the front-office toolkit lands: franchise tags,
-- extensions at a market discount, and RFA tenders with match-or-walk.
--
-- THE KEYSTONE is carriage: until now every deal lived inside one season's
-- league row, so "a 4-year contract" was a promise the rollover didn't keep.
-- rollover_league (patched from its CURRENT 0218 body) now carries live deals
-- at years−1, walks expiring untagged players to the pool, decrements dead
-- money, and brings each retained-salary ghost along with its contract. The
-- next startup room then opens with every seat's budget pre-docked by its
-- carried payroll (_start_draft_now, 0219).
--
-- OFFSEASON TOOLS run on the OLD league between the Super Bowl gate opening
-- and the rollover (admins bypass the gate, as everywhere):
--   • franchise_tag — one per team: an expiring deal re-signs for one year at
--     max(top-5 positional average, salary + raise%).
--   • extend_contract — an expiring deal re-signs for 1–3 years at
--     discount% of the league's own market value. Stored as years+1 so the
--     rollover's decrement lands the deal at exactly the chosen length.
--   • RFA — tender an expiring player; a rival bids salary+years (their cap
--     is checked at bid time); the owner matches (deal re-prices, player
--     stays) or lets him walk (deal re-prices and moves). Unresolved tenders
--     lapse at rollover and the deal expires normally.
--
-- Cuts (any native_roster delete) now write the ledger: each retained-salary
-- ghost converts to dead money for its retainer for the deal's remaining
-- life, and a multi-year cut leaves dead_pct% of the cutter's share on their
-- books for the same span. _contract_originate learns to SKIP 'keeper' rows —
-- carriage writes the real carried deal, not a $1 street contract.

alter table contract add column if not exists tagged boolean not null default false;

create table if not exists rfa_tender (
  league_id    uuid not null references league(id) on delete cascade,
  slug         text not null,
  roster_id    int  not null,            -- the tendering owner
  offer_roster int,                      -- best rival offer so far
  offer_salary int,
  offer_years  int,
  status       text not null default 'open' check (status in ('open', 'matched', 'walked')),
  created_at   timestamptz not null default now(),
  primary key (league_id, slug)
);
alter table rfa_tender enable row level security;
drop policy if exists rfa_tender_read on rfa_tender;
create policy rfa_tender_read on rfa_tender for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());

-- ── Origination v2 (0217 body + the keeper skip) ─────────────────────────────
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
      if how = 'rookie' then yrs := least(3, contract_years_max(new.league_id)); end if;
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

-- ── Release v2: the cut writes the ledger ────────────────────────────────────
create or replace function _contract_release() returns trigger
  language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; ret int := 0; pen int;
begin
  select * into c from contract where league_id = old.league_id and slug = old.slug;
  if found and contracts_on(old.league_id) then
    -- every retained-salary ghost hardens into dead money for its retainer,
    -- for the deal's remaining life — the money was promised either way
    insert into dead_money (league_id, roster_id, slug, amount, years_left, note)
    select sr.league_id, sr.roster_id, sr.slug, sr.amount, greatest(1, c.years),
           'retained salary — the deal was cut'
    from salary_retention sr
    where sr.league_id = old.league_id and sr.slug = old.slug;
    select coalesce(sum(amount), 0) into ret from salary_retention
      where league_id = old.league_id and slug = old.slug;
    delete from salary_retention where league_id = old.league_id and slug = old.slug;
    -- the cutter's penalty: a multi-year deal leaves dead_pct% of their share
    -- on the books for its remaining span (an expiring deal cuts free)
    if c.years > 1 and contract_dead_pct(old.league_id) > 0 then
      pen := ceil(greatest(1, c.salary - ret) * contract_dead_pct(old.league_id) / 100.0)::int;
      if pen >= 1 then
        insert into dead_money (league_id, roster_id, slug, amount, years_left, note)
        values (old.league_id, old.roster_id, old.slug, pen, c.years,
                'cut with ' || c.years || 'yr left');
      end if;
    end if;
  end if;
  delete from contract where league_id = old.league_id and slug = old.slug;
  return old;
end $$;

-- ── The offseason gate, shared by the three tools ────────────────────────────
create or replace function _offseason_error(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when not contracts_on(p_league_id) then 'not a contract league'
    when not (_season_over(p_league_id) or is_admin()) then 'the offseason opens after the Super Bowl'
    when _rollover_target(p_league_id) is not null then 'this season already rolled over'
    else null end;
$$;

-- ── Franchise tag ────────────────────────────────────────────────────────────
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
  return jsonb_build_object('ok', true, 'slug', p_slug, 'salary', price, 'years', 1, 'tagged', true);
end $$;
grant execute on function franchise_tag(uuid, text) to authenticated;

-- ── Extension at the market discount ─────────────────────────────────────────
-- Stored as p_years + 1: the rollover's decrement then lands the deal at
-- exactly the chosen length next season.
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
  return jsonb_build_object('ok', true, 'slug', p_slug, 'salary', price, 'years', p_years,
    'note', 'carries ' || p_years || 'yr into next season');
end $$;
grant execute on function extend_contract(uuid, text, int) to authenticated;

-- ── RFA: tender, bid, match-or-walk ──────────────────────────────────────────
create or replace function rfa_tender(p_league_id uuid, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; err text;
begin
  err := _offseason_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if not rfa_on(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the commissioner has RFA turned off');
  end if;
  select * into c from contract where league_id = p_league_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'no contract for that player'); end if;
  if not (owns_roster(p_league_id, c.roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your player');
  end if;
  if c.years > 1 then return jsonb_build_object('ok', false, 'error', 'tenders are for expiring deals'); end if;
  if c.tagged then return jsonb_build_object('ok', false, 'error', 'tagged players are locked for the tag year'); end if;
  insert into rfa_tender (league_id, slug, roster_id) values (p_league_id, p_slug, c.roster_id)
    on conflict (league_id, slug) do nothing;
  if not found then return jsonb_build_object('ok', false, 'error', 'already tendered'); end if;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'status', 'open');
end $$;
grant execute on function rfa_tender(uuid, text) to authenticated;

create or replace function rfa_bid(p_league_id uuid, p_roster_id int, p_slug text, p_salary int, p_years int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t rfa_tender%rowtype; err text;
begin
  err := _offseason_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if not (owns_roster(p_league_id, p_roster_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  select * into t from rfa_tender where league_id = p_league_id and slug = p_slug;
  if not found or t.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'no open tender on that player');
  end if;
  if p_roster_id = t.roster_id then
    return jsonb_build_object('ok', false, 'error', 'that is your own tender — match or extend instead');
  end if;
  if p_salary is null or p_salary < 1 then return jsonb_build_object('ok', false, 'error', 'bid at least $1'); end if;
  if p_years is null or p_years < 1 or p_years > contract_years_max(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'years must be 1–' || contract_years_max(p_league_id));
  end if;
  if p_salary <= coalesce(t.offer_salary, 0) then
    return jsonb_build_object('ok', false, 'error', 'beat the standing offer of $' || t.offer_salary);
  end if;
  if team_payroll(p_league_id, p_roster_id) + p_salary > team_cap(p_league_id, p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'that offer does not fit under your cap');
  end if;
  update rfa_tender set offer_roster = p_roster_id, offer_salary = p_salary, offer_years = p_years
    where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'offer_salary', p_salary, 'offer_years', p_years);
end $$;
grant execute on function rfa_bid(uuid, int, text, int, int) to authenticated;

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
    return jsonb_build_object('ok', true, 'status', 'matched', 'salary', t.offer_salary, 'years', t.offer_years);
  end if;
  update native_roster set roster_id = t.offer_roster
    where league_id = p_league_id and slug = p_slug;
  update rfa_tender set status = 'walked' where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'status', 'walked', 'to_roster', t.offer_roster,
    'salary', t.offer_salary, 'years', t.offer_years);
end $$;
grant execute on function rfa_resolve(uuid, text, boolean) to authenticated;

-- ── league_contracts v3: the whole book in one read ──────────────────────────
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
    'locked', coalesce((select status from draft where league_id = p_league_id) = 'complete', true),
    'offseason', _season_over(p_league_id) or is_admin(),
    'rules', jsonb_build_object(
      'dead_pct', contract_dead_pct(p_league_id),
      'retention', salary_retention_on(p_league_id),
      'cap_trading', cap_trading_on(p_league_id),
      'ir_relief', ir_cap_relief_on(p_league_id),
      'tag_raise_pct', tag_raise_pct(p_league_id),
      'ext_discount_pct', ext_discount_pct(p_league_id),
      'rfa', rfa_on(p_league_id)),
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'roster_id', c.roster_id, 'salary', c.salary,
        'years', c.years, 'acquired', c.acquired, 'tagged', c.tagged,
        'mkt', contract_market_value(p_league_id, c.slug),
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
grant execute on function league_contracts(uuid) to authenticated;

-- ── rollover_league: 0218 body + contract carriage ───────────────────────────
create or replace function rollover_league(
  p_league_id uuid, p_weeks int default 14, p_rookie_only boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg league%rowtype; d draft%rowtype; nk int; next_seas text; nlid uuid;
  kept int; sched jsonb; gm text; new_settings jsonb; rr int; carried int; i int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));

  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'only native leagues roll over — re-import a platform league''s new season instead');
  end if;
  if lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'only full leagues roll over');
  end if;
  if lg.is_mock then
    return jsonb_build_object('ok', false, 'error', 'mock drafts don''t roll over');
  end if;
  if lg.season !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'season "' || coalesce(lg.season, '') || '" isn''t a year');
  end if;
  -- The Super Bowl gate (0185): the rollover appears when the season ends.
  if not (is_admin() or _season_over(p_league_id)) then
    return jsonb_build_object('ok', false, 'error',
      'the rollover opens after the Super Bowl — ' || ((lg.season)::int + 1) || '-02-15');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'this season''s draft never finished — nothing to roll over');
  end if;

  next_seas := ((lg.season)::int + 1)::text;
  nlid := _rollover_target(p_league_id);
  if nlid is not null then
    return jsonb_build_object('ok', false, 'error', 'already rolled into ' || next_seas, 'league_id', nlid);
  end if;

  nk := least(coalesce((lg.settings_json ->> 'keeper_count')::int, 0), d.rounds - 1);
  gm := coalesce(lg.settings_json ->> 'game_mode', 'drip');

  -- Same settings, scoring and spec — with the pool filter forced to
  -- rookies-only when this rollover feeds a rookie draft.
  new_settings := coalesce(lg.settings_json, '{}'::jsonb);
  if p_rookie_only then
    new_settings := new_settings || jsonb_build_object('pool_filter', jsonb_build_object('max_exp', 0));
  end if;

  insert into league (sleeper_league_id, season, name, provider, settings_json,
                      commissioner_id, synced_at, avatar_url, kdst_mode, weekly_budget,
                      lineup_policy, pot_ante, pot_cap, kind)
  values (lg.sleeper_league_id, next_seas, lg.name, 'native', new_settings,
          lg.commissioner_id, now(), lg.avatar_url, lg.kdst_mode, lg.weekly_budget,
          lg.lineup_policy, lg.pot_ante, lg.pot_cap, 'league')
  returning id into nlid;

  -- Memberships: same seats, same managers, same team names. Balances and
  -- priorities are season state, not identity — they start fresh.
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id,
                                 app_user_id, enrolled, team_name, claim_email,
                                 avatar_url, controller)
  select nlid, m.sleeper_roster_id, m.sleeper_owner_id,
         m.app_user_id, m.enrolled, m.team_name, m.claim_email,
         m.avatar_url, m.controller
  from league_membership m where m.league_id = p_league_id;

  -- The player pool. A rookie-only rollover carries just the kept players
  -- (their native_roster rows need the FK) and leaves the rest to the
  -- rookies-only reseed; a full rollover carries the whole pool with waiver
  -- clocks cleared. Ranks are last season's — the pre-draft reseed refreshes
  -- them, and seed_league_pool preserves rostered players.
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
  select nlid, lp.slug, lp.full_name, lp.pos, lp.team, lp.rank, lp.espn_id, lp.exp
  from league_pool lp
  where lp.league_id = p_league_id
    and (not p_rookie_only or exists (
      select 1 from _keeper_resolve(p_league_id, nk) kr where kr.slug = lp.slug));

  -- Keepers onto the new roster, pre-draft. acquired='keeper', spot='active'
  -- (taxi/IR are in-season designations; the manager re-declares them).
  insert into native_roster (league_id, roster_id, slug, acquired)
  select nlid, kr.roster_id, kr.slug, 'keeper'
  from _keeper_resolve(p_league_id, nk) kr;
  get diagnostics kept = row_count;

  -- CONTRACT CARRIAGE (0220). In a contract league the live deals ARE the
  -- keeper rule: a player under a multi-year deal (or a franchise tag)
  -- carries with his contract at years−1 (a tag carries its one year); an
  -- expiring, untagged deal walks to the pool no matter what the keeper
  -- machinery said. Dead money follows at years_left−1; retained-salary
  -- ghosts follow their contract; traded cap room does NOT carry (fresh
  -- season, fresh money — the wallet rule); open RFA tenders lapse.
  if contracts_on(p_league_id) then
    delete from native_roster nr where nr.league_id = nlid
      and exists (select 1 from contract c
        where c.league_id = p_league_id and c.slug = nr.slug
          and c.years <= 1 and not c.tagged);
    insert into native_roster (league_id, roster_id, slug, acquired)
    select nlid, c.roster_id, c.slug, 'keeper' from contract c
    where c.league_id = p_league_id and (c.years >= 2 or c.tagged)
      and exists (select 1 from native_roster o
        where o.league_id = p_league_id and o.slug = c.slug and o.roster_id = c.roster_id)
      and not exists (select 1 from native_roster n2
        where n2.league_id = nlid and n2.slug = c.slug);
    select count(*) into kept from native_roster where league_id = nlid;
    insert into contract (league_id, slug, roster_id, salary, years, acquired, start_season)
    select nlid, c.slug, c.roster_id, c.salary,
           case when c.years >= 2 then c.years - 1 else 1 end,
           c.acquired, c.start_season
    from contract c
    where c.league_id = p_league_id
      and exists (select 1 from native_roster n2 where n2.league_id = nlid and n2.slug = c.slug);
    insert into dead_money (league_id, roster_id, slug, amount, years_left, note)
    select nlid, dm.roster_id, dm.slug, dm.amount, dm.years_left - 1, dm.note
    from dead_money dm
    where dm.league_id = p_league_id and dm.years_left - 1 >= 1;
    insert into salary_retention (league_id, slug, roster_id, amount)
    select nlid, sr.slug, sr.roster_id, sr.amount
    from salary_retention sr
    where sr.league_id = p_league_id
      and exists (select 1 from contract nc where nc.league_id = nlid and nc.slug = sr.slug);
  end if;

  -- A fresh pending draft: same shape as this season's, minus the kept spots.
  insert into draft (league_id, status, rounds, pick_seconds, mode, budget,
                     lot_seconds, max_lots, night_start_min, night_end_min, keeper_slots)
  values (nlid, 'pending', d.rounds, d.pick_seconds, d.mode, d.budget,
          d.lot_seconds, d.max_lots, d.night_start_min, d.night_end_min, nk);

  -- Pick assets (0183/0185): carry EVERY future season's assets — ownership
  -- as traded — so a 2028 second dealt during 2026 still exists in 2027.
  -- The next-season rows become the new league's own-season assets (they
  -- drive _start_draft_now); the later ones stay tradeable futures. Then
  -- re-provision the three-year horizon from the carried rookie_rounds.
  insert into pick_asset (league_id, season, round, original_roster, owner_roster)
  select nlid, pa.season, pa.round, pa.original_roster, pa.owner_roster
  from pick_asset pa where pa.league_id = p_league_id and pa.season >= next_seas;
  get diagnostics carried = row_count;
  rr := coalesce((new_settings ->> 'rookie_rounds')::int, 0);
  if rr > 0 and league_continuity(nlid) in ('dynasty', 'contract_dynasty') then
    for i in 1..3 loop
      perform _provision_pick_assets(nlid, ((next_seas)::int + i)::text, rr);
    end loop;
  end if;

  -- The season schedule (round-robin; lock_at backfills from the live
  -- scoreboard once next season's slate exists). Best-effort: a 2-team
  -- edge case that refuses here shouldn't strand the created league.
  sched := native_generate_schedule(nlid, p_weeks);

  -- Wallets: deliberately NOT copied. team_wallet/coin_ledger key on the new
  -- league row, so every team starts next season at ◎0 and the weekly-budget
  -- machinery (auto_weekly_budget reads league.weekly_budget, which DID copy)
  -- funds the new season from week 1 — the "fresh season seed" decision.

  return jsonb_build_object(
    'ok', true, 'league_id', nlid, 'season', next_seas,
    -- the created-league confirmation must NAME the game it carries (v0.251.0)
    'game_mode', gm,
    'continuity', league_continuity(nlid),
    'keeper_slots', nk, 'kept', kept,
    'draft_rounds', case when exists (select 1 from pick_asset pa
        where pa.league_id = nlid and pa.season = next_seas) and d.mode = 'snake'
      then (select max(round) from pick_asset where league_id = nlid and season = next_seas)
      else d.rounds - nk end,
    'roster_size', d.rounds,
    'rookie_only', p_rookie_only,
    'picks_carried', carried,
    'schedule', sched,
    'invite_code', (select invite_code from league where id = nlid));
end $$;

-- ── league_trades v3 (0183 body + the salary terms) ──────────────────────────
-- The accepting manager must SEE what they are agreeing to eat: retained
-- salary and cap dollars ride the payload.
create or replace function league_trades(p_league_id uuid, p_limit int default 30)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'from_roster', t.from_roster, 'to_roster', t.to_roster,
      'give', t.give, 'get', t.get,
      'give_picks', t.give_picks, 'get_picks', t.get_picks,
      'retain', t.retain, 'cap_dollars', t.cap_dollars,
      'status', t.status, 'note', t.note,
      'created_at', t.created_at, 'resolved_at', t.resolved_at)
      order by t.created_at desc)
    from (select * from trade_proposal where league_id = p_league_id
          order by created_at desc limit least(p_limit, 100)) t), '[]'::jsonb);
end $$;
grant execute on function league_trades(uuid, int) to authenticated;
