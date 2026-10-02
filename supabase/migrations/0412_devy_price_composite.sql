-- ═══════════════════════════════════════════════════════════════════════════
-- 0412 · DEVY PRICES FROM STATHEAD'S COMPOSITE, NOT COLLEGE PRODUCTION.
--
-- StatHead's audit of a live league: Drip's devy prices tracked 2025+2026
-- college PPR (rank correlation +0.69), not StatHead's devy composite (+0.19)
-- and not team strength (−0.01). Production against weak schedules was paid in
-- full — Reddit: "not properly calibrated for level of competition". Caleb
-- Hawkins (#59 on the composite) priced 10.38; Arch Manning (#3) 8.64.
--
-- The composite is the owner's recipe already: recognized market value (StatHead's
-- value model, 65–89% of the weight) with a modest NFL-career-model adjustment
-- (its RANK, so the Group of 5 overstatement in the raw career projections
-- doesn't reach it). 0403 blended it 50/50 with our stats rank; now the price
-- rank IS the composite rank (1QB), on the same curve — so the economy keeps
-- its scale and spread (StatHead's "keep the distribution, reassign it by
-- composite order") and only who holds which price changes. A player off the
-- board has no StatHead number and trades at the floor (the third-party rule:
-- every price a player sees is a StatHead number).
--
-- Prices are global (one per player, every league), so this is the 1QB
-- composite. Takes effect at the next college sweep (weekly; or ops college-sweep).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _college_devy_weight() returns numeric
  language sql immutable as $$ select 1::numeric $$;   -- 0412: StatHead only

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
  -- 0412: StatHead's composite rank alone. College production no longer
  -- moves a price (it rewarded production against weak schedules in full);
  -- a player StatHead doesn't rank has no price row and trades at the floor.
  with b as (
    select s.espn_id, s.rank_1qb as rank, cp.class_year as cls
      from stathead_devy s
      join college_player cp on cp.espn_id = s.espn_id and cp.active and cp.pos in ('QB','RB','WR','TE')
     where s.rank_1qb is not null and s.rank_1qb >= 1
  )
  insert into college_price (espn_id, rank, base, youth, as_of)
  select espn_id, rank, _college_curve(rank),
         case when coalesce(cls, 9) <= 2 and rank <= 150 then 1 else 0 end, now()
    from b
  on conflict (espn_id) do update set rank = excluded.rank, base = excluded.base, youth = excluded.youth, as_of = excluded.as_of;
  get diagnostics n = row_count;
  select count(*) into boarded from stathead_devy s join college_price p using (espn_id) where p.as_of >= now() - interval '1 minute';
  delete from college_price p
   where p.as_of < now() - interval '1 minute'
     and exists (select 1 from college_player cp where cp.espn_id = p.espn_id and cp.active);
  get diagnostics gone = row_count;
  return jsonb_build_object('ok', true, 'priced', n, 'unranked', gone, 'stathead', boarded);
end $$;
