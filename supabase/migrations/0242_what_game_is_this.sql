-- 0242 — WHAT GAME IS THIS? on the league chip.
--
-- Founder: "let's have drip or classic vampire, golf etc on the chips in my
-- leagues."
--
-- v0.356.16 cut the chip to one built line — season, size, and what kind of
-- league it is (Dynasty, Contract, Keeper…). But "what kind" was answering the
-- CONTINUITY question only: what carries into next season. It said nothing
-- about what you actually play on a Sunday, and three settings decide that:
--
--   game_mode  drip | classic   — the whole engine: windows, metrics and
--                                 power-ups, or a traditional weekly lineup.
--   format     standard | guillotine | vampire   (0221/0222)
--   golf       lowest weekly total wins          (0200)
--
-- All three already live in league.settings_json behind stable helpers
-- (league_format, league_golf; game_mode is read inline the way 0157 and every
-- migration since reads it). None of them reached my_teams, so the list could
-- not say them however the client asked.
--
-- Respun from the 0240 body (draft_status + rosters), which is respun in turn
-- from 0239's and 0185's. Nothing else changes.
create or replace function my_teams()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(r order by r -> 'league' ->> 'name'), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', m.league_id, 'team_name', m.team_name, 'sleeper_roster_id', m.sleeper_roster_id,
      'avatar_url', m.avatar_url, 'pick_user_id', m.app_user_id, 'comanager', (m.app_user_id <> auth.uid()),
      -- 0239: on the caller's shelf → the list folds it away
      'archived', exists (select 1 from user_league_archive a
                          where a.app_user_id = auth.uid() and a.league_id = m.league_id),
      'league', jsonb_build_object(
        'name', l.name, 'season', l.season, 'preseason_at', l.preseason_at, 'provider', l.provider,
        'avatar_url', l.avatar_url, 'is_mock', l.is_mock, 'kind', l.kind, 'contest_week', l.contest_week,
        'dynasty', league_is_dynasty(l.id),
        'continuity', league_continuity(l.id),
        -- 0240: the card's one badge and the tap's destination. Left NULL when
        -- the league has no draft of ours to be in the middle of.
        'draft_status', (select d.status from draft d where d.league_id = l.id),
        'rosters', (select count(*) from league_membership m2 where m2.league_id = l.id),
        -- 0242: WHICH GAME. An imported league plays its platform's, not ours,
        -- so these are only meaningful on a native one — the client decides
        -- what to print, this just stops guessing.
        'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
        'format', league_format(l.id),
        'golf', league_golf(l.id))
    ) as r
    from league_membership m
    join league l on l.id = m.league_id
    where m.enrolled and (
      m.app_user_id = auth.uid()
      or exists (select 1 from team_manager tm
                  where tm.league_id = m.league_id and tm.roster_id = m.sleeper_roster_id
                    and tm.app_user_id = auth.uid())
    )
  ) t;
  return result;
end $$;
