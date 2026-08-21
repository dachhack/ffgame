-- 0213 — AN UNCLAIMED SEAT WORKS THE WIRE.
--
-- Seat agents (0180) have SET LINEUPS since v0.248.0 and have never once
-- TRANSACTED. A seat whose starting RB tore an ACL in week 3 fields that hole
-- for the rest of the season while his replacement sits in the pool, so by
-- December an agent seat is dead weight every human in the league has already
-- farmed. This is the durable half of letting it act.
--
-- WHAT THIS MIGRATION DOES NOT DO: it does not add an agent-only claim path.
-- `submit_waiver_claim` and `add_free_agent` have accumulated a lot of hard-won
-- validation — seat counts vs totals (0199), position caps, commissioner flags
-- (0144), FAAB balances, the FA window — and a parallel worker path would fork
-- every one of those and drift. The worker calls the SAME two functions a
-- manager calls. All that changes is who is allowed to call them.
--
-- HOW THE WORKER IS LET IN, AND WHY IT IS NARROW. The pattern is already
-- established by `process_waivers`, which permits `auth.uid() IS NULL` — the
-- service role. Two conditions must BOTH hold:
--
--   auth.uid() is null          → only the service role; every signed-in user
--                                 has a uid, so no human can reach this branch
--                                 even by calling the RPC directly.
--   agent_wire_seat(lg, roster) → a seat_agent row exists for that seat AND
--                                 league_membership.app_user_id IS STILL NULL.
--
-- The second condition is checked belt-and-braces on purpose. 0180's transfer
-- trigger retires the mapping when a human claims the seat, so the seat_agent
-- row alone SHOULD be sufficient — but if that trigger ever misses, the
-- membership check is what stops the worker from dropping a real manager's
-- running back. One of these is a policy; the other is a guarantee.
--
-- THE OPT-OUT. Commissioners get a separate switch from auto-slotting, because
-- these are different levels of intrusion: filling an empty lineup slot from
-- players the seat ALREADY owns is housekeeping, while adding and dropping
-- changes who is in the league's player pool and spends its FAAB. A league can
-- want the first and not the second. It rides on set_transaction_rules with
-- the rest of the waiver settings rather than becoming its own surface.

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_wire_seat — may the worker transact for this seat?
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function agent_wire_seat(p_league_id uuid, p_roster_id int)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from seat_agent sa
    join league_membership m
      on m.league_id = sa.league_id and m.sleeper_roster_id = sa.roster_id
    where sa.league_id = p_league_id and sa.roster_id = p_roster_id
      and m.app_user_id is null
  );
$$;
-- Deliberately NOT granted to authenticated: this answers a question only the
-- worker's own guard needs, and exposing it would leak which seats are bots.
revoke all on function agent_wire_seat(uuid, int) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- league_agent_waivers — the commissioner's switch, defaulting ON
-- ─────────────────────────────────────────────────────────────────────────────
-- Absent means ON. Every league that exists today predates the setting, and a
-- seat nobody is managing is better tended than untended — the whole point of
-- the feature. A commissioner who disagrees turns it off explicitly.
create or replace function league_agent_waivers(p_league_id uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (settings_json ->> 'agent_waivers')::boolean
                   from league where id = p_league_id), true);
