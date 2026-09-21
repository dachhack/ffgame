-- 0325: WEEKLY AWARDS AND BADGES — the league's own trophies, defined by the
-- league.
--
-- The last piece of the gap list's history row (0324 did the champions, the
-- all-time table and the record book). Sleeper posts weekly awards to chat,
-- Yahoo and ESPN hand out achievement badges. Both do it with a FIXED set.
-- Here the set is the league's, because the joke is the point: a league that
-- calls its low-score award THE BROWN JUG and pays it 50 coins is a league
-- with an inside joke, and that is the whole feature.
--
-- THE RULE GRAMMAR. An award is three choices, which between them cover
-- everything a week's scores can say about a team:
--
--   metric    points | points_against | margin | combined
--   direction high | low
--   only      any | win | loss
--
-- So: high score is points/high/any. The sad sack is points/low/any. The
-- biggest beating is margin/high/any. "Unluckiest" — the highest score that
-- still lost — is points/high/LOSS, which is the one every league invents for
-- itself and no platform lets you write down. "Won ugly" is points/low/win.
-- "Slugfest" (the week's biggest shootout) is combined/high. Ties award
-- everybody tied, because a tie IS the story that week.
--
-- DEFAULTS THAT ARE NOT SETTINGS. A league with no awards configured runs the
-- four built-ins below, so the feature works the week it ships without anybody
-- opening a console. The first edit MATERIALIZES them as rows — from then on
-- the list is the league's own, and deleting them all means no awards, which
-- is a real choice and is honoured.
--
-- BADGES are the other half: permanent marks, defined and handed out by the
-- commissioner (🐐, 🤡, PAID HIS DUES, whatever the league is like), stamped
-- with the season they were earned. The automatic ones — titles, award counts
-- — the history surface already derives; these are the ones a person decides.

-- ═══ 1. the definitions ══════════════════════════════════════════════════════
create table if not exists league_award (
  league_id  uuid not null references league(id) on delete cascade,
  key        text not null,
  name       text not null,
  icon       text not null default '🏅',
  metric     text not null default 'points'
             check (metric in ('points', 'points_against', 'margin', 'combined')),
  direction  text not null default 'high' check (direction in ('high', 'low')),
  only_result text not null default 'any' check (only_result in ('any', 'win', 'loss')),
  -- An optional prize in drip coin, paid into the winner's wallet when the
  -- award lands. 0 = a trophy and nothing else, which is most of them.
  coin       numeric not null default 0,
  active     boolean not null default true,
  sort       int not null default 0,
  note       text,
  primary key (league_id, key)
);
alter table league_award enable row level security;
drop policy if exists league_award_read on league_award;
create policy league_award_read on league_award for select using (is_league_member(league_id));

-- One week's winner of one award. The NAME AND ICON ARE SNAPSHOTTED: a league
-- that renames its award in October has not renamed what it handed out in
-- September, and a trophy case that rewrites itself is not a record.
create table if not exists league_award_win (
  league_id  uuid not null references league(id) on delete cascade,
  week       int  not null,
  key        text not null,
  roster_id  int  not null,
  value      numeric,
  name       text not null,
  icon       text not null default '🏅',
  awarded_at timestamptz not null default now(),
  primary key (league_id, week, key, roster_id)
);
create index if not exists league_award_win_team on league_award_win(league_id, roster_id);
alter table league_award_win enable row level security;
drop policy if exists league_award_win_read on league_award_win;
create policy league_award_win_read on league_award_win for select using (is_league_member(league_id));

create table if not exists league_badge (
  league_id uuid not null references league(id) on delete cascade,
  key       text not null,
  name      text not null,
  icon      text not null default '🎖',
  note      text,
  sort      int not null default 0,
  primary key (league_id, key)
);
alter table league_badge enable row level security;
drop policy if exists league_badge_read on league_badge;
create policy league_badge_read on league_badge for select using (is_league_member(league_id));

-- A badge on a seat, stamped with the season it was earned — so the same
-- badge can be won again next year without erasing this year's.
create table if not exists league_badge_grant (
  league_id  uuid not null references league(id) on delete cascade,
  key        text not null,
  roster_id  int  not null,
  season     text not null default '',
  note       text,
  granted_at timestamptz not null default now(),
  granted_by uuid,
  primary key (league_id, key, roster_id, season)
);
alter table league_badge_grant enable row level security;
drop policy if exists league_badge_grant_read on league_badge_grant;
create policy league_badge_grant_read on league_badge_grant for select using (is_league_member(league_id));

-- ═══ 2. the defaults ═════════════════════════════════════════════════════════
-- Four, and deliberately four: the two everybody expects, the one everybody
-- enjoys, and the one every league invents for itself.
create or replace function _default_awards() returns jsonb
  language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'high', 'name', 'High Score', 'icon', '🔥',
      'metric', 'points', 'direction', 'high', 'only_result', 'any', 'sort', 1),
    jsonb_build_object('key', 'low', 'name', 'Low Score', 'icon', '💤',
      'metric', 'points', 'direction', 'low', 'only_result', 'any', 'sort', 2),
    jsonb_build_object('key', 'blowout', 'name', 'Biggest Beating', 'icon', '🔨',
      'metric', 'margin', 'direction', 'high', 'only_result', 'win', 'sort', 3),
    jsonb_build_object('key', 'unlucky', 'name', 'Tough Luck', 'icon', '💔',
      'metric', 'points', 'direction', 'high', 'only_result', 'loss', 'sort', 4));
