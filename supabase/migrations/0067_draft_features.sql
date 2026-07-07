-- 0067: DRAFT FEATURES — queue, autodraft, commissioner controls, auction mode.
--
--   • draft_queue — a manager's private ordered wishlist. Every autopick
--     (expired clock, vacant/AI seat, autodraft toggle) takes the manager's
--     queue first, then falls back to best-available-by-rank.
--   • league_membership.autodraft — self-serve "draft for me" toggle; the seat
--     picks instantly on its turn (queue → rank).
--   • Commissioner controls — pause/resume (clock freezes and restores),
--     force pick (with or without a chosen player), undo last pick.
--   • AUCTION mode — draft.mode 'auction': nomination rotates through the
--     draft order; open lot with rolling bid clock; highest bid wins at the
--     bell and pays from a per-team budget. Max bid always reserves $1 per
--     unfilled roster spot, so a team can never strand itself. Vacant/AI/
--     autodraft seats auto-nominate (queue → best available) at $1 and let it
--     ride. draft_tick drives awards + auto-nominations, same as snake — any
--     member's poll (or the worker sweep) advances the room.
--
-- All mutations keep the per-league advisory-lock discipline from 0064.

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists draft_queue (
  league_id uuid not null references league(id) on delete cascade,
  roster_id int  not null,
  slug      text not null,
  pos       int  not null,                 -- 1 = next up
  primary key (league_id, roster_id, slug)
);
create index if not exists draft_queue_order on draft_queue(league_id, roster_id, pos);

alter table league_membership add column if not exists autodraft boolean not null default false;
alter table league_membership add column if not exists draft_budget int;   -- auction wallet

alter table draft add column if not exists mode text not null default 'snake'
  check (mode in ('snake', 'auction'));
alter table draft add column if not exists budget int not null default 200;      -- auction: per team
alter table draft add column if not exists lot_seconds int not null default 15;  -- auction: bid clock
alter table draft add column if not exists paused boolean not null default false;
alter table draft add column if not exists pause_remaining int;                  -- secs left on the frozen clock
alter table draft add column if not exists lot_slug text;                        -- auction: open lot
alter table draft add column if not exists lot_bid int;
alter table draft add column if not exists lot_roster int;
alter table draft add column if not exists lot_deadline timestamptz;
alter table draft add column if not exists nom_idx int not null default 0;       -- auction: nomination rotation

alter table draft_pick add column if not exists price int;                       -- auction: winning bid

-- Queue rows are PRIVATE to the seat's manager (plus commish/admin via RPCs).
alter table draft_queue enable row level security;
drop policy if exists draft_queue_own on draft_queue;
create policy draft_queue_own on draft_queue for select using (
  exists (select 1 from league_membership m
          where m.league_id = draft_queue.league_id
            and m.sleeper_roster_id = draft_queue.roster_id
            and m.app_user_id = auth.uid())
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Queue + autodraft
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace a seat's whole queue (the client sends the full ordered list).
-- Unknown/rostered slugs are dropped silently — the queue self-cleans.
create or replace function set_draft_queue(p_league_id uuid, p_roster_id int, p_slugs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_slugs is null or jsonb_typeof(p_slugs) <> 'array' or jsonb_array_length(p_slugs) > 100 then
    return jsonb_build_object('ok', false, 'error', 'queue must be a list of up to 100 players');
  end if;
  delete from draft_queue where league_id = p_league_id and roster_id = p_roster_id;
  insert into draft_queue (league_id, roster_id, slug, pos)
  select p_league_id, p_roster_id, t.slug, min(t.ord)
  from jsonb_array_elements_text(p_slugs) with ordinality as t(slug, ord)
  where exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = t.slug)
    and not exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = t.slug)
  group by t.slug;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'queued', n);
end $$;

create or replace function set_autodraft(p_league_id uuid, p_roster_id int, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update league_membership set autodraft = coalesce(p_on, false)
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
  return jsonb_build_object('ok', true, 'autodraft', coalesce(p_on, false));
end $$;

-- First still-available queued player for a seat (and prune taken entries).
create or replace function native_queue_pick(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text;
begin
  delete from draft_queue q where q.league_id = p_league_id and q.roster_id = p_roster_id
    and exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = q.slug);
  select q.slug into pick from draft_queue q
    where q.league_id = p_league_id and q.roster_id = p_roster_id
    order by q.pos limit 1;
  return pick;
end $$;

-- Is this seat live-human-driven right now? (enrolled human, not AI, not autodraft)
create or replace function seat_is_live_human(p_league_id uuid, p_roster_id int)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_membership m
                 where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id
                   and m.app_user_id is not null and m.enrolled
                   and m.controller = 'human' and not m.autodraft);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auction helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function auction_spots_left(p_league_id uuid, p_roster_id int, p_rounds int)
  returns int language sql stable security definer set search_path = public as $$
  select p_rounds - (select count(*)::int from native_roster
                     where league_id = p_league_id and roster_id = p_roster_id);
