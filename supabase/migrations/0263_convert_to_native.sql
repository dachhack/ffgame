-- 0263: GO NATIVE — convert an imported league to a native one, in place.
--
-- Founder: let commissioners migrate leagues added from other platforms to
-- native leagues. Until now the two kinds only ever converged downstream —
-- both emit the four row-sets (league / league_membership / matchup /
-- sleeper_lineup) — and the answer to "my Sleeper league wants to live here"
-- was "re-import next season" (the rollover gate's own words, 0182–0220).
--
-- Converting in place keeps everything the league already is — its league_id
-- (so wallets, picks, chat, pot config and history stay attached), its seats
-- and enrollments, its schedule and its crest — and backfills the three
-- things an imported league never had:
--
--   1. a league_pool (client-seeded from buildDraftPool(), same as creation —
--      which upgrades the league from ~87–90% name-matching to the native
--      "every draftable player scores" guarantee);
--   2. native_roster rows, read out of the league's LATEST sleeper_lineup
--      snapshot. Entries match the pool by sleeper_id first (the STABLE
--      identity, 0205 — so a disambiguated slug is found), then by slug
--      (ESPN entries carry no sleeper_id); a rostered player the pool
--      doesn't know is APPENDED to it rather than dropped, because a
--      manager's roster is not ours to shrink. Only an entry with no usable
--      slug or an unsupported position is skipped, and the response names
--      every one. grp ir/taxi map onto native spots (0164), so designations
--      survive.
--   3. a draft row born 'complete' — the draft happened on the other
--      platform. Inserted AFTER the roster rows on purpose: the register
--      trigger (0186) only logs once draft.status = 'complete', so this
--      ordering keeps the conversion out of the transaction log instead of
--      spamming it with rounds × teams phantom pickups. rounds (= the
--      roster cap, the 0064 rule) is the largest converted ACTIVE roster.
--      No draft_pick rows exist — nothing requires them (the draft room
--      stays hidden once a draft is complete), keeper costs just fall back
--      to defaults if continuity is ever flipped on.
--
-- The flip itself is two writes with a lot of consequences, all wanted:
--   • provider = 'native' turns ON every native surface (admin tabs, team
--     desk, waivers/trades, playoffs, continuity, league board) and turns
--     OFF every sync path — manual sync (0204), member self-sync (0133) and
--     the drift check (0106) all test provider = 'sleeper'.
--   • sleeper_league_id is REWRITTEN to the 'native-…' namespace (the 0041
--     convention: the key says who owns the id). This is the belt to the
--     provider strap: the worker's syncWeek and cloneWeek look leagues up BY
--     this key, and importLeague upserts on (sleeper_league_id, season) — a
--     careless same-season re-import now creates a fresh imported league
--     beside this one instead of clobbering a league that went native. The
--     old key is kept in settings_json.converted_from.
--
-- settings_json surgery: an imported Sleeper league stores its mirrored
-- platform scoring blob at settings_json.scoring — the SAME key Drip's
-- set_league_scoring (0143) owns, whose readers coalesce absent knobs to
-- defaults. A platform blob there is inert but doomed: the first knob edit
-- would overwrite it. It moves to settings_json.imported_scoring; a blob
-- that already IS Drip's (the commissioner set knobs on the imported league
-- — detectable, ours carries td_bonus) stays put. teams/rounds/mode are
-- written the way create_native_league writes them.
--
-- WHAT THIS REFUSES: a league whose season is underway (any non-'scheduled'
-- matchup — same wording as native_generate_schedule; converting mid-season
-- means merging a frozen live week with a mutable roster model, and nobody
-- needs that before Sep 9), a league with no synced rosters, no
-- commissioner, or no seats. Claiming is unchanged mechanically but routed
-- differently after the flip: league_by_invite now says 'native', so the
-- invite code claims the lowest OPEN seat rather than matching a Sleeper
-- username — the response carries unclaimed_seats so the client can warn
-- the commissioner to seat everyone (or use admin-assign-by-email) first.
--
-- DRY RUN: p_dry_run performs the ENTIRE conversion inside a sub-block and
-- then raises a sentinel SQLSTATE, which the handler catches — plpgsql rolls
-- the block's writes back to its implicit savepoint and the summary the real
-- run would have returned comes back with dry_run: true. Preview and commit
-- are the same code path by construction, so they cannot drift.

