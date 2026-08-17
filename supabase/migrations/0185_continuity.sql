-- 0185: LEAGUE CONTINUITY — REDRAFT / KEEPER / DYNASTY as one selection, in
-- MODE & SEASON and on the create form; dynasty deals THREE YEARS of picks;
-- the rollover becomes an option that appears AFTER THE SUPER BOWL.
--
-- Founder, in two messages: "Let's add a section where you select
-- redraft/keeper/dynasty. If you select keeper, you pick the number of
-- keepers, if you select dynasty you select the number of rookie draft
-- rounds. The game then assigns the rookie picks for the next three years.
-- Let's allow this selection on league creation." And: "season roll over is
-- just an option that appears after the super bowl."
--
-- THE MODEL. Continuity is ONE axis with three points, stored as
-- settings_json.continuity and parameterized by the two settings 0182/0183
-- already run on:
--   • redraft — nothing carries; keeper_count/rookie_rounds cleared, future
--     pick assets deleted (refused while any is traded — acquired property).
--   • keeper N — settings keeper_count = N; next season redrafts the rest
--     from the full pool. No pick assets.
--   • dynasty R — settings rookie_rounds = R and keeper_count = roster − R
--     ("keep everyone except the rookie-draft spots", computed at set time),
--     and pick assets are dealt for the NEXT THREE SEASONS (S+1..S+3), all
--     tradeable through the existing trade system. Rollover maintains the
--     horizon: it carries every future season's assets (trades intact) and
--     re-provisions so the new league again sees three years out.
-- league_continuity() derives the mode for leagues configured before this
-- migration (rookie_rounds>0 or the 0184 stamp ⇒ dynasty; keeper_count>0 ⇒
-- keeper), so nothing existing changes behavior or loses its badge.
--
-- THE SUPER BOWL GATE. rollover_league now refuses until the league's season
-- is truly over — defined as Feb 15 of season+1, safely after any Super Bowl
-- ever scheduled — so the panels show the rollover as an option that APPEARS
-- when the season ends rather than a button that scolds. Admins bypass the
-- gate (testing a rollover in August must stay possible); keeper_state
-- carries season_over + admin so both hosts render the right state.

