-- 0230: two markets, two jobs
--
-- Founder, over a cap sheet where every RB read "mkt $286" — Aaron Jones's
-- $1 flier included — while Brock Bowers's $208 deal read "mkt $76": "How
-- do we determine market price on these? I'm concerned the market is a lot
-- higher than the prices we paid in the auction."
--
-- One number was doing two jobs. contract_market_value (the top-5
-- positional salary average) is the NFL's own FRANCHISE TAG formula — it
-- prices a position's elite, which is exactly what a tag should cost, and
-- franchise_tag keeps it. But stamped on every player as "mkt", and used
-- as the extension base, it priced everyone at the position like its
-- stars: extending a $1 flier cost 85% of the RB elite ($243) while a top
-- TE extended for 85% of an average dragged down by $1 street deals.
--
-- player_market_value is the per-player price: the same value curve the
-- auction AI bids from — cap × 0.34 × e^(−rank/45) at HIS pool rank — so
-- "market" means "what this league's own market-maker pays for him".
-- The cap sheet's mkt column and extend_contract now read it; the tag
-- stays on the positional formula it was born from.

create or replace function player_market_value(p_league_id uuid, p_slug text) returns int
  language sql stable security definer set search_path = public as $$
  select greatest(1, round(
    league_salary_cap(p_league_id) * 0.34 * exp(-(
      select lp.rank from league_pool lp
      where lp.league_id = p_league_id and lp.slug = p_slug) / 45.0))::int);
$$;

create or replace function extend_contract(p_league_id uuid, p_slug text, p_years int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; err text; price int;
begin
  err := _offseason_error(p_league_id);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if p_years is null or p_years < 1 or p_years > 3 then
    return jsonb_build_object('ok', false, 'error', 'extensions run 1–3 years');
  end if;
  select * into c from contract where league_id = p_league_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'no contract for that player'); end if;
  if not (owns_roster(p_league_id, c.roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your player');
  end if;
  if c.years > 1 then return jsonb_build_object('ok', false, 'error', 'extensions are for expiring deals — this one has years left'); end if;
  if c.tagged then return jsonb_build_object('ok', false, 'error', 'tagged players play the tag year — no extension on top'); end if;
  if exists (select 1 from rfa_tender where league_id = p_league_id and slug = p_slug and status = 'open') then
    return jsonb_build_object('ok', false, 'error', 'this player is tendered — resolve the RFA first');
  end if;
  -- 0230: the discount comes off HIS market, not his position's elite —
  -- 85% of the top-5 average made a $1 flier cost $243 to extend in the
  -- founder's league while a $208 tight end extended for $65.
  price := greatest(1, ceil(player_market_value(p_league_id, p_slug) * ext_discount_pct(p_league_id) / 100.0)::int);
  update contract set salary = price, years = p_years + 1
    where league_id = p_league_id and slug = p_slug;
  insert into league_txn (league_id, kind, roster_id, slug, note)
  values (p_league_id, 'extension', c.roster_id, p_slug,
          'extended — $' || price || ' for ' || p_years || 'yr at ' || ext_discount_pct(p_league_id) || '% of market');
  return jsonb_build_object('ok', true, 'slug', p_slug, 'salary', price, 'years', p_years,
    'note', 'carries ' || p_years || 'yr into next season');
end $$;

create or replace function league_contracts(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare my_rid int; dl timestamptz;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not contracts_on(p_league_id) then return jsonb_build_object('contracts', false); end if;
  select sleeper_roster_id into my_rid from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled limit 1;
  dl := _contract_lock_deadline(p_league_id);
  return jsonb_build_object(
    'contracts', true,
    'salary_cap', league_salary_cap(p_league_id),
    'years_max', contract_years_max(p_league_id),
    -- 0229: 'locked' is the CALLER's — lengths stay assignable after the room
    -- closes until this seat locks (or the deadline passes). Kept as the one
    -- flag existing clients read; the lock machinery rides alongside.
    'locked', coalesce((select status from draft where league_id = p_league_id) = 'complete', true)
      and (my_rid is null
           or coalesce((select contracts_locked from league_membership
                        where league_id = p_league_id and sleeper_roster_id = my_rid), false)
           or (dl is not null and now() >= dl)),
    'my_locked', coalesce((select contracts_locked from league_membership
                           where league_id = p_league_id and sleeper_roster_id = my_rid), false),
    'lock_deadline', dl,
    'locks', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m2.sleeper_roster_id, 'locked',
        m2.contracts_locked or (dl is not null and now() >= dl)) order by m2.sleeper_roster_id)
      from league_membership m2 where m2.league_id = p_league_id), '[]'::jsonb),
    'offseason', _season_over(p_league_id) or is_admin(),
    'rules', jsonb_build_object(
      'dead_pct', contract_dead_pct(p_league_id),
      'retention', salary_retention_on(p_league_id),
      'cap_trading', cap_trading_on(p_league_id),
      'ir_relief', ir_cap_relief_on(p_league_id),
      'tag_raise_pct', tag_raise_pct(p_league_id),
      'ext_discount_pct', ext_discount_pct(p_league_id),
      'rfa', rfa_on(p_league_id)),
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'roster_id', c.roster_id, 'salary', c.salary,
        'years', c.years, 'acquired', c.acquired, 'tagged', c.tagged,
        'mkt', player_market_value(p_league_id, c.slug),  -- 0230: HIS price, not his position's
        'retained', coalesce((select sum(sr.amount) from salary_retention sr
            where sr.league_id = c.league_id and sr.slug = c.slug), 0)
        ) order by c.roster_id, c.salary desc, c.slug)
      from contract c where c.league_id = p_league_id), '[]'::jsonb),
    'retentions', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', sr.roster_id, 'slug', sr.slug, 'amount', sr.amount) order by sr.roster_id, sr.slug)
      from salary_retention sr where sr.league_id = p_league_id), '[]'::jsonb),
    'dead', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', dm.roster_id, 'slug', dm.slug, 'amount', dm.amount,
        'years_left', dm.years_left, 'note', dm.note) order by dm.roster_id, dm.amount desc)
      from dead_money dm where dm.league_id = p_league_id), '[]'::jsonb),
    'tenders', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', rt.slug, 'roster_id', rt.roster_id, 'status', rt.status,
        'offer_roster', rt.offer_roster, 'offer_salary', rt.offer_salary,
        'offer_years', rt.offer_years) order by rt.created_at)
      from rfa_tender rt where rt.league_id = p_league_id), '[]'::jsonb),
    'payrolls', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'payroll', team_payroll(p_league_id, m.sleeper_roster_id),
        'cap', team_cap(p_league_id, m.sleeper_roster_id),
        'cap_adjust', m.cap_adjust) order by m.sleeper_roster_id)
      from league_membership m where m.league_id = p_league_id), '[]'::jsonb));
end $$;
