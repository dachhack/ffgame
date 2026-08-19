-- 0192: THE ROSTER CAP WAS ARBITRARY; THE POOL IS NOT.
--
-- Founder: "any reason to actually have a max? I'd say 99 if a max is needed."
--
-- The answer is yes, but not the one that was written down. `draft.rounds` has
-- been `check (rounds between 5 and 25)` since 0064, and 25 is a number with no
-- argument behind it — it was a sanity bound on a table, and it became the
-- ceiling on how big a roster a league may run. A dynasty with a taxi squad
-- wants 30-40 spots and a deep-bench keeper league wants more; every one of
-- them hit a wall the game had no reason to build.
--
-- THE REAL CONSTRAINT IS THE PLAYER POOL. A draft of (rounds − keepers) x seats
-- picks needs that many draftable players to exist. `seed_league_pool` accepts
-- at most 2000 and the client seeds ~1200, so a 14-team league at 99 rounds
-- wants 1386 players it may not have. That limit is a COMPARISON, not a
-- constant, and until now nothing checked it: `_start_draft_now` asked only
-- whether the pool was seeded AT ALL. A draft that outran its pool started
-- normally and then stopped dead mid-round, autopick returning null with the
-- clock still running.
--
-- So: the arbitrary number goes to 99 (the founder's), and the constraint that
-- was doing the real work becomes an explicit refusal at the door, naming the
-- picks needed, the rounds, the teams and the players available.
--
-- Per-field ceilings on the roster shape (bench 20, taxi 8, IR 8) go with it —
-- they clamped silently, which is its own small lie, and the total was always
-- the rule that mattered.

-- ─────────────────────────────────────────────────────────────────────────────
-- The table's own bound
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare c text;
begin
  -- 0064 wrote the check inline, so its name is whatever Postgres chose.
  select conname into c from pg_constraint
   where conrelid = 'draft'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%rounds%25%' limit 1;
  if c is not null then execute format('alter table draft drop constraint %I', c); end if;
end $$;
alter table draft drop constraint if exists draft_rounds_check;
alter table draft add constraint draft_rounds_check check (rounds between 5 and 99);

-- A pick asset may name any round the roster can hold (0190 raised this to 25
-- for the same reason it is moving again).
alter table pick_asset drop constraint if exists pick_asset_round_check;
alter table pick_asset add constraint pick_asset_round_check check (round between 1 and 99);

-- ─────────────────────────────────────────────────────────────────────────────
-- create_native_league (0185's body, one bound moved)
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- set_roster_rules (0071's body, one bound moved)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_roster_rules(p_league_id uuid, p_rounds int default null, p_pos_caps jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; err text; eff_rounds int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  eff_rounds := coalesce(p_rounds, d.rounds);

  if p_rounds is not null and p_rounds <> d.rounds then
    if d.status <> 'pending' then
      return jsonb_build_object('ok', false, 'error', 'roster size is locked once the draft starts');
    end if;
    if p_rounds < 5 or p_rounds > 99 then
      return jsonb_build_object('ok', false, 'error', 'roster size must be 5–99');
    end if;
    if d.mode = 'auction' and d.budget < p_rounds then
      return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
    end if;
    update draft set rounds = p_rounds where league_id = p_league_id;
    update league set settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{rounds}', to_jsonb(p_rounds))
      where id = p_league_id;
  end if;

  if p_pos_caps is not null then
    err := validate_pos_caps(p_pos_caps, eff_rounds);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
    update league set settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{pos_caps}', p_pos_caps)
      where id = p_league_id;
  end if;

  return jsonb_build_object('ok', true, 'rounds', eff_rounds, 'pos_caps', league_pos_caps(p_league_id));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_league_roster_shape (0164's body: the total is the only ceiling now)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; b int; tx int; ir int; r int; sh jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape locks once the draft starts');
  end if;
  -- Per-field ceilings were 20 / 8 / 8; the TOTAL is the only real rule, so
  -- each field is now bounded only by it (0192).
  b  := least(99, greatest(0, coalesce(p_bench, 0)));
  tx := least(99, greatest(0, coalesce(p_taxi, 0)));
  ir := least(99, greatest(0, coalesce(p_ir, 0)));
  r  := _classic_starters(p_league_id) + b + tx + ir;
  if r < 5 or r > 99 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–99 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- _provision_startup_picks (0190's body, one bound moved)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function _provision_startup_picks(p_league_id uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare seas text; rds int; n int;
begin
  select season into seas from league where id = p_league_id;
  select greatest(1, least(99, rounds - coalesce(keeper_slots, 0))) into rds
    from draft where league_id = p_league_id;
  if rds is null then return 0; end if;
  insert into pick_asset (league_id, season, round, original_roster, owner_roster, kind)
  select p_league_id, seas, r, m.sleeper_roster_id, m.sleeper_roster_id, 'startup'
    from generate_series(1, rds) r
    cross join league_membership m
   where m.league_id = p_league_id
  on conflict (league_id, season, round, original_roster) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- _start_draft_now v5 — 0190's body with the pool check the cap was standing in
-- for. Everything else is verbatim.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int; snake_kind boolean;
  pool_n int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  if d.rounds - d.keeper_slots < 1 then
    return jsonb_build_object('ok', false, 'error', 'keepers fill the whole roster — no rounds left to draft');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

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
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v
           where v.x = any(ids)) = n
    then
      ord := d.draft_order; preset := true;
    else
      select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
    end if;
  end if;

  -- Owned picks: this league's own season carries assets ⇒ an explicit
  -- per-overall owner list, each pick owned by its asset's holder.
  --
  -- WHICH WAY THE ROUNDS RUN IS THE ASSET'S KIND (0190). A ROOKIE pick means
  -- "round 3, Team X's slot", so its draft runs LINEAR — 0183's rule, and its
  -- reasoning: snaking would relabel that pick every other round. A STARTUP
  -- pick is a slot in a snake that managers already know the shape of, so its
  -- draft snakes. With every asset still at its original owner, the startup
  -- walk below reproduces the plain snake order EXACTLY, which is what lets a
  -- league turn pick trading on without changing how it drafts.
  select season into lseas from league where id = p_league_id;
  if d.mode = 'snake' and exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = lseas) then
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas;
    owners := '[]'::jsonb;
    for r in 1..maxr loop
      for i in 0..(n - 1) loop
        -- even rounds reverse, but only for a startup draft
        orig := (ord ->> (case when coalesce(snake_kind, false) and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots) * n;
  end if;

  -- THE POOL HAS TO FILL THE DRAFT — the check that was already doing the work
  -- the round cap got the credit for. What changes in 0192 is that it SAYS THE
  -- NUMBERS: at 25 rounds "pool smaller than the draft" was a nudge, at 99 it
  -- has to tell you whether to trim one round or forty.
  select count(*) into pool_n from league_pool lp
    where lp.league_id = p_league_id
      and not exists (select 1 from native_roster nr
                      where nr.league_id = lp.league_id and nr.slug = lp.slug);
  if pool_n < total_picks then
    return jsonb_build_object('ok', false, 'error',
      format('pool smaller than the draft — it needs %s picks (%s rounds x %s teams) and the pool holds %s players; lower the roster size or re-seed a bigger pool',
             total_picks, d.rounds - d.keeper_slots, n, pool_n));
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership set draft_budget = d.budget where league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null);
end $$;

grant execute on function create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb, text, text, int) to authenticated;
grant execute on function set_roster_rules(uuid, int, jsonb) to authenticated;
grant execute on function set_league_roster_shape(uuid, int, int, int) to authenticated;
