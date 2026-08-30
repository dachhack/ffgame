-- 0269: THE COVEN WEARS ITS FANGS (v0.380.0).
--
-- Founder: "let's make it clear in the draft which teams are vampires and
-- won't get picks. Also make it clear throughout the app/web experience."
--
-- 0268 made vampire seats skip the draft — correctly, and silently: the
-- draft room simply showed three columns where the league has four, and
-- nothing anywhere else said which seats are undead. Three reads every
-- relevant screen already polls now carry the fact, so no surface needs a
-- second round-trip:
--
--   • draft_state gains `vampires` [{roster_id, team}] — both draft rooms
--     poll it, and render the "sitting this draft out" banner from it;
--   • league_standings rows gain `vampire` — the standings lists on both
--     hosts badge the row;
--   • admin_league_members rows gain `vampire` — the members tabs (web
--     admin console, app commish teams) badge the seat.
--
-- ALL THREE BODIES ARE COPIED FROM THE LIVE DEFINITIONS (draft_state: 0193;
-- league_standings: 0249; admin_league_members: 0253) with only the
-- additions above. Every flag is gated on league_format = 'vampire', so a
-- league that flipped back to standard with stale vampire_rosters in its
-- settings shows nothing.

-- ── draft_state v-next (0193 + vampires) ─────────────────────────────────────
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int; eff_rounds int;
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
  eff_rounds := case
    when d.pick_owners is not null and jsonb_array_length(coalesce(d.draft_order, '[]'::jsonb)) > 0
      then (jsonb_array_length(d.pick_owners) + jsonb_array_length(d.draft_order) - 1)
           / jsonb_array_length(d.draft_order)
    -- pending on a rolled dynasty league: preview the asset-derived rounds
    -- the start will build, not rounds − keepers
    when d.status = 'pending' and d.mode = 'snake' then coalesce(
      (select max(pa.round) from pick_asset pa join league l on l.id = p_league_id
        where pa.league_id = p_league_id and pa.season = l.season),
      d.rounds - d.keeper_slots - d.stash_slots)
    else d.rounds - d.keeper_slots - d.stash_slots end;
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
    'status', d.status, 'mode', d.mode, 'rounds', eff_rounds,
    'keeper_slots', d.keeper_slots, 'roster_size', d.rounds, 'stash_slots', d.stash_slots,
    'pick_owners', d.pick_owners,
    'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'max_lots', d.max_lots, 'paused', d.paused,
    'is_mock', coalesce((select l.is_mock from league l where l.id = p_league_id), false),
    'pos_caps', league_pos_caps(p_league_id),
    'start_at', d.start_at,
    'night', case when d.night_start_min is not null then jsonb_build_object(
      'start_min', d.night_start_min, 'end_min', d.night_end_min,
      'is_night', is_night_minute(et_minutes(now()), d.night_start_min, d.night_end_min)) end,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    -- 0269: who sits this draft out. Named, so the room can SAY it instead
    -- of quietly showing fewer columns than the league has teams.
    'vampires', case when league_format(p_league_id) = 'vampire' then coalesce((
      select jsonb_agg(jsonb_build_object('roster_id', m.sleeper_roster_id, 'team', m.team_name)
             order by m.sleeper_roster_id)
      from league_membership m
      where m.league_id = p_league_id
        and m.sleeper_roster_id = any(coalesce(vampire_seats(p_league_id), '{}'))
    ), '[]'::jsonb) else '[]'::jsonb end,
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

-- ── league_standings v-next (0249 + the vampire flag) ────────────────────────
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name, 'division', z.division,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa,
        'vampire', league_format(p_league_id) = 'vampire' and is_vampire_seat(p_league_id, z.rid))
      order by z.w desc, case when league_golf(p_league_id) then -z.pf else z.pf end desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name, m.division,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa
      from league_membership m
      left join (
        select x.rid, count(*) filter (where golf_beats(p_league_id, x.us, x.them)) as w,
               count(*) filter (where golf_beats(p_league_id, x.them, x.us)) as l,
               count(*) filter (where x.us = x.them) as t,
               sum(x.us) as pf, sum(x.them) as pa
        from (
          select mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
          union all
          select mu.away_roster_id, mu.away_final, mu.home_final
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;
grant execute on function league_standings(uuid) to authenticated;

-- ── admin_league_members v-next (0253 + the vampire flag) ────────────────────
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb; pw int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  pw := (select min(week) from matchup
          where league_id = p_league_id and is_practice_week(week) and status <> 'final');
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username,
    'avatar', m.avatar_url, 'claim_email', m.claim_email,
    'coin', case when pw is not null then coalesce(p.coins, practice_budget()) else coalesce(w.coins, 0) end,
    'division', m.division,
    'vampire', league_format(p_league_id) = 'vampire' and is_vampire_seat(m.league_id, m.sleeper_roster_id),
    'drifted', (
      coalesce(l.provider, 'sleeper') = 'sleeper'
      and m.enrolled
      and m.claim_email is null
      and u.sleeper_user_id is distinct from m.sleeper_owner_id
    )
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m
    join league l on l.id = m.league_id
    left join app_user u on u.id = m.app_user_id
    left join team_wallet w on w.league_id = m.league_id and w.roster_id = m.sleeper_roster_id
    left join practice_wallet p on p.league_id = m.league_id and p.roster_id = m.sleeper_roster_id and p.week = pw
  where m.league_id = p_league_id;
  return result;
end $$;
