-- 0489: THE COIN RULES (v0.692.0)
--
-- Founder: "Let's have a standard suite of ways to earn drip coin, but create
-- a section in the commish settings for weekly competition leagues for
-- commissioners to change the events that earn coin and the values. Also
-- edit individual purses and set any allowance."
--
-- The standard suite is 0483's — pay for showing up, reading the board and
-- losing, never for winning — written down once as `_contest_coin_defaults`
-- (the engine's CONTEST_COIN_DEFAULTS is the same list; a probe keeps them
-- in step). A league's overrides live in `settings_json.coin_rules`; a
-- value of 0 turns an event off; the ceiling at 0 is no ceiling. Two
-- events are new: the ALLOWANCE (every seat, every week, whatever happened)
-- and the commissioner's own hand on a purse (`commish_adjust_contest_wallet`,
-- reason 'commish', with a house line). contest_settle_coin is the live 0483
-- body reading every amount off the rules.

-- ═══ 1. the suite ═══════════════════════════════════════════════════════════
create or replace function _contest_coin_defaults() returns jsonb
  language sql immutable as $$
  select '{"seed": 100, "allowance": 0, "built": 40, "streak": 5, "streak_cap": 25, "bargain": 15, "call": 10,
           "deadon": 10, "deadon_cap": 30, "heartbreaker": 25, "loss": 15, "bottomhalf": 20, "catchup": 10, "cap": 150}'::jsonb;
$$;
create or replace function _contest_coin_rules(lg league) returns jsonb
  language sql immutable as $$
  select _contest_coin_defaults() || coalesce(case when jsonb_typeof(lg.settings_json -> 'coin_rules') = 'object' then lg.settings_json -> 'coin_rules' end, '{}'::jsonb);
$$;
revoke all on function _contest_coin_rules(league) from public, anon, authenticated;

-- THE SEED reads the rules: a league whose starting coin is 0 seeds nobody.
create or replace function _contest_seed_coin(p_league uuid, p_roster int) returns boolean
  language plpgsql security definer set search_path = public as $$
declare lg league; v numeric;
begin
  select * into lg from league where id = p_league;
  if lg.id is null then return false; end if;
  v := (_contest_coin_rules(lg) ->> 'seed')::numeric;
  if v <= 0 then return false; end if;
  return adjust_wallet(p_league, p_roster, null, null, v, 'seed', 'contest:seed:' || p_league::text || ':' || p_roster);
end $$;
revoke all on function _contest_seed_coin(uuid, int) from public, anon, authenticated;

-- ═══ 2. the console's read ══════════════════════════════════════════════════
create or replace function contest_coin_rules(p_league uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare lg league;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_member(p_league) or is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'coin', _contest_coin_on(lg), 'rules', _contest_coin_rules(lg), 'defaults', _contest_coin_defaults());
end $$;
grant execute on function contest_coin_rules(uuid) to authenticated;

-- ═══ 3. the commissioner's hand on the rules ════════════════════════════════
-- p_rules replaces the overrides whole: every key must be one of the suite's,
-- every value a number 0–100000. The league hears what differs from standard.
create or replace function set_contest_coin_rules(p_league uuid, p_rules jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lg league; defs jsonb; k text; v jsonb; over jsonb := '{}'::jsonb; said text[] := '{}'; rules jsonb;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can set the coin rules'); end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then return jsonb_build_object('ok', false, 'error', 'rules are an object of event → coin'); end if;
  defs := _contest_coin_defaults();
  for k, v in select * from jsonb_each(p_rules) loop
    if not (defs ? k) then return jsonb_build_object('ok', false, 'error', 'not a coin event: ' || k); end if;
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 or (v::text)::numeric > 100000 then
      return jsonb_build_object('ok', false, 'error', k || ' is a number from 0 to 100000');
    end if;
    if (v::text)::numeric <> (defs ->> k)::numeric then
      over := over || jsonb_build_object(k, round((v::text)::numeric));
      said := said || (k || ' ' || case when (v::text)::numeric = 0 then 'off' else '◎' || round((v::text)::numeric)::text end);
    end if;
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('coin_rules', over) where id = p_league;
  select * into lg from league where id = p_league;
  rules := _contest_coin_rules(lg);
  perform _chat_house(p_league,
    '◎ Coin rules: ' || case when cardinality(said) = 0 then 'the standard suite' else array_to_string(said, ', ') || '; the rest standard' end,
    jsonb_build_object('kind', 'coin_rules', 'rules', over));
  return jsonb_build_object('ok', true, 'coin', _contest_coin_on(lg), 'rules', rules, 'defaults', defs);
end $$;
grant execute on function set_contest_coin_rules(uuid, jsonb) to authenticated;

-- ═══ 4. the purses ══════════════════════════════════════════════════════════
create or replace function contest_wallets(p_league uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare lg league;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner sees every purse'); end if;
  return jsonb_build_object('ok', true, 'coin', _contest_coin_on(lg), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('roster_id', lm.sleeper_roster_id, 'team', coalesce(nullif(lm.team_name, ''), 'Team ' || lm.sleeper_roster_id),
                                        'coins', coalesce(w.coins, 0), 'human', lm.app_user_id is not null and coalesce(lm.controller, 'human') <> 'ai')
                     order by lm.sleeper_roster_id)
      from league_membership lm left join team_wallet w on w.league_id = lm.league_id and w.roster_id = lm.sleeper_roster_id
     where lm.league_id = p_league and lm.enrolled), '[]'::jsonb));
