-- 0250 — ⚡ ADMIN STAMP-WEEK: complete a sandbox league's week on demand.
--
-- Founder: "how can I play test the vampire and guillotine mechanics?" Both
-- formats arm off the same gate — a FULLY-FINAL week (every matchup 'final'
-- with stamped scores): the guillotine's blade falls per completed week, and
-- the vampire's steal window opens only on the LATEST fully-final week it won.
-- Until now only the worker produced such weeks, on the real NFL calendar —
-- so the full arc (blade → frenzy → steal → ruling → register) could not be
-- rehearsed before Sep 9. This is the missing lever: one admin RPC that
-- writes plausible finals across one week of a SANDBOX league, so a 6-team
-- guillotine league plays six weeks in ten minutes, in the real UI.
--
-- DOUBLE-GATED so it can never touch a real league: is_admin() AND the league
-- must be in 🧪 LIVE TEST (test_live_at set — the admin panel's existing
-- sandbox flag, 0053). No real league runs under live test; an admin who
-- flips it on a real league has bigger problems than this function.
--
-- KNOBS, for steering a story instead of rolling dice:
--   p_favor — that seat WINS its matchup (beats its opponent by 5–20). The
--             vampire playtest: favor the vampire, the steal window opens.
--   p_doom  — that seat takes the week's floor (35–45, under everyone's 70+).
--             The guillotine playtest: choose the blade's next neck.
-- Scores are otherwise random 70.0–130.0. p_week null = the earliest week
-- still missing finals, so repeated taps walk the season forward.
--
-- After stamping, the format's own engine fires the way the worker's hourly
-- sweep would — guillotine_tick for guillotine — so the admin sees the
-- consequence immediately, not an hour later. For vampire the result says
-- whether the vampire won (the steal is the vampire's own claim to make).

create or replace function admin_stamp_week(p_league_id uuid, p_week int default null,
                                            p_favor int default null, p_doom int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare tl timestamptz; fmt text; wk int; n int := 0; r jsonb;
        vamp int; mu matchup%rowtype; won boolean;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select test_live_at into tl from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no league'); end if;
  if tl is null then
    return jsonb_build_object('ok', false, 'error', 'sandbox only — flip LIVE TEST on this league first');
  end if;
  fmt := league_format(p_league_id);

  wk := p_week;
  if wk is null then
    select min(week) into wk from matchup
      where league_id = p_league_id
        and (status <> 'final' or home_final is null or away_final is null);
    if wk is null then return jsonb_build_object('ok', false, 'error', 'nothing left to stamp'); end if;
  end if;

  -- Plausible finals on every not-yet-final matchup of the week; a row already
  -- carrying a score keeps it (only the missing side and the status change).
  update matchup set status = 'final',
      home_final = coalesce(home_final, round((70 + random() * 60)::numeric, 1)),
      away_final = coalesce(away_final, round((70 + random() * 60)::numeric, 1))
    where league_id = p_league_id and week = wk
      and (home_final is null or away_final is null or status <> 'final');
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'week ' || wk || ' has no unstamped matchups'); end if;

  if p_favor is not null then
    update matchup set
        home_final = case when home_roster_id = p_favor then round((away_final + 5 + random() * 15)::numeric, 1) else home_final end,
        away_final = case when away_roster_id = p_favor then round((home_final + 5 + random() * 15)::numeric, 1) else away_final end
      where league_id = p_league_id and week = wk
        and p_favor in (home_roster_id, away_roster_id);
  end if;
  -- Applied after favor, and wins over it — a doomed seat is doomed.
  if p_doom is not null then
    update matchup set
        home_final = case when home_roster_id = p_doom then round((35 + random() * 10)::numeric, 1) else home_final end,
        away_final = case when away_roster_id = p_doom then round((35 + random() * 10)::numeric, 1) else away_final end
      where league_id = p_league_id and week = wk
        and p_doom in (home_roster_id, away_roster_id);
  end if;

  r := jsonb_build_object('ok', true, 'week', wk, 'stamped', n);
  if fmt = 'guillotine' then
    r := r || jsonb_build_object('eliminated', coalesce((guillotine_tick(p_league_id) ->> 'eliminated')::int, 0));
  elsif fmt = 'vampire' then
    vamp := vampire_seat(p_league_id);
    if vamp is not null then
      select * into mu from matchup
        where league_id = p_league_id and week = wk and vamp in (home_roster_id, away_roster_id)
        limit 1;
      if found then
        won := case when mu.home_roster_id = vamp then mu.home_final > mu.away_final
                    else mu.away_final > mu.home_final end;
        r := r || jsonb_build_object('vampire_won', won);
      end if;
    end if;
  end if;
  return r;
end $$;
grant execute on function admin_stamp_week(uuid, int, int, int) to authenticated;
