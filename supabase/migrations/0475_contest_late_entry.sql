-- 0475: ENTRY DEADLINE AND THE NO-SHOW RULE (v0.673.0). HANDOFF's third
-- not-done item: "Entry deadline / late-entry policy (CPU build, zero, or
-- week dropped)." Two settings on a contest league, set on the COMMISH card:
--
--   late_entry      what a seat with no squad gets at the week's first
--                   kickoff. `cpu` — the CPU builds one (what head-to-head
--                   always did: an opponent is waiting). `zero` — an empty
--                   squad is written and scores zero: a forfeit. `drop` —
--                   nothing: the seat sits the week out, no row, no score,
--                   no week (what a leaderboard always did). A head-to-head
--                   league can't pick `drop`. In golf a scoreless squad is
--                   the BEST score, so `zero` needs every spot to price a
--                   scoreless player (zero_pts) — refused until it does.
--   entry_deadline  `open` — a squad can be entered any time its players
--                   haven't kicked off (each locks at his own game, 0470).
--                   `first` — a seat with no squad at the week's first
--                   kickoff is closed out: save_contest_entry refuses a NEW
--                   squad after it (an existing one still swaps until each
--                   player's game), and the no-show rule decides the week.
--                   The commissioner's squad fix (0474) steps past it.
--
-- The worker reads both through contestConfigOf (lateEntry, entryDeadline)
-- and writes the no-show rows at lock (pods.js, noShowBuilds); the lock
-- reminder's wording follows the rule.

create or replace function _contest_late_entry(lg league) returns text
  language sql immutable as $$
  select case when lg.settings_json ->> 'late_entry' in ('cpu', 'zero') then lg.settings_json ->> 'late_entry'
              when lg.settings_json ->> 'late_entry' = 'drop' and _contest_format_of(lg) = 'board' then 'drop'
              when _contest_format_of(lg) = 'h2h' then 'cpu' else 'drop' end;
$$;
create or replace function _contest_entry_deadline(lg league) returns text
  language sql immutable as $$
  select case when lg.settings_json ->> 'entry_deadline' = 'first' then 'first' else 'open' end;
$$;
revoke all on function _contest_late_entry(league), _contest_entry_deadline(league) from public, anon, authenticated;

-- _bullseye_info, 0470's body, plus the two rules.
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
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', coalesce(_bullseye_max_seats(lg), (select count(*)::int from league_membership m where m.league_id = lg.id)),
    'seats_taken', _league_seats_taken(lg.id),
    'spots', jsonb_array_length(_contest_slots(lg)))
  else null end;
$$;

-- set_contest_rules, 0470's body, two parameters on: the old overload goes
-- (two defaulted overloads make a PostgREST call ambiguous).
drop function if exists set_contest_rules(uuid, text, text, int, int, boolean);
create or replace function set_contest_rules(p_league uuid, p_contest text default null, p_format text default null, p_budget int default null,
    p_min_spend int default null, p_auto_sub boolean default null, p_late_entry text default null, p_entry_deadline text default null)
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
  cap := coalesce(nullif(s ->> 'budget', '')::int, 50000);
  flr := coalesce(nullif(s ->> 'min_spend', '')::int, 0);
  if cap > 0 and flr > cap then return jsonb_build_object('ok', false, 'error', 'the minimum spend can''t be above the budget'); end if;
  update league set settings_json = s where id = p_league;
  select * into lg from league where id = p_league;
  return jsonb_build_object('ok', true, 'bullseye', _bullseye_info(lg));
end $$;
revoke all on function set_contest_rules(uuid, text, text, int, int, boolean, text, text) from public, anon;
grant execute on function set_contest_rules(uuid, text, text, int, int, boolean, text, text) to authenticated;

-- save_contest_entry, 0474's body, plus the entry deadline: a seat with no
-- squad once the week's first game has kicked off is closed out.
create or replace function save_contest_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026')
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
  select * into seat from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
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
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'budget', budget, 'min_spend', floor_, 'roster_id', seat.sleeper_roster_id);
end $$;
