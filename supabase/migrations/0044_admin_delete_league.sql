-- 0044: super-admin can permanently delete a league. Every child table
-- (memberships, matchups → picks/lineups, coin wallets, K/DST, entitlements,
-- join pool, …) references league(id) on delete cascade, so a single delete
-- cleans the whole tree. Admin-only — commissioners cannot nuke a league.
create or replace function admin_delete_league(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select name into nm from league where id = p_league_id;
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  delete from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'name', nm);
end $$;
grant execute on function admin_delete_league(uuid) to authenticated;
