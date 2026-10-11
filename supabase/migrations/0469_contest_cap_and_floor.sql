-- 0469: THE CAP IS OPTIONAL; GOLF GETS A FLOOR (v0.668.0).
--
-- Founder: "Any reason to have a budget in bullseye or golf dfs leagues?"
-- Bullseye earns its cap (it breaks consensus — without one every seat picks
-- the player projected closest to each number), but a commissioner who wants
-- pure aim may drop it. Golf's cap is close to pointless: the lowest-
-- projected players who still play are also the cheapest, so nobody ever
-- reaches it. What golf needs is the opposite constraint — a MINIMUM SPEND,
-- so you must roster expensive players and bet on which stars have a quiet
-- week. Founder: "add min spend as an adjustable option in golf."
--
-- Two settings keys:
--   budget     the cap; 0 = no cap (was $10,000–$500,000, never 0)
--   min_spend  the floor; 0 or absent = none; $5,000–$500,000
-- A squad is refused over the cap (as before) or under the floor.

create or replace function _contest_budget(lg league) returns int
  language sql immutable as $$
  select coalesce(nullif(lg.settings_json ->> 'budget', '')::int, 50000);
$$;

create or replace function _contest_min_spend(lg league) returns int
  language sql immutable as $$
  select coalesce(nullif(lg.settings_json ->> 'min_spend', '')::int, 0);
$$;

-- ── the league's card carries the floor ─────────────────────────────────────
create or replace function _bullseye_info(lg league) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when _is_contest(lg) then jsonb_build_object(
    'contest', _contest_of(lg),
    'format', _contest_format_of(lg),
    'budget', _contest_budget(lg),
    'min_spend', _contest_min_spend(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', coalesce(_bullseye_max_seats(lg), (select count(*)::int from league_membership m where m.league_id = lg.id)),
    'seats_taken', _league_seats_taken(lg.id),
    'spots', jsonb_array_length(_contest_slots(lg)))
  else null end;
$$;

-- ── create: a cap of 0 is no cap; a floor, 0 by default ─────────────────────
drop function if exists create_contest_league(text, text, text, text, int, int, text, int, text, text);
create or replace function create_contest_league(p_name text, p_contest text default 'high', p_format text default 'board',
    p_span text default 'season', p_max int default 12, p_budget int default 50000,
    p_variant text default 'slots', p_radius int default 10, p_team_name text default null, p_season text default '2026',
    p_min_spend int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; cap int; lid uuid; nm text; tm text; lg league; s jsonb; i int;
        names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew',
                              'Punt Return Party','Blitz Brigade','Fourth And Long','Snap Count Crew','End Around Gang','Mud Dogs'];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  if p_contest not in ('high', 'golf', 'bullseye') then return jsonb_build_object('ok', false, 'error', 'a contest is high, golf or bullseye'); end if;
  if p_format not in ('h2h', 'board') then return jsonb_build_object('ok', false, 'error', 'a format is h2h or board'); end if;
  if p_span not in ('week', 'season') then return jsonb_build_object('ok', false, 'error', 'a league runs one week or the season'); end if;
  if p_variant not in ('slots', 'total') then return jsonb_build_object('ok', false, 'error', 'variant is slots or total'); end if;
  if p_radius is null or p_radius < 2 or p_radius > 50 then return jsonb_build_object('ok', false, 'error', 'radius is 2–50'); end if;
  if p_budget is null or (p_budget <> 0 and (p_budget < 10000 or p_budget > 500000)) then return jsonb_build_object('ok', false, 'error', 'the budget is $10,000–$500,000, or 0 for no cap'); end if;
  if p_min_spend is null or (p_min_spend <> 0 and (p_min_spend < 5000 or p_min_spend > 500000)) then return jsonb_build_object('ok', false, 'error', 'the minimum spend is $5,000–$500,000, or 0 for none'); end if;
  if p_budget > 0 and p_min_spend > p_budget then return jsonb_build_object('ok', false, 'error', 'the minimum spend can''t be above the budget'); end if;
  cap := case when p_format = 'h2h' then 32 else _bullseye_max_cap() end;
  if p_max is null or p_max < 2 or p_max > cap then
    return jsonb_build_object('ok', false, 'error', 'a ' || case when p_format = 'h2h' then 'head-to-head' else 'leaderboard' end || ' league holds 2–' || cap || ' people');
  end if;
  if p_format = 'h2h' and p_max % 2 <> 0 then return jsonb_build_object('ok', false, 'error', 'a head-to-head league needs an even number of teams'); end if;
  wk := _contest_week(p_season);
  if p_span = 'week' and wk is null then return jsonb_build_object('ok', false, 'error', 'no NFL week on the slate right now'); end if;
  nm := coalesce(nullif(left(btrim(coalesce(p_name, '')), 60), ''),
                 case p_contest when 'golf' then 'Golf DFS' when 'bullseye' then 'Bullseye' else 'DFS' end
                 || case when p_span = 'week' then ' · Week ' || wk else ' League' end);
  s := jsonb_build_object('game_mode', 'classic', 'contest', p_contest, 'contest_format', p_format, 'budget', (p_budget / 100) * 100,
                          'min_spend', (p_min_spend / 100) * 100,
                          'span', p_span, 'max_seats', p_max, 'roster_slots', _contest_default_slots(), 'ppr', 1);
  if p_contest = 'bullseye' then s := s || jsonb_build_object('dfs_bullseye', true, 'bullseye', p_variant, 'bullseye_radius', p_radius); end if;
  if p_contest = 'golf' then s := s || '{"golf": true}'::jsonb; end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league (sleeper_league_id, season, name, kind, contest_week, kdst_mode, provider, lineup_policy, commissioner_id, settings_json)
  values ('CON-' || upper(left(md5(gen_random_uuid()::text), 10)), p_season, nm, 'dfs',
          case when p_span = 'week' then wk end, 'off', 'pod', 'empty', auth.uid(), s)
  returning id into lid;
  tm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(1));
  if p_format = 'h2h' then
    for i in 1..p_max loop
      insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
      values (lid, i, 'CON-AI-' || i, null, false,
              names[1 + ((i - 1) % 12)] || case when i > 12 then ' ' || (1 + (i - 1) / 12) else '' end, 'ai');
    end loop;
    update league_membership set app_user_id = auth.uid(), enrolled = true, controller = 'human', team_name = tm
     where league_id = lid and sleeper_roster_id = 1;
  else
    insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
    values (lid, 1, 'CON-1', auth.uid(), true, tm, 'human');
  end if;
  select * into lg from league where id = lid;
  return jsonb_build_object('ok', true, 'league_id', lid, 'name', lg.name, 'invite_code', lg.invite_code,
    'roster_id', 1, 'team', tm, 'bullseye', _bullseye_info(lg));
