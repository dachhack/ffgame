-- ═══════════════════════════════════════════════════════════════════════════
-- 0403 · THE DEVY MARKET PRICES ON STATHEAD'S DEVY COMPOSITE, NOT KTC.
--
-- StatHead's data handoff (Oct 1): "Anything you show players must be a
-- StatHead number, never a raw third-party one." 0400/0401 priced devy shares
-- from KeepTradeCut's board — and a player KTC ranked with no stats was
-- priced from KTC's order alone, one source's number on screen.
--
-- StatHead now publishes devy-rankings.json: 6,441 college QB/RB/WR/TE, each
-- with a composite (its value model blended with its NFL career projection)
-- per format. Its cfbdId IS the ESPN athlete id (spot-checked against ESPN),
-- so it joins college_player.espn_id exactly — no name matching.
--
-- The price keeps the founder's option 2 shape, with StatHead in KTC's seat:
--   rank = exp(w·ln(StatHead composite rank, 1QB) + (1−w)·ln(stats rank)), w = 0.5
-- and a player StatHead ranks with no stats is priced from StatHead alone.
--
-- Loading: the worker upserts the board in chunks stamped with one as_of,
-- then finish_stathead_devy(as_of) drops rows that batch didn't carry — and
-- refuses when the batch is short, so a broken read never empties the board.
-- KTC's board, its loader and its table go.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists stathead_devy (
  espn_id     text primary key,          -- StatHead's cfbdId (= ESPN athlete id)
  name        text,
  pos         text,
  rank_1qb    int  not null,             -- compositeRank.oneQB
  rank_sf     int,                       -- compositeRank.sf
  value_1qb   numeric,                   -- compositeValue.oneQB (0–9990)
  value_sf    numeric,
  draft_year  int,
  as_of       timestamptz not null
);
alter table stathead_devy enable row level security;
drop policy if exists stathead_devy_read on stathead_devy;
create policy stathead_devy_read on stathead_devy for select using (auth.uid() is not null);

-- p_rows: [{espn_id, name, pos, rank_1qb, rank_sf, value_1qb, value_sf, draft_year}]
create or replace function upsert_stathead_devy(p_rows jsonb, p_as_of timestamptz) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  insert into stathead_devy (espn_id, name, pos, rank_1qb, rank_sf, value_1qb, value_sf, draft_year, as_of)
  select e ->> 'espn_id', e ->> 'name', upper(e ->> 'pos'), (e ->> 'rank_1qb')::int,
         nullif(e ->> 'rank_sf', '')::int, nullif(e ->> 'value_1qb', '')::numeric, nullif(e ->> 'value_sf', '')::numeric,
         nullif(e ->> 'draft_year', '')::int, p_as_of
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
   where (e ->> 'espn_id') ~ '^[0-9]+$' and (e ->> 'rank_1qb') ~ '^[0-9]+$'
  on conflict (espn_id) do update set name = excluded.name, pos = excluded.pos, rank_1qb = excluded.rank_1qb,
      rank_sf = excluded.rank_sf, value_1qb = excluded.value_1qb, value_sf = excluded.value_sf,
      draft_year = excluded.draft_year, as_of = excluded.as_of;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function upsert_stathead_devy(jsonb, timestamptz) from public, anon;
grant execute on function upsert_stathead_devy(jsonb, timestamptz) to authenticated;

create or replace function finish_stathead_devy(p_as_of timestamptz) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare fresh int; gone int; matched int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select count(*) into fresh from stathead_devy where as_of = p_as_of;
  if fresh < 1000 then
    return jsonb_build_object('ok', false, 'error', 'short board (' || fresh || ' rows) — kept the last one');
  end if;
  delete from stathead_devy where as_of <> p_as_of;
  get diagnostics gone = row_count;
  select count(*) into matched from stathead_devy s join college_player cp on cp.espn_id = s.espn_id;
  return jsonb_build_object('ok', true, 'rows', fresh, 'dropped', gone, 'matched', matched);
end $$;
revoke all on function finish_stathead_devy(timestamptz) from public, anon;
grant execute on function finish_stathead_devy(timestamptz) to authenticated;

create or replace function _college_devy_weight() returns numeric
  language sql immutable as $$ select 0.5::numeric $$;

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
  with d as (
    select (e ->> 'espn_id') as espn_id, (e ->> 'ord')::int as rank, nullif(e ->> 'class_year', '')::int as cls,
           (e ->> 'ppg') is not null as has_stats
      from jsonb_array_elements(college_directory(array['QB','RB','WR','TE'], 2000)) e
  ), sh as (
    select s.espn_id, s.rank_1qb from stathead_devy s
      join college_player cp on cp.espn_id = s.espn_id and cp.active and cp.pos in ('QB','RB','WR','TE')
  ), j as (
    select coalesce(d.espn_id, sh.espn_id) as espn_id,
           case when d.has_stats then d.rank end as srank,
           sh.rank_1qb as hrank,
           coalesce(d.cls, cp.class_year) as cls
      from d
      full join sh on sh.espn_id = d.espn_id
      left join college_player cp on cp.espn_id = coalesce(d.espn_id, sh.espn_id)
     where (d.has_stats or sh.espn_id is not null) and coalesce(cp.active, true)
  ), b as (
    select espn_id, cls,
           case when srank is null then hrank
                when hrank is null then srank
                else greatest(1, round(exp(_college_devy_weight() * ln(hrank)
                                           + (1 - _college_devy_weight()) * ln(srank))))::int end as rank
      from j
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

-- KTC's board is gone from the game.
drop function if exists set_college_ktc(jsonb);
drop function if exists _college_ktc_weight();
drop table if exists college_ktc;
