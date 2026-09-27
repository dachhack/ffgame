-- ═══════════════════════════════════════════════════════════════════════════
-- 0388 · THE DEVY MARKET — SHARES WITH A PRICE.
--
-- Founder: "Would be cool if you put shares on a college player early, they
-- appreciated in value if the player gets good. So identifying players early
-- or before others do is rewarded in some way." … "Let's try it and I'll
-- play test and perfect."
--
-- ── THE PRICE (per share, in points) ───────────────────────────────────────
-- college_price: every ranked college player's base and youth, from the
-- draft's own ranking (college_directory: value over replacement, 0381),
-- refreshed by the worker after each stats sweep (weekly in season):
--   rank 1–25 → 5 · 26–75 → 4 · 76–150 → 3 · 151–300 → 2 · else 1;
--   +1 for a freshman or sophomore in the top 150 (more years to rise).
-- An unranked player (no stats yet) is 1. A player who leaves college keeps
-- his last price (the row isn't touched), so his payout is his final price.
-- DEMAND, per league: +1 once the league holds 40+ shares on him, +2 at 80+.
--
-- ── CASH ───────────────────────────────────────────────────────────────────
-- devy_cash(lineage, roster_id, cash): every team starts with 100 points.
-- Buying shares costs today's price × shares; the stake remembers what it
-- cost (devy_share.cost). Selling pays today's price, at most 3× the cost of
-- the shares sold, and a team never holds more than 200 in cash.
-- At the draft's end a graduate's stake pays out the same way (final price,
-- 3× cap, 200 ceiling) — the reward for having found him early.
-- The 20-share cap per player and the rights (first to 20; else the only
-- team in with 5+) are unchanged: money buys shares, shares decide rights.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists college_price (
  espn_id text primary key,
  rank    int  not null,
  base    int  not null check (base between 1 and 5),
  youth   int  not null default 0 check (youth between 0 and 1),
  as_of   timestamptz not null default now()
);
alter table college_price enable row level security;
drop policy if exists college_price_read on college_price;
create policy college_price_read on college_price for select using (auth.uid() is not null);

create table if not exists devy_cash (
  lineage   text not null,
  roster_id int  not null,
  cash      numeric(8, 2) not null,
  primary key (lineage, roster_id)
);
alter table devy_cash enable row level security;   -- read through devy_shares_state

alter table devy_share add column if not exists cost numeric(8, 2) not null default 0;
-- 0387 stakes, bought before there was a price: at 1 a share.
update devy_share set cost = shares where cost = 0;

create or replace function _devy_share_rules() returns jsonb
  language sql immutable as $$
  select '{"budget": 100, "max": 20, "floor": 5, "cash_cap": 200, "payout_cap": 3}'::jsonb
$$;

-- ── Prices ──
create or replace function _college_base_price(p_rank int) returns int
  language sql immutable as $$
  select case when p_rank is null then 1 when p_rank <= 25 then 5 when p_rank <= 75 then 4
              when p_rank <= 150 then 3 when p_rank <= 300 then 2 else 1 end
$$;

create or replace function refresh_college_prices() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int; gone int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  with d as (
    select (e ->> 'espn_id') as espn_id, (e ->> 'ord')::int as rank, nullif(e ->> 'class_year', '')::int as cls,
           (e ->> 'ppg') is not null as has_stats
      from jsonb_array_elements(college_directory(array['QB','RB','WR','TE'], 2000)) e
  )
  insert into college_price (espn_id, rank, base, youth, as_of)
  select espn_id, rank, _college_base_price(rank),
         case when coalesce(cls, 9) <= 2 and rank <= 150 then 1 else 0 end, now()
    from d where has_stats
  on conflict (espn_id) do update set rank = excluded.rank, base = excluded.base, youth = excluded.youth, as_of = excluded.as_of;
  get diagnostics n = row_count;
  -- An ACTIVE player who dropped out of the ranking is back at 1 (no row);
  -- one who left college keeps his last price, frozen, for his payout.
  delete from college_price p
   where p.as_of < now() - interval '1 minute'
     and exists (select 1 from college_player cp where cp.espn_id = p.espn_id and cp.active);
  get diagnostics gone = row_count;
  return jsonb_build_object('ok', true, 'priced', n, 'unranked', gone);
end $$;
revoke all on function refresh_college_prices() from public, anon;
grant execute on function refresh_college_prices() to authenticated, service_role;

-- A player's price today in one league: base + youth + that league's demand.
create or replace function _devy_price(p_lineage text, p_slug text) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce((select p.base + p.youth from college_price p where p.espn_id = substr(p_slug, 3)), 1)
       + (select case when coalesce(sum(s.shares), 0) >= 80 then 2 when coalesce(sum(s.shares), 0) >= 40 then 1 else 0 end
            from devy_share s where s.lineage = p_lineage and s.slug = p_slug)
$$;

create or replace function _devy_cash(p_lineage text, p_roster int) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce((select cash from devy_cash where lineage = p_lineage and roster_id = p_roster),
                  (_devy_share_rules() ->> 'budget')::numeric)
$$;
create or replace function _devy_cash_set(p_lineage text, p_roster int, p_cash numeric) returns void
  language sql security definer set search_path = public as $$
  insert into devy_cash (lineage, roster_id, cash) values (p_lineage, p_roster, p_cash)
  on conflict (lineage, roster_id) do update set cash = excluded.cash
$$;

-- What selling `p_sold` of a stake pays: today's price, at most 3× their cost.
create or replace function _devy_proceeds(p_price int, p_sold int, p_shares int, p_cost numeric) returns numeric
  language sql immutable as $$
  select round(least(p_price * p_sold::numeric,
                     (_devy_share_rules() ->> 'payout_cap')::numeric * p_cost * p_sold / nullif(p_shares, 0)), 2)
$$;

-- ── Buying and selling (0387's allot, now priced) ──
create or replace function allot_devy_shares(p_league_id uuid, p_roster_id int, p_slug text, p_shares int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lin text; cur int := 0; cur_cost numeric := 0; rules jsonb := _devy_share_rules(); n int := coalesce(p_shares, 0);
        price int; cash numeric; delta int; spend numeric; got numeric; part numeric;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your team');
  end if;
  if not _devy_shares_on(p_league_id) then return jsonb_build_object('ok', false, 'error', 'this league doesn''t play devy shares'); end if;
  if _devy_shares_locked(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'shares are locked from January 15 until the rookie draft is done');
  end if;
  if n < 0 or n > (rules ->> 'max')::int then
    return jsonb_build_object('ok', false, 'error', 'a stake is 0 to ' || (rules ->> 'max') || ' shares');
  end if;
  if p_slug !~ '^c-[0-9]+$' or not exists (select 1 from college_player cp where cp.espn_id = substr(p_slug, 3) and cp.active) then
    return jsonb_build_object('ok', false, 'error', 'shares go on active college players');
  end if;
  lin := _lineage(p_league_id);
  perform pg_advisory_xact_lock(hashtext('devy_share:' || lin));
  select shares, cost into cur, cur_cost from devy_share where lineage = lin and roster_id = p_roster_id and slug = p_slug;
  cur := coalesce(cur, 0); cur_cost := coalesce(cur_cost, 0);
  delta := n - cur;
  if delta > 0 and exists (select 1 from player_alias a where a.old_slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'he''s turned pro — his rights are settled at the draft');
  end if;
  if delta = 0 then return jsonb_build_object('ok', true, 'shares', n, 'cash', _devy_cash(lin, p_roster_id)); end if;
  price := _devy_price(lin, p_slug);
  cash := _devy_cash(lin, p_roster_id);

  if delta > 0 then
    spend := price * delta;
    if spend > cash then
      return jsonb_build_object('ok', false, 'error',
        delta || ' share' || case when delta = 1 then '' else 's' end || ' at ' || price || ' is ' || spend
        || ' — you have ' || trim(to_char(cash, 'FM999990.##')) || ' to spend');
    end if;
    perform _devy_cash_set(lin, p_roster_id, cash - spend);
    insert into devy_share (lineage, roster_id, slug, shares, cost, maxed_at, updated_at)
    values (lin, p_roster_id, p_slug, n, spend, case when n >= (rules ->> 'max')::int then clock_timestamp() end, now())
    on conflict (lineage, roster_id, slug) do update set
      shares = excluded.shares, cost = devy_share.cost + spend,
      maxed_at = case when excluded.shares >= (rules ->> 'max')::int then coalesce(devy_share.maxed_at, clock_timestamp()) end,
      updated_at = now();
  else
    got := _devy_proceeds(price, -delta, cur, cur_cost);
    part := round(cur_cost * (-delta) / cur, 2);
    perform _devy_cash_set(lin, p_roster_id, least((rules ->> 'cash_cap')::numeric, cash + got));
    if n = 0 then
      delete from devy_share where lineage = lin and roster_id = p_roster_id and slug = p_slug;
    else
      update devy_share set shares = n, cost = greatest(0, cost - part), maxed_at = null, updated_at = now()
       where lineage = lin and roster_id = p_roster_id and slug = p_slug;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'shares', n, 'price', price, 'cash', _devy_cash(lin, p_roster_id),
    'spent', spend, 'received', got,
    'right', (select to_jsonb(r) from devy_share_rights(lin) r where r.slug = p_slug));
end $$;
grant execute on function allot_devy_shares(uuid, int, text, int) to authenticated;

-- ── The market: prices for the ADD list ──
create or replace function devy_market(p_league_id uuid, p_limit int default 1000)
  returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'slug', 'c-' || p.espn_id, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr,
        'class_year', cp.class_year, 'rank', p.rank, 'youth', p.youth = 1,
        'price', _devy_price(_lineage(p_league_id), 'c-' || p.espn_id)) order by p.rank)
      from (select * from college_price order by rank limit least(greatest(coalesce(p_limit, 1000), 1), 2000)) p
      join college_player cp on cp.espn_id = p.espn_id and cp.active), '[]'::jsonb)
  end
