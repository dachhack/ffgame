// Native-league sweep (migration 0064): the worker-side safety net.
//
// Native leagues are self-driving from the client — the draft room's poll calls
// draft_tick and the team screen calls process_waivers — but both stall if no
// manager has the app open. This sweep keeps them moving:
//   • draft_tick     — autopicks every live draft whose seat is overdue, vacant,
//                      or AI-controlled (the RPC is idempotent + advisory-locked,
//                      so racing a browser's own tick is harmless).
//   • process_waivers — resolves pending claims whose 24h waiver window closed.
// Lineup materialization needs no sweep: every roster-mutating RPC rewrites the
// still-scheduled weeks' sleeper_lineup itself.
import { db } from './supabase.js';

export async function sweepNative(log = () => {}) {
  let drafts = 0, won = 0, lost = 0;

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

  return { autopicks: drafts, claimsWon: won, claimsLost: lost };
}
