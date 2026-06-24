-- 0013: manual drip-coin edit (admin or league commissioner), audited.
-- (Renumbered from 0012 so it lands as a freshly-added file for auto-apply.)
--
-- A plain matchup UPDATE, so the existing `audit_matchup` trigger records the
-- old/new coin automatically. admin_audit is enriched to surface the change.

create or replace function admin_set_coin(p_matchup_id uuid, p_home_coin numeric, p_away_coin numeric) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_matchup_commish(p_matchup_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update matchup set home_coin = p_home_coin, away_coin = p_away_coin where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function admin_set_coin(uuid, numeric, numeric) to authenticated;

-- Recent audit-log entries, now with a short detail for matchup coin/score edits.
create or replace function admin_audit(p_limit int default 50) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', table_name, 'op', op, 'row_id', row_id, 'at', at,
    'detail', case
      when table_name = 'matchup' and (old_row->>'home_coin') is distinct from (new_row->>'home_coin')
        or table_name = 'matchup' and (old_row->>'away_coin') is distinct from (new_row->>'away_coin')
      then 'coin ' || coalesce(old_row->>'home_coin', '–') || '/' || coalesce(old_row->>'away_coin', '–')
           || ' → ' || coalesce(new_row->>'home_coin', '–') || '/' || coalesce(new_row->>'away_coin', '–')
      else null end
  ) order by at desc), '[]'::jsonb)
    into result from (select * from audit_log order by at desc limit least(p_limit, 200)) a;
  return result;
end $$;
grant execute on function admin_audit(int) to authenticated;
