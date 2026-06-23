-- 0014: commissioner-scoped audit (their own league's matchup edits).
--
-- audit_log is admin-only; a commissioner couldn't see edits to their league.
-- This returns matchup-table audit rows scoped to one league (row_id = the
-- matchup id), with a short detail for coin and status changes. Admins may read
-- any league's; a commissioner only their own.

create or replace function commish_audit(p_league_id uuid, p_limit int default 50) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', table_name, 'op', op, 'row_id', row_id, 'at', at,
    'detail', case
      when (old_row->>'home_coin') is distinct from (new_row->>'home_coin')
        or (old_row->>'away_coin') is distinct from (new_row->>'away_coin')
      then 'coin ' || coalesce(old_row->>'home_coin', '–') || '/' || coalesce(old_row->>'away_coin', '–')
           || ' → ' || coalesce(new_row->>'home_coin', '–') || '/' || coalesce(new_row->>'away_coin', '–')
      when (old_row->>'status') is distinct from (new_row->>'status')
      then 'status ' || coalesce(old_row->>'status', '–') || ' → ' || coalesce(new_row->>'status', '–')
      else null end
  ) order by at desc), '[]'::jsonb)
  into result from (
    select * from audit_log
    where table_name = 'matchup' and row_id in (select id::text from matchup where league_id = p_league_id)
    order by at desc limit least(p_limit, 200)
  ) a;
  return result;
end $$;
grant execute on function commish_audit(uuid, int) to authenticated;
