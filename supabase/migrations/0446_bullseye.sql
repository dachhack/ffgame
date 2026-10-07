-- ═══════════════════════════════════════════════════════════════════════════
-- 0446 · BULLSEYE — aim your lineup at a number (docs/bullseye.md).
--
-- Founder: "have your players try to get as close as possible to a final
-- total and/or totals for each spot are assigned (even numbers 5, 10, 15, 20)
-- randomly by the CPU. Could do head to head and weekly ranked battles" —
-- "for classic mode".
--
-- A CLASSIC-LEAGUE SETTING, modelled on golf (0200): one key on the league,
-- commissioner-only, classic-only, frozen at the draft, off by default so a
-- league that never opens it is untouched. Each week the worker deals the
-- league a CARD — a target per starting spot (SLOTS) or one number for the
-- lineup (TOTAL) — and every starter's points become a dart at it: the
-- closer, the more it banks; a zero is a miss; inside half a point is a
-- bullseye and pays double. The arithmetic lives in the engine
-- (packages/core/src/engine/bullseye.ts), where the resolver, the auto-slot,
-- the AI seats and both boards read it through one install.
--
-- WHAT THIS CHANGES SERVER-SIDE: nothing about standings, playoffs or
-- tiebreaks. The matchup finals the worker stamps are RING totals, and higher
-- still wins. (Golf inverts that, which would reward the worst aim, so the two
-- settings refuse each other.) The card table is the published record of what
-- the league aimed at: service-role written, league-readable, so a board that
-- has not yet seen the rows deals the same card from the same seed and a probe
-- can audit the worker's.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The reader ─────────────────────────────────────────────────────────────
/** The league's bullseye variant ('slots' | 'total'), null when off. */
create or replace function league_bullseye(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when (select settings_json ->> 'bullseye' from league where id = p_league_id) in ('slots', 'total')
              then (select settings_json ->> 'bullseye' from league where id = p_league_id) end;
$$;
grant execute on function league_bullseye(uuid) to authenticated;

-- ── The setter ─────────────────────────────────────────────────────────────
-- p_variant: 'slots' | 'total' | null/'off'. p_radius: 2..50, null keeps the
-- engine default (10). SQL stores the sanitized value; the engine owns the
-- defaults and the arithmetic.
create or replace function set_league_bullseye(p_league_id uuid, p_variant text, p_radius int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; v text := lower(nullif(btrim(coalesce(p_variant, '')), '')); r int := p_radius;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'bullseye is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'bullseye locks once the draft starts — you draft a bullseye league for floor, not ceiling');
  end if;
  if v = 'off' then v := null; end if;
  if v is not null and v not in ('slots', 'total') then
    return jsonb_build_object('ok', false, 'error', 'bullseye is slots, total or off');
  end if;
  if r is not null and (r < 2 or r > 50) then
    return jsonb_build_object('ok', false, 'error', 'the radius must be 2-50 points');
  end if;
  if v is not null and league_golf(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'bullseye and golf cannot both be on — lowest ring score winning would reward the worst aim');
  end if;
  if v is null then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'bullseye' - 'bullseye_radius'
      where id = p_league_id;
  else
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('bullseye', v)
        || case when r is null then '{}'::jsonb else jsonb_build_object('bullseye_radius', r) end
      where id = p_league_id;
  end if;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'bullseye', v,
    'radius', (select (settings_json ->> 'bullseye_radius')::int from league where id = p_league_id));
end $$;
grant execute on function set_league_bullseye(uuid, text, int) to authenticated;

-- ── set_league_golf — 0200's body, plus the one new rail ───────────────────
create or replace function set_league_golf(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'golf mode is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'golf mode locks once the draft starts — the whole board is valued differently');
  end if;
  -- 0446: the one new rail.
  if coalesce(p_on, false) and league_bullseye(p_league_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'golf and bullseye cannot both be on — lowest ring score winning would reward the worst aim');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('golf', coalesce(p_on, false))
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'golf', coalesce(p_on, false));
end $$;
grant execute on function set_league_golf(uuid, boolean) to authenticated;

-- ── The card ───────────────────────────────────────────────────────────────
create table if not exists bullseye_card (
  league_id uuid    not null references league(id) on delete cascade,
  week      int     not null,
  slot      text    not null,   -- a starting spot's slot id, or 'TOTAL' (the card's sum)
  target    numeric not null check (target >= 0),
  dealt_at  timestamptz not null default now(),
  primary key (league_id, week, slot)
);
alter table bullseye_card enable row level security;
-- The league's business, like a correction (0355): members read; the worker
-- (service role, which bypasses RLS) writes. No insert/update policy on
-- purpose — nobody else deals.
drop policy if exists bullseye_card_read on bullseye_card;
create policy bullseye_card_read on bullseye_card for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());

