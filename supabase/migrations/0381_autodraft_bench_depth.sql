-- ═══════════════════════════════════════════════════════════════════════════
-- 0381 · AUTODRAFT BUILDS A BENCH, AND COLLEGE RANKS BY VALUE.
--
-- Founder, over an all-autodraft college draft: "auto draft filled in all
-- QBs on bench." Two causes:
--   • college_directory (0379) ranked by PPR per game, and a college QB's
--     passing makes that the biggest number on the board — so once the
--     lineup was full, every bench pick by rank was a quarterback;
--   • a builder league caps no position its lineup starts (0195), so nothing
--     stopped the fourth, fifth and sixth QB.
--
-- ── RANK BY VALUE OVER REPLACEMENT ────────────────────────────────────────
-- college_directory orders by ppg minus the ppg of a typical last starter at
-- the position (the 24th QB, 36th RB, 48th WR, 16th TE, 24th otherwise — or
-- the position's lowest when fewer have a line). A QB ranks high only when
-- he beats other QBs by more than a back beats other backs. `vor` rides along
-- in the row. Pools seeded from now on use it (a pool refresh re-seeds).
--
-- ── A BENCH WITH DEPTH ────────────────────────────────────────────────────
-- native_autopick_slug (0380's body) gains one step between the lineup fill
-- and the free rank pick: while a position is below TWICE the starting spots
-- that accept it (one QB spot → two QBs; two RB spots and a flex → six RBs),
-- take the best-ranked such player. Only when every position has its depth
-- does the plain rank pick run. Kickers and defenses keep 0195's last-round
-- rule. Leagues without a lineup spec are unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function college_directory(p_positions text[] default array['QB','RB','WR','TE'], p_limit int default 600)
  returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select cp.espn_id, cp.full_name as full, cp.pos, cp.school_abbr, cp.class_label, cp.class_year,
           best.season, round(best.eff, 1) as gp, best.ppg
      from college_player cp
      left join lateral (select * from _college_proj(cp.espn_id)) best on true
     where cp.active and cp.pos = any(p_positions)
  ), ranked as (
    select b.*, row_number() over (partition by b.pos order by b.ppg desc nulls last) as prank from base b
  ), repl as (
    select r.pos,
           coalesce(max(r.ppg) filter (where r.prank = case r.pos when 'QB' then 24 when 'RB' then 36 when 'WR' then 48 when 'TE' then 16 else 24 end),
                    min(r.ppg)) as line
      from ranked r where r.ppg is not null group by r.pos
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from (
    select r.espn_id, r.full, r.pos, r.school_abbr, r.class_label, r.class_year, r.season, r.gp,
           round(r.ppg, 1) as ppg, round(r.ppg - p.line, 1) as vor,
           row_number() over (order by (r.ppg - p.line) desc nulls last, r.class_year desc nulls last, r.full) as ord
      from ranked r left join repl p on p.pos = r.pos
     order by ord
     limit least(greatest(coalesce(p_limit, 600), 1), 2000)
  ) t
$$;
grant execute on function college_directory(text[], int) to authenticated;

-- ── native_autopick_slug — 0380's body, plus the bench-depth step ──
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  dv int := _devy_slots(p_league_id);
  taken text[];
  held jsonb; caps jsonb; spotn jsonb;
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int; cap_rb int; cap_wr int; cap_te int; cap_k int; cap_def int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text; open jsonb;
begin
  -- Asked once per pick, not once per pool row (0380).
  taken := array(select nr.slug from native_roster nr where nr.league_id = p_league_id
                 union all select al.slug from auction_lot al where al.league_id = p_league_id);
  select coalesce(jsonb_object_agg(p.pos, league_pos_cap(p_league_id, p.pos)), '{}'::jsonb) into caps
    from (select distinct lp.pos from league_pool lp where lp.league_id = p_league_id) p;
  select coalesce(jsonb_object_agg(h.pos, h.n), '{}'::jsonb), coalesce(sum(h.n), 0)::int into held, total from (
    select lp.pos, count(*)::int as n from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
       and (dv = 0 or nr.spot <> 'devy')
     group by lp.pos) h;
  qb_n := coalesce((held ->> 'QB')::int, 0); rb_n := coalesce((held ->> 'RB')::int, 0);
  wr_n := coalesce((held ->> 'WR')::int, 0); te_n := coalesce((held ->> 'TE')::int, 0);
  k_n := coalesce((held ->> 'K')::int, 0);   def_n := coalesce((held ->> 'DEF')::int, 0);
  cap_qb := league_pos_cap(p_league_id, 'QB'); cap_rb := league_pos_cap(p_league_id, 'RB');
  cap_wr := league_pos_cap(p_league_id, 'WR'); cap_te := league_pos_cap(p_league_id, 'TE');
  cap_k  := league_pos_cap(p_league_id, 'K');  cap_def := league_pos_cap(p_league_id, 'DEF');

  -- 0381: how many starting spots take each position (a builder league).
  select jsonb_object_agg(x.pos, x.n) into spotn from (
    select p.pos, count(*)::int as n
      from jsonb_array_elements(coalesce((select settings_json -> 'roster_slots' from league where id = p_league_id), '[]'::jsonb)) s(spot)
      cross join lateral jsonb_array_elements_text(s.spot -> 'pos') p(pos)
     group by p.pos) x;

  remaining := p_rounds - total - dv;
  -- 0366: the devy spots are their own shelf, filled once the NFL spots are.
  if remaining <= 0 and _devy_open(p_league_id, p_roster_id) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id and lp.level = 'college' and not (lp.slug = any(taken))
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;
  need_k   := k_n = 0 and coalesce(cap_k, 1) >= 1;
  need_def := def_n = 0 and coalesce(cap_def, 1) >= 1;
  forced := (case when need_k then 1 else 0 end) + (case when need_def then 1 else 0 end);

  if remaining <= forced and forced > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and lp.pos = (case when need_k then 'K' else 'DEF' end)
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  -- 0377: THE LINEUP BEFORE THE BENCH, within the caps.
  open := _autopick_open_spots(p_league_id, p_roster_id);
  if open is not null and jsonb_array_length(open) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
      and coalesce((caps ->> lp.pos)::int, 1000) > coalesce((held ->> lp.pos)::int, 0)
      and exists (select 1 from jsonb_array_elements(open) o where _autopick_spot_fits(o.value, lp.pos, lp.level, lp.team, lp.exp))
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  -- 0381: THE BENCH IS A DEPTH CHART, NOT A QUEUE. A position stops at twice
  -- the starting spots that take it (one QB spot → two QBs) while anything
  -- else is on the board — then the rank pick below is free again.
  if spotn is not null then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
      and coalesce((caps ->> lp.pos)::int, 1000) > coalesce((held ->> lp.pos)::int, 0)
      and (spotn ->> lp.pos) is not null
      and coalesce((held ->> lp.pos)::int, 0) < 2 * (spotn ->> lp.pos)::int
      and lp.pos not in ('K', 'DEF')
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not (lp.slug = any(taken))
    and (dv = 0 or lp.level = 'nfl')
    and (   (lp.pos = 'QB'  and (cap_qb  is null or qb_n  < cap_qb))
         or (lp.pos = 'RB'  and (cap_rb  is null or rb_n  < cap_rb))
         or (lp.pos = 'WR'  and (cap_wr  is null or wr_n  < cap_wr))
         or (lp.pos = 'TE'  and (cap_te  is null or te_n  < cap_te))
         or (lp.pos = 'K'   and (cap_k   is null or k_n   < cap_k))
         or (lp.pos = 'DEF' and (cap_def is null or def_n < cap_def))
         -- extras (IDP / FB / HC / P) are uncapped here, as before
         or lp.pos not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF'))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board — the best free player, never a banned (cap 0) position (0195).
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not (lp.slug = any(taken))
    and (dv = 0 or lp.level = 'nfl')
    and coalesce((caps ->> lp.pos)::int, 1) > 0
  order by lp.rank limit 1;
  return pick;
end $$;