$$;
grant execute on function devy_market(uuid, int) to authenticated;

-- ── The read: 0387's, plus cash, prices, cost and value ──
create or replace function devy_shares_state(p_league_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  with lin as (select _lineage(p_league_id) as l),
  rights as (select * from devy_share_rights((select l from lin))),
  held as (
    select s.slug, jsonb_agg(jsonb_build_object('roster_id', s.roster_id, 'shares', s.shares, 'maxed_at', s.maxed_at,
             'cost', s.cost, 'value', _devy_proceeds(_devy_price(s.lineage, s.slug), s.shares, s.shares, s.cost),
             'team', coalesce(m.team_name, 'Team ' || s.roster_id)) order by s.shares desc, s.maxed_at nulls last, s.roster_id) as holders
      from devy_share s
      left join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = s.roster_id
     where s.lineage = (select l from lin)
     group by s.slug),
  teams as (
    select m.sleeper_roster_id as roster_id,
           _devy_cash((select l from lin), m.sleeper_roster_id) as cash,
           coalesce((select sum(s.shares) from devy_share s where s.lineage = (select l from lin) and s.roster_id = m.sleeper_roster_id), 0) as shares,
           coalesce((select sum(_devy_proceeds(_devy_price(s.lineage, s.slug), s.shares, s.shares, s.cost))
                       from devy_share s where s.lineage = (select l from lin) and s.roster_id = m.sleeper_roster_id), 0) as value
      from league_membership m where m.league_id = p_league_id)
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then jsonb_build_object('ok', false, 'error', 'forbidden')
    else jsonb_build_object('ok', true,
      'on', _devy_shares_on(p_league_id),
      'locked', _devy_shares_locked(p_league_id),
      'lock_at', devy_shares_lock_at(),
      'rules', _devy_share_rules(),
      'used', coalesce((select jsonb_object_agg(t.roster_id::text, t.shares) from teams t), '{}'::jsonb),
      'cash', coalesce((select jsonb_object_agg(t.roster_id::text, t.cash) from teams t), '{}'::jsonb),
      'value', coalesce((select jsonb_object_agg(t.roster_id::text, t.value) from teams t), '{}'::jsonb),
      'prices_as_of', (select max(as_of) from college_price),
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'slug', h.slug, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr, 'class_year', cp.class_year,
          'graduated_to', (select a.new_slug from player_alias a where a.old_slug = h.slug),
          'price', _devy_price((select l from lin), h.slug),
          'rank', (select p.rank from college_price p where p.espn_id = substr(h.slug, 3)),
          'holders', h.holders,
          'right', (select jsonb_build_object('roster_id', r.roster_id, 'via', r.via) from rights r where r.slug = h.slug))
          order by cp.full_name)
        from held h left join college_player cp on cp.espn_id = substr(h.slug, 3)), '[]'::jsonb),
      'reserved', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'roster_id', r.roster_id, 'college_slug', r.college_slug))
        from devy_reserved(p_league_id) r), '[]'::jsonb))
  end
