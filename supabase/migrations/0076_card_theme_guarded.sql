-- 0076: card-table theme, self-guarded re-apply. Supersedes 0074 + 0075, which
-- failed on main: league_pref (created by 0036) is MISSING from the production
-- DB — 0036 appears to have merged before migrate.yml watched main, so it never
-- auto-applied, and the apply loop stopped at 0074's ALTER. The pipeline only
-- runs newly ADDED files, so the fix ships as this new migration that creates
-- its own prerequisites. Safe alongside 0036 whenever that is reconciled: the
-- table definition matches exactly (create if not exists), and 0036's RLS
-- policy is deliberately NOT created here so a later 0036 apply won't collide.

-- league_pref (0036's definition) — the per-league preference row.
create table if not exists league_pref (
  league_id        uuid primary key references league(id) on delete cascade,
  premium_disabled boolean not null default false,
  updated_at       timestamptz not null default now()
);
alter table league_pref enable row level security;

-- ── 0074 content: the card-table flag ───────────────────────────────────────
alter table league_pref add column if not exists card_theme boolean not null default false;

create or replace function league_card_theme(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select card_theme from league_pref where league_id = p_league), false)
$$;

create or replace function admin_set_card_theme(p_league uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into league_pref (league_id, card_theme, updated_at) values (p_league, p_on, now())
    on conflict (league_id) do update set card_theme = excluded.card_theme, updated_at = now();
  return jsonb_build_object('ok', true, 'card_theme', p_on);
end $$;

grant execute on function league_card_theme(uuid) to authenticated;
grant execute on function admin_set_card_theme(uuid, boolean) to authenticated;

-- ── 0075 content: hot/nuked flags through admin_set_state ───────────────────
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
