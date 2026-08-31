-- 0271: THE CHOPPING BLOCK KEEPS HISTORY (v0.384.0).
--
-- Founder: "let's have the chopping block keep history. So you can select
-- each week and it's result."
--
-- The block could only ever show NOW: `alive` is this week's cutline and
-- `fallen` is a names-and-fatal-score list. Neither answers "what did week 3
-- look like" — who was still in it, what everyone scored, how close the
-- survivors came to the floor. That record already exists in matchup finals
-- and eliminated_week; nothing was reading it back.
--
-- guillotine_state grows `history`: one entry per FULLY-FINAL regular week
-- (practice and playoff weeks excluded — the same rule league_standings uses),
-- newest first, each carrying
--
--   • the week's whole living field — every seat that had NOT yet been chopped
--     going into it (eliminated_week null or >= that week), which is exactly
--     the field the blade chose from;
--   • each seat's final for the week, `bye` where it had no matchup row, and
--     `chopped` on the one the blade took, sorted by score ascending so the
--     floor reads first — the cutline order `alive` already uses;
--   • the chopped seat hoisted to the entry (`chopped` / `chopped_team`) so a
--     client can label a week without walking its rows.
--
-- A seat chopped in week N still appears IN week N (it played, it scored, it
-- fell) and is gone from N+1. That is the whole point: the week you died is
-- the week you are most worth looking at.
--
-- BODY COPIED FROM 0267, THE LIVE DEFINITION — the `history` key and this
-- header are the only changes. guillotine_tick is untouched.
create or replace function guillotine_state(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare cur_wk int; champ int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('guillotine', false);
  end if;
  -- the week in progress: first week not yet fully final
  select min(week) into cur_wk from matchup m
  where m.league_id = p_league_id
    and exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if (select count(*) from league_membership
      where league_id = p_league_id and eliminated_week is null) = 1 then
    select sleeper_roster_id into champ from league_membership
      where league_id = p_league_id and eliminated_week is null;
  end if;
  return jsonb_build_object(
    'guillotine', true,
    'week', cur_wk,
    'champion', champ,
    'alive', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', a.rid, 'team', a.team, 'pts', a.pts, 'live', a.live, 'bye', a.bye)
        order by coalesce(a.pts, a.live) asc nulls last, a.rid)
      from (
        select m.sleeper_roster_id as rid, m.team_name as team,
               (select case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end
                 from matchup mu where mu.league_id = p_league_id and mu.week = cur_wk
                   and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id) limit 1) as pts,
               -- the week in flight: the seat's per-window banks, summed —
               -- the same rows the live boards read. Null on a true bye.
               (select round(sum(case when mu.home_roster_id = m.sleeper_roster_id
                                      then ms.home_score else ms.away_score end)::numeric, 1)
                 from matchup mu join matchup_state ms on ms.matchup_id = mu.id
                 where mu.league_id = p_league_id and mu.week = cur_wk
                   and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)) as live,
               not exists (select 1 from matchup mu
                 where mu.league_id = p_league_id and mu.week = cur_wk
                   and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)) as bye
        from league_membership m
        where m.league_id = p_league_id and m.eliminated_week is null
      ) a), '[]'::jsonb),
    -- 0271: THE SEASON, WEEK BY WEEK. Every fully-final regular week, newest
    -- first, with the field as it stood that week.
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'week', h.wk,
        'chopped', h.chopped,
        'chopped_team', h.chopped_team,
        'teams', h.teams) order by h.wk desc)
      from (
        select w.wk,
               (select m2.sleeper_roster_id from league_membership m2
                 where m2.league_id = p_league_id and m2.eliminated_week = w.wk limit 1) as chopped,
               (select m2.team_name from league_membership m2
                 where m2.league_id = p_league_id and m2.eliminated_week = w.wk limit 1) as chopped_team,
               (select jsonb_agg(jsonb_build_object(
                   'roster_id', t.rid, 'team', t.team, 'pts', t.pts,
                   'bye', t.bye, 'chopped', t.chopped)
                   order by t.pts asc nulls last, t.rid)
                 from (
                   select m3.sleeper_roster_id as rid, m3.team_name as team,
                          (select case when mu.home_roster_id = m3.sleeper_roster_id
                                       then mu.home_final else mu.away_final end
                            from matchup mu where mu.league_id = p_league_id and mu.week = w.wk
                              and m3.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
                            limit 1) as pts,
                          -- a seat with no matchup row that week sat it out —
                          -- the same honest bye `alive` carries, never a zero
                          not exists (select 1 from matchup mu
                            where mu.league_id = p_league_id and mu.week = w.wk
                              and m3.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)) as bye,
                          coalesce(m3.eliminated_week = w.wk, false) as chopped
                   from league_membership m3
                   where m3.league_id = p_league_id
                     -- the field the blade chose from: still alive going in
                     and (m3.eliminated_week is null or m3.eliminated_week >= w.wk)
                 ) t) as teams
        from (
          select distinct mx.week as wk from matchup mx
          where mx.league_id = p_league_id and not mx.is_playoff
            and not is_practice_week(mx.week)
            and not exists (select 1 from matchup m4
              where m4.league_id = p_league_id and m4.week = mx.week
                and (m4.status <> 'final' or m4.home_final is null or m4.away_final is null))
        ) w
      ) h), '[]'::jsonb),
    'fallen', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'week', m.eliminated_week,
        -- the score the blade fell on
        'pts', (select case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end
                 from matchup mu where mu.league_id = p_league_id and mu.week = m.eliminated_week
                   and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id) limit 1))
        order by m.eliminated_week)
      from league_membership m
      where m.league_id = p_league_id and m.eliminated_week is not null), '[]'::jsonb),
    'frenzy', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', lp.slug, 'full_name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
        'rank', lp.rank, 'clears_at', lp.waived_until) order by lp.rank)
      from league_pool lp
      where lp.league_id = p_league_id and lp.waived_until > now()
        and not exists (select 1 from native_roster nr
          where nr.league_id = p_league_id and nr.slug = lp.slug)), '[]'::jsonb));
end $$;
grant execute on function guillotine_state(uuid) to authenticated;
