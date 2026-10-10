-- 0463: BULLSEYE LEAGUES, AND THE DEV ROOM FOR EVERYONE (v0.661.0).
-- Spec: docs/dfs-bullseye.md §9–10.
--
-- Founder: "Let's have it follow more of the league setup pattern though. It's
-- a league you can create as a commish with 32 max people. I (or people I
-- delegate to) can create up to 50,000 people leagues. Commish then posts it
-- to the board for finding. It appears in the listing of my leagues."
-- Chosen: the commish picks ONE WEEK or THE SEASON per league; anyone signed
-- in may start one; the automatic weekly open contest (0462) is retired —
-- the week it is running finishes as it is, and no new one is made.
--
--   • A Bullseye league is kind 'bullseye' (0462's container), with a
--     commissioner, an invite code, settings_json.max_seats and .span:
--     'week' (contest_week = the week it plays) or 'season' (contest_week
--     null; a squad each week). Seats are made as people join — no AI seats,
--     no pairing: each entrant's scoring row is their own (0462).
--   • Size: 2–32 for anyone; up to 50,000 for an admin or an account with the
--     'bullseye_host' feature (admin_set_feature — the founder's delegates).
--   • Join by invite code (join_bullseye) or from the board (join_from_board,
--     which now knows a Bullseye league has no empty seat rows: its open seats
--     are max_seats less the seats taken).
--   • Standings: each week ranked by ring total then tie-break (0462); over a
--     season, the ring totals summed.
--
-- And the dev room (0459): "Let me turn it on for platform registered users."
-- A room can be OPEN: every signed-in account is in it (joined the first time
-- they look), except anyone who left or was removed — that sticks until they
-- come back by invite.

-- ── the containers ─────────────────────────────────────────────────────────

-- 0462 kept one open contest per week with this index; leagues of one week
-- may now share a week. The retired contests stay unique by their
-- sleeper_league_id ('BULL-<season>-<week>').
drop index if exists league_bullseye_contest_week;

create or replace function _is_open_contest(lg league) returns boolean
  language sql immutable as $$
  select coalesce(lg.kind = 'bullseye' and lg.sleeper_league_id = 'BULL-' || lg.season || '-' || lg.contest_week, false);
$$;

-- The retired open contest: found, never made.
create or replace function _ensure_bullseye_contest(p_season text, p_week int) returns uuid
  language sql stable security definer set search_path = public as $$
  select id from league where kind = 'bullseye' and season = p_season and sleeper_league_id = 'BULL-' || p_season || '-' || p_week;
$$;

create or replace function bullseye_contest(p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; lid uuid; lg league; me league_membership; lock_at timestamptz; n int; entered boolean := false;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  wk := _contest_week(p_season);
  lid := case when wk is null then null else _ensure_bullseye_contest(p_season, wk) end;
  if lid is null then return jsonb_build_object('ok', false, 'retired', true, 'error', 'the weekly open contest has become Bullseye leagues — find one on the board'); end if;
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

-- ── size ───────────────────────────────────────────────────────────────────

create or replace function _bullseye_max_cap() returns int
  language sql stable security definer set search_path = public as $$
  select case when is_admin() or coalesce((select features ? 'bullseye_host' from app_user where id = auth.uid()), false)
              then 50000 else 32 end;
$$;

create or replace function _bullseye_max_seats(lg league) returns int
  language sql immutable as $$
  select coalesce((lg.settings_json ->> 'max_seats')::int, case when _is_open_contest(lg) then 1000000 else 32 end);
$$;

create or replace function _league_seats_taken(p_league uuid) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from league_membership where league_id = p_league and app_user_id is not null and enrolled;
$$;

-- Open seats, for the board and the preview: a Bullseye league has no empty
-- seat rows to count (seats are made on join).
create or replace function _league_seats_open(p_league uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when l.kind = 'bullseye' then greatest(0, _bullseye_max_seats(l) - _league_seats_taken(l.id))
              else (select count(*)::int from league_membership m
                     where m.league_id = l.id and m.app_user_id is null and not m.enrolled) end
    from league l where l.id = p_league;
$$;

create or replace function _bullseye_info(lg league) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when lg.kind = 'bullseye' then jsonb_build_object(
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', _bullseye_max_seats(lg),
    'seats_taken', _league_seats_taken(lg.id)) end;
$$;

-- ── create, join ───────────────────────────────────────────────────────────

-- Anyone signed in. p_span 'week' plays the week about to be played; 'season'
-- plays every week from it on. The founder takes seat 1.
create or replace function create_bullseye_league(p_name text, p_span text default 'season', p_max int default 12,
    p_variant text default 'slots', p_radius int default 10, p_team_name text default null, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; cap int; lid uuid; nm text; tm text; lg league;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  if p_span not in ('week', 'season') then return jsonb_build_object('ok', false, 'error', 'a league runs one week or the season'); end if;
  if p_variant not in ('slots', 'total') then return jsonb_build_object('ok', false, 'error', 'variant is slots or total'); end if;
  if p_radius is null or p_radius < 2 or p_radius > 50 then return jsonb_build_object('ok', false, 'error', 'radius is 2–50'); end if;
  cap := _bullseye_max_cap();
  if p_max is null or p_max < 2 or p_max > cap then
    return jsonb_build_object('ok', false, 'error', 'a Bullseye league holds 2–' || cap || ' people');
  end if;
  wk := _contest_week(p_season);
  if p_span = 'week' and wk is null then return jsonb_build_object('ok', false, 'error', 'no NFL week on the slate right now'); end if;
  nm := coalesce(nullif(left(btrim(coalesce(p_name, '')), 60), ''),
                 case when p_span = 'week' then 'Week ' || wk || ' Bullseye' else 'Bullseye League' end);
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league (sleeper_league_id, season, name, kind, contest_week, kdst_mode, provider, lineup_policy, commissioner_id, settings_json)
  values ('BLG-' || upper(left(md5(gen_random_uuid()::text), 10)), p_season, nm, 'bullseye',
          case when p_span = 'week' then wk end, 'off', 'pod', 'empty', auth.uid(),
          jsonb_build_object('dfs_bullseye', true, 'bullseye', p_variant, 'bullseye_radius', p_radius,
                             'max_seats', p_max, 'span', p_span))
  returning id into lid;
  tm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(1));
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
  values (lid, 1, 'BLG-1', auth.uid(), true, tm, 'human');
  select * into lg from league where id = lid;
  return jsonb_build_object('ok', true, 'league_id', lid, 'name', lg.name, 'invite_code', lg.invite_code,
    'roster_id', 1, 'team', tm, 'bullseye', _bullseye_info(lg));
end $$;

create or replace function _bullseye_default_team(p_rid int) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(display_name), '') from app_user where id = auth.uid()),
                  (select split_part(email, '@', 1) from app_user where id = auth.uid()),
                  'Team ' || p_rid);
$$;

-- A seat in a Bullseye league: the next number, under its max. Idempotent.
-- Callers have already authorised the join (the code, or an open listing).
create or replace function _bullseye_take_seat(p_league uuid, p_team_name text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; rid int; nm text;
begin
  select * into lg from league where id = p_league and kind = 'bullseye';
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such Bullseye league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() limit 1;
  if me.id is not null then
    if not me.enrolled then update league_membership set enrolled = true where id = me.id; end if;
    return jsonb_build_object('ok', true, 'already', me.enrolled, 'league_id', p_league, 'league', lg.name,
      'roster_id', me.sleeper_roster_id, 'team', me.team_name);
  end if;
  perform pg_advisory_xact_lock(hashtext('bullseye-seat|' || p_league::text));
  if _league_seats_taken(p_league) >= _bullseye_max_seats(lg) then
    return jsonb_build_object('ok', false, 'error', 'this league is full');
  end if;
  select coalesce(max(sleeper_roster_id), 0) + 1 into rid from league_membership where league_id = p_league;
  nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(rid));
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
  values (p_league, rid, 'BLG-' || rid, auth.uid(), true, nm, 'human');
  return jsonb_build_object('ok', true, 'league_id', p_league, 'league', lg.name, 'roster_id', rid, 'team', nm);
end $$;

create or replace function join_bullseye(p_code text, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select id into lid from league where invite_code = upper(btrim(coalesce(p_code, ''))) and kind = 'bullseye';
  if lid is null then return jsonb_build_object('ok', false, 'error', 'that isn''t a Bullseye league code'); end if;
  return _bullseye_take_seat(lid, p_team_name);
end $$;

-- The retired open contest: a seat in the week already running, never a new one.
create or replace function join_bullseye_contest(p_team_name text default null, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; lid uuid; r jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  wk := _contest_week(p_season);
  lid := case when wk is null then null else _ensure_bullseye_contest(p_season, wk) end;
  if lid is null then return jsonb_build_object('ok', false, 'retired', true, 'error', 'the weekly open contest has become Bullseye leagues — find one on the board'); end if;
  r := _bullseye_take_seat(lid, p_team_name);
  return r || jsonb_build_object('week', wk);
end $$;

-- ── a squad: the week rule for a season league ─────────────────────────────
-- 0462's body; one change: a season league (contest_week null) takes a squad
-- for any week from the one about to be played on. The board, the cap and
-- the per-player lock still decide the rest.
create or replace function save_bullseye_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; cap int := 50000; spent int; n int; bad text; old jsonb; lineup jsonb; lk timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or lg.kind not in ('bullseye', 'dfs') or coalesce((lg.settings_json ->> 'dfs_bullseye')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not a Bullseye contest');
  end if;
  if lg.kind = 'bullseye' and lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if lg.kind = 'bullseye' and lg.contest_week is null and p_week < coalesce(_contest_week(lg.season), 1) then
    return jsonb_build_object('ok', false, 'error', 'that week has been played');
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

  select count(*), coalesce(sum(ps.salary), 0) into n, spent
    from jsonb_each_text(p_slots) e join pod_salary ps on ps.season = p_season and ps.week = p_week and ps.slug = e.value;
  if n <> 9 then return jsonb_build_object('ok', false, 'error', 'a pick is not on this week''s board'); end if;
  select string_agg(ps.name || ' (' || ps.pos || ') can''t play ' || e.key, '; ') into bad
    from jsonb_each_text(p_slots) e join pod_salary ps on ps.season = p_season and ps.week = p_week and ps.slug = e.value
   where ps.pos <> _dfs_slot_pos(e.key);
  if bad is not null then return jsonb_build_object('ok', false, 'error', bad); end if;
  if spent > cap then return jsonb_build_object('ok', false, 'error', 'over the $50,000 salary cap by $' || (spent - cap)); end if;

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

  if lg.kind = 'bullseye' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'cap', cap, 'roster_id', seat.sleeper_roster_id);
end $$;

-- ── the league, as its screen needs it ─────────────────────────────────────
-- For a member (or its commish, or an admin): the setting, the week in play,
-- my seat, and whether I can run it.
create or replace function bullseye_league(p_league uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; wk int; cur int; lock_at timestamptz; entered boolean := false; weeks jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind = 'bullseye';
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such Bullseye league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'you''re not in this league');
  end if;
  cur := _contest_week(lg.season);
  wk := coalesce(lg.contest_week, cur, (select max(week) from matchup where league_id = p_league));
  if me.id is not null and wk is not null then
    entered := exists (select 1 from sleeper_lineup where league_id = p_league and week = wk and roster_id = me.sleeper_roster_id);
  end if;
  lock_at := case when wk is null then null else _week_first_lock(lg.season, wk) end;
  select coalesce(jsonb_agg(w order by w), '[]'::jsonb) into weeks
    from (select distinct week as w from matchup where league_id = p_league) x;
  return jsonb_build_object('ok', true, 'league_id', lg.id, 'name', lg.name, 'season', lg.season, 'week', wk,
    'invite_code', case when me.id is not null or is_league_commish(p_league) or is_admin() then lg.invite_code end,
    'commish', is_league_commish(p_league) or is_admin(),
    'open_contest', _is_open_contest(lg),
    'listed', exists (select 1 from league_listing li where li.league_id = p_league and li.open),
    'bullseye', _bullseye_info(lg),
    'weeks', weeks,
    'entries', (select count(*) from sleeper_lineup where league_id = p_league and week = wk),
    'first_lock', lock_at, 'started', lock_at is not null and lock_at <= now(),
    'me', case when me.id is null then null else jsonb_build_object('roster_id', me.sleeper_roster_id, 'team', me.team_name, 'entered', entered) end);
end $$;

-- ── standings: a week, and a season ────────────────────────────────────────
-- Members (and anyone, while the league is posted on the board). Before a
-- week's first lock its rows are hidden (a count of entries only), as 0462.
-- The season table sums finals over every week that has been stamped.
create or replace function bullseye_league_board(p_league uuid, p_week int default null, p_limit int default 100)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; wk int; started boolean; rows jsonb; mine jsonb; srows jsonb; smine jsonb; n int; lim int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind = 'bullseye';
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such contest'); end if;
  if not (_is_open_contest(lg) or is_league_member(p_league) or is_league_commish(p_league) or is_admin()
          or exists (select 1 from league_listing li where li.league_id = p_league and li.open)) then
    return jsonb_build_object('ok', false, 'error', 'you''re not in this league');
  end if;
  lim := greatest(1, least(coalesce(p_limit, 100), 500));
  wk := coalesce(p_week, lg.contest_week, _contest_week(lg.season), (select max(week) from matchup where league_id = p_league));
  started := wk is not null and coalesce(_week_first_lock(lg.season, wk) <= now(), false);
  select count(*) into n from sleeper_lineup where league_id = p_league and week = wk;

  if started then
    with sc as (
      select m.home_roster_id as roster_id, lm.team_name, lm.app_user_id = auth.uid() as me,
             coalesce(m.home_final, st.home_score, 0) as ring, m.home_tb as tb,
             (select coalesce(sum((x ->> 'score')::numeric), 0) from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x
               where x ->> 'side' = 'home') as points,
             m.status
        from matchup m
        join league_membership lm on lm.league_id = m.league_id and lm.sleeper_roster_id = m.home_roster_id
        left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
       where m.league_id = p_league and m.week = wk
    ), ranked as (
      select sc.*, rank() over (order by ring desc, tb asc nulls last) as rank from sc
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank, r.tb nulls last, r.team_name) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1)
      into rows, mine from ranked r;
  end if;

  if lg.contest_week is null then
    with s as (
      select lm.sleeper_roster_id as roster_id, lm.team_name, lm.app_user_id = auth.uid() as me,
             coalesce(sum(m.home_final), 0) as total, count(m.id) as weeks,
             max(m.home_final) as best
        from league_membership lm
        left join matchup m on m.league_id = lm.league_id and m.home_roster_id = lm.sleeper_roster_id and m.status = 'final'
       where lm.league_id = p_league and lm.enrolled
       group by lm.sleeper_roster_id, lm.team_name, lm.app_user_id
    ), ranked as (
      select s.*, rank() over (order by total desc, best desc nulls last) as rank from s
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank, r.team_name) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1)
      into srows, smine from ranked r;
  end if;

  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'entries', n,
    'rows', coalesce(rows, '[]'::jsonb), 'me', mine,
    'season', case when lg.contest_week is null then jsonb_build_object('rows', srows, 'me', smine) end);
