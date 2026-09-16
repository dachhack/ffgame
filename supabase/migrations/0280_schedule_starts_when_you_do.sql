-- 0280: A LEAGUE'S SCHEDULE STARTS ON A WEEK IT CAN ACTUALLY PLAY (v0.394.6).
--
-- The other half of "let's make sure drafting mid-nfl season still works."
-- 0279 got the DRAFT through. This is what happens the morning after.
--
-- `native_generate_schedule` always numbered weeks 1..N and pointed each at
-- that NFL week's real kickoff. The creation flow runs it the moment a league
-- is made, so a league created in week 2 got a week 1 whose games finished
-- days ago — and nothing ever clears it:
--   • the worker's `finalizeMatchups` only moves 'live' → 'final';
--   • `lockDueMatchups` is scoped to the worker's CURRENT nfl week, so a
--     stale 'scheduled' week is never flipped to 'live' in the first place.
-- So `league_live_week` — min(week) not yet final — is pinned at that dead
-- week forever. Measured, not reasoned about: 28 matchups, all 'scheduled',
-- week 1's lock_at a week in the past, league_live_week = 1.
--
-- Everything downstream keys off that number, so the league seizes:
--   • 0179's kickoff lock is armed against every player with a game in the
--     dead week — which, a week later, is everyone: no adds, drops, waivers
--     or trades, ever;
--   • 0178 refuses lineup writes on those same players, so the week that is
--     showing is a week nobody can set a lineup for;
--   • no scores, no weekly report, standings frozen at 0-0.
--
-- TWO CHANGES, and the second is the one that matters tonight:
--
-- 1. GENERATION starts at the first week of the season whose games have not
--    kicked off. A league made before week 1 is byte-identical to before
--    (`season_first_open_week` returns 1, and the pairing math below is keyed
--    off a 1-based index that then equals the calendar week).
--
-- 2. A league that ALREADY carries the bad schedule heals itself. There is no
--    "regenerate schedule" button — `native_generate_schedule` runs once, from
--    the creation flow — so this cannot be left to somebody noticing. The
--    shift runs at the two doors onto `_start_draft_now`, the last moment at
--    which every matchup is still 'scheduled' and the league has played
--    nothing. It SHIFTS rather than regenerates, so the pairings a
--    commissioner may already have shown the league survive.

-- ── The first week still ahead of us ────────────────────────────────────────
-- NULL when we have no slate for the season, or when every week of it is
-- behind us; both read as "no opinion" and callers fall back to week 1, which
-- is the pre-0280 behaviour.
create or replace function season_first_open_week(p_season text) returns int
  language sql stable security definer set search_path = public as $$
  select min(w.week) from (
    select s.week, min(s.kickoff) as k from nfl_slate s
     where s.season = p_season and s.week between 1 and 18
     group by s.week) w
   where w.k > now();
$$;

