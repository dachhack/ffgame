-- 0268: THE COVEN — vampires don't draft, may own the wire, and can be many.
--
-- Founder: "vampire shouldnt get to draft players. Vampire leagues should
-- have the option to lock the waivers to any non-vampire team. Let's also
-- have the number of vampires in the league customizable."
--
-- This is the classic vampire ruleset, arriving in three moves:
--
--   1. THE VAMPIRE DOESN'T DRAFT. Appointed BEFORE the draft, vampire seats
--      are excluded from the draft order entirely — the other teams draft,
--      and the vampire builds its roster from what they left in the pool.
--      Which means the 0221 seat guard FLIPS: the vampire may now sign free
--      agents and claim waivers (it has to — the pool is its only cradle);
--      what it still cannot do is draft. Steals stay the marquee move for
--      taking a ROSTERED player. A vampire appointed after the draft simply
--      keeps what it drafted — the exclusion is a draft-time rule, not a
--      confiscation.
--   2. THE WIRE CAN BELONG TO THE VAMPIRE. settings_json.vampire_wire_lock
--      (off by default): ON means non-vampire teams cannot add free agents
--      or claim waivers — the undrafted pool is the vampire's hunting
--      ground, and a beaten team cannot restock around its losses. Enforced
--      in the same BEFORE trigger as every other seat law.
--   3. A LEAGUE MAY RUN SEVERAL VAMPIRES. settings_json.vampire_rosters is
--      a list (the legacy vampire_roster single key still reads, and is
--      kept written as the first seat so nothing stale breaks). Each
--      vampire feeds independently: its own matchup, its own fresh-win
--      window, one steal per win — the uniqueness key grows the vampire
--      column. vampire_state answers per-vampire under `vampires`, keeping
--      the old single-vampire top-level fields pointed at the CALLER's seat
--      (else the first), so the shipped APK reads on.
--
-- vampire_steal grows an optional p_vampire — and the old 3-arg function is
-- DROPPED first, because PostgREST resolves rpc calls by named args and two
-- overloads both matching {league, take, give} is an ambiguity, not a
-- fallback.

-- ── Seats, plural ────────────────────────────────────────────────────────────
create or replace function vampire_seats(p_league_id uuid) returns int[]
  language sql stable security definer set search_path = public as $$
  select case
    when settings_json -> 'vampire_rosters' is not null
         and jsonb_typeof(settings_json -> 'vampire_rosters') = 'array'
      then coalesce((select array_agg(v::int order by v::int)
                     from jsonb_array_elements_text(settings_json -> 'vampire_rosters') t(v)), '{}')
    when nullif(settings_json ->> 'vampire_roster', '') is not null
      then array[(settings_json ->> 'vampire_roster')::int]
    else '{}'::int[] end
  from league where id = p_league_id;
$$;

create or replace function is_vampire_seat(p_league_id uuid, p_roster_id int) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_roster_id = any(coalesce(vampire_seats(p_league_id), '{}'));
$$;

-- Legacy single-seat read (0222): the first of the coven.
create or replace function vampire_seat(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select (vampire_seats(p_league_id))[1];
$$;

create or replace function vampire_wire_lock_on(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'vampire_wire_lock')::boolean, false) from league where id = p_league_id;
$$;

