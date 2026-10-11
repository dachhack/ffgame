-- 0481: MULTIPLE ENTRIES PER MEMBER (v0.681.0). HANDOFF's last not-done
-- item: a 50,000-seat weekly contest wants a member to field more than one
-- squad, and everything from the seat on up assumed one seat per user —
-- contest_state, save_contest_entry, contest_swaps, bullseye_my_weeks,
-- contest_matchup, the board's own row, the take-a-seat join. Now:
--
--   max_entries   — a contest rule (set_contest_rules's ninth parameter),
--                   1–50, leaderboard leagues only; head-to-head stays one
--                   (an opponent is a person). _bullseye_info carries it and
--                   my_entries, the seats the caller holds.
--   add_contest_entry(league, team)
--                 — a seated member takes another seat under that rule, by
--                   _contest_take_seat's new third parameter.
--   p_roster      — contest_state, save_contest_entry and bullseye_my_weeks
--                   take the seat to read or write (one of mine; a seat that
--                   isn't mine is refused on a save and falls to my first on
--                   a read); contest_swaps and contest_matchup already took
--                   one and now know every seat of mine. contest_state and
--                   bullseye_my_weeks list `seats`, the switcher's rows.
--   the board     — contest_board's `me` row and `near` go by my best seat,
--                   not whichever row came first; every seat of mine still
--                   carries me = true.
--
-- A function whose parameter list grows is dropped first (two overloads with
-- defaults make a PostgREST call ambiguous), and the grants are restated.

-- ── the rule and my seats ───────────────────────────────────────────────────
create or replace function _contest_max_entries(lg league) returns int
  language sql stable as $$
  select case when _contest_format_of(lg) = 'h2h' then 1
              else greatest(1, least(coalesce(nullif(lg.settings_json ->> 'max_entries', '')::int, 1), 50)) end;
$$;
/** Every enrolled seat of the caller's in a league, lowest number first. */
create or replace function _my_contest_seats(p_league uuid) returns setof league_membership
  language sql stable security definer set search_path = public as $$
  select m.* from league_membership m where m.league_id = p_league and m.app_user_id = auth.uid() and m.enrolled order by m.sleeper_roster_id;
$$;
/** The caller's seat p_roster, if it is theirs; else their first. Null-id when they hold none. */
create or replace function _my_contest_seat(p_league uuid, p_roster int) returns league_membership
  language sql stable security definer set search_path = public as $$
  select m from league_membership m where m.league_id = p_league and m.app_user_id = auth.uid() and m.enrolled
   order by (m.sleeper_roster_id = p_roster) desc, m.sleeper_roster_id limit 1;
$$;
create or replace function _my_contest_seats_json(p_league uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('roster_id', s.sleeper_roster_id, 'team', s.team_name) order by s.sleeper_roster_id), '[]'::jsonb)
    from _my_contest_seats(p_league) s;
$$;

-- ── another seat ────────────────────────────────────────────────────────────
drop function if exists _contest_take_seat(uuid, text);
create or replace function _contest_take_seat(p_league uuid, p_team_name text, p_another boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; seat league_membership; rid int; nm text; held int; mx int;
begin
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() order by sleeper_roster_id limit 1;
  if me.id is not null and not p_another then
    if not me.enrolled then update league_membership set enrolled = true where id = me.id; end if;
    return jsonb_build_object('ok', true, 'already', me.enrolled, 'league_id', p_league, 'league', lg.name,
      'roster_id', me.sleeper_roster_id, 'team', me.team_name);
  end if;
  -- ANOTHER ENTRY (0481): a member already seated takes a second seat, under
  -- the league's entries-per-member rule.
  if me.id is not null and p_another then
    mx := _contest_max_entries(lg);
    select count(*) into held from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled;
    if held >= mx then
      return jsonb_build_object('ok', false, 'error', case when mx = 1 then 'one entry per member here' else 'you hold all ' || mx || ' of your entries here' end);
    end if;
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtext('contest-seat|' || p_league::text));
  if _contest_format_of(lg) = 'h2h' then
    select m.* into seat from league_membership m
     where m.league_id = p_league and m.app_user_id is null
     order by m.sleeper_roster_id limit 1;
    if seat.id is null then return jsonb_build_object('ok', false, 'error', 'this league is full'); end if;
    nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), seat.team_name);
    update league_membership set app_user_id = auth.uid(), enrolled = true, controller = 'human', team_name = nm where id = seat.id;
    return jsonb_build_object('ok', true, 'league_id', p_league, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', nm);
  end if;
  if _league_seats_taken(p_league) >= _bullseye_max_seats(lg) then
    return jsonb_build_object('ok', false, 'error', 'this league is full');
  end if;
  select coalesce(max(sleeper_roster_id), 0) + 1 into rid from league_membership where league_id = p_league;
  nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(rid));
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
  values (p_league, rid, 'CON-' || rid, auth.uid(), true, nm, 'human');
  return jsonb_build_object('ok', true, 'league_id', p_league, 'league', lg.name, 'roster_id', rid, 'team', nm);
