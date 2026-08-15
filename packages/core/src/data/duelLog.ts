// The live per-duel log (0193) — the founder's "minutes view in the app".
//
// The app's live board is server-score-driven and never runs the engine; the
// MINUTES log IS the engine's event stream, so the board couldn't show one.
// This helper is the bridge: a PURE resolver call over what the board already
// holds — revealed picks for both sides, the two buff sets, and the week's
// plays (which the board's refresh already injects via setLivePlays). One
// call per log-open, nothing polled.
//
// Fidelity note: this is the WEB HERO BOARD's knowledge set, not the
// worker's — a member can't see the opponent's targeted extras (EMP, swaps),
// so a duel where those fired can read slightly under the official bank, the
// same way the web's client resolution does. The BANK NOW line in PlayLog
// reconciles against these events, so the log stays internally consistent.
import type { PbpEvent, Player } from '../types';
import { resolveLiveMatchup, type LivePick } from '../engine/liveResolve';
import { defaultMetric } from './metrics';
import { slugMeta } from './slugMeta';
import type { RevealedPick } from './liveApi';

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };

// The engine reads a live player's plays by id (the slug); baked-stat zeros
// are correct here — same construction forceResolve uses for real previews.
function mkPlayer(slug: string): Player {
  const m = slugMeta(slug);
  return { id: slug, name: slug, full: slug, pos: m.pos, team: m.team, stats: { ...ZERO } };
}

const toLive = (p: RevealedPick): LivePick | null => {
  if (!p.player_slug) return null;
  const pos = slugMeta(p.player_slug).pos;
  return {
    win: p.game_window, slot: p.roster_slot,
    player: mkPlayer(p.player_slug),
    metricId: p.metric_id || defaultMetric(pos).id,
  };
};

/** Resolve the matchup once (events captured) and hand back each duel's raw
 *  stream, keyed `${win}|${slot}`, with `you`/`their` normalized to the
 *  CALLER's side. Requires the week's plays already injected (setLivePlays —
 *  the app board's refresh does this). */
export function liveDuelEvents(
  mine: RevealedPick[], theirs: RevealedPick[], week: number, youAreHome: boolean,
  myBuffs: string[] = [], oppBuffs: string[] = [],
): Map<string, PbpEvent[]> {
  const my = mine.map(toLive).filter((p): p is LivePick => !!p);
  const th = theirs.map(toLive).filter((p): p is LivePick => !!p);
  const home = youAreHome ? my : th;
  const away = youAreHome ? th : my;
  const res = resolveLiveMatchup(home, away, week, {
    homeBuffs: new Set(youAreHome ? myBuffs : oppBuffs),
    awayBuffs: new Set(youAreHome ? oppBuffs : myBuffs),
    captureEvents: true,
  });
  const out = new Map<string, PbpEvent[]>();
  for (const s of res.slotEvents ?? []) {
    // Event streams speak home-relative ('you' = home); flip for an away caller.
    const events = youAreHome ? s.events : s.events.map((e) => ({
      ...e,
      side: e.side === 'you' ? 'their' as const : 'you' as const,
      youBank: e.theirBank, theirBank: e.youBank,
    }));
    out.set(`${s.win}|${s.slot}`, events);
  }
  return out;
}
