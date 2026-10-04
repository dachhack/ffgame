-- ═══════════════════════════════════════════════════════════════════════════
-- 0400 · KTC'S DEVY BOARD SEEDS EARLY-SEASON PRICES.
--
-- Founder: "Just 3" — seed prices from KeepTradeCut's devy rankings early in
-- the season, when there are few stats, then let on-field play take over.
--
-- The worker reads KTC's devy board (~100 players) and hands it to
-- set_college_ktc, which matches each row to a college_player by name and
-- position (the school breaks ties). refresh_college_prices then blends:
--
--   w    = max(0, 1 − games this season / 4)     -- KTC's weight, per player
--   rank = exp(w·ln(ktc rank) + (1−w)·ln(stats rank))
--
-- A player KTC ranks and the stats don't yet (no qualifying games) is priced
-- from KTC alone. After four games this season his price is stats only, so
-- scouting the stats still beats the crowd from October on.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists college_ktc (
  espn_id  text primary key,
  ktc_rank int  not null,
  value    int  not null,
  name     text,
  as_of    timestamptz not null default now()
);
alter table college_ktc enable row level security;
drop policy if exists college_ktc_read on college_ktc;
create policy college_ktc_read on college_ktc for select using (auth.uid() is not null);

create or replace function _college_norm(p text) returns text
  language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(p, '')), '\m(jr|sr|ii|iii|iv|v)\M\.?', '', 'g'), '[^a-z]', '', 'g')
$$;

-- The college season a moment belongs to (August on is the new one).
create or replace function _college_season(p_now timestamptz default now()) returns int
  language sql stable as $$
  select extract(year from p_now at time zone 'America/New_York')::int
       - case when extract(month from p_now at time zone 'America/New_York') < 8 then 1 else 0 end
$$;

-- p_rows: [{name, pos, school, rank, value}] — replaces the board.
create or replace function set_college_ktc(p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare matched int; total int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 20 then
    -- a short or broken read must not wipe the board
    return jsonb_build_object('ok', false, 'error', 'too few rows');
  end if;
  total := jsonb_array_length(p_rows);
  delete from college_ktc;
  insert into college_ktc (espn_id, ktc_rank, value, name, as_of)
  select distinct on (m.espn_id) m.espn_id, m.rk, m.val, m.name, now()
    from (
      select r.rk, r.val, r.name, cp.espn_id,
             row_number() over (partition by r.rk
               order by (upper(cp.school_abbr) = upper(r.school)) desc, cp.active desc, cp.class_year desc nulls last) as pick,
             count(*) over (partition by r.rk) as n,
             bool_or(upper(cp.school_abbr) = upper(r.school)) over (partition by r.rk) as school_hit
        from (select (e ->> 'rank')::int as rk, (e ->> 'value')::int as val, e ->> 'name' as name,
                     upper(e ->> 'pos') as pos, e ->> 'school' as school
                from jsonb_array_elements(p_rows) e
               where (e ->> 'rank') ~ '^[0-9]+$' and (e ->> 'value') ~ '^[0-9]+$') r
        join college_player cp on _college_norm(cp.full_name) = _college_norm(r.name) and cp.pos = r.pos and cp.active
    ) m
   where m.pick = 1 and (m.n = 1 or m.school_hit)   -- a name twin needs the school to decide
   order by m.espn_id, m.rk;
  get diagnostics matched = row_count;
  return jsonb_build_object('ok', true, 'rows', total, 'matched', matched);
end $$;
revoke all on function set_college_ktc(jsonb) from public, anon;
grant execute on function set_college_ktc(jsonb) to authenticated;

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
           -- KTC's weight fades over a player's first four games this season
           case when k.espn_id is null then 0
                else greatest(0, 1 - coalesce((select st.gp from college_player_stats st
                                                  where st.espn_id = coalesce(d.espn_id, k.espn_id)
                                                    and st.season = _college_season()), 0) / 4.0) end as w
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
