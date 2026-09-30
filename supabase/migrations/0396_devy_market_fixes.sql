-- ═══════════════════════════════════════════════════════════════════════════
-- 0396 · THE DEVY MARKET, AFTER THE SIMULATION.
--
-- Founder: "fix the bugs and go with your recommendations for 1-5. For 6,
-- new team would fresh 100 but make it adjustable for the commish. Taken over
-- team, just gets what the taken over team already has. 7 your
-- recommendation. Yes, cap players."
--
-- A 60-league replay of the 2023 college season and the 2024 NFL draft
-- (scratchpad devy-sim/) found the market paid tricks, not scouting, and
-- several holes. What changes:
--
-- BUGS
--  1. Graduation reached only players in some league's POOL, and a shares
--     pool holds no college players — so a shares league never paid out or
--     reserved anyone. graduation_candidates now includes every player held
--     in shares, and graduate_college_player writes the alias for them even
--     when no pool holds him. It also records his NFL draft ROUND.
--  2. The money pump (buy past a demand line, sell back at the bumped price):
--     the demand bonus is gone (founder decision 2).
--  3. Last season's league row still took share moves from whoever held that
--     seat then: allot, mode changes and settings now act only through the
--     lineage's CURRENT season.
--  4. The commissioner could flip modes mid-draft (steal a reservation, skip
--     the payout): no mode change from the Jan 15 lock until the draft is
--     done, leaving shares pays every stake out, and the draft's payout runs
--     whenever the lineage holds stakes, whatever the mode.
--  5. Stakes on a player who leaves college were frozen for good: they can be
--     sold at his last price, and at the draft's end a player who left
--     undrafted refunds HALF of what his stake cost (decision 1).
--  6. One share erased a rival's sole right: only a QUALIFIED stake (5+
--     shares and 15+ points spent, decision 5) holds or breaks a sole right,
--     and a stake that first qualified in the 7 days before the lock doesn't
--     break an older qualifier's.
--  7. Reservations could freeze or stall a draft: a holder with no picks left,
--     or who can't roster him under the position caps, releases him.
--  8. A payout could overwrite a same-moment purchase: the payout takes the
--     market's lock and adds to cash in one statement.
--  9. Payouts above 200 were thrown away: payouts aren't capped (decision 4);
--     a SELL that would pass 200 is refused rather than silently shaved.
-- 11. Auction drafts can't honour a reservation: shares mode is refused in
--     an auction league (decision 7).
-- 12. A reserved graduate could be picked up off waivers: refused.
-- 13. The lock missed leagues whose season label didn't match: it now ends
--     when a draft in the lineage COMPLETES after Jan 15.
-- 14. A partial roster sweep retired most of college: a sweep that would
--     retire more than 10% of active players retires nobody.
--
-- ECONOMICS (the package that tested best, all together)
--  · Price = a smooth curve of rank: 10 − 2·log2(rank/10), between 1 and 10,
--    ×1.15 for a FR/SO in the top 150; unranked 1. No demand bonus.
--  · Prices freeze from Jan 15 until the season's first stats (Aug 25).
--  · A stake maxes at 20 shares OR 60 points spent, whichever comes first;
--    the first team to max holds the right (decision 8).
--  · Payout at the draft = the better of his college price and his NFL round
--    (R1 8, R2 6, R3 5, R4–7 3) a share, up to 3× what the stake cost
--    (decision 3). Undrafted but signed: his college price.
--  · A new team starts with the league's starting cash — 100 unless the
--    commissioner sets it (decision 6); a taken-over seat keeps its book.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── schema ──
alter table player_alias add column if not exists draft_round int;
alter table devy_share add column if not exists created_at timestamptz not null default now();
alter table devy_share add column if not exists qual_at timestamptz;
update devy_share set qual_at = coalesce(qual_at, updated_at) where shares >= 5 and cost >= 15;
alter table college_price drop constraint if exists college_price_base_check;
alter table college_price alter column base type numeric(6, 2);

create or replace function _devy_share_rules() returns jsonb
  language sql immutable as $$
  select '{"budget": 100, "max": 20, "max_spend": 60, "floor": 5, "min_spend": 15, "cash_cap": 200,
           "payout_cap": 3, "refund": 0.5, "quiet_days": 7,
           "round_price": {"1": 8, "2": 6, "3": 5, "4": 3, "5": 3, "6": 3, "7": 3}}'::jsonb