-- The last week a regular-season schedule may occupy: never past 18, and never
-- into the playoffs when the league is holding them (0246: off is teams = 0).
create or replace function league_last_regular_week(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when league_playoff_teams(p_league_id) > 0
              then least(18, league_playoff_start(p_league_id) - 1)
              else 18 end;
$$;

-- ── Shift a not-yet-played schedule onto weeks it can play ──────────────────
-- Refuses to touch anything that has started, anything with a playoff bracket
-- already built, and any league whose first week is still ahead (delta 0).
-- Weeks that would be pushed past the cap are dropped rather than stacked on
-- top of the playoffs — a 14-week season cannot start in week 2 and still end
-- before week 15, and saying so by shortening it is the honest answer.
--
-- Not granted to anyone: reached through native_reschedule (checked) or the
-- draft doors below.
create or replace function _shift_schedule_to_open_week(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare first_wk int; open_wk int; delta int; cap int; seas text; w int; dropped int := 0; la timestamptz;
begin
  if exists (select 1 from matchup m where m.league_id = p_league_id
               and (m.status <> 'scheduled' or m.is_playoff)) then
    return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'season underway');
  end if;
  select min(week) into first_wk from matchup where league_id = p_league_id;
  if first_wk is null then return jsonb_build_object('ok', true, 'shifted', 0, 'why', 'no schedule'); end if;

  select l.season into seas from league l where l.id = p_league_id;
  open_wk := coalesce(season_first_open_week(seas), first_wk);
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

-- The commissioner's door onto it, for a league that is not about to draft.
create or replace function native_reschedule(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  return _shift_schedule_to_open_week(p_league_id);
end $$;

-- ── The two doors onto _start_draft_now, each with the shift in front ───────
-- The body itself is untouched on purpose: it is a hundred lines of draft
-- order, pick assets, budgets and waiver priorities, and 0177 already names
-- copying it as the mistake to avoid.
create or replace function start_draft(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform _shift_schedule_to_open_week(p_league_id);
  return _start_draft_now(p_league_id, p_order);
end $$;

create or replace function draft_autostart_sweep()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; res jsonb; started int := 0; failed int := 0; errs jsonb := '[]'::jsonb;
begin
  for r in
    select league_id, start_at from draft
     where status = 'pending' and start_at is not null
       and start_at <= now() and start_at > now() - interval '2 days'
     order by start_at
  loop
    perform _shift_schedule_to_open_week(r.league_id);
    res := _start_draft_now(r.league_id, null);
    if coalesce((res ->> 'ok')::boolean, false) then
      started := started + 1;
    else
      failed := failed + 1;
      errs := errs || jsonb_build_object('league_id', r.league_id, 'error', res ->> 'error');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'started', started, 'failed', failed, 'errors', errs);
end $$;

grant execute on function season_first_open_week(text) to authenticated;
grant execute on function league_last_regular_week(uuid) to authenticated;
grant execute on function native_reschedule(uuid) to authenticated;
grant execute on function draft_autostart_sweep() to service_role;

-- ── Generation: 0215's body, on a calendar that starts where we are ─────────
-- The pairing math is now keyed off `idx` (1 = the league's first week) and the
-- CALENDAR week is `wk`. When a league is made before the season starts the two
-- are equal and every pairing, home/away side and rematch week is exactly what
-- 0215 produced. Only the numbers on the fixtures move, and only for a league
-- that would otherwise have been handed a week it had already missed.
create or replace function native_generate_schedule(p_league_id uuid, p_weeks int default 14)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ids int[]; n int; ghost boolean := false; wk int; idx int; i int;
  a int; b int; hm int; aw int; la timestamptz; seas text; made int := 0;
  use_div boolean; rot int; pool int[]; pairs int[]; div_a text; j int; pick int;
  start_wk int; cap int; last_wk int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 18 then
    return jsonb_build_object('ok', false, 'error', 'weeks must be 1–18');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id), count(*)::int
    into ids, n from league_membership where league_id = p_league_id;
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  use_div := league_divisions_active(p_league_id);
  if n % 2 = 1 then ids := ids || 0; n := n + 1; ghost := true; end if;  -- 0 = bye

  select l.season into seas from league l where l.id = p_league_id;
  start_wk := coalesce(season_first_open_week(seas), 1);
  cap := league_last_regular_week(p_league_id);
  if start_wk > cap then
    return jsonb_build_object('ok', false, 'error',
      format('no weeks left to play — the next open week is %s and the regular season ends at %s',
             start_wk, cap));
  end if;
  delete from matchup where league_id = p_league_id;  -- all scheduled (checked above)

  for idx in 1..p_weeks loop
    wk := start_wk + idx - 1;
    exit when wk > cap;                      -- a short season, honestly short
    last_wk := wk;
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;

    if use_div and idx > n - 1 then
      -- REMATCH WEEK, divisions on: greedy division-first pairing. `rot`
      -- rotates which division mate each seat meets so consecutive rematch
      -- weeks differ; anyone whose division is exhausted pairs across.
      rot := idx - (n - 1);
      select array_agg(m.sleeper_roster_id order by m.division, m.sleeper_roster_id)
        into pool from league_membership m where m.league_id = p_league_id;
      pairs := '{}';
      while coalesce(array_length(pool, 1), 0) >= 2 loop
        a := pool[1]; pool := pool[2:];
        select m.division into div_a from league_membership m
          where m.league_id = p_league_id and m.sleeper_roster_id = a;
        -- division mates still unpaired, rotation picking among them
        select count(*) into j from unnest(pool) u
          join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
          where m.division = div_a;
        if j > 0 then
          pick := ((rot - 1) % j) + 1;
          select u into b from (
            select u, row_number() over (order by u) as rn from unnest(pool) u
            join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
            where m.division = div_a) t where t.rn = pick;
        else
          b := pool[1];
        end if;
        pool := array_remove(pool, b);
        pairs := pairs || a || b;
      end loop;
      -- (an odd human count leaves one seat over: that seat's bye, as before)
      i := 1;
      while i < coalesce(array_length(pairs, 1), 0) loop
        a := pairs[i]; b := pairs[i + 1]; i := i + 2;
        if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
        insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
        values (p_league_id, wk, hm, aw, 'scheduled', la)
        on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
        made := made + 1;
      end loop;
      continue;
    end if;

    for i in 0..(n / 2 - 1) loop
      -- circle method: ids[n] fixed, the rest rotate one step per week
      a := ids[((idx - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n]
                else ids[((idx - 1 + n - 1 - i) % (n - 1)) + 1] end;
      if ghost and (a = 0 or b = 0) then continue; end if;
      if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, wk, hm, aw, 'scheduled', la)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'weeks', greatest(last_wk - start_wk + 1, 0),
    'matchups', made, 'first_week', start_wk, 'last_week', last_wk);
end $$;
