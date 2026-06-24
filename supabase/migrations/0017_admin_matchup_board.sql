-- 0017: admin "watch any matchup" board. A read-only snapshot of a matchup's
-- live per-window scores + finals + coin + team names, for ANY matchup, so an
-- admin can watch a game (or a sim) animate without enrolling as a manager. The
-- frontend polls this every couple seconds. SECURITY DEFINER + is_admin() guard;
-- no RLS changes.
create or replace function admin_matchup_board(p_matchup_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb; m matchup%rowtype;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('error', 'not found'); end if;
  select jsonb_build_object(
    'matchup', jsonb_build_object(
      'id', m.id, 'week', m.week, 'status', m.status,
      'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id,
      'home_final', m.home_final, 'away_final', m.away_final,
      'home_coin', m.home_coin, 'away_coin', m.away_coin, 'lock_at', m.lock_at),
    'home_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id),
    'away_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id),
    'states', coalesce((select jsonb_agg(jsonb_build_object(
        'game_window', game_window, 'home_score', home_score, 'away_score', away_score) order by game_window)
      from matchup_state where matchup_id = m.id), '[]'::jsonb),
    'updated_at', (select max(updated_at) from matchup_state where matchup_id = m.id)
  ) into result;
  return result;
end $$;

grant execute on function admin_matchup_board(uuid) to authenticated;
