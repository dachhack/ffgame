-- 0229: lock your contracts to open the wire
--
-- Founder: "We need a motivator for people to decide contract lengths. Not
-- being able to make roster or waiver moves i think is good. So the draft
-- closes, players get 1yr contracts at the deadline, teams can make roster
-- moves if they 'lock' all their contracts."
--
-- The mechanic: when a contract league's draft room closes, lengths STAY
-- assignable — but a team cannot add free agents or claim waivers until its
-- manager presses 🔒 LOCK, confirming the lengths as written. The post-draft
-- rush to the wire is the motivator: the fastest route to the waiver wire
-- runs through your own cap sheet. At the league deadline (contract_lock_
-- hours after the room closes, default 72, settings-overridable) every
-- unset deal simply stands at its 1-year default and the gate lifts for
-- everyone — an absent manager costs themselves length strategy, never the
-- league its wire. Drops and lineups are never gated; the commissioner can
-- still correct any deal at any time; a draft reset clears the locks.

alter table league_membership add column if not exists contracts_locked boolean not null default false;

-- When the grace window ends: completed_at + contract_lock_hours (72 unless
-- the league's settings say otherwise). Null while the room is open.
create or replace function _contract_lock_deadline(p_league_id uuid)
  returns timestamptz language sql stable security definer set search_path = public as $$
  select d.completed_at + make_interval(hours => coalesce(
           nullif((select l.settings_json ->> 'contract_lock_hours' from league l where l.id = p_league_id), '')::int, 72))
  from draft d where d.league_id = p_league_id;
$$;

-- Null = free to move. Text = why not.
create or replace function _contracts_gate(p_league_id uuid, p_roster_id int)
  returns text language plpgsql stable security definer set search_path = public as $$
declare dl timestamptz;
begin
  if not contracts_on(p_league_id) then return null; end if;
  if coalesce((select contracts_locked from league_membership
               where league_id = p_league_id and sleeper_roster_id = p_roster_id), false) then
    return null;
  end if;
  dl := _contract_lock_deadline(p_league_id);
  if dl is null or now() >= dl then return null; end if;
  return 'lock your contract lengths first — 📜 CONTRACTS on your team page. Unset deals stay 1 year; the league unlocks on its own at the deadline.';
end $$;

-- The manager's confirmation: "these lengths are my deals." Idempotent; the
-- commissioner can lock a ghost seat.
create or replace function lock_contracts(p_league_id uuid, p_roster_id int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not contracts_on(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'this league does not play with contracts');
  end if;
  update league_membership set contracts_locked = true
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
  select count(*) into n from contract where league_id = p_league_id and roster_id = p_roster_id;
  return jsonb_build_object('ok', true, 'locked', true, 'deals', n);
end $$;
grant execute on function lock_contracts(uuid, int) to authenticated;

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
  elsif found and d.status = 'complete' and (
    -- 0229: the room closing no longer slams the window — the OWNER's own
    -- 🔒 lock does (or the league deadline). Until then, lengths are theirs.
    coalesce((select contracts_locked from league_membership
              where league_id = p_league_id and sleeper_roster_id = c.roster_id), false)
    or now() >= _contract_lock_deadline(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'lengths are locked — ask your commissioner');
  end if;
  update contract set years = p_years where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'years', p_years);
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

create or replace function add_free_agent(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; wu timestamptz; err text;
begin
  -- 0213: the WORKER may also act, but only for a seat nobody holds. The
  -- auth.uid() IS NULL half is what confines this to the service role — a
  -- signed-in user always has a uid, so no human reaches this branch — and
  -- agent_wire_seat re-checks the membership row, so a stale seat_agent
  -- mapping can never let the worker transact over a real manager's roster.
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, p_roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0229 (founder: "teams can make roster moves if they 'lock' all their
  -- contracts"): in a contract league the wire opens for a team when it
  -- LOCKS its contract lengths — or at the league deadline, when every
  -- unset deal finalizes at its 1-year default and the gate lifts itself.
  err := _contracts_gate(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := roster_illegal_reason(p_league_id, p_roster_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', 'your roster is over its limits — ' || err);
  end if;
  if not fa_window_open(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'free agency is closed — open '
      || fmt_et_min((select (settings_json ->> 'fa_start_min')::int from league where id = p_league_id)) || ' to '
      || fmt_et_min((select (settings_json ->> 'fa_end_min')::int from league where id = p_league_id)));
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is not null and wu > now() then
    return jsonb_build_object('ok', false, 'error', 'on waivers — submit a claim instead');
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  -- THE SEAT, NOT THE TOTAL (0199). Asked BEFORE the drop executes, with the
  -- drop discounted, so a refusal leaves the roster exactly as it was.
  err := roster_seat_error(p_league_id, p_roster_id, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  if p_drop_slug is not null then
    delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug;
    if not found then return jsonb_build_object('ok', false, 'error', 'drop player not on this roster'); end if;
    update league_pool set waived_until = waiver_hold_until(p_league_id)
      where league_id = p_league_id and slug = p_drop_slug;
  end if;
  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_roster_id, p_add_slug, 'fa');
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null, p_bid int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid; err text; mode text; bid int := coalesce(p_bid, 0);
begin
  -- 0213: the WORKER may also act, but only for a seat nobody holds. The
  -- auth.uid() IS NULL half is what confines this to the service role — a
  -- signed-in user always has a uid, so no human reaches this branch — and
  -- agent_wire_seat re-checks the membership row, so a stale seat_agent
  -- mapping can never let the worker transact over a real manager's roster.
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, p_roster_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  -- 0229 (founder: "teams can make roster moves if they 'lock' all their
  -- contracts"): in a contract league the wire opens for a team when it
  -- LOCKS its contract lengths — or at the league deadline, when every
  -- unset deal finalizes at its 1-year default and the gate lifts itself.
  err := _contracts_gate(p_league_id, p_roster_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  err := roster_illegal_reason(p_league_id, p_roster_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', 'your roster is over its limits — ' || err);
  end if;
  mode := league_waiver_mode(p_league_id);
  if mode <> 'faab' then bid := 0;
  elsif bid < 0 or bid > member_faab(p_league_id, p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'bid exceeds your FAAB balance of $' || member_faab(p_league_id, p_roster_id));
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_add_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  select waived_until into wu from league_pool where league_id = p_league_id and slug = p_add_slug;
  if wu is null then return jsonb_build_object('ok', false, 'error', 'player not in pool'); end if;
  if wu <= now() then return jsonb_build_object('ok', false, 'error', 'free agent — add directly'); end if;
  if p_drop_slug is not null and not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug) then
    return jsonb_build_object('ok', false, 'error', 'drop player not on this roster');
  end if;
  -- THE SEAT, NOT THE TOTAL (0199): a won claim lands ACTIVE, so a roster with
  -- taxi/IR places still open is not thereby free to take another bench player.
  if p_drop_slug is null then
    err := roster_seat_error(p_league_id, p_roster_id, null);
    if err is not null then
      return jsonb_build_object('ok', false, 'error', err || ' — or include a drop');
    end if;
  end if;
  err := pos_cap_error(p_league_id, p_roster_id, p_add_slug, false, p_drop_slug);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if exists (select 1 from waiver_claim c where c.league_id = p_league_id and c.roster_id = p_roster_id
             and c.add_slug = p_add_slug and c.status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'claim already pending');
  end if;
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, bid)
    values (p_league_id, p_roster_id, p_add_slug, p_drop_slug, bid) returning id into cid;
  return jsonb_build_object('ok', true, 'claim_id', cid, 'bid', bid,
    'clears_at', (select waived_until from league_pool where league_id = p_league_id and slug = p_add_slug));
end $$;

create or replace function commish_reset_draft(p_league_id uuid, p_confirm text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wiped int; kept int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the draft has not started');
  end if;
  -- Typed, like deleting a league (0188). Every pick in the room goes; a
  -- second tap is not proportional to that.
  if lower(btrim(coalesce(p_confirm, ''))) is distinct from 'reset' then
    return jsonb_build_object('ok', false, 'error', 'type RESET to start the draft over');
  end if;

  -- 0227: a reset UNWINDS the draft — it is not sixteen managers cutting
  -- their whole rosters. The transaction-local flag tells the contract
  -- release trigger to skip its cut penalties (no dead money, ghosts just
  -- dissolve) and the register trigger to stay quiet; one summary row below
  -- says what happened instead of a hundred 'drop' rows.
  perform set_config('app.draft_reset', '1', true);

  select count(*) into wiped from draft_pick where league_id = p_league_id;
  select count(*) into kept from native_roster
    where league_id = p_league_id and acquired = 'keeper';

  delete from draft_pick where league_id = p_league_id;
  -- ONLY the drafted rows. Keepers (0182) were never drafted, and anything
  -- picked up on waivers or in a trade since is not the draft's to undo.
  delete from native_roster where league_id = p_league_id and acquired = 'draft';
  delete from auction_lot where league_id = p_league_id;

  update draft set
    status = 'pending', current_overall = 1, nom_idx = 0,
    deadline_at = null, started_at = null, completed_at = null,
    paused = false, pause_remaining = null,
    pick_owners = null,
    lot_slug = null, lot_bid = null, lot_roster = null, lot_deadline = null
    where league_id = p_league_id;
  update league_membership set draft_budget = null, contracts_locked = false
    where league_id = p_league_id;

  insert into league_txn (league_id, kind, roster_id, slug, actor, note)
  values (p_league_id, 'commish', 0, '', auth.uid(),
          'draft reset — ' || wiped || ' pick' || case when wiped = 1 then '' else 's' end || ' cleared');

  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'picks_cleared', wiped, 'keepers_kept', kept);
end $$;