$$;

-- The league's awards as rows — its own if it has any, else the built-ins.
create or replace function _league_award_defs(p_league_id uuid)
  returns table (key text, name text, icon text, metric text, direction text,
                 only_result text, coin numeric, sort int, is_default boolean)
  language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from league_award a where a.league_id = p_league_id) then
    return query select a.key, a.name, a.icon, a.metric, a.direction, a.only_result, a.coin, a.sort, false
      from league_award a where a.league_id = p_league_id and a.active order by a.sort, a.key;
  else
    return query select d ->> 'key', d ->> 'name', d ->> 'icon', d ->> 'metric', d ->> 'direction',
                        d ->> 'only_result', 0::numeric, (d ->> 'sort')::int, true
      from jsonb_array_elements(_default_awards()) d;
  end if;
end $$;
grant execute on function _league_award_defs(uuid) to authenticated;

-- Write the built-ins down as real rows. Called before the first edit, so a
-- commissioner who renames one award does not thereby delete the other three.
create or replace function _materialize_awards(p_league_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from league_award a where a.league_id = p_league_id) then return; end if;
  insert into league_award (league_id, key, name, icon, metric, direction, only_result, sort)
  select p_league_id, d ->> 'key', d ->> 'name', d ->> 'icon', d ->> 'metric',
         d ->> 'direction', d ->> 'only_result', (d ->> 'sort')::int
    from jsonb_array_elements(_default_awards()) d
  on conflict do nothing;
end $$;
revoke all on function _materialize_awards(uuid) from public, anon, authenticated;