end $$;

create or replace function _bullseye_take_seat(p_league uuid, p_team_name text)
  returns jsonb language sql security definer set search_path = public as $$ select _contest_take_seat(p_league, p_team_name, false); $$;
/** A seated member's next entry, under the league's entries-per-member rule. */
create or replace function add_contest_entry(p_league uuid, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  if not exists (select 1 from _my_contest_seats(p_league)) then return jsonb_build_object('ok', false, 'error', 'join the league first'); end if;
  return _contest_take_seat(p_league, p_team_name, true);
end $$;

-- ── the rule on the commissioner's card ─────────────────────────────────────
drop function if exists set_contest_rules(uuid, text, text, int, int, boolean, text, text);
create or replace function set_contest_rules(p_league uuid, p_contest text default null, p_format text default null, p_budget int default null,
    p_min_spend int default null, p_auto_sub boolean default null, p_late_entry text default null, p_entry_deadline text default null,
    p_max_entries int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; s jsonb; cap int; flr int; fmt text; ctst text;
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
    -- a head-to-head seat can't sit a week out: an opponent is waiting
    if p_format = 'h2h' and s ->> 'late_entry' = 'drop' then s := s - 'late_entry'; end if;
    -- head-to-head is one seat per member: an opponent is a person
    if p_format = 'h2h' then s := s - 'max_entries'; end if;
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
  -- NO SQUAD BY LOCK and ENTRIES (0475).
  fmt := coalesce(s ->> 'contest_format', _contest_format_of(lg));
  ctst := coalesce(s ->> 'contest', _contest_of(lg));
  if p_late_entry is not null then
    if p_late_entry not in ('cpu', 'zero', 'drop') then return jsonb_build_object('ok', false, 'error', 'a no-show rule is cpu, zero or drop'); end if;
    if p_late_entry = 'drop' and fmt = 'h2h' then
      return jsonb_build_object('ok', false, 'error', 'a head-to-head seat can''t sit a week out — its opponent is waiting. Pick THE CPU BUILDS ONE or SCORES ZERO');
    end if;
    if p_late_entry = 'zero' and ctst = 'golf'
       and exists (select 1 from jsonb_array_elements(_contest_slots(lg)) d where coalesce(nullif(d ->> 'zero_pts', '')::numeric, 0) <= 0) then
      return jsonb_build_object('ok', false, 'error', 'in golf a scoreless squad is the best score — set every spot''s 0 → penalty on ROSTER first, or let the CPU build');
    end if;
    s := s || jsonb_build_object('late_entry', p_late_entry);
  end if;
  if p_entry_deadline is not null then
    if p_entry_deadline not in ('open', 'first') then return jsonb_build_object('ok', false, 'error', 'entries are open or close at the first kickoff'); end if;
    s := s || jsonb_build_object('entry_deadline', p_entry_deadline);
  end if;
  -- ENTRIES PER MEMBER (0481): how many seats one member may hold, on a
  -- leaderboard league. Head-to-head stays one: an opponent is a person.
  if p_max_entries is not null then
    if p_max_entries < 1 or p_max_entries > 50 then return jsonb_build_object('ok', false, 'error', 'entries per member is 1–50'); end if;
    if p_max_entries > 1 and fmt = 'h2h' then return jsonb_build_object('ok', false, 'error', 'head-to-head is one entry per member — an opponent is a person'); end if;
    s := s || jsonb_build_object('max_entries', p_max_entries);
  end if;
  cap := coalesce(nullif(s ->> 'budget', '')::int, 50000);
  flr := coalesce(nullif(s ->> 'min_spend', '')::int, 0);
  if cap > 0 and flr > cap then return jsonb_build_object('ok', false, 'error', 'the minimum spend can''t be above the budget'); end if;
  update league set settings_json = s where id = p_league;
  select * into lg from league where id = p_league;
  return jsonb_build_object('ok', true, 'bullseye', _bullseye_info(lg));
end $$;

create or replace function _bullseye_info(lg league) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when _is_contest(lg) then jsonb_build_object(
    'contest', _contest_of(lg),
    'format', _contest_format_of(lg),
    'budget', _contest_budget(lg),
    'min_spend', _contest_min_spend(lg),
    'auto_sub', coalesce((lg.settings_json ->> 'auto_sub')::boolean, false),
    'late_entry', _contest_late_entry(lg),
    'entry_deadline', _contest_entry_deadline(lg),
    'max_entries', _contest_max_entries(lg),
    'my_entries', (select count(*)::int from league_membership m where m.league_id = lg.id and m.app_user_id = auth.uid() and m.enrolled),
    'dues_amount', nullif(lg.settings_json ->> 'dues_amount', '')::int,
    'dues_note', lg.settings_json ->> 'dues_note',
    'prizes', _league_prizes(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', coalesce(_bullseye_max_seats(lg), (select count(*)::int from league_membership m where m.league_id = lg.id)),
    'seats_taken', _league_seats_taken(lg.id),
    'spots', jsonb_array_length(_contest_slots(lg)))
  else null end;
$$;

-- ── the seat through the reads and the save ─────────────────────────────────
drop function if exists contest_state(uuid, int, text);
create or replace function contest_state(p_league uuid, p_week int default null, p_season text default '2026', p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; opp int; st matchup_state; started boolean; mine jsonb; theirs jsonb; spots jsonb;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
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
    'seats', _my_contest_seats_json(p_league), 'max_entries', _contest_max_entries(lg),
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

drop function if exists save_contest_entry(uuid, int, jsonb, text);
create or replace function save_contest_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026', p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; bad text; chk jsonb;
        spent int := 0; old jsonb; lineup jsonb := '[]'::jsonb; lk timestamptz; budget int; floor_ int;
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
  seat := _my_contest_seat(p_league, p_roster);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if p_roster is not null and seat.sleeper_roster_id <> p_roster then return jsonb_build_object('ok', false, 'error', 'that isn''t your seat'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final'
               and seat.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;
  -- ENTRIES CLOSE AT THE FIRST KICKOFF (0475): no new squad after it. A
  -- squad the worker wrote empty for a no-show (`zero`) counts as none.
  if _contest_entry_deadline(lg) = 'first' and coalesce(jsonb_array_length(old), 0) = 0
     and coalesce(_week_first_lock(p_season, p_week) <= now(), false) then
    return jsonb_build_object('ok', false, 'error', 'entries closed at the week''s first kickoff');
  end if;

  chk := _contest_squad_check(lg, seat.sleeper_roster_id, p_week, p_slots, p_season, old, true);
  if chk ? 'error' then return jsonb_build_object('ok', false, 'error', chk ->> 'error'); end if;
  lineup := chk -> 'lineup'; spent := (chk ->> 'spent')::int; budget := (chk ->> 'budget')::int; floor_ := (chk ->> 'min_spend')::int;

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
  -- SWAP HISTORY (0478): a change to a saved squad, spot by spot.
  perform _log_contest_swaps(p_league, p_week, seat.sleeper_roster_id, old, lineup, 'swap', auth.uid());
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'budget', budget, 'min_spend', floor_, 'roster_id', seat.sleeper_roster_id);
end $$;

create or replace function contest_swaps(p_league uuid, p_week int, p_roster int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; rid int; open_ boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  rid := coalesce(p_roster, me.sleeper_roster_id);
  if rid is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  open_ := rid = me.sleeper_roster_id or is_league_commish(p_league) or is_admin()
           or coalesce(_week_first_lock(lg.season, p_week) <= now(), false);
  if not open_ then return jsonb_build_object('ok', false, 'error', 'a squad''s swaps show once the week''s squads unseal'); end if;
  return jsonb_build_object('ok', true, 'roster_id', rid, 'week', p_week, 'swaps', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'slot', s.slot, 'kind', s.kind, 'at', s.at,
             'out', s.out_slug, 'out_name', case when s.out_slug is null then null else _txn_player(p_league, s.out_slug) end,
             'in', s.in_slug, 'in_name', case when s.in_slug is null then null else _txn_player(p_league, s.in_slug) end) order by s.at desc, s.id desc)
      from contest_swap s where s.league_id = p_league and s.week = p_week and s.roster_id = rid), '[]'::jsonb));
end $$;

drop function if exists bullseye_my_weeks(uuid);
create or replace function bullseye_my_weeks(p_league uuid, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me league_membership; out jsonb; lg league; golf boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  golf := _contest_of(lg) = 'golf';
  with sides as (
    select m.week, m.status, m.home_roster_id as roster_id, m.home_tb as tb, coalesce(m.home_final, st.home_score) as ring,
           case when m.away_roster_id <> m.home_roster_id then m.away_roster_id end as opp, coalesce(m.away_final, st.away_score) as opp_ring,
           m.is_playoff, m.playoff_label
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk' where m.league_id = p_league
    union all
    select m.week, m.status, m.away_roster_id, m.away_tb, coalesce(m.away_final, st.away_score), m.home_roster_id, coalesce(m.home_final, st.home_score),
           m.is_playoff, m.playoff_label
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
     where m.league_id = p_league and m.away_roster_id <> m.home_roster_id
  ), ranked as (
    select sides.*, rank() over (partition by week order by case when golf then coalesce(ring, 0) else -coalesce(ring, 0) end asc, tb asc nulls last) as rank,
           count(*) over (partition by week) as entries
      from sides
  )
  select coalesce(jsonb_agg(jsonb_build_object('week', r.week, 'status', r.status, 'ring', r.ring, 'tb', r.tb,
           'rank', case when r.status in ('live', 'final') then r.rank end, 'entries', r.entries,
           'opp', r.opp, 'opp_team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = r.opp limit 1),
           'opp_ring', r.opp_ring, 'void', _week_void(p_league, r.week), 'playoff', r.is_playoff, 'label', r.playoff_label) order by r.week desc), '[]'::jsonb)
    into out from ranked r where r.roster_id = me.sleeper_roster_id;
  return jsonb_build_object('ok', true, 'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'weeks', out, 'seats', _my_contest_seats_json(p_league));
end $$;

create or replace function contest_matchup(p_league uuid, p_week int default null, p_matchup uuid default null, p_roster int default null, p_season text default '2026')
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; st matchup_state; started boolean; spots jsonb; mine int; seats int[];
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  mine := me.sleeper_roster_id;
  seats := array(select s.sleeper_roster_id from _my_contest_seats(p_league) s);
  wk := coalesce(p_week, lg.contest_week,
    (select min(week) from matchup where league_id = p_league and status <> 'final'),
    (select max(week) from matchup where league_id = p_league), _contest_week(p_season));
  started := coalesce(_week_first_lock(p_season, wk) <= now(), false);
  if p_matchup is not null then
    select * into m from matchup where id = p_matchup and league_id = p_league and week = wk;
  elsif p_roster is not null then
    select * into m from matchup where league_id = p_league and week = wk and p_roster in (home_roster_id, away_roster_id) limit 1;
  elsif mine is not null then
    select * into m from matchup where league_id = p_league and week = wk and mine in (home_roster_id, away_roster_id) limit 1;
  end if;
  if m.id is null then
    select * into m from matchup where league_id = p_league and week = wk order by is_playoff desc, playoff_round, bracket_pos, home_roster_id limit 1;
  end if;
  -- `me` is the seat of mine in the matchup shown (a member with several
  -- seats looks at one of them at a time), else my first.
  if m.id is not null then
    mine := case when m.home_roster_id = any(seats) then m.home_roster_id when m.away_roster_id = any(seats) then m.away_roster_id else mine end;
  end if;
  if m.id is not null then select * into st from matchup_state where matchup_id = m.id and game_window = 'wk'; end if;
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'me', mine, 'slots', spots,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'), 'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'scoring_classic', lg.settings_json -> 'scoring_classic', 'ppr', coalesce((lg.settings_json ->> 'ppr')::numeric, 1),
    'matchup', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'status', m.status, 'home', m.home_roster_id, 'away', m.away_roster_id,
      'home_team', _txn_team(p_league, m.home_roster_id), 'away_team', _txn_team(p_league, m.away_roster_id),
      'home_final', m.home_final, 'away_final', m.away_final, 'home_tb', m.home_tb, 'away_tb', m.away_tb,
      'playoff', m.is_playoff, 'label', m.playoff_label,
      'home_entry', _contest_sealed_entry(p_league, wk, m.home_roster_id, p_season, m.home_roster_id = any(seats)),
      'away_entry', case when m.away_roster_id = m.home_roster_id then null else _contest_sealed_entry(p_league, wk, m.away_roster_id, p_season, m.away_roster_id = any(seats)) end,
      'state', case when st.matchup_id is null or not started then null else jsonb_build_object('home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end) end,
    'matchups', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'home', x.home_roster_id, 'away', x.away_roster_id,
                 'home_team', _txn_team(p_league, x.home_roster_id), 'away_team', _txn_team(p_league, x.away_roster_id),
                 'status', x.status, 'label', x.playoff_label, 'consolation', x.is_consolation,
                 'home_score', coalesce(x.home_final, xs.home_score), 'away_score', coalesce(x.away_final, xs.away_score),
                 'mine', x.home_roster_id = any(seats) or x.away_roster_id = any(seats))
               order by (x.home_roster_id = any(seats) or x.away_roster_id = any(seats)) desc, x.is_consolation, x.bracket_pos, x.home_roster_id)
      from matchup x left join matchup_state xs on xs.matchup_id = x.id and xs.game_window = 'wk'
      where x.league_id = p_league and x.week = wk), '[]'::jsonb));