$$;
grant execute on function league_agent_waivers(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- submit_waiver_claim / add_free_agent — 0199's bodies, one guard widened
-- ─────────────────────────────────────────────────────────────────────────────
-- Copied from the LIVE 0199 definitions and re-read, not reconstructed. The
-- ONLY difference from 0199 is the authorization block at the top of each.

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
grant execute on function submit_waiver_claim(uuid, int, text, text, int) to authenticated;

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
grant execute on function add_free_agent(uuid, int, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_transaction_rules — 0127's body plus p_agent_waivers
-- ─────────────────────────────────────────────────────────────────────────────
-- The old 10-argument signature is DROPPED, not left beside this one. Adding a
-- parameter to `create or replace function` makes an OVERLOAD, and this repo
-- has been bitten into a convention about it: 0126 dropped 0072's 8-arg form
-- and 0127 dropped 0126's 9-arg form for exactly this reason. Two live
-- overloads would let a client bind to whichever matched its argument list and
-- silently write through the older body.
drop function if exists set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb);
create or replace function set_transaction_rules(
  p_league_id uuid, p_waiver_mode text default null,
  p_faab_budget int default null, p_trade_review text default null,
  p_waiver_clear_min int default null, p_waiver_hold_days int default null,
  p_fa_start_min int default null, p_fa_end_min int default null,
  p_waiver_clear_dow jsonb default null,      -- [] clears (= every day); [0..6] sets
  p_fa_after_waivers_dow jsonb default null,  -- [] clears (= never wait); [0..6] sets
  p_agent_waivers boolean default null        -- 0213: agent seats may transact
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if p_waiver_mode is not null and p_waiver_mode not in ('rolling', 'standings', 'faab') then
    return jsonb_build_object('ok', false, 'error', 'waiver mode must be rolling, standings, or faab');
  end if;
  if p_faab_budget is not null and (p_faab_budget < 1 or p_faab_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'FAAB budget must be $1–$100000');
  end if;
  if p_trade_review is not null and p_trade_review not in ('none', 'commish') then
    return jsonb_build_object('ok', false, 'error', 'trade review must be none or commish');
  end if;
  if p_waiver_clear_min is not null and (p_waiver_clear_min < -1 or p_waiver_clear_min > 1439) then
    return jsonb_build_object('ok', false, 'error', 'waiver clear time must be a time of day');
  end if;
  if p_waiver_hold_days is not null and (p_waiver_hold_days < 1 or p_waiver_hold_days > 7) then
    return jsonb_build_object('ok', false, 'error', 'waiver hold must be 1–7 days');
  end if;
  if (p_fa_start_min is null) <> (p_fa_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'the free-agency window needs both a start and an end');
  end if;
  if p_fa_start_min is not null and p_fa_start_min <> -1 and (
       p_fa_start_min < 0 or p_fa_start_min > 1439
    or p_fa_end_min < 0 or p_fa_end_min > 1439
    or p_fa_start_min = p_fa_end_min) then
    return jsonb_build_object('ok', false, 'error', 'free-agency hours must be two different times of day');
  end if;
  if p_waiver_clear_dow is not null then
    if jsonb_typeof(p_waiver_clear_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'clear days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_waiver_clear_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'clear days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;
  if p_fa_after_waivers_dow is not null then
    if jsonb_typeof(p_fa_after_waivers_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_fa_after_waivers_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;

  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_waiver_mode is not null then jsonb_build_object('waiver_mode', p_waiver_mode) else '{}'::jsonb end
      || case when p_faab_budget is not null then jsonb_build_object('faab_budget', p_faab_budget) else '{}'::jsonb end
      || case when p_trade_review is not null then jsonb_build_object('trade_review', p_trade_review) else '{}'::jsonb end
      || case when p_waiver_clear_min is null then '{}'::jsonb
              when p_waiver_clear_min = -1 then jsonb_build_object('waiver_clear_min', null)
              else jsonb_build_object('waiver_clear_min', p_waiver_clear_min) end
      || case when p_waiver_hold_days is not null then jsonb_build_object('waiver_hold_days', p_waiver_hold_days) else '{}'::jsonb end
      || case when p_fa_start_min is null then '{}'::jsonb
              when p_fa_start_min = -1 then jsonb_build_object('fa_start_min', null, 'fa_end_min', null)
              else jsonb_build_object('fa_start_min', p_fa_start_min, 'fa_end_min', p_fa_end_min) end
      || case when p_waiver_clear_dow is null then '{}'::jsonb
              when jsonb_array_length(p_waiver_clear_dow) = 0 then jsonb_build_object('waiver_clear_dow', null)
              else jsonb_build_object('waiver_clear_dow', p_waiver_clear_dow) end
      || case when p_fa_after_waivers_dow is null then '{}'::jsonb
              when jsonb_array_length(p_fa_after_waivers_dow) = 0 then jsonb_build_object('fa_after_waivers_dow', null)
              else jsonb_build_object('fa_after_waivers_dow', p_fa_after_waivers_dow) end
      || case when p_agent_waivers is not null then jsonb_build_object('agent_waivers', p_agent_waivers) else '{}'::jsonb end
    where id = p_league_id;
  if p_waiver_mode is not null or p_faab_budget is not null then
    update league_membership set faab_budget = null where league_id = p_league_id;
  end if;
  return jsonb_build_object('ok', true,
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;
grant execute on function set_transaction_rules(uuid, text, int, text, int, int, int, int, jsonb, jsonb, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- roster_rules — 0198's body, carrying the new switch to the screens
-- ─────────────────────────────────────────────────────────────────────────────
-- A setting the commissioner cannot SEE is a setting they cannot trust, and
-- this one defaults ON, so a screen that could not read it would have to
-- hardcode that default and drift from `league_agent_waivers`.
create or replace function roster_rules(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  return jsonb_build_object('ok', true, 'rounds', d.rounds, 'draft_status', d.status,
    'pos_caps', league_pos_caps(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'waiver_clear_min', (select nullif(settings_json ->> 'waiver_clear_min', '')::int from league where id = p_league_id),
    'waiver_clear_dow', (select settings_json -> 'waiver_clear_dow' from league where id = p_league_id),
    'fa_after_waivers_dow', (select settings_json -> 'fa_after_waivers_dow' from league where id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1) from league where id = p_league_id),
    'fa_start_min', (select nullif(settings_json ->> 'fa_start_min', '')::int from league where id = p_league_id),
    'fa_end_min', (select nullif(settings_json ->> 'fa_end_min', '')::int from league where id = p_league_id),
    -- The taxi squad's own rules (0196), and whether it is shut right now.
    'taxi_max_exp', (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id),
    'taxi_lock', league_taxi_lock(p_league_id),
    'taxi_locked_now', taxi_is_locked(p_league_id),
    'taxi_lock_at', league_week1_kickoff(p_league_id),
    -- Which designations qualify for an IR spot (0198), so a screen can gate
    -- the button instead of discovering the rule from a red error.
    'ir_tags', to_jsonb(league_ir_tags(p_league_id)),
    -- 0213: may unclaimed seats work the wire? The screen needs the CURRENT
    -- value to render the switch, and absent means on, so it cannot be read
    -- off settings_json directly without duplicating that default.
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;
grant execute on function roster_rules(uuid) to authenticated;
