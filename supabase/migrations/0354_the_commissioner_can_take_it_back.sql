-- ═══════════════════════════════════════════════════════════════════════════
-- 0354 · THE COMMISSIONER CAN TAKE IT BACK
--
-- Founder, on the list of finer commissioner controls: "Merge and apk, then
-- build 1 and 2 … These are all good."
--   1. UNDO AN ADD, A DROP OR A WAIVER CLAIM. Trades could be reversed since
--      0328; a pickup could not. A manager who drops the wrong man, or a claim
--      that should never have run, left the commissioner moving players one
--      at a time and guessing at the FAAB and the waiver order.
--   2. A PLAYER'S WAIVER HOLD, BY HAND. Free now, back on waivers until the
--      next run, or held until a chosen moment. Until now a hold came only
--      from a drop or from the league-wide schedule.
--
-- ── WHAT AN UNDO PUTS BACK ─────────────────────────────────────────────────
-- A move is found from its register row (league_txn). An add or a waiver win
-- is the player who came in plus whoever went out in the same transaction —
-- the claim's own drop for a waiver, the same seat's drop at the same instant
-- for an add (add_free_agent is one transaction, so its two rows share `at`
-- exactly). A drop on its own is just the player who went out.
--   • The player who came IN leaves the roster and goes back ON WAIVERS on the
--     league's normal hold — not straight to free agency, where the fastest
--     phone would have him before the league knew he was loose again.
--   • The player who went OUT comes back to the same seat.
--   • A waiver win's FAAB bid is refunded.
--   • The waiver order is put back — IF nothing has moved it since. The run
--     sends a winner to the back; 0354 logs every waiver-priority change, so
--     the seat's old place is known, and it is restored only while the seat
--     still holds the place the run gave it. If anything moved it since, the
--     order is left alone and the chat line says so.
-- The original register rows are marked undone, the undo's own rows are
-- labelled, and one house line tells the league what happened.
--
-- ── WHAT AN UNDO REFUSES ───────────────────────────────────────────────────
-- Anything that is no longer true: the player who came in has moved on, the
-- player who went out has been picked up, the pickup's game has kicked off
-- (the same kickoff rule a drop obeys, 0317), or there is no seat for a lone
-- drop to come back into. Each refusal says which, so the commissioner can do
-- it by hand instead. Trades are not here: commish_reverse_trade (0328) owns
-- them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. the register remembers ══════════════════════════════════════════════
alter table league_txn add column if not exists undone_at timestamptz;
alter table league_txn add column if not exists undone_by uuid;
-- On the rows an undo itself writes: which register row it undid.
alter table league_txn add column if not exists undo_of bigint references league_txn(id) on delete set null;

-- Every waiver-priority change, so a waiver win's rotation can be put back.
create table if not exists waiver_priority_log (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  old_value  int,
  new_value  int,
  at         timestamptz not null default now()
);
create index if not exists waiver_priority_log_seat on waiver_priority_log(league_id, roster_id, at desc);
alter table waiver_priority_log enable row level security;   -- no policies

create or replace function log_waiver_priority() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.waiver_priority is distinct from old.waiver_priority then
    insert into waiver_priority_log (league_id, roster_id, old_value, new_value)
    values (new.league_id, new.sleeper_roster_id, old.waiver_priority, new.waiver_priority);
  end if;
  return null;
end $$;
drop trigger if exists log_waiver_priority on league_membership;
create trigger log_waiver_priority after update of waiver_priority on league_membership
  for each row execute function log_waiver_priority();