end $$;

-- MY TEAM: my seat's weeks — the ring total (live while it plays), the
-- tie-break, and where it ranked among that week's entries.
create or replace function bullseye_my_weeks(p_league uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me league_membership; out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  with wk as (
    select m.week, m.status, m.home_roster_id as roster_id, m.home_tb as tb,
           coalesce(m.home_final, st.home_score) as ring
      from matchup m
      left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
     where m.league_id = p_league
  ), ranked as (
    select wk.*, rank() over (partition by week order by coalesce(ring, 0) desc, tb asc nulls last) as rank,
           count(*) over (partition by week) as entries
      from wk
  )
  select coalesce(jsonb_agg(jsonb_build_object('week', r.week, 'status', r.status, 'ring', r.ring, 'tb', r.tb,
           'rank', case when r.status in ('live', 'final') then r.rank end, 'entries', r.entries) order by r.week desc), '[]'::jsonb)
    into out from ranked r where r.roster_id = me.sleeper_roster_id;
  return jsonb_build_object('ok', true, 'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'weeks', out);
end $$;

-- 0462's reader, kept for the retired contest's screen: the same board.
create or replace function bullseye_contest_board(p_league uuid, p_limit int default 100)
  returns jsonb language sql security definer set search_path = public as $$
  select bullseye_league_board(p_league, null, p_limit);
$$;

-- ── the commissioner's switch, for Bullseye leagues too ────────────────────
-- 0462 body, widened: a 'bullseye' league's commish sets its variant and
-- radius (never off — it is a Bullseye league), and its size within their cap.
create or replace function set_dfs_bullseye(p_league uuid, p_variant text, p_radius int default 10)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or lg.kind not in ('dfs', 'bullseye') then return jsonb_build_object('ok', false, 'error', 'Bullseye switches on in salary-cap contest leagues'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  if lg.kind = 'bullseye' and p_variant is null then return jsonb_build_object('ok', false, 'error', 'a Bullseye league always plays Bullseye'); end if;
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

create or replace function set_bullseye_size(p_league uuid, p_max int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; cap int;
begin
  select * into lg from league where id = p_league and kind = 'bullseye';
  if lg.id is null or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such Bullseye league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  cap := _bullseye_max_cap();
  if p_max is null or p_max < 2 or p_max > cap then return jsonb_build_object('ok', false, 'error', 'a Bullseye league holds 2–' || cap || ' people'); end if;
  if p_max < _league_seats_taken(p_league) then return jsonb_build_object('ok', false, 'error', 'more people than that are already in'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('max_seats', p_max) where id = p_league;
  return jsonb_build_object('ok', true, 'max_seats', p_max);
end $$;

-- ── the delegates ──────────────────────────────────────────────────────────
-- 0096 body + 'bullseye_host' (may make Bullseye leagues of up to 50,000).
create or replace function admin_set_feature(p_email text, p_feature text, p_on boolean)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_feature not in ('solo', 'dfs_commish', 'native', 'bullseye_host') then
    return jsonb_build_object('ok', false, 'error', 'unknown feature');
  end if;
  select id into uid from app_user where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'no account with that email (they must sign in once first)');
  end if;
  update app_user set features = case when p_on
      then features || jsonb_build_object(p_feature, true)
      else features - p_feature end
    where id = uid;
  return jsonb_build_object('ok', true, 'email', lower(trim(p_email)), 'feature', p_feature, 'on', p_on);
end $$;

-- ── the board knows Bullseye leagues ───────────────────────────────────────

-- 0223 body; a Bullseye league (provider 'pod') may be posted too.
create or replace function post_league_listing(p_league_id uuid, p_blurb text default null, p_dues text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  if lg.provider <> 'native' and not (lg.kind = 'bullseye' and not _is_open_contest(lg)) then
    return jsonb_build_object('ok', false, 'error', 'only native leagues can be posted — others recruit with their invite links');
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league_listing (league_id, created_by, blurb, dues)
    values (p_league_id, auth.uid(), left(coalesce(p_blurb, ''), 280), nullif(left(coalesce(p_dues, ''), 120), ''))
  on conflict (league_id) do update
    set open = true, updated_at = now(),
        blurb = case when p_blurb is null then league_listing.blurb else left(p_blurb, 280) end,
        dues  = case when p_dues  is null then league_listing.dues  else nullif(left(p_dues, 120), '') end;
  return jsonb_build_object('ok', true);
end $$;

-- 0223 body; open seats from _league_seats_open, and each row says its kind
-- (and, for Bullseye, its variant, span and size). A one-week Bullseye league
-- leaves the board once its week has kicked off.
create or replace function league_board()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'not signed in'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
      'kind', l.kind, 'bullseye', _bullseye_info(l),
      'blurb', li.blurb, 'dues', li.dues, 'posted_at', li.updated_at,
      'seats_total', case when l.kind = 'bullseye' then _bullseye_max_seats(l)
                          else (select count(*) from league_membership m where m.league_id = l.id) end,
      'seats_open',  _league_seats_open(l.id),
      'draft_status', coalesce((select d.status from draft d where d.league_id = l.id), 'pending'),
      'draft_mode',   coalesce((select d.mode from draft d where d.league_id = l.id), 'snake'),
      'identity', _league_identity(l.id),
      'mine',    exists (select 1 from league_membership m
                          where m.league_id = l.id and m.app_user_id = auth.uid() and m.enrolled),
      'commish', l.commissioner_id = auth.uid()
    ) as r
    from league_listing li
    join league l on l.id = li.league_id
    where li.open
      and _league_seats_open(l.id) > 0
      and not (l.kind = 'bullseye' and l.contest_week is not null
               and coalesce(_week_first_lock(l.season, l.contest_week) <= now(), false))
    order by li.updated_at desc
  ) t;
  return result;
end $$;

-- 0123 body; a Bullseye league takes the next seat instead of native_join.
create or replace function join_from_board(p_league_id uuid, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare code text; k text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select l.invite_code, l.kind into code, k
    from league_listing li join league l on l.id = li.league_id
    where li.league_id = p_league_id and li.open;
  if code is null then
    return jsonb_build_object('ok', false, 'error', 'that league is no longer taking joiners');
  end if;
  if k = 'bullseye' then return _bullseye_take_seat(p_league_id, p_team_name); end if;
  return native_join(code, p_team_name);
end $$;

-- 0223 body; kind + the Bullseye block, open seats from _league_seats_open,
-- and a Bullseye league's member list capped (it may be 50,000 long).
create or replace function league_preview(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l league%rowtype; d draft%rowtype; listed boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into l from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  listed := exists (select 1 from league_listing li where li.league_id = p_league_id and li.open);
  if not (listed or is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not open for browsing');
  end if;
  select * into d from draft where league_id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
    'kind', l.kind, 'bullseye', _bullseye_info(l),
    'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    'ppr', coalesce((l.settings_json ->> 'ppr')::numeric, 1),
    'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
    'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
    'identity', _league_identity(p_league_id),
    'dues', (select li.dues from league_listing li where li.league_id = p_league_id),
    'blurb', (select li.blurb from league_listing li where li.league_id = p_league_id),
    'seats_total', case when l.kind = 'bullseye' then _bullseye_max_seats(l)
                        else (select count(*) from league_membership m where m.league_id = p_league_id) end,
    'seats_open',  _league_seats_open(p_league_id),
    'draft', case when d.league_id is null then null else jsonb_build_object(
      'status', d.status, 'mode', d.mode, 'rounds', d.rounds,
      'pick_seconds', d.pick_seconds,
      'budget', case when d.mode = 'auction' then d.budget end,
      'night', case when d.night_start_min is not null then jsonb_build_object(
        'start_min', d.night_start_min, 'end_min', d.night_end_min) end) end,
    'rules', jsonb_build_object(
      'waiver_mode', coalesce(l.settings_json ->> 'waiver_mode', 'rolling'),
      'faab_budget', l.settings_json -> 'faab_budget',
      'trade_review', coalesce(l.settings_json ->> 'trade_review', 'none'),
      'pos_caps', l.settings_json -> 'pos_caps',
      'live_buffs', not league_powerups_off(p_league_id)),
    'contract_rules', case when contracts_on(p_league_id) then jsonb_build_object(
      'salary_cap', league_salary_cap(p_league_id),
      'years_max', contract_years_max(p_league_id),
      'dead_pct', contract_dead_pct(p_league_id),
      'retention', salary_retention_on(p_league_id),
      'cap_trading', cap_trading_on(p_league_id),
      'ir_relief', ir_cap_relief_on(p_league_id),
      'tag_raise_pct', tag_raise_pct(p_league_id),
      'ext_discount_pct', ext_discount_pct(p_league_id),
      'rfa', rfa_on(p_league_id)) end,
    'scoring', l.settings_json -> 'scoring',
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', t.sleeper_roster_id, 'team_name', t.team_name,
        'taken', t.app_user_id is not null and t.enrolled)
        order by t.sleeper_roster_id), '[]'::jsonb)
      from (select * from league_membership m where m.league_id = p_league_id
             order by m.sleeper_roster_id limit case when l.kind = 'bullseye' then 100 end) t));
end $$;

-- 0223 body; open seats from _league_seats_open.
create or replace function league_listing_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare li league_listing%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into li from league_listing where league_id = p_league_id;
  return jsonb_build_object('ok', true,
    'listed', coalesce(li.open, false),
    'blurb', coalesce(li.blurb, ''),
    'dues', li.dues,
    'seats_open', _league_seats_open(p_league_id));
end $$;

-- ── the dev room, open to everyone ─────────────────────────────────────────

alter table dev_room add column if not exists open_to_all boolean not null default false;

-- Who left (or was removed from) a room. In an open room that sticks: they
-- are not put back in until they rejoin by invite.
create table if not exists dev_room_left (
  room_id      uuid not null references dev_room(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  left_at      timestamptz not null default now(),
  primary key (room_id, app_user_id)
);
alter table dev_room_left enable row level security;       -- no policies: RPC-only

-- An admin (app or room) opens a room to every signed-in account, or closes it
-- again. Closing keeps everyone already in.
create or replace function dev_room_set_open(p_room uuid, p_open boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or exists (select 1 from dev_room_member
            where room_id = p_room and app_user_id = auth.uid() and role = 'admin')) then
    return jsonb_build_object('ok', false, 'error', 'only an admin can change this');
  end if;
  update dev_room set open_to_all = coalesce(p_open, false) where id = p_room;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such room'); end if;
  return jsonb_build_object('ok', true, 'open', coalesce(p_open, false));
end $$;

-- 0459 body; first, the caller joins every open room they haven't left. Each
-- room says whether it is open.
create or replace function dev_rooms_mine()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into dev_room_member (room_id, app_user_id)
  select r.id, auth.uid() from dev_room r
   where r.open_to_all
     and not exists (select 1 from dev_room_left x where x.room_id = r.id and x.app_user_id = auth.uid())
  on conflict do nothing;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'role', m.role, 'open', r.open_to_all,
           'members', (select count(*) from dev_room_member x where x.room_id = r.id),
           'unread', (select count(*) from dev_room_message g
                       where g.room_id = r.id and g.id > m.last_read
                         and g.author_id is distinct from auth.uid()))
         order by r.created_at), '[]'::jsonb)
    into out
    from dev_room_member m join dev_room r on r.id = m.room_id
   where m.app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'rooms', out, 'can_create', is_admin());
