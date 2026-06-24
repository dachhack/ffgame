-- 0020: per-slot player scores on the admin live board.
-- Adds slot_scores jsonb to matchup_state so each window row carries a
-- [{side,slot,slug,metric,score}] breakdown written by force-resolve and the
-- Fly worker. admin_matchup_board returns them; admin_set_state accepts them as
-- an optional param (p_slot_scores) — omitting it leaves existing slot_scores.

alter table matchup_state add column if not exists slot_scores jsonb default '[]'::jsonb;

-- Drop the 4-arg overload so PostgREST sees exactly one signature.
drop function if exists admin_set_state(uuid, jsonb, numeric, numeric);

create or replace function admin_set_state(
  p_matchup_id uuid,
  p_states jsonb,
  p_home_coin numeric default null,
  p_away_coin numeric default null,
  p_slot_scores jsonb default null   -- [{win,side,slot,slug,metric,score}]
) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into matchup_state (matchup_id, game_window, home_score, away_score, slot_scores, updated_at)
  select
    p_matchup_id,
    st->>'window',
    (st->>'home')::numeric,
    (st->>'away')::numeric,
    case when p_slot_scores is not null then
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'side', sc->>'side', 'slot', sc->>'slot',
          'slug', sc->>'slug', 'metric', sc->>'metric',
          'score', (sc->>'score')::numeric
        ) order by sc->>'slot')
        from jsonb_array_elements(p_slot_scores) sc
        where sc->>'win' = st->>'window'
      ), '[]'::jsonb)
    else '[]'::jsonb end,
    now()
  from jsonb_array_elements(p_states) st
  on conflict (matchup_id, game_window) do update set
    home_score   = excluded.home_score,
    away_score   = excluded.away_score,
    slot_scores  = case when p_slot_scores is not null then excluded.slot_scores else matchup_state.slot_scores end,
    updated_at   = now();
  if p_home_coin is not null or p_away_coin is not null then
    update matchup set
      home_coin = coalesce(p_home_coin, home_coin),
      away_coin = coalesce(p_away_coin, away_coin)
    where id = p_matchup_id;
  end if;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_states));
end $$;
grant execute on function admin_set_state(uuid, jsonb, numeric, numeric, jsonb) to authenticated;

-- Rebuild admin_matchup_board to include slot_scores in each state entry
-- (supersedes 0019 which added home_picks/away_picks from sealed_pick).
create or replace function admin_matchup_board(p_matchup_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
  m matchup%rowtype;
  home_user uuid;
  away_user uuid;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('error', 'not found'); end if;

  select app_user_id into home_user from league_membership
    where league_id = m.league_id and sleeper_roster_id = m.home_roster_id and enrolled = true limit 1;
  select app_user_id into away_user from league_membership
    where league_id = m.league_id and sleeper_roster_id = m.away_roster_id and enrolled = true limit 1;

  select jsonb_build_object(
    'matchup', jsonb_build_object(
      'id', m.id, 'week', m.week, 'status', m.status,
      'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id,
      'home_final', m.home_final, 'away_final', m.away_final,
      'home_coin', m.home_coin, 'away_coin', m.away_coin, 'lock_at', m.lock_at),
    'home_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id limit 1),
    'away_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id limit 1),
    'states', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'game_window', ms.game_window,
          'home_score', ms.home_score,
          'away_score', ms.away_score,
          -- Per-slot scores written by force-resolve / worker.
          'slot_scores', coalesce(ms.slot_scores, '[]'::jsonb),
          -- Sealed picks for enrolled users (fallback display when slot_scores empty).
          'home_picks', coalesce((
            select jsonb_agg(jsonb_build_object('slug', sp.player_slug, 'metric', sp.metric_id)
              order by sp.roster_slot)
            from sealed_pick sp
            where sp.matchup_id = m.id and sp.game_window = ms.game_window
              and sp.app_user_id = home_user and sp.player_slug is not null
          ), '[]'::jsonb),
          'away_picks', coalesce((
            select jsonb_agg(jsonb_build_object('slug', sp.player_slug, 'metric', sp.metric_id)
              order by sp.roster_slot)
            from sealed_pick sp
            where sp.matchup_id = m.id and sp.game_window = ms.game_window
              and sp.app_user_id = away_user and sp.player_slug is not null
          ), '[]'::jsonb)
        ) order by ms.game_window
      )
      from matchup_state ms where ms.matchup_id = m.id
    ), '[]'::jsonb),
    'updated_at', (select max(updated_at) from matchup_state where matchup_id = m.id)
  ) into result;
  return result;
end $$;
grant execute on function admin_matchup_board(uuid) to authenticated;
