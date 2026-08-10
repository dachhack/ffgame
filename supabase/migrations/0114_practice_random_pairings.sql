-- 0114: practice pairings are RANDOM, and no longer need a synced season.
--
-- Practice weeks have been built by CLONING the league's regular-season schedule
-- — Week 1 four times (0054), then week i per board week 100+i (0113). Both
-- inherit the same hard dependency: the league must already have a schedule. A
-- league that hasn't drafted yet has NO matchups at all, so opening practice
-- failed outright with "no Week-1 matchups to clone — sync the season first".
--
-- That's backwards for what practice is FOR. The whole point is to rehearse the
-- loop before the season starts — which is exactly when a league is most likely
-- to be mid-draft with no schedule. And the real schedule was never meaningful
-- here anyway: a practice game against your real Week-3 opponent isn't that
-- matchup, it's a scrimmage on preseason snaps that counts for nothing.
--
-- So practice now pairs seats itself: a deterministic shuffle per (league, board
-- week), adjacent seats paired off. Different opponent each practice week, no
-- schedule required, and the same league+week always produces the same pairing so
-- a rebuild is idempotent rather than reshuffling under people. The seed is
-- md5(league|week|roster) — same trick as pods' pairPodSeats, and it needs no
-- setseed() session state.
--
-- Odd seat count → the last seat sits that week; which seat that is moves with
-- the shuffle, so nobody is permanently the odd one out.
--
-- Lineups are still copied from the matching regular-season week WHEN one exists,
-- purely as a fallback: the deep-pool seed overwrites them moments later, and a
-- league with no schedule has none to copy.

create or replace function _clone_preseason_weeks(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wk int; src int; made int := 0; total int := 0;
  ids uuid[]; seats int[]; seeded int[] := '{}'; skipped int[] := '{}';
  seas text; last_kick timestamptz; i int;
begin
  select season into seas from league where id = p_league_id;

  foreach wk in array preseason_board_weeks() loop
    -- Skip a week that's already over — nothing will ever feed it, and skipping
    -- BEFORE the wipe is what lets a rebuild leave finished weeks intact.
    select max(kickoff) into last_kick from nfl_slate where season = seas and week = wk;
    if last_kick is not null and last_kick + interval '4 hours' < now() then
      skipped := skipped || wk;
      continue;
    end if;

    -- Wipe any existing build at this week (matchup children first).
    select array_agg(id) into ids from matchup where league_id = p_league_id and week = wk;
    if ids is not null then
      delete from sealed_pick   where matchup_id = any(ids);
      delete from matchup_state where matchup_id = any(ids);
      delete from applied_state where matchup_id = any(ids);
      delete from matchup        where id = any(ids);
    end if;
    delete from sleeper_lineup where league_id = p_league_id and week = wk;

    -- Seats, shuffled deterministically for THIS league and week.
    select array_agg(sleeper_roster_id order by md5(p_league_id::text || ':' || wk::text || ':' || sleeper_roster_id::text))
      into seats
      from (select distinct sleeper_roster_id from league_membership where league_id = p_league_id) s;
    if seats is null or array_length(seats, 1) < 2 then
      continue;  -- nothing to pair; reported by the empty `weeks` array
    end if;

    made := 0;
    i := 1;
    while i + 1 <= array_length(seats, 1) loop
      insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
        values (p_league_id, wk, null, seats[i], seats[i + 1], 'scheduled', null);
      made := made + 1;
      i := i + 2;
    end loop;
    total := total + made;

    -- Fallback lineups from the matching regular-season week, when the league has
    -- one. The deep-pool seed replaces these; a league with no schedule skips it.
    src := wk - 100;
    if not exists (select 1 from sleeper_lineup where league_id = p_league_id and week = src) then
      src := 1;
    end if;
    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
      select league_id, wk, roster_id, starters_json
        from sleeper_lineup where league_id = p_league_id and week = src;

    seeded := seeded || wk;
  end loop;

  return jsonb_build_object('weeks', to_jsonb(seeded), 'skipped', to_jsonb(skipped),
                            'matchups', total, 'per_week', made);
end $$;

-- The on/off body: the precondition is now SEATS, not a schedule.
create or replace function _set_preseason(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ts timestamptz; r jsonb; wks int[] := preseason_board_weeks(); n int;
begin
  if p_on then
    select count(distinct sleeper_roster_id) into n from league_membership where league_id = p_league_id;
    if coalesce(n, 0) < 2 then
      return jsonb_build_object('ok', false, 'error', 'league needs at least two seats to pair a practice matchup');
    end if;
    update league set preseason_at = now() where id = p_league_id returning preseason_at into ts;
    r := _clone_preseason_weeks(p_league_id);
    if jsonb_array_length(r -> 'weeks') = 0 then
      update league set preseason_at = null where id = p_league_id;
      return jsonb_build_object('ok', false, 'error', 'every preseason week has already been played');
    end if;
    return jsonb_build_object('ok', true, 'preseason_at', ts,
      'matchups', r -> 'per_week', 'weeks', r -> 'weeks', 'skipped', r -> 'skipped');
  end if;
  update league set preseason_at = null where id = p_league_id returning preseason_at into ts;
  delete from sealed_pick   where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from matchup_state where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from applied_state where matchup_id in (select id from matchup where league_id = p_league_id and week = any(wks));
  delete from matchup        where league_id = p_league_id and week = any(wks);
  delete from sleeper_lineup where league_id = p_league_id and week = any(wks);
  return jsonb_build_object('ok', true, 'preseason_at', ts, 'matchups', 0, 'weeks', '[]'::jsonb);
end $$;

-- Internal only (0110's reasoning: SECURITY DEFINER + EXECUTE-to-PUBLIC by default).
revoke all on function _set_preseason(uuid, boolean) from public;
revoke all on function _clone_preseason_weeks(uuid) from public;
