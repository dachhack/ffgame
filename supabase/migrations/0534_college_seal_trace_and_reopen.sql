-- ═══════════════════════════════════════════════════════════════════════════
-- 0534 — THE COLLEGE SEAL EXPLAINS ITSELF, AND UNDOES ITS OWN EARLY SEALS
--
-- On Tue Nov 17, between 20:18 and 20:28 UTC, seal_due_college_picks sealed
-- every week-212 pick in one college league, game by game, a few each tick,
-- days before those games (0533 reopened them). The rule can only seal a pick
-- when the kickoff it reads is not in the future, and it reads correctly now:
-- so for ten minutes it read something else, and nothing kept what it read.
-- The slate has no history (the tick rewrites it), so the cause is NOT known.
--
-- Two things, both inside the rule the worker already calls every tick:
--
--   1. A TRACE. Each pick the rule seals leaves one row in college_seal_trace:
--      the kickoff the rule used, the week's first kickoff, the player's
--      school, whether his pool row carries a team, and the slate rows for his
--      school that week as they stood in that statement. The next early seal
--      names its own cause.
--   2. A WAY BACK. Before sealing, the rule reopens any pick IT sealed (a
--      trace row, not yet reopened) whose kickoff is ahead again. Only its own
--      seals: a commissioner's or a simulation's lock leaves no trace row and
--      is never touched. A pick sealed at a real kickoff is never ahead again.
--
-- The trace is the worker's and an admin's to read; no member policy.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists college_seal_trace (
  id            bigint generated always as identity primary key,
  sealed_at     timestamptz not null default now(),
  pick_id       uuid not null,
  matchup_id    uuid not null,
  week          int  not null,
  player_slug   text not null,
  school_abbr   text,
  own_kickoff   timestamptz,          -- classic_player_kickoff at the seal
  week_kickoff  timestamptz,          -- window_kickoff(week,'wk') at the seal
  pool_team     text,                 -- league_pool.team ('' = blank, null = no row)
  slate         jsonb,                -- the school's slate rows that week, as read
  reopened_at   timestamptz,          -- set when the rule took this seal back
  reopen_kickoff timestamptz
);
create index if not exists college_seal_trace_open on college_seal_trace (week, pick_id) where reopened_at is null;
alter table college_seal_trace enable row level security;
drop policy if exists college_seal_trace_admin on college_seal_trace;
create policy college_seal_trace_admin on college_seal_trace for select using (is_admin());

create or replace function seal_due_college_picks(p_week int)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- 2. THE WAY BACK: this rule's own seals whose game is ahead again.
  with back as (
    select t.id as trace_id, sp.id as pick_id,
           classic_kickoff_for(m.league_id, m.week, sp.player_slug) as kick
      from college_seal_trace t
      join sealed_pick sp on sp.id = t.pick_id and sp.locked and sp.game_window = 'wk'
                         and sp.player_slug = t.player_slug
      join matchup m on m.id = sp.matchup_id and m.week = p_week and m.status in ('scheduled', 'live')
     where t.week = p_week and t.reopened_at is null
  ), opened as (
    update sealed_pick s set locked = false, revealed_at = null
      from back where s.id = back.pick_id and back.kick > now()
    returning s.id
  )
  update college_seal_trace t set reopened_at = now(), reopen_kickoff = back.kick
    from back join opened on opened.id = back.pick_id
   where t.id = back.trace_id;

  -- 1. THE SEAL, as 0372 wrote it, now leaving what it read.
  with due as (
    select sp.id, sp.matchup_id, sp.player_slug, m.league_id,
           classic_player_kickoff(sp.matchup_id, sp.player_slug) as own_kick,
           window_kickoff(p_week, 'wk') as week_kick
      from sealed_pick sp
      join matchup m on m.id = sp.matchup_id and m.week = p_week
     where sp.game_window = 'wk' and not sp.locked
       and sp.player_slug ~ '^c-[0-9]+$'
       and classic_pick_lock(sp.matchup_id, sp.player_slug, window_kickoff(p_week, 'wk')) <= now()
  ), sealed as (
    update sealed_pick sp set locked = true, revealed_at = now()
      from due where sp.id = due.id and not sp.locked
    returning sp.id
  ), traced as (
    insert into college_seal_trace (pick_id, matchup_id, week, player_slug, school_abbr, own_kickoff, week_kickoff, pool_team, slate)
    select due.id, due.matchup_id, p_week, due.player_slug, cp.school_abbr, due.own_kick, due.week_kick,
           (select p.team from league_pool p where p.league_id = due.league_id and p.slug = due.player_slug limit 1),
           (select jsonb_agg(jsonb_build_object('season', s.season, 'week', s.week, 'home', s.home, 'away', s.away,
                                                'kickoff', s.kickoff, 'game_id', s.game_id, 'tbd', s.time_tbd,
                                                'updated_at', s.updated_at) order by s.kickoff)
              from nfl_slate s
             where s.week between 201 and 223 and cp.school_abbr is not null
               and (upper(s.home) = upper(cp.school_abbr) or upper(s.away) = upper(cp.school_abbr))
               and (s.week = p_week or s.kickoff between now() - interval '8 days' and now() + interval '8 days'))
      from due
      join sealed on sealed.id = due.id
      left join college_player cp on cp.espn_id = substr(due.player_slug, 3)
    returning 1
  )
  select count(*) into n from traced;
  return n;
end $$;
revoke all on function seal_due_college_picks(int) from public, anon, authenticated;
grant execute on function seal_due_college_picks(int) to service_role;

-- 3. THE SLATE KEEPS ITS KICKOFF CHANGES (college weeks). The tick rewrites
-- every game's kickoff from the scoreboard; a kickoff that moved, even for one
-- tick, now leaves a line. A handful of rows a week (TV times being set).
create table if not exists slate_kickoff_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  season    text not null,
  week      int  not null,
  home      text not null,
  away      text,
  game_id   text,
  was       timestamptz,
  now_is    timestamptz
);
alter table slate_kickoff_log enable row level security;
drop policy if exists slate_kickoff_log_admin on slate_kickoff_log;
create policy slate_kickoff_log_admin on slate_kickoff_log for select using (is_admin());

create or replace function _log_slate_kickoff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kickoff is distinct from old.kickoff then
    insert into slate_kickoff_log (season, week, home, away, game_id, was, now_is)
      values (new.season, new.week, new.home, new.away, new.game_id, old.kickoff, new.kickoff);
  end if;
  return new;
end $$;
drop trigger if exists log_slate_kickoff on nfl_slate;
create trigger log_slate_kickoff after update of kickoff on nfl_slate
  for each row when (new.week between 201 and 223) execute function _log_slate_kickoff();
