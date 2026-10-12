-- 0485: THE PLAYS, PR 3 (v0.686.0). Four more — the head-to-head pair and
-- the Bullseye pair:
--
--   spy      40  one of the opponent's spots: their sealed pick there shows to me before his kickoff
--   jinx     55  one of the opponent's spots, blind: the first touchdown the player there scores is struck off
--   magnet   50  a spot lands half as far from its number at the final (per spot), or the squad half a radius closer (one-team total)
--   re-deal  40  the seat's tie-breaker spot and number dealt again, before kickoff
--
-- Spy and Jinx want a head-to-head league; Magnet and Re-deal the dart. A
-- Spy or Jinx row names the OPPONENT's spot, so it does not take one of
-- mine. _contest_sealed_entry gains the spot a spy unseals; contest_matchup
-- and contest_state hand it the viewer's. The scorer (engine/contest.ts)
-- strikes the jinxed touchdown, moves the magnet's dart and re-deals the
-- tie-breaker from a second seed.

create or replace function _contest_play_price(p_play text) returns int language sql immutable as $$
  select case p_play when 'underdog' then 35 when 'double-or-nothing' then 80 when 'ghost' then 75 when 'hail-mary' then 35 when 'pick-six' then 45
                     when 'spy' then 40 when 'jinx' then 55 when 'magnet' then 50 when 're-deal' then 40 end;
$$;

create or replace function contest_arm_play(p_league uuid, p_week int, p_play text, p_slot text default null, p_roster int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; price int; held int; cap int; sl text; pslug text; ps pod_salary; cut numeric; r jsonb; proj_ numeric;
        old jsonb; nw jsonb; n int;
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
  if not _contest_week_open(lg, p_week) then return jsonb_build_object('ok', false, 'error', 'plays arm before the week''s first kickoff'); end if;
  cap := _contest_play_cap(lg);
  select count(*) into held from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id;
  if held >= cap then return jsonb_build_object('ok', false, 'error', case when cap = 1 then 'one play a week here' else 'two plays a week here' end); end if;
  -- PR 3 (0485): the head-to-head pair wants an opponent; the Bullseye pair wants the dart
  if p_play in ('spy', 'jinx') and _contest_format_of(lg) <> 'h2h' then return jsonb_build_object('ok', false, 'error', 'a head-to-head play'); end if;
  if p_play in ('magnet', 're-deal') and _contest_of(lg) <> 'bullseye' then return jsonb_build_object('ok', false, 'error', 'a Bullseye play'); end if;
  sl := nullif(btrim(coalesce(p_slot, '')), '');
  if p_play in ('hail-mary', 'pick-six', 're-deal') or (p_play = 'magnet' and coalesce(lg.settings_json ->> 'bullseye', 'slots') = 'total') then sl := null;
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
  elsif p_play = 'magnet' and sl is not null and pslug is null then
    return jsonb_build_object('ok', false, 'error', 'Magnet takes a spot with a player in it');
  elsif p_play = 'ghost' and pslug is not null then
    -- the player there steps out (a swap in the history), the phantom takes the spot
    nw := coalesce((select jsonb_agg(e) from jsonb_array_elements(old) e where e ->> 'slot' <> sl), '[]'::jsonb);
    update sleeper_lineup set starters_json = nw where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;
    perform _log_contest_swaps(p_league, p_week, seat.sleeper_roster_id, old, nw, 'swap', auth.uid());
  end if;
  r := spend_from_wallet(p_league, seat.sleeper_roster_id, price, null, p_week, 'play:' || p_play,
         'play:' || p_league::text || ':' || p_week || ':' || seat.sleeper_roster_id || ':' || p_play || ':' || coalesce(sl, '') || ':' || extract(epoch from clock_timestamp())::text);
  if not coalesce((r ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'not enough coin — ◎' || ceil(price - coalesce((r ->> 'balance')::numeric, 0)) || ' short');
  end if;
  insert into contest_play (league_id, week, roster_id, play_id, slot, proj, price, by_user)
    values (p_league, p_week, seat.sleeper_roster_id, p_play, sl, proj_, price, auth.uid());
  return jsonb_build_object('ok', true, 'roster_id', seat.sleeper_roster_id, 'plays', _contest_plays_json(p_league, p_week, seat.sleeper_roster_id),
    'wallet', (select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = seat.sleeper_roster_id));
end $$;

drop function if exists _contest_sealed_entry(uuid, int, int, text, boolean);
create or replace function _contest_sealed_entry(p_league uuid, p_week int, p_roster int, p_season text, p_open boolean, p_spy text default null) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_agg(case when p_open or _dfs_player_locked(p_season, p_week, e ->> 'player_slug') or (p_spy is not null and e ->> 'slot' = p_spy) then e
                        else jsonb_build_object('slot', e -> 'slot', 'sealed', true) end order by ord)
    from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) with ordinality x(e, ord)
   where sl.league_id = p_league and sl.week = p_week and sl.roster_id = p_roster;
$$;

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
    select jsonb_agg(case when _dfs_player_locked(p_season, wk, e ->> 'player_slug')
                               or exists (select 1 from contest_play c where c.league_id = p_league and c.week = wk and c.roster_id = me.sleeper_roster_id and c.play_id = 'spy' and c.slot = e ->> 'slot') then e
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
    'plays', case when me.id is null then '[]'::jsonb else _contest_plays_json(p_league, wk, me.sleeper_roster_id) end, 'play_cap', _contest_play_cap(lg),
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

revoke all on function _contest_sealed_entry(uuid, int, int, text, boolean, text) from public, anon, authenticated;
