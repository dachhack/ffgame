-- 0196: THE TAXI SQUAD GETS ITS RULES.
--
-- Founder: "we need to have taxi setup where the commish picks which tenure
-- players are allowed on taxi. Taxi spots typically lock (no one can be placed
-- on them but players can be taken off) at the first kick off of week 1. Commish
-- can unlock or choose to not have a lock, and can move players to/from taxi at
-- any time."
--
-- 0164 gave the taxi squad a SIZE and nothing else: any player could ride it,
-- forever. That is not what a taxi squad is anywhere it is played — it is a
-- place to develop young players, and it shuts once the season starts so nobody
-- parks a healthy starter on it in week 6 to dodge a roster limit.
--
-- Two settings, both the commissioner's, both editable AT ANY TIME (unlike the
-- roster shape, which freezes at the draft — a commissioner who wants to reopen
-- the taxi in November is answering a question the league asked in November):
--
--   settings_json.taxi = { "max_exp": 1, "lock": true }
--
--   • max_exp — the tenure ceiling. 0 is "rookies only", 1 is "first and second
--     year", null is "anyone". A player whose experience is UNKNOWN cannot prove
--     he qualifies, so he is refused: the same answer 0171/0172's tenure filters
--     give, and for the same reason.
--   • lock — whether the squad shuts at the season's first kickoff. Default ON,
--     because that is what leagues expect; false is a commissioner deciding
--     their league doesn't do that.
--
-- THE LOCK BITES ON ADDING ONLY. Taking a player OFF the taxi is always
-- allowed — that is the whole point of having him there — and the COMMISSIONER
-- moves players either way whenever they like, which is how a mistake gets
-- fixed after the gate comes down.
--
-- WEEK 1'S FIRST KICKOFF is not a new fact: `matchup.lock_at` has been the
-- week's first kickoff since 0001, so the lock time is the earliest of them for
-- the league's week 1. A league with no schedule yet has no lock.

-- ─────────────────────────────────────────────────────────────────────────────
-- The three little readers
-- ─────────────────────────────────────────────────────────────────────────────
/** The season's first kickoff for this league — week 1's earliest lock_at.
 *  Null when the schedule hasn't been generated. */
create or replace function league_week1_kickoff(p_league_id uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select min(m.lock_at) from matchup m
   where m.league_id = p_league_id and m.week = 1 and m.lock_at is not null;
$$;

/** Does this league lock its taxi squad at all? Default TRUE — the common rule,
 *  and the one a commissioner who has never opened the setting expects. */
create or replace function league_taxi_lock(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select (settings_json -> 'taxi' ->> 'lock')::boolean
                     from league where id = p_league_id), true);
$$;

/** Is it shut right now? */
create or replace function taxi_is_locked(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select league_taxi_lock(p_league_id)
     and coalesce(league_week1_kickoff(p_league_id) <= now(), false);
$$;
grant execute on function league_week1_kickoff(uuid) to authenticated;
grant execute on function league_taxi_lock(uuid) to authenticated;
grant execute on function taxi_is_locked(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The commissioner's setter — editable at any time, deliberately
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_taxi_rules(p_league_id uuid, p_max_exp int default null, p_lock boolean default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare tx jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  -- -1 is the CLEAR sentinel ("anyone may ride it"), because null already means
  -- "leave this setting alone" — one call has to be able to say both.
  if p_max_exp is not null and (p_max_exp < -1 or p_max_exp > 30) then
    return jsonb_build_object('ok', false, 'error', 'the tenure ceiling must be 0-30 years (-1 clears it)');
  end if;
  select coalesce(settings_json -> 'taxi', '{}'::jsonb) into tx from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  -- Nulls mean UNCHANGED, so one control can move without restating the other.
  -- Clearing the ceiling is its own value: -1 means "anyone may ride it".
  if p_max_exp is not null then
    tx := case when p_max_exp < 0 then tx - 'max_exp'
               else tx || jsonb_build_object('max_exp', p_max_exp) end;
  end if;
  if p_lock is not null then tx := tx || jsonb_build_object('lock', p_lock); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('taxi', tx)
    where id = p_league_id;
  return jsonb_build_object('ok', true,
    'max_exp', nullif(tx ->> 'max_exp', '')::int,
    'lock', coalesce((tx ->> 'lock')::boolean, true),
    'locked_now', taxi_is_locked(p_league_id),
    'lock_at', league_week1_kickoff(p_league_id));
end $$;
grant execute on function set_taxi_rules(uuid, int, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_roster_spot — 0164's body, with who may ride and when
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_roster_spot(p_league_id uuid, p_slug text, p_spot text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; sh jsonb; cnt int; cap int; ist text; mx int; pexp int;
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
    -- ── WHO MAY RIDE IT (0196) ───────────────────────────────────────────
    -- The commissioner names a tenure ceiling — "rookies only" is max_exp 0,
    -- "first and second year" is 1. A player whose experience Sleeper doesn't
    -- know cannot prove he qualifies, which is the same answer the pool's
    -- tenure filter gives (0171/0172): unknown is not eligible.
    mx := (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id);
    if mx is not null then
      select lp.exp into pexp from league_pool lp
        where lp.league_id = p_league_id and lp.slug = p_slug;
      if pexp is null then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — this one''s experience isn''t known');
      end if;
      if pexp > mx then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — he has ' || pexp);
      end if;
    end if;
    -- ── AND WHEN (0196) ──────────────────────────────────────────────────
    -- Taxi squads shut at the season's first kickoff so nobody stashes a
    -- starter once games are being played. It bites on ADDING only: taking a
    -- player OFF the taxi is always allowed, which is the whole point of
    -- having him there. The COMMISSIONER moves players either way at any time.
    if taxi_is_locked(p_league_id) and not (is_league_commish(p_league_id) or is_admin()) then
      return jsonb_build_object('ok', false, 'error',
        'the taxi squad locked at the season''s first kickoff — you can still take players OFF it');
    end if;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- roster_rules — 0127's body, now carrying the taxi's rules to the screens
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function roster_rules(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  return jsonb_build_object('ok', true, 'rounds', d.rounds, 'draft_status', d.status,
    'pos_caps', league_pos_caps(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'waiver_clear_min', (select nullif(settings_json ->> 'waiver_clear_min', '')::int from league where id = p_league_id),
    'waiver_clear_dow', (select settings_json -> 'waiver_clear_dow' from league where id = p_league_id),
    'fa_after_waivers_dow', (select settings_json -> 'fa_after_waivers_dow' from league where id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1) from league where id = p_league_id),
    'fa_start_min', (select nullif(settings_json ->> 'fa_start_min', '')::int from league where id = p_league_id),
    'fa_end_min', (select nullif(settings_json ->> 'fa_end_min', '')::int from league where id = p_league_id),
    -- The taxi squad's own rules (0196), and whether it is shut right now.
    'taxi_max_exp', (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id),
    'taxi_lock', league_taxi_lock(p_league_id),
    'taxi_locked_now', taxi_is_locked(p_league_id),
    'taxi_lock_at', league_week1_kickoff(p_league_id));
end $$;
grant execute on function roster_rules(uuid) to authenticated;
