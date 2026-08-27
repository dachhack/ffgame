-- 0247: A BYE IS NOT A ZERO.
--
-- Founder, on odd-sized leagues: "can we do byes throughout the schedule and
-- playoffs for leagues that have an odd number of teams?" — and, once the
-- damage was clear, "let's stop the bleeding."
--
-- Byes have always happened. 0064's circle method pads an odd league with a
-- ghost seat and skips that pair, so exactly one team has no matchup each
-- week. What never happened is anything DOWNSTREAM knowing about it. The
-- guillotine is where that costs a season:
--
--   the floor reads coalesce(<that week's final>, 0)
--
-- A team on bye has no matchup row, so it scores 0, so it is always the lowest
-- score, so it is executed — for not playing. In an odd guillotine league that
-- is not an edge case, it IS the season: the blade simply falls in bye order,
-- every week, until one team is left for reasons that have nothing to do with
-- fantasy football.
--
-- THE FIX IS TO SKIP, NOT TO IMPUTE. A byed team could be given the league
-- median, or last week's score, or a pass — all of those are rule changes and
-- belong in a design conversation. Not being eligible to die on a week you did
-- not play is not a rule change; it is what the rule already meant.
--
-- Left alone deliberately (fairness, not bleeding): the extra byes still land
-- on the lowest roster ids every season, and standings still sort on wins then
-- TOTAL points-for, which favours whoever played the extra game.

-- ── the floor ───────────────────────────────────────────────────────────────
-- 0221's body, with one change: pts is nullable now, and a null seat is not a
-- candidate. Everything else — the tie rules, the release logging, the waiver
-- kill, the week loop — is carried across untouched.
create or replace function guillotine_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; last_done int; victim int; vt numeric; alive int; done int := 0;
        sl record; nt text;
begin
  if league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', true, 'eliminated', 0);
  end if;
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':guillotine'));

  -- the last fully-final week of the regular season
  select max(week) into last_done from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if last_done is null then return jsonb_build_object('ok', true, 'eliminated', 0); end if;

  for wk in 1..last_done loop
    select count(*) into alive from league_membership
      where league_id = p_league_id and eliminated_week is null;
    exit when alive <= 1;
    continue when exists (select 1 from league_membership
      where league_id = p_league_id and eliminated_week = wk);

    -- the floor: lowest weekly total among teams alive right now; a tie dies
    -- by the weaker season (PF), then the higher seat number. A team with no
    -- matchup that week is ON BYE and cannot be the victim — `pts is null`
    -- rather than 0 is the whole of 0247.
    select t.rid, t.pts into victim, vt from (
      select m.sleeper_roster_id as rid,
             (select case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end
               from matchup mu where mu.league_id = p_league_id and mu.week = wk
                 and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
               limit 1) as pts,
             (select coalesce(sum(case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end), 0)
               from matchup mu where mu.league_id = p_league_id and mu.week <= wk and mu.status = 'final'
                 and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)) as season_pf
      from league_membership m
      where m.league_id = p_league_id and m.eliminated_week is null
    ) t where t.pts is not null
      order by t.pts asc, t.season_pf asc, t.rid desc limit 1;
    -- Nobody eligible (every survivor byed, or the week has no finals for the
    -- living): no blade this week. `exit` would end the season's catch-up
    -- loop early, so this skips the week and carries on.
    continue when victim is null;

    update league_membership set eliminated_week = wk
      where league_id = p_league_id and sleeper_roster_id = victim;
    -- a dead seat's pending claims die with it (a win after death would trip
    -- the seat guard mid-waiver-run)
    update waiver_claim set status = 'lost', note = 'team eliminated'
      where league_id = p_league_id and roster_id = victim and status = 'pending';

    -- the event itself, then the releases logged AS releases
    insert into league_txn (league_id, kind, roster_id, slug, note)
    values (p_league_id, 'elimination', victim, '', 'week ' || wk || ' — lowest score, ' || round(vt, 1));
    nt := 'guillotine week ' || wk;
    perform set_config('app.txn_kind', 'release', true);
    perform set_config('app.txn_note', nt, true);
    for sl in select slug from native_roster where league_id = p_league_id and roster_id = victim loop
      update league_pool set waived_until = waiver_hold_until(p_league_id)
        where league_id = p_league_id and slug = sl.slug;
      delete from native_roster where league_id = p_league_id and slug = sl.slug;
    end loop;
    perform set_config('app.txn_kind', '', true);
    perform set_config('app.txn_note', '', true);
    done := done + 1;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'eliminated', done);
end $$;
grant execute on function guillotine_tick(uuid) to authenticated;

-- ── the board that shows who is closest to the blade ────────────────────────
-- Same correction, for the same reason: a byed team pinned at 0.0 sits at the
-- top of the death list all week, telling everyone in the league — including
-- the team itself — that it is about to die. `pts` is null on a bye and the
-- seat sorts to the BOTTOM (nulls last), out of the danger it is not in.
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
        'roster_id', a.rid, 'team', a.team, 'pts', a.pts, 'bye', a.pts is null)
        order by a.pts asc nulls last, a.rid)
      from (
        select m.sleeper_roster_id as rid, m.team_name as team,
               (select case when mu.home_roster_id = m.sleeper_roster_id then mu.home_final else mu.away_final end
                 from matchup mu where mu.league_id = p_league_id and mu.week = cur_wk
                   and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id) limit 1) as pts
        from league_membership m
        where m.league_id = p_league_id and m.eliminated_week is null
      ) a), '[]'::jsonb),
    'fallen', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'week', m.eliminated_week)
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

-- ── the client needs to tell a bye from an unbuilt schedule ─────────────────
-- Both look identical from a seat: myMatchup returns nothing. The difference
-- is whether ANYONE plays that week, which no per-seat read can see — so the
-- one question a bye screen has to answer gets its own function rather than a
-- second round-trip and a guess.
--   'bye'      — the league plays this week, you do not
--   'playing'  — you have a game
--   'unbuilt'  — nobody has a game; the schedule is not made yet
create or replace function league_week_role(p_league_id uuid, p_roster_id int, p_week int)
  returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from matchup m where m.league_id = p_league_id and m.week = p_week
                   and p_roster_id in (m.home_roster_id, m.away_roster_id)) then 'playing'
    when exists (select 1 from matchup m where m.league_id = p_league_id and m.week = p_week) then 'bye'
    else 'unbuilt' end
  where is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin();
$$;
grant execute on function league_week_role(uuid, int, int) to authenticated;
