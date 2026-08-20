-- 0205: A PLAYER IS AN ID, NOT A NAME.
--
-- Founder: "let's do the identity work. I'm a big fan of using keys."
--
-- ── THE BUG, WHICH IS ALREADY LIVE ─────────────────────────────────────────
-- `league_pool`'s primary key is `(league_id, slug)`, and the slug is a
-- normalised full name — `normName(full).replace(/\s+/g, '-')`, which also
-- strips generational suffixes (jr/sr/ii/iii/iv/v). So two different active
-- players with the same name are ONE ROW to us, and the second one loses.
--
-- This is not hypothetical. In StatHead's 747 defenders, three pairs collide:
--
--   byron-young   Byron Young  LB  LA   (81.2 projected pts)
--                 Byron Young  DL  PHI  (36.0)
--   byron-murphy  Byron Murphy    DB  MIN
--                 Byron Murphy II DL  SEA   ← the suffix strip does this one
--   jaylon-jones  Jaylon Jones DB IND
--                 Jaylon Jones DB CHI
--
-- And the loser is DROPPED, twice over: `nativeLeague.ts` keeps whichever
-- scores better (`best.set(slug, …)`) and `seed_league_pool` finishes the job
-- with `on conflict (league_id, slug) do nothing`. A commissioner running an
-- IDP league simply cannot roster both Byron Youngs, and nothing tells them
-- why.
--
-- ── WHAT THIS MIGRATION DOES, AND DELIBERATELY DOES NOT ────────────────────
-- `slug` STAYS the storage key. It is embedded in a dozen tables —
-- native_roster, sealed_pick, draft_pick, trade, waiver_claim, player_flag,
-- favorite, league_register and more — plus every baked lookup we own
-- (PLAYER_BIO, ADP_2026, PROJ_2026). Re-keying that three weeks before the
-- first lock would be reckless, and it would buy nothing the column below does
-- not.
--
-- Instead `sleeper_id` arrives as the STABLE IDENTITY the bakes can join on:
--   • nullable, because team pseudo-players (`den-k`, `den-dst`, `den-hc`,
--     `den-p`) have no Sleeper id and never will;
--   • UNIQUE per league where present, so the same person cannot occupy two
--     rows in one pool — the mirror of the problem it fixes;
--   • indexed, because the join is per-render on a draft board.
--
-- The clients then disambiguate a colliding SLUG at pool-build time so both
-- players survive, and carry the id so a projection can be found for the one
-- whose slug had to change. That half lives in `nativeLeague.ts`; this half
-- just makes the key exist, persist and be served.
--
-- ── WHY NOT ESPN'S ID, WHICH WE ALREADY STORE ──────────────────────────────
-- `espn_id` is already on this table, and it is the wrong key for this job: it
-- is present only for players ESPN has indexed (it exists to fetch headshots),
-- it is absent for fresh rookies, and nothing we bake is keyed by it. Every
-- projection artifact we consume — StatHead's and Sleeper's alike — ships
-- `sleeper_id`, and our own pool is built from Sleeper's player directory. The
-- key that matches the data is the one to store.

alter table league_pool add column if not exists sleeper_id text;

comment on column league_pool.sleeper_id is
  'Sleeper player id (0205) — the STABLE identity a projection bake joins on. Null for team pseudo-players (k/dst/hc/p), which have no Sleeper row. Unique per league where present.';

-- The same person twice in one pool is the mirror of the bug this fixes, so it
-- is refused rather than merely discouraged. Partial, because null is the
-- normal state for every team unit.
create unique index if not exists league_pool_sleeper_uniq
  on league_pool(league_id, sleeper_id) where sleeper_id is not null;

/** Seed a native league's draft pool (0172/0182 + 0205's id).
 *
 *  The only change from 0182 is `sleeper_id`, carried through from the players
 *  array and stored where present. Everything else — the permission check, the
 *  native-league gate, the draft-started gate, the 2000 cap, the position
 *  whitelist, and the delete that spares anyone already rostered — is
 *  0182's, unchanged, because a pool re-seed is a destructive operation and
 *  this migration is not the place to alter what it destroys. */
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'players must be an array');
  end if;
  if jsonb_array_length(p_players) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large (max 2000)');
  end if;

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr
                    where nr.league_id = lp.league_id and nr.slug = lp.slug);
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
         nullif(btrim(coalesce(p ->> 'espn_id', '')), ''),
         case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
              then least(30, greatest(0, (p ->> 'exp')::int)) end,
         -- Blank becomes NULL rather than '': the unique index is partial, and
         -- a pool full of empty strings would collide with itself on the first
         -- two team units.
         nullif(btrim(coalesce(p ->> 'sleeper_id', '')), '')
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

grant execute on function seed_league_pool(uuid, jsonb) to authenticated;

/** Slug → Sleeper id for one league's pool, for the client's join.
 *
 *  A map rather than a column on every read: the boards already fetch the pool
 *  for names and positions, and only the PROJECTION path needs the id. Members
 *  only — it is the same pool they can already see, and this exposes no fact a
 *  pool row does not. */
create or replace function league_pool_ids(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'ids', coalesce(
    (select jsonb_object_agg(slug, sleeper_id) from league_pool
     where league_id = p_league_id and sleeper_id is not null), '{}'::jsonb));
end $$;

grant execute on function league_pool_ids(uuid) to authenticated;
