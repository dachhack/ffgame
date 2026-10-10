-- 0462: DFS BULLSEYE (v0.660.0). Spec: docs/dfs-bullseye.md.
--
-- Founder: "we need to build a dfs-style version of bullseye." Chosen: an open
-- weekly contest anyone signed in can enter (one leaderboard) AND a Bullseye
-- switch for private salary-cap leagues (head-to-head, standings); SLOTS or
-- TOTAL picked per contest; the $50k cap on the frozen weekly salary board.
--
-- Both carry settings_json { dfs_bullseye: true, bullseye, bullseye_radius }.
-- The worker deals the card (classic Bullseye's dealer, seeded per league and
-- week, so every client deals the same numbers) and scores the squads (its
-- dfs_bullseye resolver branch). This file is the containers, the entries,
-- the board and the two switches.

alter table league drop constraint if exists league_kind_check;
alter table league add constraint league_kind_check check (kind in ('league', 'pod', 'weekly', 'dfs', 'bullseye'));
-- One open contest per NFL week.
create unique index if not exists league_bullseye_contest_week on league (season, contest_week) where kind = 'bullseye';

-- ── the squad's slots ───────────────────────────────────────────────────────
-- The contest shape (QB·RB·RB·WR·WR·WR·TE·K·DST, 0092) with a NAME per slot,
-- because under SLOTS which back aims at the 15 and which at the 5 is the game.
create or replace function _dfs_slot_pos(p_slot text) returns text
  language sql immutable as $$
  select case p_slot when 'QB' then 'QB' when 'RB1' then 'RB' when 'RB2' then 'RB'
    when 'WR1' then 'WR' when 'WR2' then 'WR' when 'WR3' then 'WR'
    when 'TE' then 'TE' when 'K' then 'K' when 'DEF' then 'DEF' end
$$;
create or replace function _dfs_slots() returns text[]
  language sql immutable as $$ select array['QB','RB1','RB2','WR1','WR2','WR3','TE','K','DEF'] $$;

-- The NFL week being played, or about to be: join_weekly's rule (0090).
create or replace function _contest_week(p_season text) returns int
  language sql stable security definer set search_path = public as $$
  select week from nfl_slate
   where season = p_season and kickoff is not null and week between 1 and 22
   group by week having max(kickoff) + interval '4 hours' > now()
   order by min(kickoff) limit 1
$$;

-- When a week's contest locks entirely is per player; its scoring row locks
-- at the week's first kickoff less the usual hour (pods' lockAt).
create or replace function _week_first_lock(p_season text, p_week int) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select min(kickoff) - interval '1 hour' from nfl_slate
   where season = p_season and week = p_week and kickoff is not null
$$;

-- The week's open contest, made the first time anyone asks.
create or replace function _ensure_bullseye_contest(p_season text, p_week int) returns uuid
  language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select id into lid from league where kind = 'bullseye' and season = p_season and contest_week = p_week;
  if lid is not null then return lid; end if;
  insert into league (sleeper_league_id, season, name, kind, contest_week, kdst_mode, provider, lineup_policy, settings_json)
  values ('BULL-' || p_season || '-' || p_week, p_season, 'Week ' || p_week || ' Bullseye', 'bullseye', p_week,
          'off', 'pod', 'empty', jsonb_build_object('dfs_bullseye', true, 'bullseye', 'slots', 'bullseye_radius', 10))
  on conflict do nothing
  returning id into lid;
  if lid is null then
    select id into lid from league where kind = 'bullseye' and season = p_season and contest_week = p_week;
  end if;
  return lid;
end $$;

