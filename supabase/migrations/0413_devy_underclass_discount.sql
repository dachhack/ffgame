-- ═══════════════════════════════════════════════════════════════════════════
-- 0413 · UNDERCLASSMEN PRICE CHEAPER; THE TOP 10 SPREAD OUT.
--
-- Founder (v0.593.0): "should players price cheaper earlier in their college
-- careers?" Yes. Since 0388 a freshman or sophomore in the top 150 cost ×1.15,
-- which (a) counted youth twice (StatHead's composite already ranks a young
-- phenom above an older player with the same output), (b) put sophomore #8 at
-- 11.50 over StatHead's #1 at 10.00, and (c) lost 13% for every holder the
-- day the player became a junior, at the same rank. Backwards for a market
-- whose point is rewarding the team that finds a player early.
--
-- Now a class DISCOUNT: freshman ×0.85, sophomore ×0.92, junior and up ×1.
-- A young player who holds his rank gains as he ages (the reward for waiting
-- and for the bust risk); one who climbs gains more. college_price.mult holds
-- it (stored, so the offseason freeze freezes it too); `youth` now means "an
-- underclass discount applies". The floor stays 1.
--
-- The curve kept the top 10 flat at 10 (StatHead's #1 = #10). Ranks under 10
-- now spread on 10 + 2·log10(10/rank): #1 12.00, #2 11.40, #5 10.60, #10 10.
-- From #10 down the curve is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

alter table college_price add column if not exists mult numeric(4, 2) not null default 1;

create or replace function _college_class_mult(p_cls int) returns numeric
  language sql immutable as $$
  select case p_cls when 1 then 0.85 when 2 then 0.92 else 1 end::numeric
$$;

create or replace function _college_curve(p_rank int) returns numeric
  language sql immutable as $$
  select case when p_rank is null or p_rank < 1 then 1
              when p_rank < 10 then round(least(12, 10 + 2 * log(10, 10.0 / p_rank)), 2)
              else round(greatest(1, least(10, 10 - 2 * log(2, p_rank / 10.0))), 2) end
$$;

create or replace function _devy_price(p_lineage text, p_slug text) returns numeric
  language sql stable security definer set search_path = public as $$
  -- p_lineage stays in the signature for callers; the price doesn't depend on the league.
  select coalesce((select greatest(1, round(p.base * p.mult, 2))
                     from college_price p where p.espn_id = substr(p_slug, 3)), 1)
$$;

create or replace function refresh_college_prices() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int; gone int; boarded int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if _college_prices_frozen() then
    return jsonb_build_object('ok', true, 'frozen', true, 'priced', 0);
  end if;
  -- 0412: StatHead's composite rank alone; 0413: × the class discount.
  with b as (
    select s.espn_id, s.rank_1qb as rank, _college_class_mult(cp.class_year) as m
      from stathead_devy s
      join college_player cp on cp.espn_id = s.espn_id and cp.active and cp.pos in ('QB','RB','WR','TE')
     where s.rank_1qb is not null and s.rank_1qb >= 1
  )
  insert into college_price (espn_id, rank, base, mult, youth, as_of)
  select espn_id, rank, _college_curve(rank), m, (m < 1)::int, now()
    from b
  on conflict (espn_id) do update set rank = excluded.rank, base = excluded.base, mult = excluded.mult,
                                      youth = excluded.youth, as_of = excluded.as_of;
  get diagnostics n = row_count;
  select count(*) into boarded from stathead_devy s join college_price p using (espn_id) where p.as_of >= now() - interval '1 minute';
  delete from college_price p
   where p.as_of < now() - interval '1 minute'
     and exists (select 1 from college_player cp where cp.espn_id = p.espn_id and cp.active);
  get diagnostics gone = row_count;
  return jsonb_build_object('ok', true, 'priced', n, 'unranked', gone, 'stathead', boarded);
end $$;

-- A new listing's opening price (0407), on the same rules.
create or replace function _devy_open_price(p_slug text) returns numeric
  language plpgsql security definer set search_path = public as $$
declare r int; cls int;
begin
  if exists (select 1 from college_price where espn_id = substr(p_slug, 3)) then return _devy_price(null, p_slug); end if;
  select s.rank_1qb, cp.class_year into r, cls from stathead_devy s join college_player cp using (espn_id)
   where s.espn_id = substr(p_slug, 3);
  if r is null then return 1; end if;
  insert into college_price (espn_id, rank, base, mult, youth, as_of)
  values (substr(p_slug, 3), r, _college_curve(r), _college_class_mult(cls), (_college_class_mult(cls) < 1)::int, now())
  on conflict (espn_id) do nothing;
  return _devy_price(null, p_slug);
end $$;

-- Today's rows onto the new rules (outside the offseason freeze), without
-- waiting for the next reprice. A graduate's frozen row isn't touched.
update college_price p
   set base = _college_curve(p.rank), mult = _college_class_mult(cp.class_year),
       youth = (_college_class_mult(cp.class_year) < 1)::int
  from college_player cp
 where cp.espn_id = p.espn_id and cp.active and not _college_prices_frozen();
