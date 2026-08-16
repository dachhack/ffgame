// Native-league sweep (migration 0064): the worker-side safety net.
//
// Native leagues are self-driving from the client — the draft room's poll calls
// draft_tick and the team screen calls process_waivers — but both stall if no
// manager has the app open. This sweep keeps them moving:
//   • draft_tick     — autopicks every live draft whose seat is overdue, vacant,
//                      or AI-controlled (the RPC is idempotent + advisory-locked,
//                      so racing a browser's own tick is harmless).
//   • process_waivers — resolves pending claims whose 24h waiver window closed.
//   • auto_weekly_budget — credits each active week's coin allowance to every
//                      league that set one (0132). Same ledger idem_key as the
//                      commissioner's manual GRANT, so however many ticks — or
//                      button presses — hit a week, it pays exactly once.
// Lineup materialization needs no sweep: every roster-mutating RPC rewrites the
// still-scheduled weeks' sleeper_lineup itself.
import { db } from './supabase.js';

export async function sweepNative(log = () => {}, weeks = []) {
  let drafts = 0, won = 0, lost = 0, allowance = 0, started = 0;

  // Scheduled starts (0177) run FIRST, so a draft whose time arrived this
  // minute is live before the tick below looks for overdue seats — otherwise
  // its first pick would wait a whole sweep for its clock to be noticed.
  // One statement for every league; the RPC is the only thing that decides
  // whether a start is due, so there's no clock arithmetic out here.
  try {
    const { data } = await db().rpc('draft_autostart_sweep');
    started = Number(data?.started ?? 0);
    // A scheduled start that CAN'T run (unseeded pool, a seat short) retries on
    // later sweeps — logged every time, because a league sitting armed and
    // failing is exactly the thing nobody notices until draft night.
    for (const e of data?.errors ?? []) log('draft autostart blocked:', e.league_id, e.error);
  } catch (e) { log('draft_autostart_sweep', e.message); }

  const { data: live, error: de } = await db()
    .from('draft').select('league_id').eq('status', 'live');
  if (de) { log('native draft sweep', de.message); }
  for (const d of live ?? []) {
    try {
      const { data } = await db().rpc('draft_tick', { p_league_id: d.league_id });
      // snake autopicks + auction lot awards/auto-nominations, one counter
      drafts += Number(data?.autopicks ?? 0) + Number(data?.lots_awarded ?? 0);
    } catch (e) { log('draft_tick', d.league_id, e.message); }
  }

  const { data: pending, error: we } = await db()
    .from('waiver_claim').select('league_id').eq('status', 'pending');
  if (we) { log('native waiver sweep', we.message); }
  for (const leagueId of new Set((pending ?? []).map((c) => c.league_id))) {
    try {
      const { data } = await db().rpc('process_waivers', { p_league_id: leagueId });
      won += Number(data?.won ?? 0); lost += Number(data?.lost ?? 0);
    } catch (e) { log('process_waivers', leagueId, e.message); }
  }

  // The weekly allowance, one call per active board week (regular + preseason
  // contexts both pass theirs). Scope and idempotency live server-side.
  for (const w of new Set(weeks.filter((w) => Number.isInteger(w) && w > 0))) {
    try {
      const { data } = await db().rpc('auto_weekly_budget', { p_week: w });
      allowance += Number(data?.credited ?? 0);
    } catch (e) { log('auto_weekly_budget', w, e.message); }
  }

  return { autopicks: drafts, claimsWon: won, claimsLost: lost, allowance, drafted: started };
}
