-- ═══════════════════════════════════════════════════════════════════════════
-- 0378 · A NEW LEAGUE CAN SCORE WEEKS ALREADY PLAYED, AT THE COMMISSIONER'S CALL.
--
-- Founder: "let new leagues score games already played this week by commish
-- discretion. Scores rosters as is when commish presses the button. Can we do
-- this for any previous week's lineup as well?" — lineups: each team's saved
-- lineup, gaps auto-filled; past weeks: a new league may backdate its start.
--
-- ── 1. BACKDATING THE SEASON ───────────────────────────────────────────────
-- A schedule starts at the first week still ahead (0280/0371), so a league
-- made on a Saturday skips the week being played. commish_backdate_season
-- lets a classic league whose season hasn't produced a result start at any
-- earlier week of this season on its own calendar (NFL 1–18, or college
-- 201–215): the schedule is re-laid from there, so every week up to now gets
-- matchups. Stored as settings_json.backdate = {season, week}, which
-- league_first_open_week honours — so the draft's own re-lay (start_draft's
-- _shift_schedule_to_open_week) keeps it. A value for another season or for
-- the other calendar is ignored; null clears it.
--
-- The worker leaves those weeks alone: it locks and finalizes only the week it
-- is playing (lockDueMatchups / finalizeMatchups are week-scoped). A backdated
-- week just sits, scheduled, until the commissioner scores it.
--
-- ── 2. SCORING A WEEK AS IT STANDS ────────────────────────────────────────
-- commish_score_as_is files a score_request; the worker (server/src/
-- scoreAsIs.js) drains it:
--   • each managed seat gets its lineup for that week: what it saved for the
--     week if anything, otherwise its saved lineup from the week it would
--     play next — kept only where the player is still on its active roster —
--     with every empty spot filled the way the worker's auto-slot fills
--     (projections, byes, the injury report); AI and unclaimed seats are
--     fielded by the resolver as always;
--   • college plays for this league's schools are fetched if nobody polled
--     them at the time (the worker only follows schools someone rosters);
--   • a week whose games are all over is finalized and stamped, and its
--     report is built; a week still being played keeps going — the games
--     already over count, the rest play out live as usual;
--   • the league hears about it in chat.
-- Classic only: a drip week can't be rebuilt after the fact (0353's rule).
-- A week already final is the re-score's business (0353), not this.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the calendar's first week, honouring a backdate ───────────────────────
create or replace function league_first_open_week(p_league_id uuid, p_season text) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(
    -- 0378: a backdate for this season, on this league's calendar.
    (select (l.settings_json -> 'backdate' ->> 'week')::int from league l
      where l.id = p_league_id
        and l.settings_json -> 'backdate' ->> 'season' = p_season
        and case when league_is_college_calendar(p_league_id)
                 then (l.settings_json -> 'backdate' ->> 'week')::int between 201 and 215
                 else (l.settings_json -> 'backdate' ->> 'week')::int between 1 and 18 end),
    case when league_is_college_calendar(p_league_id) then (
      select min(w.week) from (
        select s.week, min(s.kickoff) as k from nfl_slate s
         where s.season = p_season and s.week between 201 and 215
         group by s.week) w
       where w.k > now())
    else season_first_open_week(p_season) end)
$$;

-- The first week still ahead, ignoring any backdate: the most a backdate can
-- reach toward.
create or replace function _league_natural_open_week(p_league_id uuid, p_season text) returns int
  language sql stable security definer set search_path = public as $$
  select case when league_is_college_calendar(p_league_id) then (
      select min(w.week) from (
        select s.week, min(s.kickoff) as k from nfl_slate s
         where s.season = p_season and s.week between 201 and 215
         group by s.week) w
       where w.k > now())
    else season_first_open_week(p_season) end
$$;

create or replace function _wk_name(p_week int) returns text
  language sql immutable as $$
  select case when p_week > 200 then college_week_label(p_week) else 'Week ' || p_week end
$$;