-- ─────────────────────────────────────────────────────────────────────────────
-- The axis
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function league_continuity(l_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when settings_json ->> 'continuity' in ('redraft', 'keeper', 'dynasty')
      then settings_json ->> 'continuity'
    when coalesce((settings_json ->> 'rookie_rounds')::int, 0) > 0
      or coalesce((settings_json ->> 'dynasty')::boolean, false) then 'dynasty'
    when coalesce((settings_json ->> 'keeper_count')::int, 0) > 0 then 'keeper'
    else 'redraft' end
  from league where id = l_id;
$$;

-- league_is_dynasty v2 (0184): now a view over the axis.
create or replace function league_is_dynasty(l_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select league_continuity(l_id) = 'dynasty';
$$;

-- Feb 15 after the season year — safely past any Super Bowl. A non-year
-- season never gates (test fixtures, imports with odd labels).
create or replace function _season_over(l_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select case when season ~ '^\d{4}$'
    then now() >= make_date((season)::int + 1, 2, 15)::timestamptz
    else true end
  from league where id = l_id;
$$;

-- Internal: land a continuity choice on a league. Assumes the caller checked
-- permissions and holds the advisory lock. Provisioning runs BEFORE the
-- settings write so a refused shrink leaves the stored mode untouched.
create or replace function _apply_continuity(p_league_id uuid, p_mode text, p_n int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; d draft%rowtype; n int; s int; r jsonb;
begin
  select * into lg from league where id = p_league_id;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if coalesce(p_mode, '') not in ('redraft', 'keeper', 'dynasty') then
    return jsonb_build_object('ok', false, 'error', 'continuity must be redraft, keeper or dynasty');
  end if;

  if p_mode in ('redraft', 'keeper') then
    -- these modes hold no pick assets — clear the futures, but never a traded one
    if exists (select 1 from pick_asset pa
               where pa.league_id = p_league_id and pa.season > lg.season
                 and pa.owner_roster <> pa.original_roster) then
      return jsonb_build_object('ok', false, 'error',
        'trades already moved future picks — undo those first');
    end if;
    delete from pick_asset where league_id = p_league_id and season > lg.season;
  end if;

  if p_mode = 'redraft' then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        - 'continuity' - 'dynasty' - 'keeper_count' - 'rookie_rounds'
      where id = p_league_id;
    return jsonb_build_object('ok', true, 'continuity', 'redraft');
  end if;

  if p_mode = 'keeper' then
    if p_n is null or p_n < 1 or p_n > d.rounds - 1 then
      return jsonb_build_object('ok', false, 'error',
        'keepers must be 1–' || (d.rounds - 1) || ' (the roster holds ' || d.rounds || ')');
    end if;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        - 'dynasty' - 'rookie_rounds'
        || jsonb_build_object('continuity', 'keeper', 'keeper_count', p_n)
      where id = p_league_id;
    return jsonb_build_object('ok', true, 'continuity', 'keeper', 'keeper_count', p_n);
  end if;

  -- dynasty
  if lg.season !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'league season "' || coalesce(lg.season, '') || '" isn''t a year');
  end if;
  n := coalesce(p_n, 3);
  if n < 1 or n > least(10, d.rounds - 1) then
    return jsonb_build_object('ok', false, 'error',
      'rookie rounds must be 1–' || least(10, d.rounds - 1));
  end if;
  -- three years of futures, each round a tradeable asset from this moment
  for s in 1..3 loop
    r := _provision_pick_assets(p_league_id, ((lg.season)::int + s)::text, n);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('continuity', 'dynasty', 'dynasty', true,
                            'rookie_rounds', n, 'keeper_count', d.rounds - n)
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'continuity', 'dynasty', 'rookie_rounds', n,
    'keeper_count', d.rounds - n,
    'seasons', jsonb_build_array(((lg.season)::int + 1)::text, ((lg.season)::int + 2)::text, ((lg.season)::int + 3)::text));
end $$;

-- The MODE & SEASON selector's setter (and the create form's engine).
create or replace function set_league_continuity(p_league_id uuid, p_mode text, p_n int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if lg.is_mock or lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'continuity belongs to full leagues');
  end if;
  if _rollover_target(p_league_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'this season already rolled over');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  return _apply_continuity(p_league_id, lower(btrim(coalesce(p_mode, ''))), p_n);
end $$;
grant execute on function set_league_continuity(uuid, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_native_league v-next: 0184's body with the continuity selection
-- ─────────────────────────────────────────────────────────────────────────────

-- The old signature MUST go (the 0175 overload lesson, every time).
drop function if exists create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb, text, boolean);

create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1,
  p_night_start_min int default null, p_night_end_min int default null,
  p_pos_caps jsonb default null,
  p_game_mode text default 'drip',
  p_continuity text default 'redraft',
  p_continuity_n int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; e text; nm text; i int; err text; gm text; cont text; cn int; r jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not has_native() then return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access'); end if;
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league needs a name'); end if;
  if p_teams is null or p_teams < 2 or p_teams > 14 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–14');
  end if;
  if p_rounds is null or p_rounds < 5 or p_rounds > 25 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–25');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  if coalesce(p_mode, 'snake') not in ('snake', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake or auction');
  end if;
  if p_mode = 'auction' and (p_budget is null or p_budget < p_rounds or p_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
  end if;
  if p_mode = 'auction' and (p_lot_seconds is null or p_lot_seconds < 10 or p_lot_seconds > 172800) then
    return jsonb_build_object('ok', false, 'error', 'bid clock must be 10s–48h');
  end if;
  if p_mode = 'auction' and (p_max_lots is null or p_max_lots < 1 or p_max_lots > 4) then
    return jsonb_build_object('ok', false, 'error', 'lots at once must be 1–4');
  end if;
  if (p_night_start_min is null) <> (p_night_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'overnight pause needs both a start and an end');
  end if;
  if p_night_start_min is not null and (
       p_night_start_min < 0 or p_night_start_min > 1439
    or p_night_end_min < 0 or p_night_end_min > 1439
    or p_night_start_min = p_night_end_min) then
    return jsonb_build_object('ok', false, 'error', 'overnight hours must be two different times of day');
  end if;
  err := validate_pos_caps(p_pos_caps, p_rounds);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  gm := lower(btrim(coalesce(p_game_mode, 'drip')));
  if gm not in ('drip', 'classic') then
    return jsonb_build_object('ok', false, 'error', 'game must be drip or classic');
  end if;
  -- Continuity (0185): validate the choice BEFORE anything is inserted, so a
  -- bad keeper count refuses cleanly instead of stranding a half-made league.
  cont := lower(btrim(coalesce(p_continuity, 'redraft')));
  if cont not in ('redraft', 'keeper', 'dynasty') then
    return jsonb_build_object('ok', false, 'error', 'continuity must be redraft, keeper or dynasty');
  end if;
  if cont = 'keeper' and (p_continuity_n is null or p_continuity_n < 1 or p_continuity_n > p_rounds - 1) then
    return jsonb_build_object('ok', false, 'error',
      'keepers must be 1–' || (p_rounds - 1) || ' (the roster holds ' || p_rounds || ')');
  end if;
  cn := case when cont = 'dynasty' then coalesce(p_continuity_n, 3) else p_continuity_n end;
  if cont = 'dynasty' and (cn < 1 or cn > least(10, p_rounds - 1)) then
    return jsonb_build_object('ok', false, 'error', 'rookie rounds must be 1–' || least(10, p_rounds - 1));
  end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, synced_at, avatar_url)
  values ('native-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(btrim(p_season), ''), '2026'),
          nm, 'native',
          jsonb_build_object('teams', p_teams, 'rounds', p_rounds, 'mode', coalesce(p_mode, 'snake'))
            || case when p_pos_caps is not null then jsonb_build_object('pos_caps', p_pos_caps) else '{}'::jsonb end
            -- A classic league carries BOTH keys: the mode it runs in, and the
            -- availability flag that lets its commissioner switch modes
            -- pre-draft. A drip league writes neither, so it reads exactly as
            -- every league created before this migration did.
            || case when gm = 'classic'
                 then jsonb_build_object('game_mode', 'classic', 'classic_ok', true)
                 else '{}'::jsonb end,
          auth.uid(), now(), random_drip_avatar())
  returning id into lid;

  for i in 1..p_teams loop
    insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
    values (lid, i, 'Team ' || i, false);
  end loop;
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e
    where league_id = lid and sleeper_roster_id = 1;

  insert into draft (league_id, rounds, pick_seconds, mode, budget, lot_seconds, max_lots, night_start_min, night_end_min)
  values (lid, p_rounds, p_pick_seconds, coalesce(p_mode, 'snake'), coalesce(p_budget, 200),
          coalesce(p_lot_seconds, 15), coalesce(p_max_lots, 1), p_night_start_min, p_night_end_min);

  -- Continuity lands through the same engine the MODE & SEASON selector uses
  -- (keeper count / rookie rounds / the three-year pick horizon). Validated
  -- above, so a failure here is structural — raise, rolling the league back.
  if cont <> 'redraft' then
    r := _apply_continuity(lid, cont, cn);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'continuity failed: %', r ->> 'error';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1, 'game_mode', gm,
    'continuity', cont, 'dynasty', cont = 'dynasty',
    'invite_code', (select invite_code from league where id = lid));
