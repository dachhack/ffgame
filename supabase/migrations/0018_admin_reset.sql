-- 0018: in-app reset for demos. Clears a matchup back to "untouched" — scheduled,
-- no window scores, no finals, no coin, picks unlocked — so the resolve → watch →
-- reset loop runs entirely from the admin page (no `simulate --reset` workflow).
-- Mirrors the per-matchup part of simulateReset. is_admin()-gated, SECURITY DEFINER.
create or replace function admin_reset_matchup(p_matchup_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not exists (select 1 from matchup where id = p_matchup_id) then
    return jsonb_build_object('ok', false, 'error', 'not found');
  end if;
  delete from matchup_state where matchup_id = p_matchup_id;
  update sealed_pick set locked = false, revealed_at = null where matchup_id = p_matchup_id;
  update matchup set status = 'scheduled', home_final = null, away_final = null,
    home_coin = null, away_coin = null where id = p_matchup_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function admin_reset_matchup(uuid) to authenticated;
