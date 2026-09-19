-- 0297 — PRACTICE WEEKS ARE NOT FRESH BLOOD (v0.425.0)
--
-- Founder: "Looks like the vampire lost but took Amon-Ra. Should have not
-- been able to take a player."
--
-- THE HOLE. The steal window is "the LATEST fully-final week" — `max(week)`
-- over the league's matchups — and every other reader of that window
-- (vampire_state, the per-chair record and week list) uses the same query.
-- None of them excluded the PRESEASON PRACTICE weeks (0110: board weeks
-- 101-103, `is_practice_week`). A league that played its practice weeks has
-- final rows at 101+ for the rest of the season, so `max(week)` answers 103
-- FOREVER — week 1 finaling changes nothing, because 1 < 103. If the vampire
-- happened to win practice week 103, its window stayed open all season on
-- that win, naming the practice-week opponent as the victim, while the real
-- week-1 loss sat unread beneath it. That is a vampire that lost week 1 and
-- still bit someone. The standings (0269 league_standings) and the practice
-- wallet already treat 101+ as not-the-season; the vampire didn't.
--
-- THE FIX. One filter, `not is_practice_week(week)`, in every place the
-- vampire reads a result: the fresh-win window in vampire_steal and
-- vampire_state, and the record + week list in _vampire_seat_state. Bodies
-- are 0268's, re-read rather than reconstructed, with only that filter added.
-- The guillotine (0249 guillotine_tick) has the same `max(week)` and the
-- same exposure; it is left for its own change so this one stays about the
-- vampire — note it in the audit.
--
-- WHAT THIS DOES NOT DO. It does not void a steal already executed on a
-- practice-week win: the players moved, the register printed the bite, and
-- unwinding that is the commissioner's call (a trade or commish move puts it
-- back). It stops the next one.

-- ── vampire_steal v3 (0268 body + the practice filter) ───────────────────────
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
  if not (owns_roster(p_league_id, vamp) or is_league_commish(p_league_id) or is_admin()) then
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

-- ── vampire_state v4 (0268 body + the practice filter) ───────────────────────
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

-- ── one chair (0268 body): the record and the week list skip practice too ────
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
        and mx.status = 'final' and mx.home_final is not null and mx.away_final is not null
        and not is_practice_week(mx.week)),
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
          and not is_practice_week(mx.week)
      ) w left join league_membership om
        on om.league_id = p_league_id and om.sleeper_roster_id = w.opp), '[]'::jsonb));
end $$;