end $$;
grant execute on function create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb, text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-year picks trade (0183's cleaner, per-element season)
-- ─────────────────────────────────────────────────────────────────────────────

-- _clean_trade_picks v2: each element may carry its own season (any FUTURE
-- season with a provisioned asset); an element without one means the next
-- season, which keeps every existing caller exact.
create or replace function _clean_trade_picks(p_league_id uuid, p_picks jsonb)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cur text; el jsonb; sel text; rnd int; orig int; cleaned jsonb := '[]'::jsonb;
begin
  if p_picks is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p_picks) <> 'array' then
    raise exception 'picks must be a list';
  end if;
  select season into cur from league where id = p_league_id;
  for el in select * from jsonb_array_elements(p_picks) loop
    begin rnd := (el ->> 'round')::int; orig := (el ->> 'orig')::int;
    exception when others then rnd := null; orig := null; end;
    if rnd is null or orig is null then raise exception 'each pick needs round and orig'; end if;
    sel := nullif(btrim(coalesce(el ->> 'season', '')), '');
    if sel is null then sel := _future_pick_season(p_league_id); end if;
    if sel is null or sel !~ '^\d{4}$' or cur !~ '^\d{4}$' or (sel)::int <= (cur)::int then
      raise exception 'only future picks trade: % round %', coalesce(sel, '?'), rnd;
    end if;
    if not exists (select 1 from pick_asset pa where pa.league_id = p_league_id
                   and pa.season = sel and pa.round = rnd and pa.original_roster = orig) then
      raise exception 'no such pick: % round %', sel, rnd;
    end if;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('season', sel, 'round', rnd, 'orig', orig));
  end loop;
  return cleaned;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The reads carry the axis (and the Super Bowl gate's state)
-- ─────────────────────────────────────────────────────────────────────────────

-- my_teams v-next: 0184's body + 'continuity'.
create or replace function my_teams()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(r order by r -> 'league' ->> 'name'), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', m.league_id, 'team_name', m.team_name, 'sleeper_roster_id', m.sleeper_roster_id,
      'avatar_url', m.avatar_url, 'pick_user_id', m.app_user_id, 'comanager', (m.app_user_id <> auth.uid()),
      'league', jsonb_build_object(
        'name', l.name, 'season', l.season, 'preseason_at', l.preseason_at, 'provider', l.provider,
        'avatar_url', l.avatar_url, 'is_mock', l.is_mock, 'kind', l.kind, 'contest_week', l.contest_week,
        'dynasty', league_is_dynasty(l.id),
        'continuity', league_continuity(l.id))
    ) as r
    from league_membership m
    join league l on l.id = m.league_id
    where m.enrolled and (
      m.app_user_id = auth.uid()
      or exists (select 1 from team_manager tm
                  where tm.league_id = m.league_id and tm.roster_id = m.sleeper_roster_id
                    and tm.app_user_id = auth.uid())
    )
  ) t;
  return result;
