-- 0184: DYNASTY AT CREATION + THE BADGE. Founder: "let's make it a setting on
-- creation and badge it so it's clear that it's dynasty."
--
-- Dynasty stays a SETTINGS-derived identity — keeper_count / rookie_rounds in
-- settings_json are the source of truth, editable all season in the 🔁 NEXT
-- SEASON panel (0182/0183). What this adds:
--
--   • create_native_league gains p_dynasty. Checking it at creation presets
--     the dynasty defaults — rookie_rounds = 3 (the convention), keeper_count
--     = roster − 3 ("keep everyone except the rookie-draft spots") — stamps
--     settings_json.dynasty = true, and deals the first generation of pick
--     assets on the spot, so the league is visibly a dynasty league and its
--     futures exist from day one. All of it remains editable afterward; the
--     toggle is sugar over the same settings, not a second mode.
--   • league_is_dynasty(): ONE predicate for every badge — true when the
--     creation stamp is set OR either dynasty setting is live. Derived from
--     the settings rather than the stamp alone, so leagues that turned
--     dynasty on through the panel before this migration badge correctly.
--   • my_teams carries 'dynasty' in each row's league object (the my-leagues
--     cards on both hosts render the 🏰 chip from it), and keeper_state
--     carries it for the panel's own header.

-- ─────────────────────────────────────────────────────────────────────────────
-- The one predicate
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function league_is_dynasty(l_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'dynasty')::boolean, false)
      or coalesce((settings_json ->> 'keeper_count')::int, 0) > 0
      or coalesce((settings_json ->> 'rookie_rounds')::int, 0) > 0
  from league where id = l_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_native_league v-next: 0175's body verbatim + p_dynasty
-- ─────────────────────────────────────────────────────────────────────────────

-- The old signature MUST go: a new parameter with a default creates an
-- OVERLOAD rather than replacing anything (the 0175 lesson, verbatim).
drop function if exists create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb, text);

create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1,
  p_night_start_min int default null, p_night_end_min int default null,
  p_pos_caps jsonb default null,
  p_game_mode text default 'drip',
  p_dynasty boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; e text; nm text; i int; err text; gm text; dyn boolean; kc int;
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
  dyn := coalesce(p_dynasty, false);
  -- keep everyone except the rookie-draft spots (roster ≥ 5, so kc ≥ 2)
  kc := p_rounds - 3;

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
                 else '{}'::jsonb end
            -- Dynasty (0184): the identity stamp + the two settings the 🔁
            -- NEXT SEASON panel edits. Presets, not a separate mode.
            || case when dyn
                 then jsonb_build_object('dynasty', true, 'keeper_count', kc, 'rookie_rounds', 3)
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

  -- Dynasty: deal next season's pick assets now, so the futures are visible
  -- and tradeable from day one (0183). Skipped when the season isn't a year.
  if dyn and _future_pick_season(lid) is not null then
    perform _provision_pick_assets(lid, _future_pick_season(lid), 3);
  end if;

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1, 'game_mode', gm,
    'dynasty', dyn,
    'invite_code', (select invite_code from league where id = lid));
end $$;
grant execute on function create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The badge rides the reads
-- ─────────────────────────────────────────────────────────────────────────────

-- my_teams v-next: 0125's body verbatim + 'dynasty' in the league object.
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
        'dynasty', league_is_dynasty(l.id))
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

-- keeper_state v2: 0182's body verbatim + 'dynasty', for the panel's header.
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
