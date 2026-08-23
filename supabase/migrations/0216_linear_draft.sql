-- 0216 — LINEAR DRAFTS (founder: "we also need linear drafts").
--
-- A linear draft is the snake without the fold: the same order every round,
-- 1..n, 1..n. It exists on its own merits (some leagues just run it) and it is
-- the shape the CONTRACT rookie draft needs — a rookie salary scale prices
-- picks by overall slot, and a linear order is how those slots are usually
-- laid out. Everything else about pick-based drafting (queue, autodraft, slow
-- clocks, quiet hours, pause/undo) already works order-agnostically; the whole
-- feature is one branch in draft_on_clock plus letting 'linear' through the
-- three mode gates. create_native_league (0192's CURRENT body — this migration's
-- first two cuts re-created 0069's then 0185's superseded bodies, and the
-- probe battery caught both; the lineage is 0064→0067→0068→0069→0071→0175→
-- 0184→0185→0192, and THE LATEST BODY IS THE ONLY SAFE BASE) and set_draft_setup (0176 body) are
-- re-created verbatim apart from those gates.

alter table draft drop constraint if exists draft_mode_check;
alter table draft add constraint draft_mode_check check (mode in ('snake', 'linear', 'auction'));

-- The roster on the clock — 0183's CURRENT body (pick_owners first: a rolled
-- dynasty league's rookie draft runs off its asset owner list), with one new
-- branch: snake folds even rounds; linear never folds.
create or replace function draft_on_clock(d draft) returns int
  language plpgsql immutable as $$
declare n int; rnd int; idx int;
begin
  if d.pick_owners is not null then
    if d.current_overall > jsonb_array_length(d.pick_owners) then return null; end if;
    return (d.pick_owners ->> (d.current_overall - 1))::int;
  end if;
  n := jsonb_array_length(d.draft_order);
  if n is null or n = 0 then return null; end if;
  rnd := ((d.current_overall - 1) / n) + 1;
  idx := (d.current_overall - 1) % n;
  if d.mode <> 'linear' and rnd % 2 = 0 then idx := n - 1 - idx; end if;   -- even rounds reverse (snake)
  return (d.draft_order ->> idx)::int;
end $$;

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
  if p_rounds is null or p_rounds < 5 or p_rounds > 99 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–99');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  if coalesce(p_mode, 'snake') not in ('snake', 'linear', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake, linear or auction');
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

create or replace function set_draft_setup(
  p_league_id uuid,
  p_pick_seconds int default null,
  p_mode text default null,
  p_budget int default null,
  p_lot_seconds int default null,
  p_max_lots int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; m text; b int; ls int; ml int; ps int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'draft setup locks once the draft starts');
  end if;

  -- Resolve the target state first, THEN validate it as a whole. Validating
  -- each field against the stored row instead would let a single call land a
  -- combination neither value is wrong in isolation — e.g. switching to
  -- auction while the stored budget is smaller than the roster.
  ps := coalesce(p_pick_seconds, d.pick_seconds);
  m  := lower(btrim(coalesce(p_mode, d.mode)));
  b  := coalesce(p_budget, d.budget);
  ls := coalesce(p_lot_seconds, d.lot_seconds);
  ml := coalesce(p_max_lots, d.max_lots);

  if ps < 15 or ps > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  if m not in ('snake', 'linear', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake, linear or auction');
  end if;
  if m = 'auction' then
    if b is null or b < d.rounds or b > 100000 then
      return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
    end if;
    if ls is null or ls < 10 or ls > 172800 then
      return jsonb_build_object('ok', false, 'error', 'bid clock must be 10s–48h');
    end if;
    if ml is null or ml < 1 or ml > 4 then
      return jsonb_build_object('ok', false, 'error', 'lots at once must be 1–4');
    end if;
  end if;

  update draft set pick_seconds = ps, mode = m, budget = b, lot_seconds = ls, max_lots = ml
    where league_id = p_league_id;

  -- settings_json.mode is what the league LISTING and preview read; leaving it
  -- behind would show joiners a snake draft that is really an auction.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('mode', m)
    where id = p_league_id;

  return jsonb_build_object('ok', true, 'pick_seconds', ps, 'mode', m,
    'budget', b, 'lot_seconds', ls, 'max_lots', ml);
end $$;
