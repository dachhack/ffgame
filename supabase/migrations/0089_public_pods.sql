-- 0089: PUBLIC PODS — solo-joinable drop-in leagues (step 1 of the DFS path).
--
-- A pod is an ordinary league row (kind='pod') with 6 seats that start as
-- app_user-less AI teams (the 0030 fake-league pattern: the resolver auto-lineups
-- them, no auth users needed). join_pod() lets any signed-in player claim the
-- next open seat — or spins up a fresh pod when none are open — so a cold
-- visitor can be enrolled and playing this week's slate in one tap, no Sleeper
-- league required. Rosters are DEALT weekly by the worker (server/src/pods.js
-- writes sleeper_lineup + matchup rows; no Sleeper sync touches pods), and the
-- rest of the pilot machinery (lock → resolve → live board → coin via the
-- idempotent ensure_wallet) runs unchanged.
--
-- Season default matches the 2026 pilot; the client can override when the
-- season rolls.

alter table league add column if not exists kind text not null default 'league'
  check (kind in ('league', 'pod'));
create index if not exists league_kind_idx on league(kind) where kind = 'pod';

create or replace function join_pod(p_team_name text default null, p_season text default '2026')
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  seat league_membership%rowtype;
  lg   league%rowtype;
  pod_id uuid;
  names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew'];
  avn  text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  -- Idempotent: already seated in a pod this season → return that seat.
  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where m.app_user_id = auth.uid() and m.enrolled and l.kind = 'pod' and l.season = p_season
    limit 1;
  if found then
    select * into lg from league where id = seat.league_id;
    return jsonb_build_object('ok', true, 'already', true,
      'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', seat.team_name);
  end if;

  -- Claim the next open seat across open pods. SKIP LOCKED so two joiners
  -- racing for the same pod land on different seats instead of erroring.
  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where l.kind = 'pod' and l.season = p_season and m.app_user_id is null
    order by l.created_at, m.sleeper_roster_id
    limit 1
    for update of m skip locked;

  if not found then
    -- No open seat anywhere → found a new pod with 6 AI-named seats and take seat 1.
    insert into league (sleeper_league_id, season, name, kind, kdst_mode, provider, lineup_policy)
      values ('POD-' || upper(left(md5(gen_random_uuid()::text), 8)), p_season,
              'Public Pod ' || upper(left(md5(gen_random_uuid()::text), 4)), 'pod', 'off', 'pod', 'ai')
      returning id into pod_id;
    for i in 1..6 loop
      insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
        values (pod_id, i, 'POD-AI-' || i, null, false, names[i], 'ai');
    end loop;
    select m.* into seat from league_membership m
      where m.league_id = pod_id and m.sleeper_roster_id = 1 for update;
  end if;

  update league_membership
    set app_user_id = auth.uid(), enrolled = true, controller = 'human',
        team_name = coalesce(nullif(trim(p_team_name), ''), team_name)
    where id = seat.id;

  select * into lg from league where id = seat.league_id;
  return jsonb_build_object('ok', true,
    'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id,
    'team', coalesce(nullif(trim(p_team_name), ''), seat.team_name));
end $$;

grant execute on function join_pod(text, text) to authenticated;
