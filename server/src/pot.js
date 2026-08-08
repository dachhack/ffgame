// Window Pot worker hooks (migration 0106 · docs/window-pot.md).
//
// Two touch points, both idempotent, both no-ops for a league with pot_ante = 0
// (the shipping default — the DB refuses to create a pot at all):
//
//   • anteDueMatchups — at MATCHUP LOCK, ante both sides into every window of
//     the week. Runs after lock.js has materialized auto-lineups, because the AI
//     budget pass seeds an AI seat's wallet there; anteing first would short-ante
//     (S7) a seat that is about to be funded.
//   • sweepPots       — every TICK: expire response clocks (S5), force street
//     closes at kickoff (S9), and settle finished windows (S13). Settlement
//     rides the same pass that publishes matchup_state — the scores the +5
//     window bonus is paid off — so the pot pays out of exactly the numbers the
//     board shows.
//
// The first live-fire's best find was a silent write failure: supabase-js
// returns errors, it does not throw, so ingestion froze while the logs looked
// healthy. Every result below is checked and every failure is thrown to the
// tick's catch, where it prints as a real error.
import { db } from './supabase.js';

/** Ante a freshly locked matchup's windows. Idempotent per matchup — a re-lock
 *  finds the pot rows already there and moves no coin. */
export async function anteDueMatchups(matchupIds, log = () => {}) {
  let pots = 0, coin = 0;
  for (const id of matchupIds ?? []) {
    const { data, error } = await db().rpc('pot_ante_all', { p_matchup_id: id });
    if (error) throw new Error(`pot_ante_all ${id}: ${error.message}`);
    if (data?.ok === false) throw new Error(`pot_ante_all ${id}: ${data.error}`);
    if (data?.off) continue;                     // league flag is 0 — feature off
    pots += Number(data?.pots ?? 0);
    coin += Number(data?.coin ?? 0);
  }
  if (pots) log('window pots: anted', pots, 'pots,', coin, 'coin committed');
  return { pots, coin };
}

/** One sweep across every open pot: clocks, street closes, settlements. The RPC
 *  is advisory-locked per matchup and state-guarded, so racing a manager's own
 *  browser poll (which calls pot_sweep for its own matchup) is harmless. */
export async function sweepPots(log = () => {}) {
  const { data, error } = await db().rpc('pot_sweep', { p_matchup_id: null });
  if (error) throw new Error(`pot_sweep: ${error.message}`);
  if (data?.ok === false) throw new Error(`pot_sweep: ${data.error}`);
  const r = {
    clocks: Number(data?.resolved_clocks ?? 0),
    closed: Number(data?.streets_closed ?? 0),
    settled: Number(data?.settled ?? 0),
  };
  if (r.clocks || r.closed || r.settled) {
    log('window pots:', r.clocks, 'clocks resolved,', r.closed, 'streets closed,', r.settled, 'settled');
  }
  return r;
}
