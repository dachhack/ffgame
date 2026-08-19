-- 0195: A LEAGUE WITH NO KICKER SPOT SHOULDN'T DRAFT A KICKER.
--
-- Founder: "my auto draft drafted kickers and a def but there were no roster
-- spots for k or def."
--
-- Reproduced exactly, and the cause is a DEFAULT that predates classic leagues.
-- `league_pos_cap` falls back to QB 3 / TE 3 / K 1 / DEF 1 when a league has set
-- no explicit limits — the drip game's shape, from 0071, when every league was
-- a drip league and every drip lineup had a kicker and a defense in it.
--
-- A CLASSIC league says what it plays in its LINEUP SPEC: a list of starting
-- spots, each with the positions that may fill it. If no spot in that list
-- accepts a K, the league cannot start one, and "at most one kicker" is not a
-- sensible default for it — ZERO is. So the default now READS THE SPEC rather
-- than guessing: a position no starting spot accepts defaults to 0, everything
-- the spec does accept defaults to uncapped, and an explicit `pos_caps` blob
-- still wins over both. Drip leagues are untouched — they have no spec to read,
-- and their lineup genuinely has a K and a D/ST in it.
--
-- Two holes in the same wall go with it:
--
--   • THE AUTOPICK'S LAST RESORT ignored caps entirely ("caps exhausted the
--     board — take the best free player outright"). Zero is not a small limit,
--     it is a ban, and a fallback that ignores it hands out exactly the player
--     the league said it does not roster.
--
--   • THE QUEUE was a way round the limits: `native_exec_pick` skips the cap
--     check for AUTO picks on purpose (a hard failure mid-tick would freeze the
--     room), so a queued kicker in a league that rosters none went straight
--     through. The queue now passes over anyone the seat may not legally hold —
--     a wishlist is not a rule change, and the next name down is what the
--     manager wanted next anyway.
--
-- And while re-issuing the autopick: its capped query had no branch for the
-- ENABLED EXTRAS (IDP / FB / HC / P, 0171), so an IDP league could only reach a
-- defender through the last resort, which sorts by rank alone and knows nothing
-- about balance. Extras are uncapped by construction — the caps blob only ever
-- names the six base positions — so they get a branch of their own.

-- ─────────────────────────────────────────────────────────────────────────────
-- league_pos_cap v2 — the default reads the league's own lineup
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function league_pos_cap(p_league_id uuid, p_pos text) returns int
  language sql stable security definer set search_path = public as $$
  select case
    -- An explicit blob is the commissioner's word, including an explicit 0.
    when jsonb_typeof(s.caps -> p_pos) = 'number' then (s.caps ->> p_pos)::int
    when s.caps is not null then null
    -- CLASSIC with a builder spec: the spec decides. A position no starting
    -- spot accepts cannot be started, so the league does not roster it.
    when s.mode = 'classic' and jsonb_typeof(s.slots) = 'array' then
      case when exists (
        select 1 from jsonb_array_elements(s.slots) sp
         where sp -> 'pos' @> to_jsonb(p_pos)
      ) then null else 0 end
    -- Drip, or a classic league that never touched the builder: 0071's shape.
    else case p_pos when 'QB' then 3 when 'TE' then 3 when 'K' then 1 when 'DEF' then 1 else null end
  end
  from (select settings_json -> 'pos_caps' as caps,
               settings_json -> 'roster_slots' as slots,
               coalesce(settings_json ->> 'game_mode', 'drip') as mode
          from league where id = p_league_id) s;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- native_autopick_slug — 0071's body: a zero cap is a ban, and extras exist
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int := league_pos_cap(p_league_id, 'QB'); cap_rb int := league_pos_cap(p_league_id, 'RB');
  cap_wr int := league_pos_cap(p_league_id, 'WR'); cap_te int := league_pos_cap(p_league_id, 'TE');
  cap_k  int := league_pos_cap(p_league_id, 'K');  cap_def int := league_pos_cap(p_league_id, 'DEF');
  remaining int; need_k boolean; need_def boolean; forced int; pick text;
begin
  select count(*) filter (where lp.pos = 'QB'), count(*) filter (where lp.pos = 'RB'),
         count(*) filter (where lp.pos = 'WR'), count(*) filter (where lp.pos = 'TE'),
         count(*) filter (where lp.pos = 'K'),  count(*) filter (where lp.pos = 'DEF'),
         count(*)
    into qb_n, rb_n, wr_n, te_n, k_n, def_n, total
  from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id;

  remaining := p_rounds - total;
  need_k   := k_n = 0 and coalesce(cap_k, 1) >= 1;
  need_def := def_n = 0 and coalesce(cap_def, 1) >= 1;
  forced := (case when need_k then 1 else 0 end) + (case when need_def then 1 else 0 end);

  if remaining <= forced and forced > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and lp.pos = (case when need_k then 'K' else 'DEF' end)
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
      and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    and (   (lp.pos = 'QB'  and (cap_qb  is null or qb_n  < cap_qb))
         or (lp.pos = 'RB'  and (cap_rb  is null or rb_n  < cap_rb))
         or (lp.pos = 'WR'  and (cap_wr  is null or wr_n  < cap_wr))
         or (lp.pos = 'TE'  and (cap_te  is null or te_n  < cap_te))
         or (lp.pos = 'K'   and (cap_k   is null or k_n   < cap_k))
         or (lp.pos = 'DEF' and (cap_def is null or def_n < cap_def))
         -- The enabled extras (IDP / FB / HC / P, 0171) had no branch here at
         -- all, so an IDP league's autopick could only reach them by falling
         -- through to the last resort. Caps only ever name the six above, so
         -- an extra is uncapped by construction.
         or lp.pos not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF'))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board (tiny pools) — take the best free player outright,
  -- EXCEPT where a cap is ZERO. 0195: zero is not a small limit, it is a ban —
  -- "this league does not roster kickers" — and a fallback that ignores it is
  -- how a league with no K spot ended up with a drafted kicker.
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
  order by lp.rank limit 1;
  return pick;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- native_queue_pick — 0070's body: the queue can't outrank the league's limits
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function native_queue_pick(p_league_id uuid, p_roster_id int)
  returns text language plpgsql security definer set search_path = public as $$
declare pick text;
begin
  delete from draft_queue q where q.league_id = p_league_id and q.roster_id = p_roster_id
    and exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = q.slug);
  select q.slug into pick from draft_queue q
    where q.league_id = p_league_id and q.roster_id = p_roster_id
      and not exists (select 1 from auction_lot al where al.league_id = p_league_id and al.slug = q.slug)
      -- AND THE SEAT MAY ACTUALLY HOLD HIM (0195). An auto pick skips the cap
      -- check in native_exec_pick on purpose — a hard failure mid-tick would
      -- freeze the room — which left the QUEUE as a way round the league's own
      -- limits: a queued kicker in a league that rosters none went through.
      -- Passing over him is the right answer: the queue is a wishlist, not a
      -- rule change, and the next name down is what the manager wanted next.
      and pos_cap_error(p_league_id, p_roster_id, q.slug) is null
    order by q.pos limit 1;
  return pick;
end $$;