-- ═══ 3. handing them out ═════════════════════════════════════════════════════
-- Award one league-week. Idempotent by the primary key, and re-runnable: an
-- award added in week 9 can be handed out for week 3 by running it again,
-- without disturbing what week 3 already gave. Only a week whose every
-- matchup is final is awarded — half a week has no high score.
create or replace function award_week(p_league_id uuid, p_week int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a record; n int := 0; total int := 0; lines text[]; seas text;
begin
  if p_week is null or p_week >= 100 then   -- preseason (101+) hands out nothing
    return jsonb_build_object('ok', true, 'awarded', 0, 'skipped', 'preseason');
  end if;
  if not exists (select 1 from matchup m where m.league_id = p_league_id and m.week = p_week) then
    return jsonb_build_object('ok', true, 'awarded', 0, 'skipped', 'no such week');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.week = p_week
              and (m.status <> 'final' or m.home_final is null or m.away_final is null)) then
    return jsonb_build_object('ok', true, 'awarded', 0, 'skipped', 'week not final');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':awards'));
  select season into seas from league where id = p_league_id;

  for a in select * from _league_award_defs(p_league_id) loop
    -- Every team's week as one row: its score, what it gave up, its margin,
    -- and the game's total. `only` filters to winners or losers first, so
    -- "highest score in a loss" is one rule rather than a special case.
    with sides as (
      select m.home_roster_id as roster_id, m.home_final::numeric as pts, m.away_final::numeric as opp
        from matchup m where m.league_id = p_league_id and m.week = p_week
      union all
      select m.away_roster_id, m.away_final::numeric, m.home_final::numeric
        from matchup m where m.league_id = p_league_id and m.week = p_week
    ), scored as (
      select s.roster_id,
             case a.metric when 'points' then s.pts
                           when 'points_against' then s.opp
                           when 'margin' then s.pts - s.opp
                           else s.pts + s.opp end as v
        from sides s
       where a.only_result = 'any'
          or (a.only_result = 'win' and s.pts > s.opp)
          or (a.only_result = 'loss' and s.pts < s.opp)
    ), best as (
      select case when a.direction = 'high' then max(v) else min(v) end as v from scored
    )
    insert into league_award_win (league_id, week, key, roster_id, value, name, icon)
    select p_league_id, p_week, a.key, sc.roster_id, round(sc.v, 2), a.name, a.icon
      from scored sc, best b where sc.v = b.v
    on conflict do nothing;
    get diagnostics n = row_count;
    total := total + n;
    if n > 0 then
      -- The coin prize, if the award carries one. Its own idem_key, so a
      -- re-run pays nothing twice.
      if a.coin <> 0 then
        insert into coin_ledger (league_id, roster_id, week, delta, reason, idem_key)
        select p_league_id, w.roster_id, p_week, a.coin, 'award:' || a.key,
               'award:' || p_league_id::text || ':' || p_week || ':' || a.key || ':' || w.roster_id
          from league_award_win w
         where w.league_id = p_league_id and w.week = p_week and w.key = a.key
        on conflict (idem_key) do nothing;
        insert into team_wallet (league_id, roster_id, coins)
        select p_league_id, w.roster_id, a.coin from league_award_win w
         where w.league_id = p_league_id and w.week = p_week and w.key = a.key
        on conflict (league_id, roster_id) do update set coins = team_wallet.coins + a.coin, updated_at = now();
      end if;
      lines := coalesce(lines, '{}') || (
        select a.icon || ' ' || a.name || ' — ' || string_agg(_txn_team(p_league_id, w.roster_id), ' & ')
          || ' (' || trim(trailing '.' from trim(trailing '0' from to_char(max(w.value), 'FM999999.00'))) || ')'
          || case when a.coin <> 0 then ' · ' || a.coin || ' coin' else '' end
        from league_award_win w
        where w.league_id = p_league_id and w.week = p_week and w.key = a.key);
    end if;
  end loop;

  if total > 0 then
    perform _chat_house(p_league_id,
      '🏅 Week ' || p_week || ' awards — ' || array_to_string(lines, ' · '),
      jsonb_build_object('kind', 'award', 'week', p_week, 'awarded', total));
  end if;
  return jsonb_build_object('ok', true, 'awarded', total, 'week', p_week, 'season', seas);
end $$;
grant execute on function award_week(uuid, int) to authenticated;

-- The worker's pass (server/src/native.js): every league-week that has gone
-- final and has no awards yet. Cheap — the not-exists is the whole gate.
create or replace function award_sweep() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r record; res jsonb; weeks int := 0; given int := 0;
begin
  for r in
    select m.league_id, m.week
      from matchup m
      join league l on l.id = m.league_id
     where m.week < 100 and l.provider = 'native' and coalesce(l.kind, 'league') = 'league'
       and not coalesce(l.is_mock, false)
     group by m.league_id, m.week
    having count(*) filter (where m.status <> 'final' or m.home_final is null or m.away_final is null) = 0
       and not exists (select 1 from league_award_win w
                        where w.league_id = m.league_id and w.week = m.week)
  loop
    begin
      res := award_week(r.league_id, r.week);
      if coalesce((res ->> 'awarded')::int, 0) > 0 then weeks := weeks + 1; given := given + (res ->> 'awarded')::int; end if;
    exception when others then null;   -- one league's bad week never stops the sweep
    end;
  end loop;
  return jsonb_build_object('ok', true, 'weeks', weeks, 'awards', given);