create or replace function convert_league_to_native(
  p_league_id uuid, p_pool jsonb default null, p_dry_run boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg league%rowtype;
  snap_wk int; teams int; cap int; next_rank int;
  e record; tgt_slug text; sid text; sl text; spot_v text;
  matched_id int := 0; matched_slug int := 0; added int := 0; dups int := 0;
  skipped jsonb := '[]'::jsonb; skipped_n int := 0;
  pool_n int := 0; rostered int := 0; weeks int := 0; unclaimed int := 0;
  seats jsonb; sc jsonb; sj jsonb; new_key text; summary jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not has_native() then
    return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access');
  end if;

  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if lg.provider = 'native' then
    return jsonb_build_object('ok', false, 'error', 'already a native league');
  end if;
  if coalesce(lg.provider, 'sleeper') not in ('sleeper', 'espn') then
    return jsonb_build_object('ok', false, 'error', 'unknown provider — only imported sleeper/espn leagues convert');
  end if;
  if lg.commissioner_id is null then
    return jsonb_build_object('ok', false, 'error', 'league needs a commissioner — redeem the commish code first');
  end if;
  -- Same gate, same words as native_generate_schedule (0064): a converted
  -- league is born pre-season or between seasons, never mid-week.
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'league already has a draft row');
  end if;
  if p_pool is not null and jsonb_typeof(p_pool) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'pool must be an array');
  end if;
  if p_pool is not null and jsonb_array_length(p_pool) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large (max 2000)');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_league_id::text));

  select max(week) into snap_wk from sleeper_lineup where league_id = p_league_id;
  if snap_wk is null then
    return jsonb_build_object('ok', false, 'error', 'no synced rosters — run ⟳ sync season first');
  end if;
  select count(*)::int into teams from league_membership where league_id = p_league_id;
  if teams < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  begin  -- ← the dry-run savepoint: everything below rolls back on the sentinel
    -- 1 · Pool. Filter and shape are seed_league_pool's (0205), verbatim —
    -- position whitelist, blank-to-null ids, ordinality as rank.
    delete from league_pool where league_id = p_league_id;  -- imported leagues have none; be exact anyway
    if p_pool is not null then
      insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
      select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
             nullif(btrim(coalesce(p ->> 'espn_id', '')), ''),
             case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
                  then least(30, greatest(0, (p ->> 'exp')::int)) end,
             nullif(btrim(coalesce(p ->> 'sleeper_id', '')), '')
      from jsonb_array_elements(p_pool) with ordinality as t(p, ord)
      where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
        and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
      on conflict (league_id, slug) do nothing;
      get diagnostics pool_n = row_count;
    end if;
    select coalesce(max(rank), 0) + 1 into next_rank from league_pool where league_id = p_league_id;

    -- 2 · Rosters, from the snapshot week. Sleeper entries carry player_slug +
    -- sleeper_id (server/src/sync.js); ESPN entries carry slug only
    -- (providerAdmin.ts); native_materialize writes both — coalesce reads all.
    for e in
      select l.roster_id,
             ent.value as entry
      from sleeper_lineup l, jsonb_array_elements(l.starters_json) as ent
      where l.league_id = p_league_id and l.week = snap_wk
      order by l.roster_id, (ent.value ->> 'slot')::numeric nulls last
    loop
      sid := nullif(btrim(coalesce(e.entry ->> 'sleeper_id', '')), '');
      sl  := nullif(btrim(coalesce(e.entry ->> 'player_slug', e.entry ->> 'slug', '')), '');
      tgt_slug := null;
      if sid is not null then
        select slug into tgt_slug from league_pool
          where league_id = p_league_id and sleeper_id = sid;
        if tgt_slug is not null then matched_id := matched_id + 1; end if;
      end if;
      if tgt_slug is null and sl is not null then
        if exists (select 1 from league_pool where league_id = p_league_id and slug = sl) then
          tgt_slug := sl; matched_slug := matched_slug + 1;
        end if;
      end if;
      if tgt_slug is null then
        -- Not in the pool: append rather than drop — unless the entry can't
        -- be a pool row at all (no slug, or a position the game doesn't hold).
        if sl is not null
           and coalesce(e.entry ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P') then
          insert into league_pool (league_id, slug, full_name, pos, team, rank, sleeper_id)
          values (p_league_id, sl,
                  coalesce(nullif(btrim(coalesce(e.entry ->> 'full', '')), ''), sl),
                  e.entry ->> 'pos', coalesce(e.entry ->> 'team', ''), next_rank, sid)
          on conflict (league_id, slug) do nothing;
          if found then
            next_rank := next_rank + 1; added := added + 1; tgt_slug := sl;
          end if;
        end if;
      end if;
      if tgt_slug is null then
        skipped_n := skipped_n + 1;
        if jsonb_array_length(skipped) < 40 then
          skipped := skipped || jsonb_build_object(
            'roster_id', e.roster_id,
            'full', coalesce(e.entry ->> 'full', sl, sid, '?'),
            'pos', coalesce(e.entry ->> 'pos', '?'));
        end if;
        continue;
      end if;
      spot_v := case coalesce(e.entry ->> 'grp', 'start')
                  when 'ir' then 'ir' when 'taxi' then 'taxi' else 'active' end;
      insert into native_roster (league_id, roster_id, slug, acquired, spot)
        values (p_league_id, e.roster_id, tgt_slug, 'draft', spot_v)
        on conflict (league_id, slug) do nothing;
      if not found then dups := dups + 1; end if;
    end loop;

    select count(*)::int into rostered from native_roster where league_id = p_league_id;
    if rostered = 0 then
      -- Same rollback trick as the dry run: nothing above survives.
      raise exception 'no rostered players' using errcode = 'PD264';
    end if;

    -- 3 · Roster cap = the biggest converted ACTIVE roster (0064: rounds IS
    -- the cap; 0164: taxi/IR ride above it), inside the draft's own bounds.
    select greatest(5, least(99, coalesce(max(n), 5)))::int into cap from (
      select count(*) as n from native_roster
      where league_id = p_league_id and spot = 'active' group by roster_id
    ) t;

    -- 4 · Waiver order: seat order. An imported league has no draft order to
    -- reverse and no standings yet; the commissioner inherits a deterministic
    -- baseline and the first won claim starts the rotation (0064).
    update league_membership m set waiver_priority = r.rn
    from (select sleeper_roster_id, row_number() over (order by sleeper_roster_id)::int as rn
          from league_membership where league_id = p_league_id) r
    where m.league_id = p_league_id and m.sleeper_roster_id = r.sleeper_roster_id;

    -- 5 · The flip: settings surgery, provider, key.
    sj := coalesce(lg.settings_json, '{}'::jsonb);
    sc := sj -> 'scoring';
    if sc is not null and jsonb_typeof(sc) = 'object' and not (sc ? 'td_bonus') then
      sj := (sj - 'scoring') || jsonb_build_object('imported_scoring', sc);
    end if;
    sj := sj || jsonb_build_object('teams', teams, 'rounds', cap, 'mode', 'snake',
      'converted_from', jsonb_build_object(
        'provider', coalesce(lg.provider, 'sleeper'),
        'key', lg.sleeper_league_id, 'at', now()));
    new_key := 'native-' || replace(gen_random_uuid()::text, '-', '');
    update league set provider = 'native', sleeper_league_id = new_key,
        settings_json = sj, synced_at = now()
      where id = p_league_id;

    -- 6 · The completed draft — AFTER the rosters (see header: 0186's log
    -- gate). current_overall mirrors where native_exec_pick leaves it.
    select jsonb_agg(to_jsonb(sleeper_roster_id) order by sleeper_roster_id) into seats
      from league_membership where league_id = p_league_id;
    insert into draft (league_id, status, rounds, pick_seconds, mode, draft_order,
                       current_overall, started_at, completed_at)
    values (p_league_id, 'complete', cap, 86400, 'snake', seats,
            cap * teams + 1, now(), now());

    -- 7 · Materialize every (all-scheduled, i.e. every) week from the rosters.
    weeks := native_materialize(p_league_id);

    select count(*)::int into unclaimed from league_membership
      where league_id = p_league_id and app_user_id is null;

    summary := jsonb_build_object('ok', true,
      'teams', teams, 'rounds', cap, 'pool', pool_n + added, 'rostered', rostered,
      'matched_by_id', matched_id, 'matched_by_slug', matched_slug,
      'added_to_pool', added, 'skipped', skipped, 'skipped_n', skipped_n,
      'dups', dups, 'weeks_materialized', weeks, 'snapshot_week', snap_wk,
      'unclaimed_seats', unclaimed);

    if p_dry_run then
      raise exception 'dry run' using errcode = 'PD263';
    end if;
  exception
    when sqlstate 'PD263' then
      return summary || jsonb_build_object('dry_run', true);
    when sqlstate 'PD264' then
      return jsonb_build_object('ok', false,
        'error', 'no rostered players could be converted — sync the league, then try again');
  end;

  return summary;
end $$;

grant execute on function convert_league_to_native(uuid, jsonb, boolean) to authenticated;
