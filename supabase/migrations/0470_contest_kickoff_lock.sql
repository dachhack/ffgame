-- 0470: A CONTEST PLAYER LOCKS AT HIS KICKOFF; A RULED-OUT PICK CAN BE SWAPPED
-- FOR YOU (v0.669.0).
--
-- Founder, with Rico Dowdle ruled out at 12:06 for a 1:00 game: "Should I be
-- able to swap out dowdle since he was declared out?" He had locked at noon:
-- every player locked an hour before his own kickoff — the drip engine's
-- cushion for sealing picks before the live board, inherited by contest
-- leagues without a reason that applies to them. A DFS site locks each
-- player at his actual kickoff. So:
--
--   • `_week_first_lock` is now the week's first KICKOFF (it gates "started",
--     the board's row lock and the no-show build);
--   • `_dfs_player_locked` and save_contest_entry's per-player lock are at
--     the player's kickoff;
--   • set_contest_rules takes `p_auto_sub`: with it on, the worker swaps a
--     ruled-out human pick for the best affordable body in the minutes
--     before his kickoff (server/src/contestSubs.js). Off by default.
--
-- Classic and drip leagues keep their hour: their lock is the matchup's
-- lock_at, which this does not touch.

create or replace function _week_first_lock(p_season text, p_week int) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select min(kickoff) from nfl_slate
   where season = p_season and week = p_week and kickoff is not null
$$;

create or replace function _dfs_player_locked(p_season text, p_week int, p_slug text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from pod_salary ps join nfl_slate g on g.season = ps.season and g.week = ps.week and ps.team in (g.home, g.away)
                  where ps.season = p_season and ps.week = p_week and ps.slug = p_slug
                    and g.kickoff is not null and g.kickoff <= now())
$$;

create or replace function _bullseye_info(lg league) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when _is_contest(lg) then jsonb_build_object(
    'contest', _contest_of(lg),
    'format', _contest_format_of(lg),
    'budget', _contest_budget(lg),
    'min_spend', _contest_min_spend(lg),
    'auto_sub', coalesce((lg.settings_json ->> 'auto_sub')::boolean, false),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', coalesce(_bullseye_max_seats(lg), (select count(*)::int from league_membership m where m.league_id = lg.id)),
    'seats_taken', _league_seats_taken(lg.id),
    'spots', jsonb_array_length(_contest_slots(lg)))
  else null end;
$$;

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

  -- the per-player lock (0093) — AT KICKOFF for a contest league (0470).
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = o ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
     and (p_slots ->> (o ->> 'slot')) is distinct from (o ->> 'player_slug');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'locked in — ' || bad || ' can''t be moved or dropped'); end if;
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(lineup) e
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = e ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
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

drop function if exists set_contest_rules(uuid, text, text, int, int);
create or replace function set_contest_rules(p_league uuid, p_contest text default null, p_format text default null, p_budget int default null,
    p_min_spend int default null, p_auto_sub boolean default null)
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
  -- AUTO-SUB (0470): a ruled-out human pick is swapped by the worker just
  -- before his kickoff. Opt-in: some would rather take the zero than a sub
  -- they didn't choose.
  if p_auto_sub is not null then s := s || jsonb_build_object('auto_sub', p_auto_sub); end if;
  cap := coalesce(nullif(s ->> 'budget', '')::int, 50000);
  flr := coalesce(nullif(s ->> 'min_spend', '')::int, 0);
  if cap > 0 and flr > cap then return jsonb_build_object('ok', false, 'error', 'the minimum spend can''t be above the budget'); end if;
  update league set settings_json = s where id = p_league;
  select * into lg from league where id = p_league;
  return jsonb_build_object('ok', true, 'bullseye', _bullseye_info(lg));
end $$;

revoke all on function set_contest_rules(uuid, text, text, int, int, boolean), save_contest_entry(uuid, int, jsonb, text) from public, anon;
grant execute on function set_contest_rules(uuid, text, text, int, int, boolean), save_contest_entry(uuid, int, jsonb, text) to authenticated;
