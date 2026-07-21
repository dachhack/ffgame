-- 0090: WEEKLY SHOWDOWNS — one-week DFS-style contests (step 2 of the DFS path).
--
-- A showdown is a pod (0089) with a shelf life: kind='weekly', pinned to one
-- NFL week (contest_week). Players recruit into it all week, the worker deals
-- rosters + pairs the seats exactly like a pod, the week resolves, the top
-- total score is crowned (client-side, from the final matchup rows), and then
-- the league is TOSSED — the worker unenrolls every seat two weeks after the
-- contest week, so it vanishes from everyone's home after one week of glory.
--
-- join_weekly() derives the target week server-side from nfl_slate (the
-- current week if its games aren't done, else the next), so the client never
-- has to know the NFL calendar.

alter table league add column if not exists contest_week int;
alter table league drop constraint if exists league_kind_check;
alter table league add constraint league_kind_check check (kind in ('league', 'pod', 'weekly'));

create or replace function join_weekly(p_team_name text default null, p_season text default '2026')
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  seat league_membership%rowtype;
  lg   league%rowtype;
  pod_id uuid;
  wk   int;
  names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew'];
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- Target week: the first slate week that isn't fully over (live now or the
  -- soonest upcoming). ~4h pads the last kickoff to game end.
  select week into wk from nfl_slate
    where season = p_season and kickoff is not null
    group by week
    having max(kickoff) + interval '4 hours' > now()
    order by min(kickoff)
    limit 1;
  if wk is null then
    return jsonb_build_object('ok', false, 'error', 'no upcoming NFL week on the slate');
  end if;

  -- Idempotent: already seated in this week's showdown → return that seat.
  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where m.app_user_id = auth.uid() and m.enrolled
      and l.kind = 'weekly' and l.season = p_season and l.contest_week = wk
    limit 1;
  if found then
    select * into lg from league where id = seat.league_id;
    return jsonb_build_object('ok', true, 'already', true, 'week', wk,
      'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', seat.team_name);
  end if;

  -- Claim the next open seat across this week's showdowns (SKIP LOCKED so
  -- racing joiners land on different seats).
  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where l.kind = 'weekly' and l.season = p_season and l.contest_week = wk and m.app_user_id is null
    order by l.created_at, m.sleeper_roster_id
    limit 1
    for update of m skip locked;

  if not found then
    -- No open seat → found a fresh showdown for this week and take seat 1.
    insert into league (sleeper_league_id, season, name, kind, contest_week, kdst_mode, provider, lineup_policy)
      values ('WKLY-' || upper(left(md5(gen_random_uuid()::text), 8)), p_season,
              'Week ' || wk || ' Showdown ' || upper(left(md5(gen_random_uuid()::text), 4)),
              'weekly', wk, 'off', 'pod', 'ai')
      returning id into pod_id;
    for i in 1..6 loop
      insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
        values (pod_id, i, 'WKLY-AI-' || i, null, false, names[i], 'ai');
    end loop;
    select m.* into seat from league_membership m
      where m.league_id = pod_id and m.sleeper_roster_id = 1 for update;
  end if;

  update league_membership
    set app_user_id = auth.uid(), enrolled = true, controller = 'human',
        team_name = coalesce(nullif(trim(p_team_name), ''), team_name)
    where id = seat.id;

  select * into lg from league where id = seat.league_id;
  return jsonb_build_object('ok', true, 'week', wk,
    'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id,
    'team', coalesce(nullif(trim(p_team_name), ''), seat.team_name));
end $$;

grant execute on function join_weekly(text, text) to authenticated;