end $$;

-- keeper_state v3: 0184's body + continuity / season_over / admin.
create or replace function keeper_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare nk int; d draft%rowtype; my_r int; seas text; rolled uuid;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  nk := coalesce((select (settings_json ->> 'keeper_count')::int from league where id = p_league_id), 0);
  select season into seas from league where id = p_league_id;
  rolled := _rollover_target(p_league_id);
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  return jsonb_build_object(
    'ok', true,
    'dynasty', league_is_dynasty(p_league_id),
    'continuity', league_continuity(p_league_id),
    'rookie_rounds', coalesce((select (settings_json ->> 'rookie_rounds')::int from league where id = p_league_id), 0),
    -- the Super Bowl gate (0185): the rollover is an option that APPEARS
    -- when the season is over; admins can always see it (off-season testing)
    'season_over', _season_over(p_league_id),
    'admin', is_admin(),
    'keeper_count', nk,
    'roster_size', d.rounds,
    'draft_status', d.status,
    'season', seas,
    'next_season', case when seas ~ '^\d{4}$' then ((seas)::int + 1)::text end,
    'game_mode', coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip'),
    'rolled_league_id', rolled,
    'my_roster_id', my_r,
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'claimed', m.app_user_id is not null,
        'declared', coalesce((select jsonb_agg(kp.slug order by kp.added_at) from keeper_pick kp
          where kp.league_id = p_league_id and kp.roster_id = m.sleeper_roster_id), '[]'::jsonb),
        'keep', case when nk > 0 then coalesce((select jsonb_agg(jsonb_build_object(
            'slug', kr.slug, 'declared', kr.declared) order by kr.declared desc, kr.slug)
          from _keeper_resolve(p_league_id, nk) kr
          where kr.roster_id = m.sleeper_roster_id), '[]'::jsonb) else '[]'::jsonb end)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollover: the gate, the multi-year carry, the maintained horizon
