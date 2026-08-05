-- 0101: super-admin RPC behind the admin console's "🧬 deep pool" button (and a
-- server-free path to what cli.js seed-preseason-pool does). Replaces EVERY
-- seat's lineup at a preseason board week with the caller-built deep slate-team
-- pool (src/data/preseasonPool.ts — every active skill player on the week's
-- teams, depth-chart ordered, + team K/DST), so seats can field the backups who
-- actually play preseason snaps. Pairings still come from admin_set_preseason's
-- clone; this swaps only the pick pools. Idempotent; re-run any time before
-- lock. Toggling preseason off deletes these rows along with the clones.
create or replace function admin_seed_preseason_pool(p_league_id uuid, p_week int, p_pool jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_week not in (101, 102, 103) then
    return jsonb_build_object('ok', false, 'error', 'preseason board weeks only (101-103)');
  end if;
  if jsonb_typeof(p_pool) is distinct from 'array' or jsonb_array_length(p_pool) = 0 then
    return jsonb_build_object('ok', false, 'error', 'pool must be a non-empty array');
  end if;
  if jsonb_array_length(p_pool) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large');
  end if;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    select p_league_id, p_week, m.sleeper_roster_id, p_pool
      from league_membership m where m.league_id = p_league_id
  on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'league has no seats'); end if;
  return jsonb_build_object('ok', true, 'seats', n, 'pool', jsonb_array_length(p_pool));
end $$;
grant execute on function admin_seed_preseason_pool(uuid, int, jsonb) to authenticated;
