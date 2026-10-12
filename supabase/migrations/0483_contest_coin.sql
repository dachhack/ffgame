-- 0483: DRIP COIN ON A CONTEST LEAGUE, PR 1 OF THE PLAN (v0.684.0). The
-- wallet and the week's earn; nothing to spend yet (the plays are PR 2).
-- Founder: "rethink the drip rewards so that they are not the rich get
-- richer or winners get richer" — so the week pays for showing up, for
-- reading the board, and for LOSING, never for winning:
--
--   seed         100   once, when a seat joins a coin league (or coin is turned on)
--   built         40   a squad of your own saved before the first kickoff
--   streak      5/wk   weeks in a row built, up to 25
--   bargain       15   a bottom-third-priced player doubled his projection
--   call          10   your cheapest spot outscored your priciest
--   deadon     10 ea   Bullseye: a spot inside its band (up to 30); a one-team total inside its band, 30
--   heartbreaker  25   a head-to-head loss by under 10
--   loss          15   a head-to-head loss by 10 or more
--   bottomhalf    20   a leaderboard finish in the bottom half
--   catchup       10   below the season's median, from the second week until you cross it
--   cap            −   a wallet above 150 burns down to 150 at the week's end
--
-- Per seat (team_wallet / coin_ledger are keyed by roster already), credited
-- by contest_settle_coin(league, week) once the week is final — the worker
-- calls it as it posts the week's recap card; a re-run credits nothing twice
-- (idem keys carry league, week, seat and reason). The rule is
-- set_contest_rules's tenth parameter (the ninth overload is dropped);
-- _bullseye_info carries `coin`, contest_state the seat's `wallet`, and
-- bullseye_my_weeks the wallet with its last lines for MY TEAM.

-- A member's first save of a week's squad, for "built by you" (the CPU's
-- no-show build and the commissioner's fix write nothing here).
create table if not exists contest_build (
  league_id uuid not null references league(id) on delete cascade,
  week      int  not null,
  roster_id int  not null,
  by_user   uuid,
  at        timestamptz not null default now(),
  primary key (league_id, week, roster_id)
);
alter table contest_build enable row level security;
revoke all on contest_build from public, anon, authenticated;

create or replace function _contest_coin_on(lg league) returns boolean
  language sql immutable as $$ select coalesce((lg.settings_json ->> 'coin')::boolean, false); $$;
create or replace function save_contest_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026', p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; bad text; chk jsonb;
        spent int := 0; old jsonb; lineup jsonb := '[]'::jsonb; lk timestamptz; budget int; floor_ int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if lg.contest_week is null and p_week < coalesce(_contest_week(lg.season), 1) then
    return jsonb_build_object('ok', false, 'error', 'that week has been played');
  end if;
  seat := _my_contest_seat(p_league, p_roster);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if p_roster is not null and seat.sleeper_roster_id <> p_roster then return jsonb_build_object('ok', false, 'error', 'that isn''t your seat'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final'
               and seat.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;
  -- ENTRIES CLOSE AT THE FIRST KICKOFF (0475): no new squad after it. A
  -- squad the worker wrote empty for a no-show (`zero`) counts as none.
  if _contest_entry_deadline(lg) = 'first' and coalesce(jsonb_array_length(old), 0) = 0
     and coalesce(_week_first_lock(p_season, p_week) <= now(), false) then
    return jsonb_build_object('ok', false, 'error', 'entries closed at the week''s first kickoff');
  end if;

  chk := _contest_squad_check(lg, seat.sleeper_roster_id, p_week, p_slots, p_season, old, true);
  if chk ? 'error' then return jsonb_build_object('ok', false, 'error', chk ->> 'error'); end if;
  lineup := chk -> 'lineup'; spent := (chk ->> 'spent')::int; budget := (chk ->> 'budget')::int; floor_ := (chk ->> 'min_spend')::int;

  -- the per-player lock (0093) — AT KICKOFF for a contest league (0470).
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = o ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
     and (p_slots ->> (o ->> 'slot')) is distinct from (o ->> 'player_slug');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'locked in — ' || bad || ' can''t be moved or dropped'); end if;
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(lineup) e
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = e ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff <= now())
     and not exists (select 1 from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
                      where o ->> 'player_slug' = e ->> 'player_slug' and o ->> 'slot' = e ->> 'slot');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || bad); end if;

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  -- SWAP HISTORY (0478): a change to a saved squad, spot by spot.
  perform _log_contest_swaps(p_league, p_week, seat.sleeper_roster_id, old, lineup, 'swap', auth.uid());
  -- BUILT BY YOU (0483): the first save of the week, by the member, with its
  -- time — the coin's "showed up" line reads it against the first kickoff.
  -- The CPU's build and the commissioner's fix write no row.
  insert into contest_build (league_id, week, roster_id, by_user) values (p_league, p_week, seat.sleeper_roster_id, auth.uid()) on conflict do nothing;
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'budget', budget, 'min_spend', floor_, 'roster_id', seat.sleeper_roster_id);
end $$;

