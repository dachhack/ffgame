-- 0492: THE AI SEATS PLAY (v0.699.0)
--
-- Founder: "Let's add power up purchase and use to the AI seats in weekly
-- contest leagues with drip coin." Three things: the arm's rules move into
-- _contest_arm_core, shared by the member's contest_arm_play (its live 0491
-- body, split at "whose seat is this") and the new ai_contest_play (service
-- role: the worker, each week before the first kickoff, with the engine's
-- picks); an AI seat's wallet opens on its first play with the league's
-- seed; and contest_settle_coin (0489's body) pays the AI seats like
-- anyone — they are in the week's ranking and the season's — so they can
-- keep buying.

-- The arm, shared (0492): everything after "whose seat is this" — the price, the cap, the offer rules, the spot, the
-- window, Underdog's bottom third, Double or Nothing's and Floor's line, the phantom's swap, the hand or the wallet,
-- the row. contest_arm_play (a member, by auth.uid()) and ai_contest_play (an AI seat, by nobody) both end here.
create or replace function _contest_arm_core(lg league, seat league_membership, p_week int, p_play text, p_slot text, p_by uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare price int; held int; cap int; sl text; pslug text; ps pod_salary; cut numeric; r jsonb; proj_ numeric;
        old jsonb; nw jsonb; n int; have int;
begin
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then return jsonb_build_object('ok', false, 'error', 'wrong week for this contest'); end if;
  price := _contest_play_price(p_play);
  if price is null then return jsonb_build_object('ok', false, 'error', 'no such play'); end if;
  if exists (select 1 from matchup m where m.league_id = lg.id and m.week = p_week and m.status = 'final') then return jsonb_build_object('ok', false, 'error', 'the week is final'); end if;
  cap := _contest_play_cap(lg);
  select count(*) into held from contest_play c where c.league_id = lg.id and c.week = p_week and c.roster_id = seat.sleeper_roster_id;
  if held >= cap then return jsonb_build_object('ok', false, 'error', case when cap = 1 then 'one play a week here' else 'two plays a week here' end); end if;
  -- PR 3 (0485): the head-to-head pair wants an opponent; the Bullseye pair wants the dart
  if p_play in ('spy', 'jinx', 'smoke', 'mirror', 'curse') and _contest_format_of(lg) <> 'h2h' then return jsonb_build_object('ok', false, 'error', 'a head-to-head play'); end if;   -- 0491
  if p_play in ('floor', 'garbage-time', 'mirror', 'curse') and _contest_of(lg) <> 'high' then return jsonb_build_object('ok', false, 'error', 'a high-score play'); end if;   -- 0491
  if p_play in ('magnet', 're-deal') and _contest_of(lg) <> 'bullseye' then return jsonb_build_object('ok', false, 'error', 'a Bullseye play'); end if;
  if _contest_plays_off(lg) ? p_play then return jsonb_build_object('ok', false, 'error', 'the commissioner turned this play off here'); end if;   -- 0490
  sl := nullif(btrim(coalesce(p_slot, '')), '');
  if _contest_squad_play(p_play) or (p_play = 'magnet' and coalesce(lg.settings_json ->> 'bullseye', 'slots') = 'total') then sl := null;   -- 0491: the squad plays by name
  elsif sl is null then return jsonb_build_object('ok', false, 'error', 'pick a spot for it');
  elsif sl !~ '^S[0-9]+$' or substr(sl, 2)::int < 1 or substr(sl, 2)::int > jsonb_array_length(_contest_slots(lg)) then return jsonb_build_object('ok', false, 'error', 'no such spot');
  end if;
  if exists (select 1 from contest_play c where c.league_id = lg.id and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.play_id = p_play and c.slot_key = coalesce(sl, '')) then
    return jsonb_build_object('ok', false, 'error', 'that play is already armed');
  end if;
  if sl is not null and p_play not in ('spy', 'jinx') and exists (select 1 from contest_play c where c.league_id = lg.id and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.slot = sl and c.play_id not in ('spy', 'jinx')) then
    return jsonb_build_object('ok', false, 'error', 'that spot already carries a play');
  end if;
  select starters_json into old from sleeper_lineup where league_id = lg.id and week = p_week and roster_id = seat.sleeper_roster_id;
  if sl is not null then
    select e ->> 'player_slug' into pslug from jsonb_array_elements(coalesce(old, '[]'::jsonb)) e where e ->> 'slot' = sl and nullif(e ->> 'player_slug', '') is not null limit 1;
  end if;
  -- 0490 (founder: "Shouldn't this be playable until a player's individual kick off?"): a play on one of MY spots
  -- with a player in it arms until HIS kickoff; Jinx, on their spot, until THEIR player's; everything squad-wide —
  -- Hail Mary, Pick Six, Re-deal, a one-team-total Magnet, Spy, and a play on an empty spot — before the week's first kickoff.
  r := _contest_play_window(lg, p_week, p_play, sl, pslug, seat.sleeper_roster_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  if p_play = 'underdog' then
    if pslug is null then return jsonb_build_object('ok', false, 'error', 'Underdog takes a spot with a player in it'); end if;
    select * into ps from pod_salary where season = lg.season and week = p_week and slug = pslug;
    select percentile_cont(0.34) within group (order by q.salary) into cut from pod_salary q where q.season = lg.season and q.week = p_week and q.pos = ps.pos;
    if ps.slug is null or ps.salary > cut then return jsonb_build_object('ok', false, 'error', 'Underdog takes a player priced in the bottom third of his position'); end if;
  elsif p_play = 'double-or-nothing' then
    if pslug is null then return jsonb_build_object('ok', false, 'error', 'stake a spot with a player in it'); end if;
    select * into ps from pod_salary where season = lg.season and week = p_week and slug = pslug;
    if coalesce(ps.proj, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'he has no projection to beat'); end if;
    proj_ := ps.proj;
  elsif p_play = 'floor' then
    -- FLOOR (0491): his projection is the floor, remembered on the row as Double or Nothing remembers its line
    if pslug is null then return jsonb_build_object('ok', false, 'error', 'stake a spot with a player in it'); end if;
    select * into ps from pod_salary where season = lg.season and week = p_week and slug = pslug;
    if coalesce(ps.proj, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'he has no projection to hold'); end if;
    proj_ := ps.proj;
  elsif p_play in ('garbage-time', 'smoke', 'mirror') and pslug is null then
    return jsonb_build_object('ok', false, 'error', 'it takes a spot with a player in it');
  elsif p_play = 'magnet' and sl is not null and pslug is null then
    return jsonb_build_object('ok', false, 'error', 'Magnet takes a spot with a player in it');
  elsif p_play = 'ghost' and pslug is not null then
    -- the player there steps out (a swap in the history), the phantom takes the spot
    nw := coalesce((select jsonb_agg(e) from jsonb_array_elements(old) e where e ->> 'slot' <> sl), '[]'::jsonb);
    update sleeper_lineup set starters_json = nw where league_id = lg.id and week = p_week and roster_id = seat.sleeper_roster_id;
    perform _log_contest_swaps(lg.id, p_week, seat.sleeper_roster_id, old, nw, 'swap', p_by);
  end if;
  -- THE HAND (0486): a card bought in the shop plays from the hand; with none
  -- in hand, the wallet buys and plays it in one (the web's PLAYS chips).
  select qty into have from team_inventory where league_id = lg.id and roster_id = seat.sleeper_roster_id and powerup_id = p_play;
  if coalesce(have, 0) > 0 then
    perform bump_inventory(lg.id, seat.sleeper_roster_id, p_play, -1);
  else
    r := spend_from_wallet(lg.id, seat.sleeper_roster_id, price, null, p_week, 'play:' || p_play,
           'play:' || lg.id::text || ':' || p_week || ':' || seat.sleeper_roster_id || ':' || p_play || ':' || coalesce(sl, '') || ':' || extract(epoch from clock_timestamp())::text);
    if not coalesce((r ->> 'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'not enough coin — ◎' || ceil(price - coalesce((r ->> 'balance')::numeric, 0)) || ' short');
    end if;
  end if;
  insert into contest_play (league_id, week, roster_id, play_id, slot, proj, price, by_user)
    values (lg.id, p_week, seat.sleeper_roster_id, p_play, sl, proj_, price, p_by);
  return jsonb_build_object('ok', true, 'roster_id', seat.sleeper_roster_id, 'plays', _contest_plays_json(lg.id, p_week, seat.sleeper_roster_id),
    'wallet', (select w.coins from team_wallet w where w.league_id = lg.id and w.roster_id = seat.sleeper_roster_id),
    'inventory', _contest_inventory_json(lg.id, seat.sleeper_roster_id));
end $$;

revoke all on function _contest_arm_core(league, league_membership, int, text, text, uuid) from public, anon, authenticated;

create or replace function contest_arm_play(p_league uuid, p_week int, p_play text, p_slot text default null, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not _contest_coin_on(lg) then return jsonb_build_object('ok', false, 'error', 'drip coin is off here'); end if;
  seat := _my_contest_seat(p_league, p_roster);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if p_roster is not null and seat.sleeper_roster_id <> p_roster then return jsonb_build_object('ok', false, 'error', 'that isn''t your seat'); end if;
  return _contest_arm_core(lg, seat, p_week, p_play, p_slot, auth.uid());
end $$;

-- THE AI'S PLAY (0492). Founder: "Let's add power up purchase and use to the AI seats in weekly contest leagues with
-- drip coin." The worker picks (engine aiContestPlays) and calls this with the service key; an AI seat buys and plays
-- in one from its wallet, under every rule a human's play meets. Its wallet opens on its first play with the league's
-- seed (a human's opens as they join). Service role only.
create or replace function ai_contest_play(p_league uuid, p_week int, p_roster int, p_play text, p_slot text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not _contest_coin_on(lg) then return jsonb_build_object('ok', false, 'error', 'drip coin is off here'); end if;
  select * into seat from league_membership where league_id = p_league and sleeper_roster_id = p_roster and (controller = 'ai' or app_user_id is null);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'not an AI seat'); end if;
  if not exists (select 1 from team_wallet where league_id = p_league and roster_id = p_roster) then perform _contest_seed_coin(p_league, p_roster); end if;
  return _contest_arm_core(lg, seat, p_week, p_play, p_slot, null);
end $$;
revoke all on function ai_contest_play(uuid, int, int, text, text) from public, anon, authenticated;

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

  -- THE WEEK, ranked by the contest's own rule — every seat, the AI's too (0492: they buy plays, so they earn).
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
   where (lm.enrolled and lm.app_user_id is not null) or coalesce(lm.controller, 'human') = 'ai';   -- 0492: the AI seats earn too

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
     where lm.league_id = p_league and (lm.enrolled or coalesce(lm.controller, 'human') = 'ai') group by lm.sleeper_roster_id   -- 0492
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