create or replace function commish_backdate_season(p_league_id uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; lo int; hi int; nat int; sched jsonb; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'weeks already played can only be scored in a classic league');
  end if;
  if exists (select 1 from matchup where league_id = p_league_id and status = 'final')
     or exists (select 1 from score_request where league_id = p_league_id and error is null) then
    return jsonb_build_object('ok', false, 'error', 'the season has results already — its start can''t move now');
  end if;
  if league_is_college_calendar(p_league_id) then lo := 201; hi := 215; else lo := 1; hi := 18; end if;
  nat := coalesce(_league_natural_open_week(p_league_id, lg.season), hi + 1);
  if p_week is not null and (p_week < lo or p_week >= nat) then
    return jsonb_build_object('ok', false, 'error',
      'the season can start as early as ' || _wk_name(lo)
      || case when nat > lo then ' — and backdating is only for weeks already under way, before ' || _wk_name(nat) else '' end);
  end if;

  update league set settings_json = case when p_week is null then settings_json - 'backdate'
      else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('backdate', jsonb_build_object('season', lg.season, 'week', p_week)) end
    where id = p_league_id;
  -- Re-lay a schedule that exists (every row still scheduled), to the end of
  -- the regular season. A league with no schedule gets it laid at its draft.
  select count(distinct week) into n from matchup where league_id = p_league_id and not is_playoff;
  if n > 0 then
    if exists (select 1 from matchup where league_id = p_league_id and status <> 'scheduled') then
      -- the week in play already locked: that's fine for a backdate further
      -- back only if nothing has been scored, which was checked above.
      update matchup set status = 'scheduled' where league_id = p_league_id and status = 'live';
    end if;
    sched := native_generate_schedule(p_league_id, 18);
    if coalesce((sched ->> 'ok')::boolean, false) is not true then
      raise exception 'schedule: %', sched ->> 'error';
    end if;
  end if;
  if p_week is not null then
    perform _chat_house(p_league_id,
      'The season now starts in ' || _wk_name(p_week) || '. Weeks already played are scored when the commissioner says so, with the rosters as they stand.',
      jsonb_build_object('kind', 'backdate', 'week', p_week));
  end if;
  return jsonb_build_object('ok', true, 'week', p_week, 'schedule', sched);
end $$;
grant execute on function commish_backdate_season(uuid, int) to authenticated;

