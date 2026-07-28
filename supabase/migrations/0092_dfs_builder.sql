-- 0092: DFS-STYLE TEAM BUILDING for pods + weekly showdowns.
--
-- Replaces the random weekly deal: players BUILD their squad under a salary
-- cap, DFS-style. The worker snapshots one salary board per week
-- (pod_salary — weekly projections → salaries, frozen once written so the
-- cap math never shifts under a part-built entry), the client renders the
-- builder from it, and save_pod_entry() validates an entry server-side
-- (membership, week, lock, roster shape, cap) before writing the seat's
-- sleeper_lineup row — the same row the deal used to write, so lock →
-- resolve → live board are untouched. AI seats and no-show humans get a
-- seeded auto-build from the same board (server/src/pods.js).

create table if not exists pod_salary (
  season text    not null,
  week   int     not null,
  slug   text    not null,   -- engine slug ('<team>-k' / '<team>-dst' for K/DST)
  name   text    not null,
  pos    text    not null check (pos in ('QB','RB','WR','TE','K','DEF')),
  team   text    not null default '',
  salary int     not null,
  proj   numeric not null default 0,
  primary key (season, week, slug)
);
alter table pod_salary enable row level security;
-- The board is public game data (no hidden info); writes are service-only.
create policy pod_salary_read on pod_salary for select using (true);

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

  -- Locked once the seat's matchup has sealed (kickoff passed / live / final).
  if exists (
    select 1 from matchup m
      where m.league_id = p_league and m.week = p_week
        and (m.home_roster_id = seat.sleeper_roster_id or m.away_roster_id = seat.sleeper_roster_id)
        and (m.status <> 'scheduled' or (m.lock_at is not null and m.lock_at <= now()))
  ) then
    return jsonb_build_object('ok', false, 'error', 'this week is locked');
  end if;

  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) <> 9 then
    return jsonb_build_object('ok', false, 'error', 'an entry is exactly 9 players');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_picks)) <> 9 then
    return jsonb_build_object('ok', false, 'error', 'duplicate player in entry');
  end if;

  -- Join picks to this week's salary board; unknown slugs simply don't join.
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

  -- Materialize in board order (QB→RB→WR→TE→K→DEF, salary desc) as the same
  -- starters_json shape the weekly sync writes.
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

grant execute on function save_pod_entry(uuid, int, jsonb, text) to authenticated;
