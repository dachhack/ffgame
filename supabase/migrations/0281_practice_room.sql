-- 0281: PRACTICE ROOMS — mock THIS league's draft, from your own seat.
--
-- Founder: "everyone gets their own practice room and you can pick what spot
-- you draft from. It's just a practice right now so that players can see how
-- drafting works."
--
-- Mock drafts have existed since 0070: a native league with is_mock = true and
-- every seat but yours handed to the AI. What they could never do is mock a
-- league you are actually in — create_mock_draft takes raw settings typed into
-- the create-a-league form, seeds a generic pool, and (because it calls a
-- twelve-argument create_native_league that has since grown to fifteen) lands
-- on p_game_mode's default. EVERY MOCK TODAY IS A DRIP REDRAFT LEAGUE, whatever
-- you meant to practise for. A classic league's manager practising on a drip
-- board learns the wrong roster.
--
-- A PRACTICE ROOM is that same machinery pointed at a real league: the same
-- game mode, roster size, draft mode, clocks and position caps, the same PLAYER
-- POOL copied row for row, and the other seats named after the people you
-- actually play with. You pick the slot you draft from, because on a snake the
-- difference between 1 and 12 is the only thing worth practising.
--
-- WHO CAN MAKE ONE — and the gate that had to move. create_native_league
-- refuses anyone without the `native` feature flag, but native_join has never
-- required it: you can be seated in a native league by invite code and not
-- carry the flag. Those managers are exactly who this is for. So the builder
-- splits the way start_draft did in 0177 — the body moves once into
-- _create_native_league_now(), and create_native_league becomes the flagged
-- door onto it. A practice room checks a different thing: that you are an
-- enrolled member of the league you are mocking.
--
-- WHAT A PRACTICE ROOM DELIBERATELY IS NOT:
--   • it is not the real draft — nothing it does touches the source league;
--   • it has no schedule, so native_materialize no-ops and 0179's kickoff lock
--     and 0280's shift both read "no season" and stay out of the way;
--   • it has no keepers. keeper_slots and stash_slots are forced to 0 so you
--     draft the whole roster: a teaching room that hands you eight rounds
--     because the real league keeps four teaches the wrong draft;
--   • it cannot be joined (native_join refuses is_mock) and it is deletable by
--     its owner at any time.

create or replace function _create_native_league_now(
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
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league needs a name'); end if;
  if p_teams is null or p_teams < 2 or p_teams > 32 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–32');
  end if;
  if p_rounds is null or p_rounds < 5 or p_rounds > 99 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–99');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  -- Contract league types (0218) PRESET the room: the founder's "the rest of
  -- the selections like auction draft are pre-set once you make that
  -- selection". Forced before the mode checks so budget/clock validation
  -- runs against the auction the league will actually hold.
  if lower(btrim(coalesce(p_continuity, ''))) in ('contract', 'contract_dynasty') then
    p_mode := 'auction';
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
  if cont not in ('redraft', 'keeper', 'dynasty', 'contract', 'contract_dynasty') then
    return jsonb_build_object('ok', false, 'error', 'continuity must be redraft, keeper, dynasty, contract or contract_dynasty');
  end if;
  if cont = 'keeper' and (p_continuity_n is null or p_continuity_n < 1 or p_continuity_n > p_rounds - 1) then
    return jsonb_build_object('ok', false, 'error',
      'keepers must be 1–' || (p_rounds - 1) || ' (the roster holds ' || p_rounds || ')');
  end if;
  cn := case when cont in ('dynasty', 'contract_dynasty') then coalesce(p_continuity_n, 3) else p_continuity_n end;
  if cont in ('dynasty', 'contract_dynasty') and (cn < 1 or cn > least(10, p_rounds - 1)) then
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
    'continuity', cont, 'dynasty', cont in ('dynasty', 'contract_dynasty'),
    'contracts', cont in ('contract', 'contract_dynasty'),
    'invite_code', (select invite_code from league where id = lid));
end $$;

-- ── The flagged door (same signature and behaviour as 0244) ────────────────
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
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not has_native() then
    return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access');
  end if;
  return _create_native_league_now(p_name, p_season, p_teams, p_rounds, p_pick_seconds,
    p_mode, p_budget, p_lot_seconds, p_max_lots, p_night_start_min, p_night_end_min,
    p_pos_caps, p_game_mode, p_continuity, p_continuity_n);
end $$;