-- ── the queue ──────────────────────────────────────────────────────────────
create table if not exists score_request (
  id           bigint generated always as identity primary key,
  league_id    uuid not null references league(id) on delete cascade,
  week         int  not null,
  requested_by uuid references app_user(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  done_at      timestamptz,
  error        text,
  result       jsonb
);
create index if not exists score_request_open on score_request(id) where done_at is null;
create index if not exists score_request_week on score_request(league_id, week, id desc);
alter table score_request enable row level security;   -- no policies: RPC + worker only

create or replace function commish_score_as_is(p_league_id uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; first_kick timestamptz; rid bigint;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'weeks already played can only be scored in a classic league');
  end if;
  if not exists (select 1 from draft where league_id = p_league_id and status = 'complete') then
    return jsonb_build_object('ok', false, 'error', 'draft first — a week is scored from the rosters');
  end if;
  if not exists (select 1 from matchup where league_id = p_league_id and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'no matchups in ' || _wk_name(p_week) || ' — backdate the season to reach it');
  end if;
  if exists (select 1 from matchup where league_id = p_league_id and week = p_week and status = 'final') then
    return jsonb_build_object('ok', false, 'error', _wk_name(p_week) || ' is final — use re-score to change it');
  end if;
  select min(lock_at) into first_kick from matchup where league_id = p_league_id and week = p_week;
  if first_kick is null or first_kick > now() then
    return jsonb_build_object('ok', false, 'error', 'no game in ' || _wk_name(p_week) || ' has kicked off yet — set lineups as usual');
  end if;
  if exists (select 1 from score_request where league_id = p_league_id and week = p_week and done_at is null) then
    return jsonb_build_object('ok', false, 'error', _wk_name(p_week) || ' is already being scored');
  end if;
  insert into score_request (league_id, week, requested_by) values (p_league_id, p_week, auth.uid()) returning id into rid;
  return jsonb_build_object('ok', true, 'id', rid);
end $$;
grant execute on function commish_score_as_is(uuid, int) to authenticated;

-- What the commissioner's card shows: the backdate, the weeks that can be
-- scored now, and the latest request per week.
create or replace function score_as_is_state(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league%rowtype; lo int; nat int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  lo := case when league_is_college_calendar(p_league_id) then 201 else 1 end;
  nat := _league_natural_open_week(p_league_id, lg.season);
  return jsonb_build_object('ok', true,
    'classic', coalesce(lg.settings_json ->> 'game_mode', 'drip') = 'classic',
    'drafted', exists (select 1 from draft where league_id = p_league_id and status = 'complete'),
    'first_week', (select min(week) from matchup where league_id = p_league_id and not is_playoff),
    'backdate', case when lg.settings_json -> 'backdate' ->> 'season' = lg.season
                     then (lg.settings_json -> 'backdate' ->> 'week')::int end,
    'can_backdate', not exists (select 1 from matchup where league_id = p_league_id and status = 'final')
                    and not exists (select 1 from score_request where league_id = p_league_id and error is null),
    'earliest', lo, 'natural_open', nat,
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week', w.week, 'name', _wk_name(w.week),
        'final', w.final,
        'request', (select jsonb_build_object('id', r.id, 'requested_at', r.requested_at, 'done_at', r.done_at,
                                              'error', r.error, 'result', r.result)
                      from score_request r where r.league_id = p_league_id and r.week = w.week
                     order by r.id desc limit 1)) order by w.week)
      from (select m.week, bool_and(m.status = 'final') as final
              from matchup m
             where m.league_id = p_league_id and not m.is_playoff and m.lock_at <= now()
             group by m.week) w), '[]'::jsonb));
end $$;
grant execute on function score_as_is_state(uuid) to authenticated;

revoke all on function _league_natural_open_week(uuid, text) from public, anon, authenticated;


-- ── _shift_schedule_to_open_week — 0371's body; a backdate holds at the draft ──
create or replace function _shift_schedule_to_open_week(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare first_wk int; open_wk int; delta int; cap int; seas text; w int; dropped int := 0; la timestamptz;
begin
  if exists (select 1 from matchup m where m.league_id = p_league_id
               and (m.status <> 'scheduled' or m.is_playoff)) then
    return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'season underway');
  end if;
  -- 0378: a backdated season stays where the commissioner put it.
  if exists (select 1 from league l where l.id = p_league_id
               and l.settings_json -> 'backdate' ->> 'season' = l.season) then
    return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'backdated');
  end if;
  select min(week) into first_wk from matchup where league_id = p_league_id;
  if first_wk is null then return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'no schedule'); end if;

  select l.season into seas from league l where l.id = p_league_id;
  open_wk := coalesce(league_first_open_week(p_league_id, seas), first_wk);  -- 0371: college-aware
  delta := open_wk - first_wk;
  if delta <= 0 then return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'already open'); end if;

  cap := league_last_regular_week(p_league_id);
  delete from matchup where league_id = p_league_id and week + delta > cap;
  get diagnostics dropped = row_count;

  -- DESCENDING, one week at a time. A single `week = week + delta` update would
  -- collide with the rows already sitting on the target weeks — the unique key
  -- on (league_id, week, home, away) is checked per row, not at statement end.
  for w in reverse coalesce((select max(week) from matchup where league_id = p_league_id), 0)
           .. first_wk loop
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = w + delta;
    update matchup set week = w + delta, lock_at = la
      where league_id = p_league_id and week = w;
  end loop;

  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'shifted', delta, 'first_week', open_wk,
                            'dropped_weeks', dropped, 'cap', cap);
end $$;