$$;

-- ── prices ──
create or replace function _college_curve(p_rank int) returns numeric
  language sql immutable as $$
  select case when p_rank is null or p_rank < 1 then 1
              else round(greatest(1, least(10, 10 - 2 * log(2, p_rank / 10.0))), 2) end
$$;

-- The offseason freeze: Jan 15 to Aug 25, Eastern.
create or replace function _college_prices_frozen(p_now timestamptz default now()) returns boolean
  language sql stable as $$
  select to_char(p_now at time zone 'America/New_York', 'MMDD') between '0115' and '0824'
$$;

create or replace function refresh_college_prices() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int; gone int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if _college_prices_frozen() then
    return jsonb_build_object('ok', true, 'frozen', true, 'priced', 0);
  end if;
  with d as (
    select (e ->> 'espn_id') as espn_id, (e ->> 'ord')::int as rank, nullif(e ->> 'class_year', '')::int as cls,
           (e ->> 'ppg') is not null as has_stats
      from jsonb_array_elements(college_directory(array['QB','RB','WR','TE'], 2000)) e
  )
  insert into college_price (espn_id, rank, base, youth, as_of)
  select espn_id, rank, _college_curve(rank),
         case when coalesce(cls, 9) <= 2 and rank <= 150 then 1 else 0 end, now()
    from d where has_stats
  on conflict (espn_id) do update set rank = excluded.rank, base = excluded.base, youth = excluded.youth, as_of = excluded.as_of;
  get diagnostics n = row_count;
  delete from college_price p
   where p.as_of < now() - interval '1 minute'
     and exists (select 1 from college_player cp where cp.espn_id = p.espn_id and cp.active);
  get diagnostics gone = row_count;
  return jsonb_build_object('ok', true, 'priced', n, 'unranked', gone);
end $$;

drop function if exists _devy_price(text, text);
create function _devy_price(p_lineage text, p_slug text) returns numeric
  language sql stable security definer set search_path = public as $$
  -- p_lineage stays in the signature for callers; the price no longer
  -- depends on the league (decision 2: no demand bonus).
  select coalesce((select round(p.base * case when p.youth = 1 then 1.15 else 1 end, 2)
                     from college_price p where p.espn_id = substr(p_slug, 3)), 1)
$$;

drop function if exists _devy_proceeds(int, int, int, numeric);
create function _devy_proceeds(p_price numeric, p_sold int, p_shares int, p_cost numeric) returns numeric
  language sql immutable as $$
  select round(least(p_price * p_sold,
                     (_devy_share_rules() ->> 'payout_cap')::numeric * p_cost * p_sold / nullif(p_shares, 0)), 2)
$$;

-- ── cash: the league's starting cash for a seat with no book yet ──
create or replace function _devy_current_league(p_lineage text) returns uuid
  language sql stable security definer set search_path = public as $$
  select id from league where sleeper_league_id = p_lineage
   order by nullif(regexp_replace(season, '\D', '', 'g'), '')::int desc nulls last, created_at desc limit 1
$$;
create or replace function _devy_cash(p_lineage text, p_roster int) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce((select cash from devy_cash where lineage = p_lineage and roster_id = p_roster),
                  (select nullif(settings_json ->> 'devy_start_cash', '')::numeric from league where id = _devy_current_league(p_lineage)),
                  (_devy_share_rules() ->> 'budget')::numeric)
$$;
-- Add to a seat's cash in one statement (a payout never overwrites a buy).
create or replace function _devy_cash_add(p_lineage text, p_roster int, p_amount numeric) returns void
  language sql security definer set search_path = public as $$
  insert into devy_cash (lineage, roster_id, cash) values (p_lineage, p_roster, _devy_cash(p_lineage, p_roster) + p_amount)
  on conflict (lineage, roster_id) do update set cash = devy_cash.cash + p_amount
$$;

