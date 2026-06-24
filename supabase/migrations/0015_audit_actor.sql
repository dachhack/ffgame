-- 0015: surface the actor (who made the edit) in audit RPCs.
--
-- audit_log.actor is auth.uid() of the writer (null for service-role writes
-- like the worker). Join it to app_user for a human-readable email; fall back
-- to a short uid suffix if the user row isn't linked yet.

create or replace function admin_audit(p_limit int default 50) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', a.table_name, 'op', a.op, 'row_id', a.row_id, 'at', a.at,
    'actor', case when a.actor is null then 'system'
                  else coalesce(u.email, 'user ' || substr(a.actor::text, 1, 8)) end,
    'detail', case
      when a.table_name = 'matchup' and (a.old_row->>'home_coin') is distinct from (a.new_row->>'home_coin')
        or a.table_name = 'matchup' and (a.old_row->>'away_coin') is distinct from (a.new_row->>'away_coin')
      then 'coin ' || coalesce(a.old_row->>'home_coin', '–') || '/' || coalesce(a.old_row->>'away_coin', '–')
           || ' → ' || coalesce(a.new_row->>'home_coin', '–') || '/' || coalesce(a.new_row->>'away_coin', '–')
      when a.table_name = 'matchup' and (a.old_row->>'status') is distinct from (a.new_row->>'status')
      then 'status ' || coalesce(a.old_row->>'status', '–') || ' → ' || coalesce(a.new_row->>'status', '–')
      else null end
  ) order by a.at desc), '[]'::jsonb)
    into result from (select * from audit_log order by at desc limit least(p_limit, 200)) a
    left join app_user u on u.id = a.actor;
  return result;
end $$;
grant execute on function admin_audit(int) to authenticated;

create or replace function commish_audit(p_league_id uuid, p_limit int default 50) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', a.table_name, 'op', a.op, 'row_id', a.row_id, 'at', a.at,
    'actor', case when a.actor is null then 'system'
                  else coalesce(u.email, 'user ' || substr(a.actor::text, 1, 8)) end,
    'detail', case
      when (a.old_row->>'home_coin') is distinct from (a.new_row->>'home_coin')
        or (a.old_row->>'away_coin') is distinct from (a.new_row->>'away_coin')
      then 'coin ' || coalesce(a.old_row->>'home_coin', '–') || '/' || coalesce(a.old_row->>'away_coin', '–')
           || ' → ' || coalesce(a.new_row->>'home_coin', '–') || '/' || coalesce(a.new_row->>'away_coin', '–')
      when (a.old_row->>'status') is distinct from (a.new_row->>'status')
      then 'status ' || coalesce(a.old_row->>'status', '–') || ' → ' || coalesce(a.new_row->>'status', '–')
      else null end
  ) order by a.at desc), '[]'::jsonb)
  into result from (
    select * from audit_log
    where table_name = 'matchup' and row_id in (select id::text from matchup where league_id = p_league_id)
    order by at desc limit least(p_limit, 200)
  ) a left join app_user u on u.id = a.actor;
  return result;
end $$;
grant execute on function commish_audit(uuid, int) to authenticated;
