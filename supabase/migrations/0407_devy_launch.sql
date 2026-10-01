-- ═══════════════════════════════════════════════════════════════════════════
-- 0407 · NEW PLAYERS LAUNCH INTO THE DEVY MARKET FAIRLY.
--
-- Founder: "We need a way to launch new players into the market in a way that
-- is fair for users." … "build it with a sim first and do an off season
-- version that does a catch up. This should all be commish controllable."
--
-- Before: a player was buyable the moment the college sweep found him, so the
-- first manager to open the app could max him before anyone saw his name.
-- scripts/sim-devy-launch.mjs measured it — 400 seasons, 12 teams: hourly
-- checkers won 15× a casual's share of new players' rights. A sealed window
-- capped at 10 shares barely helped (12×: the race just restarted at the
-- close). A sealed window with full-size orders and a LOTTERY among teams that
-- max at the fill is near-fair, and a 72h window brings casuals to 0.88×.
--
-- THE RULES (every number a commissioner setting, settings_json.devy_launch):
--   · A LISTING is a college QB/RB/WR/TE who first appears (college_player.
--     first_seen) after the league's baseline and hasn't launched in its
--     lineage. He can be scouted, not bought (allot_devy_shares refuses).
--   · WEEKLY LAUNCH (dow/hour ET, default Tuesday 12:00): every pending
--     listing opens together for window_h hours (default 72). His OPENING
--     PRICE is fixed when the window opens: his market price, else StatHead's
--     devy rank on the price curve, else the 1-point floor.
--   · SEALED ORDERS: one per team per player, up to `cap` shares (default 20,
--     a full stake), changeable until the close. Nobody sees anyone else's.
--   · THE FILL: at the close every order fills at the opening price, in a
--     random draw order. Teams that max him together drew lots — the first in
--     the draw is first to max and holds his right. Cash and the 60-point
--     stake cap apply as on any buy.
--   · CATCH-UP: listings that arrive while the market is locked (Jan 15 to
--     the rookie draft, or before a new league's market opens) wait, and open
--     together in one catch-up window (catchup_h, default 7 days) the moment
--     the market reopens.
--   · The commissioner can switch launches off (new players are buyable at
--     once, as before), change every number, and LAUNCH NOW.
-- ═══════════════════════════════════════════════════════════════════════════

alter table college_player add column if not exists first_seen timestamptz;
update college_player set first_seen = timestamptz '2026-01-01' where first_seen is null;
alter table college_player alter column first_seen set default now();
alter table college_player alter column first_seen set not null;
create index if not exists college_player_first_seen on college_player (first_seen) where active;

create table if not exists devy_launch (
  id         bigserial primary key,
  lineage    text not null,
  kind       text not null check (kind in ('weekly', 'catchup', 'commish')),
  opens_at   timestamptz not null,
  closes_at  timestamptz not null,
  status     text not null default 'open' check (status in ('open', 'filled')),
  filled_at  timestamptz,
  summary    jsonb
);
create index if not exists devy_launch_lineage on devy_launch (lineage, status, closes_at);
create table if not exists devy_launch_player (
  launch_id  bigint not null references devy_launch(id) on delete cascade,
  lineage    text not null,
  slug       text not null,
  open_price numeric(6, 2) not null,
  primary key (launch_id, slug)
);
create index if not exists devy_launch_player_slug on devy_launch_player (lineage, slug);
create table if not exists devy_launch_order (
  launch_id  bigint not null references devy_launch(id) on delete cascade,
  slug       text not null,
  roster_id  int not null,
  shares     int not null check (shares between 1 and 20),
  placed_at  timestamptz not null default now(),
  draw       int,
  filled     int,
  primary key (launch_id, slug, roster_id)
);
create table if not exists devy_launch_lock (
  lineage    text primary key,
  was_locked boolean not null default false
);
alter table devy_launch enable row level security;          -- read through devy_launch_state
alter table devy_launch_player enable row level security;
alter table devy_launch_order enable row level security;    -- sealed
alter table devy_launch_lock enable row level security;

-- ── settings ──
create or replace function _devy_launch_cfg(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('on', true, 'dow', 2, 'hour', 12, 'window_h', 72, 'catchup_h', 168, 'cap', 20)
      || coalesce((select settings_json -> 'devy_launch' from league where id = p_league_id), '{}'::jsonb)
$$;

-- When the lineage's listings start counting: the commissioner's switch-on, else
-- the lineage's first league.
create or replace function _devy_launch_since(p_league_id uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(_devy_launch_cfg(p_league_id) ->> 'since', '')::timestamptz,
                  (select min(created_at) from league where sleeper_league_id = _lineage(p_league_id)))
$$;

-- The weekly slot at or before p_at (dow 0 = Sunday, hour in Eastern time).
create or replace function _devy_launch_slot(p_cfg jsonb, p_at timestamptz) returns timestamptz
  language sql stable as $$
  with l as (select (p_at at time zone 'America/New_York') as t)
  select ((date_trunc('day', t) - make_interval(days => ((extract(dow from t)::int - (p_cfg ->> 'dow')::int + 7) % 7))
           + make_interval(hours => (p_cfg ->> 'hour')::int)) - case when
             (date_trunc('day', t) - make_interval(days => ((extract(dow from t)::int - (p_cfg ->> 'dow')::int + 7) % 7))
              + make_interval(hours => (p_cfg ->> 'hour')::int)) > t then interval '7 days' else interval '0' end)
         at time zone 'America/New_York'
    from l
$$;

-- Players waiting to list in a league's lineage.
create or replace function _devy_pending(p_league_id uuid) returns table (slug text)
  language sql stable security definer set search_path = public as $$
  select 'c-' || cp.espn_id
    from college_player cp
   where cp.active and cp.pos in ('QB', 'RB', 'WR', 'TE')
     and cp.first_seen > _devy_launch_since(p_league_id)
     and not exists (select 1 from devy_launch_player lp where lp.lineage = _lineage(p_league_id) and lp.slug = 'c-' || cp.espn_id)
     and not exists (select 1 from devy_share s where s.lineage = _lineage(p_league_id) and s.slug = 'c-' || cp.espn_id)
     and not exists (select 1 from player_alias a where a.old_slug = 'c-' || cp.espn_id)
$$;

-- 'pending' | 'open' | null — whether a player is still a listing in a lineage.
create or replace function _devy_listing(p_lineage text, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from devy_launch_player lp join devy_launch l on l.id = lp.launch_id
                  where lp.lineage = p_lineage and lp.slug = p_slug and l.status = 'open') then 'open'
    when exists (select 1 from devy_launch_player lp where lp.lineage = p_lineage and lp.slug = p_slug) then null
    when not coalesce((_devy_launch_cfg(_devy_current_league(p_lineage)) ->> 'on')::boolean, true) then null
    when exists (select 1 from college_player cp where cp.espn_id = substr(p_slug, 3) and cp.active
                  and cp.pos in ('QB', 'RB', 'WR', 'TE') and cp.first_seen > _devy_launch_since(_devy_current_league(p_lineage)))
     and not exists (select 1 from devy_share s where s.lineage = p_lineage and s.slug = p_slug) then 'pending'
  end
$$;

-- The opening price: his market price, else StatHead's rank on the curve (and
-- that becomes his market price until the next refresh), else the floor.
create or replace function _devy_open_price(p_slug text) returns numeric
  language plpgsql security definer set search_path = public as $$
declare r int; cls int;
begin
  if exists (select 1 from college_price where espn_id = substr(p_slug, 3)) then return _devy_price(null, p_slug); end if;
  select s.rank_1qb, cp.class_year into r, cls from stathead_devy s join college_player cp using (espn_id)
   where s.espn_id = substr(p_slug, 3);
  if r is null then return 1; end if;
  insert into college_price (espn_id, rank, base, youth, as_of)
  values (substr(p_slug, 3), r, _college_curve(r), case when coalesce(cls, 9) <= 2 and r <= 150 then 1 else 0 end, now())
  on conflict (espn_id) do nothing;
  return _devy_price(null, p_slug);
end $$;

-- Open a launch with every pending listing. Returns its id, or null.
create or replace function _devy_open_launch(p_league_id uuid, p_kind text, p_hours int) returns bigint
  language plpgsql security definer set search_path = public as $$
declare lin text := _lineage(p_league_id); lid bigint; n int; closes timestamptz;
begin
  if not exists (select 1 from _devy_pending(p_league_id)) then return null; end if;
  closes := least(now() + make_interval(hours => p_hours), _devy_lock_after(now()));
  if closes < now() + interval '12 hours' then return null; end if;   -- too close to the Jan 15 lock: catch up after it
  insert into devy_launch (lineage, kind, opens_at, closes_at) values (lin, p_kind, now(), closes) returning id into lid;
  insert into devy_launch_player (launch_id, lineage, slug, open_price)
  select lid, lin, p.slug, _devy_open_price(p.slug) from _devy_pending(p_league_id) p;
  get diagnostics n = row_count;
  perform _chat_house(p_league_id,
    case p_kind when 'catchup' then '🚀 Devy catch-up launch: ' else '🚀 Devy launch: ' end
      || n || ' new college player' || case when n = 1 then '' else 's' end || ' listed. Place sealed orders in DEVY → INVEST until '
      || to_char(closes at time zone 'America/New_York', 'Dy FMHH12:MI am') || ' ET. Everything fills together; teams that max a player draw lots for his right.',
    jsonb_build_object('kind', 'devy_launch', 'launch', lid, 'players', n, 'closes_at', closes));
  return lid;
end $$;

-- Fill a launch: every order at the opening price, in a random draw order, so
-- simultaneous maxers are decided by lot.
create or replace function _devy_fill_launch(p_launch bigint) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare l devy_launch%rowtype; o record; k int := 0; price numeric; cash numeric; s int; spend numeric; mspend numeric;
        res jsonb; lg uuid;
begin
  select * into l from devy_launch where id = p_launch for update;
  if not found or l.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'not an open launch'); end if;
  mspend := (_devy_share_rules() ->> 'max_spend')::numeric;
  perform pg_advisory_xact_lock(hashtext('devy_share:' || l.lineage));
  for o in select ord.*, lp.open_price from devy_launch_order ord join devy_launch_player lp on lp.launch_id = ord.launch_id and lp.slug = ord.slug
            where ord.launch_id = p_launch order by random() loop
    k := k + 1;
    price := o.open_price;
    cash := _devy_cash(l.lineage, o.roster_id);
    s := least(o.shares, (_devy_share_rules() ->> 'max')::int, ceil(mspend / price)::int, floor(cash / price)::int);
    if exists (select 1 from devy_share where lineage = l.lineage and roster_id = o.roster_id and slug = o.slug) or s < 1 then
      update devy_launch_order set draw = k, filled = 0 where launch_id = p_launch and slug = o.slug and roster_id = o.roster_id;
      continue;
    end if;
    spend := round(price * s, 2);
    perform _devy_cash_add(l.lineage, o.roster_id, -spend);
    insert into devy_share (lineage, roster_id, slug, shares, cost, maxed_at, qual_at, created_at, updated_at)
    values (l.lineage, o.roster_id, o.slug, s, spend,
            case when _devy_maxed(s, spend) then clock_timestamp() end,
            case when _devy_qualified(s, spend) then clock_timestamp() end, now(), now());
    update devy_launch_order set draw = k, filled = s where launch_id = p_launch and slug = o.slug and roster_id = o.roster_id;
  end loop;
  -- what happened, for the chat and the market's history line
  select jsonb_build_object('players', (select count(*) from devy_launch_player where launch_id = p_launch),
           'orders', (select count(*) from devy_launch_order where launch_id = p_launch),
           'rights', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'name', cp.full_name, 'roster_id', r.roster_id,
                       'team', coalesce(m.team_name, 'Team ' || r.roster_id), 'via', r.via,
                       'maxed', (select count(*) from devy_share s2 where s2.lineage = l.lineage and s2.slug = r.slug and s2.maxed_at is not null)))
                from devy_share_rights(l.lineage) r
                join devy_launch_player lp on lp.launch_id = p_launch and lp.slug = r.slug
                left join college_player cp on cp.espn_id = substr(r.slug, 3)
                left join league_membership m on m.league_id = _devy_current_league(l.lineage) and m.sleeper_roster_id = r.roster_id), '[]'::jsonb))
    into res;
  update devy_launch set status = 'filled', filled_at = now(), summary = res where id = p_launch;
  lg := _devy_current_league(l.lineage);
  perform _chat_house(lg,
    '🚀 Devy launch filled: ' || (res ->> 'orders') || ' order' || case when (res ->> 'orders')::int = 1 then '' else 's' end
      || ' on ' || (res ->> 'players') || ' player' || case when (res ->> 'players')::int = 1 then '' else 's' end || '.'
      || coalesce(' Rights: ' || (select string_agg(x ->> 'name' || ' → ' || (x ->> 'team')
            || case when (x ->> 'maxed')::int > 1 then ' (won the draw of ' || (x ->> 'maxed') || ')' else '' end, '; ')
           from (select x from jsonb_array_elements(res -> 'rights') x limit 8) t) || '.', ''),
    jsonb_build_object('kind', 'devy_launch_filled', 'launch', p_launch));
  return jsonb_build_object('ok', true) || res;
