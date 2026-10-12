-- 0486: THE SHOP AND THE HAND (v0.688.0). Founder: "Can we have the power
-- ups in a shop and floating hand like in drip leagues?" A contest seat
-- BUYS a play into its hand (team_inventory, keyed by league and seat
-- already) with contest_buy_play, and PLAYS it from the hand with
-- contest_arm_play, which consumes the card — or, with none in hand, buys
-- and plays in one as before. A play taken back before kickoff returns to
-- the hand, not the wallet. A card bought now keeps for a later week.

create or replace function _contest_inventory_json(p_league uuid, p_roster int) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(i.powerup_id, i.qty), '{}'::jsonb) from team_inventory i
   where i.league_id = p_league and i.roster_id = p_roster and i.qty > 0;
$$;

/** Buy a play into the seat's hand. */
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
  if p_play in ('spy', 'jinx') and _contest_format_of(lg) <> 'h2h' then return jsonb_build_object('ok', false, 'error', 'a head-to-head play'); end if;
  if p_play in ('magnet', 're-deal') and _contest_of(lg) <> 'bullseye' then return jsonb_build_object('ok', false, 'error', 'a Bullseye play'); end if;
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
declare lg league; seat league_membership; sl text; price int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  seat := _my_contest_seat(p_league, p_roster);
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if p_roster is not null and seat.sleeper_roster_id <> p_roster then return jsonb_build_object('ok', false, 'error', 'that isn''t your seat'); end if;
  if not _contest_week_open(lg, p_week) then return jsonb_build_object('ok', false, 'error', 'a play is set once the week has kicked off'); end if;
  sl := case when p_play in ('hail-mary', 'pick-six') then null else nullif(btrim(coalesce(p_slot, '')), '') end;
  delete from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.play_id = p_play and c.slot_key = coalesce(sl, '')
    returning c.price into price;
  if price is null then return jsonb_build_object('ok', false, 'error', 'no such play armed'); end if;
  -- THE HAND (0486): a play taken back goes back to the hand, not the wallet
  perform bump_inventory(p_league, seat.sleeper_roster_id, p_play, 1);
  return jsonb_build_object('ok', true, 'roster_id', seat.sleeper_roster_id, 'plays', _contest_plays_json(p_league, p_week, seat.sleeper_roster_id),
    'wallet', (select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = seat.sleeper_roster_id),
    'inventory', _contest_inventory_json(p_league, seat.sleeper_roster_id));
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
    'inventory', case when me.id is null then '{}'::jsonb else _contest_inventory_json(p_league, me.sleeper_roster_id) end,
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

revoke all on function _contest_inventory_json(uuid, int) from public, anon, authenticated;
revoke all on function contest_buy_play(uuid, text, int) from public, anon;
grant execute on function contest_buy_play(uuid, text, int) to authenticated;