end $$;

-- ── the board goes by my best seat ──────────────────────────────────────────
create or replace function contest_board(p_league uuid, p_week int default null, p_limit int default 100, p_near int default 5, p_find text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; wk int; started boolean; rows jsonb; mine jsonb; nrows jsonb; frows jsonb; srows jsonb; smine jsonb; snrows jsonb; sfrows jsonb;
        n int; lim int; nr int; q text; golf boolean; h2h boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such contest'); end if;
  if not (_is_open_contest(lg) or is_league_member(p_league) or is_league_commish(p_league) or is_admin()
          or exists (select 1 from league_listing li where li.league_id = p_league and li.open)) then
    return jsonb_build_object('ok', false, 'error', 'you''re not in this league');
  end if;
  golf := _contest_of(lg) = 'golf';
  h2h := _contest_format_of(lg) = 'h2h';
  lim := greatest(1, least(coalesce(p_limit, 100), 500));
  nr := greatest(0, least(coalesce(p_near, 5), 50));
  -- The search is a plain substring: the pattern characters are escaped so a
  -- "%" or "_" in a name finds that name, not everything.
  q := case when nullif(btrim(coalesce(p_find, '')), '') is null then null
            else '%' || replace(replace(replace(btrim(p_find), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  wk := coalesce(p_week, lg.contest_week, _contest_week(lg.season), (select max(week) from matchup where league_id = p_league));
  started := wk is not null and coalesce(_week_first_lock(lg.season, wk) <= now(), false);
  select count(*) into n from sleeper_lineup where league_id = p_league and week = wk;

  if started then
    with sides as (
      select m.home_roster_id as roster_id, coalesce(m.home_final, st.home_score, 0) as ring, m.home_tb as tb, 'home' as side, st.slot_scores, m.status
        from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
       where m.league_id = p_league and m.week = wk
      union all
      select m.away_roster_id, coalesce(m.away_final, st.away_score, 0), m.away_tb, 'away', st.slot_scores, m.status
        from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
       where m.league_id = p_league and m.week = wk and m.away_roster_id <> m.home_roster_id
    ), sc as (
      select s.roster_id, lm.team_name, lm.app_user_id = auth.uid() as me, s.ring, s.tb, s.status,
             (select coalesce(sum((x ->> 'score')::numeric), 0) from jsonb_array_elements(coalesce(s.slot_scores, '[]'::jsonb)) x
               where x ->> 'side' = s.side) as points
        from sides s join league_membership lm on lm.league_id = p_league and lm.sleeper_roster_id = s.roster_id
    ), ranked as (
      select sc.*, rank() over (order by case when golf then sc.ring else -sc.ring end asc, sc.tb asc nulls last) as rank,
             row_number() over (order by case when golf then sc.ring else -sc.ring end asc, sc.tb asc nulls last, sc.team_name, sc.roster_id) as pos from sc
    ), mp as (select pos, rank from ranked where me order by pos limit 1)
    select coalesce(jsonb_agg(to_jsonb(r) order by r.pos) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me order by x.pos limit 1),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb) from ranked x, mp where mp.rank > lim and abs(x.pos - mp.pos) <= nr),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb)
              from (select * from ranked x where q is not null and x.team_name ilike q order by x.pos limit 20) x)
      into rows, mine, nrows, frows from ranked r;
  end if;

  if lg.contest_week is null then
    -- RECORDS (0471): each final head-to-head is a win, a loss or a tie by the
    -- contest's own rule (golf: the lower score wins). A board league's
    -- self-paired rows are neither. Head-to-head standings rank by record
    -- first, then the total; a leaderboard league by the total as before.
    -- A VOIDED week (0474) is neither played nor counted; a PLAYOFF week
    -- (0476) is the bracket's, not the regular season's.
    with fin as (
      select m.home_roster_id as roster_id, m.home_final as f,
             case when m.away_roster_id = m.home_roster_id or m.home_final = m.away_final then null
                  when golf then m.home_final < m.away_final else m.home_final > m.away_final end as w,
             (m.away_roster_id <> m.home_roster_id and m.home_final = m.away_final) as t
        from matchup m where m.league_id = p_league and m.status = 'final' and not m.is_playoff
         and not exists (select 1 from week_void v where v.league_id = m.league_id and v.week = m.week)
      union all
      select m.away_roster_id, m.away_final,
             case when m.home_final = m.away_final then null
                  when golf then m.away_final < m.home_final else m.away_final > m.home_final end,
             (m.home_final = m.away_final)
        from matchup m where m.league_id = p_league and m.status = 'final' and m.away_roster_id <> m.home_roster_id and not m.is_playoff
         and not exists (select 1 from week_void v where v.league_id = m.league_id and v.week = m.week)
    ), s as (
      select lm.sleeper_roster_id as roster_id, lm.team_name, lm.app_user_id = auth.uid() as me,
             coalesce(sum(fin.f), 0) as total, count(fin.f) as weeks,
             case when golf then min(fin.f) else max(fin.f) end as best,
             count(*) filter (where fin.w) as wins,
             count(*) filter (where fin.w = false) as losses,
             count(*) filter (where fin.t) as ties
        from league_membership lm
        left join fin on fin.roster_id = lm.sleeper_roster_id
       where lm.league_id = p_league and lm.enrolled
       group by lm.sleeper_roster_id, lm.team_name, lm.app_user_id
    ), ranked as (
      select s.*, rank() over (order by case when h2h then -s.wins else 0 end asc, case when h2h then s.losses else 0 end asc,
                                        case when golf then s.total else -s.total end asc, s.weeks desc, s.best desc nulls last) as rank,
             row_number() over (order by case when h2h then -s.wins else 0 end asc, case when h2h then s.losses else 0 end asc,
                                        case when golf then s.total else -s.total end asc, s.weeks desc, s.best desc nulls last, s.team_name, s.roster_id) as pos from s
    ), mp as (select pos, rank from ranked where me order by pos limit 1)
    select coalesce(jsonb_agg(to_jsonb(r) order by r.pos) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me order by x.pos limit 1),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb) from ranked x, mp where mp.rank > lim and abs(x.pos - mp.pos) <= nr),
           (select coalesce(jsonb_agg(to_jsonb(x) order by x.pos), '[]'::jsonb)
              from (select * from ranked x where q is not null and x.team_name ilike q order by x.pos limit 20) x)
      into srows, smine, snrows, sfrows from ranked r;
  end if;

  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'entries', n, 'contest', _contest_of(lg),
    'void', coalesce(_week_void(p_league, wk), false),
    'voided', coalesce((select jsonb_agg(v.week order by v.week) from week_void v where v.league_id = p_league), '[]'::jsonb),
    'rows', coalesce(rows, '[]'::jsonb), 'me', mine, 'near', coalesce(nrows, '[]'::jsonb), 'found', coalesce(frows, '[]'::jsonb),
    'season', case when lg.contest_week is null then jsonb_build_object('rows', srows, 'me', smine, 'near', snrows, 'found', sfrows) end);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function _contest_max_entries(league), _my_contest_seats(uuid), _my_contest_seat(uuid, int), _my_contest_seats_json(uuid),
  _contest_take_seat(uuid, text, boolean) from public, anon, authenticated;
revoke all on function add_contest_entry(uuid, text), set_contest_rules(uuid, text, text, int, int, boolean, text, text, int),
  contest_state(uuid, int, text, int), save_contest_entry(uuid, int, jsonb, text, int), contest_swaps(uuid, int, int),
  bullseye_my_weeks(uuid, int), contest_matchup(uuid, int, uuid, int, text), contest_board(uuid, int, int, int, text) from public, anon;
grant execute on function add_contest_entry(uuid, text), set_contest_rules(uuid, text, text, int, int, boolean, text, text, int),
  contest_state(uuid, int, text, int), save_contest_entry(uuid, int, jsonb, text, int), contest_swaps(uuid, int, int),
  bullseye_my_weeks(uuid, int), contest_matchup(uuid, int, uuid, int, text), contest_board(uuid, int, int, int, text) to authenticated;
