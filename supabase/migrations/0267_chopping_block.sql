-- 0267: THE CHOPPING BLOCK SEES LIVE, AND THE VAMPIRE KEEPS SCORE (v0.377.0).
--
-- Founder: "in the league home for guillotine leagues we need a chopping
-- block view … I need to be able to see how this works in a sim. We also
-- need a vampire view … that shows the vampire's wins and who they took from
-- their opponent."
--
-- Both format cards already exist on the league home (LeagueExtras, 0221/
-- 0222). What they cannot do is SHOW A WEEK IN FLIGHT:
--
--   • guillotine_state's alive.pts reads matchup home/away_final — null
--     until the week finals — so mid-week (and mid-SIM, which is the founder's
--     whole ask) every survivor rendered as a scoreless BYE and the blade
--     pointed nowhere. alive rows now also carry `live` (the seat's
--     matchup_state total, the same per-window banks the boards read) and an
--     honest `bye` (no matchup row this week — not "no final yet", which is
--     what 0247's `pts is null` actually tested). The cutline sorts by what
--     is known: final where the week finaled, live while it runs, byes last.
--   • fallen rows now carry `pts` — the score the team died on in its fatal
--     week — so the league home can show the chopped-by-week record instead
--     of a names-only afterthought.
--   • vampire_state grows `record` (H2H wins–losses over finaled weeks; a
--     tie is no win — the vampire feeds on wins, and a tie is not one) and
--     `weeks`: every finaled week's result for the vampire seat — opponent,
--     both totals, won — which the client zips with `steals` into the
--     feeding log: the wins, and who got bitten for whom.
--
-- BOTH BODIES ARE COPIED FROM THE LIVE DEFINITIONS (guillotine_state: 0247;
-- vampire_state: 0222) with only the additions above. guillotine_tick (0249)
-- is untouched — the blade already falls on the worker's sweep, which is why
-- a sim chops without anyone pressing anything; this migration only lets the
-- league home watch it happen.

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

-- vampire_state v2 (0222 + record/weeks).
create or replace function vampire_state(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare vamp int; wk int; mu matchup%rowtype; victim int; won boolean := false;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if league_format(p_league_id) <> 'vampire' then return jsonb_build_object('vampire', false); end if;
  vamp := vampire_seat(p_league_id);
  select max(week) into wk from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if vamp is not null and wk is not null then
    select * into mu from matchup
      where league_id = p_league_id and week = wk
        and vamp in (home_roster_id, away_roster_id) limit 1;
    if found then
      won := case when mu.home_roster_id = vamp then mu.home_final > mu.away_final
                  else mu.away_final > mu.home_final end;
      victim := case when mu.home_roster_id = vamp then mu.away_roster_id else mu.home_roster_id end;
    end if;
  end if;
  return jsonb_build_object(
    'vampire', true,
    'seat', vamp,
    'seat_team', (select team_name from league_membership
      where league_id = p_league_id and sleeper_roster_id = vamp),
    'steal_review', steal_review_on(p_league_id),
    'week', wk,
    'won', won,
    'victim', case when won then victim end,
    'fed', wk is not null and exists (select 1 from vampire_steal
      where league_id = p_league_id and week = wk and status in ('pending', 'executed')),
    -- Every finaled week from the vampire's chair (0267): opponent, both
    -- totals, and whether there was blood. A tie is not a win.
    -- NOTE the alias: `mx`, never `mu` — `mu` is this function's matchup
    -- rowtype variable and plpgsql substitutes it inside the SQL, making
    -- `mu.week` ambiguous the moment the table wears the same name.
    'weeks', coalesce((select jsonb_agg(jsonb_build_object(
        'week', w.week, 'opp', w.opp, 'opp_team', om.team_name,
        'for', w.pf, 'against', w.pa, 'won', w.pf > w.pa) order by w.week desc)
      from (
        select mx.week,
               case when mx.home_roster_id = vamp then mx.away_roster_id else mx.home_roster_id end as opp,
               case when mx.home_roster_id = vamp then mx.home_final else mx.away_final end as pf,
               case when mx.home_roster_id = vamp then mx.away_final else mx.home_final end as pa
        from matchup mx
        where mx.league_id = p_league_id and vamp in (mx.home_roster_id, mx.away_roster_id)
          and mx.status = 'final' and mx.home_final is not null and mx.away_final is not null
      ) w left join league_membership om
        on om.league_id = p_league_id and om.sleeper_roster_id = w.opp), '[]'::jsonb),
    'record', (select jsonb_build_object(
        'wins',   count(*) filter (where (case when mx.home_roster_id = vamp then mx.home_final else mx.away_final end)
                                       > (case when mx.home_roster_id = vamp then mx.away_final else mx.home_final end)),
        'losses', count(*) filter (where (case when mx.home_roster_id = vamp then mx.home_final else mx.away_final end)
                                      <= (case when mx.home_roster_id = vamp then mx.away_final else mx.home_final end)))
      from matchup mx
      where mx.league_id = p_league_id and vamp in (mx.home_roster_id, mx.away_roster_id)
        and mx.status = 'final' and mx.home_final is not null and mx.away_final is not null),
    'steals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'week', v.week, 'victim', v.victim,
        'victim_team', (select team_name from league_membership
          where league_id = p_league_id and sleeper_roster_id = v.victim),
        'take', v.take_slug, 'give', v.give_slug, 'status', v.status) order by v.week desc)
      from vampire_steal v where v.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function vampire_state(uuid) to authenticated;
