-- 0491: THE SECOND DEAL (v0.696.0)
--
-- Founder: "Let's add these but no compound effect power ups. It should have
-- one effect and one effect only and it should be easy to explain in three
-- rows of text." Fourteen plays, each one effect: nine event bonuses from the
-- squad's real plays (Trick Play, Return Man, Bomb Squad, Hat Trick, Century
-- Club, Two for One, Iron Grip, Goal Line Stand, Long Boot — squad plays, no
-- spot), Floor and Garbage Time on one of my spots, and Smoke, Mirror and
-- Curse across the table (head-to-head). Floor, Garbage Time, Mirror and
-- Curse mean something only where higher wins, so they are high-score
-- plays. The scorer (engine scoreContest, the worker) applies them; here
-- the prices, the offer rules, the arm (Floor remembers the projection,
-- as Double or Nothing does), and the one data effect: a Smoked spot stays
-- sealed from their Spy (contest_matchup). Bodies are the live 0490 ones
-- (contest_matchup: 0485) with the marked lines.

create or replace function _contest_play_price(p_play text) returns int language sql immutable as $$
  select case p_play when 'underdog' then 35 when 'double-or-nothing' then 80 when 'ghost' then 75 when 'hail-mary' then 35 when 'pick-six' then 45
                     when 'spy' then 40 when 'jinx' then 55 when 'magnet' then 50 when 're-deal' then 40
                     when 'trick-play' then 35 when 'return-man' then 40 when 'bomb-squad' then 35 when 'hat-trick' then 50 when 'century-club' then 30
                     when 'two-for-one' then 25 when 'iron-grip' then 30 when 'goal-line-stand' then 45 when 'long-boot' then 25
                     when 'floor' then 60 when 'garbage-time' then 40 when 'smoke' then 45 when 'mirror' then 70 when 'curse' then 60 end;
$$;

