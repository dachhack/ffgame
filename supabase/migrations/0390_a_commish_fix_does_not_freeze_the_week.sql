-- ═══════════════════════════════════════════════════════════════════════════
-- 0390 · A COMMISSIONER'S FIX DOESN'T FREEZE THE REST OF THE WEEK (v0.561.1)
--
-- Kickoff League, Sunday (#1035): Mooney needs to move players — every one
-- of his starters still yet to play — and "can we check this out make these
-- moves, please?"
--
-- Classic spots lock player by player at kickoff (0178). Two things sealed
-- spots EARLY, and a sealed row is un-writable by its manager (sealed_pick
-- RLS: locked = false), however far off the player's game is:
--   1. commish_set_week_lineup (0356) sealed EVERY spot it wrote once the
--      week's first kickoff had passed. Built for fixing a week already
--      played; used mid-week (a Friday fix for a manager locked out), it
--      froze his Sunday and Monday players for the rest of the week.
--   2. The worker sealed EMPTY spots at the week's first kickoff (fixed in
--      v0.559.1, lock.js classicSealAt) — rows sealed before that deploy stay
--      sealed.
--
-- The fix: the commissioner's rows lock as each player does (his kickoff via
-- classic_pick_lock; open for an empty spot), and the new player decides a
-- row's lock rather than OR-ing the old one. Then a one-time repair: on this
-- week's live classic matchups, every sealed spot whose player hasn't kicked
-- off, and every sealed empty spot, opens again. The worker re-seals each at
-- its kickoff (empty spots at the week's last). Players already started, and
-- ones the database can't place, stay sealed.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── commish_set_week_lineup — 0356's body, each spot locked as its player is ──
create or replace function commish_set_week_lineup(p_league_id uuid, p_week int, p_roster_id int, p_picks jsonb, p_note text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare mid uuid; author uuid; why text := nullif(btrim(coalesce(p_note, '')), ''); p jsonb;
        before jsonb; after jsonb; ins text[]; outs text[]; wkk timestamptz; k timestamptz; locked_now boolean; stamped boolean; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if (select coalesce(settings_json ->> 'game_mode', 'drip') from league where id = p_league_id) <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'lineup fixes are for classic leagues — a drip week was played live and can''t be rebuilt');
  end if;
  if why is null then return jsonb_build_object('ok', false, 'error', 'say why — the league will see the reason'); end if;
  if jsonb_typeof(p_picks) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'picks must be a list of {slot, slug}');
  end if;
  select id into mid from matchup where league_id = p_league_id and week = p_week
     and (home_roster_id = p_roster_id or away_roster_id = p_roster_id) order by created_at limit 1;
  if mid is null then return jsonb_build_object('ok', false, 'error', 'that team has no matchup in week ' || coalesce(p_week::text, '?')); end if;
  author := _seat_author(p_league_id, p_roster_id);
  if author is null then
    return jsonb_build_object('ok', false, 'error', 'that seat has nobody to field a lineup for — its lineup is computed from its roster');
  end if;
  for p in select * from jsonb_array_elements(p_picks) loop
    if coalesce(p ->> 'slot', '') !~ '^[A-Za-z0-9_/]{1,16}$' then
      return jsonb_build_object('ok', false, 'error', 'every pick needs a spot');
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_picks) x) <> (select count(distinct x ->> 'slot') from jsonb_array_elements(p_picks) x) then
    return jsonb_build_object('ok', false, 'error', 'a spot is named twice');
  end if;
  if exists (select x ->> 'slug' from jsonb_array_elements(p_picks) x where nullif(x ->> 'slug', '') is not null
              group by 1 having count(*) > 1) then
    return jsonb_build_object('ok', false, 'error', 'a player can start in one spot only');
  end if;
  select string_agg(x ->> 'slug', ', ') into line from jsonb_array_elements(p_picks) x
   where nullif(x ->> 'slug', '') is not null
     and not exists (select 1 from _lineup_fix_candidates(p_league_id, p_week, p_roster_id, mid, author) c where c.slug = x ->> 'slug');
  if line is not null then
    return jsonb_build_object('ok', false, 'error', 'not this team''s to start that week: ' || line);
  end if;

  perform pg_advisory_xact_lock(hashtext('lineupfix:' || mid::text || ':' || author::text));
  select coalesce(jsonb_agg(jsonb_build_object('slot', roster_slot, 'slug', player_slug) order by roster_slot), '[]'::jsonb)
    into before from sealed_pick where matchup_id = mid and app_user_id = author and game_window = 'wk';
  -- Locked AS EACH PLAYER IS (0390): a spot whose player has kicked off is
  -- sealed and revealed at once, which is what the resolver scores; a spot
  -- whose player hasn't stays open to the manager until his kickoff, when
  -- the worker seals it like any other. It used to be the week's FIRST
  -- kickoff for every spot, so a fix on a Friday sealed the Sunday and
  -- Monday players too and the manager couldn't touch his lineup again.
  wkk := window_kickoff(p_week, 'wk');

  perform set_config('drip.commish_lineup', 'on', true);
  delete from sealed_pick s where s.matchup_id = mid and s.app_user_id = author and s.game_window = 'wk'
     and not exists (select 1 from jsonb_array_elements(p_picks) x where x ->> 'slot' = s.roster_slot);
  for p in select * from jsonb_array_elements(p_picks) loop
    -- classic_pick_lock (0178): his kickoff; the week's first for a player it
    -- can't place; null for an empty spot or a bye — open.
    k := classic_pick_lock(mid, nullif(p ->> 'slug', ''), wkk);
    locked_now := coalesce(k <= now(), false);
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, locked, revealed_at)
    values (mid, author, 'wk', p ->> 'slot', nullif(p ->> 'slug', ''), locked_now, case when locked_now then now() end)
    on conflict (matchup_id, app_user_id, game_window, roster_slot) do update
      set player_slug = excluded.player_slug,
          -- The new player decides (0390): a spot sealed early (the old rule,
          -- or an empty spot sealed Thursday) opens when he hasn't played.
          locked = excluded.locked,
          revealed_at = case when excluded.locked then coalesce(sealed_pick.revealed_at, excluded.revealed_at) end;
  end loop;
  perform set_config('drip.commish_lineup', '', true);

  select coalesce(jsonb_agg(jsonb_build_object('slot', roster_slot, 'slug', player_slug) order by roster_slot), '[]'::jsonb)
    into after from sealed_pick where matchup_id = mid and app_user_id = author and game_window = 'wk';
  insert into lineup_edit_log (league_id, week, roster_id, before, after, note, set_by)
  values (p_league_id, p_week, p_roster_id, before, after, left(why, 200), auth.uid());

  select array_agg(_txn_player(p_league_id, s) order by s) into ins from (
    select x ->> 'slug' s from jsonb_array_elements(after) x where x ->> 'slug' is not null
    except select x ->> 'slug' from jsonb_array_elements(before) x where x ->> 'slug' is not null) a;
  select array_agg(_txn_player(p_league_id, s) order by s) into outs from (
    select x ->> 'slug' s from jsonb_array_elements(before) x where x ->> 'slug' is not null
    except select x ->> 'slug' from jsonb_array_elements(after) x where x ->> 'slug' is not null) a;
  select exists (select 1 from matchup where id = mid and home_final is not null and away_final is not null) into stamped;
  if ins is not null or outs is not null then
    perform _chat_house(p_league_id,
      '🧾 The commissioner changed ' || _txn_team(p_league_id, p_roster_id) || '''s week ' || p_week || ' lineup: '
      || concat_ws('; ', 'in ' || array_to_string(ins, ', '), 'out ' || array_to_string(outs, ', '))
      || ' — ' || left(why, 200),
      jsonb_build_object('kind', 'lineup_fix', 'week', p_week, 'roster_id', p_roster_id));
  end if;
  return jsonb_build_object('ok', true, 'in', coalesce(to_jsonb(ins), '[]'::jsonb), 'out', coalesce(to_jsonb(outs), '[]'::jsonb),
    'rescore', stamped);
end $$;
grant execute on function commish_set_week_lineup(uuid, int, int, jsonb, text) to authenticated;

-- ── The repair: this week's spots sealed before their time ──
-- A function so the probes can run it; worker/admin only (no grant).
create or replace function _reopen_early_classic_spots() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update sealed_pick s set locked = false, revealed_at = null
    from matchup m
   where m.id = s.matchup_id and m.status = 'live'
     and s.game_window = 'wk' and s.locked
     and (s.player_slug is null
          or coalesce(classic_pick_lock(s.matchup_id, s.player_slug, window_kickoff(m.week, 'wk')) > now(), false));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function _reopen_early_classic_spots() from public;

do $$ begin
  raise notice '0390: reopened % classic spot(s) sealed before their kickoff', _reopen_early_classic_spots();
end $$;
