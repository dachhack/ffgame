-- 0507: TIERS INSIDE ONE LEAGUE — in-season promotion and relegation.
--
-- Founder: "Looks like relegation is between linked leagues at seasons end.
-- Lets also make within season within league relegation." Decided with the
-- founder:
--   • the league's DIVISIONS (0215) are the tiers, ordered top to bottom by
--     the commissioner, and each tier plays only inside itself;
--   • every N weeks (a PERIOD, 2–6, default 4) the bottom `movers` of each
--     tier swap with the top `movers` of the tier below;
--   • a period's table is its own record (wins, ties as half), points scored
--     in the period breaking ties;
--   • movers 1–3, default 2.
--
-- HOW THE SCHEDULE STAYS HONEST. A lineup, a power-up and a pot are rows on a
-- MATCHUP, so re-pairing weeks that already have matchups would strand them.
-- With tiers on, only the CURRENT period's weeks exist: each period's
-- matchups are built when it begins (inside the tiers as they stand), and the
-- weeks after it are built at the next boundary. Turning tiers on rebuilds the
-- schedule from the next open week; anything already saved for those weeks
-- (a lineup set ahead, the AI's auto-fill) goes with the old pairings and is
-- re-made by the same fill that made it.
--
-- settings_json.tiers = { on, period, movers, order: [division labels, top
-- first], start: first week of tier play, done: last week whose moves ran }.
-- NFL native leagues on the pro calendar; not a weekly contest.

create table if not exists league_tier_move (
  id          bigserial primary key,
  league_id   uuid not null references league(id) on delete cascade,
  after_week  int  not null,            -- the period's last week
  roster_id   int  not null,
  direction   text not null check (direction in ('up', 'down')),
  from_tier   text not null,
  to_tier     text not null,
  wins        numeric not null default 0,
  points      numeric not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists league_tier_move_league on league_tier_move(league_id, after_week);
alter table league_tier_move enable row level security;
revoke all on league_tier_move from anon, authenticated;

-- ── the settings, read ──────────────────────────────────────────────────────
create or replace function _tiers_cfg(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when coalesce((settings_json -> 'tiers' ->> 'on')::boolean, false)
              then settings_json -> 'tiers' end
    from league where id = p_league_id;
$$;
revoke all on function _tiers_cfg(uuid) from public, anon, authenticated;

-- Rosters of one tier, in roster order.
create or replace function _tier_rosters(p_league_id uuid, p_tier text) returns int[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(sleeper_roster_id order by sleeper_roster_id), '{}')
    from league_membership where league_id = p_league_id and division = p_tier;
$$;
revoke all on function _tier_rosters(uuid, text) from public, anon, authenticated;

-- ── one week of tier play: a round robin inside each tier ───────────────────
-- The circle method per tier, rotated by `idx` (the week's place in the
-- season of tier play), so successive weeks meet different opponents. An odd
-- tier gives one team the week off, as the league-wide schedule does.
create or replace function _tier_week(p_league_id uuid, p_week int, p_idx int, p_order text[]) returns int
  language plpgsql security definer set search_path = public as $$
declare tr text; ids int[]; n int; i int; a int; b int; hm int; aw int; la timestamptz; seas text; made int := 0;
begin
  select l.season into seas from league l where l.id = p_league_id;
  select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = p_week;
  foreach tr in array p_order loop
    ids := _tier_rosters(p_league_id, tr);
    n := coalesce(array_length(ids, 1), 0);
    continue when n < 2;
    if n % 2 = 1 then ids := ids || 0; n := n + 1; end if;   -- 0 = the week off
    for i in 0..(n / 2 - 1) loop
      a := ids[((p_idx - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n] else ids[((p_idx - 1 + n - 1 - i) % (n - 1)) + 1] end;
      continue when a = 0 or b = 0;
      if p_idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, p_week, hm, aw, 'scheduled', la)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  return made;
end $$;
revoke all on function _tier_week(uuid, int, int, text[]) from public, anon, authenticated;

-- ── build a period: clear what hasn't started from `from`, make its weeks ───
-- Only weeks whose every matchup is still 'scheduled' are cleared (a week
-- that has locked is never touched), and only through the regular season.
create or replace function _tier_build_period(p_league_id uuid, p_from int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare cfg jsonb; per int; ord text[]; cap int; st int; wk int; made int := 0; last int := 0;
begin
  cfg := _tiers_cfg(p_league_id);
  if cfg is null then return jsonb_build_object('ok', false, 'error', 'tiers are off'); end if;
  per := (cfg ->> 'period')::int;
  st := (cfg ->> 'start')::int;
  ord := array(select jsonb_array_elements_text(cfg -> 'order'));
  cap := league_last_regular_week(p_league_id);
  if p_from > cap then return jsonb_build_object('ok', true, 'weeks', 0, 'matchups', 0); end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.week between p_from and cap
               and not m.is_playoff and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', format('week %s or later has already started', p_from));
  end if;
  delete from matchup m where m.league_id = p_league_id and m.week between p_from and cap and not m.is_playoff;
  for wk in p_from .. least(cap, p_from + per - 1) loop
    made := made + _tier_week(p_league_id, wk, wk - st + 1, ord);
    last := wk;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'first_week', p_from, 'last_week', last, 'matchups', made);
end $$;
revoke all on function _tier_build_period(uuid, int) from public, anon, authenticated;

-- ── the league-wide round robin, back again (tiers turned off) ──────────────
create or replace function _tier_unbuild(p_league_id uuid, p_from int) returns int
  language plpgsql security definer set search_path = public as $$
declare ids int[]; n int; wk int; i int; a int; b int; hm int; aw int; la timestamptz; seas text; cap int; made int := 0; idx int;
begin
  cap := league_last_regular_week(p_league_id);
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.week between p_from and cap
               and not m.is_playoff and m.status <> 'scheduled') then
    return -1;
  end if;
  delete from matchup m where m.league_id = p_league_id and m.week between p_from and cap and not m.is_playoff;
  select array_agg(sleeper_roster_id order by sleeper_roster_id), count(*)::int into ids, n
    from league_membership where league_id = p_league_id;
  if n < 2 then return 0; end if;
  if n % 2 = 1 then ids := ids || 0; n := n + 1; end if;
  select l.season into seas from league l where l.id = p_league_id;
  for wk in p_from .. cap loop
    idx := wk;
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;
    for i in 0..(n / 2 - 1) loop
      a := ids[((idx - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n] else ids[((idx - 1 + n - 1 - i) % (n - 1)) + 1] end;
      continue when a = 0 or b = 0;
      if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, wk, hm, aw, 'scheduled', la)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  perform native_materialize(p_league_id);
  return made;
end $$;
revoke all on function _tier_unbuild(uuid, int) from public, anon, authenticated;

-- The first week nothing has started in (no matchup past 'scheduled').
create or replace function _tier_next_open_week(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce((select max(week) from matchup m where m.league_id = p_league_id and not m.is_playoff
                and m.status <> 'scheduled') + 1, 1),
    coalesce(league_first_open_week(p_league_id, (select season from league where id = p_league_id)), 1));
$$;
revoke all on function _tier_next_open_week(uuid) from public, anon, authenticated;

-- ── the commissioner's switch ───────────────────────────────────────────────
create or replace function set_league_tiers(p_league_id uuid, p_on boolean, p_period int default 4,
                                            p_movers int default 2, p_order text[] default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare labels text[]; ord text[]; smallest int; nxt int; built jsonb; cfg jsonb; tr text; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) or league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'tiers are for NFL leagues run here');
  end if;
  if league_is_college_calendar(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not on the college calendar');
  end if;
  if exists (select 1 from league where id = p_league_id and kind in ('dfs', 'bullseye', 'pod', 'weekly')) then
    return jsonb_build_object('ok', false, 'error', 'a weekly contest has no season to split');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  nxt := _tier_next_open_week(p_league_id);

  if not coalesce(p_on, false) then
    if _tiers_cfg(p_league_id) is null then return jsonb_build_object('ok', true, 'on', false); end if;
    update league set settings_json = jsonb_set(settings_json, '{tiers,on}', 'false'::jsonb) where id = p_league_id;
    if _tier_unbuild(p_league_id, nxt) < 0 then
      return jsonb_build_object('ok', false, 'error', 'a week has already started — try again before the next one');
    end if;
    return jsonb_build_object('ok', true, 'on', false, 'rebuilt_from', nxt);
  end if;

  if not exists (select 1 from draft d where d.league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'set the league up first');
  end if;
  if not league_divisions_active(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'tiers are the league''s divisions — give every team a division, at least two of them');
  end if;
  if p_period is null or p_period < 2 or p_period > 6 then
    return jsonb_build_object('ok', false, 'error', 'a period is 2 to 6 weeks');
  end if;
  if p_movers is null or p_movers < 1 or p_movers > 3 then
    return jsonb_build_object('ok', false, 'error', 'movers are 1 to 3');
  end if;
  select array_agg(distinct division order by division) into labels
    from league_membership where league_id = p_league_id;
  ord := coalesce(p_order, labels);
  if (select array_agg(x order by x) from unnest(ord) x) is distinct from labels
     or array_length(ord, 1) <> (select count(distinct x) from unnest(ord) x) then
    return jsonb_build_object('ok', false, 'error', 'order every division once, top tier first');
  end if;
  smallest := (select min(c) from (select count(*) as c from league_membership
                 where league_id = p_league_id group by division) s);
  if p_movers * 2 > smallest then
    return jsonb_build_object('ok', false, 'error',
      format('the smallest tier has %s teams — at most %s can move each way', smallest, smallest / 2));
  end if;
  if nxt > league_last_regular_week(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the regular season has no weeks left');
  end if;

  cfg := jsonb_build_object('on', true, 'period', p_period, 'movers', p_movers, 'order', to_jsonb(ord),
                            'start', nxt, 'done', nxt - 1);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('tiers', cfg)
   where id = p_league_id;
  built := _tier_build_period(p_league_id, nxt);
  if not coalesce((built ->> 'ok')::boolean, false) then
    raise exception '%', built ->> 'error';   -- roll the settings back with it
  end if;
  return jsonb_build_object('ok', true, 'on', true, 'start', nxt, 'period', p_period, 'movers', p_movers,
                            'order', to_jsonb(ord), 'built', built);
end $$;
grant execute on function set_league_tiers(uuid, boolean, int, int, text[]) to authenticated;

-- ── a period's table for one tier ───────────────────────────────────────────
create or replace function _tier_table(p_league_id uuid, p_tier text, p_from int, p_to int)
  returns table (roster_id int, wins numeric, losses numeric, points numeric)
  language sql stable security definer set search_path = public as $$
  with r as (select unnest(_tier_rosters(p_league_id, p_tier)) as rid),
  g as (
    select m.home_roster_id as rid, m.home_final as pf, m.away_final as pa from matchup m
     where m.league_id = p_league_id and m.week between p_from and p_to and m.status = 'final' and not m.is_playoff
    union all
    select m.away_roster_id, m.away_final, m.home_final from matchup m
     where m.league_id = p_league_id and m.week between p_from and p_to and m.status = 'final' and not m.is_playoff)
  select r.rid,
         coalesce(sum(case when g.pf > g.pa then 1 when g.pf = g.pa then 0.5 else 0 end), 0),
         coalesce(sum(case when g.pf < g.pa then 1 when g.pf = g.pa then 0.5 else 0 end), 0),
         coalesce(sum(g.pf), 0)
    from r left join g on g.rid = r.rid
   group by r.rid;
$$;
revoke all on function _tier_table(uuid, text, int, int) from public, anon, authenticated;

-- ── the boundary: moves, then the next period (the worker, every sweep) ─────
-- Idempotent: `done` records the last period whose moves ran. A period ends
-- when every regular-season matchup of its last week is final.
create or replace function tiers_advance(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare cfg jsonb; per int; st int; done int; mv int; ord text[]; b int; cap int; i int; k int;
        up_t text; dn_t text; down_ids int[]; up_ids int[]; lines text[] := '{}'; moved int := 0; built jsonb;
        rec record;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'the worker runs this');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  cfg := _tiers_cfg(p_league_id);
  if cfg is null then return jsonb_build_object('ok', true, 'skipped', 'off'); end if;
  per := (cfg ->> 'period')::int; st := (cfg ->> 'start')::int; done := (cfg ->> 'done')::int;
  mv := (cfg ->> 'movers')::int;
  ord := array(select jsonb_array_elements_text(cfg -> 'order'));
  cap := league_last_regular_week(p_league_id);
  b := done + per;                                   -- the next boundary
  if b >= cap then return jsonb_build_object('ok', true, 'skipped', 'season''s last period'); end if;
  if not exists (select 1 from matchup m where m.league_id = p_league_id and m.week = b and not m.is_playoff)
     or exists (select 1 from matchup m where m.league_id = p_league_id and m.week = b and not m.is_playoff
                  and m.status <> 'final') then
    return jsonb_build_object('ok', true, 'skipped', format('week %s is not final', b));
  end if;

  -- Each adjacent pair: the bottom `mv` of the upper tier and the top `mv` of
  -- the lower one, both read BEFORE either moves.
  for i in 1 .. array_length(ord, 1) - 1 loop
    up_t := ord[i]; dn_t := ord[i + 1];
    select array_agg(roster_id order by wins asc, points asc, roster_id desc) into down_ids
      from (select * from _tier_table(p_league_id, up_t, b - per + 1, b)
             order by wins asc, points asc, roster_id desc limit mv) s;
    select array_agg(roster_id order by wins desc, points desc, roster_id asc) into up_ids
      from (select * from _tier_table(p_league_id, dn_t, b - per + 1, b)
             order by wins desc, points desc, roster_id asc limit mv) s;
    for k in 1 .. least(coalesce(array_length(down_ids, 1), 0), coalesce(array_length(up_ids, 1), 0)) loop
      for rec in select * from _tier_table(p_league_id, up_t, b - per + 1, b) t where t.roster_id = down_ids[k] loop
        insert into league_tier_move (league_id, after_week, roster_id, direction, from_tier, to_tier, wins, points)
        values (p_league_id, b, rec.roster_id, 'down', up_t, dn_t, rec.wins, rec.points);
      end loop;
      for rec in select * from _tier_table(p_league_id, dn_t, b - per + 1, b) t where t.roster_id = up_ids[k] loop
        insert into league_tier_move (league_id, after_week, roster_id, direction, from_tier, to_tier, wins, points)
        values (p_league_id, b, rec.roster_id, 'up', dn_t, up_t, rec.wins, rec.points);
      end loop;
      lines := lines || (_txn_team(p_league_id, up_ids[k]) || ' up to ' || up_t);
      lines := lines || (_txn_team(p_league_id, down_ids[k]) || ' down to ' || dn_t);
      moved := moved + 2;
    end loop;
  end loop;
  -- Now the labels move (after every table above was read).
  update league_membership m set division = t.to_tier
    from league_tier_move t
   where t.league_id = p_league_id and t.after_week = b
     and m.league_id = p_league_id and m.sleeper_roster_id = t.roster_id;
  update league set settings_json = jsonb_set(settings_json, '{tiers,done}', to_jsonb(b)) where id = p_league_id;
  if moved > 0 then
    perform _chat_house(p_league_id,
      '🔁 Tiers after week ' || b || ': ' || array_to_string(lines, ' · '),
      jsonb_build_object('kind', 'tiers', 'after_week', b));
  end if;
  built := _tier_build_period(p_league_id, b + 1);
  return jsonb_build_object('ok', true, 'after_week', b, 'moved', moved, 'built', built);
end $$;
revoke all on function tiers_advance(uuid) from public, anon;
grant execute on function tiers_advance(uuid) to authenticated, service_role;

-- ── what a member sees ──────────────────────────────────────────────────────
create or replace function league_tiers(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; per int; st int; done int; pf int; pt int; ord text[]; tr text; out jsonb := '[]'::jsonb; i int := 0;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  cfg := _tiers_cfg(p_league_id);
  if cfg is null then return jsonb_build_object('ok', true, 'on', false); end if;
  per := (cfg ->> 'period')::int; st := (cfg ->> 'start')::int; done := (cfg ->> 'done')::int;
  pf := done + 1; pt := done + per;
  ord := array(select jsonb_array_elements_text(cfg -> 'order'));
  foreach tr in array ord loop
    i := i + 1;
    out := out || jsonb_build_object('tier', tr, 'rank', i, 'teams', coalesce((
      select jsonb_agg(jsonb_build_object('roster_id', t.roster_id, 'team', _txn_team(p_league_id, t.roster_id),
                                          'wins', t.wins, 'losses', t.losses, 'points', round(t.points, 1))
                       order by t.wins desc, t.points desc, t.roster_id)
        from _tier_table(p_league_id, tr, pf, pt) t), '[]'::jsonb));
  end loop;
  return jsonb_build_object('ok', true, 'on', true, 'period', per, 'movers', (cfg ->> 'movers')::int,
    'start', st, 'period_from', pf, 'period_to', least(pt, league_last_regular_week(p_league_id)),
    'last_regular', league_last_regular_week(p_league_id), 'tiers', out,
    'moves', coalesce((select jsonb_agg(jsonb_build_object('after_week', m.after_week, 'roster_id', m.roster_id,
              'team', _txn_team(p_league_id, m.roster_id), 'direction', m.direction, 'from_tier', m.from_tier,
              'to_tier', m.to_tier) order by m.after_week desc, m.direction, m.roster_id)
       from league_tier_move m where m.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function league_tiers(uuid) to authenticated;
