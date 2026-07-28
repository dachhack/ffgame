-- 0093: PER-GAME LATE SWAP for pod/showdown entries.
--
-- 0092 locked the whole entry at the week's first kickoff — build by Thursday
-- night or live with the autofill. The game's rule (and the board's existing
-- per-window seal) is finer-grained, so entries now lock PER GAME, one hour
-- before each player's own kickoff:
--   • a pick whose game is locked is FROZEN — it cannot leave the entry
--   • a player whose game is locked cannot be ADDED
--   • everything else swaps freely all week (DFS late swap)
-- Game lock times come from nfl_slate (kickoff − 1h) via the pick's
-- pod_salary.team. A game with no known kickoff never locks a pick (the
-- board is slate-gated, so this only happens on missing slate data — fail
-- open for the player). The seat's week closes for edits only at FINAL.

create or replace function save_pod_entry(p_league uuid, p_week int, p_picks jsonb, p_season text default '2026')
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  seat  league_membership%rowtype;
  lg    league%rowtype;
  cap   int := 50000;
  spent int;
  n_qb int; n_rb int; n_wr int; n_te int; n_k int; n_def int; n_all int;
  lineup jsonb;
  old_picks jsonb;
  frozen text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into lg from league where id = p_league;
  if not found or lg.kind not in ('pod', 'weekly') then
    return jsonb_build_object('ok', false, 'error', 'not a pod league');
  end if;
  if lg.kind = 'weekly' and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this showdown');
  end if;

  select m.* into seat from league_membership m
    where m.league_id = p_league and m.app_user_id = auth.uid() and m.enrolled
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not in this pod');
  end if;

  -- Edits close only when the seat's week is decided (per-game locks below
  -- govern everything before that — late swap through Sunday and Monday).
  if exists (
    select 1 from matchup m
      where m.league_id = p_league and m.week = p_week
        and (m.home_roster_id = seat.sleeper_roster_id or m.away_roster_id = seat.sleeper_roster_id)
        and m.status = 'final'
  ) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;

  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) <> 9 then
    return jsonb_build_object('ok', false, 'error', 'an entry is exactly 9 players');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_picks)) <> 9 then
    return jsonb_build_object('ok', false, 'error', 'duplicate player in entry');
  end if;

  select starters_json into old_picks from sleeper_lineup
    where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;

  -- FROZEN: a saved pick whose game locked (kickoff − 1h passed) must stay.
  select string_agg(s.name, ', ') into frozen
    from jsonb_array_elements(coalesce(old_picks, '[]'::jsonb)) e
    join pod_salary s on s.season = p_season and s.week = p_week and s.slug = e->>'player_slug'
    where exists (
      select 1 from nfl_slate g
        where g.season = p_season and g.week = p_week
          and (g.home = s.team or g.away = s.team)
          and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
      and not (p_picks ? (e->>'player_slug'));
  if frozen is not null then
    return jsonb_build_object('ok', false, 'error', 'locked in — can''t drop ' || frozen);
  end if;

  -- ADDS: a pick not already in the entry must come from a game that hasn't
  -- locked (you can't buy a player an hour before — or after — he plays).
  select string_agg(s.name, ', ') into frozen
    from jsonb_array_elements_text(p_picks) p(slug)
    join pod_salary s on s.season = p_season and s.week = p_week and s.slug = p.slug
    where not exists (
        select 1 from jsonb_array_elements(coalesce(old_picks, '[]'::jsonb)) e
          where e->>'player_slug' = p.slug)
      and exists (
        select 1 from nfl_slate g
          where g.season = p_season and g.week = p_week
            and (g.home = s.team or g.away = s.team)
            and g.kickoff is not null and g.kickoff - interval '1 hour' <= now());
  if frozen is not null then
    return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || frozen);
  end if;

  select count(*), coalesce(sum(s.salary), 0),
         count(*) filter (where s.pos = 'QB'), count(*) filter (where s.pos = 'RB'),
         count(*) filter (where s.pos = 'WR'), count(*) filter (where s.pos = 'TE'),
         count(*) filter (where s.pos = 'K'),  count(*) filter (where s.pos = 'DEF')
    into n_all, spent, n_qb, n_rb, n_wr, n_te, n_k, n_def
    from jsonb_array_elements_text(p_picks) p(slug)
    join pod_salary s on s.season = p_season and s.week = p_week and s.slug = p.slug;

  if n_all <> 9 then
    return jsonb_build_object('ok', false, 'error', 'a pick is not on this week''s board');
  end if;
  if n_qb <> 1 or n_rb <> 2 or n_wr <> 3 or n_te <> 1 or n_k <> 1 or n_def <> 1 then
    return jsonb_build_object('ok', false, 'error', 'lineup shape is QB·RB·RB·WR·WR·WR·TE·K·DST');
  end if;
  if spent > cap then
    return jsonb_build_object('ok', false, 'error', 'over the salary cap');
  end if;

  select jsonb_agg(jsonb_build_object('slot', rn - 1, 'sleeper_id', null, 'player_slug', s.slug, 'pos', s.pos))
    into lineup
    from (
      select s.*, row_number() over (
        order by array_position(array['QB','RB','WR','TE','K','DEF'], s.pos), s.salary desc, s.slug) rn
      from jsonb_array_elements_text(p_picks) p(slug)
      join pod_salary s on s.season = p_season and s.week = p_week and s.slug = p.slug
    ) s;

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;

  return jsonb_build_object('ok', true, 'spent', spent, 'cap', cap, 'roster_id', seat.sleeper_roster_id);
end $$;