end $$;
revoke all on function award_sweep() from public, anon, authenticated;
grant execute on function award_sweep() to service_role;

-- ═══ 4. the commissioner's editors ═══════════════════════════════════════════
-- Add or change one award. The key is the identity: passing an existing key
-- edits it, a new one adds it. Nulls leave a field alone on an edit, so the
-- console can save one field at a time.
create or replace function commish_set_award(
  p_league_id uuid, p_key text, p_name text default null, p_icon text default null,
  p_metric text default null, p_direction text default null, p_only_result text default null,
  p_coin numeric default null, p_active boolean default null, p_sort int default null,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; existing league_award%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  k := lower(regexp_replace(btrim(coalesce(p_key, '')), '[^a-zA-Z0-9_-]+', '-', 'g'));
  if k = '' then return jsonb_build_object('ok', false, 'error', 'an award needs a key'); end if;
  if length(k) > 40 then return jsonb_build_object('ok', false, 'error', 'that key is too long'); end if;
  if p_metric is not null and p_metric not in ('points', 'points_against', 'margin', 'combined') then
    return jsonb_build_object('ok', false, 'error', 'the metric is points, points_against, margin or combined');
  end if;
  if p_direction is not null and p_direction not in ('high', 'low') then
    return jsonb_build_object('ok', false, 'error', 'the direction is high or low');
  end if;
  if p_only_result is not null and p_only_result not in ('any', 'win', 'loss') then
    return jsonb_build_object('ok', false, 'error', 'it counts any week, a win or a loss');
  end if;
  if p_coin is not null and (p_coin < 0 or p_coin > 100000) then
    return jsonb_build_object('ok', false, 'error', 'a prize is 0–100000 coin');
  end if;
  -- The first edit writes the built-ins down, so renaming one does not
  -- silently delete the other three.
  perform _materialize_awards(p_league_id);
  select * into existing from league_award where league_id = p_league_id and key = k;
  if not found and btrim(coalesce(p_name, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'a new award needs a name');
  end if;
  insert into league_award (league_id, key, name, icon, metric, direction, only_result, coin, active, sort, note)
  values (p_league_id, k,
          coalesce(nullif(btrim(coalesce(p_name, '')), ''), existing.name, k),
          coalesce(nullif(btrim(coalesce(p_icon, '')), ''), existing.icon, '🏅'),
          coalesce(p_metric, existing.metric, 'points'),
          coalesce(p_direction, existing.direction, 'high'),
          coalesce(p_only_result, existing.only_result, 'any'),
          coalesce(p_coin, existing.coin, 0),
          coalesce(p_active, existing.active, true),
          coalesce(p_sort, existing.sort, 99),
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), existing.note))
  on conflict (league_id, key) do update set
    name = excluded.name, icon = excluded.icon, metric = excluded.metric,
    direction = excluded.direction, only_result = excluded.only_result,
    coin = excluded.coin, active = excluded.active, sort = excluded.sort, note = excluded.note;
  return jsonb_build_object('ok', true, 'key', k);
end $$;
grant execute on function commish_set_award(uuid, text, text, text, text, text, text, numeric, boolean, int, text) to authenticated;

-- Remove an award. What it has already handed out STAYS — the trophy case is
-- a record of what happened, not of what the rules currently say.
create or replace function commish_delete_award(p_league_id uuid, p_key text) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform _materialize_awards(p_league_id);
  delete from league_award where league_id = p_league_id and key = p_key;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such award'); end if;
  return jsonb_build_object('ok', true, 'deleted', p_key,
    'kept_wins', (select count(*) from league_award_win w where w.league_id = p_league_id and w.key = p_key));
