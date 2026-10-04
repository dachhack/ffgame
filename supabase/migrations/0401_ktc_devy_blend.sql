-- ═══════════════════════════════════════════════════════════════════════════
-- 0401 · KTC IS BLENDED INTO DEVY PRICES ALL SEASON.
--
-- Founder: "Let's do 2 instead" — a standing blend of KTC's devy rank and the
-- stats rank, replacing 0400's early-season seed that faded to stats-only
-- over a player's first four games.
--
--   rank = exp(w·ln(ktc rank) + (1−w)·ln(stats rank)),  w = _college_ktc_weight()
--
-- w is 0.5: an even split, in one place so play-testing can tune it. Players
-- KTC ranks with no stats are priced from KTC alone; players KTC doesn't rank
-- (everyone past its ~100) are priced from stats alone, as before.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _college_ktc_weight() returns numeric
  language sql immutable as $$ select 0.5::numeric $$;

create or replace function refresh_college_prices() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int; gone int; seeded int;
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
  ), j as (
    select coalesce(d.espn_id, k.espn_id) as espn_id,
           case when d.has_stats then d.rank end as srank,
           k.ktc_rank as krank,
           coalesce(d.cls, cp.class_year) as cls,
           -- 0401: KTC's weight is fixed — the blend holds all season
           case when k.espn_id is null then 0 else _college_ktc_weight() end as w
      from d
      full join college_ktc k on k.espn_id = d.espn_id
      left join college_player cp on cp.espn_id = coalesce(d.espn_id, k.espn_id)
     where (d.has_stats or k.espn_id is not null) and coalesce(cp.active, true)
  ), b as (
    select espn_id, cls, w, krank,
           case when srank is null then krank
                when krank is null or w = 0 then srank
                else greatest(1, round(exp(w * ln(krank) + (1 - w) * ln(srank))))::int end as rank
      from j
  )
  insert into college_price (espn_id, rank, base, youth, as_of)
  select espn_id, rank, _college_curve(rank),
         case when coalesce(cls, 9) <= 2 and rank <= 150 then 1 else 0 end, now()
    from b
  on conflict (espn_id) do update set rank = excluded.rank, base = excluded.base, youth = excluded.youth, as_of = excluded.as_of;
  get diagnostics n = row_count;
  select count(*) into seeded from college_ktc k join college_price p using (espn_id) where p.as_of >= now() - interval '1 minute';
  delete from college_price p
   where p.as_of < now() - interval '1 minute'
     and exists (select 1 from college_player cp where cp.espn_id = p.espn_id and cp.active);
  get diagnostics gone = row_count;
  return jsonb_build_object('ok', true, 'priced', n, 'unranked', gone, 'ktc', seeded);
end $$;