/** The published card for a week: [{slot, target}], the TOTAL row included.
 *  Empty when the worker has not dealt it yet — the boards then deal the
 *  same card from the same seed (engine dealBullseyeCard). */
create or replace function bullseye_card(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'bullseye', league_bullseye(p_league_id),
    'radius', (select (settings_json ->> 'bullseye_radius')::int from league where id = p_league_id),
    'card', coalesce((
      select jsonb_agg(jsonb_build_object('slot', c.slot, 'target', c.target) order by (c.slot = 'TOTAL'), c.slot)
        from bullseye_card c where c.league_id = p_league_id and c.week = p_week), '[]'::jsonb));
end $$;
grant execute on function bullseye_card(uuid, int) to authenticated;

-- ── The week board — "weekly ranked" ───────────────────────────────────────
/** Every team's FINAL for a week, ranked highest first (ties share a rank).
 *  In a bullseye league a final is a ring total, so this is the week's darts
 *  board; in any other league it is the week's scoring table. */
create or replace function bullseye_week_board(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'bullseye', league_bullseye(p_league_id), 'week', p_week,
    'board', coalesce((
      select jsonb_agg(jsonb_build_object('rank', z.rk, 'roster_id', z.rid, 'team', z.team_name, 'final', z.fin) order by z.rk, z.rid)
      from (
        select x.rid, m.team_name, x.fin, rank() over (order by x.fin desc) as rk
        from (
          select mu.home_roster_id as rid, mu.home_final as fin from matchup mu
           where mu.league_id = p_league_id and mu.week = p_week and mu.status = 'final' and mu.home_final is not null
          union all
          select mu.away_roster_id, mu.away_final from matchup mu
           where mu.league_id = p_league_id and mu.week = p_week and mu.status = 'final' and mu.away_final is not null
             and mu.away_roster_id <> mu.home_roster_id
        ) x
        join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = x.rid
      ) z), '[]'::jsonb));
end $$;
grant execute on function bullseye_week_board(uuid, int) to authenticated;

-- ── league_game_mode — 0426's body, carrying the setting to the screens ────
create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((l.settings_json ->> 'ppr')::numeric, 1),
      'classic_ok', coalesce((l.settings_json ->> 'classic_ok')::boolean, false),
      'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
      'scoring', coalesce(l.settings_json -> 'scoring_classic', '{}'::jsonb),
      'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
      'slots', l.settings_json -> 'roster_slots',
      'shape', l.settings_json -> 'roster_shape',
      'rounds', (select rounds from draft d where d.league_id = l.id),
      'positions', l.settings_json -> 'positions_extra',
      'pool_filter', l.settings_json -> 'pool_filter',
      'golf', league_golf(p_league_id),
      -- BULLSEYE (0446): the variant and the radius override, read here
      -- because every screen that needs them already loads the mode.
      'bullseye', league_bullseye(p_league_id),
      'bullseye_radius', (l.settings_json ->> 'bullseye_radius')::int,
      'sport', coalesce(l.sport, 'nfl'),
      'sport_settings', l.settings_json -> 'sport',
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;
grant execute on function league_game_mode(uuid) to authenticated;
