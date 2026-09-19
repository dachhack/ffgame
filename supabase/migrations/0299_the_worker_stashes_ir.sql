-- 0299 — THE WORKER STASHES A SEAT'S INJURED PLAYERS ON IR (v0.426.0)
--
-- Founder: "This AI team has AJ Brown in despite him on IR. … Also put
-- players in IR?"
--
-- set_roster_spot (0164/0196/0198) is the one path a player moves between
-- active, taxi and IR, and its guard admitted the seat's owner, the
-- commissioner and an admin — never the worker. So the seats the worker
-- tends (unclaimed seats through their agent, AI seats nobody holds — 0213,
-- 0298) could sign and drop but never STASH: a starter ruled out for the
-- year sat on the active roster holding a place, and the lineup fill benched
-- him every week while the wire could not open the seat his replacement
-- needed.
--
-- The same widening 0213 gave the two wire functions, on the same terms:
-- `auth.uid() is null and agent_wire_seat(league, seat)` — the service role,
-- for a seat nobody holds. Every rule below is 0198's, re-read rather than
-- reconstructed: the league's own IR list (league_ir_tags), the IR cap, the
-- taxi tenure ceiling and lock, the active-seat count on the way back. The
-- worker gets no exemption from any of it. Which player, and when, is the
-- sweep's judgement (server/src/seatWire.js): a player whose designation is
-- on the league's IR list goes to an open IR place; a player on IR whose
-- designation has cleared comes back when an active place is open.
create or replace function set_roster_spot(p_league_id uuid, p_slug text, p_spot text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; sh jsonb; cnt int; cap int; ist text; mx int; pexp int; tags text[];
begin
  if p_spot not in ('active', 'taxi', 'ir') then
    return jsonb_build_object('ok', false, 'error', 'spot must be active, taxi, or ir');
  end if;
  select roster_id into rid from native_roster where league_id = p_league_id and slug = p_slug;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'player not rostered'); end if;
  -- 0299: the WORKER may also act, for a seat nobody holds (0213's terms).
  if not (owns_roster(p_league_id, rid) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, rid))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  sh := _roster_shape(p_league_id);
  if p_spot = 'taxi' then
    cap := coalesce((sh ->> 'taxi')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'taxi' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'taxi is full — ' || cap || ' spots'); end if;
    -- ── WHO MAY RIDE IT (0196) ───────────────────────────────────────────
    -- The commissioner names a tenure ceiling — "rookies only" is max_exp 0,
    -- "first and second year" is 1. A player whose experience Sleeper doesn't
    -- know cannot prove he qualifies, which is the same answer the pool's
    -- tenure filter gives (0171/0172): unknown is not eligible.
    mx := (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id);
    if mx is not null then
      select lp.exp into pexp from league_pool lp
        where lp.league_id = p_league_id and lp.slug = p_slug;
      if pexp is null then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — this one''s experience isn''t known');
      end if;
      if pexp > mx then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — he has ' || pexp);
      end if;
    end if;
    -- ── AND WHEN (0196) ──────────────────────────────────────────────────
    -- Taxi squads shut at the season's first kickoff so nobody stashes a
    -- starter once games are being played. It bites on ADDING only: taking a
    -- player OFF the taxi is always allowed, which is the whole point of
    -- having him there. The COMMISSIONER moves players either way at any time.
    if taxi_is_locked(p_league_id) and not (is_league_commish(p_league_id) or is_admin()) then
      return jsonb_build_object('ok', false, 'error',
        'the taxi squad locked at the season''s first kickoff — you can still take players OFF it');
    end if;
  elsif p_spot = 'ir' then
    cap := coalesce((sh ->> 'ir')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'ir' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'IR is full — ' || cap || ' spots'); end if;
    -- ── ONLY INJURED GUYS (0164, and now the LEAGUE'S OWN LIST — 0198) ────
    -- The commissioner picks which designations qualify; the default is the
    -- pair 0164 hardcoded. The refusal NAMES the list, because "not eligible"
    -- without it sends a manager to the settings page to find out what is.
    -- No exemption for the commissioner here, unlike the taxi lock: the taxi
    -- lock is a DEADLINE (someone has to be able to fix a mistake after it),
    -- while this is a statement about the player, and it is just as true for
    -- the commissioner's own roster as for anyone else's.
    tags := league_ir_tags(p_league_id);
    select status into ist from injury_status where player_slug = p_slug;
    if ist is null or not (upper(ist) = any(tags)) then
      return jsonb_build_object('ok', false, 'error',
        'IR is for players designated ' || array_to_string(tags, '/') ||
        coalesce(' — this one is ' || nullif(upper(ist), ''), ' — this one has no designation'));
    end if;
  else
    -- Back to active: there must be an active seat open (starters + bench).
    cap := _classic_starters(p_league_id) + coalesce((sh ->> 'bench')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'active' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'active roster is full — stash or drop someone first'); end if;
  end if;
  update native_roster set spot = p_spot where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'spot', p_spot);
end $$;
grant execute on function set_roster_spot(uuid, text, text) to authenticated;
