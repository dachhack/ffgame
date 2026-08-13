-- 0132: the weekly allowance grants ITSELF — the worker's tick, not a button.
--
-- 0052 gave leagues a weekly_budget and the commissioner a per-week grant
-- (commish_grant_weekly_budget), idempotent via the ledger idem_key
-- 'weekly_budget:<league>:<week>:<roster>'. What it never got was a scheduler:
-- an allowance that arrives only when the commissioner remembers to press
-- GRANT isn't an allowance, it's a chore.
--
-- auto_weekly_budget(p_week) is that scheduler's server half: every league
-- whose weekly_budget > 0 AND that actually plays this week (a matchup row for
-- p_week exists — the natural opt-out for leagues sitting out a preseason
-- context or not yet scheduled) gets the same credit the button makes. The
-- idem_key format is IDENTICAL to 0052's on purpose — auto and manual are the
-- same grant, so whichever fires first wins and the other is a no-op. The
-- worker calls this each tick with each active context's board week
-- (server/src/native.js); ticks are seconds apart and every repeat is
-- absorbed by the ledger's conflict-do-nothing.
--
-- Worker-only, like adjust_wallet: no auth gate inside (auth.uid() is null on
-- the service connection), so it must never be callable by clients — the
-- commissioner keeps commish_grant_weekly_budget, which checks who's asking.
create or replace function auto_weekly_budget(p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0; leagues int := 0; lg record; rid int;
begin
  if p_week is null or p_week < 1 then return jsonb_build_object('ok', false, 'error', 'week required'); end if;
  for lg in select l.id, l.weekly_budget from league l
             where coalesce(l.weekly_budget, 0) > 0
               and exists (select 1 from matchup m where m.league_id = l.id and m.week = p_week) loop
    leagues := leagues + 1;
    for rid in select distinct sleeper_roster_id from league_membership where league_id = lg.id loop
      if adjust_wallet(lg.id, rid, null, p_week, lg.weekly_budget,
          'weekly_budget', 'weekly_budget:' || lg.id::text || ':' || p_week::text || ':' || rid::text) then
        n := n + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'credited', n, 'leagues', leagues, 'week', p_week);
end $$;
revoke all on function auto_weekly_budget(int) from public;
grant execute on function auto_weekly_budget(int) to service_role;
