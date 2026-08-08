// Window Pot worker hook (migration 0106 · docs/window-pot.md).
//
// One touch point now that the ante is opt-in: there is nothing to do at lock,
// because nothing is automatic — a pot exists only because two managers put
// ◎10 each on a window themselves. What the worker owes them is the CLOSE:
//
//   • at picks lock (kickoff − 1h) — void an offer nobody picked up so the ◎10
//     goes home, and freeze a live ladder, returning any unmatched chips;
//   • at the window's final — pay the frozen pot to the window's winner.
//
// A manager with the board open sweeps their own matchup on every poll
// (any-member-advances, like draft_tick), so this is the safety net for the
// matchups nobody is watching — which, at a deadline that can land at 3am, is
// most of them.
//
// The first live-fire's best find was a silent write failure: supabase-js
// returns errors, it does not throw, so ingestion froze while the logs looked
// healthy. Every result below is checked and every failure is thrown to the
// tick's catch, where it prints as a real error.
import { db } from './supabase.js';

/** One sweep across every pot that can still move. The RPC is advisory-locked
 *  per matchup and state-guarded, so racing a manager's own browser poll is
 *  harmless, and a replay after a restart is a no-op. */
export async function sweepPots(log = () => {}) {
  const { data, error } = await db().rpc('pot_sweep', { p_matchup_id: null });
  if (error) throw new Error(`pot_sweep: ${error.message}`);
  if (data?.ok === false) throw new Error(`pot_sweep: ${data.error}`);
  const r = {
    voided: Number(data?.voided ?? 0),
    frozen: Number(data?.frozen ?? 0),
    settled: Number(data?.settled ?? 0),
  };
  if (r.voided || r.frozen || r.settled) {
    log('window pots:', r.voided, 'offers voided,', r.frozen, 'frozen at lock,', r.settled, 'settled');
  }
  return r;
}
