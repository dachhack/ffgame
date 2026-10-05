-- ═══════════════════════════════════════════════════════════════════════════
-- 0441 · THE AUTODRAFT IN A MIXED LEAGUE: K AND D/ST ARRIVE, COLLEGE GOES TWO DEEP.
--
-- Founder, from a mixed league's autodrafted roster: "Auto draft only
-- picked one college player per spot and didn't get K or DST."
--
--   · K AND D/ST. 0195 fills the kicker and defense in the LAST rounds, when
--     the picks left equal the spots still forced. 0193 made IR and OUT
--     spots part of the roster size (draft.rounds) that the draft never
--     fills (draft.stash_slots) — and the autopick kept counting its picks
--     left against the full rounds. In a league with IR spots the count
--     never fell to the forced two, the last picks went to bench depth, and
--     the K and D/ST spots drafted empty. The picks left are now
--     rounds − stash − held.
--   · COLLEGE DEPTH. 0381's bench rule takes a position two deep per
--     starting spot that takes it, and counted a college-only spot as NFL
--     depth (an RB/WR/TE college spot made the RB target two deeper while
--     no college player was ever a depth pick: college rows rank after every
--     NFL row, so the rank picks never reached one). A college-only spot
--     (a level, a conference or a class rule) now counts toward COLLEGE
--     depth — two college players per college spot, taken after the NFL
--     bench depth and before the rank picks — and not toward NFL depth.
-- _autopick_slug_0387's body from 0440 with the marked changes;
-- native_autopick_slug (0411's devy-round wrapper) is untouched.
-- Not confirmed against the founder's league from this session (no
-- database access); the mechanism is 0193's and the probes pin it.
-- ═══════════════════════════════════════════════════════════════════════════

-- A starting spot only a college player can fill.
create or replace function _spot_takes_college_only(p_spot jsonb) returns boolean
  language sql immutable as $$
  select coalesce(p_spot ->> 'level', '') = 'college'
      or coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'confs') = 'array' then p_spot -> 'confs' end), 0) > 0
      or coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'classes') = 'array' then p_spot -> 'classes' end), 0) > 0
$$;
revoke all on function _spot_takes_college_only(jsonb) from public, anon, authenticated;

-- ── _autopick_slug_0387 — 0440's body, the picks left and the college depth ──
create or replace function _autopick_slug_0387(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  dv int := _devy_slots(p_league_id);
  mixed boolean := league_is_mixed(p_league_id);   -- 0440
  -- 0441: the IR/OUT spots the draft never fills (0193), and the college
  -- starting spots' own depth.
  stash int := coalesce((select d.stash_slots from draft d where d.league_id = p_league_id), 0);
  cspots int := 0; college_held int := 0;
  taken text[];
  held jsonb; caps jsonb; spotn jsonb;
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int; cap_rb int; cap_wr int; cap_te int; cap_k int; cap_def int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text; open jsonb;
begin
  -- Asked once per pick, not once per pool row (0380).
  taken := array(select nr.slug from native_roster nr where nr.league_id = p_league_id
                 union all select al.slug from auction_lot al where al.league_id = p_league_id);
  -- 0387: DEVY SHARES. A seat whose picks left equal its untaken
  -- reservations takes the best of them; nobody takes another's.
  if _devy_shares_on(p_league_id) then
    if _devy_pick_forced(p_league_id, p_roster_id) then
      select r.slug into pick from devy_reserved(p_league_id) r
        join league_pool lp on lp.league_id = p_league_id and lp.slug = r.slug
       where r.roster_id = p_roster_id order by lp.rank limit 1;
      if pick is not null then return pick; end if;
    end if;
    taken := taken || array(select r.slug from devy_reserved(p_league_id) r where r.roster_id <> p_roster_id);
  end if;
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
  -- 0441: a college-only spot (a level, a conference or a class rule) is not
  -- NFL depth — it counts toward the college depth below instead.
  select jsonb_object_agg(x.pos, x.n) into spotn from (
    select p.pos, count(*)::int as n
      from jsonb_array_elements(coalesce((select settings_json -> 'roster_slots' from league where id = p_league_id), '[]'::jsonb)) s(spot)
      cross join lateral jsonb_array_elements_text(s.spot -> 'pos') p(pos)
     where not _spot_takes_college_only(s.spot)
     group by p.pos) x;
  select count(*) into cspots
    from jsonb_array_elements(coalesce((select settings_json -> 'roster_slots' from league where id = p_league_id), '[]'::jsonb)) s(spot)
   where _spot_takes_college_only(s.spot);
  select count(*) into college_held from native_roster nr
   where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.slug ~ '^c-[0-9]+$' and nr.spot <> 'devy';

  -- 0441: the picks LEFT are the rounds the draft fills — not the IR/OUT
  -- stash it never does (0193). Counted against the full roster size, a
  -- league with IR spots never reached the last-rounds K/DEF fill below.
  remaining := p_rounds - stash - total - dv;
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
      -- 0440: in a mixed league a college player may fill an open COLLEGE
      -- starting spot now (college rows rank after every NFL row, so he is
      -- taken only when no NFL player fits what is open); the bench and the
      -- rank picks below stay NFL, and the devy shelf fills last as before.
      and (dv = 0 or lp.level = 'nfl' or mixed)
      and coalesce((caps ->> lp.pos)::int, 1000) > coalesce((held ->> lp.pos)::int, 0)
      and exists (select 1 from jsonb_array_elements(open) o where _autopick_spot_fits(o.value, lp.pos, lp.level, lp.team, lp.exp, lp.slug))
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

  -- 0441: COLLEGE DEPTH. In a mixed league a college starting spot earns
  -- the two-deep the NFL positions get (0381); without this the autodraft
  -- took exactly one college player per spot and never another — college
  -- rows rank after every NFL row, so no rank pick ever reached one.
  if mixed and cspots > 0 and college_held < 2 * cspots then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id and lp.level = 'college' and not (lp.slug = any(taken))
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