end $$;

-- ── the clock (the worker calls this every few minutes) ──
create or replace function devy_launch_tick() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lg record; cfg jsonb; lin text; filled int := 0; opened int := 0; lid bigint; slot timestamptz;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 1. close what's due, whatever else is true
  for lid in select id from devy_launch where status = 'open' and closes_at <= now() loop
    perform _devy_fill_launch(lid); filled := filled + 1;
  end loop;
  -- 2. open what's due, league by league (current season rows of shares leagues)
  for lg in select id from league where provider = 'native'
              and coalesce(settings_json ->> 'devy_mode', 'spots') = 'shares' loop
    if not _devy_is_current(lg.id) then continue; end if;
    cfg := _devy_launch_cfg(lg.id); lin := _lineage(lg.id);
    if not coalesce((cfg ->> 'on')::boolean, true) then continue; end if;
    if _devy_shares_locked(lg.id) then
      insert into devy_launch_lock (lineage, was_locked) values (lin, true)
      on conflict (lineage) do update set was_locked = true;
      continue;
    end if;
    if exists (select 1 from devy_launch where lineage = lin and status = 'open') then continue; end if;
    if coalesce((select was_locked from devy_launch_lock where lineage = lin), false) then
      -- the market just reopened: everything that arrived meanwhile, together
      lid := _devy_open_launch(lg.id, 'catchup', (cfg ->> 'catchup_h')::int);
      update devy_launch_lock set was_locked = false where lineage = lin;
      if lid is not null then opened := opened + 1; end if;
      continue;
    end if;
    slot := _devy_launch_slot(cfg, now());
    if exists (select 1 from devy_launch where lineage = lin and opens_at >= slot) then continue; end if;
    lid := _devy_open_launch(lg.id, 'weekly', (cfg ->> 'window_h')::int);
    if lid is not null then opened := opened + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'filled', filled, 'opened', opened);