-- ── the open contest, as a screen needs it ─────────────────────────────────
create or replace function bullseye_contest(p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; lid uuid; lg league; me league_membership; lock_at timestamptz; n int; entered boolean := false;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  wk := _contest_week(p_season);
  if wk is null then return jsonb_build_object('ok', false, 'error', 'no NFL week on the slate right now'); end if;
  lid := _ensure_bullseye_contest(p_season, wk);
  select * into lg from league where id = lid;
  select * into me from league_membership where league_id = lid and app_user_id = auth.uid() limit 1;
  if me.id is not null then
    entered := exists (select 1 from sleeper_lineup where league_id = lid and week = wk and roster_id = me.sleeper_roster_id);
  end if;
  select count(*) into n from sleeper_lineup where league_id = lid and week = wk;
  lock_at := _week_first_lock(p_season, wk);
  return jsonb_build_object('ok', true, 'season', p_season, 'week', wk, 'league_id', lid, 'name', lg.name,
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'entries', n, 'first_lock', lock_at, 'started', lock_at is not null and lock_at <= now(),
    'me', case when me.id is null then null else jsonb_build_object('roster_id', me.sleeper_roster_id, 'team', me.team_name, 'entered', entered) end);
end $$;

-- Take a seat in this week's contest. No limit: the next seat number.
create or replace function join_bullseye_contest(p_team_name text default null, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; lid uuid; me league_membership; rid int; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  wk := _contest_week(p_season);
  if wk is null then return jsonb_build_object('ok', false, 'error', 'no NFL week on the slate right now'); end if;
  lid := _ensure_bullseye_contest(p_season, wk);
  select * into me from league_membership where league_id = lid and app_user_id = auth.uid() limit 1;
  if me.id is not null then
    return jsonb_build_object('ok', true, 'already', true, 'league_id', lid, 'week', wk, 'roster_id', me.sleeper_roster_id);
  end if;
  perform pg_advisory_xact_lock(hashtext('bullseye-seat|' || lid::text));
  select coalesce(max(sleeper_roster_id), 0) + 1 into rid from league_membership where league_id = lid;
  nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''),
                 (select nullif(btrim(display_name), '') from app_user where id = auth.uid()),
                 (select split_part(email, '@', 1) from app_user where id = auth.uid()),
                 'Team ' || rid);
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
  values (lid, rid, 'BULL-' || rid, auth.uid(), true, nm, 'human');
  return jsonb_build_object('ok', true, 'league_id', lid, 'week', wk, 'roster_id', rid, 'team', nm);
end $$;

-- ── a squad ─────────────────────────────────────────────────────────────────
-- p_slots: {"QB": slug, "RB1": slug, …} — all nine. Every rule save_pod_entry
-- (0093/0094) enforces, plus the slot each player sits in: a locked player
-- can't leave his slot, and an empty slot can't take a locked player.
create or replace function save_bullseye_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; cap int := 50000; spent int; n int; bad text; old jsonb; lineup jsonb; lk timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or lg.kind not in ('bullseye', 'dfs') or coalesce((lg.settings_json ->> 'dfs_bullseye')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not a Bullseye contest');
  end if;
  if lg.kind = 'bullseye' and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  select * into seat from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this contest'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final'
               and seat.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;
  if jsonb_typeof(p_slots) <> 'object' then return jsonb_build_object('ok', false, 'error', 'a squad is nine named slots'); end if;
  select string_agg(k, ', ') into bad from jsonb_object_keys(p_slots) k where not (k = any (_dfs_slots()));
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'unknown slot: ' || bad); end if;
  select string_agg(s, ', ') into bad from unnest(_dfs_slots()) s where coalesce(p_slots ->> s, '') = '';
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'fill every slot — missing ' || bad); end if;
  if (select count(distinct value) from jsonb_each_text(p_slots)) <> 9 then
    return jsonb_build_object('ok', false, 'error', 'a player can only fill one slot');
  end if;

  -- on the board, in a slot his position fits
  select count(*), coalesce(sum(ps.salary), 0) into n, spent
    from jsonb_each_text(p_slots) e join pod_salary ps on ps.season = p_season and ps.week = p_week and ps.slug = e.value;
  if n <> 9 then return jsonb_build_object('ok', false, 'error', 'a pick is not on this week''s board'); end if;
  select string_agg(ps.name || ' (' || ps.pos || ') can''t play ' || e.key, '; ') into bad
    from jsonb_each_text(p_slots) e join pod_salary ps on ps.season = p_season and ps.week = p_week and ps.slug = e.value
   where ps.pos <> _dfs_slot_pos(e.key);
  if bad is not null then return jsonb_build_object('ok', false, 'error', bad); end if;
  if spent > cap then return jsonb_build_object('ok', false, 'error', 'over the $50,000 salary cap by $' || (spent - cap)); end if;

  -- the per-player lock (0093): a slot whose player's game has locked keeps him
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;
  select string_agg(ps.name, ', ') into bad
    from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
    join pod_salary ps on ps.season = p_season and ps.week = p_week and ps.slug = o ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
     and (p_slots ->> (o ->> 'slot')) is distinct from (o ->> 'player_slug');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'locked in — ' || bad || ' can''t be moved or dropped'); end if;
  select string_agg(ps.name, ', ') into bad
    from jsonb_each_text(p_slots) e join pod_salary ps on ps.season = p_season and ps.week = p_week and ps.slug = e.value
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
     and not exists (select 1 from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
                      where o ->> 'player_slug' = e.value and o ->> 'slot' = e.key);
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || bad); end if;

  select jsonb_agg(jsonb_build_object('slot', s, 'sleeper_id', null, 'player_slug', p_slots ->> s, 'pos', _dfs_slot_pos(s)) order by ord)
    into lineup from unnest(_dfs_slots()) with ordinality u(s, ord);
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;

  -- The open contest: the seat's scoring row, paired with itself, on its
  -- first entry. Lock → live → final drive it like any matchup.
  if lg.kind = 'bullseye' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'cap', cap, 'roster_id', seat.sleeper_roster_id);