end $$;
grant execute on function commish_delete_award(uuid, text) to authenticated;

-- ── badges ───────────────────────────────────────────────────────────────
create or replace function commish_set_badge(
  p_league_id uuid, p_key text, p_name text default null, p_icon text default null,
  p_note text default null, p_sort int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; existing league_badge%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  k := lower(regexp_replace(btrim(coalesce(p_key, '')), '[^a-zA-Z0-9_-]+', '-', 'g'));
  if k = '' then return jsonb_build_object('ok', false, 'error', 'a badge needs a key'); end if;
  select * into existing from league_badge where league_id = p_league_id and key = k;
  if not found and btrim(coalesce(p_name, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'a new badge needs a name');
  end if;
  insert into league_badge (league_id, key, name, icon, note, sort)
  values (p_league_id, k,
          coalesce(nullif(btrim(coalesce(p_name, '')), ''), existing.name, k),
          coalesce(nullif(btrim(coalesce(p_icon, '')), ''), existing.icon, '🎖'),
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), existing.note),
          coalesce(p_sort, existing.sort, 99))
  on conflict (league_id, key) do update set
    name = excluded.name, icon = excluded.icon, note = excluded.note, sort = excluded.sort;
  return jsonb_build_object('ok', true, 'key', k);
end $$;
grant execute on function commish_set_badge(uuid, text, text, text, text, int) to authenticated;

create or replace function commish_delete_badge(p_league_id uuid, p_key text) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  delete from league_badge_grant where league_id = p_league_id and key = p_key;
  delete from league_badge where league_id = p_league_id and key = p_key;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such badge'); end if;
  return jsonb_build_object('ok', true, 'deleted', p_key);
end $$;
grant execute on function commish_delete_badge(uuid, text) to authenticated;

