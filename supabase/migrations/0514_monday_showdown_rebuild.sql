-- 0514 · MONDAY SHOWDOWN'S SQUADS, CLEARED TO BE BUILT AGAIN (v0.730.29)
--
-- A member: "it says my team is locked in as … who have all already played."
-- Monday Showdown was made on Monday for week 6, with only WAS@SF still to
-- play. The worker read Thursday's kickoff as the league's no-show deadline
-- and auto-built both seats at once from the whole week's board: ops 075
-- showed all 16 picks were Sunday players whose games kicked off before the
-- league existed (Josh Allen, Kyren Williams, Brock Bowers…) — points already
-- known, and locked, so neither seat could swap them. v0.730.28 fixed the
-- rule (the deadline is now the first kickoff after the league was made —
-- tonight's — and a build only takes players still to play).
--
-- This clears both week-6 squads and the matchup's stale score so the two
-- players can build from WAS and SF before the 00:15 UTC kickoff (the league's
-- entry deadline is `open`, so an empty seat may enter), and tells the league
-- chat. One league, by id; re-runnable (nothing to delete the second time,
-- and the note is posted once).

do $$
declare lid uuid := 'ec3c4c2d-63a1-4f27-8844-a7d132e53a11'; n int;
begin
  if not exists (select 1 from league where id = lid and name = 'Monday Showdown') then
    raise notice 'Monday Showdown not found — nothing to do'; return;
  end if;
  delete from sleeper_lineup sl where sl.league_id = lid and sl.week = 6
     and not exists (select 1 from jsonb_array_elements(sl.starters_json) e
                       where e ->> 'player_slug' in (select slug from pod_salary where season = '2026' and week = 6 and team in ('WAS', 'SF')));
  get diagnostics n = row_count;
  raise notice 'Monday Showdown: % week-6 squad(s) cleared', n;
  delete from matchup_state ms using matchup m where ms.matchup_id = m.id and m.league_id = lid and m.week = 6;
  if not exists (select 1 from league_message where league_id = lid and kind = 'computer' and body like 'Your week 6 squads were filled by mistake%') then
    insert into league_message (league_id, author_id, kind, body, mentions)
    values (lid, null, 'computer',
      'Your week 6 squads were filled by mistake with players whose games were already over. They''ve been cleared: build your squad from WAS and SF before tonight''s 8:15pm ET kickoff. A team with no squad by kickoff gets one built for it from that game.', '{}');
  end if;
end $$;
