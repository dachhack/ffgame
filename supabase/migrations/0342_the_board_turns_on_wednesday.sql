-- ═══════════════════════════════════════════════════════════════════════════
-- 0342 · THE BOARD TURNS ON WEDNESDAY
--
-- Founder, with the LEAGUE tab on week 3 and the MATCHUP tab on week 2 at the
-- same moment, on the same phone: "We should move default views to the next
-- week on Weds AM."
--
-- The rule he is asking for already existed and was already right. Core's
-- `openWeekFrom` (v0.401.0) says: a week stays open until the first WEDNESDAY
-- 00:00 ET after its games are done. Tuesday is when you read what just
-- happened; Wednesday is when you start caring about what is next.
--
-- 0341's `league_week_scoreboard` did not use it. Its default was "the lowest
-- week that is not final, else the last one" — which rolls the instant the
-- last matchup STAMPS, some time Tuesday morning. The matchup board asks
-- core; the league page let the RPC decide; and so one league gave two
-- answers about what week it is.
--
-- BOTH CLIENTS NOW PASS THE WEEK, from core, which is the fix that matters:
-- one rule, asked once, and the two tabs cannot drift apart. This migration
-- fixes the FALLBACK — what the function says when nobody passes a week —
-- because a default that is quietly wrong is a trap for the next caller, and
-- there will be one.
--
-- A DELIBERATE SECOND COPY OF A RULE. Core's version is canonical and is what
-- every screen reads; this is its shadow for a caller that has no client. The
-- two are pinned to the same boundary by report-regen's siblings in
-- league-tab-probes.sql — a Tuesday 23:59 and a Wednesday 00:01 that must
-- answer differently — so a change to one that is not made to the other
-- fails the harness rather than going unnoticed.
-- ═══════════════════════════════════════════════════════════════════════════

-- Games are done four hours after the last one KICKS OFF, and the week then
-- runs to the next Wednesday midnight Eastern. By timezone NAME: the season
-- straddles the November change, and a fixed −4 would be an hour wrong for
-- exactly the half of it that decides seeding.
create or replace function nfl_week_closes_at(p_week int, p_season text default null) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare seas text; last_kick timestamptz; t timestamp;
begin
  seas := case when p_season is not null
                 and exists (select 1 from nfl_slate where week = p_week and season = p_season)
               then p_season
               else (select max(season) from nfl_slate where week = p_week) end;
  select max(kickoff) into last_kick from nfl_slate where week = p_week and season = seas;
  if last_kick is null then return null; end if;          -- no slate: unmeasurable
  -- Walk to the next Wednesday 00:00 in ET, from the hour the games are done.
  -- `date_trunc` in the zone, then add days, so a DST change is absorbed by
  -- the conversion rather than by arithmetic on a fixed offset.
  t := date_trunc('day', (last_kick + interval '4 hours') at time zone 'America/New_York');
  -- 3 = Wednesday under extract(dow). A week finishing ON a Wednesday morning
  -- has already had its Wednesday, so this is strictly after: + 7 when the
  -- step would be zero.
  t := t + make_interval(days => ((3 - extract(dow from t)::int) + 7) % 7);
  if (t at time zone 'America/New_York') <= last_kick + interval '4 hours' then
    t := t + interval '7 days';
  end if;
  return t at time zone 'America/New_York';
end $$;
grant execute on function nfl_week_closes_at(int, text) to authenticated;

-- 0341's body, with the default week read off that rule rather than off
-- whether the matchups happen to be stamped yet. A week with NO slate keeps
-- 0341's answer — its matchups' own status is the only thing that can say
-- whether it is over, which is `openWeekFrom`'s rule for the same case.
create or replace function league_week_scoreboard(p_league_id uuid, p_week int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wk int; seas text; r record; closes timestamptz;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  wk := p_week;
  if wk is null then
    select season into seas from league where id = p_league_id;
    -- The first week whose review window has not closed, in schedule order.
    for r in
      select m.week,
             count(*) filter (where m.status <> 'final') as unfinished
        from matchup m where m.league_id = p_league_id
       group by m.week order by m.week
    loop
      closes := nfl_week_closes_at(r.week, seas);
      if closes is null then
        -- No slate to measure: the matchups' own status decides, as 0341 did.
        if r.unfinished > 0 then wk := r.week; exit; end if;
      elsif now() < closes then
        wk := r.week; exit;
      end if;
    end loop;
    if wk is null then select max(week) into wk from matchup where league_id = p_league_id; end if;
  end if;
  if wk is null then return jsonb_build_object('ok', true, 'week', null, 'games', '[]'::jsonb); end if;

  return jsonb_build_object('ok', true, 'week', wk,
    -- Which weeks exist at all, so a pager knows its ends without a second
    -- call and cannot step onto a week this league does not have.
    'weeks', coalesce((select jsonb_agg(distinct week order by week) from matchup where league_id = p_league_id), '[]'::jsonb),
    -- Ordered by the home seat, which is stable week to week; a uuid is not
    -- an order, it just looks like one until the rows move.
    'games', coalesce((select jsonb_agg(g order by g.ord) from (
      select m.home_roster_id as ord, jsonb_build_object(
        'matchup_id', m.id,
        'status', m.status,
        'playoff', m.is_playoff, 'consolation', m.is_consolation, 'label', m.playoff_label,
        'home', jsonb_build_object('roster_id', m.home_roster_id,
          'team', _txn_team(p_league_id, m.home_roster_id),
          -- THE FINAL WHERE THERE IS ONE, THE RUNNING TOTAL WHERE THERE IS
          -- NOT. Both are the same number at the whistle — the stamped final
          -- IS the sum of these rows — so the board does not jump when a week
          -- closes; it just stops moving.
          'points', coalesce(m.home_final,
            (select round(sum(s.home_score), 2) from matchup_state s where s.matchup_id = m.id)),
          'live', m.home_final is null
            and exists (select 1 from matchup_state s where s.matchup_id = m.id)),
        'away', jsonb_build_object('roster_id', m.away_roster_id,
          'team', _txn_team(p_league_id, m.away_roster_id),
          'points', coalesce(m.away_final,
            (select round(sum(s.away_score), 2) from matchup_state s where s.matchup_id = m.id)),
          'live', m.away_final is null
            and exists (select 1 from matchup_state s where s.matchup_id = m.id))) as g
        from matchup m
       where m.league_id = p_league_id and m.week = wk
    ) g), '[]'::jsonb));
end $$;
grant execute on function league_week_scoreboard(uuid, int) to authenticated;
