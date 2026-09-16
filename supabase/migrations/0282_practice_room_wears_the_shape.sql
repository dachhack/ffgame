-- 0282: A PRACTICE ROOM WEARS THE LEAGUE'S ROSTER (v0.395.1).
--
-- Founder, looking at a room 0281 had just made him: "Did the mock draft lock
-- the roster spots? Why are there 24 roster spots?"
--
-- The second question is the bug. 0281 copied the DRAFT — rounds, mode, clocks,
-- caps, the pool — and nothing that describes the ROSTER those picks land in.
-- The roster builder's spots, the bench/taxi/IR counts, classic scoring, PPR,
-- best-ball flags and the admitted positions all live in league.settings_json
-- under keys the builder never writes, so the room came up with a DEFAULT shape
-- while carrying the source's round count. Measured, not guessed: a source
-- league with roster_slots, roster_shape {bench 15, taxi 2, ir 1},
-- scoring_classic, ppr 0.5 and positions_extra ["IDP"] produced a room whose
-- every one of those keys was NULL — and a 24-round draft filling a
-- nine-spot default lineup, which is what the founder was looking at.
--
-- "Same players, same rounds, same rules" is what the button promises, so the
-- room now copies the rest of the sentence.
--
-- AN ALLOWLIST, NOT THE WHOLE BLOB. Copying settings_json wholesale would drag
-- across the things a practice room must NOT inherit — a format's vampire
-- seats (0268) that are excluded from the draft, keeper and contract
-- continuity 0281 deliberately zeroes, playoff and division config for a season
-- the room will never play — and would silently adopt whatever key is added
-- next. The list below is exactly what league_game_mode() serves, which is the
-- read every draft and roster screen already keys off: if a screen consults it
-- to decide what the roster looks like, the room copies it.
--
-- (The first question: no. The shape lock reads `draft where league_id =
-- p_league_id` — its OWN league's draft. A practice room starts the ROOM's
-- draft; the source league's stays pending, which 0281's probes already
-- assert. What the founder saw locked was the practice room's own editor,
-- which is correct: its draft had started.)

create or replace function _copy_league_shape(p_from uuid, p_to uuid)
  returns void language sql security definer set search_path = public as $$
  update league dst set settings_json = coalesce(dst.settings_json, '{}'::jsonb)
    || coalesce((select jsonb_strip_nulls(jsonb_build_object(
           'roster_slots',    src.settings_json -> 'roster_slots',
           'roster_shape',    src.settings_json -> 'roster_shape',
           'roster_classic',  src.settings_json -> 'roster_classic',
           'scoring_classic', src.settings_json -> 'scoring_classic',
           'bestball',        src.settings_json -> 'bestball',
           'ppr',             src.settings_json -> 'ppr',
           'positions_extra', src.settings_json -> 'positions_extra',
           'pool_filter',     src.settings_json -> 'pool_filter',
           'golf',            src.settings_json -> 'golf'))
         from league src where src.id = p_from), '{}'::jsonb)
   where dst.id = p_to;
$$;

-- 0281's body, with the shape copied in beside the pool.
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

  slot := p_slot;
  if slot is null and my_seat is not null and sd.draft_order is not null
     and jsonb_typeof(sd.draft_order) = 'array' then
    select i2 + 1 into slot from generate_series(0, jsonb_array_length(sd.draft_order) - 1) i2
      where (sd.draft_order ->> i2)::int = my_seat limit 1;
  end if;
  slot := greatest(1, least(coalesce(slot, 1), teams));

  caps := src.settings_json -> 'pos_caps';
  gm := coalesce(src.settings_json ->> 'game_mode', 'drip');

  r := _create_native_league_now(
    left(src.name, 40) || ' · practice', src.season, teams,
    sd.rounds, sd.pick_seconds, sd.mode, sd.budget, sd.lot_seconds, sd.max_lots,
    sd.night_start_min, sd.night_end_min, caps, gm, 'redraft', null);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  lid := (r ->> 'league_id')::uuid;
  update league set is_mock = true where id = lid;
  update draft set keeper_slots = 0, stash_slots = 0 where league_id = lid;

  -- THE ROSTER THE PICKS LAND IN (0282). Without this the room drafts the
  -- league's rounds into a default lineup.
  perform _copy_league_shape(p_league_id, lid);

  insert into league_pool (league_id, slug, full_name, pos, team, rank)
    select lid, slug, full_name, pos, team, rank from league_pool where league_id = p_league_id;

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

  select array_agg(x order by random()) into seats
    from generate_series(2, teams) x;
  ord := '{}';
  for i in 1..teams loop
    if i = slot then ord := ord || 1;
    else ord := ord || seats[i - (case when i > slot then 1 else 0 end)];
    end if;
  end loop;
  update draft set draft_order = to_jsonb(ord) where league_id = lid;

  delete from league l where l.is_mock and l.commissioner_id = auth.uid()
    and l.id <> lid and l.created_at < now() - interval '2 days';

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1,
    'slot', slot, 'teams', teams, 'game_mode', gm, 'source', src.name,
    'name', (select l.name from league l where l.id = lid),
    'rounds', sd.rounds, 'mode', sd.mode, 'pool', pool_n);
end $$;

revoke all on function _copy_league_shape(uuid, uuid) from public, anon, authenticated;
grant execute on function create_mock_from_league(uuid, int) to authenticated;
