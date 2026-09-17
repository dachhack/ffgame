-- 0283: AN IR SPOT IS NOT A ROUND, IN A PRACTICE ROOM EITHER (v0.395.3).
--
-- Founder, in a room made on the fixed build: "Draft says 21 rounds but the
-- mock has 24" — then, with a fresh one: "Still 24."
--
-- His league is a 24-spot roster with 3 IR spots. IR spots are not drafted
-- (0193: `rounds` is what a team may HOLD, `stash_slots` is how many of those
-- the draft does not fill), so its draft is 21 rounds and its lobby says so.
-- 0281 copied `rounds` = 24 and then forced `stash_slots` to 0 — the comment
-- said "so you draft the whole roster" — which is exactly wrong for IR: it
-- turned three spots nobody drafts into three extra drafted rounds. Reproduced
-- before this fix: source lobby 21, room lobby 24.
--
-- Keepers stay at 0: a keeper is a pre-draft designation the room does not
-- carry, so there every round is drafted. IR comes across as it is. The room
-- now reports both numbers, the way set_league_roster_shape does.
--
-- Body is 0282's with the one line changed.

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
  -- Keepers are pre-draft designations the room does not have, so 0 — every
  -- round is drafted. IR spots (stash_slots) are NOT drafted in either league,
  -- so they come across as they are; zeroing them turned each one into an
  -- extra drafted round (0283).
  update draft set keeper_slots = 0, stash_slots = sd.stash_slots where league_id = lid;

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
    'rounds', sd.rounds, 'draft_rounds', sd.rounds - sd.stash_slots, 'mode', sd.mode, 'pool', pool_n);
end $$;

grant execute on function create_mock_from_league(uuid, int) to authenticated;
