-- ═══════════════════════════════════════════════════════════════════════════
-- 0365 · COLLEGE PLAYERS, PHASE 1 — THE FOUNDATION.
--
-- Founder: devy leagues, college-only leagues, and leagues where NFL and
-- college players both score. All three are CLASSIC ONLY; Drip mode stays
-- NFL-only. This migration lays what all three share and changes nothing any
-- existing league can see:
--
--   • college_player — the FBS directory, written by the worker
--     (server/src/poll/college.js) from ESPN's college rosters. Keyed by the
--     ESPN athlete id, because ESPN keeps that id when a player reaches the
--     NFL (checked 2026-09-26: Cam Ward 4688380 and Ashton Jeanty 4890973 are
--     the same athlete on the college and NFL endpoints). That is what lets a
--     later phase graduate a devy player without matching a name.
--
--   • A COLLEGE PLAYER'S SLUG IS `c-<espn_id>`. The slug stays the storage key
--     everywhere (0205's reasoning holds: it is in a dozen tables), and a
--     college name would collide far more often than an NFL one — thousands
--     of FBS players, many namesakes. `c-` + digits cannot be produced by
--     slugOf(full_name), so it never meets an NFL slug. (A plain `c-` prefix
--     could: "C. Smith" slugs to `c-smith`, which is why the rule is digits.)
--
--   • league_pool.level — GENERATED from the slug, not written by anyone.
--     Every path that copies a pool (rollover 0182/0220, the practice room
--     0281–0283, convert-to-native 0263) names its columns, and several of
--     them drop espn_id on the way. A generated column rides every one of
--     those copies untouched, and cannot disagree with the slug it reads.
--
--   • COLLEGE is a position group beside HC / P / IDP / FB / RET (0171),
--     admin-set per league. It is refused on a Drip league, and a league with
--     it cannot be switched to Drip — at the two RPCs with a readable error,
--     and at a trigger on `league` as the backstop for any other writer.
--
--   • seed_league_pool admits `c-<digits>` rows only where COLLEGE is on.
--     Anything else it quietly skips, exactly as it skips an unknown position.
--
-- Nothing here puts a college player in any pool: no client builds one yet.
-- The devy spot, the devy draft and graduation are phase 2.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the directory ───────────────────────────────────────────────────────────
create table if not exists college_player (
  espn_id      text primary key,
  full_name    text not null,
  pos          text not null,          -- our Pos (QB RB WR TE K P FB DL LB DB)
  espn_pos     text,                   -- ESPN's own abbreviation (EDGE, PK, S…)
  school_id    text,                   -- ESPN team id
  school       text,                   -- "Alabama Crimson Tide"
  school_abbr  text,                   -- "ALA"
  class_year   int,                    -- ESPN experience.years (1 = freshman)
  class_label  text,                   -- "FR" / "SO" / "JR" / "SR"
  jersey       text,
  active       boolean not null default true,
  -- The last sweep that saw him. A completed sweep marks everyone it did NOT
  -- see inactive (finish_college_sweep), which is how a graduate or a player
  -- who left the program drops out without anybody deleting a row a league
  -- might still hold.
  seen_at      timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists college_player_school on college_player(school_id);
create index if not exists college_player_active_pos on college_player(pos) where active;
alter table college_player enable row level security;
drop policy if exists college_player_read on college_player;
create policy college_player_read on college_player for select using (auth.uid() is not null);

comment on table college_player is
  'FBS player directory (0365), written by the worker from ESPN college rosters. espn_id is the key and survives the move to the NFL.';

-- ── the worker's write ──────────────────────────────────────────────────────
-- Whole batches, like upsert_player_xref (0331). A null in a later batch
-- never blanks a value we already had.
create or replace function upsert_college_players(p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  insert into college_player (espn_id, full_name, pos, espn_pos, school_id, school, school_abbr,
                              class_year, class_label, jersey, active, seen_at, updated_at)
  select r ->> 'espn_id', btrim(r ->> 'full_name'), r ->> 'pos', nullif(r ->> 'espn_pos', ''),
         nullif(r ->> 'school_id', ''), nullif(r ->> 'school', ''), nullif(r ->> 'school_abbr', ''),
         case when coalesce(r ->> 'class_year', '') ~ '^\d{1,2}$' then (r ->> 'class_year')::int end,
         nullif(r ->> 'class_label', ''), nullif(r ->> 'jersey', ''),
         coalesce((r ->> 'active')::boolean, true), now(), now()
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
        seen_at     = now(),
        updated_at  = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function upsert_college_players(jsonb) from public, anon, authenticated;
grant execute on function upsert_college_players(jsonb) to service_role;

-- Called ONLY after a sweep that fetched every team: anyone it did not see is
-- no longer on an FBS roster. A partial sweep must not call this, or a single
-- ESPN timeout would retire a whole school.
create or replace function finish_college_sweep(p_started timestamptz) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_started is null then return jsonb_build_object('ok', false, 'error', 'a start time'); end if;
  update college_player set active = false, updated_at = now()
   where active and seen_at < p_started;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'retired', n);
end $$;
revoke all on function finish_college_sweep(timestamptz) from public, anon, authenticated;
grant execute on function finish_college_sweep(timestamptz) to service_role;

-- ── the pool knows its level ────────────────────────────────────────────────
alter table league_pool add column if not exists level text
  generated always as (case when slug ~ '^c-[0-9]+$' then 'college' else 'nfl' end) stored;

comment on column league_pool.level is
  'nfl | college (0365), GENERATED from the slug: a college player''s slug is c-<espn_id>. Rides every pool copy untouched.';

-- College rows in one league's pool, with the directory's school and class.
-- Members only, like league_pool_ids (0205): nothing here a pool row plus the
-- public directory does not already say.
create or replace function league_pool_college(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'players', coalesce(
    (select jsonb_object_agg(lp.slug, jsonb_build_object(
        'espn_id', substr(lp.slug, 3), 'school', cp.school, 'school_abbr', cp.school_abbr,
        'class_label', cp.class_label, 'class_year', cp.class_year, 'active', cp.active))
       from league_pool lp
       left join college_player cp on cp.espn_id = substr(lp.slug, 3)
      where lp.league_id = p_league_id and lp.level = 'college'), '{}'::jsonb));
end $$;
grant execute on function league_pool_college(uuid) to authenticated;

-- ── COLLEGE is a position group, classic only ───────────────────────────────
create or replace function _league_has_college(p_settings jsonb) returns boolean
  language sql immutable as $$
  select coalesce(p_settings -> 'positions_extra', '[]'::jsonb) @> '["COLLEGE"]'::jsonb
$$;

-- 0171's body, plus COLLEGE in the allowed list and the classic-only refusal.
create or replace function set_league_position_access(p_league_id uuid, p_positions jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare allowed text[] := array['HC','P','IDP','FB','RET','COLLEGE']; cleaned jsonb := '[]'::jsonb; ps jsonb; v text;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_positions is not null and jsonb_typeof(p_positions) = 'array' then
    for ps in select * from jsonb_array_elements(p_positions) loop
      v := upper(trim(both '"' from ps::text));
      if not (v = any (allowed)) then
        return jsonb_build_object('ok', false, 'error', 'unknown position group: ' || v);
      end if;
      if not cleaned @> to_jsonb(array[v]) then cleaned := cleaned || to_jsonb(array[v]); end if;
    end loop;
  end if;
  -- 0365: college players are classic only.
  if cleaned @> '["COLLEGE"]'::jsonb and coalesce((select settings_json ->> 'game_mode'
      from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'college players need a classic league');
  end if;
  update league set settings_json =
      case when cleaned = '[]'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'positions_extra')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('positions_extra', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'positions', cleaned);
end $$;
grant execute on function set_league_position_access(uuid, jsonb) to authenticated;

-- 0209's body, plus: a league with college players cannot go to Drip.
create or replace function set_league_game_mode(p_league_id uuid, p_mode text, p_ppr numeric default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('drip', 'classic') then
    return jsonb_build_object('ok', false, 'error', 'mode must be drip or classic');
  end if;
  -- The three preset steps stay the only values THIS entry point accepts: it is
  -- the preset path, and a preset is a named starting point. Any other number
  -- goes through the scoring field, which is what 0209 added.
  if p_ppr is not null and p_ppr not in (0, 0.5, 1) then
    return jsonb_build_object('ok', false, 'error', 'ppr must be 0, 0.5 or 1');
  end if;
  if p_mode = 'classic' and coalesce((select (settings_json ->> 'classic_ok')::boolean
      from league where id = p_league_id), false) is not true then
    return jsonb_build_object('ok', false, 'error', 'classic mode is not enabled for this league');
  end if;
  -- 0365: Drip mode is NFL-only.
  if p_mode = 'drip' and _league_has_college((select settings_json from league where id = p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'a league with college players stays classic');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'game mode locks once the draft starts');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('game_mode', p_mode)
      || case when p_ppr is null then '{}'::jsonb else jsonb_build_object('ppr', p_ppr) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  -- 0209: keep the scoring catalog's copy in step. Without this, applying a
  -- preset would leave a stale `scoring_classic.ppr` behind it, and the field
  -- the commissioner reads next would show the value the preset just replaced.
  if p_ppr is not null and (select settings_json -> 'scoring_classic' from league where id = p_league_id) is not null then
    update league set settings_json = jsonb_set(settings_json, '{scoring_classic,ppr}', to_jsonb(p_ppr))
      where id = p_league_id;
  end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;

-- The backstop. Settings are written from many places (rollover copies them
-- wholesale, the practice room wears them, admin tools patch them); none of
-- them should be able to produce a Drip league holding college players.
create or replace function _league_college_is_classic() returns trigger
  language plpgsql as $$
begin
  if _league_has_college(new.settings_json)
     and coalesce(new.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    raise exception 'a league with college players must be classic (0365)';
  end if;
  return new;
end $$;
drop trigger if exists league_college_is_classic on league;
create trigger league_college_is_classic before insert or update of settings_json on league
  for each row execute function _league_college_is_classic();

-- ── seed_league_pool v3: 0205's body, plus the college gate ─────────────────
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean;
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
  college := _league_has_college((select settings_json from league where id = p_league_id));

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr
                    where nr.league_id = lp.league_id and nr.slug = lp.slug);
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
         -- 0365: a college row's ESPN id IS its slug's number; take it from
         -- there so the two can never disagree.
         case when (p ->> 'slug') ~ '^c-[0-9]+$' then substr(p ->> 'slug', 3)
              else nullif(btrim(coalesce(p ->> 'espn_id', '')), '') end,
         case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
              then least(30, greatest(0, (p ->> 'exp')::int)) end,
         -- Blank becomes NULL rather than '': the unique index is partial, and
         -- a pool full of empty strings would collide with itself on the first
         -- two team units.
         nullif(btrim(coalesce(p ->> 'sleeper_id', '')), '')
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
    -- 0365: college rows only where the admin turned COLLEGE on.
    and (college or (p ->> 'slug') !~ '^c-[0-9]+$')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

grant execute on function seed_league_pool(uuid, jsonb) to authenticated;
