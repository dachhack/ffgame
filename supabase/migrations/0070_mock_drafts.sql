-- 0070: MOCK DRAFTS — throwaway practice rooms against the AI.
--
-- A mock is a regular native league with league.is_mock = true and every seat
-- but the creator's handed to the AI (league_membership.controller = 'ai').
-- That single flag buys the whole feature, because the machinery already
-- exists: draft_tick autopicks/auto-nominates for any seat that isn't a live
-- human (0064/0067), and the auction AI values players and counter-bids
-- second-price style (0068/0069). Snake and auction, live and slow clocks,
-- parallel lots — all four combinations work unchanged.
--
-- What a mock deliberately does NOT get:
--   • a schedule — the client never calls native_generate_schedule, so
--     native_materialize (which loops over matchup weeks) is a natural no-op
--     and nothing leaks into the season pipeline;
--   • joiners — native_join refuses, so an invite code can't seat a friend at
--     an AI team mid-practice;
--   • permanence — delete_mock_draft lets its creator wipe it in one call
--     (league cascades clean every child table).

-- Also fixed here (found by the mock-auction probe): with parallel lots, one
-- draft_tick can auto-nominate for SEVERAL non-human seats back-to-back, and
-- native_autopick_slug/native_queue_pick only excluded ROSTERED players — not
-- players already on the block. The second AI seat would re-nominate the same
-- best-ranked player, hit auction_lot's (league_id, slug) unique constraint,
-- and abort the whole tick... every tick, forever: a live auction frozen at
-- 0:00 with no lots open and no error anywhere. Both helpers now skip
-- on-the-block slugs (snake drafts have no lots, so they're unaffected).

alter table league add column if not exists is_mock boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Autopick v2 + queue-pick v2: a player on the auction block is not available.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  qb_n int; te_n int; k_n int; def_n int; total int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text;
begin
  select count(*) filter (where lp.pos = 'QB'),
         count(*) filter (where lp.pos = 'TE'),
         count(*) filter (where lp.pos = 'K'),
         count(*) filter (where lp.pos = 'DEF'),
         count(*)
    into qb_n, te_n, k_n, def_n, total
  from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id;

  remaining := p_rounds - total;
  need_k   := k_n = 0;
  need_def := def_n = 0;
  forced := (case when need_k then 1 else 0 end) + (case when need_def then 1 else 0 end);

  if remaining <= forced and forced > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and lp.pos = (case when need_k then 'K' else 'DEF' end)
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
      and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    and (   (lp.pos = 'QB'  and qb_n  < 3)
         or (lp.pos = 'TE'  and te_n  < 3)
         or (lp.pos = 'K'   and k_n   < 1)
         or (lp.pos = 'DEF' and def_n < 1)
         or lp.pos in ('RB', 'WR'))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board (tiny pools) — take the best free player outright.
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
  order by lp.rank limit 1;
  return pick;
end $$;

-- Queue-pick: prune ROSTERED entries (gone for good), but only SKIP on-the-block
-- ones — the seat may still win that lot, and if a rival takes it the entry is
-- pruned as rostered on a later pass.
create or replace function native_queue_pick(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text;
begin
  delete from draft_queue q where q.league_id = p_league_id and q.roster_id = p_roster_id
    and exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = q.slug);
  select q.slug into pick from draft_queue q
    where q.league_id = p_league_id and q.roster_id = p_roster_id
      and not exists (select 1 from auction_lot al where al.league_id = p_league_id and al.slug = q.slug)
    order by q.pos limit 1;
  return pick;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Create: wrap create_native_league (same validation + closed-testing gate),
-- then flag the league and hand seats 2..N to named bots.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function create_mock_draft(
  p_teams int, p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; lid uuid;
  bots text[] := array['Otto Pick','Max Bid','Al Gorithm','Robo Rodgers',
    'Data Drip','Neural Nate','Circuit Chase','Binary Barkley','Cache Kupp',
    'Vector Vick','Pixel Prescott','Tensor Tucker','Logic Lamb'];
begin
  r := create_native_league(
    'Mock ' || to_char(now() at time zone 'America/New_York', 'Mon FMDD, FMHH12:MI am'),
    '2026', p_teams, p_rounds, p_pick_seconds, p_mode, p_budget,
    p_lot_seconds, p_max_lots, null, null);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  lid := (r ->> 'league_id')::uuid;
  update league set is_mock = true where id = lid;
  update league_membership m
    set controller = 'ai', team_name = bots[m.sleeper_roster_id - 1]
    where m.league_id = lid and m.sleeper_roster_id > 1;
  return r || jsonb_build_object('is_mock', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- No joining a mock (the invite code still exists — league creation mints one —
-- but it must not seat anyone at a bot's team).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function native_join(p_code text, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; seat int; e text; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid invite code'); end if;
  if lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league — use the join flow'); end if;
  if lg.is_mock then return jsonb_build_object('ok', false, 'error', 'mock drafts are solo practice rooms — no joining'); end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  -- Already seated? Idempotent.
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id = auth.uid() and enrolled limit 1;
  if seat is not null then
    return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled');
  end if;

  perform pg_advisory_xact_lock(hashtext(lg.id::text));
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id is null and not enrolled
    order by sleeper_roster_id limit 1;
  if seat is null then return jsonb_build_object('ok', false, 'error', 'league is full'); end if;

  nm := nullif(btrim(coalesce(p_team_name, '')), '');
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e,
        team_name = coalesce(nm, team_name)
    where league_id = lg.id and sleeper_roster_id = seat;
  delete from league_join where league_id = lg.id and app_user_id = auth.uid();

  return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled', 'league', lg.name);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Delete: the mock's commissioner (or an admin) wipes it whenever — mid-draft
-- or after. Cascade cleans every child table. Refuses real leagues.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function delete_mock_draft(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare mock boolean;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select is_mock into mock from league where id = p_league_id;
  if mock is null then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  if not mock then return jsonb_build_object('ok', false, 'error', 'not a mock draft — real leagues are deleted by an admin'); end if;
  delete from league where id = p_league_id;
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- draft_state v7: the room needs to know it's a mock (badge + completion card).
-- Identical to v6 (0069) plus 'is_mock'.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select count(*)::int into open_lots from auction_lot where league_id = p_league_id;
  oc := case when d.status = 'live' then
    case when d.mode = 'auction'
      then (case when open_lots < d.max_lots then auction_nominator(d) end)
      else draft_on_clock(d) end end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto, 'price', dp.price) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', al.id, 'slug', al.slug, 'bid', al.bid, 'roster_id', al.roster_id,
      'deadline_at', al.deadline,
      'my_proxy', case when my_r is not null then
        (select px.max_amount from lot_proxy px where px.lot_id = al.id and px.roster_id = my_r) end,
      'my_max', case when my_r is not null then auction_lot_max(p_league_id, my_r, d.rounds, al.id) end
    ) order by al.created_at), '[]'::jsonb)
    into lots from auction_lot al where al.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'mode', d.mode, 'rounds', d.rounds, 'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'max_lots', d.max_lots, 'paused', d.paused,
    'is_mock', coalesce((select l.is_mock from league l where l.id = p_league_id), false),
    'night', case when d.night_start_min is not null then jsonb_build_object(
      'start_min', d.night_start_min, 'end_min', d.night_end_min,
      'is_night', is_night_minute(et_minutes(now()), d.night_start_min, d.night_end_min)) end,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    'budget', case when d.mode = 'auction' then d.budget end,
    'lots', lots,
    'budgets', case when d.mode = 'auction' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'budget', m.draft_budget,
        'committed', auction_committed(p_league_id, m.sleeper_roster_id),
        'spots_left', auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds),
        'max_bid', auction_lot_max(p_league_id, m.sleeper_roster_id, d.rounds, null))
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id) end,
    'my_autodraft', coalesce((select m.autodraft from league_membership m
      where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
      order by m.sleeper_roster_id limit 1), false));
end $$;

grant execute on function create_mock_draft(int, int, int, text, int, int, int) to authenticated;
grant execute on function delete_mock_draft(uuid) to authenticated;