/** One line of the week's earn, once: the idem key carries league, week, seat and reason. */
create or replace function _contest_credit(p_league uuid, p_week int, p_roster int, p_matchup uuid, p_delta numeric, p_reason text) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  return adjust_wallet(p_league, p_roster, p_matchup, p_week, p_delta, p_reason, 'contest:' || p_league::text || ':' || p_week || ':' || p_roster || ':' || p_reason);
end $$;
/** The seat's starting coin, once. */
create or replace function _contest_seed_coin(p_league uuid, p_roster int) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  return adjust_wallet(p_league, p_roster, null, null, 100, 'seed', 'contest:seed:' || p_league::text || ':' || p_roster);
end $$;

drop function if exists set_contest_rules(uuid, text, text, int, int, boolean, text, text, int);
create or replace function set_contest_rules(p_league uuid, p_contest text default null, p_format text default null, p_budget int default null,
    p_min_spend int default null, p_auto_sub boolean default null, p_late_entry text default null, p_entry_deadline text default null,
    p_max_entries int default null, p_coin boolean default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; s jsonb; cap int; flr int; fmt text; ctst text;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  if exists (select 1 from matchup where league_id = p_league and status = 'live') then
    return jsonb_build_object('ok', false, 'error', 'a week is being played — change it once it''s final');
  end if;
  s := coalesce(lg.settings_json, '{}'::jsonb);
  if p_contest is not null then
    if p_contest not in ('high', 'golf', 'bullseye') then return jsonb_build_object('ok', false, 'error', 'a contest is high, golf or bullseye'); end if;
    s := (s - 'dfs_bullseye' - 'golf') || jsonb_build_object('contest', p_contest);
    if p_contest = 'bullseye' then
      s := s || jsonb_build_object('dfs_bullseye', true, 'bullseye', coalesce(s ->> 'bullseye', 'slots'), 'bullseye_radius', coalesce((s ->> 'bullseye_radius')::int, 10));
    else
      s := s - 'bullseye' - 'bullseye_radius';
    end if;
    if p_contest = 'golf' then s := s || '{"golf": true}'::jsonb; end if;
  end if;
  if p_format is not null then
    if p_format not in ('h2h', 'board') then return jsonb_build_object('ok', false, 'error', 'a format is h2h or board'); end if;
    if p_format <> _contest_format_of(lg) and exists (select 1 from matchup where league_id = p_league) then
      return jsonb_build_object('ok', false, 'error', 'the format is set before the first week is played');
    end if;
    if p_format = 'h2h' and (select count(*) from league_membership where league_id = p_league) % 2 <> 0 then
      return jsonb_build_object('ok', false, 'error', 'head-to-head needs an even number of seats');
    end if;
    s := s || jsonb_build_object('contest_format', p_format);
    -- a head-to-head seat can't sit a week out: an opponent is waiting
    if p_format = 'h2h' and s ->> 'late_entry' = 'drop' then s := s - 'late_entry'; end if;
    -- head-to-head is one seat per member: an opponent is a person
    if p_format = 'h2h' then s := s - 'max_entries'; end if;
  end if;
  if p_budget is not null then
    if p_budget <> 0 and (p_budget < 10000 or p_budget > 500000) then return jsonb_build_object('ok', false, 'error', 'the budget is $10,000–$500,000, or 0 for no cap'); end if;
    s := s || jsonb_build_object('budget', (p_budget / 100) * 100);
  end if;
  if p_min_spend is not null then
    if p_min_spend <> 0 and (p_min_spend < 5000 or p_min_spend > 500000) then return jsonb_build_object('ok', false, 'error', 'the minimum spend is $5,000–$500,000, or 0 for none'); end if;
    s := s || jsonb_build_object('min_spend', (p_min_spend / 100) * 100);
  end if;
  -- AUTO-SUB (0470): a ruled-out human pick is swapped by the worker just
  -- before his kickoff. Opt-in: some would rather take the zero than a sub
  -- they didn't choose.
  if p_auto_sub is not null then s := s || jsonb_build_object('auto_sub', p_auto_sub); end if;
  -- NO SQUAD BY LOCK and ENTRIES (0475).
  fmt := coalesce(s ->> 'contest_format', _contest_format_of(lg));
  ctst := coalesce(s ->> 'contest', _contest_of(lg));
  if p_late_entry is not null then
    if p_late_entry not in ('cpu', 'zero', 'drop') then return jsonb_build_object('ok', false, 'error', 'a no-show rule is cpu, zero or drop'); end if;
    if p_late_entry = 'drop' and fmt = 'h2h' then
      return jsonb_build_object('ok', false, 'error', 'a head-to-head seat can''t sit a week out — its opponent is waiting. Pick THE CPU BUILDS ONE or SCORES ZERO');
    end if;
    if p_late_entry = 'zero' and ctst = 'golf'
       and exists (select 1 from jsonb_array_elements(_contest_slots(lg)) d where coalesce(nullif(d ->> 'zero_pts', '')::numeric, 0) <= 0) then
      return jsonb_build_object('ok', false, 'error', 'in golf a scoreless squad is the best score — set every spot''s 0 → penalty on ROSTER first, or let the CPU build');
    end if;
    s := s || jsonb_build_object('late_entry', p_late_entry);
  end if;
  if p_entry_deadline is not null then
    if p_entry_deadline not in ('open', 'first') then return jsonb_build_object('ok', false, 'error', 'entries are open or close at the first kickoff'); end if;
    s := s || jsonb_build_object('entry_deadline', p_entry_deadline);
  end if;
  -- ENTRIES PER MEMBER (0481): how many seats one member may hold, on a
  -- leaderboard league. Head-to-head stays one: an opponent is a person.
  if p_max_entries is not null then
    if p_max_entries < 1 or p_max_entries > 50 then return jsonb_build_object('ok', false, 'error', 'entries per member is 1–50'); end if;
    if p_max_entries > 1 and fmt = 'h2h' then return jsonb_build_object('ok', false, 'error', 'head-to-head is one entry per member — an opponent is a person'); end if;
    s := s || jsonb_build_object('max_entries', p_max_entries);
  end if;
  -- DRIP COIN (0483): the wallet and the week's earn, per seat. Turning it on
  -- seeds every seat already in (idempotent per seat).
  if p_coin is not null then s := s || jsonb_build_object('coin', p_coin); end if;
  cap := coalesce(nullif(s ->> 'budget', '')::int, 50000);
  flr := coalesce(nullif(s ->> 'min_spend', '')::int, 0);
  if cap > 0 and flr > cap then return jsonb_build_object('ok', false, 'error', 'the minimum spend can''t be above the budget'); end if;
  update league set settings_json = s where id = p_league;
  select * into lg from league where id = p_league;
  if p_coin then
    perform _contest_seed_coin(p_league, lm.sleeper_roster_id) from league_membership lm
     where lm.league_id = p_league and lm.enrolled and lm.app_user_id is not null and coalesce(lm.controller, 'human') <> 'ai';
  end if;
  return jsonb_build_object('ok', true, 'bullseye', _bullseye_info(lg));
end $$;

drop function if exists _contest_take_seat(uuid, text, boolean);
create or replace function _contest_take_seat(p_league uuid, p_team_name text, p_another boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; seat league_membership; rid int; nm text; held int; mx int;
begin
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() order by sleeper_roster_id limit 1;
  if me.id is not null and not p_another then
    if not me.enrolled then update league_membership set enrolled = true where id = me.id; end if;
    return jsonb_build_object('ok', true, 'already', me.enrolled, 'league_id', p_league, 'league', lg.name,
      'roster_id', me.sleeper_roster_id, 'team', me.team_name);
  end if;
  -- ANOTHER ENTRY (0481): a member already seated takes a second seat, under
  -- the league's entries-per-member rule.
  if me.id is not null and p_another then
    mx := _contest_max_entries(lg);
    select count(*) into held from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled;
    if held >= mx then
      return jsonb_build_object('ok', false, 'error', case when mx = 1 then 'one entry per member here' else 'you hold all ' || mx || ' of your entries here' end);
    end if;
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtext('contest-seat|' || p_league::text));
  if _contest_format_of(lg) = 'h2h' then
    select m.* into seat from league_membership m
     where m.league_id = p_league and m.app_user_id is null
     order by m.sleeper_roster_id limit 1;
    if seat.id is null then return jsonb_build_object('ok', false, 'error', 'this league is full'); end if;
    nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), seat.team_name);
    update league_membership set app_user_id = auth.uid(), enrolled = true, controller = 'human', team_name = nm where id = seat.id;
    if _contest_coin_on(lg) then perform _contest_seed_coin(p_league, seat.sleeper_roster_id); end if;
    return jsonb_build_object('ok', true, 'league_id', p_league, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', nm);
  end if;
  if _league_seats_taken(p_league) >= _bullseye_max_seats(lg) then
    return jsonb_build_object('ok', false, 'error', 'this league is full');
  end if;
  select coalesce(max(sleeper_roster_id), 0) + 1 into rid from league_membership where league_id = p_league;
  nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(rid));
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
  values (p_league, rid, 'CON-' || rid, auth.uid(), true, nm, 'human');
  if _contest_coin_on(lg) then perform _contest_seed_coin(p_league, rid); end if;
  return jsonb_build_object('ok', true, 'league_id', p_league, 'league', lg.name, 'roster_id', rid, 'team', nm);