-- (0183's body with those three changes)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function rollover_league(
  p_league_id uuid, p_weeks int default 14, p_rookie_only boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg league%rowtype; d draft%rowtype; nk int; next_seas text; nlid uuid;
  kept int; sched jsonb; gm text; new_settings jsonb; rr int; carried int; i int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));

  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'only native leagues roll over — re-import a platform league''s new season instead');
  end if;
  if lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'only full leagues roll over');
  end if;
  if lg.is_mock then
    return jsonb_build_object('ok', false, 'error', 'mock drafts don''t roll over');
  end if;
  if lg.season !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'season "' || coalesce(lg.season, '') || '" isn''t a year');
  end if;
  -- The Super Bowl gate (0185): the rollover appears when the season ends.
  if not (is_admin() or _season_over(p_league_id)) then
    return jsonb_build_object('ok', false, 'error',
      'the rollover opens after the Super Bowl — ' || ((lg.season)::int + 1) || '-02-15');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'this season''s draft never finished — nothing to roll over');
  end if;

  next_seas := ((lg.season)::int + 1)::text;
  nlid := _rollover_target(p_league_id);
  if nlid is not null then
    return jsonb_build_object('ok', false, 'error', 'already rolled into ' || next_seas, 'league_id', nlid);
  end if;

  nk := least(coalesce((lg.settings_json ->> 'keeper_count')::int, 0), d.rounds - 1);
  gm := coalesce(lg.settings_json ->> 'game_mode', 'drip');

  -- Same settings, scoring and spec — with the pool filter forced to
  -- rookies-only when this rollover feeds a rookie draft.
  new_settings := coalesce(lg.settings_json, '{}'::jsonb);
  if p_rookie_only then
    new_settings := new_settings || jsonb_build_object('pool_filter', jsonb_build_object('max_exp', 0));
  end if;

  insert into league (sleeper_league_id, season, name, provider, settings_json,
                      commissioner_id, synced_at, avatar_url, kdst_mode, weekly_budget,
                      lineup_policy, pot_ante, pot_cap, kind)
  values (lg.sleeper_league_id, next_seas, lg.name, 'native', new_settings,
          lg.commissioner_id, now(), lg.avatar_url, lg.kdst_mode, lg.weekly_budget,
          lg.lineup_policy, lg.pot_ante, lg.pot_cap, 'league')
  returning id into nlid;

  -- Memberships: same seats, same managers, same team names. Balances and
  -- priorities are season state, not identity — they start fresh.
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id,
                                 app_user_id, enrolled, team_name, claim_email,
                                 avatar_url, controller)
  select nlid, m.sleeper_roster_id, m.sleeper_owner_id,
         m.app_user_id, m.enrolled, m.team_name, m.claim_email,
         m.avatar_url, m.controller
  from league_membership m where m.league_id = p_league_id;

  -- The player pool. A rookie-only rollover carries just the kept players
  -- (their native_roster rows need the FK) and leaves the rest to the
  -- rookies-only reseed; a full rollover carries the whole pool with waiver
  -- clocks cleared. Ranks are last season's — the pre-draft reseed refreshes
  -- them, and seed_league_pool preserves rostered players.
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
  select nlid, lp.slug, lp.full_name, lp.pos, lp.team, lp.rank, lp.espn_id, lp.exp
  from league_pool lp
  where lp.league_id = p_league_id
    and (not p_rookie_only or exists (
      select 1 from _keeper_resolve(p_league_id, nk) kr where kr.slug = lp.slug));

  -- Keepers onto the new roster, pre-draft. acquired='keeper', spot='active'
  -- (taxi/IR are in-season designations; the manager re-declares them).
  insert into native_roster (league_id, roster_id, slug, acquired)
  select nlid, kr.roster_id, kr.slug, 'keeper'
  from _keeper_resolve(p_league_id, nk) kr;
  get diagnostics kept = row_count;

  -- A fresh pending draft: same shape as this season's, minus the kept spots.
  insert into draft (league_id, status, rounds, pick_seconds, mode, budget,
                     lot_seconds, max_lots, night_start_min, night_end_min, keeper_slots)
  values (nlid, 'pending', d.rounds, d.pick_seconds, d.mode, d.budget,
          d.lot_seconds, d.max_lots, d.night_start_min, d.night_end_min, nk);

  -- Pick assets (0183/0185): carry EVERY future season's assets — ownership
  -- as traded — so a 2028 second dealt during 2026 still exists in 2027.
  -- The next-season rows become the new league's own-season assets (they
  -- drive _start_draft_now); the later ones stay tradeable futures. Then
  -- re-provision the three-year horizon from the carried rookie_rounds.
  insert into pick_asset (league_id, season, round, original_roster, owner_roster)
  select nlid, pa.season, pa.round, pa.original_roster, pa.owner_roster
  from pick_asset pa where pa.league_id = p_league_id and pa.season >= next_seas;
  get diagnostics carried = row_count;
  rr := coalesce((new_settings ->> 'rookie_rounds')::int, 0);
  if rr > 0 and league_continuity(nlid) = 'dynasty' then
    for i in 1..3 loop
      perform _provision_pick_assets(nlid, ((next_seas)::int + i)::text, rr);
    end loop;
  end if;

  -- The season schedule (round-robin; lock_at backfills from the live
  -- scoreboard once next season's slate exists). Best-effort: a 2-team
  -- edge case that refuses here shouldn't strand the created league.
  sched := native_generate_schedule(nlid, p_weeks);

  -- Wallets: deliberately NOT copied. team_wallet/coin_ledger key on the new
  -- league row, so every team starts next season at ◎0 and the weekly-budget
  -- machinery (auto_weekly_budget reads league.weekly_budget, which DID copy)
  -- funds the new season from week 1 — the "fresh season seed" decision.

  return jsonb_build_object(
    'ok', true, 'league_id', nlid, 'season', next_seas,
    -- the created-league confirmation must NAME the game it carries (v0.251.0)
    'game_mode', gm,
    'continuity', league_continuity(nlid),
    'keeper_slots', nk, 'kept', kept,
    'draft_rounds', case when exists (select 1 from pick_asset pa
        where pa.league_id = nlid and pa.season = next_seas) and d.mode = 'snake'
      then (select max(round) from pick_asset where league_id = nlid and season = next_seas)
      else d.rounds - nk end,
    'roster_size', d.rounds,
    'rookie_only', p_rookie_only,
    'picks_carried', carried,
    'schedule', sched,
    'invite_code', (select invite_code from league where id = nlid));
end $$;
