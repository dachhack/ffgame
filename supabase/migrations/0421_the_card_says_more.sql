-- ═══════════════════════════════════════════════════════════════════════════
-- 0421 · THE LEAGUE CARD SAYS MORE (v0.610.0).
--
-- Founder: "More descriptive league descriptions on my leagues page. (Devy,
-- Drip, other league settings?)"
--
-- The card's one line (0240/0242) says season, size, continuity and the game:
-- "2026 12-Team Dynasty Drip". It cannot say devy, superflex, PPR, best ball,
-- the cap, keepers or dues, because my_teams never carried them — they live in
-- settings_json behind helpers the board and the commissioner's desk read, and
-- the list never asked. An imported league is worse off: its line is the one
-- word "Sleeper", though Sleeper's own settings (type, best_ball, scoring.rec,
-- roster_positions) sit in settings_json exactly as the import stored them.
--
-- `_league_details(l.id)` gathers the lot into one block, which my_teams now
-- serves as league.details. The client prints it as a second line and drops
-- any part it doesn't know (core's leagueDetailLine). Nothing here is a new
-- fact; every field reads a helper or key some other screen already trusts.
--
-- my_teams is respun from 0242's body with the one added key; nothing else
-- about it changes.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _league_details(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  with l as (select id, provider, coalesce(settings_json, '{}'::jsonb) as sj from league where id = p_league_id)
  select case
    when l.provider = 'native' then jsonb_build_object(
      -- Classic only: a drip lineup starts any position anywhere, so superflex
      -- and reception scoring are not settings it has (league_is_superflex
      -- answers true for every drip league, which would print as a claim).
      'superflex', case when coalesce(l.sj ->> 'game_mode', 'drip') = 'classic' then league_is_superflex(l.id) end,
      'ppr', case when coalesce(l.sj ->> 'game_mode', 'drip') = 'classic' then coalesce((l.sj ->> 'ppr')::numeric, 1) end,
      'bestball', case when jsonb_typeof(l.sj -> 'bestball') = 'array' then jsonb_array_length(l.sj -> 'bestball') > 0 else false end,
      'devy', _league_has_college(l.sj),
      'devy_mode', case when _league_has_college(l.sj) then coalesce(l.sj ->> 'devy_mode', 'spots') end,
      'college_calendar', league_is_college_calendar(l.id),
      'contracts', contracts_on(l.id),
      'salary_cap', case when contracts_on(l.id) then league_salary_cap(l.id) end,
      'keepers', nullif(l.sj ->> 'keeper_count', '')::int,
      'dues', nullif(l.sj ->> 'dues_amount', '')::int,
      'scoring_custom', coalesce(jsonb_typeof(l.sj -> 'scoring') = 'object' and l.sj -> 'scoring' <> '{}'::jsonb, false))
    else jsonb_build_object(
      -- Imported: Sleeper's league object as the import stored it
      -- ({settings, scoring, roster_positions}, sleeperAdmin.importLeague).
      -- Each read is typed-guarded, because an import from another provider
      -- may carry none of these.
      'superflex', case when jsonb_typeof(l.sj -> 'roster_positions') = 'array' then
          (l.sj -> 'roster_positions') @> '["SUPER_FLEX"]'::jsonb
          or (select count(*) >= 2 from jsonb_array_elements_text(l.sj -> 'roster_positions') as p(slot) where p.slot = 'QB')
        end,
      'ppr', case when jsonb_typeof(l.sj -> 'scoring' -> 'rec') = 'number' then (l.sj -> 'scoring' ->> 'rec')::numeric end,
      'bestball', case when jsonb_typeof(l.sj -> 'settings' -> 'best_ball') = 'number' then (l.sj -> 'settings' ->> 'best_ball')::numeric = 1 end,
      'continuity', case l.sj -> 'settings' ->> 'type' when '2' then 'dynasty' when '1' then 'keeper' end,
      'starters', case when jsonb_typeof(l.sj -> 'roster_positions') = 'array' then
          (select count(*) from jsonb_array_elements_text(l.sj -> 'roster_positions') as p(slot) where p.slot not in ('BN', 'IR', 'TAXI'))
        end)
  end
  from l;
$$;

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
        'golf', league_golf(l.id),
        -- 0421: the card's second line — devy, superflex, PPR, best ball,
        -- cap, keepers, dues; Sleeper's own settings for an imported league.
        'details', _league_details(l.id))
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