-- ── The practice room ──────────────────────────────────────────────────────
-- p_slot is YOUR PICK NUMBER in round one, 1..teams. Null means "wherever the
-- league already has me" if a draft order is pre-set (0176), else first.
create or replace function create_mock_from_league(p_league_id uuid, p_slot int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  src league%rowtype; sd draft%rowtype; lid uuid; r jsonb;
  teams int; my_seat int; slot int; caps jsonb; gm text;
  others text[]; ord int[]; i int; seats int[]; pool_n int;
  bots text[] := array['Otto Pick','Max Bid','Al Gorithm','Robo Rodgers',
    'Data Drip','Neural Nate','Circuit Chase','Binary Barkley','Cache Kupp',
    'Vector Vick','Pixel Prescott','Tensor Tucker','Logic Lamb'];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into src from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  if src.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'only a Drip league has a draft to practise');
  end if;
  if src.is_mock then
    return jsonb_build_object('ok', false, 'error', 'that is already a practice room');
  end if;
  -- MEMBERSHIP IS THE PERMISSION, not the feature flag and not the commish
  -- badge: everyone in the league gets their own room.
  if not (is_admin() or exists (select 1 from league_membership m
            where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled)) then
    return jsonb_build_object('ok', false, 'error', 'you are not in that league');
  end if;
  select * into sd from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'that league has no draft'); end if;

  select count(*)::int into teams from league_membership where league_id = p_league_id;
  if teams < 2 then return jsonb_build_object('ok', false, 'error', 'that league has no seats yet'); end if;
  select count(*)::int into pool_n from league_pool where league_id = p_league_id;
  if pool_n < sd.rounds * teams then
    return jsonb_build_object('ok', false, 'error',
      'that league''s player pool is not seeded yet — there is nothing to practise on');
  end if;

  select sleeper_roster_id into my_seat from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;

  -- The slot: what the caller asked for, else where the pre-set order already
  -- puts them, else first.
  slot := p_slot;
  if slot is null and my_seat is not null and sd.draft_order is not null
     and jsonb_typeof(sd.draft_order) = 'array' then
    select i2 + 1 into slot from generate_series(0, jsonb_array_length(sd.draft_order) - 1) i2
      where (sd.draft_order ->> i2)::int = my_seat limit 1;
  end if;
  slot := greatest(1, least(coalesce(slot, 1), teams));

  caps := src.settings_json -> 'pos_caps';
  gm := coalesce(src.settings_json ->> 'game_mode', 'drip');

  -- Build it through the UNGATED door: this caller has already proved they
  -- belong here, and may well not carry the `native` flag.
  -- Continuity is deliberately 'redraft' — see the header.
  r := _create_native_league_now(
    left(src.name, 40) || ' · practice', src.season, teams,
    sd.rounds, sd.pick_seconds, sd.mode, sd.budget, sd.lot_seconds, sd.max_lots,
    sd.night_start_min, sd.night_end_min, caps, gm, 'redraft', null);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  lid := (r ->> 'league_id')::uuid;
  update league set is_mock = true where id = lid;
  -- Full rounds: no keepers, no IR stash. The room is here to show the draft.
  update draft set keeper_slots = 0, stash_slots = 0 where league_id = lid;

  -- THE SAME BOARD. Copied rather than rebuilt: the client's buildDraftPool
  -- re-derives a generic pool from the player directory, which is slower and
  -- is not the league's pool — it misses pool-doctor repairs, name-twin fixes
  -- and any commissioner edit. Practising on a different board is practising
  -- a different draft.
  insert into league_pool (league_id, slug, full_name, pos, team, rank)
    select lid, slug, full_name, pos, team, rank from league_pool where league_id = p_league_id;

  -- The other seats wear your leaguemates' names, in their own seat order, so
  -- the room reads like the one you are practising for. Bots backfill any
  -- shortfall (a seat that has never been named).
  select array_agg(coalesce(nullif(btrim(team_name), ''), '') order by sleeper_roster_id)
    into others from league_membership
    where league_id = p_league_id and (my_seat is null or sleeper_roster_id <> my_seat);
  for i in 2..teams loop
    update league_membership set controller = 'ai',
      team_name = coalesce(nullif(others[i - 1], ''), bots[((i - 2) % array_length(bots, 1)) + 1])
      where league_id = lid and sleeper_roster_id = i;
  end loop;
  if my_seat is not null then
    update league_membership m set team_name = coalesce(
        (select nullif(btrim(s.team_name), '') from league_membership s
          where s.league_id = p_league_id and s.sleeper_roster_id = my_seat), m.team_name)
      where m.league_id = lid and m.sleeper_roster_id = 1;
  end if;

  -- THE ORDER IS THE POINT. You are seat 1; put seat 1 at the slot you asked
  -- for and let the rest fall in around it. start_draft honours a pre-set
  -- order (0176) as long as it covers exactly these seats, which this does.
  select array_agg(x order by random()) into seats
    from generate_series(2, teams) x;
  ord := '{}';
  for i in 1..teams loop
    if i = slot then ord := ord || 1;
    else ord := ord || seats[i - (case when i > slot then 1 else 0 end)];
    end if;
  end loop;
  update draft set draft_order = to_jsonb(ord) where league_id = lid;

  -- Practice rooms are litter by design: everyone gets one per attempt. Sweep
  -- the caller's OWN old ones so a season of practising does not become fifty
  -- leagues on their shelf. Never touches anyone else's, never a real league.
  delete from league l where l.is_mock and l.commissioner_id = auth.uid()
    and l.id <> lid and l.created_at < now() - interval '2 days';

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1,
    'slot', slot, 'teams', teams, 'game_mode', gm, 'source', src.name,
    'name', (select l.name from league l where l.id = lid),
    'rounds', sd.rounds, 'mode', sd.mode, 'pool', pool_n);
end $$;

revoke all on function _create_native_league_now(text, text, int, int, int, text, int, int, int, int, int, jsonb, text, text, int) from public, anon, authenticated;
grant execute on function create_mock_from_league(uuid, int) to authenticated;