-- ── Appointing the coven ─────────────────────────────────────────────────────
create or replace function set_vampires(
  p_league_id uuid, p_roster_ids jsonb,
  p_steal_review boolean default null, p_wire_lock boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare seats int[]; teams int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_format(p_league_id) <> 'vampire' then
    return jsonb_build_object('ok', false, 'error', 'set the league format to vampire first');
  end if;
  if p_roster_ids is null or jsonb_typeof(p_roster_ids) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'seats must be a list');
  end if;
  select coalesce(array_agg(distinct v::int order by v::int), '{}') into seats
    from jsonb_array_elements_text(p_roster_ids) t(v);
  if exists (select 1 from unnest(seats) s
             where not exists (select 1 from league_membership
               where league_id = p_league_id and sleeper_roster_id = s)) then
    return jsonb_build_object('ok', false, 'error', 'no such seat');
  end if;
  select count(*)::int into teams from league_membership where league_id = p_league_id;
  if coalesce(array_length(seats, 1), 0) >= teams then
    return jsonb_build_object('ok', false, 'error', 'somebody has to draft — leave at least one non-vampire team');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('vampire_rosters', to_jsonb(seats))
      -- the legacy key follows the first seat so nothing stale misreads;
      -- an empty coven clears it
      || case when coalesce(array_length(seats, 1), 0) > 0
              then jsonb_build_object('vampire_roster', seats[1])
              else jsonb_build_object('vampire_roster', null) end
      || case when p_steal_review is null then '{}'::jsonb
              else jsonb_build_object('steal_review', p_steal_review) end
      || case when p_wire_lock is null then '{}'::jsonb
              else jsonb_build_object('vampire_wire_lock', p_wire_lock) end
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'vampires', to_jsonb(coalesce(vampire_seats(p_league_id), '{}')),
    'steal_review', steal_review_on(p_league_id), 'wire_lock', vampire_wire_lock_on(p_league_id));
end $$;
grant execute on function set_vampires(uuid, jsonb, boolean, boolean) to authenticated;

