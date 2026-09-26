-- ═══════════════════════════════════════════════════════════════════════════
-- 0369 · COLLEGE PLAYERS, PHASE 2d — A RANKING WITHOUT PROJECTIONS.
--
-- There is no college projection feed (Stathead has none), so a devy pool is
-- ranked by what the player has done. ESPN publishes every FBS player's season
-- line keyed by the same athlete id college_player uses (0365) — the
-- `statistics/byathlete` endpoint, 2,936 offensive players for 2025 — so the
-- worker stores those lines and nothing is matched by name.
--
-- THE NUMBER. college_directory() scores each line in standard PPR (pass yd
-- 0.04, pass TD 4, INT −2, rush/rec yd 0.1, rush/rec TD 6, reception 1) per
-- game played, from the most recent season with at least 4 games; a player
-- with no such season (most freshmen) ranks after everyone who has one, by
-- class year. It is a ranking, labelled as an estimate on screen — not a
-- projection, and not the league's own scoring.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists college_player_stats (
  espn_id    text not null,
  season     int  not null,
  gp         int,
  pass_yds   int, pass_td int, ints int,
  rush_yds   int, rush_td int,
  rec        int, rec_yds int, rec_td int,
  updated_at timestamptz not null default now(),
  primary key (espn_id, season)
);
alter table college_player_stats enable row level security;
drop policy if exists college_player_stats_read on college_player_stats;
create policy college_player_stats_read on college_player_stats for select using (auth.uid() is not null);

create or replace function upsert_college_stats(p_season int, p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_season is null or jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a season and a list of rows');
  end if;
  insert into college_player_stats (espn_id, season, gp, pass_yds, pass_td, ints, rush_yds, rush_td,
                                    rec, rec_yds, rec_td, updated_at)
  select r ->> 'espn_id', p_season,
         (r ->> 'gp')::int, (r ->> 'pass_yds')::int, (r ->> 'pass_td')::int, (r ->> 'ints')::int,
         (r ->> 'rush_yds')::int, (r ->> 'rush_td')::int,
         (r ->> 'rec')::int, (r ->> 'rec_yds')::int, (r ->> 'rec_td')::int, now()
    from jsonb_array_elements(p_rows) r
   where coalesce(r ->> 'espn_id', '') ~ '^\d+$'
  on conflict (espn_id, season) do update
    set gp = excluded.gp, pass_yds = excluded.pass_yds, pass_td = excluded.pass_td, ints = excluded.ints,
        rush_yds = excluded.rush_yds, rush_td = excluded.rush_td, rec = excluded.rec,
        rec_yds = excluded.rec_yds, rec_td = excluded.rec_td, updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function upsert_college_stats(int, jsonb) from public, anon, authenticated;
grant execute on function upsert_college_stats(int, jsonb) to service_role;

create or replace function _college_ppr(s college_player_stats) returns numeric
  language sql immutable as $$
  select coalesce(s.pass_yds, 0) * 0.04 + coalesce(s.pass_td, 0) * 4 - coalesce(s.ints, 0) * 2
       + coalesce(s.rush_yds, 0) * 0.1 + coalesce(s.rush_td, 0) * 6
       + coalesce(s.rec, 0) + coalesce(s.rec_yds, 0) * 0.1 + coalesce(s.rec_td, 0) * 6
$$;

-- Active college players at the given positions, best first, for a pool seed.
create or replace function college_directory(p_positions text[] default array['QB','RB','WR','TE'], p_limit int default 600)
  returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from (
    select cp.espn_id, cp.full_name as full, cp.pos, cp.school_abbr, cp.class_label, cp.class_year,
           best.season, best.gp, round(best.ppg, 1) as ppg,
           row_number() over (order by best.ppg desc nulls last, cp.class_year desc nulls last, cp.full_name) as ord
      from college_player cp
      left join lateral (
        select s.season, s.gp, _college_ppr(s) / nullif(s.gp, 0) as ppg
          from college_player_stats s
         where s.espn_id = cp.espn_id and coalesce(s.gp, 0) >= 4
         order by s.season desc limit 1) best on true
     where cp.active and cp.pos = any(p_positions)
     order by ord
     limit least(greatest(coalesce(p_limit, 600), 1), 2000)
  ) t
$$;
grant execute on function college_directory(text[], int) to authenticated;