-- A squad play arms with no spot (the one-team-total Magnet is the arm's own case).
create or replace function _contest_squad_play(p_play text) returns boolean language sql immutable as $$
  select p_play in ('hail-mary', 'pick-six', 're-deal', 'trick-play', 'return-man', 'bomb-squad', 'hat-trick', 'century-club', 'two-for-one', 'iron-grip', 'goal-line-stand', 'long-boot', 'curse');
$$;

create or replace function contest_buy_play(p_league uuid, p_play text, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; price int; r jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not _contest_coin_on(lg) then return jsonb_build_object('ok', false, 'error', 'drip coin is off here'); end if;
  seat := _my_contest_seat(p_league, p_roster);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if p_roster is not null and seat.sleeper_roster_id <> p_roster then return jsonb_build_object('ok', false, 'error', 'that isn''t your seat'); end if;
  price := _contest_play_price(p_play);
  if price is null then return jsonb_build_object('ok', false, 'error', 'no such play'); end if;
  if p_play in ('spy', 'jinx', 'smoke', 'mirror', 'curse') and _contest_format_of(lg) <> 'h2h' then return jsonb_build_object('ok', false, 'error', 'a head-to-head play'); end if;   -- 0491
  if p_play in ('floor', 'garbage-time', 'mirror', 'curse') and _contest_of(lg) <> 'high' then return jsonb_build_object('ok', false, 'error', 'a high-score play'); end if;   -- 0491
  if p_play in ('magnet', 're-deal') and _contest_of(lg) <> 'bullseye' then return jsonb_build_object('ok', false, 'error', 'a Bullseye play'); end if;
  if _contest_plays_off(lg) ? p_play then return jsonb_build_object('ok', false, 'error', 'the commissioner turned this play off here'); end if;   -- 0490
  r := spend_from_wallet(p_league, seat.sleeper_roster_id, price, null, coalesce(lg.contest_week, _contest_week(lg.season)), 'buy:' || p_play,
         'buy:' || p_league::text || ':' || seat.sleeper_roster_id || ':' || p_play || ':' || extract(epoch from clock_timestamp())::text);
  if not coalesce((r ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'not enough coin — ◎' || ceil(price - coalesce((r ->> 'balance')::numeric, 0)) || ' short');
  end if;
  perform bump_inventory(p_league, seat.sleeper_roster_id, p_play, 1);
  return jsonb_build_object('ok', true, 'roster_id', seat.sleeper_roster_id,
    'wallet', (select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = seat.sleeper_roster_id),
    'inventory', _contest_inventory_json(p_league, seat.sleeper_roster_id));
end $$;

create or replace function contest_arm_play(p_league uuid, p_week int, p_play text, p_slot text default null, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; price int; held int; cap int; sl text; pslug text; ps pod_salary; cut numeric; r jsonb; proj_ numeric;
        old jsonb; nw jsonb; n int; have int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not _contest_coin_on(lg) then return jsonb_build_object('ok', false, 'error', 'drip coin is off here'); end if;
  seat := _my_contest_seat(p_league, p_roster);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if p_roster is not null and seat.sleeper_roster_id <> p_roster then return jsonb_build_object('ok', false, 'error', 'that isn''t your seat'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then return jsonb_build_object('ok', false, 'error', 'wrong week for this contest'); end if;
  price := _contest_play_price(p_play);
  if price is null then return jsonb_build_object('ok', false, 'error', 'no such play'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final') then return jsonb_build_object('ok', false, 'error', 'the week is final'); end if;
  cap := _contest_play_cap(lg);
  select count(*) into held from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id;
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
  if exists (select 1 from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.play_id = p_play and c.slot_key = coalesce(sl, '')) then
    return jsonb_build_object('ok', false, 'error', 'that play is already armed');
  end if;
  if sl is not null and p_play not in ('spy', 'jinx') and exists (select 1 from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.slot = sl and c.play_id not in ('spy', 'jinx')) then
    return jsonb_build_object('ok', false, 'error', 'that spot already carries a play');
  end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;
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
    update sleeper_lineup set starters_json = nw where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;
    perform _log_contest_swaps(p_league, p_week, seat.sleeper_roster_id, old, nw, 'swap', auth.uid());
  end if;
  -- THE HAND (0486): a card bought in the shop plays from the hand; with none
  -- in hand, the wallet buys and plays it in one (the web's PLAYS chips).
  select qty into have from team_inventory where league_id = p_league and roster_id = seat.sleeper_roster_id and powerup_id = p_play;
  if coalesce(have, 0) > 0 then
    perform bump_inventory(p_league, seat.sleeper_roster_id, p_play, -1);
  else
    r := spend_from_wallet(p_league, seat.sleeper_roster_id, price, null, p_week, 'play:' || p_play,
           'play:' || p_league::text || ':' || p_week || ':' || seat.sleeper_roster_id || ':' || p_play || ':' || coalesce(sl, '') || ':' || extract(epoch from clock_timestamp())::text);
    if not coalesce((r ->> 'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'not enough coin — ◎' || ceil(price - coalesce((r ->> 'balance')::numeric, 0)) || ' short');
    end if;
  end if;
  insert into contest_play (league_id, week, roster_id, play_id, slot, proj, price, by_user)
    values (p_league, p_week, seat.sleeper_roster_id, p_play, sl, proj_, price, auth.uid());
  return jsonb_build_object('ok', true, 'roster_id', seat.sleeper_roster_id, 'plays', _contest_plays_json(p_league, p_week, seat.sleeper_roster_id),
    'wallet', (select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = seat.sleeper_roster_id),
    'inventory', _contest_inventory_json(p_league, seat.sleeper_roster_id));
end $$;

create or replace function contest_disarm_play(p_league uuid, p_week int, p_play text, p_slot text default null, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; sl text; price int; pslug text; r jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  seat := _my_contest_seat(p_league, p_roster);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if p_roster is not null and seat.sleeper_roster_id <> p_roster then return jsonb_build_object('ok', false, 'error', 'that isn''t your seat'); end if;
  sl := case when _contest_squad_play(p_play) then null else nullif(btrim(coalesce(p_slot, '')), '') end;   -- 0491
  -- 0490: taken back on the same clock it arms on — a spot play until that player's kickoff, a squad play before the first
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final') then return jsonb_build_object('ok', false, 'error', 'the week is final'); end if;
  if sl is not null then
    select e ->> 'player_slug' into pslug from sleeper_lineup l, jsonb_array_elements(coalesce(l.starters_json, '[]'::jsonb)) e
     where l.league_id = p_league and l.week = p_week and l.roster_id = seat.sleeper_roster_id and e ->> 'slot' = sl and nullif(e ->> 'player_slug', '') is not null limit 1;
  end if;
  r := _contest_play_window(lg, p_week, p_play, sl, pslug, seat.sleeper_roster_id);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  delete from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.play_id = p_play and c.slot_key = coalesce(sl, '')
    returning c.price into price;
  if price is null then return jsonb_build_object('ok', false, 'error', 'no such play armed'); end if;
  -- THE HAND (0486): a play taken back goes back to the hand, not the wallet
  perform bump_inventory(p_league, seat.sleeper_roster_id, p_play, 1);
  return jsonb_build_object('ok', true, 'roster_id', seat.sleeper_roster_id, 'plays', _contest_plays_json(p_league, p_week, seat.sleeper_roster_id),
    'wallet', (select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = seat.sleeper_roster_id),
    'inventory', _contest_inventory_json(p_league, seat.sleeper_roster_id));
end $$;

create or replace function contest_matchup(p_league uuid, p_week int default null, p_matchup uuid default null, p_roster int default null, p_season text default '2026')
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; st matchup_state; started boolean; spots jsonb; mine int; seats int[]; spy text;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  mine := me.sleeper_roster_id;
  seats := array(select s.sleeper_roster_id from _my_contest_seats(p_league) s);
  wk := coalesce(p_week, lg.contest_week,
    (select min(week) from matchup where league_id = p_league and status <> 'final'),
    (select max(week) from matchup where league_id = p_league), _contest_week(p_season));
  started := coalesce(_week_first_lock(p_season, wk) <= now(), false);
  if p_matchup is not null then
    select * into m from matchup where id = p_matchup and league_id = p_league and week = wk;
  elsif p_roster is not null then
    select * into m from matchup where league_id = p_league and week = wk and p_roster in (home_roster_id, away_roster_id) limit 1;
  elsif mine is not null then
    select * into m from matchup where league_id = p_league and week = wk and mine in (home_roster_id, away_roster_id) limit 1;
  end if;
  if m.id is null then
    select * into m from matchup where league_id = p_league and week = wk order by is_playoff desc, playoff_round, bracket_pos, home_roster_id limit 1;
  end if;
  -- `me` is the seat of mine in the matchup shown (a member with several
  -- seats looks at one of them at a time), else my first.
  if m.id is not null then
    mine := case when m.home_roster_id = any(seats) then m.home_roster_id when m.away_roster_id = any(seats) then m.away_roster_id else mine end;
  end if;
  if m.id is not null then select * into st from matchup_state where matchup_id = m.id and game_window = 'wk'; end if;
  -- SPY (0485): my spy's spot shows me the opponent's pick there before his kickoff
  if m.id is not null and mine is not null and mine in (m.home_roster_id, m.away_roster_id) then
    select c.slot into spy from contest_play c where c.league_id = p_league and c.week = wk and c.roster_id = mine and c.play_id = 'spy' limit 1;
    -- SMOKE (0491): their Smoke on that spot keeps it sealed from my Spy
    if spy is not null and exists (select 1 from contest_play c where c.league_id = p_league and c.week = wk and c.play_id = 'smoke' and c.slot = spy
                                      and c.roster_id = case when m.home_roster_id = mine then m.away_roster_id else m.home_roster_id end) then spy := null; end if;
  end if;
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'me', mine, 'slots', spots,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'), 'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'scoring_classic', lg.settings_json -> 'scoring_classic', 'ppr', coalesce((lg.settings_json ->> 'ppr')::numeric, 1),
    'matchup', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'status', m.status, 'home', m.home_roster_id, 'away', m.away_roster_id,
      'home_team', _txn_team(p_league, m.home_roster_id), 'away_team', _txn_team(p_league, m.away_roster_id),
      'home_final', m.home_final, 'away_final', m.away_final, 'home_tb', m.home_tb, 'away_tb', m.away_tb,
      'playoff', m.is_playoff, 'label', m.playoff_label,
      'home_plays', case when m.home_roster_id = any(seats) or started then _contest_plays_json(p_league, wk, m.home_roster_id) else '[]'::jsonb end,
      'away_plays', case when m.away_roster_id = m.home_roster_id then '[]'::jsonb when m.away_roster_id = any(seats) or started then _contest_plays_json(p_league, wk, m.away_roster_id) else '[]'::jsonb end,
      'home_entry', _contest_sealed_entry(p_league, wk, m.home_roster_id, p_season, m.home_roster_id = any(seats), case when m.home_roster_id <> mine then spy end),
      'away_entry', case when m.away_roster_id = m.home_roster_id then null else _contest_sealed_entry(p_league, wk, m.away_roster_id, p_season, m.away_roster_id = any(seats), case when m.away_roster_id <> mine then spy end) end,
      'state', case when st.matchup_id is null or not started then null else jsonb_build_object('home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end) end,
    'matchups', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'home', x.home_roster_id, 'away', x.away_roster_id,
                 'home_team', _txn_team(p_league, x.home_roster_id), 'away_team', _txn_team(p_league, x.away_roster_id),
                 'status', x.status, 'label', x.playoff_label, 'consolation', x.is_consolation,
                 'home_score', coalesce(x.home_final, xs.home_score), 'away_score', coalesce(x.away_final, xs.away_score),
                 'mine', x.home_roster_id = any(seats) or x.away_roster_id = any(seats))
               order by (x.home_roster_id = any(seats) or x.away_roster_id = any(seats)) desc, x.is_consolation, x.bracket_pos, x.home_roster_id)
      from matchup x left join matchup_state xs on xs.matchup_id = x.id and xs.game_window = 'wk'
      where x.league_id = p_league and x.week = wk), '[]'::jsonb));
end $$;

