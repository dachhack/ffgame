-- 0245: A GUILLOTINE LEAGUE PLAYS ALL 17 WEEKS.
--
-- Founder: "Guillotine leagues go all 17 weeks. let's make sure that is wired
-- in."
--
-- Two halves. The CLIENTS now generate at scheduleWeeksFor(format) when the
-- league is created (core/data/league.ts owns that number so neither host
-- decides the season's length on its own). This is the other half: a
-- commissioner who flips an existing league to guillotine, on either host,
-- gets its schedule re-cut to 17 without the client having to remember.
--
-- The body is copied from 0221, the live definition, with the block at the end
-- added and three locals declared. Every guard it already had still stands —
-- and those guards are exactly what makes regenerating safe here.

create or replace function set_league_format(p_league_id uuid, p_format text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; f text; wks int; want int; sched jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  f := lower(btrim(coalesce(p_format, 'standard')));
  if f not in ('standard', 'guillotine', 'vampire') then
    return jsonb_build_object('ok', false, 'error', 'format must be standard, guillotine or vampire');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if f = 'guillotine' and d.status <> 'pending'
     and league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', false, 'error', 'guillotine must be chosen before the draft — it changes how the season scores');
  end if;
  if exists (select 1 from league_membership where league_id = p_league_id and eliminated_week is not null) then
    return jsonb_build_object('ok', false, 'error', 'the blade has already fallen — the format is locked for the season');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('format', f)
      || case when f = 'guillotine'
           then jsonb_build_object('waiver_mode', 'faab',
                  'faab_budget', coalesce(nullif(settings_json ->> 'faab_budget', '')::int, 1000))
           else '{}'::jsonb end
    where id = p_league_id;
  -- THE SEASON'S LENGTH FOLLOWS THE FORMAT (0245). A guillotine league has no
  -- playoffs to leave room for, so weeks 15-17 are regular season; and since
  -- one team falls per completed week, N teams need N-1 scored weeks to reach
  -- a winner. At 14 the format capped out at 15 teams and simply ended with
  -- several alive.
  --
  -- Done HERE rather than in each client so a commissioner who flips the
  -- format after the league exists gets the right season on both hosts. It is
  -- SAFE precisely where this function already is: the guards above refuse
  -- guillotine once the draft has left 'pending' or the blade has fallen, and
  -- native_generate_schedule itself refuses to touch a schedule holding any
  -- matchup that is not still 'scheduled'.
  --
  -- Only when a schedule ALREADY EXISTS. At creation there is none yet — the
  -- client generates it moments later at scheduleWeeksFor(format) — and
  -- regenerating an empty schedule here would be a no-op the client then
  -- overwrites anyway.
  if exists (select 1 from matchup where league_id = p_league_id) then
    wks := (select count(distinct week) from matchup where league_id = p_league_id);
    want := case when f = 'guillotine' then 17 else 14 end;
    if wks <> want then
      sched := native_generate_schedule(p_league_id, want);
      if not coalesce((sched ->> 'ok')::boolean, false) then
        -- the format IS set; say what could not follow it rather than lying
        return jsonb_build_object('ok', true, 'format', f,
          'schedule_error', sched ->> 'error', 'weeks', wks);
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'format', f,
    'weeks', (select count(distinct week) from matchup where league_id = p_league_id));
end $$;
grant execute on function set_league_format(uuid, text) to authenticated;