$$;

-- Highest legal bid: keep $1 for every OTHER unfilled spot.
create or replace function auction_max_bid(p_league_id uuid, p_roster_id int, p_rounds int)
  returns int language sql stable security definer set search_path = public as $$
  select coalesce((select draft_budget from league_membership
                   where league_id = p_league_id and sleeper_roster_id = p_roster_id), 0)
         - greatest(0, auction_spots_left(p_league_id, p_roster_id, p_rounds) - 1);
$$;

-- The seat whose turn it is to nominate: scan the draft order from nom_idx,
-- skipping full rosters. Null ⇒ everyone's full (draft should complete).
create or replace function auction_nominator(d draft) returns int
  language plpgsql stable security definer set search_path = public as $$
declare n int; i int; rid int;
begin
  n := jsonb_array_length(d.draft_order);
  if n is null or n = 0 then return null; end if;
  for i in 0..(n - 1) loop
    rid := (d.draft_order ->> ((d.nom_idx + i) % n))::int;
    if auction_spots_left(d.league_id, rid, d.rounds) > 0 then return rid; end if;
  end loop;
  return null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Creation / start (mode + budget aware)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists create_native_league(text, text, int, int, int);
create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; e text; nm text; i int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'native leagues are in closed testing'); end if;
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league needs a name'); end if;
  if p_teams is null or p_teams < 2 or p_teams > 14 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–14');
  end if;
  if p_rounds is null or p_rounds < 5 or p_rounds > 25 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–25');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 86400 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–24h');
  end if;
  if coalesce(p_mode, 'snake') not in ('snake', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake or auction');
  end if;
  if p_mode = 'auction' and (p_budget is null or p_budget < p_rounds or p_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
  end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, synced_at)
  values ('native-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(btrim(p_season), ''), '2026'),
          nm, 'native', jsonb_build_object('teams', p_teams, 'rounds', p_rounds, 'mode', coalesce(p_mode, 'snake')), auth.uid(), now())
  returning id into lid;

  for i in 1..p_teams loop
    insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
    values (lid, i, 'Team ' || i, false);
  end loop;
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e
    where league_id = lid and sleeper_roster_id = 1;

  insert into draft (league_id, rounds, pick_seconds, mode, budget)
  values (lid, p_rounds, p_pick_seconds, coalesce(p_mode, 'snake'), coalesce(p_budget, 200));

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1,
    'invite_code', (select invite_code from league where id = lid));
end $$;

-- start_draft v2: auction mode seeds per-team budgets; nomination clock opens.
create or replace function start_draft(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; ord jsonb; n int; i int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  if (select count(*) from league_pool where league_id = p_league_id) < d.rounds * n then
    return jsonb_build_object('ok', false, 'error', 'pool smaller than the draft');
  end if;

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
    select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
  end if;

  update draft set status = 'live', draft_order = ord, current_overall = 1, nom_idx = 0,
    deadline_at = now() + make_interval(secs => d.pick_seconds), started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership set draft_budget = d.budget where league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode);
end $$;

