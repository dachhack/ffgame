-- 0227: trashing a draft leaves no scars
--
-- Founder: "how do I trash the draft?" — and the trace found that in a
-- CONTRACT league it couldn't be done cleanly. commish_reset_draft (0191)
-- predates contracts: its roster deletes fire _contract_release per row,
-- which treats each one as a CUT — any 2+ year deal would leave its
-- dead-money penalty on the team's books for a draft that no longer
-- exists — and the register trigger logged every row as a drop, a wall of
-- noise for one commissioner action.
--
-- One transaction-local flag (app.draft_reset, the set_config(...) pattern
-- the register's txn_kind context already uses) and three respins:
--
--   • commish_reset_draft (0191 body) raises the flag before its deletes
--     and writes ONE register row — "draft reset — N picks cleared".
--   • _contract_release (0220 body) sees the flag and lets the deal and
--     any retention dissolve: no dead money, no hardened ghosts. A real
--     cut is untouched.
--   • log_native_roster_txn (0221 body) sees the flag and writes nothing —
--     the summary row is the record.

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
  update league_membership set draft_budget = null where league_id = p_league_id;

  insert into league_txn (league_id, kind, roster_id, slug, actor, note)
  values (p_league_id, 'commish', 0, '', auth.uid(),
          'draft reset — ' || wiped || ' pick' || case when wiped = 1 then '' else 's' end || ' cleared');

  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'picks_cleared', wiped, 'keepers_kept', kept);
end $$;

create or replace function _contract_release() returns trigger
  language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; ret int := 0; pen int;
begin
  -- 0227: the draft is being UNWOUND (commish_reset_draft) — these deletes
  -- are not cuts. The deal and any retention on it simply dissolve: no dead
  -- money, no hardened ghosts. The founder's trashed Contract Test would
  -- otherwise have salted every team with phantom cut penalties.
  if coalesce(current_setting('app.draft_reset', true), '') = '1' then
    delete from salary_retention where league_id = old.league_id and slug = old.slug;
    delete from contract where league_id = old.league_id and slug = old.slug;
    return old;
  end if;
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

create or replace function log_native_roster_txn() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lg uuid; rid int; sl text; knd text; frm int; st text; ctx text; nt text;
begin
  if tg_op = 'DELETE' then lg := old.league_id; rid := old.roster_id; sl := old.slug;
  else lg := new.league_id; rid := new.roster_id; sl := new.slug; end if;

  select status into st from draft where league_id = lg;
  if st is distinct from 'complete' then return null; end if;
  -- 0227: a draft reset unwinds every drafted row at once — the register
  -- gets ONE 'commish' summary row from commish_reset_draft, not a wall of
  -- phantom drops.
  if coalesce(current_setting('app.draft_reset', true), '') = '1' then return null; end if;

  ctx := nullif(current_setting('app.txn_kind', true), '');
  nt  := nullif(current_setting('app.txn_note', true), '');

  if tg_op = 'INSERT' then
    knd := case when new.acquired in ('waiver', 'trade', 'commish') then new.acquired else 'add' end;
  elsif tg_op = 'UPDATE' then
    if new.roster_id is not distinct from old.roster_id then return null; end if;
    knd := case when new.acquired = 'commish' then 'commish'
                when new.acquired = 'steal' then 'steal' else 'trade' end;
    frm := old.roster_id;
  else
    knd := 'drop';
  end if;
  -- an engine's context wins over the mechanical reading
  if ctx is not null then knd := ctx; end if;

  insert into league_txn (league_id, kind, roster_id, slug, from_roster, actor, note)
  values (lg, knd, rid, sl, frm, auth.uid(), nt);
  return null;
end $$;
