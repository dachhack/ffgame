-- 0484: THE PLAYS (v0.685.0), PR 2 of the drip-coin plan. A contest seat
-- spends its wallet on a play before the week's first kickoff — one a week,
-- two head-to-head — and the scorer (engine/contestPlays.ts, inside
-- scoreContest) applies it:
--
--   underdog          35  a spot whose player is priced in the bottom third of his position scores ×1.5
--   double-or-nothing 80  a staked spot scores double past his projection at the final, zero short of it
--   ghost             75  a phantom fills a spot at no salary for a flat 14 (the player there steps out)
--   hail-mary         35  a quarterback's 40-yard touchdown pass banks +15
--   pick-six          45  a defensive return touchdown banks +25
--
-- contest_play holds the armed rows; contest_arm_play spends (spend_from_
-- wallet, a nonce in the idem so a disarm-and-re-arm pays again) and checks
-- the target; contest_disarm_play refunds before kickoff; contest_plays
-- reads a seat's (another's once the week has kicked off). contest_state
-- carries mine and the cap, contest_matchup both sides' (sealed like the
-- squads), _contest_squad_check lets a ghost hold an empty spot, and
-- save_contest_entry refuses a player on a ghosted spot.

create table if not exists contest_play (
  id        bigint generated always as identity primary key,
  league_id uuid not null references league(id) on delete cascade,
  week      int  not null,
  roster_id int  not null,
  play_id   text not null,
  slot      text,
  proj      numeric,
  price     int  not null,
  by_user   uuid,
  armed_at  timestamptz not null default now(),
  slot_key  text generated always as (coalesce(slot, '')) stored,
  unique (league_id, week, roster_id, play_id, slot_key)
);
create index if not exists contest_play_seat_idx on contest_play (league_id, week, roster_id);
alter table contest_play enable row level security;
revoke all on contest_play from public, anon, authenticated;

create or replace function _contest_play_price(p_play text) returns int language sql immutable as $$
  select case p_play when 'underdog' then 35 when 'double-or-nothing' then 80 when 'ghost' then 75 when 'hail-mary' then 35 when 'pick-six' then 45 end;
$$;
create or replace function _contest_play_cap(lg league) returns int language sql immutable as $$
  select case when _contest_format_of(lg) = 'h2h' then 2 else 1 end;
$$;
create or replace function _contest_plays_json(p_league uuid, p_week int, p_roster int) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.play_id, 'slot', c.slot, 'proj', c.proj, 'price', c.price, 'at', c.armed_at) order by c.armed_at, c.id), '[]'::jsonb)
    from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = p_roster;
$$;
/** A week a play can still be armed for: no first kickoff yet, no final. */
create or replace function _contest_week_open(lg league, p_week int) returns boolean
  language sql stable security definer set search_path = public as $$
  select not coalesce(_week_first_lock(lg.season, p_week) <= now(), false)
     and not exists (select 1 from matchup m where m.league_id = lg.id and m.week = p_week and m.status = 'final');
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
  sl := nullif(btrim(coalesce(p_slot, '')), '');
  if p_play in ('hail-mary', 'pick-six') then sl := null;
  elsif sl is null then return jsonb_build_object('ok', false, 'error', 'pick a spot for it');
  elsif sl !~ '^S[0-9]+$' or substr(sl, 2)::int < 1 or substr(sl, 2)::int > jsonb_array_length(_contest_slots(lg)) then return jsonb_build_object('ok', false, 'error', 'no such spot');
  end if;
  if exists (select 1 from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.play_id = p_play and c.slot_key = coalesce(sl, '')) then
    return jsonb_build_object('ok', false, 'error', 'that play is already armed');
  end if;
  if sl is not null and exists (select 1 from contest_play c where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.slot = sl) then
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
  perform adjust_wallet(p_league, seat.sleeper_roster_id, null, p_week, price, 'refund',
    'refund:' || p_league::text || ':' || p_week || ':' || seat.sleeper_roster_id || ':' || p_play || ':' || coalesce(sl, '') || ':' || extract(epoch from clock_timestamp())::text);
  return jsonb_build_object('ok', true, 'roster_id', seat.sleeper_roster_id, 'plays', _contest_plays_json(p_league, p_week, seat.sleeper_roster_id),
    'wallet', (select w.coins from team_wallet w where w.league_id = p_league and w.roster_id = seat.sleeper_roster_id));
end $$;

