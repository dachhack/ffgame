-- 0264: THE RETIRED NAME-TWIN REPAIR (v0.376.2).
--
-- Founder (screenshot, bench card "K. Walker · WR · FA · BYE"): "Walker is
-- an RB." He is — Kenneth Walker III. But Sleeper's directory also carries a
-- RETIRED Kenneth Walker (WR, no team, inactive), and buildDraftPool's ADP
-- lookup is SLUG-keyed: the twin inherited the RB's ADP through the shared
-- `kenneth-walker` slug, sailed past the no-team filter (ADP present), TIED
-- the RB's score, and stable sort let directory order pick the winner —
-- the retired WR kept the clean slug and the actual RB was disambiguated to
-- `kenneth-walker-8151` (0205). Every pool seeded from that build can hold
-- such a pair: a clean-slug row with team 'FA' that is a ghost, and a
-- `-<sleeperId>` twin that is the real player. Rosters that drafted the
-- clean slug show WR · FA and a permanent BYE.
--
-- The CLIENT fix (same version) stops making these: inactive directory
-- players never enter a pool, and score ties break by search_rank before
-- slug order. This migration repairs the pools that already exist:
--
--   For every league_pool pair (junk, twin) where
--     junk.team ∈ ('', 'FA')  and  twin.slug = junk.slug || '-' || twin.sleeper_id
--     and twin.team is real,
--   and the twin row is completely UNTOUCHED by play (never rostered, never
--   in the draft log, never sealed in a pick — someone who deliberately
--   drafted the twin row must not have their player silently reassigned),
--   the twin's identity (name, pos, team, ids, tenure) moves onto the clean
--   slug — the slug rosters and picks already reference — and the twin row
--   is deleted. Affected leagues are rematerialized so still-scheduled
--   weeks' pools show the fixed identity immediately.
--
-- Shipped as a FUNCTION plus one call: the probes exercise it on fixtures,
-- and an admin can re-run it any time (it is idempotent — a repaired pair no
-- longer matches the pattern). It deliberately repairs only pairs, where
-- the twin's identity is knowable in SQL; a ghost row with no twin cannot
-- name its real player from here and stays for manual surgery.

create or replace function repair_pool_fa_twins()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; fixed int := 0; skipped int := 0; lids uuid[] := '{}'; lid uuid;
begin
  -- Superuser/service maintenance path (auth.uid() is null there); a signed-in
  -- caller must be a super admin.
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  for c in
    select j.league_id, j.slug as jslug, t.slug as tslug,
           t.full_name, t.pos, t.team, t.espn_id, t.exp, t.sleeper_id
    from league_pool j
    join league_pool t
      on t.league_id = j.league_id
     and t.sleeper_id is not null
     and t.slug = j.slug || '-' || t.sleeper_id
    where coalesce(j.team, '') in ('', 'FA')
      and coalesce(t.team, '') not in ('', 'FA')
  loop
    if exists (select 1 from native_roster nr where nr.league_id = c.league_id and nr.slug = c.tslug)
       or exists (select 1 from draft_pick dp where dp.league_id = c.league_id and dp.slug = c.tslug)
       or exists (select 1 from sealed_pick sp join matchup m on m.id = sp.matchup_id
                  where m.league_id = c.league_id and sp.player_slug = c.tslug) then
      skipped := skipped + 1; continue;
    end if;
    -- Twin first (frees its sleeper_id under the partial unique), then the
    -- clean row takes the real identity. Rank stays the junk row's — that is
    -- the board position the ADP priced.
    delete from league_pool where league_id = c.league_id and slug = c.tslug;
    update league_pool
       set full_name = c.full_name, pos = c.pos, team = c.team,
           espn_id = c.espn_id, exp = c.exp, sleeper_id = c.sleeper_id
     where league_id = c.league_id and slug = c.jslug;
    fixed := fixed + 1;
    if not (c.league_id = any(lids)) then lids := lids || c.league_id; end if;
  end loop;

  -- Still-scheduled weeks re-pool from the fixed rows right away; locked and
  -- played weeks stay frozen, as always (0064).
  foreach lid in array lids loop
    perform native_materialize(lid);
  end loop;

  return jsonb_build_object('ok', true, 'fixed', fixed, 'skipped', skipped,
    'leagues', coalesce(array_length(lids, 1), 0));
end $$;

grant execute on function repair_pool_fa_twins() to authenticated;

-- The one-shot backfill over today's data.
do $$
declare r jsonb;
begin
  r := repair_pool_fa_twins();
  raise notice 'repair_pool_fa_twins: %', r;
end $$;