-- Pin a badge on a seat. The season defaults to the league's own, so the same
-- badge can be won again next year without erasing this year's.
create or replace function commish_grant_badge(
  p_league_id uuid, p_roster_id int, p_key text, p_season text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare seas text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not exists (select 1 from league_badge b where b.league_id = p_league_id and b.key = p_key) then
    return jsonb_build_object('ok', false, 'error', 'no such badge — make it first');
  end if;
  if not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'no such team');
  end if;
  select coalesce(p_season, season, '') into seas from league where id = p_league_id;
  insert into league_badge_grant (league_id, key, roster_id, season, note, granted_by)
  values (p_league_id, p_key, p_roster_id, coalesce(seas, ''), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (league_id, key, roster_id, season) do update set note = excluded.note, granted_at = now();
  perform _chat_house(p_league_id,
    (select b.icon || ' ' || _txn_team(p_league_id, p_roster_id) || ' earned ' || b.name
       from league_badge b where b.league_id = p_league_id and b.key = p_key)
      || case when nullif(btrim(coalesce(p_note, '')), '') is not null then ' — ' || btrim(p_note) else '' end,
    jsonb_build_object('kind', 'badge', 'roster_id', p_roster_id, 'badge', p_key));
  return jsonb_build_object('ok', true, 'season', seas);
end $$;
grant execute on function commish_grant_badge(uuid, int, text, text, text) to authenticated;

create or replace function commish_revoke_badge(
  p_league_id uuid, p_roster_id int, p_key text, p_season text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare seas text; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select coalesce(p_season, season, '') into seas from league where id = p_league_id;
  delete from league_badge_grant where league_id = p_league_id and key = p_key
     and roster_id = p_roster_id and season = coalesce(seas, '');
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'that seat does not hold it this season'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function commish_revoke_badge(uuid, int, text, text) to authenticated;

-- ═══ 5. what the screens read ════════════════════════════════════════════════
-- The awards as they stand (with `is_default` so a console can say "these are
-- the built-ins until you change one"), the badge definitions, every grant,
-- and the recent weeks' winners.
create or replace function league_awards(p_league_id uuid, p_weeks int default 6) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'awards', coalesce((select jsonb_agg(jsonb_build_object(
        'key', d.key, 'name', d.name, 'icon', d.icon, 'metric', d.metric,
        'direction', d.direction, 'only_result', d.only_result, 'coin', d.coin,
        'sort', d.sort, 'is_default', d.is_default) order by d.sort, d.key)
      from _league_award_defs(p_league_id) d), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object(
        'key', b.key, 'name', b.name, 'icon', b.icon, 'note', b.note, 'sort', b.sort)
        order by b.sort, b.key)
      from league_badge b where b.league_id = p_league_id), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object(
        'key', g.key, 'roster_id', g.roster_id, 'season', g.season, 'note', g.note,
        'team', _txn_team(p_league_id, g.roster_id),
        'icon', (select b.icon from league_badge b where b.league_id = p_league_id and b.key = g.key),
        'name', (select b.name from league_badge b where b.league_id = p_league_id and b.key = g.key))
        order by g.granted_at desc)
      from league_badge_grant g where g.league_id = p_league_id), '[]'::jsonb),
    -- The recent weeks, newest first: one entry per week with its winners.
    'weeks', coalesce((select jsonb_agg(jsonb_build_object(
        'week', x.week,
        'wins', (select jsonb_agg(jsonb_build_object(
            'key', w.key, 'name', w.name, 'icon', w.icon, 'roster_id', w.roster_id,
            'team', _txn_team(p_league_id, w.roster_id), 'value', w.value)
            order by w.key)
          from league_award_win w where w.league_id = p_league_id and w.week = x.week))
        order by x.week desc)
      from (select distinct week from league_award_win
             where league_id = p_league_id order by week desc limit greatest(p_weeks, 1)) x), '[]'::jsonb),
    -- The trophy count per seat, all of this season's weeks.
    'counts', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', c.roster_id, 'team', _txn_team(p_league_id, c.roster_id),
        'key', c.key, 'icon', c.icon, 'name', c.name, 'n', c.n)
        order by c.n desc, c.roster_id)
      from (select w.roster_id, w.key, max(w.icon) as icon, max(w.name) as name, count(*)::int as n
              from league_award_win w where w.league_id = p_league_id
             group by w.roster_id, w.key) c), '[]'::jsonb));
end $$;
grant execute on function league_awards(uuid, int) to authenticated;