end $$;

create or replace function _bullseye_take_seat(p_league uuid, p_team_name text)
  returns jsonb language sql security definer set search_path = public as $$ select _contest_take_seat(p_league, p_team_name, false); $$;
create or replace function _bullseye_info(lg league) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when _is_contest(lg) then jsonb_build_object(
    'contest', _contest_of(lg),
    'format', _contest_format_of(lg),
    'budget', _contest_budget(lg),
    'min_spend', _contest_min_spend(lg),
    'auto_sub', coalesce((lg.settings_json ->> 'auto_sub')::boolean, false),
    'late_entry', _contest_late_entry(lg),
    'entry_deadline', _contest_entry_deadline(lg),
    'max_entries', _contest_max_entries(lg),
    'coin', _contest_coin_on(lg),
    'my_entries', (select count(*)::int from league_membership m where m.league_id = lg.id and m.app_user_id = auth.uid() and m.enrolled),
    'dues_amount', nullif(lg.settings_json ->> 'dues_amount', '')::int,
    'dues_note', lg.settings_json ->> 'dues_note',
    'prizes', _league_prizes(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', coalesce(_bullseye_max_seats(lg), (select count(*)::int from league_membership m where m.league_id = lg.id)),
    'seats_taken', _league_seats_taken(lg.id),
    'spots', jsonb_array_length(_contest_slots(lg)))
  else null end;
$$;

create or replace function contest_state(p_league uuid, p_week int default null, p_season text default '2026', p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; opp int; st matchup_state; started boolean; mine jsonb; theirs jsonb; spots jsonb;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  wk := coalesce(p_week, lg.contest_week,
    (select min(week) from matchup where league_id = p_league and status <> 'final'),
    (select max(week) from matchup where league_id = p_league), _contest_week(p_season));
  if me.id is not null then
    select * into m from matchup where league_id = p_league and week = wk
       and me.sleeper_roster_id in (home_roster_id, away_roster_id) limit 1;
  end if;
  opp := case when m.id is null then null when m.home_roster_id = me.sleeper_roster_id then m.away_roster_id else m.home_roster_id end;
  if opp = me.sleeper_roster_id then opp := null; end if;
  started := coalesce(_week_first_lock(p_season, wk) <= now(), false);
  select starters_json into mine from sleeper_lineup where league_id = p_league and week = wk and roster_id = me.sleeper_roster_id;
  if opp is not null then
    select jsonb_agg(case when _dfs_player_locked(p_season, wk, e ->> 'player_slug') then e
                          else jsonb_build_object('slot', e -> 'slot', 'sealed', true) end order by ord)
      into theirs
      from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) with ordinality x(e, ord)
     where sl.league_id = p_league and sl.week = wk and sl.roster_id = opp;
  end if;
  select * into st from matchup_state where matchup_id = m.id and game_window = 'wk';
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  return jsonb_build_object('ok', true, 'on', true, 'kind', lg.kind, 'name', lg.name, 'week', wk, 'season', p_season,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg), 'budget', _contest_budget(lg), 'min_spend', _contest_min_spend(lg), 'slots', spots,
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'positions_extra', coalesce(lg.settings_json -> 'positions_extra', '[]'::jsonb),
    'scoring_classic', lg.settings_json -> 'scoring_classic', 'ppr', coalesce((lg.settings_json ->> 'ppr')::numeric, 1),
    'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'started', started,
    'seats', _my_contest_seats_json(p_league), 'max_entries', _contest_max_entries(lg),
    'coin', _contest_coin_on(lg), 'wallet', (select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = me.sleeper_roster_id),
    'entry', mine,
    'matchup', case when m.id is null then null else jsonb_build_object('id', m.id, 'status', m.status,
      'home', m.home_roster_id, 'away', m.away_roster_id, 'home_final', m.home_final, 'away_final', m.away_final,
      'home_tb', m.home_tb, 'away_tb', m.away_tb) end,
    'opponent', case when opp is null then null else jsonb_build_object('roster_id', opp,
      'team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = opp limit 1),
      'entry', theirs) end,
    'state', case when st.matchup_id is null or not started then null else jsonb_build_object(
      'home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end);
end $$;

create or replace function bullseye_my_weeks(p_league uuid, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me league_membership; out jsonb; lg league; golf boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  golf := _contest_lower_wins(lg);
  with sides as (
    select m.week, m.status, m.home_roster_id as roster_id, m.home_tb as tb, coalesce(m.home_final, st.home_score) as ring,
           case when m.away_roster_id <> m.home_roster_id then m.away_roster_id end as opp, coalesce(m.away_final, st.away_score) as opp_ring,
           m.is_playoff, m.playoff_label
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk' where m.league_id = p_league
    union all
    select m.week, m.status, m.away_roster_id, m.away_tb, coalesce(m.away_final, st.away_score), m.home_roster_id, coalesce(m.home_final, st.home_score),
           m.is_playoff, m.playoff_label
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
     where m.league_id = p_league and m.away_roster_id <> m.home_roster_id
  ), ranked as (
    select sides.*, rank() over (partition by week order by case when golf then coalesce(ring, 0) else -coalesce(ring, 0) end asc, tb asc nulls last) as rank,
           count(*) over (partition by week) as entries
      from sides
  )
  select coalesce(jsonb_agg(jsonb_build_object('week', r.week, 'status', r.status, 'ring', r.ring, 'tb', r.tb,
           'rank', case when r.status in ('live', 'final') then r.rank end, 'entries', r.entries,
           'opp', r.opp, 'opp_team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = r.opp limit 1),
           'opp_ring', r.opp_ring, 'void', _week_void(p_league, r.week), 'playoff', r.is_playoff, 'label', r.playoff_label) order by r.week desc), '[]'::jsonb)
    into out from ranked r where r.roster_id = me.sleeper_roster_id;
  return jsonb_build_object('ok', true, 'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'weeks', out, 'seats', _my_contest_seats_json(p_league),
    'wallet', case when _contest_coin_on(lg) then jsonb_build_object(
      'coins', coalesce((select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = me.sleeper_roster_id), 0),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('week', c.week, 'reason', c.reason, 'delta', c.delta, 'at', c.created_at) order by c.created_at desc, c.id desc)
                           from (select * from coin_ledger c where c.league_id = p_league and c.roster_id = me.sleeper_roster_id order by c.created_at desc, c.id desc limit 24) c), '[]'::jsonb)) end);
