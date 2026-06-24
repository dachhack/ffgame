-- 0011: persist weekly drip-coin earnings per matchup side.
--
-- The shared resolver (src/engine/liveResolve.ts) computes each side's weekly
-- drip-coin take (stipend + unopposed bounty + per-event-of-note coin). This
-- gives it a home: two nullable columns on matchup, written by the worker
-- (service role, direct) and by admin force-resolve (via admin_set_state).

alter table matchup add column if not exists home_coin numeric;
alter table matchup add column if not exists away_coin numeric;

-- admin_set_state gains optional coin params. Drop the 2-arg version first so
-- PostgREST doesn't see two overloads (the client may call with or without coin).
drop function if exists admin_set_state(uuid, jsonb);
create or replace function admin_set_state(
  p_matchup_id uuid, p_states jsonb,
  p_home_coin numeric default null, p_away_coin numeric default null
) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into matchup_state (matchup_id, game_window, home_score, away_score, updated_at)
  select p_matchup_id, e->>'window', (e->>'home')::numeric, (e->>'away')::numeric, now()
  from jsonb_array_elements(p_states) e
  on conflict (matchup_id, game_window) do update set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now();
  if p_home_coin is not null or p_away_coin is not null then
    update matchup set home_coin = coalesce(p_home_coin, home_coin), away_coin = coalesce(p_away_coin, away_coin) where id = p_matchup_id;
  end if;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_states));
end $$;
grant execute on function admin_set_state(uuid, jsonb, numeric, numeric) to authenticated;

-- Surface coin in the admin/commish matchups list too.
create or replace function admin_matchups(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r order by (r->>'week')::int), '[]'::jsonb) into result from (
    select jsonb_build_object('id', id, 'week', week, 'home_roster_id', home_roster_id, 'away_roster_id', away_roster_id,
      'status', status, 'lock_at', lock_at, 'home_final', home_final, 'away_final', away_final,
      'home_coin', home_coin, 'away_coin', away_coin) as r
    from matchup where league_id = p_league_id
  ) t;
  return result;
end $$;
