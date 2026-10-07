-- ═══════════════════════════════════════════════════════════════════════════
-- 0449 · THE AUTODRAFT KNOWS THE DEFAULT LINEUP TOO.
--
-- Founder, from a fresh classic league ("Bullseye Test") after an autodraft:
-- "Autodrafted a team but no RB2." The roster was the pool's rank order at
-- every pick — one RB in round 1, then receiver after receiver, six of them on
-- the bench, RB 2 empty, K and D/ST forced in the last two rounds.
--
-- THE CAUSE. The autopick's two lineup-aware steps — "the lineup before the
-- bench" (0377, via _autopick_open_spots) and the bench depth chart (0381,
-- via spotn) — both read settings_json.roster_slots, the ROSTER BUILDER's
-- spec, and only that. A classic league whose commissioner never opened the
-- builder has no spec: it plays the 0161 counts (roster_classic) or the
-- default nine (QB/RB/RB/WR/WR/TE/FLEX/K/DEF), which every screen renders
-- through leagueSlotDefs. For such a league _autopick_open_spots returned
-- NULL and spotn stayed NULL, so both steps were skipped and every pick fell
-- through to the plain rank pick with 0071's caps (QB 3, TE 3, K 1, DEF 1,
-- the rest uncapped). Receivers rank high in the pool, so a team of
-- receivers it was. Nothing about bullseye: the same happens in any classic
-- league without a builder spec.
--
-- THE FIX. One helper, _league_slot_spec, answers "what is this league's
-- lineup" with the same precedence leagueSlotDefs uses — the builder spec,
-- else a spec synthesized from the 0161 counts, else the default nine — and
-- both steps read it. A league WITH a spec is untouched (the helper returns
-- the spec as stored). league_pos_cap keeps 0071's shape for a league with
-- no spec, as before: this changes what the autopick aims for, not what a
-- league may roster.
--
-- _autopick_slug_0387's body is 0441's with the two marked reads changed;
-- _autopick_open_spots is 0383's with its first line changed.
-- ═══════════════════════════════════════════════════════════════════════════

/** The league's effective starting lineup as a builder-shaped spec:
 *  roster_slots as stored; else the 0161 counts (roster_classic) expanded
 *  in catalog order; else the default nine. Mirrors leagueSlotDefs /
 *  classicSlots in packages/core/src/engine/classic.ts — keep in step. */
create or replace function _league_slot_spec(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare s jsonb; counts jsonb; out jsonb := '[]'::jsonb; t record; n int; i int;
begin
  select settings_json into s from league where id = p_league_id;
  if jsonb_typeof(s -> 'roster_slots') = 'array' and jsonb_array_length(s -> 'roster_slots') > 0 then
    return s -> 'roster_slots';
  end if;
  counts := case when jsonb_typeof(s -> 'roster_classic') = 'object' and s -> 'roster_classic' <> '{}'::jsonb
                 then s -> 'roster_classic'
                 else '{"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DEF":1}'::jsonb end;
  for t in
    select * from (values
      ('QB',   '["QB"]'::jsonb,                  1),
      ('RB',   '["RB"]'::jsonb,                  2),
      ('WR',   '["WR"]'::jsonb,                  3),
      ('TE',   '["TE"]'::jsonb,                  4),
      ('FLEX', '["RB","WR","TE"]'::jsonb,        5),
      ('SFLX', '["QB","RB","WR","TE"]'::jsonb,   6),
      ('WRT',  '["WR","TE"]'::jsonb,             7),
      ('K',    '["K"]'::jsonb,                   8),
      ('DEF',  '["DEF"]'::jsonb,                 9),
      ('DL',   '["DL"]'::jsonb,                 10),
      ('LB',   '["LB"]'::jsonb,                 11),
      ('DB',   '["DB"]'::jsonb,                 12),
      ('IDP',  '["DL","LB","DB"]'::jsonb,       13)
    ) v(type, pos, ord) order by ord
  loop
    begin n := least(6, greatest(0, floor(coalesce((counts ->> t.type)::numeric, 0))::int)); exception when others then n := 0; end;
    for i in 1 .. n loop
      exit when jsonb_array_length(out) >= 20;
      out := out || jsonb_build_array(jsonb_build_object('pos', t.pos));
    end loop;
  end loop;
  return out;
end $$;
revoke all on function _league_slot_spec(uuid) from public, anon, authenticated;

-- ── _autopick_open_spots — 0383's body, reading the effective lineup ───────
create or replace function _autopick_open_spots(p_league_id uuid, p_roster_id int)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare slots jsonb; sp record; placed text[] := '{}'; who text; open jsonb := '[]'::jsonb;
begin
  slots := _league_slot_spec(p_league_id);   -- 0449: the spec, the counts, or the default nine
  if jsonb_typeof(slots) <> 'array' then return null; end if;
  for sp in
    select s.value as spot from jsonb_array_elements(slots) with ordinality s(value, ord)
     where exists (select 1 from jsonb_array_elements_text(s.value -> 'pos') x where x not in ('K', 'DEF'))
     order by jsonb_array_length(s.value -> 'pos'), s.ord
  loop
    select nr.slug into who from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'active'
       and not (nr.slug = any(placed))
       and _autopick_spot_fits(sp.spot, lp.pos, lp.level, lp.team, lp.exp, lp.slug)
     order by lp.rank limit 1;
    if who is not null then placed := placed || who; else open := open || jsonb_build_array(sp.spot); end if;
  end loop;
  return open;
end $$;

-- ── _autopick_slug_0387 — 0441's body, the depth chart off the effective lineup ──
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
  -- 0449: the league's EFFECTIVE lineup — the builder spec, else the 0161
  -- counts, else the default nine — never only the spec.
  select jsonb_object_agg(x.pos, x.n) into spotn from (
    select p.pos, count(*)::int as n
      from jsonb_array_elements(_league_slot_spec(p_league_id)) s(spot)
      cross join lateral jsonb_array_elements_text(s.spot -> 'pos') p(pos)
     where not _spot_takes_college_only(s.spot)
     group by p.pos) x;
  select count(*) into cspots
    from jsonb_array_elements(_league_slot_spec(p_league_id)) s(spot)
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
