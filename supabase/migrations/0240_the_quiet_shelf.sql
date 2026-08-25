-- 0240 — THE QUIET SHELF: what a league card needs, and nothing else.
--
-- Founder, holding up Sleeper's own league list: "Let's make the league chips
-- less busy. Avatar, league name, built text of league type, drafting if
-- drafting. That's all we need too. Open up to the match up by default if the
-- draft is done. Open up to the draft if it is progress. Open up to the league
-- home if neither."
--
-- Both halves of that need one fact the list has never had: WHERE EACH LEAGUE
-- IS IN ITS DRAFT. It decides the only badge left on the card, and it decides
-- which room a tap opens. Every other source of it is per-league
-- (native_team_state), which a list of twelve leagues cannot afford and which
-- would make the badge arrive after the card.
--
-- So my_teams carries it. Two fields join the `league` object:
--
--   draft_status  'pending' | 'live' | 'complete', or NULL where there is no
--                 draft row at all — an imported league whose draft happened
--                 on its own platform. NULL is not 'pending': it means THIS
--                 LEAGUE HAS NO DRAFT HERE, and the landing rule reads it as
--                 "no draft to open", not "a draft yet to come".
--   rosters       seats in the league, for the built type line ("12-TEAM").
--
-- Respun from the 0239 body (the shelf's `archived`), which is respun in turn
-- from 0185's. Nothing else changes.
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
        'rosters', (select count(*) from league_membership m2 where m2.league_id = l.id))
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