-- Is this league row its lineage's current season?
create or replace function _devy_is_current(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select _devy_current_league(_lineage(p_league_id)) = p_league_id
$$;

-- ── the lock: from Jan 15 until a draft in the lineage completes after it ──
create or replace function _devy_shares_locked(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select now() >= devy_shares_lock_at()
     and not exists (
       select 1 from league l join draft d on d.league_id = l.id
        where l.sleeper_league_id = _lineage(p_league_id)
          and d.status = 'complete' and d.completed_at >= devy_shares_lock_at())
$$;

-- The Jan 15 that follows a moment (for the pre-lock quiet window).
create or replace function _devy_lock_after(p_at timestamptz) returns timestamptz
  language sql stable as $$
  select case when p_at < devy_shares_lock_at(p_at) then devy_shares_lock_at(p_at)
              else devy_shares_lock_at(p_at + interval '1 year') end
$$;

create or replace function _devy_maxed(p_shares int, p_cost numeric) returns boolean
  language sql immutable as $$
  select p_shares >= (_devy_share_rules() ->> 'max')::int or p_cost >= (_devy_share_rules() ->> 'max_spend')::numeric
$$;
create or replace function _devy_qualified(p_shares int, p_cost numeric) returns boolean
  language sql immutable as $$
  select p_shares >= (_devy_share_rules() ->> 'floor')::int and p_cost >= (_devy_share_rules() ->> 'min_spend')::numeric
$$;

-- ── the rights ──
create or replace function devy_share_rights(p_lineage text)
  returns table (slug text, roster_id int, via text)
  language sql stable security definer set search_path = public as $$
  with maxed as (
    select distinct on (s.slug) s.slug, s.roster_id
      from devy_share s
     where s.lineage = p_lineage and _devy_maxed(s.shares, s.cost)
     order by s.slug, s.maxed_at nulls last, s.roster_id
  ), q as (
    select s.slug, s.roster_id,
           -- qualified in the quiet window before a lock: can't break an older right
           (s.qual_at is not null and s.qual_at >= _devy_lock_after(s.qual_at) - ((_devy_share_rules() ->> 'quiet_days') || ' days')::interval) as late
      from devy_share s
     where s.lineage = p_lineage and _devy_qualified(s.shares, s.cost)
  ), sole as (
    select q.slug,
           case when count(*) = 1 then min(q.roster_id)
                when count(*) filter (where not q.late) = 1 then min(q.roster_id) filter (where not q.late) end as roster_id
      from q group by q.slug
  )
  select m.slug, m.roster_id, 'max' from maxed m
  union all
  select so.slug, so.roster_id, 'sole' from sole so
   where so.roster_id is not null and not exists (select 1 from maxed m where m.slug = so.slug)
$$;

-- Reserved graduates in a pool. A holder with no picks left in a live draft,
-- or who can't roster him under the position caps, releases him (bug 7).
create or replace function devy_reserved(p_league_id uuid)
  returns table (slug text, roster_id int, college_slug text)
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; r record;
begin
  if not exists (select 1 from devy_share where lineage = _lineage(p_league_id)) then return; end if;
  select * into d from draft where league_id = p_league_id;
  for r in
    select a.new_slug, x.roster_id, x.slug as cslug
      from devy_share_rights(_lineage(p_league_id)) x
      join player_alias a on a.old_slug = x.slug
     where exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = a.new_slug)
       and not exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = a.new_slug)
  loop
    if d.status = 'live' and d.mode <> 'auction' and _picks_left(d, r.roster_id) = 0 then continue; end if;
    if pos_cap_error(p_league_id, r.roster_id, r.new_slug) is not null then continue; end if;
    slug := r.new_slug; roster_id := r.roster_id; college_slug := r.cslug;
    return next;
  end loop;
end $$;

-- ── buying and selling ──
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

-- ── the market list ──
create or replace function devy_market(p_league_id uuid, p_limit int default 1000)
  returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'slug', 'c-' || p.espn_id, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr,
        'class_year', cp.class_year, 'rank', p.rank, 'youth', p.youth = 1,
        'price', _devy_price(null, 'c-' || p.espn_id)) order by p.rank)
      from (select * from college_price order by rank limit least(greatest(coalesce(p_limit, 1000), 1), 2000)) p
      join college_player cp on cp.espn_id = p.espn_id and cp.active), '[]'::jsonb)
  end
$$;