end $$;

-- 0459 body; the removal is remembered.
create or replace function dev_room_remove(p_room uuid, p_user uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare isadm boolean;
begin
  isadm := is_admin() or exists (select 1 from dev_room_member
             where room_id = p_room and app_user_id = auth.uid() and role = 'admin');
  if not (isadm or p_user = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'only an admin can remove someone');
  end if;
  if exists (select 1 from dev_room_member where room_id = p_room and app_user_id = p_user and role = 'admin')
     and (select count(*) from dev_room_member where room_id = p_room and role = 'admin') <= 1 then
    return jsonb_build_object('ok', false, 'error', 'the room''s last admin can''t leave it');
  end if;
  delete from dev_room_member where room_id = p_room and app_user_id = p_user;
  insert into dev_room_left (room_id, app_user_id) values (p_room, p_user) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- 0459 body; joining by invite clears a leave.
create or replace function dev_room_join(p_code text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c text := upper(btrim(coalesce(p_code, ''))); inv dev_room_invite; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into inv from dev_room_invite where code = c for update;
  if inv.code is null or inv.revoked then
    return jsonb_build_object('ok', false, 'error', 'that invite code isn''t valid');
  end if;
  select name into nm from dev_room where id = inv.room_id;
  if exists (select 1 from dev_room_member where room_id = inv.room_id and app_user_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'room_id', inv.room_id, 'name', nm, 'already', true);
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    return jsonb_build_object('ok', false, 'error', 'that invite has been used up');
  end if;
  insert into dev_room_member (room_id, app_user_id) values (inv.room_id, auth.uid());
  delete from dev_room_left where room_id = inv.room_id and app_user_id = auth.uid();
  update dev_room_invite set uses = uses + 1 where code = c;
  return jsonb_build_object('ok', true, 'room_id', inv.room_id, 'name', nm);
end $$;

-- ── grants ─────────────────────────────────────────────────────────────────

revoke all on function _is_open_contest(league), _bullseye_max_cap(), _bullseye_max_seats(league), _league_seats_taken(uuid),
  _league_seats_open(uuid), _bullseye_info(league), _bullseye_default_team(int), _bullseye_take_seat(uuid, text)
  from public, anon, authenticated;
revoke all on function create_bullseye_league(text, text, int, text, int, text, text), join_bullseye(text, text),
  bullseye_league(uuid), bullseye_league_board(uuid, int, int), bullseye_my_weeks(uuid), set_bullseye_size(uuid, int), dev_room_set_open(uuid, boolean)
  from public, anon;
grant execute on function create_bullseye_league(text, text, int, text, int, text, text), join_bullseye(text, text),
  bullseye_league(uuid), bullseye_league_board(uuid, int, int), bullseye_my_weeks(uuid), set_bullseye_size(uuid, int), dev_room_set_open(uuid, boolean)
  to authenticated;
