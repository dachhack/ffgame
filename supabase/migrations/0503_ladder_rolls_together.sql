-- 0503: A LADDER ROLLS TOGETHER. A tier rolled over on its own (NEXT SEASON)
-- would leave the ladder pointing at last season's league and the ladder's
-- own rollover refusing it as "already rolled". So rollover_league refuses a
-- laddered league unless ladder_rollover is the one calling.

alter function rollover_league(uuid, int, boolean) rename to _rollover_league_0411;
revoke all on function _rollover_league_0411(uuid, int, boolean) from public, anon, authenticated;

create or replace function rollover_league(p_league_id uuid, p_weeks int default 14, p_rookie_only boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lad text; tr int;
begin
  select l.name, t.tier into lad, tr from league_ladder_tier t join league_ladder l on l.id = t.ladder_id
   where t.league_id = p_league_id;
  if lad is not null and coalesce(current_setting('app.ladder_rolling', true), '') <> '1' then
    return jsonb_build_object('ok', false, 'error',
      'this league is tier ' || tr || ' of the ' || lad || ' ladder — roll the whole ladder over from LADDER');
  end if;
  return _rollover_league_0411(p_league_id, p_weeks, p_rookie_only);
end $$;
grant execute on function rollover_league(uuid, int, boolean) to authenticated;

-- ladder_rollover: 0502's, raising the flag around its tier rollovers.
create or replace function ladder_rollover(p_ladder uuid, p_weeks int default 14)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lad league_ladder%rowtype; t record; r jsonb; newof jsonb := '{}'::jsonb; mv jsonb;
        upper jsonb; lower jsonb; nu uuid; nl uuid; i int; rd int; ru int; seas text;
        moves jsonb := '[]'::jsonb; lb jsonb; ids uuid[]; err text; who_d record; who_u record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lad from league_ladder where id = p_ladder;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such ladder'); end if;
  if not _ladder_can_edit(p_ladder) then return jsonb_build_object('ok', false, 'error', 'commissioner of every tier only'); end if;
  perform pg_advisory_xact_lock(hashtext('ladder:' || p_ladder::text));
  select array_agg(league_id order by tier) into ids from league_ladder_tier where ladder_id = p_ladder;
  err := _ladder_check(ids, lad.movers, lad.roster_mode, p_ladder);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select l.season into seas from league l where l.id = ids[1];

  -- who moves: read from the season just played, before anything changes
  mv := _ladder_movers(p_ladder);

  -- every tier rolls over, or none does (0503: rollover_league lets a
  -- laddered league through only while this flag is up)
  perform set_config('app.ladder_rolling', '1', true);
  for t in select * from league_ladder_tier where ladder_id = p_ladder order by tier loop
    r := rollover_league(t.league_id, p_weeks);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'tier % (%): %', t.tier, (select name from league where id = t.league_id), r ->> 'error'
        using errcode = 'P0001';
    end if;
    newof := newof || jsonb_build_object(t.tier::text, r ->> 'league_id');
  end loop;

  perform set_config('app.ladder_rolling', '', true);

  -- the swaps, tier by tier: the worst team going down takes … and gives
  -- its seat to the best team coming up
  for t in select * from league_ladder_tier where ladder_id = p_ladder and tier < (select max(tier) from league_ladder_tier where ladder_id = p_ladder) order by tier loop
    upper := (select x from jsonb_array_elements(mv) x where (x ->> 'tier')::int = t.tier);
    lower := (select x from jsonb_array_elements(mv) x where (x ->> 'tier')::int = t.tier + 1);
    nu := (newof ->> t.tier::text)::uuid; nl := (newof ->> (t.tier + 1)::text)::uuid;
    for i in 0 .. least(jsonb_array_length(upper -> 'down'), jsonb_array_length(lower -> 'up')) - 1 loop
      rd := (upper -> 'down' ->> i)::int;     -- going down (worst first)
      ru := (lower -> 'up' ->> i)::int;       -- coming up (best first)
      select app_user_id, team_name into who_d from league_membership where league_id = nu and sleeper_roster_id = rd;
      select app_user_id, team_name into who_u from league_membership where league_id = nl and sleeper_roster_id = ru;
      lb := jsonb_build_object('a', '[]'::jsonb, 'b', '[]'::jsonb);
      if lad.roster_mode = 'roster' then
        lb := _ladder_swap_rosters(nu, rd, nl, ru);
      elsif lad.roster_mode = 'redraft' then
        delete from native_roster where (league_id = nu and roster_id = rd) or (league_id = nl and roster_id = ru);
      end if;
      perform _ladder_swap_seats(nu, rd, nl, ru);
      insert into league_ladder_move (ladder_id, season, direction, from_tier, to_tier, from_league, to_league,
                                      from_roster, to_roster, app_user_id, team_name, left_behind)
      values (p_ladder, seas, 'down', t.tier, t.tier + 1, t.league_id, nl, rd, ru, who_d.app_user_id, who_d.team_name, lb -> 'a'),
             (p_ladder, seas, 'up', t.tier + 1, t.tier, (select league_id from league_ladder_tier where ladder_id = p_ladder and tier = t.tier + 1),
              nu, ru, rd, who_u.app_user_id, who_u.team_name, lb -> 'b');
      moves := moves || jsonb_build_array(
        jsonb_build_object('team', who_d.team_name, 'direction', 'down', 'from_tier', t.tier, 'to_tier', t.tier + 1, 'left_behind', lb -> 'a'),
        jsonb_build_object('team', who_u.team_name, 'direction', 'up', 'from_tier', t.tier + 1, 'to_tier', t.tier, 'left_behind', lb -> 'b'));
    end loop;
  end loop;

  -- the ladder now points at next season's leagues
  update league_ladder_tier lt set league_id = (newof ->> lt.tier::text)::uuid where lt.ladder_id = p_ladder;
  return jsonb_build_object('ok', true, 'season', seas, 'moves', moves,
    'leagues', (select jsonb_agg(jsonb_build_object('tier', tier, 'league_id', league_id) order by tier)
                  from league_ladder_tier where ladder_id = p_ladder));
end $$;
