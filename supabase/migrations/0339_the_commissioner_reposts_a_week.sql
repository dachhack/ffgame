-- ═══════════════════════════════════════════════════════════════════════════
-- 0339 · THE COMMISSIONER REPOSTS A WEEK
--
-- Founder: "Maybe have an option for commish to regen any weekly report and
-- post in chat."
--
-- Nearly all of this already existed and was locked to super-admins. 0277 gave
-- `report_request` a queue, `admin_request_week_report` a way to file one, and
-- server/src/report.js `sweepRequests` the worker end — which builds from
-- whatever finals are stamped, REPLACES the stored payload and REPLACES the
-- chat line rather than adding a second one. So a commissioner asking twice
-- rewrites one line; it cannot spam the league.
--
-- What was missing was the commissioner's own door, and one guard the admin
-- door deliberately does not have.
--
-- THE GUARD IS v0.457.0's LESSON. That week's report read 127.5–143.5 while
-- the board read 162.50–160.50 with a game still on, because the week was
-- finalised mid-game and a stamped final never revisits itself. A one-tap
-- "post the report" button handed to every commissioner is precisely how that
-- gets recreated on purpose, every Sunday afternoon, so the commissioner's
-- door refuses while the week is still being played and says exactly what it
-- is waiting for. The super-admin door stays unguarded: it is the override,
-- and an override that asks permission is not one.
--
-- NOT A RE-STAMP. If a week's stored finals have drifted from the live
-- scoring, rebuilding the report faithfully repeats them. Rather than quietly
-- reposting wrong numbers, the state below counts those matchups and the
-- consoles say so — re-stamping is still an admin errand (`admin_stamp_week`),
-- and it should be, since it rewrites results.
--
-- `drifted`, not `stale`: a stored final can differ from the window rows
-- because the stamp was taken early (the v0.457.0 bug) OR because a
-- commissioner edited that score by hand in SCORES, which is a supported
-- thing to do and not a fault. The database cannot tell those apart, so it
-- counts them and the consoles name both possibilities rather than accusing
-- anybody of a bug.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. is the NFL week over? ═══════════════════════════════════════════════
-- The same reading scripts/db/republish-week-reports.sql refuses on, lifted
-- into the database so a console can show it rather than discovering it from
-- a rejection. Three counts and the verdict:
--
--   slate — games the schedule says the week has, in the season asked for;
--   feed  — games the ingest actually holds for that week;
--   live  — of those, how many are not yet `post`.
--
-- The week is over when the feed is not SHORT (a missing game is the exact
-- shape of the bug: `games.every(completed)` is vacuously true over a list
-- that does not contain the game still being played) and nothing in it is
-- still running. A week with no slate rows at all — a mock league, a preseason
-- offset week — has no schedule to fall short of, so `live = 0` decides it.
create or replace function nfl_week_complete(p_week int, p_season text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seas text; slate_n int; feed_n int; live_n int;
begin
  if p_week is null then return jsonb_build_object('complete', false, 'error', 'which week?'); end if;
  -- The league's own season when the slate has that week in it, else whatever
  -- season the slate does hold it for: an old league still owns a "week 2".
  seas := case when p_season is not null
                 and exists (select 1 from nfl_slate where week = p_week and season = p_season)
               then p_season
               else (select max(season) from nfl_slate where week = p_week) end;
  select count(*) into slate_n from nfl_slate where week = p_week and season = seas;
  select count(*) into feed_n from game_feed where week = p_week;
  select count(*) into live_n from game_feed where week = p_week and state is distinct from 'post';
  return jsonb_build_object(
    'season', seas, 'slate', slate_n, 'feed', feed_n, 'live', live_n,
    'complete', (slate_n = 0 or feed_n >= slate_n) and live_n = 0);
end $$;
grant execute on function nfl_week_complete(int, text) to authenticated;

-- ═══ 2. every week this league could repost, and what stands in the way ═════
-- One row per week that has matchups, newest first, carrying everything the
-- panel needs to render a line without a second call: the gate the worker
-- itself watches (final / stamped), whether a report and its chat line exist,
-- when it was posted, whether the NFL week is over, whether any stored final
-- has drifted, and the last request's outcome.
create or replace function league_report_weeks(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seas text;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select season into seas from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'season', seas, 'weeks', coalesce((
    select jsonb_agg(w order by w.week desc) from (
      select m.week,
             count(*) as matchups,
             count(*) filter (where m.status = 'final') as final,
             count(*) filter (where m.home_final is not null and m.away_final is not null) as stamped,
             -- A stored final that no longer matches the sum of its own window
             -- rows. 0.15 is the rounding the republish script uses, not a
             -- tolerance for being wrong.
             --
             -- It must HAVE window rows to disagree with. A matchup the
             -- resolver never published for — a hand-built final, a league
             -- that never ran live — sums to nothing, and reading that
             -- nothing as 0.0 would call every such week drifted. The
             -- republish script's own expression has this hole; it never
             -- showed because that script only ever walked resolved weeks.
             count(*) filter (where m.home_final is not null and m.away_final is not null
               and exists (select 1 from matchup_state s where s.matchup_id = m.id)
               and (
                 abs(coalesce((select sum(s.home_score) from matchup_state s where s.matchup_id = m.id), 0) - m.home_final) > 0.15
              or abs(coalesce((select sum(s.away_score) from matchup_state s where s.matchup_id = m.id), 0) - m.away_final) > 0.15
             )) as drifted,
             exists (select 1 from league_report r where r.league_id = p_league_id and r.week = m.week) as report,
             (select max(g.created_at) from league_message g
               where g.league_id = p_league_id and g.kind = 'report' and g.report_week = m.week) as posted_at,
             nfl_week_complete(m.week, seas) as week_state,
             (select jsonb_build_object('requested_at', q.requested_at, 'done_at', q.done_at, 'error', q.error)
                from report_request q where q.league_id = p_league_id and q.week = m.week
                order by q.id desc limit 1) as request
        from matchup m
       where m.league_id = p_league_id
       group by m.week
    ) w), '[]'::jsonb));
end $$;
grant execute on function league_report_weeks(uuid) to authenticated;

-- ═══ 3. the commissioner's door ═════════════════════════════════════════════
-- Files the same `report_request` the admin console files — the worker cannot
-- tell the two apart, and should not have to — after the checks the admin path
-- skips on purpose.
create or replace function commish_request_week_report(p_league_id uuid, p_week int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare nid bigint; seas text; ws jsonb; n_final int; n_stamped int;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_week is null or p_week < 1 then return jsonb_build_object('ok', false, 'error', 'which week?'); end if;
  select season into seas from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if not exists (select 1 from matchup where league_id = p_league_id and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'this league has no week ' || p_week);
  end if;

  -- THE GUARD. A report posted mid-game is the v0.457.0 bug, and a button is a
  -- faster way to reach it than the bug was. An admin can still force it.
  ws := nfl_week_complete(p_week, seas);
  if not is_admin() and not coalesce((ws ->> 'complete')::boolean, false) then
    return jsonb_build_object('ok', false, 'error',
      case when (ws ->> 'live')::int > 0
           then 'week ' || p_week || ' is still being played — ' || (ws ->> 'live')
                || ' game' || case when (ws ->> 'live')::int = 1 then ' is' else 's are' end
                || ' not final yet. A report built now would freeze those scores.'
           else 'week ' || p_week || ' is not fully in — the feed holds ' || (ws ->> 'feed')
                || ' of ' || (ws ->> 'slate') || ' scheduled games. A report built now would '
                || 'leave the missing ones out.' end,
      'week_state', ws);
  end if;

  -- Nothing to say yet. The worker's own gate, phrased for a person.
  select count(*) filter (where status = 'final'),
         count(*) filter (where home_final is not null and away_final is not null)
    into n_final, n_stamped from matchup where league_id = p_league_id and week = p_week;
  if n_stamped = 0 then
    return jsonb_build_object('ok', false, 'error',
      'no finals are stamped for week ' || p_week || ' yet — there is nothing to report.');
  end if;

  -- Already asked. The worker sweeps every tick, so this is a double-tap, not
  -- a queue to grow. (A completed request is never a reason to refuse: the
  -- worker REPLACES the chat line, so asking again corrects one message
  -- rather than posting a second.)
  if exists (select 1 from report_request where league_id = p_league_id and week = p_week and done_at is null) then
    return jsonb_build_object('ok', true, 'queued', true,
      'note', 'already queued — the worker posts it within a minute');
  end if;

  insert into report_request (league_id, week, requested_by) values (p_league_id, p_week, auth.uid())
    returning id into nid;
  return jsonb_build_object('ok', true, 'queued', true, 'id', nid,
    'note', case when n_final < (select count(*) from matchup where league_id = p_league_id and week = p_week)
                 then 'queued — building from the ' || n_stamped || ' stamped final'
                      || case when n_stamped = 1 then '' else 's' end || ' this week has'
                 else 'queued — the worker posts it into chat within a minute' end);
end $$;
grant execute on function commish_request_week_report(uuid, int) to authenticated;
