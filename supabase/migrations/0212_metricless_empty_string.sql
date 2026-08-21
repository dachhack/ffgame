-- 0212: the dead-seat audit also catches an EMPTY-STRING metric.
--
-- 0211 looked for `metric_id is null`. That is the obvious shape and not the
-- only one: '' is equally dead and equally invisible.
--
-- WHY '' IS REAL RATHER THAN THEORETICAL. The cards read the metric through
-- `metric?.name ?? p.metric_id ?? null`, and `??` falls through on null and
-- undefined ONLY — an empty string sails past it, arrives as '', and then fails
-- the `!!metricName` render test. The chip vanishes with no null anywhere in
-- sight, which is the hardest version of this bug to find. The engine itself
-- uses `metricId: ''` for the unopposed seat, so the value is in circulation.
--
-- Either way `scorePlay` matches no branch and returns 0: the seat is occupied
-- and scores nothing. An audit that catches one shape and not the other is
-- worse than none, because it answers "no dead seats" and is believed.
--
-- Body copied VERBATIM from 0211; every `metric_id is null` becomes
-- `_metric_missing(metric_id)`, and nothing else changes.

create or replace function _metric_missing(p_metric text) returns boolean
  language sql immutable set search_path = public as $$
  select p_metric is null or btrim(p_metric) = '';
$$;

create or replace function admin_metricless_picks(p_limit int default 200)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 200), 1), 500); total int; result jsonb;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select count(*) into total
    from sealed_pick sp
    where sp.player_slug is not null and _metric_missing(sp.metric_id) and sp.game_window <> 'classic';

  select jsonb_build_object(
    'ok', true,
    'total', total,
    'truncated', total > lim,
    'picks', (
      select coalesce(jsonb_agg(r order by r.locked desc, r.week desc, r.league), '[]'::jsonb)
      from (
        select l.name as league, m.week, sp.game_window as win, sp.roster_slot as slot,
               sp.player_slug, sp.locked,
               coalesce(lm.team_name, left(sp.app_user_id::text, 8)) as team,
               coalesce(lm.controller, 'human') as controller,
               (select count(*) from sealed_pick o
                 where o.matchup_id = sp.matchup_id and o.app_user_id = sp.app_user_id
                   and not _metric_missing(o.metric_id)) as sibling_slots_with_metric
          from sealed_pick sp
          join matchup m on m.id = sp.matchup_id
          join league  l on l.id = m.league_id
          left join league_membership lm
                 on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
         where sp.player_slug is not null and _metric_missing(sp.metric_id) and sp.game_window <> 'classic'
         order by sp.locked desc, m.week desc
         limit lim
      ) r),
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
         where sp.player_slug is not null and _metric_missing(sp.metric_id) and sp.game_window <> 'classic'
         group by l.name, coalesce(lm.team_name, left(sp.app_user_id::text, 8)), lm.controller
      ) t),
    'agent_rows', (
      select count(*)::int
        from sealed_pick sp
        join matchup m on m.id = sp.matchup_id
        join league_membership lm on lm.league_id = m.league_id and lm.app_user_id = sp.app_user_id
       where sp.player_slug is not null and _metric_missing(sp.metric_id)
         and sp.game_window <> 'classic' and lm.controller = 'ai')
  ) into result;
  return result;
end $$;

grant execute on function admin_metricless_picks(int) to authenticated;
