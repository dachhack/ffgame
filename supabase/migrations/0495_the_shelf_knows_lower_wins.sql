-- 0495: THE SHELF KNOWS WHICH WAY IS WINNING.
--
-- Founder (Oct 13, the leagues list): "If you have a lower score in a bullseye
-- league, you are the winner." The card read LOST over 32.60 v 36.90 while the
-- same card's record said 1-0: standings count a lower-wins week the right way
-- (0482), the card's verdict compared raw points. my_league_slate now carries
-- `lower_wins` per league and verdictOf (packages/core/src/data/leagueSlate.ts)
-- reads it. Body copied from the live definition (0347); one field added.
create or replace function my_league_slate() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return jsonb_build_object('ok', true, 'leagues', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'leagues', coalesce((
    select jsonb_agg(row order by row ->> 'name')
      from (
        select jsonb_build_object(
            'league_id', x.lid, 'name', x.lname, 'roster_id', x.rid,
            'week', x.sb -> 'week',
            -- WHICH WAY IS WINNING (0495): a golf league or a one-team-total
            -- Bullseye counts the LOWER score as the win, as its standings
            -- already do (0482). Without this the card compared raw points and
            -- called a 32.60-to-36.90 Bullseye win LOST beside a 1-0 record.
            'lower_wins', x.lower_wins,
            -- MY GAME OUT OF THE WEEK'S BOARD. A league whose week has no
            -- matchup for this seat (a bye, an odd count, a week not yet
            -- scheduled) gets a null rather than a fabricated 0–0, because a
            -- card that shows a score is claiming a game was played.
            'game', (
              select jsonb_build_object(
                  'status', g ->> 'status',
                  'playoff', g -> 'playoff', 'consolation', g -> 'consolation', 'label', g -> 'label',
                  -- `me` / `opp`, not home / away: the shelf is read from one
                  -- seat, and which side of the fixture that seat sits on is
                  -- an implementation detail of the schedule.
                  'me', (case when (g -> 'home' ->> 'roster_id')::int = x.rid then g -> 'home' else g -> 'away' end)
                        || jsonb_build_object('record', x.recs -> ((case when (g -> 'home' ->> 'roster_id')::int = x.rid
                                                                        then g -> 'home' else g -> 'away' end) ->> 'roster_id')),
                  'opp', (case when (g -> 'home' ->> 'roster_id')::int = x.rid then g -> 'away' else g -> 'home' end)
                        || jsonb_build_object('record', x.recs -> ((case when (g -> 'home' ->> 'roster_id')::int = x.rid
                                                                        then g -> 'away' else g -> 'home' end) ->> 'roster_id')))
                from jsonb_array_elements(coalesce(x.sb -> 'games', '[]'::jsonb)) g
               where (g -> 'home' ->> 'roster_id')::int = x.rid
                  or (g -> 'away' ->> 'roster_id')::int = x.rid
               limit 1),
            -- The badge. `chat_unread` counts and never marks anything read,
            -- which is what a list needs and a chat screen does not.
            'unread', x.unread - 'ok'
          ) as row
          from (
            select l.id as lid, l.name as lname, m.sleeper_roster_id as rid,
                   league_week_scoreboard(l.id, null) as sb,
                   -- A contest league asks its contest (a stale 'bullseye' key on a
                   -- high-score contest must not flip it); everything else
                   -- asks the classic rule.
                   case when l.kind in ('dfs', 'bullseye') then _contest_lower_wins(l)
                        else league_lower_wins(l.id) end as lower_wins,
                   chat_unread(l.id) as unread,
                   -- Records keyed by roster id, so the two lookups above are
                   -- two jsonb reads rather than two more function calls.
                   coalesce((select jsonb_object_agg(s ->> 'roster_id', jsonb_build_object(
                               'wins', s -> 'wins', 'losses', s -> 'losses', 'ties', s -> 'ties'))
                      from jsonb_array_elements(league_standings(l.id)) s), '{}'::jsonb) as recs
              from league_membership m
              join league l on l.id = m.league_id
             where m.enrolled
               and not exists (select 1 from user_league_archive a
                                where a.app_user_id = me and a.league_id = l.id)
               and (m.app_user_id = me
                 or exists (select 1 from team_manager tm
                             where tm.league_id = m.league_id and tm.roster_id = m.sleeper_roster_id
                               and tm.app_user_id = me))
          ) x
         -- A league whose scoreboard refused (it cannot, for a member, but a
         -- shelf that throws is worse than a shelf that is short) is skipped
         -- rather than rendered as an error card.
         where coalesce((x.sb ->> 'ok')::boolean, false)
      ) rows), '[]'::jsonb));
end $$;
grant execute on function my_league_slate() to authenticated;
