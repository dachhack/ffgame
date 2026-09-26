-- ═══════════════════════════════════════════════════════════════════════════
-- 0370 · GRADUATION CONFLICTS, SETTLED BY THE COMMISSIONER.
--
-- 0367 leaves a league alone when a graduating devy player is ALSO rostered by
-- a different team as an NFL player: the two rows are one man, and only the
-- commissioner can say whose he is. This is that decision:
--
--   league_graduation_conflicts(league) — the open ones, with both teams and
--     the player's name (members may read; the commissioner acts);
--   commish_resolve_graduation(league, espn_id, keep) — 'devy' releases the
--     NFL row and the devy holder keeps him; 'nfl' releases the devy row.
--     Either way the graduation then runs, exactly as the worker would have.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function league_graduation_conflicts(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'conflicts', coalesce((
    select jsonb_agg(jsonb_build_object(
             'espn_id', g.espn_id, 'nfl_slug', g.new_slug, 'note', g.note, 'at', g.at,
             'full_name', coalesce(nfl.full_name, col.full_name),
             'devy_roster', dv.roster_id, 'nfl_roster', nr.roster_id)
           order by g.at)
      from college_graduation g
      left join league_pool col on col.league_id = g.league_id and col.slug = 'c-' || g.espn_id
      left join league_pool nfl on nfl.league_id = g.league_id and nfl.slug = g.new_slug
      left join native_roster dv on dv.league_id = g.league_id and dv.slug = 'c-' || g.espn_id
      left join native_roster nr on nr.league_id = g.league_id and nr.slug = g.new_slug
     where g.league_id = p_league_id and g.status = 'conflict'
       and col.slug is not null), '[]'::jsonb));
end $$;
grant execute on function league_graduation_conflicts(uuid) to authenticated;

create or replace function commish_resolve_graduation(p_league_id uuid, p_espn_id text, p_keep text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare g college_graduation%rowtype; nfl league_pool%rowtype; r jsonb;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_keep not in ('devy', 'nfl') then
    return jsonb_build_object('ok', false, 'error', 'keep the devy holder or the NFL holder');
  end if;
  select * into g from college_graduation
   where league_id = p_league_id and espn_id = p_espn_id and status = 'conflict';
  if not found then return jsonb_build_object('ok', false, 'error', 'no open conflict for that player'); end if;
  select * into nfl from league_pool where league_id = p_league_id and slug = g.new_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'the NFL player is no longer in this pool'); end if;

  perform set_config('app.txn_note', 'graduation: commissioner kept the ' || p_keep || ' holder', true);
  if p_keep = 'devy' then
    delete from native_roster where league_id = p_league_id and slug = g.new_slug;
  else
    delete from native_roster where league_id = p_league_id and slug = 'c-' || p_espn_id;
  end if;
  r := graduate_college_player(p_espn_id, g.new_slug, nfl.full_name, nfl.pos, nfl.team, nfl.sleeper_id);
  return jsonb_build_object('ok', coalesce((r ->> 'ok')::boolean, false), 'kept', p_keep,
    'status', (select status from college_graduation where league_id = p_league_id and espn_id = p_espn_id));
end $$;
grant execute on function commish_resolve_graduation(uuid, text, text) to authenticated;
