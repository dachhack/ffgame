-- ═══════════════════════════════════════════════════════════════════════════
-- 0405 · FCS ROSTERS, FOR THE DEVY MARKET.
--
-- Founder: "yes add FCS rosters". StatHead's devy board ranks ~3,800 players
-- at FCS schools (Samford, Alabama A&M…) that college_player never held — the
-- sweep read FBS rosters only (ESPN group 80) — so they could not be found or
-- bought. The sweep now reads FCS (group 81, 130 schools) too.
--
-- FCS players are a DEVY MARKET thing only. college_player.division marks
-- them, and college_directory — what seeds devy-spot and college pools, what
-- the college projections and the stats half of a devy price read — keeps to
-- FBS, so nothing about those changes. An FCS player is priced from
-- StatHead's board alone, or at the 1-point floor.
-- ═══════════════════════════════════════════════════════════════════════════

alter table college_player add column if not exists division text not null default 'FBS';
alter table college_player drop constraint if exists college_player_division_check;
alter table college_player add constraint college_player_division_check check (division in ('FBS', 'FCS'));

-- ── upsert_college_players — 0365's body, plus the division ──
create or replace function upsert_college_players(p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  insert into college_player (espn_id, full_name, pos, espn_pos, school_id, school, school_abbr,
                              class_year, class_label, jersey, active, division, seen_at, updated_at)
  select r ->> 'espn_id', btrim(r ->> 'full_name'), r ->> 'pos', nullif(r ->> 'espn_pos', ''),
         nullif(r ->> 'school_id', ''), nullif(r ->> 'school', ''), nullif(r ->> 'school_abbr', ''),
         case when coalesce(r ->> 'class_year', '') ~ '^\d{1,2}$' then (r ->> 'class_year')::int end,
         nullif(r ->> 'class_label', ''), nullif(r ->> 'jersey', ''),
         coalesce((r ->> 'active')::boolean, true),
         case when r ->> 'division' = 'FCS' then 'FCS' else 'FBS' end, now(), now()
    from jsonb_array_elements(p_rows) r
   where coalesce(r ->> 'espn_id', '') ~ '^\d+$'
     and nullif(btrim(coalesce(r ->> 'full_name', '')), '') is not null
     and coalesce(r ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'P', 'FB', 'DL', 'LB', 'DB')
  on conflict (espn_id) do update
    set full_name   = excluded.full_name,
        pos         = excluded.pos,
        espn_pos    = coalesce(excluded.espn_pos, college_player.espn_pos),
        -- A transfer moves school; the new one is the truth.
        school_id   = coalesce(excluded.school_id, college_player.school_id),
        school      = coalesce(excluded.school, college_player.school),
        school_abbr = coalesce(excluded.school_abbr, college_player.school_abbr),
        class_year  = coalesce(excluded.class_year, college_player.class_year),
        class_label = coalesce(excluded.class_label, college_player.class_label),
        jersey      = coalesce(excluded.jersey, college_player.jersey),
        active      = excluded.active,
        division    = excluded.division,   -- 0405: a transfer can change division
        seen_at     = now(),
        updated_at  = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function upsert_college_players(jsonb) from public, anon, authenticated;
grant execute on function upsert_college_players(jsonb) to service_role;

-- ── college_directory — 0383's body, FBS only ──
create or replace function college_directory(p_positions text[] default array['QB','RB','WR','TE'], p_limit int default 600)
  returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select cp.espn_id, cp.full_name as full, cp.pos, cp.school_abbr, cp.class_label, cp.class_year,
           best.season, round(best.eff, 1) as gp, best.ppg, cs.conference, cs.tier
      from college_player cp
      left join lateral (select * from _college_proj(cp.espn_id)) best on true
      left join college_school cs on cs.school_id = cp.school_id
     where cp.active and cp.pos = any(p_positions)
       and cp.division = 'FBS'   -- 0405: FCS players are for the devy market only
  ), ranked as (
    select b.*, row_number() over (partition by b.pos order by b.ppg desc nulls last) as prank from base b
  ), repl as (
    select r.pos,
           coalesce(max(r.ppg) filter (where r.prank = case r.pos when 'QB' then 24 when 'RB' then 36 when 'WR' then 48 when 'TE' then 16 else 24 end),
                    min(r.ppg)) as line
      from ranked r where r.ppg is not null group by r.pos
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from (
    select r.espn_id, r.full, r.pos, r.school_abbr, r.class_label, r.class_year, r.season, r.gp, r.conference, r.tier,
           round(r.ppg, 1) as ppg, round(r.ppg - p.line, 1) as vor,
           row_number() over (order by (r.ppg - p.line) desc nulls last, r.class_year desc nulls last, r.full) as ord
      from ranked r left join repl p on p.pos = r.pos
     order by ord
     limit least(greatest(coalesce(p_limit, 600), 1), 2000)
  ) t
$$;
grant execute on function college_directory(text[], int) to authenticated;

-- ── devy_market — 0404's body, plus whether he is FCS ──
create or replace function devy_market(p_league_id uuid, p_limit int default 1000, p_query text default null)
  returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as needle)
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'slug', 'c-' || t.espn_id, 'name', t.full_name, 'pos', t.pos, 'school', t.school_abbr,
        'class_year', t.class_year, 'fcs', t.division = 'FCS', 'rank', t.rank, 'sh_rank', t.sh_rank, 'youth', coalesce(t.youth = 1, false),
        'price', _devy_price(null, 'c-' || t.espn_id)) order by t.ord)
      from (
        select cp.espn_id, cp.full_name, cp.pos, cp.school_abbr, cp.class_year, cp.division, p.rank, p.youth, s.rank_1qb as sh_rank,
               row_number() over (order by p.rank nulls last, s.rank_1qb nulls last, cp.full_name) as ord
          from college_player cp
          left join college_price p on p.espn_id = cp.espn_id
          left join stathead_devy s on s.espn_id = cp.espn_id
         where cp.active and cp.pos in ('QB', 'RB', 'WR', 'TE')
           and ((select needle from q) is null
                or cp.full_name ilike '%' || (select needle from q) || '%'
                or cp.school_abbr ilike (select needle from q) || '%'
                or cp.school ilike '%' || (select needle from q) || '%')
         order by ord
         limit least(greatest(coalesce(p_limit, 1000), 1), 5000)) t), '[]'::jsonb)
  end
$$;
grant execute on function devy_market(uuid, int, text) to authenticated;