-- ═══ 2. what a register row would undo ══════════════════════════════════════
-- The move a register row belongs to: {roster_id, added, dropped, bid, claim}
-- or {error}. Shared by the undo and by the register's `can_undo`, so the
-- button is offered exactly where the undo would accept it.
create or replace function _txn_undo_plan(p_txn_id bigint) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare t league_txn%rowtype; lead league_txn%rowtype; added text; dropped text; c waiver_claim%rowtype;
begin
  select * into t from league_txn where id = p_txn_id;
  if not found then return jsonb_build_object('error', 'no such move'); end if;
  if t.undone_at is not null then return jsonb_build_object('error', 'already undone'); end if;
  if t.undo_of is not null then return jsonb_build_object('error', 'this line is itself an undo'); end if;
  if t.kind not in ('add', 'waiver', 'drop') then
    return jsonb_build_object('error', case when t.kind = 'trade' then 'reverse a trade from the trade floor'
                                            else 'only an add, a drop or a waiver claim can be undone' end);
  end if;
  -- A drop that rode an add is that add's undo.
  lead := t;
  if t.kind = 'drop' then
    select * into lead from league_txn x
     where x.league_id = t.league_id and x.roster_id = t.roster_id and x.at = t.at
       and x.kind in ('add', 'waiver') and x.undone_at is null and x.undo_of is null
     order by x.id limit 1;
    if not found then lead := t; end if;
  end if;
  if lead.kind = 'drop' then
    return jsonb_build_object('txn_id', lead.id, 'league_id', lead.league_id, 'roster_id', lead.roster_id,
                              'kind', 'drop', 'added', null, 'dropped', lead.slug, 'at', lead.at);
  end if;
  added := lead.slug;
  if lead.kind = 'waiver' then
    select * into c from waiver_claim w
     where w.league_id = lead.league_id and w.roster_id = lead.roster_id and w.add_slug = added
       and w.status = 'won' and w.processed_at = lead.at
     order by w.id desc limit 1;
    dropped := c.drop_slug;
  else
    select x.slug into dropped from league_txn x
     where x.league_id = lead.league_id and x.roster_id = lead.roster_id and x.at = lead.at
       and x.kind = 'drop' and x.slug <> added and x.undone_at is null and x.undo_of is null
     order by x.id limit 1;
  end if;
  return jsonb_build_object('txn_id', lead.id, 'league_id', lead.league_id, 'roster_id', lead.roster_id,
    'kind', lead.kind, 'added', added, 'dropped', dropped, 'at', lead.at,
    'claim_id', c.id, 'bid', case when lead.kind = 'waiver' then coalesce(c.bid, 0) end);
end $$;
revoke all on function _txn_undo_plan(bigint) from public, anon, authenticated;

-- Why this plan cannot run right now, or null when it can.
create or replace function _txn_undo_blocker(p jsonb) returns text
  language plpgsql stable security definer set search_path = public as $$
declare lid uuid := (p ->> 'league_id')::uuid; rid int := (p ->> 'roster_id')::int; err text;
begin
  if p ? 'error' then return p ->> 'error'; end if;
  if p ->> 'added' is not null then
    if not exists (select 1 from native_roster where league_id = lid and roster_id = rid and slug = p ->> 'added') then
      return _txn_player(lid, p ->> 'added') || ' is no longer on that team — move him by hand';
    end if;
    err := drop_lock_reason(lid, p ->> 'added');
    if err is not null then return err; end if;
  end if;
  if p ->> 'dropped' is not null
     and exists (select 1 from native_roster where league_id = lid and slug = p ->> 'dropped') then
    return _txn_player(lid, p ->> 'dropped') || ' has been picked up since — he can''t come back';
  end if;
  if p ->> 'added' is null and roster_seat_error(lid, rid, null) is not null then
    return 'that team has no open seat for ' || _txn_player(lid, p ->> 'dropped') || ' — make room first';
  end if;
  return null;
end $$;
revoke all on function _txn_undo_blocker(jsonb) from public, anon, authenticated;

-- ═══ 3. the undo ════════════════════════════════════════════════════════════
create or replace function commish_undo_txn(p_txn_id bigint) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare p jsonb; lid uuid; rid int; err text; added text; dropped text; bid int;
        pl waiver_priority_log%rowtype; order_note text := ''; mode text; line text;
        orig bigint[]; before_id bigint;
