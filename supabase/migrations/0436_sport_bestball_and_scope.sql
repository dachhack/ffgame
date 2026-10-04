-- 0436 — BEST BALL AND SCOPED SPOTS FOR A DAILY SPORT (v0.629.0).
--
-- Founder: "Let's keep the scoped roster spots and could we do bestball for
-- leagues without weekly matchups like NBA and MLB?"
--
-- A sport spot may now carry what a football spot carries:
--   bb        best ball — nobody sets it; every night it takes the roster's
--             top scorer among the players who played and are eligible for
--             it (each player fills one spot a day). The worker writes the
--             fill into sport_slot_lock as the night goes (provisional, the
--             board shows it) and settles it when the day is done.
--   teams     only players on these teams (feed tricodes).
--   min_exp / max_exp   tenure, in seasons; max_exp 0 = rookies only. NBA
--             tenure is Sleeper's years_exp; MLB's is the season less the
--             debut year; the NHL feed has none, and a tenure-scoped spot
--             refuses a player whose tenure is unknown (the football rule).
-- sport_player.exp carries the tenure and seed_sport_pool copies it into
-- league_pool.exp, where the board (leaguePoolExp) and the worker's lock
-- pass already read it.
--
-- A fourth format, 'season': season-long total points, no weekly winner.
-- The weekly matchups stay on the schedule for the board's sake (as in
-- roto); the standings are the season table (sport_roto, points only).
--
--   sport_league_day_lines_svc   every rostered player's game and line on a
--                                range of dates — what the best-ball fill
--                                ranks (the worker only).
--   sport_bb_write_svc           replace a seat's best-ball locks for a day
--                                atomically (the worker only).
--
-- Undo: restore 0431's set_sport_lineup and 0428's set_sport_settings and
--       0435's seed_sport_pool; drop function sport_league_day_lines_svc,
--       sport_bb_write_svc; alter table sport_player drop column exp.

alter table sport_player add column if not exists exp int;

