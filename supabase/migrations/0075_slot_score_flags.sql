-- 0075: pass the engine's per-slot event flags (hot / nuked) through
-- admin_set_state's slot_scores normalization. The worker writes matchup_state
-- directly and already keeps them; without this, the admin force-resolve path
-- strips the flags the card-table board renders (🔥 hot glow, nuke scorch).
-- Same signature and behavior as 0020 otherwise.

create or replace function admin_set_state(
  p_matchup_id uuid,
  p_states jsonb,
  p_home_coin numeric default null,
  p_away_coin numeric default null,
  p_slot_scores jsonb default null   -- [{win,side,slot,slug,metric,score,hot?,nuked?}]
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
        select jsonb_agg((jsonb_build_object(
          'side', sc->>'side', 'slot', sc->>'slot',
          'slug', sc->>'slug', 'metric', sc->>'metric',
          'score', (sc->>'score')::numeric
        )
        || case when (sc->>'hot')::boolean   then '{"hot": true}'::jsonb   else '{}'::jsonb end
        || case when (sc->>'nuked')::boolean then '{"nuked": true}'::jsonb else '{}'::jsonb end
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