-- The old single-seat setter delegates (shipped APKs call it).
create or replace function set_vampire(p_league_id uuid, p_roster_id int, p_steal_review boolean default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_roster_id is null then
    r := set_vampires(p_league_id, to_jsonb(coalesce(vampire_seats(p_league_id), '{}')), p_steal_review, null);
  else
    r := set_vampires(p_league_id, jsonb_build_array(p_roster_id), p_steal_review, null);
  end if;
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  return jsonb_build_object('ok', true, 'vampire', vampire_seat(p_league_id),
    'steal_review', steal_review_on(p_league_id));
end $$;

-- ── Seat law v3 (0221 body; the vampire branch flips) ────────────────────────
create or replace function _format_seat_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare f text;
begin
  f := league_format(new.league_id);
  if f = 'standard' then return new; end if;
  if f = 'guillotine' then
    -- a dead seat never gains a player, by any path
    if exists (select 1 from league_membership
               where league_id = new.league_id and sleeper_roster_id = new.roster_id
                 and eliminated_week is not null) then
      raise exception 'this team fell to the guillotine — its season is over';
    end if;
  elsif f = 'vampire' and tg_op = 'INSERT' and new.acquired in ('fa', 'waiver') then
    -- 0268: the vampire builds from the pool now (it doesn't draft), so the
    -- old "feeds on wins, not waivers" block is GONE. The optional lock runs
    -- the other way: with the wire locked, only the coven works it.
    if vampire_wire_lock_on(new.league_id)
       and coalesce(array_length(vampire_seats(new.league_id), 1), 0) > 0
       and not is_vampire_seat(new.league_id, new.roster_id) then
      raise exception 'the wire belongs to the vampire — this league locks pickups to the coven';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists format_seat_guard on native_roster;
create trigger format_seat_guard
  before insert or update of roster_id on native_roster
  for each row execute function _format_seat_guard();

-- ── The draft leaves the vampire out (0219 body + the exclusion) ─────────────
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int; snake_kind boolean;
  pool_n int; vamps int[]; v int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  if d.rounds - d.keeper_slots - d.stash_slots < 1 then
    return jsonb_build_object('ok', false, 'error',
      'no rounds left to draft — keepers and IR spots fill the whole roster');
  end if;

  -- 0268: vampires appointed before the draft never enter it — they build
  -- from what the drafting teams leave in the pool.
  vamps := case when league_format(p_league_id) = 'vampire'
                then coalesce(vampire_seats(p_league_id), '{}') else '{}'::int[] end;
  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id
      and not (sleeper_roster_id = any(vamps));
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v2.x) from (select (jsonb_array_elements_text(p_order))::int as x) v2
        where v2.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v2.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v2
           where v2.x = any(ids)) = n
    then
      ord := d.draft_order; preset := true;
    else
      select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
    end if;
  end if;

  -- Owned picks: this league's own season carries assets ⇒ an explicit
  -- per-overall owner list, each pick owned by its asset's holder.
  --
  -- WHICH WAY THE ROUNDS RUN IS THE ASSET'S KIND (0190). A ROOKIE pick means
  -- "round 3, Team X's slot", so its draft runs LINEAR — 0183's rule, and its
  -- reasoning: snaking would relabel that pick every other round. A STARTUP
  -- pick is a slot in a snake that managers already know the shape of, so its
  -- draft snakes. With every asset still at its original owner, the startup
  -- walk below reproduces the plain snake order EXACTLY, which is what lets a
  -- league turn pick trading on without changing how it drafts.
  select season into lseas from league where id = p_league_id;
  if d.mode = 'snake' and exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = lseas) then
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas;
    owners := '[]'::jsonb;
    for r in 1..maxr loop
      for i in 0..(n - 1) loop
        -- even rounds reverse, but only for a startup draft
        orig := (ord ->> (case when coalesce(snake_kind, false) and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots - d.stash_slots) * n;
  end if;

  -- THE POOL HAS TO FILL THE DRAFT — the check that was already doing the work
  -- the round cap got the credit for. What changes in 0192 is that it SAYS THE
  -- NUMBERS: at 25 rounds "pool smaller than the draft" was a nudge, at 99 it
  -- has to tell you whether to trim one round or forty.
  select count(*) into pool_n from league_pool lp
    where lp.league_id = p_league_id
      and not exists (select 1 from native_roster nr
                      where nr.league_id = lp.league_id and nr.slug = lp.slug);
  if pool_n < total_picks then
    return jsonb_build_object('ok', false, 'error',
      format('pool smaller than the draft — it needs %s picks (%s rounds x %s teams) and the pool holds %s players; lower the roster size or re-seed a bigger pool',
             total_picks, d.rounds - d.keeper_slots - d.stash_slots, n, pool_n));
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership m set draft_budget = case
      -- a contract league's carried payroll (rolled-over deals, dead money)
      -- already spent part of this seat's money — the room only gets the rest
      when contracts_on(p_league_id)
        then greatest(1, d.budget - team_payroll(p_league_id, m.sleeper_roster_id))
      else d.budget end
    where m.league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;
  -- The coven queues behind the drafting teams — deterministic, and only
  -- meaningful when the wire is unlocked for everyone anyway.
  i := n;
  foreach v in array vamps loop
    i := i + 1;
    update league_membership set waiver_priority = i
      where league_id = p_league_id and sleeper_roster_id = v;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null, 'vampires_excluded', coalesce(array_length(vamps, 1), 0));
end $$;

-- ── One steal per win, per vampire ───────────────────────────────────────────
drop index if exists vampire_steal_one_per_week;
create unique index if not exists vampire_steal_one_per_week_per_vamp
  on vampire_steal (league_id, week, vampire) where status in ('pending', 'executed');

