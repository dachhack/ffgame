-- 0300 — THE BOT VAMPIRE BITES (v0.427.0)
--
-- Founder: "Let's have the bot vampire take a bite."
--
-- The steal has always been the vampire's OWN claim to make: vampire_steal
-- admitted the seat's owner, the commissioner and an admin, and vampire_state
-- (the window it reads) admitted a league member. A vampire seat nobody
-- manages — a 🤖 AI seat, or an unclaimed seat tended by its agent — could
-- win every week and never feed, which is a vampire league without a
-- vampire. 0298 let such a seat work the wire; this lets it bite.
--
-- THE SAME TERMS AS THE WIRE (0213/0298/0299): `auth.uid() is null and
-- agent_wire_seat(league, seat)` — the service role, for a seat nobody
-- holds. The worker names the seat (p_vampire) and every rule below is
-- 0297's, re-read rather than reconstructed: the latest fully-final regular
-- week, a WIN (a tie is not one), one bite per win, the beaten team's ACTIVE
-- roster, one of its own back, the commissioner's steal_review parking the
-- bite as pending, the 1-for-1 roster-shape check both ways in
-- _execute_steal. WHICH player, and which to give back, is the worker's
-- judgement (server/src/vampireBite.js, core's vampireBitePlan).
--
-- vampire_state admits the service role too, so the sweep reads the same
-- window the app shows rather than re-deriving it.

-- ── vampire_steal v4 (0297 body + the worker branch) ─────────────────────────
create or replace function vampire_steal(p_league_id uuid, p_take_slug text, p_give_slug text, p_vampire int default null)
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
  -- 0300: the WORKER may feed for a vampire seat nobody holds (0213's terms).
  if not (owns_roster(p_league_id, vamp) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, vamp))) then
    return jsonb_build_object('ok', false, 'error', 'only the vampire feeds');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text || ':steal'));
  -- the LATEST fully-final REGULAR-SEASON week is the only fresh win (0297:
  -- practice weeks 101+ are not the season and never open the window)
  select max(week) into wk from matchup m
  where m.league_id = p_league_id
    and not is_practice_week(m.week)
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

-- ── vampire_state v5 (0297 body + the worker branch) ─────────────────────────
create or replace function vampire_state(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seats int[]; wk int; s int; me int := null; legacy int;
        vrows jsonb := '[]'::jsonb; vrow jsonb;
begin
  -- 0300: the service role (no uid) reads the window too — the bite sweep.
  if not (auth.uid() is null or is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if league_format(p_league_id) <> 'vampire' then return jsonb_build_object('vampire', false); end if;
  seats := coalesce(vampire_seats(p_league_id), '{}');
  -- 0297: the window reads the regular season only — never a practice week
  select max(week) into wk from matchup m
  where m.league_id = p_league_id
    and not is_practice_week(m.week)
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
grant execute on function vampire_state(uuid) to authenticated;