-- ── the read ──
create or replace function devy_shares_state(p_league_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  with lin as (select _lineage(p_league_id) as l),
  rights as (select * from devy_share_rights((select l from lin))),
  held as (
    select s.slug, jsonb_agg(jsonb_build_object('roster_id', s.roster_id, 'shares', s.shares, 'maxed_at', s.maxed_at,
             'cost', s.cost, 'value', _devy_proceeds(_devy_price(s.lineage, s.slug), s.shares, s.shares, s.cost),
             'maxed', _devy_maxed(s.shares, s.cost), 'qualified', _devy_qualified(s.shares, s.cost),
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
      'current', _devy_is_current(p_league_id),
      'locked', _devy_shares_locked(p_league_id),
      'lock_at', devy_shares_lock_at(),
      'frozen', _college_prices_frozen(),
      'rules', _devy_share_rules(),
      'start_cash', coalesce((select nullif(settings_json ->> 'devy_start_cash', '')::numeric from league where id = p_league_id), 100),
      'used', coalesce((select jsonb_object_agg(t.roster_id::text, t.shares) from teams t), '{}'::jsonb),
      'cash', coalesce((select jsonb_object_agg(t.roster_id::text, t.cash) from teams t), '{}'::jsonb),
      'value', coalesce((select jsonb_object_agg(t.roster_id::text, t.value) from teams t), '{}'::jsonb),
      'prices_as_of', (select max(as_of) from college_price),
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'slug', h.slug, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr, 'class_year', cp.class_year,
          'active', coalesce(cp.active, false),
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

-- ── the draft's end: graduates pay out, the undrafted who left refund half ──
create or replace function _devy_shares_clear_on_draft() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lin text; s record; k int := 0; paid numeric := 0; refunded numeric := 0; g int := 0;
        got numeric; rp numeric; rules jsonb := _devy_share_rules();
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    lin := _lineage(new.league_id);
    if not exists (select 1 from devy_share where lineage = lin) then return new; end if;
    perform pg_advisory_xact_lock(hashtext('devy_share:' || lin));
    -- graduates: the better of his college price and his NFL round, 3× cap
    for s in select d.*, a.draft_round from devy_share d join player_alias a on a.old_slug = d.slug
              where d.lineage = lin order by d.slug, d.roster_id loop
      rp := coalesce((rules -> 'round_price' ->> s.draft_round::text)::numeric, 0);
      got := _devy_proceeds(greatest(_devy_price(lin, s.slug), rp), s.shares, s.shares, s.cost);
      perform _devy_cash_add(lin, s.roster_id, got);
      paid := paid + got;
    end loop;
    select count(distinct d.slug) into k from devy_share d join player_alias a on a.old_slug = d.slug where d.lineage = lin;
    delete from devy_share d where d.lineage = lin and exists (select 1 from player_alias a where a.old_slug = d.slug);
    -- left college undrafted: half of what the stake cost comes back
    for s in select d.* from devy_share d join college_player cp on cp.espn_id = substr(d.slug, 3)
              where d.lineage = lin and not cp.active loop
      got := round(s.cost * (rules ->> 'refund')::numeric, 2);
      perform _devy_cash_add(lin, s.roster_id, got);
      refunded := refunded + got; g := g + 1;
    end loop;
    delete from devy_share d using college_player cp
     where d.lineage = lin and cp.espn_id = substr(d.slug, 3) and not cp.active;
    if k > 0 or g > 0 then
      perform _chat_house(new.league_id,
        'The draft is done. '
          || case when k > 0 then 'Stakes in ' || k || ' player' || case when k = 1 then '' else 's' end
               || ' who turned pro paid out ' || trim(to_char(paid, 'FM999990.##')) || ' points (the better of his college price and his NFL round). ' else '' end
          || case when g > 0 then g || ' stake' || case when g = 1 then '' else 's' end
               || ' on players who left college undrafted refunded half: ' || trim(to_char(refunded, 'FM999990.##')) || ' points.' else '' end,
        jsonb_build_object('kind', 'devy_shares_cleared', 'players', k, 'paid', paid, 'refunded', refunded));
    end if;
  end if;
  return new;
end $$;

-- ── the setting ──
create or replace function set_league_devy_mode(p_league_id uuid, p_mode text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; gone int := 0; lin text; s record; got numeric; n int := 0; total numeric := 0;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('spots', 'shares') then
    return jsonb_build_object('ok', false, 'error', 'devy mode is spots or shares');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if not _devy_is_current(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'that''s last season''s league — change it in the current season');
  end if;
  if coalesce(lg.settings_json ->> 'devy_mode', 'spots') = p_mode then
    return jsonb_build_object('ok', true, 'mode', p_mode);
  end if;
  lin := _lineage(p_league_id);
  -- Mid-cycle with stakes on the table, or mid-draft: no switching (bug 4).
  -- A league with no stakes yet (a new one, before its first draft) may.
  if exists (select 1 from draft where league_id = p_league_id and status = 'live')
     or (_devy_shares_locked(p_league_id) and exists (select 1 from devy_share where lineage = lin)) then
    return jsonb_build_object('ok', false, 'error', 'devy mode can''t change during the draft, or from January 15 until the rookie draft is done');
  end if;
  if p_mode = 'shares' then
    if not _league_has_college(lg.settings_json) then
      return jsonb_build_object('ok', false, 'error', 'devy shares need college players on in this league');
    end if;
    if league_is_college_calendar(p_league_id) then
      return jsonb_build_object('ok', false, 'error', 'devy shares are for leagues on the NFL schedule');
    end if;
    if exists (select 1 from draft where league_id = p_league_id and mode = 'auction') then
      return jsonb_build_object('ok', false, 'error', 'devy shares need a snake or linear draft — an auction can''t honour a reserved player');
    end if;
    if _devy_slots(p_league_id) > 0 then
      return jsonb_build_object('ok', false, 'error', 'set the devy roster spots to 0 first — shares replace them');
    end if;
    if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug ~ '^c-[0-9]+$') then
      return jsonb_build_object('ok', false, 'error', 'drop the college players on rosters first — in a shares league nobody rosters them');
    end if;
    delete from league_pool lp where lp.league_id = p_league_id and lp.slug ~ '^c-[0-9]+$';
    get diagnostics gone = row_count;
  else
    -- Leaving shares cashes every stake out at today's value (no cap).
    perform pg_advisory_xact_lock(hashtext('devy_share:' || lin));
    for s in select * from devy_share where lineage = lin loop
      got := _devy_proceeds(_devy_price(lin, s.slug), s.shares, s.shares, s.cost);
      perform _devy_cash_add(lin, s.roster_id, got);
      n := n + 1; total := total + got;
    end loop;
    delete from devy_share where lineage = lin;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('devy_mode', p_mode)
   where id = p_league_id;
  perform _chat_house(p_league_id,
    case when p_mode = 'shares'
      then 'Devy is now a market: every team gets ' || trim(to_char(_devy_cash(lin, -1), 'FM999990.##'))
        || ' points to buy shares in college players, priced by how they''re playing. Max a stake first (20 shares or 60 points), or be the only team in with 5+ shares and 15+ points, and he''s yours to draft when he turns pro — and your shares pay out at the better of his college price and his NFL round.'
      else 'Devy is back to roster spots. Every share was cashed out at today''s value'
        || case when n > 0 then ' (' || n || ' stakes, ' || trim(to_char(total, 'FM999990.##')) || ' points)' else '' end || '.' end,
    jsonb_build_object('kind', 'devy_mode', 'mode', p_mode));
  return jsonb_build_object('ok', true, 'mode', p_mode, 'college_removed_from_pool', gone, 'cashed_out', n);
end $$;

-- The starting cash for a team with no book yet (decision 6). A taken-over
-- seat keeps its book: the book is the seat's, not the manager's.
create or replace function set_league_devy_start_cash(p_league_id uuid, p_cash numeric)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not _devy_is_current(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'that''s last season''s league — change it in the current season');
  end if;
  if p_cash is null or p_cash < 0 or p_cash > 500 then
    return jsonb_build_object('ok', false, 'error', 'starting cash is 0 to 500');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('devy_start_cash', round(p_cash, 2))
   where id = p_league_id;
  return jsonb_build_object('ok', true, 'start_cash', round(p_cash, 2));
end $$;
grant execute on function set_league_devy_start_cash(uuid, numeric) to authenticated;

-- ── a reserved graduate can't be picked up off the wire (bug 12) ──
create or replace function _devy_reserved_pickup_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare holder int;
begin
  if new.acquired in ('fa', 'waiver') and exists (select 1 from devy_share where lineage = _lineage(new.league_id)) then
    select r.roster_id into holder from devy_reserved(new.league_id) r where r.slug = new.slug;
    if holder is not null and holder <> new.roster_id then
      raise exception 'reserved: another team holds his devy rights — he goes in the rookie draft';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists devy_reserved_pickup_guard on native_roster;
create trigger devy_reserved_pickup_guard before insert on native_roster
  for each row execute function _devy_reserved_pickup_guard();

-- ── graduation reaches players held in shares (bug 1), and keeps the round ──
create or replace function graduation_candidates() returns table (espn_id text, sleeper_id text, leagues int)
  language sql stable security definer set search_path = public as $$
  select c.espn_id, max(x.sleeper_id), count(distinct c.src)::int
    from (select substr(lp.slug, 3) as espn_id, lp.league_id::text as src from league_pool lp where lp.level = 'college'
          union all
          select substr(s.slug, 3), 'shares:' || s.lineage from devy_share s) c
    left join player_xref x on x.espn_id = c.espn_id
   group by c.espn_id
$$;
revoke all on function graduation_candidates() from public, anon, authenticated;
grant execute on function graduation_candidates() to service_role;

-- ── graduate_college_player — 0367's body, plus shares and the draft round ──
drop function if exists graduate_college_player(text, text, text, text, text, text);
create or replace function graduate_college_player(
  p_espn_id text, p_new_slug text, p_full_name text, p_pos text, p_team text, p_sleeper_id text,
  p_draft_round int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  old text := 'c-' || p_espn_id;
  lg record; target text; nfl_holder int; col_holder int; col_rank int;
  done int := 0; conflicts int := 0; kp int[];
begin
  if coalesce(p_espn_id, '') !~ '^\d+$' or coalesce(p_new_slug, '') = '' or p_new_slug ~ '^c-[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'an ESPN id and an NFL slug');
  end if;

  for lg in select distinct league_id from league_pool where slug = old loop
    -- One league at a time, each its own sub-transaction: a trigger that
    -- refuses (a commissioner's flag on the NFL slug, say) records a conflict
    -- for that league and rolls back only its half-done rewrite.
    begin
      -- The NFL row this league already has for him, by slug or by Sleeper id.
      select lp.slug into target from league_pool lp
       where lp.league_id = lg.league_id and lp.slug <> old
         and (lp.slug = p_new_slug or (p_sleeper_id is not null and lp.sleeper_id = p_sleeper_id))
       order by (lp.slug = p_new_slug) desc limit 1;
      select roster_id into col_holder from native_roster where league_id = lg.league_id and slug = old;
      if target is not null then
        select roster_id into nfl_holder from native_roster where league_id = lg.league_id and slug = target;
        if nfl_holder is not null and col_holder is not null and nfl_holder <> col_holder then
          insert into college_graduation (espn_id, league_id, status, new_slug, note)
            values (p_espn_id, lg.league_id, 'conflict', target,
                    'Team ' || col_holder || ' holds him as a devy player and Team ' || nfl_holder || ' rosters him as an NFL player')
            on conflict (espn_id, league_id) do update set status = 'conflict', new_slug = excluded.new_slug,
              note = excluded.note, at = now();
          conflicts := conflicts + 1;
          continue;
        end if;
        if nfl_holder is not null and col_holder is not null then
          -- The same team holds both rows: keep the NFL row, drop the college one.
          delete from native_roster where league_id = lg.league_id and slug = old;
          col_holder := null;
        end if;
      else
        target := p_new_slug;
        select rank into col_rank from league_pool where league_id = lg.league_id and slug = old;
        insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
          values (lg.league_id, target, p_full_name, p_pos, coalesce(p_team, ''), col_rank, p_espn_id, 0,
                  -- The per-league unique index (0205) must not trip on a row
                  -- that holds the id under another slug; that case took the
                  -- branch above.
                  p_sleeper_id);
      end if;

      -- ── live rows ──
      if col_holder is not null then
        -- keeper_pick references native_roster (league_id, slug): lift the
        -- keeper marks off, move the row, put them back on the new slug.
        select array_agg(roster_id) into kp from keeper_pick where league_id = lg.league_id and slug = old;
        delete from keeper_pick where league_id = lg.league_id and slug = old;
        update native_roster set slug = target where league_id = lg.league_id and slug = old;
        if kp is not null then
          insert into keeper_pick (league_id, roster_id, slug)
            select lg.league_id, k, target from unnest(kp) k on conflict do nothing;
        end if;
      end if;
      perform _graduate_col('contract', 'slug', lg.league_id, old, target);
      perform _graduate_col('salary_retention', 'slug', lg.league_id, old, target);
      perform _graduate_col('rfa_tender', 'slug', lg.league_id, old, target);
      perform _graduate_col('player_flag', 'slug', lg.league_id, old, target);
      perform _graduate_col('draft_queue', 'slug', lg.league_id, old, target);
      perform _graduate_col('trade_signal', 'slug', lg.league_id, old, target);
      perform _graduate_col('auction_lot', 'slug', lg.league_id, old, target);
      update draft set lot_slug = target where league_id = lg.league_id and lot_slug = old;
      update waiver_claim set add_slug = target where league_id = lg.league_id and add_slug = old and status = 'pending';
      update waiver_claim set drop_slug = target where league_id = lg.league_id and drop_slug = old and status = 'pending';
      update trade_proposal set give = _graduate_json(give, old, target), get = _graduate_json(get, old, target),
                                retain = _graduate_json(retain, old, target)
       where league_id = lg.league_id and status in ('pending', 'accepted', 'review')
         and (give::text || get::text || coalesce(retain::text, '')) like '%"' || old || '"%';
      update trade_leg l set send = _graduate_json(send, old, target)
        from trade_proposal t
       where t.id = l.trade_id and l.league_id = lg.league_id and t.status in ('pending', 'accepted', 'review')
         and l.send::text like '%"' || old || '"%';

      delete from league_pool where league_id = lg.league_id and slug = old;
      insert into college_graduation (espn_id, league_id, status, new_slug, note)
        values (p_espn_id, lg.league_id, 'done', target, null)
        on conflict (espn_id, league_id) do update set status = 'done', new_slug = excluded.new_slug, note = null, at = now();
      done := done + 1;
    exception when others then
      insert into college_graduation (espn_id, league_id, status, new_slug, note)
        values (p_espn_id, lg.league_id, 'conflict', p_new_slug, sqlerrm)
        on conflict (espn_id, league_id) do update set status = 'conflict', note = excluded.note, at = now();
      conflicts := conflicts + 1;
    end;
  end loop;

  -- ── account-wide ──
  -- 0396: a player held only in DEVY SHARES (no pool holds him) graduates too,
  -- and the alias keeps his NFL draft round for the payout.
  if done > 0 or exists (select 1 from devy_share s where s.slug = old) then
    insert into player_alias (old_slug, new_slug, espn_id, draft_round) values (old, p_new_slug, p_espn_id, p_draft_round)
      on conflict (old_slug) do update set new_slug = excluded.new_slug,
        draft_round = coalesce(excluded.draft_round, player_alias.draft_round), at = now();
    insert into favorite_player (app_user_id, player_slug, created_at)
      select app_user_id, p_new_slug, created_at from favorite_player where player_slug = old
      on conflict do nothing;
    delete from favorite_player where player_slug = old;
  end if;
  return jsonb_build_object('ok', true, 'leagues', done, 'conflicts', conflicts,
    'shares', exists (select 1 from devy_share s where s.slug = old));
end $$;
revoke all on function graduate_college_player(text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function graduate_college_player(text, text, text, text, text, text, int) to service_role;

-- ── a partial roster sweep retires nobody (bug 14) ──
create or replace function finish_college_sweep(p_started timestamptz) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int; stale int; live int;
begin
  if p_started is null then return jsonb_build_object('ok', false, 'error', 'a start time'); end if;
  select count(*) filter (where seen_at < p_started), count(*) into stale, live from college_player where active;
  -- 0396: more than a tenth of college "gone" at once is a sweep that didn't
  -- see everyone, not a mass departure — retire nobody, say so.
  if live >= 200 and stale > live / 10 then   -- at scale only: a handful of rows proves nothing
    return jsonb_build_object('ok', true, 'retired', 0, 'skipped', true, 'unseen', stale, 'active', live);
  end if;
  update college_player set active = false, updated_at = now()
   where active and seen_at < p_started;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'retired', n);
end $$;

-- First prices on the new curve (a no-op inside the offseason freeze).
select refresh_college_prices();