end $$;

create or replace function contest_settle_coin(p_league uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; lower_ boolean; variant text; radius numeric; nslots int; lk timestamptz; seat record; st matchup_state;
        lines int := 0; seats int := 0; built boolean; streak int := 0; w int; dead int; bal numeric; pr numeric; weeks_final int;
        cheap numeric; pricey numeric; bargain boolean; lost boolean; margin numeric;
begin
  if auth.uid() is not null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can settle a week'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not _contest_coin_on(lg) then return jsonb_build_object('ok', false, 'error', 'drip coin is off here'); end if;
  if _week_void(p_league, p_week) then return jsonb_build_object('ok', true, 'void', true, 'seats', 0, 'lines', 0); end if;
  if not exists (select 1 from matchup where league_id = p_league and week = p_week and not coalesce(is_playoff, false))
     or exists (select 1 from matchup where league_id = p_league and week = p_week and status <> 'final') then
    return jsonb_build_object('ok', false, 'error', 'the week is not final');
  end if;
  lower_ := _contest_lower_wins(lg);
  variant := coalesce(lg.settings_json ->> 'bullseye', 'slots');
  radius := coalesce(nullif(lg.settings_json ->> 'bullseye_radius', '')::numeric, 10);
  nslots := jsonb_array_length(_contest_slots(lg));
  lk := _week_first_lock(lg.season, p_week);
  select count(distinct m.week) into weeks_final from matchup m where m.league_id = p_league and m.status = 'final' and m.week <= p_week
    and not coalesce(m.is_playoff, false) and not _week_void(p_league, m.week);

  -- THE WEEK, ranked by the contest's own rule, the human seats only.
  perform set_config('client_min_messages', 'warning', true);
  drop table if exists _cs;
  create temp table _cs as
  with sides as (
    select m.id as matchup_id, m.home_roster_id as roster_id, m.home_final as score,
           case when m.away_roster_id <> m.home_roster_id then m.away_roster_id end as opp, m.away_final as opp_score, 'home' as side
      from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final' and not coalesce(m.is_playoff, false)
    union all
    select m.id, m.away_roster_id, m.away_final, m.home_roster_id, m.home_final, 'away'
      from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final' and not coalesce(m.is_playoff, false) and m.away_roster_id <> m.home_roster_id
  ), ranked as (
    select s.*, row_number() over (order by case when lower_ then s.score else -s.score end asc nulls last, s.roster_id) as pos, count(*) over () as n from sides s
  )
  select r.* from ranked r join league_membership lm on lm.league_id = p_league and lm.sleeper_roster_id = r.roster_id
   where lm.enrolled and lm.app_user_id is not null and coalesce(lm.controller, 'human') <> 'ai';

  -- THE SEASON: who sits in the worse half of the standings so far (two weeks in or more).
  drop table if exists _cst;
  create temp table _cst as
  with fin as (
    select m.home_roster_id as rid, m.home_final as f from matchup m
     where m.league_id = p_league and m.status = 'final' and m.week <= p_week and not coalesce(m.is_playoff, false) and not _week_void(p_league, m.week)
    union all
    select m.away_roster_id, m.away_final from matchup m
     where m.league_id = p_league and m.status = 'final' and m.week <= p_week and not coalesce(m.is_playoff, false) and not _week_void(p_league, m.week) and m.away_roster_id <> m.home_roster_id
  ), tot as (
    select lm.sleeper_roster_id as rid, coalesce(sum(fin.f), 0) as total from league_membership lm left join fin on fin.rid = lm.sleeper_roster_id
     where lm.league_id = p_league and lm.enrolled group by lm.sleeper_roster_id
  )
  select rid, total, percent_rank() over (order by case when lower_ then total else -total end) as pr from tot;

  for seat in select * from _cs loop
    seats := seats + 1;
    select * into st from matchup_state where matchup_id = seat.matchup_id and game_window = 'wk';
    -- SHOWING UP: a squad of your own, saved before the first kickoff (contest_build; the CPU's build writes none)
    built := exists (select 1 from contest_build b where b.league_id = p_league and b.week = p_week and b.roster_id = seat.roster_id and b.by_user is not null and (lk is null or b.at < lk));
    if built then
      if _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 40, 'built') then lines := lines + 1; end if;
      -- THE STREAK: weeks in a row with a squad of your own, 5 a week up to 25
      streak := 0; w := p_week - 1;
      while w >= 1 and streak < 5 and exists (select 1 from coin_ledger c where c.league_id = p_league and c.roster_id = seat.roster_id and c.week = w and c.reason = 'built') loop
        streak := streak + 1; w := w - 1;
      end loop;
      if streak > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 5 * streak, 'streak') then lines := lines + 1; end if;
    end if;
    if st.matchup_id is not null then
      -- THE BARGAIN: a player priced in the bottom third of his position who doubled his projection
      select exists (
        select 1 from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) e
          join pod_salary ps on ps.season = lg.season and ps.week = p_week and ps.slug = e ->> 'player_slug'
          join lateral (select (x ->> 'score')::numeric as score from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x
                         where x ->> 'side' = seat.side and x ->> 'slot' = e ->> 'slot' limit 1) sc on true
         where sl.league_id = p_league and sl.week = p_week and sl.roster_id = seat.roster_id
           and coalesce(ps.proj, 0) > 0 and sc.score >= 2 * ps.proj
           and ps.salary <= (select percentile_cont(0.34) within group (order by q.salary) from pod_salary q where q.season = lg.season and q.week = p_week and q.pos = ps.pos)
      ) into bargain;
      if bargain and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 15, 'bargain') then lines := lines + 1; end if;
      -- THE CALL: the cheapest spot outscored the priciest (a salary tie goes the member's way)
      select min(t.score) filter (where t.rn_cheap = 1), min(t.score) filter (where t.rn_dear = 1) into cheap, pricey from (
        select sc.score, row_number() over (order by ps.salary asc, sc.score desc, ps.slug) as rn_cheap, row_number() over (order by ps.salary desc, sc.score asc, ps.slug) as rn_dear
          from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) e
          join pod_salary ps on ps.season = lg.season and ps.week = p_week and ps.slug = e ->> 'player_slug'
          join lateral (select (x ->> 'score')::numeric as score from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x
                         where x ->> 'side' = seat.side and x ->> 'slot' = e ->> 'slot' limit 1) sc on true
         where sl.league_id = p_league and sl.week = p_week and sl.roster_id = seat.roster_id) t;
      if cheap is not null and pricey is not null and cheap > pricey and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 10, 'call') then lines := lines + 1; end if;
      -- DEAD-ON (Bullseye): a spot inside the bullseye band, 10 each up to 30; a one-team total inside its band, 30
      if _contest_of(lg) = 'bullseye' then
        if variant = 'total' then
          dead := case when seat.score is not null and seat.score <= radius * nslots / 20 then 3 else 0 end;
        else
          select count(*) into dead from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x
           where x ->> 'side' = seat.side and (x -> 'aim' ->> 'dist')::numeric <= radius / 20;
        end if;
        if dead > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 10 * least(dead, 3), 'deadon') then lines := lines + 1; end if;
      end if;
    end if;
    -- THE RESULT, INVERTED: a loss pays, a win already paid
    if seat.opp is not null and seat.score is not null and seat.opp_score is not null and seat.score <> seat.opp_score then
      lost := case when lower_ then seat.score > seat.opp_score else seat.score < seat.opp_score end;
      margin := abs(seat.score - seat.opp_score);
      if lost and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, case when margin < 10 then 25 else 15 end, case when margin < 10 then 'heartbreaker' else 'loss' end) then lines := lines + 1; end if;
    elsif seat.opp is null and seat.n >= 2 and seat.pos > ceil(seat.n / 2.0) then   -- below the middle seat
      if _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 20, 'bottomhalf') then lines := lines + 1; end if;
    end if;
    -- CATCH-UP: below the season's median, until you cross it
    if lg.contest_week is null and weeks_final >= 2 then
      select t.pr into pr from _cst t where t.rid = seat.roster_id;
      if pr > 0.5 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 10, 'catchup') then lines := lines + 1; end if;
    end if;
    -- THE CEILING: a wallet above 150 burns down to 150, so nobody banks a season for the playoffs
    select coins into bal from team_wallet where league_id = p_league and roster_id = seat.roster_id;
    if bal > 150 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, 150 - bal, 'cap') then lines := lines + 1; end if;
  end loop;
  drop table if exists _cs; drop table if exists _cst;
  return jsonb_build_object('ok', true, 'seats', seats, 'lines', lines);
end $$;

revoke all on function _contest_coin_on(league), _contest_credit(uuid, int, int, uuid, numeric, text), _contest_seed_coin(uuid, int), _contest_take_seat(uuid, text, boolean) from public, anon, authenticated;
revoke all on function set_contest_rules(uuid, text, text, int, int, boolean, text, text, int, boolean), contest_settle_coin(uuid, int) from public, anon;
grant execute on function set_contest_rules(uuid, text, text, int, int, boolean, text, text, int, boolean), contest_settle_coin(uuid, int) to authenticated;
