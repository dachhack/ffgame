-- 0164 · TAXI + IR spots, and the builder takes over DRAFT ROUNDS.
--
-- The founder's ruling (8/16): "set the positions before drafting so the
-- builder determines the draft rounds. Let's build out taxi and IR spots."
--
-- Model — one that leaves every existing roster-cap check true as written:
--   • settings_json.roster_shape = { bench, taxi, ir } (classic leagues).
--   • DRAFT ROUNDS derive: rounds = starters + bench + taxi + ir. You draft
--     the WHOLE roster, then designate stashes — so the existing cap sites
--     (count all native_roster rows vs draft.rounds) remain exactly right.
--   • native_roster.spot: 'active' | 'taxi' | 'ir'. Designation caps bite on
--     the MOVE: taxi ≤ shape.taxi; ir ≤ shape.ir AND the player carries a real
--     injury designation (injury_status IR/O — the worker maintains the table);
--     back to active requires active < starters + bench.
--   • A stashed player cannot be STARTED: a sealed_pick write for a taxi/IR
--     player is refused at the DB (same pattern as the 0144 no_start guard);
--     best-ball fills exclude them because the worker/boards fetch only
--     spot='active' rows.
--   • Post-draft, everyone lands 'active' (an over-full active list until the
--     manager designates stashes) — designation is the manager's move, the
--     caps make the end state lawful.

alter table native_roster add column if not exists spot text not null default 'active'
  check (spot in ('active', 'taxi', 'ir'));

-- The league's configured starter count: builder spec ⊳ 0161 counts ⊳ default 9.
create or replace function _classic_starters(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_array_length(settings_json -> 'roster_slots'),
    (select sum((v.value)::int)::int from jsonb_each_text(settings_json -> 'roster_classic') v),
    9)
  from league where id = p_league_id
$$;

create or replace function _roster_shape(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(settings_json -> 'roster_shape', '{}'::jsonb) from league where id = p_league_id
$$;

-- Re-derive draft.rounds from the builder while the draft is still pending.
create or replace function _sync_classic_rounds(p_league_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare sh jsonb; r int;
begin
  sh := _roster_shape(p_league_id);
  if sh = '{}'::jsonb then return; end if; -- shape never set: creation-time rounds stand
  r := _classic_starters(p_league_id)
     + coalesce((sh ->> 'bench')::int, 0)
     + coalesce((sh ->> 'taxi')::int, 0)
     + coalesce((sh ->> 'ir')::int, 0);
  update draft set rounds = r where league_id = p_league_id and status = 'pending';
end $$;

-- The commissioner's BENCH / TAXI / IR boxes from the sketch. Classic-only,
-- pre-draft only (rounds are meaningless to change mid-draft). Derived rounds
-- must land in the draft machinery's 5..25 window (0064).
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; b int; tx int; ir int; r int; sh jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape locks once the draft starts');
  end if;
  b  := least(20, greatest(0, coalesce(p_bench, 0)));
  tx := least(8,  greatest(0, coalesce(p_taxi, 0)));
  ir := least(8,  greatest(0, coalesce(p_ir, 0)));
  r  := _classic_starters(p_league_id) + b + tx + ir;
  if r < 5 or r > 25 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–25 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r);
end $$;
grant execute on function set_league_roster_shape(uuid, int, int, int) to authenticated;

-- Builder saves re-derive rounds too (spot count changed ⇒ rounds change).
-- Recreate 0163's setter with the sync call appended — body otherwise verbatim.
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  n int; i int; seen text[]; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster builder is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the starting lineup locks once the draft starts');
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'roster_slots'
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    perform _sync_classic_rounds(p_league_id);
    return jsonb_build_object('ok', true, 'slots', null);
  end if;
  n := jsonb_array_length(p_slots);
  if n > 20 then return jsonb_build_object('ok', false, 'error', 'lineups cap at 20 starters'); end if;
  for i in 0 .. n - 1 loop
    spot := p_slots -> i;
    if jsonb_typeof(spot) <> 'object' or jsonb_typeof(spot -> 'pos') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'each spot needs an eligible-position list');
    end if;
    seen := array[]::text[];
    for ps in select * from jsonb_array_elements(spot -> 'pos') loop
      p := upper(trim(both '"' from ps::text));
      if not (p = any (positions)) then
        return jsonb_build_object('ok', false, 'error', 'unknown position: ' || p);
      end if;
      if not (p = any (seen)) then seen := seen || p; end if;
    end loop;
    if coalesce(array_length(seen, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'error', 'each spot needs at least one eligible position');
    end if;
    begin bb := coalesce((spot ->> 'bb')::boolean, false); exception when others then bb := false; end;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('pos', to_jsonb(seen), 'bb', bb));
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_slots', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;

-- Move a player between ACTIVE / TAXI / IR — the manager's designation.
create or replace function set_roster_spot(p_league_id uuid, p_slug text, p_spot text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; sh jsonb; cnt int; cap int; ist text;
begin
  if p_spot not in ('active', 'taxi', 'ir') then
    return jsonb_build_object('ok', false, 'error', 'spot must be active, taxi, or ir');
  end if;
  select roster_id into rid from native_roster where league_id = p_league_id and slug = p_slug;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'player not rostered'); end if;
  if not (owns_roster(p_league_id, rid) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  sh := _roster_shape(p_league_id);
  if p_spot = 'taxi' then
    cap := coalesce((sh ->> 'taxi')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'taxi' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'taxi is full — ' || cap || ' spots'); end if;
  elsif p_spot = 'ir' then
    cap := coalesce((sh ->> 'ir')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'ir' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'IR is full — ' || cap || ' spots'); end if;
    select status into ist from injury_status where player_slug = p_slug;
    if ist is null or ist not in ('IR', 'O') then
      return jsonb_build_object('ok', false, 'error', 'IR needs a real designation — this player is not IR/Out');
    end if;
  else
    -- Back to active: there must be an active seat open (starters + bench).
    cap := _classic_starters(p_league_id) + coalesce((sh ->> 'bench')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'active' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'active roster is full — stash or drop someone first'); end if;
  end if;
  update native_roster set spot = p_spot where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'spot', p_spot);
end $$;
grant execute on function set_roster_spot(uuid, text, text) to authenticated;

-- A stashed player can't be STARTED (0144's no_start pattern): refuse the
-- sealed_pick write outright — the picker shows why, best-ball never sees them.
create or replace function enforce_stash_start() returns trigger
  language plpgsql security definer set search_path = public as $$
declare sp text; lid uuid;
begin
  if new.player_slug is null then return new; end if;
  select m.league_id into lid from matchup m where m.id = new.matchup_id;
  select nr.spot into sp from native_roster nr where nr.league_id = lid and nr.slug = new.player_slug;
  if sp in ('taxi', 'ir') then
    raise exception '% is stashed on %', new.player_slug, upper(sp)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists enforce_stash_start on sealed_pick;
create trigger enforce_stash_start before insert or update on sealed_pick
  for each row execute function enforce_stash_start();

-- ── league_game_mode v7: + roster_shape (and the live rounds) ───────────────
create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((l.settings_json ->> 'ppr')::numeric, 1),
      'classic_ok', coalesce((l.settings_json ->> 'classic_ok')::boolean, false),
      'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
      'scoring', coalesce(l.settings_json -> 'scoring_classic', '{}'::jsonb),
      'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
      'slots', l.settings_json -> 'roster_slots',
      'shape', l.settings_json -> 'roster_shape',
      'rounds', (select rounds from draft d where d.league_id = l.id),
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;
