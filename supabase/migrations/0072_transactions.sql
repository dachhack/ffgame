-- 0072: TRANSACTIONS — commissioner roster tools, FAAB waivers, and trades
-- (with optional commissioner review) for native leagues.
--
-- COMMISH ROSTER TOOLS. commish_move_player / commish_remove_player let the
-- commissioner fix any roster post-draft: move a player to any team, or send
-- one to waivers / straight to free agency. The total roster-size cap is
-- enforced (clear error — remove someone first); POSITION limits are
-- deliberately bypassed: this is the override tool, and existing rosters are
-- grandfathered everywhere else anyway.
--
-- FAAB. settings_json.waiver_mode: 'rolling' (default, today's behavior) |
-- 'faab'. In FAAB, a claim carries a blind bid against a season budget
-- (settings_json.faab_budget, default $100); claims resolve highest-bid-first
-- (rolling priority breaks ties, winner still rotates to the back), the
-- winner pays, losers keep their money. A seat's balance lives in
-- league_membership.faab_budget where NULL means "untouched" (= the league
-- default), so changing the mode/budget just resets balances by nulling them
-- — no seeding pass, and seats that join later are automatically funded.
--
-- TRADES. trade_proposal: give/get slug lists between two rosters.
--   propose (owner of the giving roster) → counterparty accepts/rejects →
--   executes immediately, UNLESS settings_json.trade_review = 'commish', in
--   which case an accepted trade waits for commish_rule_trade (approve →
--   execute, else vetoed; a veto can also kill a still-pending offer).
-- Execution re-validates at swap time: every piece still on its roster, and
-- BOTH sides end legal (roster-size + position limits, net of what leaves).
-- A failed validation leaves the trade where it was with a clear error.
--
-- ILLEGAL-ROSTER LOCKOUT (deliberate design). A roster can end up over its
-- limits — the commissioner lowered a position limit, or used the override
-- tools (commish_move_player MAY overfill on purpose). Such a roster is
-- LOCKED OUT: no free-agent adds, no waiver claims, and no weekly lineup
-- picks (a sealed_pick trigger; server/admin writers exempt) until the
-- manager drops down to legal. Drops are always allowed, and a trade that
-- lands the roster fully legal is a valid way out too.
--
-- WAIVER TIMING & FA PERIODS (commish-set):
--   • settings_json.waiver_clear_min (+ waiver_hold_days, default 1): waiver
--     holds end at a fixed DAILY ET time — a dropped player clears at the
--     Nth next occurrence of that time — instead of the rolling 24h default;
--   • settings_json.fa_start_min/fa_end_min: free agency is open only inside
--     this daily ET window (wrap-around supported); claims can be submitted
--     any time — the window gates instant FA pickups only.

alter table league_membership add column if not exists faab_budget int;
alter table waiver_claim add column if not exists bid int not null default 0;
-- 'trade' joins the acquisition kinds (0064 already had draft/waiver/fa/commish)
alter table native_roster drop constraint if exists native_roster_acquired_check;
alter table native_roster add constraint native_roster_acquired_check
  check (acquired in ('draft', 'waiver', 'fa', 'commish', 'trade'));

create table if not exists trade_proposal (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references league(id) on delete cascade,
  from_roster  int  not null,             -- proposer's seat
  to_roster    int  not null,
  give         jsonb not null default '[]'::jsonb,   -- slugs leaving from_roster
  get          jsonb not null default '[]'::jsonb,   -- slugs leaving to_roster
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'executed', 'rejected', 'cancelled', 'vetoed')),
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  resolved_at  timestamptz
);
create index if not exists trade_proposal_league on trade_proposal(league_id, status, created_at desc);
alter table trade_proposal enable row level security;
drop policy if exists trade_proposal_read on trade_proposal;
create policy trade_proposal_read on trade_proposal for select using (is_league_member(league_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- Rule helpers (settings_json with defaults)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function league_waiver_mode(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(settings_json ->> 'waiver_mode', 'rolling') from league where id = p_league_id;
$$;
create or replace function league_faab_budget(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'faab_budget')::int, 100) from league where id = p_league_id;
$$;
create or replace function league_trade_review(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(settings_json ->> 'trade_review', 'none') from league where id = p_league_id;
$$;
-- A seat's remaining FAAB (null column = untouched = the league default).
create or replace function member_faab(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(m.faab_budget, league_faab_budget(p_league_id))
  from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id;
$$;

create or replace function fmt_et_min(m int) returns text
  language sql immutable as $$
  select (case when (m / 60) % 12 = 0 then 12 else (m / 60) % 12 end)::text
      || case when m % 60 > 0 then ':' || lpad((m % 60)::text, 2, '0') else '' end
      || case when (m / 60) % 24 < 12 then ' AM' else ' PM' end || ' ET';
$$;

-- When does a player dropped NOW clear waivers? Rolling 24h by default; with
-- a daily clear time set, the Nth next occurrence of that ET time.
create or replace function waiver_hold_until(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare cm int; hd int; day_local timestamp; t timestamptz;
begin
  select nullif(settings_json ->> 'waiver_clear_min', '')::int,
         coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1)
    into cm, hd from league where id = p_league_id;
  if cm is null then return now() + interval '24 hours'; end if;
  day_local := date_trunc('day', now() at time zone 'America/New_York');
  t := (day_local + make_interval(mins => cm)) at time zone 'America/New_York';
  if t <= now() then
    t := (day_local + interval '1 day' + make_interval(mins => cm)) at time zone 'America/New_York';
  end if;
  return t + make_interval(days => greatest(1, hd) - 1);
end $$;

-- Is free agency open right now? (No window configured = always open.)
create or replace function fa_window_open(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select case when s.fs is null or s.fe is null then true
              else is_night_minute(et_minutes(now()), s.fs, s.fe) end
  from (select nullif(settings_json ->> 'fa_start_min', '')::int as fs,
               nullif(settings_json ->> 'fa_end_min', '')::int as fe
        from league where id = p_league_id) s;
$$;

-- Why is this roster illegal (over size or over a position limit)? Null = legal.
-- Illegal rosters are locked out of FA/waivers/weekly picks until fixed.
create or replace function roster_illegal_reason(p_league_id uuid, p_roster_id int) returns text
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; cnt int; rec record; cap int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return null; end if;
  select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  if cnt > d.rounds then
    return 'roster holds ' || cnt || ' players (limit ' || d.rounds || ') — drop ' || (cnt - d.rounds);
  end if;
  for rec in
    select lp.pos, count(*)::int as n
    from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = p_league_id and nr.roster_id = p_roster_id group by lp.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null and rec.n > cap then
      return 'over the ' || pos_label(rec.pos) || ' limit (' || rec.n || '/' || cap || ') — drop ' || (rec.n - cap);
    end if;
  end loop;
  return null;
end $$;

-- Nulls = leave unchanged. The nullable schedule knobs use -1 to CLEAR
-- (waiver clear time → back to rolling 24h; FA window → always open).
create or replace function set_transaction_rules(
  p_league_id uuid, p_waiver_mode text default null,
  p_faab_budget int default null, p_trade_review text default null,
  p_waiver_clear_min int default null, p_waiver_hold_days int default null,
  p_fa_start_min int default null, p_fa_end_min int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if p_waiver_mode is not null and p_waiver_mode not in ('rolling', 'faab') then
    return jsonb_build_object('ok', false, 'error', 'waiver mode must be rolling or faab');
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
    where id = p_league_id;
  -- mode/budget changes hand every seat a fresh (default) balance
  if p_waiver_mode is not null or p_faab_budget is not null then
    update league_membership set faab_budget = null where league_id = p_league_id;
  end if;
  return jsonb_build_object('ok', true,
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Commissioner roster tools
-- ─────────────────────────────────────────────────────────────────────────────
-- The commissioner override MAY overfill a roster (or bust its position
-- limits) — deliberately. The illegal-roster lockout then keeps that manager
-- out of FA/waivers/weekly picks until they drop back to legal.
create or replace function commish_move_player(p_league_id uuid, p_slug text, p_to_roster int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'no such roster');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug and nr.roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'already on that roster');
  end if;
  -- off wherever he is (rostered or free), onto the target, no waiver hold
  delete from native_roster where league_id = p_league_id and slug = p_slug;
  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_to_roster, p_slug, 'commish');
  update league_pool set waived_until = null where league_id = p_league_id and slug = p_slug;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true,
    'roster_issue', roster_illegal_reason(p_league_id, p_to_roster));
end $$;

create or replace function commish_remove_player(p_league_id uuid, p_slug text, p_waive boolean default true)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  delete from native_roster where league_id = p_league_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'player not on a roster'); end if;
  update league_pool set waived_until = case when p_waive then waiver_hold_until(p_league_id) end
    where league_id = p_league_id and slug = p_slug;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'waived', coalesce(p_waive, true));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Illegal-roster lockout + waiver/FA scheduling on the player-facing paths
-- ─────────────────────────────────────────────────────────────────────────────

-- drop_player v2: drops are ALWAYS allowed (they're how a locked-out roster
-- gets legal); the waiver hold honors the league's clear schedule.
create or replace function drop_player(p_league_id uuid, p_roster_id int, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'complete') then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'player not on this roster'); end if;
  update league_pool set waived_until = waiver_hold_until(p_league_id)
    where league_id = p_league_id and slug = p_slug;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

-- add_free_agent v3: illegal rosters are locked out; the FA window gates
-- instant pickups; drops honor the waiver clear schedule.
create or replace function add_free_agent(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; cnt int; cap int; wu timestamptz; err text;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
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
  cap := d.rounds;

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

  if p_drop_slug is not null then
    delete from native_roster where league_id = p_league_id and roster_id = p_roster_id and slug = p_drop_slug;
    if not found then return jsonb_build_object('ok', false, 'error', 'drop player not on this roster'); end if;
    update league_pool set waived_until = waiver_hold_until(p_league_id)
      where league_id = p_league_id and slug = p_drop_slug;
  end if;
  select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'roster full — drop someone'); end if;

  insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, p_roster_id, p_add_slug, 'fa');
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true);
end $$;