-- vampire_steal v2 (0222 body + the acting seat resolved from the coven).
-- The 3-arg original is dropped: PostgREST resolves by named args, and two
-- overloads matching {league, take, give} is an ambiguity, not a fallback.
drop function if exists vampire_steal(uuid, text, text);
create function vampire_steal(p_league_id uuid, p_take_slug text, p_give_slug text, p_vampire int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare seats int[]; vamp int; wk int; mu matchup%rowtype; victim int; won boolean; sid bigint; r jsonb;
        mine int[];
begin
  seats := coalesce(vampire_seats(p_league_id), '{}');
  if league_format(p_league_id) <> 'vampire' or coalesce(array_length(seats, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no vampire in this league');
  end if;
  -- Which vampire is feeding: the named one (validated), else the caller's own
  -- seat, else — for a commissioner in a one-vampire league — the only one.
  if p_vampire is not null then
    if not (p_vampire = any(seats)) then
      return jsonb_build_object('ok', false, 'error', 'that seat is not a vampire');
    end if;
    vamp := p_vampire;
  else
    select coalesce(array_agg(s), '{}') into mine from unnest(seats) s where owns_roster(p_league_id, s);
    if coalesce(array_length(mine, 1), 0) = 1 then vamp := mine[1];
    elsif coalesce(array_length(mine, 1), 0) > 1 then
      return jsonb_build_object('ok', false, 'error', 'you run several vampires — name the seat');
    elsif array_length(seats, 1) = 1 then vamp := seats[1];
    else
      return jsonb_build_object('ok', false, 'error', 'several vampires here — name the seat');
    end if;
  end if;
  if not (owns_roster(p_league_id, vamp) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the vampire feeds');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':steal'));
  -- the LATEST fully-final week is the only fresh win
  select max(week) into wk from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));
  if wk is null then return jsonb_build_object('ok', false, 'error', 'no completed week yet'); end if;
  select * into mu from matchup
    where league_id = p_league_id and week = wk
      and vamp in (home_roster_id, away_roster_id) limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'the vampire had no matchup in week ' || wk); end if;
  won := case when mu.home_roster_id = vamp then mu.home_final > mu.away_final
              else mu.away_final > mu.home_final end;
  if not won then return jsonb_build_object('ok', false, 'error', 'no fresh blood — the vampire lost week ' || wk); end if;
  victim := case when mu.home_roster_id = vamp then mu.away_roster_id else mu.home_roster_id end;
  if exists (select 1 from vampire_steal
      where league_id = p_league_id and week = wk and vampire = vamp and status in ('pending', 'executed')) then
    return jsonb_build_object('ok', false, 'error', 'one steal per win — week ' || wk || ' is already fed on');
  end if;
  if not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = victim and slug = p_take_slug
        and coalesce(spot, 'active') = 'active') then
    return jsonb_build_object('ok', false, 'error', 'steal from the beaten team''s active roster');
  end if;
  if not exists (select 1 from native_roster
      where league_id = p_league_id and roster_id = vamp and slug = p_give_slug) then
    return jsonb_build_object('ok', false, 'error', 'give back one of your own');
  end if;
  insert into vampire_steal (league_id, week, vampire, victim, take_slug, give_slug)
    values (p_league_id, wk, vamp, victim, p_take_slug, p_give_slug)
    returning id into sid;
  if steal_review_on(p_league_id) then
    return jsonb_build_object('ok', true, 'status', 'pending', 'week', wk,
      'note', 'awaiting the commissioner''s ruling');
  end if;
  r := _execute_steal(sid);
  if not coalesce((r ->> 'ok')::boolean, false) then
    delete from vampire_steal where id = sid;   -- a refused immediate steal never happened
    return r;
  end if;
  return r || jsonb_build_object('week', wk);
end $$;
grant execute on function vampire_steal(uuid, text, text, int) to authenticated;