end $$;

-- ── a squad and its week, as the builder needs it ──────────────────────────
-- For any member of a Bullseye contest league: the setting, my seat and squad,
-- my matchup and (once the week has kicked off) my opponent's squad and the
-- live state. The card itself is dealt client-side from the same seed.
create or replace function dfs_bullseye_state(p_league uuid, p_week int default null, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; opp int; st matchup_state; started boolean; mine jsonb; theirs jsonb;
begin
  select * into lg from league where id = p_league;
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() limit 1;
  if me.id is null and not is_admin() then return jsonb_build_object('ok', false, 'error', 'you''re not in this contest'); end if;
  if coalesce((lg.settings_json ->> 'dfs_bullseye')::boolean, false) is not true then
    return jsonb_build_object('ok', true, 'on', false);
  end if;
  wk := coalesce(p_week, lg.contest_week,
    (select min(week) from matchup where league_id = p_league and status <> 'final'),
    (select max(week) from matchup where league_id = p_league), _contest_week(p_season));
  select * into m from matchup where league_id = p_league and week = wk
     and me.sleeper_roster_id in (home_roster_id, away_roster_id) limit 1;
  opp := case when m.id is null then null when m.home_roster_id = me.sleeper_roster_id then m.away_roster_id else m.home_roster_id end;
  if opp = me.sleeper_roster_id then opp := null; end if;
  started := coalesce(_week_first_lock(p_season, wk) <= now(), false);
  select starters_json into mine from sleeper_lineup where league_id = p_league and week = wk and roster_id = me.sleeper_roster_id;
  if opp is not null and started then
    select starters_json into theirs from sleeper_lineup where league_id = p_league and week = wk and roster_id = opp;
  end if;
  select * into st from matchup_state where matchup_id = m.id and game_window = 'wk';
  return jsonb_build_object('ok', true, 'on', true, 'kind', lg.kind, 'name', lg.name, 'week', wk, 'season', p_season,
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'started', started,
    'entry', mine,
    'matchup', case when m.id is null then null else jsonb_build_object('id', m.id, 'status', m.status,
      'home', m.home_roster_id, 'away', m.away_roster_id, 'home_final', m.home_final, 'away_final', m.away_final) end,
    'opponent', case when opp is null then null else jsonb_build_object('roster_id', opp,
      'team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = opp limit 1),
      'entry', theirs) end,
    'state', case when st.matchup_id is null or not started then null else jsonb_build_object(
      'home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end);
end $$;

-- ── the open contest's leaderboard ─────────────────────────────────────────
-- Everyone signed in may read it; no squads or scores show before the week's
-- first lock (a count of entries only). Ring totals: the final once stamped,
-- the live 'wk' state while games play. Top N plus the caller's own row.
create or replace function bullseye_contest_board(p_league uuid, p_limit int default 100)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; started boolean; rows jsonb; mine jsonb; n int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind = 'bullseye';
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such contest'); end if;
  started := coalesce(_week_first_lock(lg.season, lg.contest_week) <= now(), false);
  select count(*) into n from sleeper_lineup where league_id = p_league and week = lg.contest_week;
  if not started then return jsonb_build_object('ok', true, 'started', false, 'entries', n, 'rows', '[]'::jsonb); end if;
  with sc as (
    select m.home_roster_id as roster_id, lm.team_name, lm.app_user_id = auth.uid() as me,
           coalesce(m.home_final, st.home_score, 0) as ring,
           (select coalesce(sum((x ->> 'score')::numeric), 0) from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x
             where x ->> 'side' = 'home') as points,
           m.status
      from matchup m
      join league_membership lm on lm.league_id = m.league_id and lm.sleeper_roster_id = m.home_roster_id
      left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
     where m.league_id = p_league and m.week = lg.contest_week
  ), ranked as (
    select sc.*, rank() over (order by ring desc) as rank from sc
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rank, r.team_name) filter (where r.rank <= greatest(1, least(coalesce(p_limit, 100), 500))), '[]'::jsonb),
         (select to_jsonb(x) from ranked x where x.me limit 1)
    into rows, mine from ranked r;
  return jsonb_build_object('ok', true, 'started', true, 'entries', n, 'week', lg.contest_week, 'rows', rows, 'me', mine);
end $$;

-- ── the two switches ───────────────────────────────────────────────────────

-- Admin: this week's open contest — SLOTS or TOTAL, and the radius — until its
-- first lock.
create or replace function set_bullseye_contest(p_week int, p_variant text, p_radius int default 10, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; lk timestamptz;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_variant not in ('slots', 'total') then return jsonb_build_object('ok', false, 'error', 'variant is slots or total'); end if;
  if p_radius is null or p_radius < 2 or p_radius > 50 then return jsonb_build_object('ok', false, 'error', 'radius is 2–50'); end if;
  lk := _week_first_lock(p_season, p_week);
  if lk is not null and lk <= now() then return jsonb_build_object('ok', false, 'error', 'that week''s contest has already locked'); end if;
  lid := _ensure_bullseye_contest(p_season, p_week);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('dfs_bullseye', true, 'bullseye', p_variant, 'bullseye_radius', p_radius)
   where id = lid;
  return jsonb_build_object('ok', true, 'league_id', lid, 'week', p_week, 'variant', p_variant, 'radius', p_radius);
end $$;

-- Commissioner: a private salary-cap league plays Bullseye (SLOTS / TOTAL) or
-- not (null). Not while a week is being played: a change mid-week would
-- re-score games already under way.
create or replace function set_dfs_bullseye(p_league uuid, p_variant text, p_radius int default 10)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or lg.kind <> 'dfs' then return jsonb_build_object('ok', false, 'error', 'Bullseye switches on in salary-cap contest leagues'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  if p_variant is not null and p_variant not in ('slots', 'total') then return jsonb_build_object('ok', false, 'error', 'variant is slots or total'); end if;
  if p_radius is null or p_radius < 2 or p_radius > 50 then return jsonb_build_object('ok', false, 'error', 'radius is 2–50'); end if;
  if exists (select 1 from matchup where league_id = p_league and status = 'live') then
    return jsonb_build_object('ok', false, 'error', 'a week is being played — change it once it''s final');
  end if;
  if p_variant is null then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'dfs_bullseye' - 'bullseye' - 'bullseye_radius' where id = p_league;
  else
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('dfs_bullseye', true, 'bullseye', p_variant, 'bullseye_radius', p_radius)
     where id = p_league;
  end if;
  return jsonb_build_object('ok', true, 'variant', p_variant, 'radius', p_radius);
end $$;

revoke all on function _ensure_bullseye_contest(text, int), _contest_week(text), _week_first_lock(text, int) from public, anon, authenticated;
revoke all on function bullseye_contest(text), join_bullseye_contest(text, text), save_bullseye_entry(uuid, int, jsonb, text),
  dfs_bullseye_state(uuid, int, text), bullseye_contest_board(uuid, int), set_bullseye_contest(int, text, int, text),
  set_dfs_bullseye(uuid, text, int) from public, anon;
grant execute on function bullseye_contest(text), join_bullseye_contest(text, text), save_bullseye_entry(uuid, int, jsonb, text),
  dfs_bullseye_state(uuid, int, text), bullseye_contest_board(uuid, int), set_bullseye_contest(int, text, int, text),
  set_dfs_bullseye(uuid, text, int) to authenticated;