$$;

-- ── Clearing (0387's), now a payout at the final price ──
create or replace function _devy_shares_clear_on_draft() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lin text; s record; k int := 0; paid numeric := 0; got numeric; cap numeric := (_devy_share_rules() ->> 'cash_cap')::numeric;
begin
  if new.status = 'complete' and old.status is distinct from 'complete' and _devy_shares_on(new.league_id) then
    lin := _lineage(new.league_id);
    for s in select * from devy_share d
              where d.lineage = lin and exists (select 1 from player_alias a where a.old_slug = d.slug)
              order by d.slug, d.roster_id loop
      got := _devy_proceeds(_devy_price(lin, s.slug), s.shares, s.shares, s.cost);
      perform _devy_cash_set(lin, s.roster_id, least(cap, _devy_cash(lin, s.roster_id) + got));
      paid := paid + got;
    end loop;
    select count(distinct d.slug) into k from devy_share d
     where d.lineage = lin and exists (select 1 from player_alias a where a.old_slug = d.slug);
    delete from devy_share d where d.lineage = lin and exists (select 1 from player_alias a where a.old_slug = d.slug);
    if k > 0 then
      perform _chat_house(new.league_id,
        'The draft is done: stakes in ' || k || ' player' || case when k = 1 then '' else 's' end
          || ' who turned pro paid out ' || trim(to_char(paid, 'FM999990.##')) || ' points at their final prices.',
        jsonb_build_object('kind', 'devy_shares_cleared', 'players', k, 'paid', paid));
    end if;
  end if;
  return new;
end $$;

-- The setting's chat line, in points now.
create or replace function set_league_devy_mode(p_league_id uuid, p_mode text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; gone int := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('spots', 'shares') then
    return jsonb_build_object('ok', false, 'error', 'devy mode is spots or shares');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if p_mode = 'shares' then
    if not _league_has_college(lg.settings_json) then
      return jsonb_build_object('ok', false, 'error', 'devy shares need college players on in this league');
    end if;
    if league_is_college_calendar(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'devy shares are for leagues on the NFL schedule');
    end if;
    if _devy_slots(p_league_id) > 0 then
      return jsonb_build_object('ok', false, 'error', 'set the devy roster spots to 0 first — shares replace them');
    end if;
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug ~ '^c-[0-9]+$') then
      return jsonb_build_object('ok', false, 'error', 'drop the college players on rosters first — in a shares league nobody rosters them');
    end if;
    delete from league_pool lp where lp.league_id = p_league_id and lp.slug ~ '^c-[0-9]+$';
    get diagnostics gone = row_count;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('devy_mode', p_mode)
   where id = p_league_id;
  if coalesce(lg.settings_json ->> 'devy_mode', 'spots') <> p_mode then
    perform _chat_house(p_league_id,
      case when p_mode = 'shares'
        then 'Devy is now a market: every team has 100 points to buy shares in college players, priced by how they''re playing. Hit 20 shares first, or be the only one in with 5+, and he''s yours to draft when he turns pro — and your shares pay out at his final price.'
        else 'Devy is back to roster spots. Shares already placed stay put but no longer reserve anyone.' end,
      jsonb_build_object('kind', 'devy_mode', 'mode', p_mode));
  end if;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'college_removed_from_pool', gone);
end $$;

-- Devy SPOTS don't belong in a shares league (0387's loose end): the shape
-- refuses them there. A wrapper, so 0376's body stays where it is.
create or replace function _devy_spots_in_shares_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.settings_json ->> 'devy_mode', 'spots') = 'shares'
     and coalesce((new.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0
     and coalesce((old.settings_json -> 'roster_shape' ->> 'devy')::int, 0) = 0 then
    raise exception 'this league plays devy shares — switch devy back to spots before adding devy roster spots';
  end if;
  return new;
end $$;
drop trigger if exists devy_spots_in_shares_guard on league;
create trigger devy_spots_in_shares_guard before update of settings_json on league
  for each row execute function _devy_spots_in_shares_guard();

-- First prices now, rather than a week from now.
select refresh_college_prices();