-- Weekly lineups: an illegal roster can't set picks in a native league. The
-- trigger binds MANAGER writes only — the server's auto-lineup (service role)
-- and admin/commish demo tools stay exempt, so game ops never jam.
create or replace function enforce_legal_roster() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lg uuid; rid int; reason text;
begin
  if auth.uid() is null or is_admin() then return new; end if;
  select m.league_id into lg from matchup m where m.id = new.matchup_id;
  if lg is null or not is_native_league(lg) then return new; end if;
  select sleeper_roster_id into rid from league_membership
    where league_id = lg and app_user_id = new.app_user_id and enrolled
    order by sleeper_roster_id limit 1;
  if rid is null then return new; end if;
  reason := roster_illegal_reason(lg, rid);
  if reason is not null then
    raise exception 'roster over limits — % (fix your roster to set lineups)', reason;
  end if;
  return new;
end $$;
drop trigger if exists enforce_legal_roster on sealed_pick;
create trigger enforce_legal_roster before insert or update on sealed_pick
  for each row execute function enforce_legal_roster();

-- ─────────────────────────────────────────────────────────────────────────────
-- FAAB waivers
-- ─────────────────────────────────────────────────────────────────────────────
-- submit v3: carries a bid in FAAB leagues (0 allowed — a free swing).
drop function if exists submit_waiver_claim(uuid, int, text, text);
create or replace function submit_waiver_claim(p_league_id uuid, p_roster_id int, p_add_slug text, p_drop_slug text default null, p_bid int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wu timestamptz; cnt int; cid uuid; err text; mode text; bid int := coalesce(p_bid, 0);
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
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
  if p_drop_slug is null then
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
    if cnt >= d.rounds then return jsonb_build_object('ok', false, 'error', 'roster full — include a drop'); end if;
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

-- process v3: FAAB resolves highest-bid-first (priority breaks ties) and the
-- winner pays; rolling keeps today's priority order. Winners rotate to the
-- back in both modes.
create or replace function process_waivers(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; d draft%rowtype; cnt int; won int := 0; lost int := 0; changed boolean := false;
  err text; mode text;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return jsonb_build_object('ok', true, 'won', 0, 'lost', 0); end if;
  mode := league_waiver_mode(p_league_id);

  for c in
    select wc.*, m.waiver_priority
    from waiver_claim wc
    join league_membership m on m.league_id = wc.league_id and m.sleeper_roster_id = wc.roster_id
    join league_pool lp on lp.league_id = wc.league_id and lp.slug = wc.add_slug
    where wc.league_id = p_league_id and wc.status = 'pending'
      and (lp.waived_until is null or lp.waived_until <= now())
    order by case when mode = 'faab' then -wc.bid else 0 end,
             m.waiver_priority nulls last, wc.created_at
  loop
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = c.add_slug) then
      update waiver_claim set status = 'lost', note = case when mode = 'faab' then 'outbid' else 'player taken' end,
        processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if c.drop_slug is not null and not exists (select 1 from native_roster
        where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug) then
      update waiver_claim set status = 'lost', note = 'drop player no longer on roster', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = c.roster_id;
    if c.drop_slug is null and cnt >= d.rounds then
      update waiver_claim set status = 'lost', note = 'roster full', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    -- a roster that went illegal while the claim sat pending is locked out
    if roster_illegal_reason(p_league_id, c.roster_id) is not null then
      update waiver_claim set status = 'lost', note = 'roster over limits', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    err := pos_cap_error(p_league_id, c.roster_id, c.add_slug, false, c.drop_slug);
    if err is not null then
      update waiver_claim set status = 'lost', note = 'position limit', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;
    if mode = 'faab' and c.bid > member_faab(p_league_id, c.roster_id) then
      update waiver_claim set status = 'lost', note = 'insufficient FAAB', processed_at = now() where id = c.id;
      lost := lost + 1; continue;
    end if;

    if c.drop_slug is not null then
      delete from native_roster where league_id = p_league_id and roster_id = c.roster_id and slug = c.drop_slug;
      update league_pool set waived_until = waiver_hold_until(p_league_id)
        where league_id = p_league_id and slug = c.drop_slug;
    end if;
    insert into native_roster (league_id, roster_id, slug, acquired) values (p_league_id, c.roster_id, c.add_slug, 'waiver');
    update waiver_claim set status = 'won', processed_at = now() where id = c.id;
    if mode = 'faab' and c.bid > 0 then
      update league_membership set faab_budget = member_faab(p_league_id, c.roster_id) - c.bid
        where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    end if;
    update league_membership set waiver_priority =
        (select coalesce(max(waiver_priority), 0) + 1 from league_membership where league_id = p_league_id)
      where league_id = p_league_id and sleeper_roster_id = c.roster_id;
    won := won + 1; changed := true;
  end loop;

  if changed then perform native_materialize(p_league_id); end if;
  return jsonb_build_object('ok', true, 'won', won, 'lost', lost);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trades
-- ─────────────────────────────────────────────────────────────────────────────

-- Would this roster stay legal after p_out leaves and p_in arrives? A trade
-- must land BOTH rosters fully legal — an overfilled/over-limit roster can
-- use a trade to dig OUT (2-for-1 down to legal), never to stay illegal.
create or replace function trade_cap_error(p_league_id uuid, p_roster_id int, p_out jsonb, p_in jsonb)
  returns text language plpgsql stable security definer set search_path = public as $$
declare rec record; cap int; cur int; rounds int; new_n int;
begin
  select d.rounds into rounds from draft d where d.league_id = p_league_id;
  select count(*) into cur from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  new_n := cur - jsonb_array_length(p_out) + jsonb_array_length(p_in);
  if new_n > rounds then
    return 'trade would overfill Team ' || p_roster_id || '''s roster (' || rounds || ' spots)';
  end if;
  for rec in
    select t.pos, sum(t.inc)::int as inc, sum(t.outc)::int as outc from (
      select lp.pos, 1 as inc, 0 as outc from jsonb_array_elements_text(p_in) s(slug)
        join league_pool lp on lp.league_id = p_league_id and lp.slug = s.slug
      union all
      select lp.pos, 0, 1 from jsonb_array_elements_text(p_out) s(slug)
        join league_pool lp on lp.league_id = p_league_id and lp.slug = s.slug
    ) t group by t.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null then
      select count(*) into cur
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      where nr.league_id = p_league_id and nr.roster_id = p_roster_id and lp.pos = rec.pos;
      new_n := cur - rec.outc + rec.inc;
      if new_n > cap then
        return 'position limit — Team ' || p_roster_id || ' would hold more than ' || cap || ' ' || pos_label(rec.pos);
      end if;
    end if;
  end loop;
  return null;
end $$;

-- Internal executor (no grant): re-validates, swaps, materializes.
create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; err text;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  -- every piece must still be where the deal said it was
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug))
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
  end if;
  err := coalesce(trade_cap_error(t.league_id, t.from_roster, t.give, t.get),
                  trade_cap_error(t.league_id, t.to_roster, t.get, t.give));
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  update native_roster nr set roster_id = t.to_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.from_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.give));
  update native_roster nr set roster_id = t.from_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.to_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.get));
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;

create or replace function propose_trade(
  p_league_id uuid, p_from_roster int, p_to_roster int,
  p_give jsonb, p_get jsonb, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid;
begin
  if not (owns_roster(p_league_id, p_from_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  if p_from_roster = p_to_roster
     or not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'pick another team to trade with');
  end if;
  if jsonb_typeof(p_give) <> 'array' or jsonb_typeof(p_get) <> 'array'
     or jsonb_array_length(p_give) > 10 or jsonb_array_length(p_get) > 10
     or jsonb_array_length(p_give) + jsonb_array_length(p_get) < 1 then
    return jsonb_build_object('ok', false, 'error', 'a trade moves 1–10 players each way');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_give || p_get))
     <> jsonb_array_length(p_give) + jsonb_array_length(p_get) then
    return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
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
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, note, created_by)
    values (p_league_id, p_from_roster, p_to_roster, p_give, p_get, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into tid;
  return jsonb_build_object('ok', true, 'trade_id', tid);
end $$;

create or replace function respond_trade(p_trade_id uuid, p_accept boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (owns_roster(t.league_id, t.to_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your trade to answer');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;   -- re-read under the lock
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status); end if;
  if not p_accept then
    update trade_proposal set status = 'rejected', responded_at = now(), resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  if league_trade_review(t.league_id) = 'commish' then
    update trade_proposal set status = 'accepted', responded_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'accepted', 'awaiting', 'commissioner approval');
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;   -- stays pending, error surfaced
  update trade_proposal set responded_at = now() where id = p_trade_id;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;

create or replace function cancel_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (owns_roster(t.league_id, t.from_roster) or is_league_commish(t.league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your trade');
  end if;
  if t.status not in ('pending', 'accepted') then
    return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status);
  end if;
  update trade_proposal set status = 'cancelled', resolved_at = now() where id = p_trade_id;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;

create or replace function commish_rule_trade(p_trade_id uuid, p_approve boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; r jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  if not (is_admin() or is_league_commish(t.league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(t.league_id::text));
  select * into t from trade_proposal where id = p_trade_id;
  if not p_approve then
    if t.status not in ('pending', 'accepted') then
      return jsonb_build_object('ok', false, 'error', 'trade already ' || t.status);
    end if;
    update trade_proposal set status = 'vetoed', resolved_at = now() where id = p_trade_id;
    return jsonb_build_object('ok', true, 'status', 'vetoed');
  end if;
  if t.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'error', 'both managers must agree first');
  end if;
  r := execute_trade(p_trade_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  return jsonb_build_object('ok', true, 'status', 'executed');
end $$;

-- Every league trade, newest first (any member — trades are public record).
create or replace function league_trades(p_league_id uuid, p_limit int default 30)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'from_roster', t.from_roster, 'to_roster', t.to_roster,
      'give', t.give, 'get', t.get, 'status', t.status, 'note', t.note,
      'created_at', t.created_at, 'resolved_at', t.resolved_at)
      order by t.created_at desc)
    from (select * from trade_proposal where league_id = p_league_id
          order by created_at desc limit least(p_limit, 100)) t), '[]'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Surface the rules + balances
-- ─────────────────────────────────────────────────────────────────────────────

-- roster_rules v2: + transaction rules (one loader for the dashboard editors).
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
    'waiver_hold_days', (select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1) from league where id = p_league_id),
    'fa_start_min', (select nullif(settings_json ->> 'fa_start_min', '')::int from league where id = p_league_id),
    'fa_end_min', (select nullif(settings_json ->> 'fa_end_min', '')::int from league where id = p_league_id));
end $$;

-- native_team_state v4: + waiver mode / trade review / FAAB balances / bids.
create or replace function native_team_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_roster int; d draft%rowtype; mode text;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select sleeper_roster_id into my_roster from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select * into d from draft where league_id = p_league_id;
  mode := league_waiver_mode(p_league_id);
  return jsonb_build_object(
    'my_roster_id', my_roster,
    'my_team', (select team_name from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'my_avatar', (select avatar_url from league_membership where league_id = p_league_id and sleeper_roster_id = my_roster),
    'league_avatar', (select avatar_url from league l where l.id = p_league_id),
    'is_commish', is_league_commish(p_league_id) or is_admin(),
    'draft_status', coalesce(d.status, 'none'),
    'roster_cap', d.rounds,
    'pos_caps', league_pos_caps(p_league_id),
    'waiver_mode', mode,
    'trade_review', league_trade_review(p_league_id),
    'my_faab', case when mode = 'faab' and my_roster is not null then member_faab(p_league_id, my_roster) end,
    'roster_issue', case when my_roster is not null then roster_illegal_reason(p_league_id, my_roster) end,
    'fa_open', fa_window_open(p_league_id),
    'fa_start_min', (select nullif(l.settings_json ->> 'fa_start_min', '')::int from league l where l.id = p_league_id),
    'fa_end_min', (select nullif(l.settings_json ->> 'fa_end_min', '')::int from league l where l.id = p_league_id),
    'waiver_clear_min', (select nullif(l.settings_json ->> 'waiver_clear_min', '')::int from league l where l.id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(l.settings_json ->> 'waiver_hold_days', '')::int, 1) from league l where l.id = p_league_id),
    'server_now', now(),
    'waiver_order', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'priority', m.waiver_priority,
        'avatar', m.avatar_url,
        'faab', case when mode = 'faab' then member_faab(p_league_id, m.sleeper_roster_id) end)
        order by m.waiver_priority nulls last, m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id),
    'my_claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'add_slug', c.add_slug, 'drop_slug', c.drop_slug, 'status', c.status,
        'note', c.note, 'bid', c.bid, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
      from waiver_claim c where c.league_id = p_league_id and c.roster_id = my_roster
        and (c.status = 'pending' or c.processed_at > now() - interval '7 days')));
end $$;

grant execute on function set_transaction_rules(uuid, text, int, text, int, int, int, int) to authenticated;
grant execute on function commish_move_player(uuid, text, int) to authenticated;
grant execute on function commish_remove_player(uuid, text, boolean) to authenticated;
grant execute on function propose_trade(uuid, int, int, jsonb, jsonb, text) to authenticated;
grant execute on function respond_trade(uuid, boolean) to authenticated;
grant execute on function cancel_trade(uuid) to authenticated;
grant execute on function commish_rule_trade(uuid, boolean) to authenticated;
grant execute on function league_trades(uuid, int) to authenticated;
