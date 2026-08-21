-- 0211: THE METRICLESS-PICK AUDIT, as something you can tap.
--
-- Founder, after the diagnostic .sql landed: "can we run the sql by action?"
--
-- The answer to the underlying question is no — a session with no live
-- credentials cannot query production, and it should not have them. So the
-- query moves to where the data already is, behind the same `is_admin()` gate
-- every other cross-league diagnostic takes, and becomes a button.
--
-- ── WHAT IT IS LOOKING FOR ─────────────────────────────────────────────────
-- A `sealed_pick` row with a player and NO metric. `scorePlay` (engine/sim.ts)
-- is a chain of `if (metricId === '…')` ending in `return 0`, so a null matches
-- nothing and falls through: the pick scores EXACTLY ZERO for the whole window
-- whatever the player does. The seat is occupied and dead, and nothing on the
-- board says so — which is how "how did Montgomery get no metric?" happened.
--
-- `metric_id` is nullable on purpose: 0024 (a locked-metric unlock disarmed),
-- 0026 (coin refund) and 0062 (combodrip quantity change) all null it while
-- KEEPING the player, so the manager re-picks. Each is right alone; none makes
-- sure the manager returns before the window locks.
--
-- ── READ ONLY, AND SCOPED ──────────────────────────────────────────────────
-- It reports; it does not repair. Rewriting somebody's sealed lineup from an
-- audit is not a diagnostic, and `admin_set_picks` (0021) already exists for
-- the deliberate version of that.
--
-- `classic` windows are excluded: classic has no metrics, so a null there is
-- correct and would drown the real signal.
--
-- The 200 cap is not decoration — an unbounded audit on a table this size is a
-- button that times out. `truncated` says so rather than quietly showing less.

create or replace function admin_metricless_picks(p_limit int default 200)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 200), 1), 500); total int; result jsonb;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select count(*) into total
    from sealed_pick sp
    where sp.player_slug is not null and sp.metric_id is null and sp.game_window <> 'classic';

  select jsonb_build_object(
    'ok', true,
    'total', total,
    'truncated', total > lim,
    -- The rows themselves, worst first: a LOCKED one is unfixable by the
    -- manager, which is the difference between a warning and a lost window.
    'picks', (
      select coalesce(jsonb_agg(r order by r.locked desc, r.week desc, r.league), '[]'::jsonb)
      from (
        select l.name as league, m.week, sp.game_window as win, sp.roster_slot as slot,
               sp.player_slug, sp.locked,
               coalesce(lm.team_name, left(sp.app_user_id::text, 8)) as team,
               coalesce(lm.controller, 'human') as controller,
               -- Did this seat set up its OTHER slots properly? If so it was
               -- set up and then LOST one, which points at 0024/0026/0062
               -- rather than at a manager who never finished.
               (select count(*) from sealed_pick o
                 where o.matchup_id = sp.matchup_id and o.app_user_id = sp.app_user_id
                   and o.metric_id is not null) as sibling_slots_with_metric
          from sealed_pick sp
          join matchup m on m.id = sp.matchup_id
          join league  l on l.id = m.league_id
          left join league_membership lm
                 on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
         where sp.player_slug is not null and sp.metric_id is null and sp.game_window <> 'classic'
         order by sp.locked desc, m.week desc
         limit lim
      ) r),
    -- One manager means a workflow slip; spread across many means a code path
    -- is writing nulls, which is a different and worse problem.
    'by_team', (
      select coalesce(jsonb_agg(t order by t.n desc), '[]'::jsonb)
      from (
        select l.name as league,
               coalesce(lm.team_name, left(sp.app_user_id::text, 8)) as team,
               coalesce(lm.controller, 'human') as controller,
               count(*)::int as n,
               count(*) filter (where sp.locked)::int as locked
          from sealed_pick sp
          join matchup m on m.id = sp.matchup_id
          join league  l on l.id = m.league_id
          left join league_membership lm
                 on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
         where sp.player_slug is not null and sp.metric_id is null and sp.game_window <> 'classic'
         group by l.name, coalesce(lm.team_name, left(sp.app_user_id::text, 8)), lm.controller
      ) t),
    -- An AGENT seat must never appear here: autoLineup always assigns a metric
    -- (DEFAULT_AI_METRIC; RB → 'rush'). If one does, something nulled it AFTER
    -- the worker wrote it, which is a different bug from a human who never
    -- picked — so it is counted separately rather than buried in the list.
    'agent_rows', (
      select count(*)::int
        from sealed_pick sp
        join matchup m on m.id = sp.matchup_id
        join league_membership lm on lm.league_id = m.league_id and lm.app_user_id = sp.app_user_id
       where sp.player_slug is not null and sp.metric_id is null
         and sp.game_window <> 'classic' and lm.controller = 'ai')
  ) into result;
  return result;
end $$;

grant execute on function admin_metricless_picks(int) to authenticated;
