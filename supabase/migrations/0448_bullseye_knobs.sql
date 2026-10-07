-- ═══════════════════════════════════════════════════════════════════════════
-- 0448 · BULLSEYE'S KNOBS — hybrid, fixed rings, a card per team
-- (docs/bullseye.md §11 → shipped, v0.645.0).
--
-- Founder: "keep cooking. We want any zero to count for the did not play
-- rule." The zero rule is the engine's (ringScore: a 0.0 is a miss, whatever
-- the target); this migration is the rest of the open list:
--
--   • a third variant, HYBRID — the SLOTS darts plus the lineup's sum as one
--     more dart on the TOTAL scale, worth what one spot is worth;
--   • bullseye_rings: 'continuous' (default, radius − distance) | 'fixed'
--     (the darts-board reading: 2×radius / radius / radius÷2 / 0 by band);
--   • bullseye_deal: 'shared' (default, one card for the league) | 'team'
--     (every roster its own card from its own seed).
--
-- The card table gains roster_id (0 = the shared card) so a per-team deal
-- publishes a card per roster under the same (league, week). Readers hand
-- the rows back with roster_id; the engine's cardsFromRows sorts them out.
-- Everything else stands as 0446/0447 left it: commissioner-only, classic-
-- only, frozen at the draft, never with golf, higher ring total wins.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The reader: 'hybrid' is a variant now ──────────────────────────────────
create or replace function league_bullseye(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when (select settings_json ->> 'bullseye' from league where id = p_league_id) in ('slots', 'total', 'hybrid')
              then (select settings_json ->> 'bullseye' from league where id = p_league_id) end;
$$;

-- ── The setter: variant, radius, rings, deal ───────────────────────────────
-- One signature; the 0446 three-argument form goes so a call can't be
-- ambiguous. null keeps a knob as it is; 'off' (or null) on the variant
-- clears every key.
drop function if exists set_league_bullseye(uuid, text, int);
create or replace function set_league_bullseye(p_league_id uuid, p_variant text, p_radius int default null, p_rings text default null, p_deal text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; v text := lower(nullif(btrim(coalesce(p_variant, '')), '')); r int := p_radius;
        rg text := lower(nullif(btrim(coalesce(p_rings, '')), '')); dl text := lower(nullif(btrim(coalesce(p_deal, '')), ''));
        patch jsonb := '{}'::jsonb; cur jsonb;
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
  if v is not null and v not in ('slots', 'total', 'hybrid') then
    return jsonb_build_object('ok', false, 'error', 'bullseye is slots, total, hybrid or off');
  end if;
  if r is not null and (r < 2 or r > 50) then
    return jsonb_build_object('ok', false, 'error', 'the radius must be 2-50 points');
  end if;
  if rg is not null and rg not in ('continuous', 'fixed') then
    return jsonb_build_object('ok', false, 'error', 'rings are continuous or fixed');
  end if;
  if dl is not null and dl not in ('shared', 'team') then
    return jsonb_build_object('ok', false, 'error', 'the deal is shared or team');
  end if;
  if v is not null and league_golf(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'bullseye and golf cannot both be on — lowest ring score winning would reward the worst aim');
  end if;
  if v is null then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'bullseye' - 'bullseye_radius' - 'bullseye_rings' - 'bullseye_deal'
      where id = p_league_id;
  else
    patch := jsonb_build_object('bullseye', v);
    if r is not null then patch := patch || jsonb_build_object('bullseye_radius', r); end if;
    if rg is not null then patch := patch || jsonb_build_object('bullseye_rings', rg); end if;
    if dl is not null then patch := patch || jsonb_build_object('bullseye_deal', dl); end if;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) || patch where id = p_league_id;
  end if;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select settings_json into cur from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'bullseye', v,
    'radius', (cur ->> 'bullseye_radius')::int,
    'rings', cur ->> 'bullseye_rings',
    'deal', cur ->> 'bullseye_deal');
end $$;
grant execute on function set_league_bullseye(uuid, text, int, text, text) to authenticated;

-- ── The card: a row per roster under a per-team deal ───────────────────────
alter table bullseye_card add column if not exists roster_id int not null default 0;
alter table bullseye_card drop constraint if exists bullseye_card_pkey;
alter table bullseye_card add primary key (league_id, week, roster_id, slot);

create or replace function bullseye_card(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare cur jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select settings_json into cur from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'bullseye', league_bullseye(p_league_id),
    'radius', (cur ->> 'bullseye_radius')::int,
    'rings', cur ->> 'bullseye_rings',
    'deal', cur ->> 'bullseye_deal',
    'card', coalesce((
      select jsonb_agg(jsonb_build_object('slot', c.slot, 'target', c.target, 'roster_id', c.roster_id) order by c.roster_id, (c.slot = 'TOTAL'), c.slot)
        from bullseye_card c where c.league_id = p_league_id and c.week = p_week), '[]'::jsonb));
end $$;

-- ── league_game_mode — 0446's body, plus the two knobs ─────────────────────
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
      'bullseye', league_bullseye(p_league_id),
      'bullseye_radius', (l.settings_json ->> 'bullseye_radius')::int,
      'bullseye_rings', l.settings_json ->> 'bullseye_rings',
      'bullseye_deal', l.settings_json ->> 'bullseye_deal',
      'sport', coalesce(l.sport, 'nfl'),
      'sport_settings', l.settings_json -> 'sport',
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;

-- ── The global board — 0447's body, hybrid admitted ────────────────────────
create or replace function bullseye_global_board(p_week int, p_season text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  return jsonb_build_object('ok', true, 'week', p_week,
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
          'rank', z.rk, 'team', z.team_name, 'final', z.fin,
          'league', case when z.member then z.lname end,
          'variant', z.variant,
          'mine', z.member and z.app_user_id = uid)
        order by z.rk, z.lname, z.team_name)
      from (
        select x.fin, m.team_name, m.app_user_id, l.name as lname, l.settings_json ->> 'bullseye' as variant,
               exists (select 1 from league_membership me where me.league_id = l.id and me.app_user_id = uid and me.enrolled) as member,
               rank() over (order by x.fin desc) as rk
        from (
          select mu.league_id, mu.home_roster_id as rid, mu.home_final as fin from matchup mu
           where mu.week = p_week and mu.status = 'final' and mu.home_final is not null
          union all
          select mu.league_id, mu.away_roster_id, mu.away_final from matchup mu
           where mu.week = p_week and mu.status = 'final' and mu.away_final is not null
             and mu.away_roster_id <> mu.home_roster_id
        ) x
        join league l on l.id = x.league_id
          and coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
          and l.settings_json ->> 'bullseye' in ('slots', 'total', 'hybrid')
          and (p_season is null or l.season = p_season)
        join league_membership m on m.league_id = l.id and m.sleeper_roster_id = x.rid
      ) z), '[]'::jsonb));
end $$;