-- make_draft_pick v2: reject while paused or in auction mode.
create or replace function make_draft_pick(p_league_id uuid, p_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; oc int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if d.mode = 'auction' then return jsonb_build_object('ok', false, 'error', 'auction draft — nominate and bid'); end if;
  oc := draft_on_clock(d);
  if not (owns_roster(p_league_id, oc) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your pick');
  end if;
  return native_exec_pick(p_league_id, p_slug, false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Commissioner controls
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function commish_pause_draft(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; active timestamptz;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'already paused'); end if;
  active := coalesce(d.lot_deadline, d.deadline_at);
  update draft set paused = true,
    pause_remaining = greatest(1, coalesce(extract(epoch from active - now())::int, d.pick_seconds))
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'paused', true);
end $$;

create or replace function commish_resume_draft(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or not d.paused then return jsonb_build_object('ok', false, 'error', 'not paused'); end if;
  if d.lot_slug is not null then
    update draft set paused = false, pause_remaining = null,
      lot_deadline = now() + make_interval(secs => coalesce(d.pause_remaining, d.lot_seconds))
      where league_id = p_league_id;
  else
    update draft set paused = false, pause_remaining = null,
      deadline_at = now() + make_interval(secs => coalesce(d.pause_remaining, d.pick_seconds))
      where league_id = p_league_id;
  end if;
  return jsonb_build_object('ok', true, 'paused', false);
end $$;

-- Force the on-clock pick through (snake): a chosen player, or queue/best-available.
create or replace function commish_force_pick(p_league_id uuid, p_slug text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; oc int; pick text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  if d.mode <> 'snake' then return jsonb_build_object('ok', false, 'error', 'snake drafts only'); end if;
  oc := draft_on_clock(d);
  pick := coalesce(p_slug, native_queue_pick(p_league_id, oc), native_autopick_slug(p_league_id, oc, d.rounds));
  if pick is null then return jsonb_build_object('ok', false, 'error', 'no pickable player'); end if;
  return native_exec_pick(p_league_id, pick, p_slug is null);
end $$;

-- Undo the most recent pick (snake): back onto the board, clock resets.
create or replace function commish_undo_pick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; last draft_pick%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status not in ('live', 'complete') then return jsonb_build_object('ok', false, 'error', 'no draft to unwind'); end if;
  if d.mode <> 'snake' then return jsonb_build_object('ok', false, 'error', 'snake drafts only'); end if;
  select * into last from draft_pick where league_id = p_league_id order by overall desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'nothing to undo'); end if;
  delete from draft_pick where league_id = p_league_id and overall = last.overall;
  delete from native_roster where league_id = p_league_id and roster_id = last.roster_id and slug = last.slug;
  update draft set status = 'live', completed_at = null, current_overall = last.overall,
    deadline_at = case when d.paused then null else now() + make_interval(secs => d.pick_seconds) end
    where league_id = p_league_id;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'undone_overall', last.overall, 'slug', last.slug, 'roster_id', last.roster_id);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auction: nominate + bid
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function nominate(p_league_id uuid, p_slug text, p_bid int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; nom int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no live auction');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if d.lot_slug is not null then return jsonb_build_object('ok', false, 'error', 'a lot is already open'); end if;
  nom := auction_nominator(d);
  if nom is null then return jsonb_build_object('ok', false, 'error', 'no seat can nominate'); end if;
  if not (owns_roster(p_league_id, nom) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your nomination');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if p_bid is null or p_bid < 1 or p_bid > auction_max_bid(p_league_id, nom, d.rounds) then
    return jsonb_build_object('ok', false, 'error', 'opening bid exceeds your max');
  end if;
  update draft set lot_slug = p_slug, lot_bid = p_bid, lot_roster = nom,
    lot_deadline = now() + make_interval(secs => d.lot_seconds), deadline_at = null
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'lot', p_slug, 'bid', p_bid, 'roster_id', nom);
end $$;

create or replace function place_bid(p_league_id uuid, p_roster_id int, p_amount int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (owns_roster(p_league_id, p_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' or d.lot_slug is null then
    return jsonb_build_object('ok', false, 'error', 'no open lot');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if d.lot_deadline <= now() then return jsonb_build_object('ok', false, 'error', 'lot closed'); end if;
  if d.lot_roster = p_roster_id then return jsonb_build_object('ok', false, 'error', 'you are the high bidder'); end if;
  if auction_spots_left(p_league_id, p_roster_id, d.rounds) < 1 then
    return jsonb_build_object('ok', false, 'error', 'your roster is full');
  end if;
  if p_amount is null or p_amount <= d.lot_bid then
    return jsonb_build_object('ok', false, 'error', 'bid must beat $' || d.lot_bid);
  end if;
  if p_amount > auction_max_bid(p_league_id, p_roster_id, d.rounds) then
    return jsonb_build_object('ok', false, 'error', 'over your max bid of $' || auction_max_bid(p_league_id, p_roster_id, d.rounds));
  end if;
  update draft set lot_bid = p_amount, lot_roster = p_roster_id,
    lot_deadline = greatest(d.lot_deadline, now() + make_interval(secs => d.lot_seconds))
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'bid', p_amount);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- draft_tick v2: snake autopicks take the QUEUE first; autodraft seats are
-- auto; paused drafts don't move; auction awards lots + auto-nominates.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function draft_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; oc int; pick text; made int := 0; r jsonb; n int; nom int; won int := 0;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  loop
    select * into d from draft where league_id = p_league_id;
    exit when not found or d.status <> 'live' or d.paused;
    n := jsonb_array_length(d.draft_order);

    if d.mode = 'auction' then
      if d.lot_slug is not null then
        -- award the lot at the bell
        exit when d.lot_deadline > now();
        insert into draft_pick (league_id, overall, round, roster_id, slug, auto, price)
        values (p_league_id, d.current_overall, ((d.current_overall - 1) / n) + 1, d.lot_roster, d.lot_slug, false, d.lot_bid);
        insert into native_roster (league_id, roster_id, slug, acquired)
        values (p_league_id, d.lot_roster, d.lot_slug, 'draft');
        update league_membership set draft_budget = draft_budget - d.lot_bid
          where league_id = p_league_id and sleeper_roster_id = d.lot_roster;
        update draft set current_overall = d.current_overall + 1,
          lot_slug = null, lot_bid = null, lot_roster = null, lot_deadline = null,
          nom_idx = d.nom_idx + 1,
          deadline_at = now() + make_interval(secs => d.pick_seconds)
          where league_id = p_league_id;
        won := won + 1;
        if not exists (select 1 from league_membership m where m.league_id = p_league_id
                       and auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds) > 0) then
          update draft set status = 'complete', completed_at = now(), deadline_at = null
            where league_id = p_league_id;
          perform native_materialize(p_league_id);
          exit;
        end if;
      else
        -- nomination phase
        nom := auction_nominator(d);
        if nom is null then
          update draft set status = 'complete', completed_at = now(), deadline_at = null
            where league_id = p_league_id;
          perform native_materialize(p_league_id);
          exit;
        end if;
        exit when seat_is_live_human(p_league_id, nom) and coalesce(d.deadline_at > now(), false);
        pick := coalesce(native_queue_pick(p_league_id, nom), native_autopick_slug(p_league_id, nom, d.rounds));
        exit when pick is null;
        update draft set lot_slug = pick, lot_bid = 1, lot_roster = nom,
          lot_deadline = now() + make_interval(secs => d.lot_seconds), deadline_at = null
          where league_id = p_league_id;
        made := made + 1;
      end if;
    else
      -- snake
      oc := draft_on_clock(d);
      exit when seat_is_live_human(p_league_id, oc) and coalesce(d.deadline_at > now(), false);
      pick := coalesce(native_queue_pick(p_league_id, oc), native_autopick_slug(p_league_id, oc, d.rounds));
      exit when pick is null;
      r := native_exec_pick(p_league_id, pick, true);
      exit when not coalesce((r ->> 'ok')::boolean, false);
      made := made + 1;
    end if;
    exit when made + won >= 200;  -- one call never runs unbounded
  end loop;
  return jsonb_build_object('ok', true, 'autopicks', made, 'lots_awarded', won);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- draft_state v3: mode/pause/auction lot/budgets; on_clock = nominator in
-- auction; on_clock_auto reflects autodraft too.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  oc := case when d.status = 'live' then
    case when d.mode = 'auction' then auction_nominator(d) else draft_on_clock(d) end end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto, 'price', dp.price) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'mode', d.mode, 'rounds', d.rounds, 'pick_seconds', d.pick_seconds,
    'paused', d.paused,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    'budget', case when d.mode = 'auction' then d.budget end,
    'lot', case when d.lot_slug is not null then jsonb_build_object(
      'slug', d.lot_slug, 'bid', d.lot_bid, 'roster_id', d.lot_roster, 'deadline_at', d.lot_deadline) end,
    'budgets', case when d.mode = 'auction' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'budget', m.draft_budget,
        'spots_left', auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds),
        'max_bid', auction_max_bid(p_league_id, m.sleeper_roster_id, d.rounds))
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id) end,
    'my_autodraft', coalesce((select m.autodraft from league_membership m
      where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
      order by m.sleeper_roster_id limit 1), false));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function create_native_league(text, text, int, int, int, text, int) to authenticated;
grant execute on function set_draft_queue(uuid, int, jsonb) to authenticated;
grant execute on function set_autodraft(uuid, int, boolean) to authenticated;
grant execute on function commish_pause_draft(uuid) to authenticated;
grant execute on function commish_resume_draft(uuid) to authenticated;
grant execute on function commish_force_pick(uuid, text) to authenticated;
grant execute on function commish_undo_pick(uuid) to authenticated;
grant execute on function nominate(uuid, text, int) to authenticated;
grant execute on function place_bid(uuid, int, int) to authenticated;
