-- 0235: A STREET SIGNING CAN'T MAKE A ROOKIE A VETERAN, AND A TRASHED
-- DRAFT TAKES ITS WHOLE ERA WITH IT.
--
-- Founder (the Mendoza case): a rookie QB picked up off the wire filed as a
-- $1 veteran street deal with adjustable length, and the signing rode
-- through a draft reset that was meant to be a clean slate. Three closures:
--
--   1. FA/waiver signings of a player the pool knows as exp = 0 file as
--      ROOKIE deals — the signing priced him (FAAB bid, $1 floor), the rule
--      says how long he's held. Unknown exp stays a veteran deal, same
--      evidence bar as 0232.
--   2. commish_reset_draft also unwinds FA/waiver signings made since the
--      draft opened (added_at >= started_at) and clears pending waiver
--      claims — the trash means the ERA never happened, not just its picks.
--      Keepers and trades stay: neither is the draft's to undo.
--   3. The reset clears every seat's draft_queue — a dead draft's standing
--      maxes must not auto-nominate and proxy-bid into the redraft.
--
-- LINEAGE: _contract_originate patched from its 0232 body (0217 → 0226 →
-- 0227 → 0232); commish_reset_draft from its 0229 body (0191 → 0227 → 0229).

-- ── 1. rookie law covers the wire ────────────────────────────────────────────
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
      -- 0232 (founder: "Tyson is a rookie, his contract should be set at 4
      -- years and not changeable"): a startup auction can WIN a rookie, but
      -- it cannot make him a veteran. exp = 0 in the pool marks his rookie
      -- season, and his deal signs like every rookie deal — at the league's
      -- rookie term, length fixed by rule, priced at the bid (the auction
      -- said what he costs; the rule says how long he's held). An unknown
      -- exp stays a veteran deal — the rule needs evidence, not absence.
      if coalesce((select lp.exp from league_pool lp
                   where lp.league_id = new.league_id and lp.slug = new.slug), 99) = 0 then
        how := 'rookie';
        yrs := least(rookie_contract_years(new.league_id), contract_years_max(new.league_id));
      end if;
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
  -- 0235 (the Mendoza case): the WIRE can't make a rookie a veteran either.
  -- A street signing of a player the pool marks exp = 0 files as a rookie
  -- deal — the signing set his price, the rule sets his term. Unknown exp
  -- stays a veteran deal, same evidence bar as the auction path above.
  if how in ('waiver', 'fa') and coalesce((select lp.exp from league_pool lp
       where lp.league_id = new.league_id and lp.slug = new.slug), 99) = 0 then
    how := 'rookie';
    yrs := least(rookie_contract_years(new.league_id), contract_years_max(new.league_id));
  end if;
  insert into contract (league_id, slug, roster_id, salary, years, acquired, start_season)
  values (new.league_id, new.slug, new.roster_id, sal, yrs, how, coalesce(seas, ''))
  on conflict (league_id, slug) do update
    set roster_id = excluded.roster_id;
  return new;
end $$;

-- Re-file street-signed rookies already on rosters (Mendoza et al.) the way
-- 0233 re-filed the auction-won ones: rookie deal at the league's term,
-- salary untouched — the signing priced him, the rule holds him.
update contract c
set acquired = 'rookie',
    years = least(rookie_contract_years(c.league_id), contract_years_max(c.league_id))
from league_pool lp
where lp.league_id = c.league_id and lp.slug = c.slug and lp.exp = 0
  and c.acquired in ('fa', 'waiver');

-- ── 2 + 3. the reset takes the whole era ─────────────────────────────────────
create or replace function commish_reset_draft(p_league_id uuid, p_confirm text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wiped int; kept int; signings int;
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
  -- The drafted rows, and (0235) every wire signing made since the draft
  -- opened — trashing the draft means its ERA never happened, and a pickup
  -- from that era is a scar the founder's clean slate promised not to leave.
  -- Keepers (0182) were never drafted, and a trade is not the draft's to
  -- undo — both stay.
  delete from native_roster where league_id = p_league_id and acquired = 'draft';
  delete from native_roster where league_id = p_league_id
    and acquired in ('fa', 'waiver')
    and d.started_at is not null and added_at >= d.started_at;
  get diagnostics signings = row_count;
  delete from waiver_claim where league_id = p_league_id and status = 'pending';
  delete from auction_lot where league_id = p_league_id;
  -- 0235: dead drafts don't bid. Standing queue maxes from the trashed room
  -- would auto-nominate and proxy-bid into the redraft (the other half of
  -- the Mendoza surprise) — every seat preps fresh.
  delete from draft_queue where league_id = p_league_id;

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
          'draft reset — ' || wiped || ' pick' || case when wiped = 1 then '' else 's' end || ' cleared'
          || case when signings > 0 then ' · ' || signings || ' signing' || case when signings = 1 then '' else 's' end || ' unwound' else '' end);

  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'picks_cleared', wiped, 'keepers_kept', kept,
    'signings_unwound', signings);
end $$;