/** A seat's armed plays: mine any time; another's once the week has kicked off. */
create or replace function contest_plays(p_league uuid, p_week int, p_roster int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; rid int; open_ boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  me := _my_contest_seat(p_league, p_roster);
  rid := coalesce(p_roster, me.sleeper_roster_id);
  if rid is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  open_ := rid in (select s.sleeper_roster_id from _my_contest_seats(p_league) s) or is_league_commish(p_league) or is_admin()
           or coalesce(_week_first_lock(lg.season, p_week) <= now(), false);
  return jsonb_build_object('ok', true, 'roster_id', rid, 'week', p_week, 'sealed', not open_,
    'plays', case when open_ then _contest_plays_json(p_league, p_week, rid) else '[]'::jsonb end);
end $$;

create or replace function _contest_squad_check(lg league, p_roster int, p_week int, p_slots jsonb, p_season text, p_old jsonb, p_member boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare spots jsonb; n int; i int; slot text; pslug text; ps pod_salary; bad text;
        spent int := 0; seen text[] := '{}'; lineup jsonb := '[]'::jsonb; budget int; floor_ int;
begin
  if jsonb_typeof(p_slots) <> 'object' then return jsonb_build_object('error', 'a squad is one player per spot'); end if;
  spots := _contest_slots(lg);
  n := jsonb_array_length(spots);
  budget := _contest_budget(lg);
  floor_ := _contest_min_spend(lg);
  select string_agg(k, ', ') into bad from jsonb_object_keys(p_slots) k where k !~ '^S[0-9]+$' or substr(k, 2)::int < 1 or substr(k, 2)::int > n;
  if bad is not null then return jsonb_build_object('error', 'unknown spot: ' || bad); end if;
  for i in 1..n loop
    slot := 'S' || i;
    pslug := nullif(btrim(coalesce(p_slots ->> slot, '')), '');
    if pslug is null and exists (select 1 from contest_play c where c.league_id = lg.id and c.week = p_week and c.roster_id = p_roster and c.play_id = 'ghost' and c.slot = ('S' || i)) then
      continue;   -- THE GHOST (0484): the phantom fills the spot; no row, the scorer banks it
    end if;
    if pslug is null then
      return jsonb_build_object('error', 'fill every spot — ' || coalesce(nullif(spots -> (i - 1) ->> 'label', ''), array_to_string(array(select upper(x) from jsonb_array_elements_text(spots -> (i - 1) -> 'pos') x), '/')) || ' is empty');
    end if;
    if pslug = any (seen) then return jsonb_build_object('error', 'a player can only fill one spot'); end if;
    seen := array_append(seen, pslug);
    select * into ps from pod_salary where season = p_season and week = p_week and pod_salary.slug = pslug;
    if ps.slug is null then return jsonb_build_object('error', 'a pick is not on this week''s board'); end if;
    -- RULED OUT (0467): a player the injury report has at O or IR is not a
    -- new pick — the DFS rule. One already in the saved squad may stay (and
    -- be swapped out until his game locks). The commissioner's fix is after
    -- the fact: whoever played, played.
    if p_member and exists (select 1 from injury_status ist where ist.player_slug = pslug and upper(ist.status) in ('O', 'IR'))
       and not exists (select 1 from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o where o ->> 'player_slug' = pslug) then
      return jsonb_build_object('error', ps.name || ' is ruled out this week — pick someone else');
    end if;
    bad := _contest_spot_error(lg, p_roster, spots -> (i - 1), slot, ps);
    if bad is not null then return jsonb_build_object('error', bad); end if;
    spent := spent + ps.salary;
    lineup := lineup || jsonb_build_object('slot', slot, 'sleeper_id', null, 'player_slug', pslug, 'pos', upper(ps.pos));
  end loop;
  if budget > 0 and spent > budget then return jsonb_build_object('error', 'over the $' || to_char(budget, 'FM999,999,999') || ' budget by $' || to_char(spent - budget, 'FM999,999,999')); end if;
  -- THE FLOOR (0469): golf's constraint — spend at least this much.
  if floor_ > 0 and spent < floor_ then return jsonb_build_object('error', 'under the $' || to_char(floor_, 'FM999,999,999') || ' minimum spend by $' || to_char(floor_ - spent, 'FM999,999,999')); end if;
  return jsonb_build_object('lineup', lineup, 'spent', spent, 'budget', budget, 'min_spend', floor_);
end $$;

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
  -- THE GHOST (0484): a spot the phantom holds takes no player until it is disarmed.
  if exists (select 1 from contest_play c, jsonb_each_text(p_slots) kv
              where c.league_id = p_league and c.week = p_week and c.roster_id = seat.sleeper_roster_id and c.play_id = 'ghost' and c.slot = kv.key and nullif(btrim(kv.value), '') is not null) then
    return jsonb_build_object('ok', false, 'error', 'that spot holds a ghost — disarm it to put a player there');
  end if;
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

create or replace function contest_matchup(p_league uuid, p_week int default null, p_matchup uuid default null, p_roster int default null, p_season text default '2026')
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; st matchup_state; started boolean; spots jsonb; mine int; seats int[];
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
      'home_entry', _contest_sealed_entry(p_league, wk, m.home_roster_id, p_season, m.home_roster_id = any(seats)),
      'away_entry', case when m.away_roster_id = m.home_roster_id then null else _contest_sealed_entry(p_league, wk, m.away_roster_id, p_season, m.away_roster_id = any(seats)) end,
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

revoke all on function _contest_play_price(text), _contest_play_cap(league), _contest_plays_json(uuid, int, int), _contest_week_open(league, int) from public, anon, authenticated;
revoke all on function contest_arm_play(uuid, int, text, text, int), contest_disarm_play(uuid, int, text, text, int), contest_plays(uuid, int, int) from public, anon;
grant execute on function contest_arm_play(uuid, int, text, text, int), contest_disarm_play(uuid, int, text, text, int), contest_plays(uuid, int, int) to authenticated;