-- ── set_sport_lineup v2: bb, teams and tenure per spot ──────────────────────
create or replace function set_sport_lineup(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare sp text; allowed text[]; n int; i int; spot jsonb; ps jsonb; p text; seen text[]; cleaned jsonb := '[]'::jsonb; lbl text; dstat text;
        one jsonb; tm text; teams text[]; mn int; mx int; have_dir boolean;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  sp := league_sport(p_league_id);
  if sp = 'nfl' then return jsonb_build_object('ok', false, 'error', 'not a sport league'); end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the lineup freezes when the draft starts');
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    return jsonb_build_object('ok', false, 'error', 'a lineup needs at least one spot');
  end if;
  n := jsonb_array_length(p_slots);
  if n > 20 then return jsonb_build_object('ok', false, 'error', 'lineups cap at 20 starters'); end if;
  allowed := sport_positions(sp);
  have_dir := exists (select 1 from sport_player x where x.sport = sp and x.team <> '');
  for i in 0 .. n - 1 loop
    spot := p_slots -> i;
    if jsonb_typeof(spot) <> 'object' or jsonb_typeof(spot -> 'pos') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'each spot needs an eligible-position list');
    end if;
    seen := array[]::text[];
    for ps in select * from jsonb_array_elements(spot -> 'pos') loop
      p := upper(trim(both '"' from ps::text));
      if not (p = any (allowed)) then return jsonb_build_object('ok', false, 'error', 'unknown ' || upper(sp) || ' position: ' || p); end if;
      if not (p = any (seen)) then seen := seen || p; end if;
    end loop;
    if coalesce(array_length(seen, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'error', 'each spot needs at least one eligible position');
    end if;
    lbl := nullif(left(regexp_replace(coalesce(spot ->> 'label', ''), '[^A-Za-z0-9 /_-]', '', 'g'), 12), '');
    one := jsonb_build_object('pos', to_jsonb(seen), 'label', coalesce(lbl, array_to_string(seen, '/')));
    -- best ball
    if jsonb_typeof(spot -> 'bb') = 'boolean' and (spot ->> 'bb')::boolean then one := one || jsonb_build_object('bb', true); end if;
    -- teams: feed tricodes, at most eight, known to the directory when it has one
    if spot ? 'teams' and jsonb_typeof(spot -> 'teams') = 'array' and jsonb_array_length(spot -> 'teams') > 0 then
      if jsonb_array_length(spot -> 'teams') > 8 then return jsonb_build_object('ok', false, 'error', 'a spot scopes to at most 8 teams'); end if;
      teams := array[]::text[];
      for tm in select upper(trim(x)) from jsonb_array_elements_text(spot -> 'teams') x loop
        if tm !~ '^[A-Z0-9]{2,4}$' then return jsonb_build_object('ok', false, 'error', 'unknown team code: ' || tm); end if;
        if have_dir and not exists (select 1 from sport_player x where x.sport = sp and x.team = tm) then
          return jsonb_build_object('ok', false, 'error', 'unknown ' || upper(sp) || ' team: ' || tm);
        end if;
        if not (tm = any (teams)) then teams := teams || tm; end if;
      end loop;
      one := one || jsonb_build_object('teams', to_jsonb(teams));
    end if;
    -- tenure
    mn := null; mx := null;
    if spot ? 'min_exp' and jsonb_typeof(spot -> 'min_exp') = 'number' then mn := (spot ->> 'min_exp')::numeric::int; end if;
    if spot ? 'max_exp' and jsonb_typeof(spot -> 'max_exp') = 'number' then mx := (spot ->> 'max_exp')::numeric::int; end if;
    if mn is not null and (mn < 0 or mn > 30) then return jsonb_build_object('ok', false, 'error', 'min_exp must be 0–30'); end if;
    if mx is not null and (mx < 0 or mx > 30) then return jsonb_build_object('ok', false, 'error', 'max_exp must be 0–30'); end if;
    if mn is not null and mx is not null and mn > mx then return jsonb_build_object('ok', false, 'error', 'min_exp is above max_exp'); end if;
    if mn is not null then one := one || jsonb_build_object('min_exp', mn); end if;
    if mx is not null then one := one || jsonb_build_object('max_exp', mx); end if;
    cleaned := cleaned || one;
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('roster_slots', cleaned)
   where id = p_league_id;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n,
    'bestball', (select count(*) from jsonb_array_elements(cleaned) s where (s ->> 'bb')::boolean),
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;
grant execute on function set_sport_lineup(uuid, jsonb) to authenticated;

-- ── set_sport_settings v2: the 'season' format ──────────────────────────────
create or replace function set_sport_settings(p_league_id uuid, p_patch jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb; nxt jsonb; live boolean; k text; v text; sc jsonb := '{}'::jsonb; f text; cats jsonb; ps date; wk int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if league_sport(p_league_id) = 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'not a sport league');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'patch must be an object');
  end if;
  select coalesce(settings_json -> 'sport', '{}'::jsonb) into cur from league where id = p_league_id;
  nxt := cur;
  live := exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled');

  if p_patch ? 'scoring' then
    if jsonb_typeof(p_patch -> 'scoring') <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'scoring must be an object');
    end if;
    for k, v in select * from jsonb_each_text(p_patch -> 'scoring') loop
      if v ~ '^-?\d+(\.\d+)?$' and abs(v::numeric) <= 1000 then sc := sc || jsonb_build_object(k, v::numeric); end if;
    end loop;
    nxt := nxt || jsonb_build_object('scoring', sc);
  end if;

  if p_patch ? 'format' or p_patch ? 'categories' then
    if live then return jsonb_build_object('ok', false, 'error', 'the season is under way — the format and categories are locked'); end if;
    if p_patch ? 'format' then
      f := p_patch ->> 'format';
      if f not in ('points', 'cats', 'roto', 'season') then return jsonb_build_object('ok', false, 'error', 'format must be points, cats, roto or season'); end if;
      nxt := nxt || jsonb_build_object('format', f);
    end if;
    if p_patch ? 'categories' then
      if jsonb_typeof(p_patch -> 'categories') <> 'array' then return jsonb_build_object('ok', false, 'error', 'categories must be an array'); end if;
      select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into cats
        from jsonb_array_elements_text(p_patch -> 'categories') x where x ~ '^[a-z0-9_]{1,24}$';
      if jsonb_array_length(cats) > 20 then return jsonb_build_object('ok', false, 'error', 'at most 20 categories'); end if;
      nxt := nxt || jsonb_build_object('categories', cats);
    end if;
  end if;

  if p_patch ? 'period_start' or p_patch ? 'weeks' then
    if live then return jsonb_build_object('ok', false, 'error', 'the season is under way — the calendar is locked'); end if;
    if p_patch ? 'period_start' then
      begin ps := (p_patch ->> 'period_start')::date; exception when others then
        return jsonb_build_object('ok', false, 'error', 'period_start must be a date'); end;
      ps := ps - ((extract(isodow from ps)::int - 1));
      nxt := nxt || jsonb_build_object('period_start', to_char(ps, 'YYYY-MM-DD'));
    end if;
    if p_patch ? 'weeks' then
      wk := (p_patch ->> 'weeks')::int;
      if wk is null or wk < 1 or wk > 30 then return jsonb_build_object('ok', false, 'error', 'weeks must be 1–30'); end if;
      nxt := nxt || jsonb_build_object('weeks', wk);
    end if;
  end if;

  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('sport', nxt) where id = p_league_id;
  return jsonb_build_object('ok', true, 'sport', nxt);