-- ── vampire_state v3: the coven, per vampire (0267 body, restructured) ───────
create or replace function vampire_state(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seats int[]; wk int; s int; me int := null; legacy int;
        vrows jsonb := '[]'::jsonb; vrow jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if league_format(p_league_id) <> 'vampire' then return jsonb_build_object('vampire', false); end if;
  seats := coalesce(vampire_seats(p_league_id), '{}');
  select max(week) into wk from matchup m
  where m.league_id = p_league_id
    and not exists (select 1 from matchup m2
      where m2.league_id = p_league_id and m2.week = m.week
        and (m2.status <> 'final' or m2.home_final is null or m2.away_final is null));

  foreach s in array seats loop
    if owns_roster(p_league_id, s) and me is null then me := s; end if;
    vrows := vrows || _vampire_seat_state(p_league_id, s, wk);
  end loop;
  legacy := coalesce(me, seats[1]);
  -- the legacy single-vampire surface (0222/0267): the caller's own seat
  -- when they run one, else the first of the coven — shipped APKs read on
  vrow := case when legacy is not null then _vampire_seat_state(p_league_id, legacy, wk) end;

  return jsonb_build_object(
    'vampire', true,
    'seats', to_jsonb(seats),
    'wire_lock', vampire_wire_lock_on(p_league_id),
    'steal_review', steal_review_on(p_league_id),
    'week', wk,
    'vampires', vrows,
    'seat', legacy,
    'seat_team', vrow ->> 'seat_team',
    'won', coalesce((vrow ->> 'won')::boolean, false),
    'victim', (vrow ->> 'victim')::int,
    'fed', coalesce((vrow ->> 'fed')::boolean, false),
    'record', vrow -> 'record',
    'weeks', coalesce(vrow -> 'weeks', '[]'::jsonb),
    'steals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'week', v.week, 'vampire', v.vampire, 'victim', v.victim,
        'victim_team', (select team_name from league_membership
          where league_id = p_league_id and sleeper_roster_id = v.victim),
        'take', v.take_slug, 'give', v.give_slug, 'status', v.status) order by v.week desc, v.vampire)
      from vampire_steal v where v.league_id = p_league_id), '[]'::jsonb));
end $$;

-- One vampire's chair: window + record + finaled weeks. Split out so the
-- state function reads as the shape it returns.
create or replace function _vampire_seat_state(p_league_id uuid, p_seat int, p_wk int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare mu matchup%rowtype; won boolean := false; victim int;
begin
  if p_wk is not null then
    select * into mu from matchup
      where league_id = p_league_id and week = p_wk
        and p_seat in (home_roster_id, away_roster_id) limit 1;
    if found then
      won := case when mu.home_roster_id = p_seat then mu.home_final > mu.away_final
                  else mu.away_final > mu.home_final end;
      victim := case when mu.home_roster_id = p_seat then mu.away_roster_id else mu.home_roster_id end;
    end if;
  end if;
  return jsonb_build_object(
    'seat', p_seat,
    'seat_team', (select team_name from league_membership
      where league_id = p_league_id and sleeper_roster_id = p_seat),
    'won', won,
    'victim', case when won then victim end,
    'fed', p_wk is not null and exists (select 1 from vampire_steal
      where league_id = p_league_id and week = p_wk and vampire = p_seat
        and status in ('pending', 'executed')),
    'record', (select jsonb_build_object(
        'wins',   count(*) filter (where (case when mx.home_roster_id = p_seat then mx.home_final else mx.away_final end)
                                       > (case when mx.home_roster_id = p_seat then mx.away_final else mx.home_final end)),
        'losses', count(*) filter (where (case when mx.home_roster_id = p_seat then mx.home_final else mx.away_final end)
                                      <= (case when mx.home_roster_id = p_seat then mx.away_final else mx.home_final end)))
      from matchup mx
      where mx.league_id = p_league_id and p_seat in (mx.home_roster_id, mx.away_roster_id)
        and mx.status = 'final' and mx.home_final is not null and mx.away_final is not null),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object(
        'week', w.week, 'opp', w.opp, 'opp_team', om.team_name,
        'for', w.pf, 'against', w.pa, 'won', w.pf > w.pa) order by w.week desc)
      from (
        select mx.week,
               case when mx.home_roster_id = p_seat then mx.away_roster_id else mx.home_roster_id end as opp,
               case when mx.home_roster_id = p_seat then mx.home_final else mx.away_final end as pf,
               case when mx.home_roster_id = p_seat then mx.away_final else mx.home_final end as pa
        from matchup mx
        where mx.league_id = p_league_id and p_seat in (mx.home_roster_id, mx.away_roster_id)
          and mx.status = 'final' and mx.home_final is not null and mx.away_final is not null
      ) w left join league_membership om
        on om.league_id = p_league_id and om.sleeper_roster_id = w.opp), '[]'::jsonb));
end $$;
