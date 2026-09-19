-- 0301 — THE GUILLOTINE READS THE SEASON, NOT THE PRACTICE WEEKS (v0.428.0)
--
-- The same hole 0297 closed for the vampire: guillotine_tick's "last fully-
-- final week" was `max(week)` over the league's matchups, and the preseason
-- practice weeks (0110: 101-103) are final rows above every regular week.
-- Two consequences in a league that played its practice weeks:
--
--   • `last_done` read 103 all season, so the catch-up loop `for wk in
--     1..last_done` walked every week to 103 — harmless for weeks with no
--     finals (the victim query finds nobody and `continue`s), but a practice
--     week WITH finals is a week the blade could drop on. Practice results
--     are throwaway; nobody should lose their season to one.
--   • The season-PF tiebreak summed `mu.week <= wk`, which for a regular
--     week never reaches 101+, so it was already right by accident.
--
-- One filter, in the window and in the loop's candidate weeks: practice
-- weeks are not the season. Body is 0249's, re-read; only the filter added.
create or replace function guillotine_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; last_done int; victim int; vt numeric; alive int; done int := 0;
        sl record; nt text;
begin
  if league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', true, 'eliminated', 0);
  end if;
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':guillotine'));

  -- the last fully-final week of the REGULAR season (0301: never a practice week)
  select max(week) into last_done from matchup m
  where m.league_id = p_league_id
    and not is_practice_week(m.week)
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if last_done is null then return jsonb_build_object('ok', true, 'eliminated', 0); end if;

  for wk in 1..last_done loop
    exit when is_practice_week(wk);
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