-- ═══ 6. the trophy case joins the history ════════════════════════════════════
-- league_history: 0324's body, with each manager's weekly-award count and the
-- badges pinned on them. The lateral join is what lets one manager's badges
-- across several seats and seasons collapse into one list.
create or replace function league_history(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare ids uuid[]; out_ jsonb;
begin
  if not _may_read_history(p_league_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  ids := _lineage_ids(p_league_id);

  with seasons as (
    select l.id, l.season, l.name, l.settings_json,
           nullif(l.settings_json ->> 'playoff_champion', '')::int as champ
    from league l where l.id = any (ids)
  ),
  -- Every final game as two rows, one per side: the shape every record below
  -- wants. Preseason (101+) never counts.
  sides as (
    select m.league_id, m.week, m.is_playoff, m.is_consolation, m.playoff_round, m.playoff_label,
           m.home_roster_id as roster_id, m.away_roster_id as opp,
           m.home_final::numeric as pts, m.away_final::numeric as opp_pts
      from matchup m
     where m.league_id = any (ids) and m.status = 'final' and m.week < 100
       and m.home_final is not null and m.away_final is not null
    union all
    select m.league_id, m.week, m.is_playoff, m.is_consolation, m.playoff_round, m.playoff_label,
           m.away_roster_id, m.home_roster_id, m.away_final::numeric, m.home_final::numeric
      from matchup m
     where m.league_id = any (ids) and m.status = 'final' and m.week < 100
       and m.home_final is not null and m.away_final is not null
  ),
  -- A seat's regular season, per season.
  reg as (
    select s.league_id, s.roster_id,
           count(*) filter (where s.pts > s.opp_pts)::int as w,
           count(*) filter (where s.pts < s.opp_pts)::int as l,
           count(*) filter (where s.pts = s.opp_pts)::int as t,
           round(sum(s.pts), 2) as pf, round(sum(s.opp_pts), 2) as pa
      from sides s where not s.is_playoff
     group by s.league_id, s.roster_id
  ),
  -- The title game: the deepest non-consolation playoff round that finished.
  finals as (
    select distinct on (m.league_id) m.league_id, m.home_roster_id, m.away_roster_id,
           m.home_final::numeric as hf, m.away_final::numeric as af
      from matchup m
     where m.league_id = any (ids) and m.is_playoff and not m.is_consolation
       and m.status = 'final' and m.home_final is not null and m.away_final is not null
     order by m.league_id, m.playoff_round desc nulls last, m.week desc
  ),
  -- Who held each seat, per season, and what they called themselves.
  seats as (
    select mm.league_id, mm.sleeper_roster_id as roster_id, mm.team_name, mm.app_user_id, mm.avatar_url,
           coalesce(mm.app_user_id::text, 'seat:' || mm.sleeper_roster_id) as mgr
      from league_membership mm where mm.league_id = any (ids)
  )
  select jsonb_build_object(
    'ok', true,
    'league_id', p_league_id,
    'seasons_count', (select count(*) from seasons),
    -- ── the seasons, newest first ──
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'league_id', s.id, 'season', s.season, 'name', s.name,
        'current', s.id = p_league_id,
        'champion', case when s.champ is not null then jsonb_build_object(
            'roster_id', s.champ,
            'team', (select st.team_name from seats st where st.league_id = s.id and st.roster_id = s.champ),
            'avatar', (select st.avatar_url from seats st where st.league_id = s.id and st.roster_id = s.champ)) end,
        'runner_up', (select case when f.hf is null then null else
             jsonb_build_object('roster_id', case when f.hf > f.af then f.away_roster_id else f.home_roster_id end,
                                'team', (select st.team_name from seats st where st.league_id = s.id
                                          and st.roster_id = case when f.hf > f.af then f.away_roster_id else f.home_roster_id end))
           end from finals f where f.league_id = s.id),
        -- the regular-season table, best first
        'table', coalesce((
          select jsonb_agg(jsonb_build_object(
              'roster_id', r.roster_id,
              'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id),
              'w', r.w, 'l', r.l, 't', r.t, 'pf', r.pf, 'pa', r.pa)
            order by r.w desc, r.pf desc)
          from reg r where r.league_id = s.id), '[]'::jsonb),
        -- the season's own high-water mark
        'high_week', (select jsonb_build_object('week', x.week, 'roster_id', x.roster_id, 'points', round(x.pts, 2),
                               'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id))
                        from sides x where x.league_id = s.id order by x.pts desc limit 1))
        order by s.season desc)
      from seasons s), '[]'::jsonb),
    -- ── the record book, all-time across the lineage ──
    'records', jsonb_build_object(
      'top_weeks', coalesce((select jsonb_agg(e order by (e ->> 'points')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'playoff', x.is_playoff, 'points', round(x.pts, 2),
                   'roster_id', x.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'opp_points', round(x.opp_pts, 2),
                   'opp', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp)) as e
            from sides x order by x.pts desc limit 10) q), '[]'::jsonb),
      'low_weeks', coalesce((select jsonb_agg(e order by (e ->> 'points')::numeric) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'points', round(x.pts, 2), 'roster_id', x.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id)) as e
            from sides x order by x.pts limit 5) q), '[]'::jsonb),
      'blowouts', coalesce((select jsonb_agg(e order by (e ->> 'margin')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'margin', round(x.pts - x.opp_pts, 2),
                   'winner', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'loser', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp),
                   'score', round(x.pts, 2) || '–' || round(x.opp_pts, 2)) as e
            from sides x where x.pts > x.opp_pts order by x.pts - x.opp_pts desc limit 5) q), '[]'::jsonb),
      'nailbiters', coalesce((select jsonb_agg(e order by (e ->> 'margin')::numeric) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = x.league_id),
                   'week', x.week, 'margin', round(x.pts - x.opp_pts, 2),
                   'winner', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.roster_id),
                   'loser', (select st.team_name from seats st where st.league_id = x.league_id and st.roster_id = x.opp),
                   'score', round(x.pts, 2) || '–' || round(x.opp_pts, 2)) as e
            from sides x where x.pts > x.opp_pts order by x.pts - x.opp_pts limit 5) q), '[]'::jsonb),
      'top_seasons', coalesce((select jsonb_agg(e order by (e ->> 'pf')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = r.league_id),
                   'pf', r.pf, 'record', r.w || '-' || r.l || case when r.t > 0 then '-' || r.t else '' end,
                   'roster_id', r.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id)) as e
            from reg r order by r.pf desc limit 5) q), '[]'::jsonb),
      'best_records', coalesce((select jsonb_agg(e order by (e ->> 'pct')::numeric desc, (e ->> 'pf')::numeric desc) from (
          select jsonb_build_object('season', (select se.season from seasons se where se.id = r.league_id),
                   'record', r.w || '-' || r.l || case when r.t > 0 then '-' || r.t else '' end,
                   'pct', round((r.w + r.t / 2.0) / nullif(r.w + r.l + r.t, 0), 3),
                   'pf', r.pf, 'roster_id', r.roster_id,
                   'team', (select st.team_name from seats st where st.league_id = r.league_id and st.roster_id = r.roster_id)) as e
            from reg r where r.w + r.l + r.t >= 4 order by (r.w + r.t / 2.0) / nullif(r.w + r.l + r.t, 0) desc, r.pf desc limit 5) q), '[]'::jsonb)),
    -- ── the managers, all-time ──
    -- Ordered by titles, then wins: a champions-first table, which is the one
    -- argument this screen exists to settle.
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'manager', g.mgr, 'team', g.team, 'app_user_id', g.uid,
          'seasons', g.seasons, 'w', g.w, 'l', g.l, 't', g.t, 'pf', g.pf,
          'titles', g.titles, 'finals', g.finals,
          'awards', g.awards, 'badges', g.badges)
        order by g.titles desc, g.w desc, g.pf desc)
      from (
        select st.mgr,
               max(st.app_user_id::text)::uuid as uid,
               -- the name they go by now: the latest season's team name
               (array_agg(st.team_name order by (select se.season from seasons se where se.id = st.league_id) desc))[1] as team,
               count(distinct st.league_id)::int as seasons,
               coalesce(sum(r.w), 0)::int as w, coalesce(sum(r.l), 0)::int as l,
               coalesce(sum(r.t), 0)::int as t, coalesce(round(sum(r.pf), 2), 0) as pf,
               count(*) filter (where exists (select 1 from seasons se
                  where se.id = st.league_id and se.champ = st.roster_id))::int as titles,
               count(*) filter (where exists (select 1 from finals f
                  where f.league_id = st.league_id
                    and st.roster_id in (f.home_roster_id, f.away_roster_id)))::int as finals,
               -- 0325: the trophy case. Weekly awards won across every season
               -- this manager held a seat in, and the badges pinned on them.
               coalesce(sum((select count(*) from league_award_win aw
                  where aw.league_id = st.league_id and aw.roster_id = st.roster_id)), 0)::int as awards,
               coalesce(jsonb_agg(distinct jsonb_build_object(
                     'icon', bg.icon, 'name', bg.bname, 'season', bg.season))
                   filter (where bg.key is not null), '[]'::jsonb) as badges
          from seats st
          left join reg r on r.league_id = st.league_id and r.roster_id = st.roster_id
          left join lateral (
            select g.key, g.season, b.icon, b.name as bname
              from league_badge_grant g
              join league_badge b on b.league_id = g.league_id and b.key = g.key
             where g.league_id = st.league_id and g.roster_id = st.roster_id) bg on true
         group by st.mgr
      ) g), '[]'::jsonb))
  into out_;
  return out_;
end $$;
grant execute on function league_history(uuid) to authenticated;