begin
  select league_id into lid from league_txn where id = p_txn_id;
  if lid is null then return jsonb_build_object('ok', false, 'error', 'no such move'); end if;
  if not (is_admin() or is_league_commish(lid)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(lid::text));   -- the same lock as a waiver run
  p := _txn_undo_plan(p_txn_id);
  err := _txn_undo_blocker(p);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  rid := (p ->> 'roster_id')::int; added := p ->> 'added'; dropped := p ->> 'dropped';
  bid := nullif(p ->> 'bid', '')::int;
  mode := league_waiver_mode(lid);
  -- WHICH REGISTER ROWS ARE THE MOVE, taken before anything changes: the
  -- undo's own roster writes add rows too, and they must never be confused
  -- with the ones being undone.
  select array_agg(id) into orig from league_txn
   where league_id = lid and roster_id = rid and at = (p ->> 'at')::timestamptz
     and slug in (coalesce(added, ''), coalesce(dropped, '')) and undone_at is null and undo_of is null;
  select coalesce(max(id), 0) into before_id from league_txn where league_id = lid;

  -- The pickup leaves, back ON WAIVERS on the league's normal hold.
  if added is not null then
    delete from native_roster where league_id = lid and roster_id = rid and slug = added;
    update league_pool set waived_until = waiver_hold_until(lid) where league_id = lid and slug = added;
  end if;
  -- The drop comes home.
  if dropped is not null then
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, rid, dropped, 'commish');
    update league_pool set waived_until = null where league_id = lid and slug = dropped;
  end if;
  -- A waiver win: the bid back, and the place in line back if nothing has
  -- moved it since the run.
  if p ->> 'kind' = 'waiver' then
    if mode = 'faab' and coalesce(bid, 0) > 0 then
      update league_membership set faab_budget = member_faab(lid, rid) + bid
       where league_id = lid and sleeper_roster_id = rid;
    end if;
    if mode <> 'standings' then
      -- Exactly ONE change to this seat's place at the run's instant. Two
      -- (the seat won twice in one run, or something else moved it inside
      -- the same transaction) leave no single "before" to go back to.
      select * into pl from waiver_priority_log
       where league_id = lid and roster_id = rid and at = (p ->> 'at')::timestamptz
       order by id desc limit 1;
      if found and pl.old_value is not null
         and (select count(*) from waiver_priority_log
               where league_id = lid and roster_id = rid and at = (p ->> 'at')::timestamptz) = 1
         and (select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = rid) = pl.new_value then
        update league_membership set waiver_priority = pl.old_value where league_id = lid and sleeper_roster_id = rid;
        order_note := ', waiver order restored';
      else
        order_note := ', waiver order left as it is (it has changed since)';
      end if;
    end if;
  end if;

  -- The register: the original rows undone, the undo's own rows labelled.
  update league_txn set undone_at = now(), undone_by = auth.uid() where id = any(orig);
  update league_txn set undo_of = (p ->> 'txn_id')::bigint, note = 'commissioner undo'
   where league_id = lid and id > before_id;

  line := '↩ The commissioner undid ' || _txn_team(lid, rid) || '''s '
    || case p ->> 'kind' when 'waiver' then 'waiver claim for ' || _txn_player(lid, added)
                         when 'add' then 'pickup of ' || _txn_player(lid, added)
                         else 'drop of ' || _txn_player(lid, dropped) end
    || case when added is not null and dropped is not null then ' (dropping ' || _txn_player(lid, dropped) || ')' else '' end
    || ' — '
    || concat_ws(', ',
         case when added is not null then _txn_player(lid, added) || ' is back on waivers' end,
         case when dropped is not null then _txn_player(lid, dropped) || ' is back on ' || _txn_team(lid, rid) end,
         case when mode = 'faab' and coalesce(bid, 0) > 0 then '$' || bid || ' refunded' end)
    || order_note;
  perform _chat_house(lid, line, jsonb_build_object('kind', 'undo', 'txn_id', p ->> 'txn_id'));
  perform native_materialize(lid);
  return jsonb_build_object('ok', true, 'added', added, 'dropped', dropped, 'refunded', bid, 'note', line);
end $$;
grant execute on function commish_undo_txn(bigint) to authenticated;

-- ═══ 4. the register, with the undo on it ═══════════════════════════════════
-- 0221's body, plus `undone`, `undo_of` and — for the commissioner only —
-- `can_undo` (and why not), computed by the same plan the undo runs.
create or replace function league_register(p_league_id uuid, p_limit int default 100)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out_rows jsonb; commish boolean := is_league_commish(p_league_id) or is_admin();
begin
  if not (is_league_member(p_league_id) or commish) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(r order by r.at desc, r.id desc), '[]'::jsonb) into out_rows
  from (
    select t.id, t.at, t.kind, t.slug, t.roster_id, t.from_roster, t.note,
           m.team_name  as team,
           fm.team_name as from_team,
           case when t.kind = 'waiver' then (
             select w.bid from waiver_claim w
              where w.league_id = t.league_id and w.roster_id = t.roster_id
                and w.add_slug = t.slug and w.status = 'won'
              order by w.processed_at desc nulls last limit 1
           ) end as bid,
           t.undone_at is not null as undone,
           t.undo_of,
           case when commish and t.kind in ('add', 'waiver', 'drop') and t.undone_at is null and t.undo_of is null
                then _txn_undo_blocker(_txn_undo_plan(t.id)) is null end as can_undo
      from league_txn t
      left join league_membership m
        on m.league_id = t.league_id and m.sleeper_roster_id = t.roster_id
      left join league_membership fm
        on fm.league_id = t.league_id and fm.sleeper_roster_id = t.from_roster
     where t.league_id = p_league_id
       and not (t.kind = 'drop' and exists (
             select 1 from league_txn t2
              where t2.league_id = t.league_id and t2.slug = t.slug
                and t2.at = t.at and t2.kind <> 'drop'))
     order by t.at desc, t.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) r;
  return jsonb_build_object('ok', true, 'rows', out_rows, 'is_commish', commish);
end $$;
grant execute on function league_register(uuid, int) to authenticated;

-- ═══ 5. a player's waiver hold ══════════════════════════════════════════════
-- Every unrostered player on waivers right now, soonest first; and, with a
-- search, the unrostered players whose names match — the ones a commissioner
-- might want to put on waivers.
create or replace function league_waiver_holds(p_league_id uuid, p_search text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'next_run', waiver_hold_until(p_league_id),
    'held', coalesce((
      select jsonb_agg(jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
               'until', lp.waived_until,
               'claims', (select count(*) from waiver_claim c where c.league_id = lp.league_id
                            and c.add_slug = lp.slug and c.status = 'pending'))
             order by lp.waived_until, lp.rank)
        from league_pool lp
       where lp.league_id = p_league_id and lp.waived_until > now()
         and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)), '[]'::jsonb),
    'found', case when q is null then '[]'::jsonb else coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
                 'until', case when lp.waived_until > now() then lp.waived_until end) as x
          from league_pool lp
         where lp.league_id = p_league_id and lp.full_name ilike '%' || q || '%'
           and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
         order by lp.rank limit 12) s), '[]'::jsonb) end);
end $$;
grant execute on function league_waiver_holds(uuid, text) to authenticated;

-- p_mode: 'free' (a free agent now), 'next_run' (on waivers until the run a
-- drop would wait for), or 'until' (held until p_until, within two weeks).
-- Pending claims on him are re-dated with him: a claim clears when the hold
-- does, never before it, and a freed player's claims clear at the next run or
-- when free agency opens, whichever is first — what a fresh claim would get.
create or replace function commish_set_waiver_hold(p_league_id uuid, p_slug text, p_mode text, p_until timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t timestamptz; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not exists (select 1 from league_pool where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in this league''s pool');
  end if;
  if exists (select 1 from native_roster where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', _txn_player(p_league_id, p_slug) || ' is on a roster — a hold is for a player nobody has');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if p_mode = 'free' then
    t := null;
  elsif p_mode = 'next_run' then
    t := waiver_hold_until(p_league_id);
  elsif p_mode = 'until' then
    if p_until is null or p_until <= now() or p_until > now() + interval '14 days' then
      return jsonb_build_object('ok', false, 'error', 'pick a time in the next two weeks');
    end if;
    t := p_until;
  else
    return jsonb_build_object('ok', false, 'error', 'mode is free, next_run or until');
  end if;
  update league_pool set waived_until = t where league_id = p_league_id and slug = p_slug;
  update waiver_claim c set clears_at = case when t is null
      then least(claim_clears_at(p_league_id), coalesce(fa_opens_at(p_league_id), claim_clears_at(p_league_id)))
      else greatest(coalesce(c.clears_at, t), t) end
   where c.league_id = p_league_id and c.add_slug = p_slug and c.status = 'pending';
  line := case when t is null
    then '✅ The commissioner cleared ' || _txn_player(p_league_id, p_slug) || '''s waiver hold — he is a free agent now'
    else '⏳ The commissioner put ' || _txn_player(p_league_id, p_slug) || ' on waivers until '
         || to_char(t at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' ET' end;
  perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'hold', 'slug', p_slug, 'until', t));
  return jsonb_build_object('ok', true, 'slug', p_slug, 'until', t, 'note', line);
end $$;
grant execute on function commish_set_waiver_hold(uuid, text, text, timestamptz) to authenticated;