end $$;
grant execute on function contest_wallets(uuid) to authenticated;

-- The commissioner's hand on one purse: a signed amount and a note, never
-- idempotent (every press is its own line), and the league hears it.
create or replace function commish_adjust_contest_wallet(p_league uuid, p_roster int, p_delta numeric, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lg league; bal numeric; nm text;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can edit a purse'); end if;
  if not _contest_coin_on(lg) then return jsonb_build_object('ok', false, 'error', 'drip coin is off here'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then return jsonb_build_object('ok', false, 'error', 'an amount from −100000 to 100000, not 0'); end if;
  if not exists (select 1 from league_membership where league_id = p_league and sleeper_roster_id = p_roster and enrolled) then
    return jsonb_build_object('ok', false, 'error', 'no such seat');
  end if;
  perform adjust_wallet(p_league, p_roster, null, null, round(p_delta), 'commish', 'commish:' || p_league::text || ':' || p_roster || ':' || gen_random_uuid()::text);
  select coins into bal from team_wallet where league_id = p_league and roster_id = p_roster;
  nm := _txn_team(p_league, p_roster);
  perform _chat_house(p_league,
    '◎ The commissioner ' || case when p_delta > 0 then 'gave ' || nm || ' ◎' || round(p_delta)::text else 'took ◎' || round(-p_delta)::text || ' from ' || nm end
      || case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else ' — ' || left(btrim(p_note), 120) end,
    jsonb_build_object('kind', 'coin', 'roster_id', p_roster, 'delta', round(p_delta)));
  return jsonb_build_object('ok', true, 'roster_id', p_roster, 'coins', coalesce(bal, 0));
end $$;
grant execute on function commish_adjust_contest_wallet(uuid, int, numeric, text) to authenticated;

-- ═══ 5. the settle, reading the rules ═══════════════════════════════════════
create or replace function contest_settle_coin(p_league uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; lower_ boolean; variant text; radius numeric; nslots int; lk timestamptz; seat record; st matchup_state;
        lines int := 0; seats int := 0; built boolean; streak int := 0; w int; dead int; bal numeric; pr numeric; weeks_final int;
        cheap numeric; pricey numeric; bargain boolean; lost boolean; margin numeric;
        rules jsonb; rv numeric; rcap numeric;   -- 0489: the league's coin rules
begin
  if auth.uid() is not null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can settle a week'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not _contest_coin_on(lg) then return jsonb_build_object('ok', false, 'error', 'drip coin is off here'); end if;
  rules := _contest_coin_rules(lg);
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
      rv := (rules ->> 'built')::numeric;
      if rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rv, 'built') then lines := lines + 1; end if;
      -- THE STREAK: weeks in a row with a squad of your own, so much a week up to the cap (0489: the rules')
      streak := 0; w := p_week - 1;
      while w >= 1 and streak < 60 and exists (select 1 from coin_ledger c where c.league_id = p_league and c.roster_id = seat.roster_id and c.week = w and c.reason = 'built') loop
        streak := streak + 1; w := w - 1;
      end loop;
      rv := (rules ->> 'streak')::numeric; rcap := (rules ->> 'streak_cap')::numeric;
      if streak > 0 and rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, case when rcap > 0 then least(rv * streak, rcap) else rv * streak end, 'streak') then lines := lines + 1; end if;
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
      rv := (rules ->> 'bargain')::numeric;
      if bargain and rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rv, 'bargain') then lines := lines + 1; end if;
      -- THE CALL: the cheapest spot outscored the priciest (a salary tie goes the member's way)
      select min(t.score) filter (where t.rn_cheap = 1), min(t.score) filter (where t.rn_dear = 1) into cheap, pricey from (
        select sc.score, row_number() over (order by ps.salary asc, sc.score desc, ps.slug) as rn_cheap, row_number() over (order by ps.salary desc, sc.score asc, ps.slug) as rn_dear
          from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) e
          join pod_salary ps on ps.season = lg.season and ps.week = p_week and ps.slug = e ->> 'player_slug'
          join lateral (select (x ->> 'score')::numeric as score from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x
                         where x ->> 'side' = seat.side and x ->> 'slot' = e ->> 'slot' limit 1) sc on true
         where sl.league_id = p_league and sl.week = p_week and sl.roster_id = seat.roster_id) t;
      rv := (rules ->> 'call')::numeric;
      if cheap is not null and pricey is not null and cheap > pricey and rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rv, 'call') then lines := lines + 1; end if;
      -- DEAD-ON (Bullseye): a spot inside the bullseye band, 10 each up to 30; a one-team total inside its band, 30
      if _contest_of(lg) = 'bullseye' then
        if variant = 'total' then
          dead := case when seat.score is not null and seat.score <= radius * nslots / 20 then 3 else 0 end;
        else
          select count(*) into dead from jsonb_array_elements(coalesce(st.slot_scores, '[]'::jsonb)) x
           where x ->> 'side' = seat.side and (x -> 'aim' ->> 'dist')::numeric <= radius / 20;
        end if;
        rv := (rules ->> 'deadon')::numeric; rcap := (rules ->> 'deadon_cap')::numeric;
        if dead > 0 and rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, case when rcap > 0 then least(rv * dead, rcap) else rv * dead end, 'deadon') then lines := lines + 1; end if;
      end if;
    end if;
    -- THE RESULT, INVERTED: a loss pays, a win already paid
    if seat.opp is not null and seat.score is not null and seat.opp_score is not null and seat.score <> seat.opp_score then
      lost := case when lower_ then seat.score > seat.opp_score else seat.score < seat.opp_score end;
      margin := abs(seat.score - seat.opp_score);
      rv := case when margin < 10 then (rules ->> 'heartbreaker')::numeric else (rules ->> 'loss')::numeric end;
      if lost and rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rv, case when margin < 10 then 'heartbreaker' else 'loss' end) then lines := lines + 1; end if;
    elsif seat.opp is null and seat.n >= 2 and seat.pos > ceil(seat.n / 2.0) then   -- below the middle seat
      rv := (rules ->> 'bottomhalf')::numeric;
      if rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rv, 'bottomhalf') then lines := lines + 1; end if;
    end if;
    -- CATCH-UP: below the season's median, until you cross it
    if lg.contest_week is null and weeks_final >= 2 then
      select t.pr into pr from _cst t where t.rid = seat.roster_id;
      rv := (rules ->> 'catchup')::numeric;
      if pr > 0.5 and rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rv, 'catchup') then lines := lines + 1; end if;
    end if;
    -- THE ALLOWANCE (0489): every seat, every week the league plays, whatever happened
    rv := (rules ->> 'allowance')::numeric;
    if rv > 0 and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rv, 'allowance') then lines := lines + 1; end if;
    -- THE CEILING: a wallet above it burns down to it, so nobody banks a season for the playoffs (0489: the rules'; 0 = none)
    rcap := (rules ->> 'cap')::numeric;
    select coins into bal from team_wallet where league_id = p_league and roster_id = seat.roster_id;
    if rcap > 0 and bal > rcap and _contest_credit(p_league, p_week, seat.roster_id, seat.matchup_id, rcap - bal, 'cap') then lines := lines + 1; end if;
  end loop;
  drop table if exists _cs; drop table if exists _cst;
  return jsonb_build_object('ok', true, 'seats', seats, 'lines', lines);
end $$;

-- contest_settle_coin keeps its grants (create or replace keeps them).