end $$;
revoke all on function devy_launch_tick() from public, anon;
grant execute on function devy_launch_tick() to authenticated;

-- ── the commissioner ──
create or replace function set_league_devy_launch(p_league_id uuid, p_cfg jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare cur jsonb; nxt jsonb; k text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then return jsonb_build_object('ok', false, 'error', 'settings'); end if;
  for k in select jsonb_object_keys(p_cfg) loop
    if k not in ('on', 'dow', 'hour', 'window_h', 'catchup_h', 'cap') then
      return jsonb_build_object('ok', false, 'error', 'unknown setting ' || k);
    end if;
  end loop;
  cur := _devy_launch_cfg(p_league_id);
  nxt := cur || p_cfg;
  if (nxt ->> 'dow')::int not between 0 and 6 or (nxt ->> 'hour')::int not between 0 and 23 then
    return jsonb_build_object('ok', false, 'error', 'a day 0–6 (Sunday–Saturday) and an hour 0–23 ET');
  end if;
  if (nxt ->> 'window_h')::int not between 12 and 336 then return jsonb_build_object('ok', false, 'error', 'the window is 12 hours to 14 days'); end if;
  if (nxt ->> 'catchup_h')::int not between 24 and 720 then return jsonb_build_object('ok', false, 'error', 'the catch-up window is 1 to 30 days'); end if;
  if (nxt ->> 'cap')::int not between 1 and 20 then return jsonb_build_object('ok', false, 'error', 'an order is 1 to 20 shares'); end if;
  -- Switching launches back ON starts counting new players from now: while it
  -- was off, new players were buyable at once.
  if (nxt ->> 'on')::boolean and not coalesce((cur ->> 'on')::boolean, true) then
    nxt := nxt || jsonb_build_object('since', now());
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('devy_launch', nxt)
   where id = p_league_id;
  return jsonb_build_object('ok', true, 'cfg', _devy_launch_cfg(p_league_id));
end $$;
grant execute on function set_league_devy_launch(uuid, jsonb) to authenticated;

create or replace function commish_devy_launch_now(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lid bigint;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not _devy_shares_on(p_league_id) or not _devy_is_current(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'this league''s devy market isn''t running');
  end if;
  if _devy_shares_locked(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'the market is locked — listings open in a catch-up when it reopens');
  end if;
  if exists (select 1 from devy_launch where lineage = _lineage(p_league_id) and status = 'open') then
    return jsonb_build_object('ok', false, 'error', 'a launch is already open');
  end if;
  lid := _devy_open_launch(p_league_id, 'commish', (_devy_launch_cfg(p_league_id) ->> 'window_h')::int);
  if lid is null then return jsonb_build_object('ok', false, 'error', 'no new players waiting to list'); end if;
  return jsonb_build_object('ok', true, 'launch', lid);
end $$;
grant execute on function commish_devy_launch_now(uuid) to authenticated;

-- ── a team's sealed order ──
create or replace function place_devy_launch_order(p_league_id uuid, p_roster_id int, p_slug text, p_shares int) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare lin text := _lineage(p_league_id); lid bigint; price numeric; cap int; n int := coalesce(p_shares, 0);
        mx int; cash numeric; committed numeric;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your team');
  end if;
  if not _devy_shares_on(p_league_id) or not _devy_is_current(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'this league''s devy market isn''t running');
  end if;
  select l.id, lp.open_price into lid, price from devy_launch l join devy_launch_player lp on lp.launch_id = l.id
   where l.lineage = lin and l.status = 'open' and lp.slug = p_slug and l.closes_at > now();
  if lid is null then return jsonb_build_object('ok', false, 'error', 'he isn''t in an open launch'); end if;
  cap := (_devy_launch_cfg(p_league_id) ->> 'cap')::int;
  mx := least(cap, (_devy_share_rules() ->> 'max')::int, ceil((_devy_share_rules() ->> 'max_spend')::numeric / price)::int);
  if n < 0 or n > mx then
    return jsonb_build_object('ok', false, 'error', 'an order on him is 0 to ' || mx || ' shares');
  end if;
  if n = 0 then
    delete from devy_launch_order where launch_id = lid and slug = p_slug and roster_id = p_roster_id;
    return jsonb_build_object('ok', true, 'shares', 0);
  end if;
  cash := _devy_cash(lin, p_roster_id);
  select coalesce(sum(o.shares * lp.open_price), 0) into committed
    from devy_launch_order o join devy_launch_player lp on lp.launch_id = o.launch_id and lp.slug = o.slug
   where o.launch_id = lid and o.roster_id = p_roster_id and o.slug <> p_slug;
  if committed + n * price > cash + 0.001 then
    return jsonb_build_object('ok', false, 'error', 'your orders would come to ' || trim(to_char(committed + n * price, 'FM999990.00'))
      || ' — you have ' || trim(to_char(cash, 'FM999990.00')));
  end if;
  insert into devy_launch_order (launch_id, slug, roster_id, shares, placed_at) values (lid, p_slug, p_roster_id, n, now())
  on conflict (launch_id, slug, roster_id) do update set shares = excluded.shares, placed_at = now();
  return jsonb_build_object('ok', true, 'shares', n, 'price', price, 'committed', committed + n * price);
end $$;
grant execute on function place_devy_launch_order(uuid, int, text, int) to authenticated;

-- ── what the market screen reads ──
create or replace function devy_launch_state(p_league_id uuid, p_roster_id int default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare lin text := _lineage(p_league_id); cfg jsonb := _devy_launch_cfg(p_league_id); op devy_launch%rowtype;
        mine boolean := p_roster_id is not null and (owns_roster(p_league_id, p_roster_id) or is_admin());
        nxt timestamptz; locked boolean := _devy_shares_locked(p_league_id);
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into op from devy_launch where lineage = lin and status = 'open' order by id desc limit 1;
  nxt := _devy_launch_slot(cfg, now()) + interval '7 days';
  return jsonb_build_object('ok', true, 'cfg', cfg, 'can_edit', is_admin() or is_league_commish(p_league_id),
    'locked', locked,
    'catchup_next', locked or coalesce((select was_locked from devy_launch_lock where lineage = lin), false),
    'next_at', case when coalesce((cfg ->> 'on')::boolean, true) and not locked then nxt end,
    'open', case when op.id is null then null else jsonb_build_object(
      'id', op.id, 'kind', op.kind, 'opens_at', op.opens_at, 'closes_at', op.closes_at,
      'players', coalesce((select jsonb_agg(jsonb_build_object('slug', lp.slug, 'name', cp.full_name, 'pos', cp.pos,
          'school', cp.school_abbr, 'class_year', cp.class_year, 'fcs', cp.division = 'FCS', 'sh_rank', s.rank_1qb,
          'price', lp.open_price,
          'my_order', case when mine then (select o.shares from devy_launch_order o where o.launch_id = op.id and o.slug = lp.slug and o.roster_id = p_roster_id) end)
          order by s.rank_1qb nulls last, cp.full_name)
        from devy_launch_player lp join college_player cp on cp.espn_id = substr(lp.slug, 3)
        left join stathead_devy s on s.espn_id = cp.espn_id where lp.launch_id = op.id), '[]'::jsonb)) end,
    'pending', coalesce((select jsonb_agg(x order by (x ->> 'sh_rank')::int nulls last, x ->> 'name') from (
        select jsonb_build_object('slug', p.slug, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr,
          'class_year', cp.class_year, 'fcs', cp.division = 'FCS', 'sh_rank', s.rank_1qb) x
          from _devy_pending(p_league_id) p join college_player cp on cp.espn_id = substr(p.slug, 3)
          left join stathead_devy s on s.espn_id = cp.espn_id
         order by s.rank_1qb nulls last limit 400) t), '[]'::jsonb),
    'pending_count', (select count(*) from _devy_pending(p_league_id)),
    'last', (select jsonb_build_object('id', l.id, 'kind', l.kind, 'filled_at', l.filled_at, 'summary', l.summary)
               from devy_launch l where l.lineage = lin and l.status = 'filled' order by l.filled_at desc limit 1));
end $$;
grant execute on function devy_launch_state(uuid, int) to authenticated;

-- ── buying a listing is an order, not a buy (0396's body + the check) ──
create or replace function allot_devy_shares(p_league_id uuid, p_roster_id int, p_slug text, p_shares int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lin text; cur int := 0; cur_cost numeric := 0; rules jsonb := _devy_share_rules(); n int := coalesce(p_shares, 0);
        price numeric; cash numeric; delta int; spend numeric; got numeric; part numeric; active boolean;
        new_cost numeric; mspend numeric := (rules ->> 'max_spend')::numeric;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your team');
  end if;
  if not _devy_shares_on(p_league_id) then return jsonb_build_object('ok', false, 'error', 'this league doesn''t play devy shares'); end if;
  if not _devy_is_current(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'that''s last season''s league — shares move in the current season');
  end if;
  if _devy_shares_locked(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'shares are locked from January 15 until the rookie draft is done');
  end if;
  if n < 0 or n > (rules ->> 'max')::int then
    return jsonb_build_object('ok', false, 'error', 'a stake is 0 to ' || (rules ->> 'max') || ' shares');
  end if;
  if p_slug !~ '^c-[0-9]+$' or not exists (select 1 from college_player cp where cp.espn_id = substr(p_slug, 3)) then
    return jsonb_build_object('ok', false, 'error', 'shares go on college players');
  end if;
  select cp.active into active from college_player cp where cp.espn_id = substr(p_slug, 3);
  lin := _lineage(p_league_id);
  perform pg_advisory_xact_lock(hashtext('devy_share:' || lin));
  select shares, cost into cur, cur_cost from devy_share where lineage = lin and roster_id = p_roster_id and slug = p_slug;
  cur := coalesce(cur, 0); cur_cost := coalesce(cur_cost, 0);
  delta := n - cur;
  if delta = 0 then return jsonb_build_object('ok', true, 'shares', n, 'cash', _devy_cash(lin, p_roster_id)); end if;
  -- 0407: a new player lists before he trades — he is bought in his launch window.
  if delta > 0 and _devy_listing(lin, p_slug) is not null then
    return jsonb_build_object('ok', false, 'error', case _devy_listing(lin, p_slug)
      when 'open' then 'he''s in this week''s launch — place an order in NEW LISTINGS'
      else 'he''s a new listing — he opens in the next launch window' end);
  end if;
  price := _devy_price(lin, p_slug);
  cash := _devy_cash(lin, p_roster_id);

  if delta > 0 then
    if not active then return jsonb_build_object('ok', false, 'error', 'he''s left college — you can sell, not buy'); end if;
    if exists (select 1 from player_alias a where a.old_slug = p_slug) then
      return jsonb_build_object('ok', false, 'error', 'he''s turned pro — his rights are settled at the draft');
    end if;
    if _devy_maxed(cur, cur_cost) then
      return jsonb_build_object('ok', false, 'error', 'your stake is maxed (20 shares or ' || mspend || ' points spent)');
    end if;
    -- 20 shares or 60 spent, whichever first: every share but the last must start under 60.
    if cur_cost + price * (delta - 1) >= mspend then
      return jsonb_build_object('ok', false, 'error',
        'that passes the ' || mspend || '-point stake cap — ' || ceil((mspend - cur_cost) / price)::int || ' more share(s) maxes him');
    end if;
    spend := round(price * delta, 2);
    if spend > cash then
      return jsonb_build_object('ok', false, 'error',
        delta || ' share' || case when delta = 1 then '' else 's' end || ' at ' || trim(to_char(price, 'FM990.##')) || ' is '
        || trim(to_char(spend, 'FM999990.##')) || ' — you have ' || trim(to_char(cash, 'FM999990.##')) || ' to spend');
    end if;
    perform _devy_cash_add(lin, p_roster_id, -spend);
    new_cost := cur_cost + spend;
    insert into devy_share (lineage, roster_id, slug, shares, cost, maxed_at, qual_at, created_at, updated_at)
    values (lin, p_roster_id, p_slug, n, spend,
            case when _devy_maxed(n, new_cost) then clock_timestamp() end,
            case when _devy_qualified(n, new_cost) then clock_timestamp() end, now(), now())
    on conflict (lineage, roster_id, slug) do update set
      shares = excluded.shares, cost = devy_share.cost + spend,
      maxed_at = case when _devy_maxed(excluded.shares, devy_share.cost + spend) then coalesce(devy_share.maxed_at, clock_timestamp()) end,
      qual_at = coalesce(devy_share.qual_at, case when _devy_qualified(excluded.shares, devy_share.cost + spend) then clock_timestamp() end),
      updated_at = now();
  else
    got := _devy_proceeds(price, -delta, cur, cur_cost);
    if cash + got > (rules ->> 'cash_cap')::numeric then
      return jsonb_build_object('ok', false, 'error',
        'cash tops out at ' || (rules ->> 'cash_cap') || ' — that sale would pay ' || trim(to_char(got, 'FM999990.##'))
        || ' on top of your ' || trim(to_char(cash, 'FM999990.##')) || '; sell fewer shares');
    end if;
    part := round(cur_cost * (-delta) / cur, 2);
    perform _devy_cash_add(lin, p_roster_id, got);
    if n = 0 then
      delete from devy_share where lineage = lin and roster_id = p_roster_id and slug = p_slug;
    else
      update devy_share set shares = n, cost = greatest(0, cost - part),
             maxed_at = case when _devy_maxed(n, greatest(0, cost - part)) then maxed_at end,
             qual_at = case when _devy_qualified(n, greatest(0, cost - part)) then qual_at end,
             updated_at = now()
       where lineage = lin and roster_id = p_roster_id and slug = p_slug;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'shares', n, 'price', price, 'cash', _devy_cash(lin, p_roster_id),
    'spent', spend, 'received', got,
    'right', (select to_jsonb(r) from devy_share_rights(lin) r where r.slug = p_slug));
end $$;
grant execute on function allot_devy_shares(uuid, int, text, int) to authenticated;