end $$;

-- ── the commissioner's rules: cap (0 = none) and floor ──────────────────────
drop function if exists set_contest_rules(uuid, text, text, int);
create or replace function set_contest_rules(p_league uuid, p_contest text default null, p_format text default null, p_budget int default null,
    p_min_spend int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; s jsonb; cap int; flr int;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  if exists (select 1 from matchup where league_id = p_league and status = 'live') then
    return jsonb_build_object('ok', false, 'error', 'a week is being played — change it once it''s final');
  end if;
  s := coalesce(lg.settings_json, '{}'::jsonb);
  if p_contest is not null then
    if p_contest not in ('high', 'golf', 'bullseye') then return jsonb_build_object('ok', false, 'error', 'a contest is high, golf or bullseye'); end if;
    s := (s - 'dfs_bullseye' - 'golf') || jsonb_build_object('contest', p_contest);
    if p_contest = 'bullseye' then
      s := s || jsonb_build_object('dfs_bullseye', true, 'bullseye', coalesce(s ->> 'bullseye', 'slots'), 'bullseye_radius', coalesce((s ->> 'bullseye_radius')::int, 10));
    else
      s := s - 'bullseye' - 'bullseye_radius';
    end if;
    if p_contest = 'golf' then s := s || '{"golf": true}'::jsonb; end if;
  end if;
  if p_format is not null then
    if p_format not in ('h2h', 'board') then return jsonb_build_object('ok', false, 'error', 'a format is h2h or board'); end if;
    if p_format <> _contest_format_of(lg) and exists (select 1 from matchup where league_id = p_league) then
      return jsonb_build_object('ok', false, 'error', 'the format is set before the first week is played');
    end if;
    if p_format = 'h2h' and (select count(*) from league_membership where league_id = p_league) % 2 <> 0 then
      return jsonb_build_object('ok', false, 'error', 'head-to-head needs an even number of seats');
    end if;
    s := s || jsonb_build_object('contest_format', p_format);
  end if;
  if p_budget is not null then
    if p_budget <> 0 and (p_budget < 10000 or p_budget > 500000) then return jsonb_build_object('ok', false, 'error', 'the budget is $10,000–$500,000, or 0 for no cap'); end if;
    s := s || jsonb_build_object('budget', (p_budget / 100) * 100);
  end if;
  if p_min_spend is not null then
    if p_min_spend <> 0 and (p_min_spend < 5000 or p_min_spend > 500000) then return jsonb_build_object('ok', false, 'error', 'the minimum spend is $5,000–$500,000, or 0 for none'); end if;
    s := s || jsonb_build_object('min_spend', (p_min_spend / 100) * 100);
  end if;
  cap := coalesce(nullif(s ->> 'budget', '')::int, 50000);
  flr := coalesce(nullif(s ->> 'min_spend', '')::int, 0);
  if cap > 0 and flr > cap then return jsonb_build_object('ok', false, 'error', 'the minimum spend can''t be above the budget'); end if;
  update league set settings_json = s where id = p_league;
  select * into lg from league where id = p_league;
  return jsonb_build_object('ok', true, 'bullseye', _bullseye_info(lg));
end $$;

-- ── saving a squad: over the cap, or under the floor ─────────────────────────
create or replace function save_contest_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; spots jsonb; n int; i int; slot text; pslug text; ps pod_salary; bad text;
        spent int := 0; seen text[] := '{}'; old jsonb; lineup jsonb := '[]'::jsonb; lk timestamptz; budget int; floor_ int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if lg.contest_week is null and p_week < coalesce(_contest_week(lg.season), 1) then
    return jsonb_build_object('ok', false, 'error', 'that week has been played');
  end if;
  select * into seat from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final'
               and seat.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;
  if jsonb_typeof(p_slots) <> 'object' then return jsonb_build_object('ok', false, 'error', 'a squad is one player per spot'); end if;
  spots := _contest_slots(lg);
  n := jsonb_array_length(spots);
  budget := _contest_budget(lg);
  floor_ := _contest_min_spend(lg);
  select string_agg(k, ', ') into bad from jsonb_object_keys(p_slots) k where k !~ '^S[0-9]+$' or substr(k, 2)::int < 1 or substr(k, 2)::int > n;
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'unknown spot: ' || bad); end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;

  for i in 1..n loop
    slot := 'S' || i;
    pslug := nullif(btrim(coalesce(p_slots ->> slot, '')), '');
    if pslug is null then
      return jsonb_build_object('ok', false, 'error', 'fill every spot — ' || coalesce(nullif(spots -> (i - 1) ->> 'label', ''), array_to_string(array(select upper(x) from jsonb_array_elements_text(spots -> (i - 1) -> 'pos') x), '/')) || ' is empty');
    end if;
    if pslug = any (seen) then return jsonb_build_object('ok', false, 'error', 'a player can only fill one spot'); end if;
    seen := array_append(seen, pslug);
    select * into ps from pod_salary where season = p_season and week = p_week and pod_salary.slug = pslug;
    if ps.slug is null then return jsonb_build_object('ok', false, 'error', 'a pick is not on this week''s board'); end if;
    -- RULED OUT (0467): a player the injury report has at O or IR is not a
    -- new pick — the DFS rule. One already in the saved squad may stay (and
    -- be swapped out until his game locks).
    if exists (select 1 from injury_status ist where ist.player_slug = pslug and upper(ist.status) in ('O', 'IR'))
       and not exists (select 1 from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o where o ->> 'player_slug' = pslug) then
      return jsonb_build_object('ok', false, 'error', ps.name || ' is ruled out this week — pick someone else');
    end if;
    bad := _contest_spot_error(lg, seat.sleeper_roster_id, spots -> (i - 1), slot, ps);
    if bad is not null then return jsonb_build_object('ok', false, 'error', bad); end if;
    spent := spent + ps.salary;
    lineup := lineup || jsonb_build_object('slot', slot, 'sleeper_id', null, 'player_slug', pslug, 'pos', upper(ps.pos));
  end loop;
  if budget > 0 and spent > budget then return jsonb_build_object('ok', false, 'error', 'over the $' || to_char(budget, 'FM999,999,999') || ' budget by $' || to_char(spent - budget, 'FM999,999,999')); end if;
  -- THE FLOOR (0469): golf's constraint — spend at least this much.
  if floor_ > 0 and spent < floor_ then return jsonb_build_object('ok', false, 'error', 'under the $' || to_char(floor_, 'FM999,999,999') || ' minimum spend by $' || to_char(floor_ - spent, 'FM999,999,999')); end if;

  -- the per-player lock (0093)
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = o ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
     and (p_slots ->> (o ->> 'slot')) is distinct from (o ->> 'player_slug');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'locked in — ' || bad || ' can''t be moved or dropped'); end if;
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(lineup) e
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = e ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
     and not exists (select 1 from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
                      where o ->> 'player_slug' = e ->> 'player_slug' and o ->> 'slot' = e ->> 'slot');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || bad); end if;

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'budget', budget, 'min_spend', floor_, 'roster_id', seat.sleeper_roster_id);
end $$;

