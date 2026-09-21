-- 0314: A MID-WEEK PICKUP JOINS THE LIVE WEEK'S POOL (v0.434.4).
--
-- Mooney's Rehab Facility, Kickoff League, Sunday night: "confused on why it
-- doesn't look like Coleman counted for my rookie best ball spot. App is
-- showing me it counted Chris Bell who had 0 today … waivers look like they
-- processed at 2 pm so I guess he didn't count on my roster before he
-- played." Founder: "That's unintended."
--
-- native_materialize (0064) rewrites a week's pool (sleeper_lineup) from the
-- current rosters — for weeks whose every matchup is still 'scheduled'. The
-- moment a week's first game kicks off it stops touching that week, so a
-- Sunday waiver win never reaches the week's pool: the boards, which read
-- the pool, cannot show him in the picker or in their best-ball preview, and
-- the widget cannot either. (The resolver reads native_roster directly, so
-- the SCORE can still count him; the screens said otherwise.)
--
-- The freeze was there for a reason: a rewrite drops players the seat no
-- longer holds, and a dropped man who already played must stay on a board
-- that has his sealed pick. So a LIVE week is refreshed ADD-ONLY: every
-- active-roster player not yet in the week's pool is appended, and nothing
-- already there is removed. Final weeks are never touched; scheduled weeks
-- are rewritten as before.
create or replace function native_materialize(p_league_id uuid)
  returns int language plpgsql security definer set search_path = public as $$
declare wk int; n int := 0;
begin
  if not is_native_league(p_league_id) then return 0; end if;
  -- Scheduled weeks: the full rewrite, as before.
  for wk in
    select m.week from matchup m where m.league_id = p_league_id
    group by m.week
    having bool_and(m.status = 'scheduled')
  loop
    delete from sleeper_lineup where league_id = p_league_id and week = wk;
    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    select p_league_id, wk, t.roster_id,
           jsonb_agg(jsonb_build_object(
             'slot', t.slot, 'slug', t.slug, 'player_slug', t.slug,
             'full', t.full_name, 'pos', t.pos, 'team', t.team
           ) order by t.slot)
    from (
      select nr.roster_id, nr.slug, lp.full_name, lp.pos, lp.team,
             row_number() over (partition by nr.roster_id order by lp.rank) as slot
      from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      where nr.league_id = p_league_id
    ) t
    group by t.roster_id;
    n := n + 1;
  end loop;
  -- Live weeks (0314): add-only. A seat's active players missing from its
  -- week row are appended after what is there; a seat with no row yet gets
  -- one. Nothing is removed.
  for wk in
    select m.week from matchup m where m.league_id = p_league_id
    group by m.week
    having bool_or(m.status = 'live') and not bool_and(m.status = 'final')
  loop
    with cur as (
      select nr.roster_id, nr.slug, lp.full_name, lp.pos, lp.team, lp.rank
      from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      where nr.league_id = p_league_id and nr.spot = 'active'
    ),
    have as (
      select sl.roster_id, coalesce(e ->> 'slug', e ->> 'player_slug') as slug
      from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
      where sl.league_id = p_league_id and sl.week = wk
    ),
    missing as (
      select c.* from cur c
      where not exists (select 1 from have h where h.roster_id = c.roster_id and h.slug = c.slug)
    ),
    appended as (
      select m.roster_id,
             jsonb_agg(jsonb_build_object(
               'slot', 0, 'slug', m.slug, 'player_slug', m.slug,
               'full', m.full_name, 'pos', m.pos, 'team', m.team,
               'added', true
             ) order by m.rank) as rows
      from missing m group by m.roster_id
    )
    insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    select p_league_id, wk, a.roster_id, a.rows from appended a
    on conflict (league_id, week, roster_id) do update
      set starters_json = coalesce(sleeper_lineup.starters_json, '[]'::jsonb) || excluded.starters_json;
    n := n + 1;
  end loop;
  return n;
end $$;
