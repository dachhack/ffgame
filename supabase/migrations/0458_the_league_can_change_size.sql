-- 0458: THE LEAGUE CAN CHANGE SIZE BEFORE THE DRAFT (v0.656.0).
--
-- Founder: "Did we add a way for commish to change league size after it's
-- created?" (it had not: create_native_league set the seats once) — then
-- "Build the pre-draft version."
--
-- commish_set_league_size(league, teams): 2–32, the commissioner's, and only
-- while the draft hasn't started.
--
--   GROW. New open seats "Team N+1"…, added to the end of a draft order that
--   has been set, and given the same future picks every seat holds (dynasty).
--
--   SHRINK. Only EMPTY seats go: nobody seated, nobody invited by email, no
--   co-manager, no players. The seats above the new size have to go or move:
--     · the empty ones above it are removed;
--     · a claimed seat above it MOVES into a freed lower number (the highest
--       empty seat at or below the new size), keeping its people, name and
--       picks — "Team 9" in a slot becomes "Team 3" only if it was still
--       called "Team 9".
--   Moving renumbers the seat everywhere a seat number lives before a draft
--   (membership, co-managers, seat agents, pick assets, the set draft order,
--   lottery shares, vampire seats). It is refused once any player is on a
--   roster (a keeper or dynasty carry-over) or a trade offer is open: those
--   carry seat numbers too, and a refusal that names the seat beats a quiet
--   renumbering of somebody's roster.
--
--   AFTER EITHER. settings_json.teams follows; a playoff field bigger than
--   the league shrinks to the largest that fits (8, 6, 4, 2); a schedule that
--   was already drawn is redrawn for the same number of weeks; the league
--   hears it in chat.
create or replace function commish_set_league_size(p_league_id uuid, p_teams int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  dstat text; n_old int; r jsonb; i int; k int;
  high_empty int[]; high_full int[]; low_empty int[]; freed int[]; removed int[]; mv jsonb := '[]'::jsonb;
  src int; dst int; nm text; pt int; wks int; sched jsonb; ord jsonb; ls jsonb; vr jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'only a league made here can change size');
  end if;
  if p_teams is null or p_teams < 2 or p_teams > 32 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–32');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the league size locks once the draft starts');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':size'));
  select count(*) into n_old from league_membership where league_id = p_league_id;
  if p_teams = n_old then
    return jsonb_build_object('ok', true, 'teams', n_old, 'added', 0, 'removed', '[]'::jsonb, 'moved', '[]'::jsonb);
  end if;

  if p_teams > n_old then
    -- ── GROW ──────────────────────────────────────────────────────────────
    for i in (n_old + 1)..p_teams loop
      insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
      values (p_league_id, i, 'Team ' || i, false);
      -- the same future picks every seat holds (one row per season/round/kind)
      insert into pick_asset (league_id, season, round, original_roster, owner_roster, kind)
        select distinct p_league_id, season, round, i, i, kind from pick_asset where league_id = p_league_id
        on conflict do nothing;
    end loop;
    update draft set draft_order = draft_order || (select jsonb_agg(g) from generate_series(n_old + 1, p_teams) g)
     where league_id = p_league_id and draft_order is not null and jsonb_typeof(draft_order) = 'array';
  else
    -- ── SHRINK ────────────────────────────────────────────────────────────
    -- empty = nobody, no invite, no co-manager, no players
    select coalesce(array_agg(m.sleeper_roster_id order by m.sleeper_roster_id), '{}') into high_empty
      from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id > p_teams and _seat_is_empty(p_league_id, m.sleeper_roster_id);
    select coalesce(array_agg(m.sleeper_roster_id order by m.sleeper_roster_id), '{}') into high_full
      from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id > p_teams and not _seat_is_empty(p_league_id, m.sleeper_roster_id);
    select coalesce(array_agg(m.sleeper_roster_id order by m.sleeper_roster_id desc), '{}') into low_empty
      from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id <= p_teams and _seat_is_empty(p_league_id, m.sleeper_roster_id);
    k := coalesce(array_length(high_full, 1), 0);
    if k > coalesce(array_length(low_empty, 1), 0) then
      return jsonb_build_object('ok', false, 'error',
        'only ' || (coalesce(array_length(high_empty, 1), 0) + coalesce(array_length(low_empty, 1), 0))
          || ' seats are empty — a league of ' || n_old || ' can shrink to '
          || (n_old - coalesce(array_length(high_empty, 1), 0) - coalesce(array_length(low_empty, 1), 0))
          || ' at the least until someone is unassigned');
    end if;
    if k > 0 then
      if exists (select 1 from native_roster where league_id = p_league_id) then
        return jsonb_build_object('ok', false, 'error',
          _txn_team(p_league_id, high_full[1]) || ' (seat ' || high_full[1] || ') would have to move to a lower seat, '
            || 'and players are already on rosters — unassign it or keep ' || high_full[1] || ' teams or more');
      end if;
      if exists (select 1 from trade_proposal where league_id = p_league_id and status in ('pending', 'accepted', 'review')) then
        return jsonb_build_object('ok', false, 'error', 'settle the open trade offers first — they name seats by number');
      end if;
    end if;
    -- the lowest k of the empty low seats become the moved seats' new numbers
    select coalesce(array_agg(x order by x), '{}') into freed from (select unnest(low_empty) x order by x desc limit k) z;
    removed := high_empty || freed;

    -- clear the removed seats out of everything that names them
    delete from seat_agent where league_id = p_league_id and roster_id = any (removed);
    delete from pick_asset where league_id = p_league_id and (original_roster = any (removed) or owner_roster = any (removed));
    delete from league_membership where league_id = p_league_id and sleeper_roster_id = any (removed);

    -- move each claimed high seat into a freed number
    for i in 1..k loop
      src := high_full[i]; dst := freed[i];
      update league_membership set sleeper_roster_id = dst,
             team_name = case when team_name = 'Team ' || src then 'Team ' || dst else team_name end
       where league_id = p_league_id and sleeper_roster_id = src;
      update team_manager set roster_id = dst where league_id = p_league_id and roster_id = src;
      update seat_agent set roster_id = dst where league_id = p_league_id and roster_id = src;
      update pick_asset set original_roster = dst where league_id = p_league_id and original_roster = src;
      update pick_asset set owner_roster = dst where league_id = p_league_id and owner_roster = src;
      select team_name into nm from league_membership where league_id = p_league_id and sleeper_roster_id = dst;
      mv := mv || jsonb_build_object('from', src, 'to', dst, 'team', nm);
    end loop;

    -- the draft's own seat lists: drop the removed, renumber the moved
    select draft_order, lottery_shares into ord, ls from draft where league_id = p_league_id;
    if ord is not null and jsonb_typeof(ord) = 'array' then
      select coalesce(jsonb_agg(coalesce((select (m ->> 'to')::int from jsonb_array_elements(mv) m where (m ->> 'from')::int = e::int), e::int) order by o), '[]'::jsonb)
        into ord
        from jsonb_array_elements_text(ord) with ordinality t(e, o)
       where not (e::int = any (removed));
      update draft set draft_order = ord where league_id = p_league_id;
    end if;
    if ls is not null and jsonb_typeof(ls) = 'object' then
      select coalesce(jsonb_object_agg(coalesce((select m ->> 'to' from jsonb_array_elements(mv) m where m ->> 'from' = key), key), value), '{}'::jsonb)
        into ls from jsonb_each(ls) where not (key::int = any (removed));
      update draft set lottery_shares = ls where league_id = p_league_id;
    end if;
    -- vampire seats (0268's list, 0222's single key)
    select settings_json -> 'vampire_rosters' into vr from league where id = p_league_id;
    if vr is not null and jsonb_typeof(vr) = 'array' then
      select coalesce(jsonb_agg(coalesce((select (m ->> 'to')::int from jsonb_array_elements(mv) m where (m ->> 'from')::int = e::int), e::int)), '[]'::jsonb)
        into vr from jsonb_array_elements_text(vr) e where not (e::int = any (removed));
      update league set settings_json = settings_json || jsonb_build_object('vampire_rosters', vr) where id = p_league_id;
    end if;
  end if;

  -- ── AFTER EITHER ────────────────────────────────────────────────────────
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('teams', p_teams)
   where id = p_league_id;
  pt := league_playoff_teams(p_league_id);
  if pt > p_teams then
    pt := case when p_teams >= 8 then 8 when p_teams >= 6 then 6 when p_teams >= 4 then 4 else 2 end;
    update league set settings_json = settings_json || jsonb_build_object('playoff_teams', pt) where id = p_league_id;
  end if;
  select count(distinct week) into wks from matchup
   where league_id = p_league_id and not coalesce(is_playoff, false) and not is_practice_week(week);
  if wks > 0 then
    sched := native_generate_schedule(p_league_id, least(wks, 18));
  end if;
  perform _chat_house(p_league_id,
    '🏈 The commissioner made this a ' || p_teams || '-team league'
      || case when p_teams > n_old then ' — ' || (p_teams - n_old) || ' open seat' || case when p_teams - n_old = 1 then '' else 's' end || ' added.'
              else ' — ' || (n_old - p_teams) || ' empty seat' || case when n_old - p_teams = 1 then '' else 's' end || ' removed'
                   || case when jsonb_array_length(mv) > 0 then ' (' || (select string_agg((m ->> 'team') || ' is now seat ' || (m ->> 'to'), ', ') from jsonb_array_elements(mv) m) || ')' else '' end
                   || '.' end,
    jsonb_build_object('kind', 'league_size', 'teams', p_teams));
  return jsonb_build_object('ok', true, 'teams', p_teams,
    'added', greatest(p_teams - n_old, 0), 'removed', to_jsonb(coalesce(removed, '{}'::int[])), 'moved', mv,
    'playoff_teams', league_playoff_teams(p_league_id),
    'schedule', case when wks > 0 then coalesce(sched, '{}'::jsonb) else null end);
end $$;
grant execute on function commish_set_league_size(uuid, int) to authenticated;

/** An empty seat: nobody seated, nobody invited by email, no co-manager, no players. */
create or replace function _seat_is_empty(p_league_id uuid, p_roster int) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_roster
                   and m.app_user_id is null and not m.enrolled and m.claim_email is null)
     and not exists (select 1 from team_manager t where t.league_id = p_league_id and t.roster_id = p_roster)
     and not exists (select 1 from native_roster r where r.league_id = p_league_id and r.roster_id = p_roster);
$$;
