-- 0265: THE POOL DOCTOR'S PEN (v0.376.3).
--
-- 0264 repaired ghost/twin PAIRS — and production reported {fixed: 0},
-- which was the tell: the real damage has no twin. buildDraftPool never ran
-- 0205's disambiguation on the directory path (only the baked fallback did),
-- so a retired name-twin and the active player reached seed_league_pool
-- under ONE slug and `on conflict do nothing` silently dropped whichever
-- sorted second. The founder's "K. Walker · WR · FA" is a lone ghost row:
-- the retired WR's identity squatting on the slug a manager drafted, with
-- the actual RB nowhere in the pool at all.
--
-- Who is retired is a fact only the player DIRECTORY knows, and the
-- directory lives client-side (15MB, IndexedDB) — so diagnosis is the
-- client's (diagnosePoolGhosts in @drip/core nativeLeague.ts) and this
-- migration ships only the pen: a commissioner RPC that rewrites ONE pool
-- row's identity in place. The slug — the key rosters, picks and the draft
-- log already reference — never changes; the person behind it does. Weekly
-- pools rematerialize so the fix shows immediately.
--
-- Guards worth their lines:
--   • commissioner/admin, native league, row must exist, position whitelist
--     (seed_league_pool's, 0205);
--   • if the NEW sleeper_id already sits on a different row (the live twin
--     also made the pool), that row is absorbed — deleted — but only when
--     nothing references it (roster / draft log / sealed picks); otherwise
--     the repair refuses and names the row, because reassigning a player
--     someone deliberately drafted is a trade, not a repair.

create or replace function commish_repair_pool_row(
  p_league_id uuid, p_slug text, p_full text, p_pos text,
  p_team text, p_espn_id text default null, p_exp int default null,
  p_sleeper_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare sid text; dup record;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if not exists (select 1 from league_pool where league_id = p_league_id and slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'no such pool player');
  end if;
  if coalesce(btrim(p_full), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'name required');
  end if;
  if coalesce(p_pos, '') not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P') then
    return jsonb_build_object('ok', false, 'error', 'bad position');
  end if;
  sid := nullif(btrim(coalesce(p_sleeper_id, '')), '');

  perform pg_advisory_xact_lock(hashtext(p_league_id::text));

  if sid is not null then
    select * into dup from league_pool
      where league_id = p_league_id and sleeper_id = sid and slug <> p_slug;
    if found then
      if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = dup.slug)
         or exists (select 1 from draft_pick dp where dp.league_id = p_league_id and dp.slug = dup.slug)
         or exists (select 1 from sealed_pick sp join matchup m on m.id = sp.matchup_id
                    where m.league_id = p_league_id and sp.player_slug = dup.slug) then
        return jsonb_build_object('ok', false,
          'error', 'that player is already in the pool as ' || dup.slug || ' and is in use there');
      end if;
      delete from league_pool where league_id = p_league_id and slug = dup.slug;
    end if;
  end if;

  update league_pool
     set full_name = btrim(p_full), pos = p_pos, team = coalesce(p_team, ''),
         espn_id = nullif(btrim(coalesce(p_espn_id, '')), ''),
         exp = case when p_exp is not null and p_exp between 0 and 30 then p_exp end,
         sleeper_id = sid
   where league_id = p_league_id and slug = p_slug;

  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'slug', p_slug, 'pos', p_pos, 'team', coalesce(p_team, ''));
end $$;

grant execute on function commish_repair_pool_row(uuid, text, text, text, text, text, int, text) to authenticated;
