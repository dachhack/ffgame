-- ═══════════════════════════════════════════════════════════════════════════
-- 0347 · THE SHELF SHOWS THE WEEK — every league's current matchup, and its
--        unread count, in one ask
--
-- Founder, with Sleeper's league list open beside ours: "Matchup summary per
-- league and a notification for unread chats."
--
-- Sleeper's landing screen answers the only question a list of leagues is ever
-- opened to answer — AM I WINNING — before you tap anything. Ours answered
-- "what are these leagues called". A shelf of names is a menu; a shelf of live
-- scores is a reason to open the app on a Sunday.
--
-- ONE CALL, NOT N. The app already badged unread chat by fanning `chat_unread`
-- out one RPC per league on a 60-second timer, and a matchup summary done the
-- same way would have doubled or trebled that. This is the whole shelf in a
-- single round trip.
--
-- IT ASKS THE SAME FUNCTIONS THE LEAGUE PAGE ASKS. The scores come from
-- `league_week_scoreboard` (0341) and the records from `league_standings`,
-- rather than from a second expression that computes the same thing here. Two
-- surfaces that disagree about a score is the bug this session opened on, and
-- the cheapest way not to have it is not to have a second opinion: whatever
-- week the league page shows, and whatever it shows for it, the shelf shows
-- too — median games, golf scoring, practice weeks and all.
--
-- NOTHING NEW LEAKS. Every part is a function the caller could already call
-- for each of these leagues one at a time, under its own membership check —
-- `league_week_scoreboard` publishes totals only and never `slot_scores`, and
-- a window that has not kicked off has no row to sum. This is those calls,
-- batched, for the leagues the caller is enrolled in and no others.
-- ═══════════════════════════════════════════════════════════════════════════

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