-- ── contest_state carries the floor ─────────────────────────────────────────
create or replace function contest_state(p_league uuid, p_week int default null, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; opp int; st matchup_state; started boolean; mine jsonb; theirs jsonb; spots jsonb;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  wk := coalesce(p_week, lg.contest_week,
    (select min(week) from matchup where league_id = p_league and status <> 'final'),
    (select max(week) from matchup where league_id = p_league), _contest_week(p_season));
  if me.id is not null then
    select * into m from matchup where league_id = p_league and week = wk
       and me.sleeper_roster_id in (home_roster_id, away_roster_id) limit 1;
  end if;
  opp := case when m.id is null then null when m.home_roster_id = me.sleeper_roster_id then m.away_roster_id else m.home_roster_id end;
  if opp = me.sleeper_roster_id then opp := null; end if;
  started := coalesce(_week_first_lock(p_season, wk) <= now(), false);
  select starters_json into mine from sleeper_lineup where league_id = p_league and week = wk and roster_id = me.sleeper_roster_id;
  if opp is not null then
    select jsonb_agg(case when _dfs_player_locked(p_season, wk, e ->> 'player_slug') then e
                          else jsonb_build_object('slot', e -> 'slot', 'sealed', true) end order by ord)
      into theirs
      from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) with ordinality x(e, ord)
     where sl.league_id = p_league and sl.week = wk and sl.roster_id = opp;
  end if;
  select * into st from matchup_state where matchup_id = m.id and game_window = 'wk';
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  return jsonb_build_object('ok', true, 'on', true, 'kind', lg.kind, 'name', lg.name, 'week', wk, 'season', p_season,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg), 'budget', _contest_budget(lg), 'min_spend', _contest_min_spend(lg), 'slots', spots,
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'positions_extra', coalesce(lg.settings_json -> 'positions_extra', '[]'::jsonb),
    'scoring_classic', lg.settings_json -> 'scoring_classic', 'ppr', coalesce((lg.settings_json ->> 'ppr')::numeric, 1),
    'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'started', started,
    'entry', mine,
    'matchup', case when m.id is null then null else jsonb_build_object('id', m.id, 'status', m.status,
      'home', m.home_roster_id, 'away', m.away_roster_id, 'home_final', m.home_final, 'away_final', m.away_final,
      'home_tb', m.home_tb, 'away_tb', m.away_tb) end,
    'opponent', case when opp is null then null else jsonb_build_object('roster_id', opp,
      'team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = opp limit 1),
      'entry', theirs) end,
    'state', case when st.matchup_id is null or not started then null else jsonb_build_object(
      'home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function _contest_min_spend(league) from public, anon, authenticated;
revoke all on function create_contest_league(text, text, text, text, int, int, text, int, text, text, int),
  set_contest_rules(uuid, text, text, int, int), save_contest_entry(uuid, int, jsonb, text), contest_state(uuid, int, text) from public, anon;
grant execute on function create_contest_league(text, text, text, text, int, int, text, int, text, text, int),
  set_contest_rules(uuid, text, text, int, int), save_contest_entry(uuid, int, jsonb, text), contest_state(uuid, int, text) to authenticated;