end $$;
grant execute on function set_sport_settings(uuid, jsonb) to authenticated;

-- ── seed_sport_pool v3: 0435's body, carrying tenure into the pool ─────────
create or replace function seed_sport_pool(p_league_id uuid, p_limit int default 600)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare sp text; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  select sport into sp from league where id = p_league_id;
  if sp is null or sp = 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'not a sport league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  p_limit := least(greatest(coalesce(p_limit, 600), 50), 2000);

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug);
  insert into league_pool (league_id, slug, full_name, pos, team, rank, eligible, exp)
  select p_league_id, p.player_key, p.full_name, p.pos, p.team,
         row_number() over (order by p.adp nulls last, p.rank nulls last, p.full_name), p.eligible, p.exp
    from sport_player p
   where p.sport = sp and p.active
   order by p.adp nulls last, p.rank nulls last, p.full_name
   limit p_limit
  on conflict (league_id, slug) do update
    set full_name = excluded.full_name, pos = excluded.pos, team = excluded.team, eligible = excluded.eligible, exp = excluded.exp;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'pool', n, 'sport', sp);
end $$;
grant execute on function seed_sport_pool(uuid, int) to authenticated;

-- Pools seeded before this carry no tenure; fill them from the directory once.
update league_pool lp set exp = p.exp
  from sport_player p
 where p.player_key = lp.slug and lp.exp is null and p.exp is not null;

-- ── the best-ball fill's input: every rostered player's day ─────────────────
-- One row per (rostered player, game of his team on the date), the line left
-- null until the box score lands. Active roster spots only: an IR stash
-- never fills a lineup. `app_user_id` is the seat's manager (null for a seat
-- nobody has claimed — such a seat has nothing to lock under).
create or replace function sport_league_day_lines_svc(p_league_id uuid, p_from date, p_to date)
  returns table (roster_id int, app_user_id uuid, player_slug text, team text, eligible text[], exp int,
                 game_id text, game_date date, status text, start_utc timestamptz, played boolean, line jsonb)
  language sql stable security definer set search_path = public as $$
  select nr.roster_id,
         (select lm.app_user_id from league_membership lm
           where lm.league_id = nr.league_id and lm.sleeper_roster_id = nr.roster_id
           order by lm.app_user_id limit 1),
         nr.slug, lp.team,
         case when coalesce(array_length(lp.eligible, 1), 0) > 0 then lp.eligible else array[lp.pos] end,
         lp.exp,
         g.game_id, g.game_date, g.status, g.start_utc, s.played, s.line
    from native_roster nr
    join league l on l.id = nr.league_id
    join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    join sport_game g on g.sport = l.sport and g.season = l.season
                     and g.game_date between p_from and p_to
                     and g.status not in ('postponed', 'cancelled')
                     and lp.team in (g.home, g.away)
    left join game_stat_line s on s.sport = l.sport and s.season = l.season and s.game_id = g.game_id and s.player_key = nr.slug
   where nr.league_id = p_league_id and coalesce(nr.spot, 'active') = 'active'
   order by g.game_date, nr.roster_id, nr.slug, g.game_id
$$;
revoke execute on function sport_league_day_lines_svc(uuid, date, date) from public, anon, authenticated;
grant execute on function sport_league_day_lines_svc(uuid, date, date) to service_role;

-- ── the fill's output: a seat's best-ball locks for one day, replaced whole ──
-- Rows: [{roster_slot, player_slug, game_id}]. Every lock on p_slots for the
-- day goes, then the rows come in — so a spot the night emptied (its man
-- was scratched) is emptied here too.
create or replace function sport_bb_write_svc(p_matchup uuid, p_user uuid, p_date date, p_slots text[], p_rows jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from sport_slot_lock k
   where k.matchup_id = p_matchup and k.app_user_id = p_user and k.game_date = p_date and k.roster_slot = any (p_slots);
  insert into sport_slot_lock (matchup_id, app_user_id, game_date, roster_slot, player_slug, game_id)
  select p_matchup, p_user, p_date, r ->> 'roster_slot', r ->> 'player_slug', r ->> 'game_id'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where (r ->> 'roster_slot') = any (p_slots) and (r ->> 'player_slug') is not null and (r ->> 'game_id') is not null
  on conflict (matchup_id, app_user_id, game_date, roster_slot, game_id) do update set player_slug = excluded.player_slug, locked_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sport_bb_write_svc(uuid, uuid, date, text[], jsonb) from public, anon, authenticated;
grant execute on function sport_bb_write_svc(uuid, uuid, date, text[], jsonb) to service_role;
