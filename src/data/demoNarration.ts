import type { PbpEvent } from '../types';

// Plain-English narration layer for the guided demo. Maps the deterministic
// engine's play-by-play events into teaching beats so a first-time viewer can
// follow the REAL live board without knowing any of the jargon. Kept pure (no
// React) so both the demo board and any future onboarding can reuse it.

export interface Beat { clock: number; key: string; icon: string; title: string; body: string; }

export const FX_COLOR: Record<string, string> = {
  nuke: 'var(--fx-nuke, #FF4F62)', erase: 'var(--fx-erase, #FF8A3D)', streak: 'var(--fx-streak, #36D399)',
  cold: 'var(--fx-stop, #6E7B8C)', mult: 'var(--fx-mult, #C58BFF)', compression: 'var(--fx-compression, #F4C95D)',
  reset: 'var(--fx-reset, #5BC0EB)', stop: 'var(--fx-stop, #6E7B8C)',
  hot: 'var(--fx-streak, #36D399)', coin: 'var(--you)', drip: 'var(--you)', intro: 'var(--you)',
  power: 'var(--fx-streak, #36D399)', freeze: 'var(--fx-reset, #5BC0EB)',
};

/** Map a play-by-play event to a plain-English teaching beat (or null). */
export function lessonFor(e: PbpEvent): Omit<Beat, 'clock'> | null {
  if (e.effect) {
    switch (e.effect.type) {
      case 'nuke': return { key: 'nuke', icon: '💥', title: 'NUKE', body: 'A touchdown just wiped the other side’s entire banked score to zero.' };
      case 'erase': return { key: 'erase', icon: '🩸', title: 'ERASE', body: 'That catch erased the last 10 minutes of the opponent’s drip.' };
      case 'streak': return { key: 'hot', icon: '🔥', title: 'HOT', body: 'Scores keep coming with no answer — the drip rate just doubled.' };
      case 'cold': return { key: 'cold', icon: '🧊', title: 'COLD', body: 'The opponent finally answered — the hot streak cooled back down.' };
      case 'reset': return { key: 'reset', icon: '↺', title: 'RATE RESET', body: 'A catch zeroed the opponent’s drip rate — they keep the bank, but rebuild from scratch.' };
      case 'stop': return { key: 'stop', icon: '⏸', title: 'CLOCK STOP', body: 'A target froze the opponent’s drip clock — pure denial, no erase.' };
      case 'compression': return { key: 'compression', icon: '🗜️', title: 'COMPRESSION', body: 'A carry streak is trimming the opponent’s most recent score, bit by bit.' };
      case 'mult': return { key: 'mult', icon: '⚡', title: 'MULTIPLIER', body: 'A Field General QB is multiplying his skill players’ drip — he scores nothing himself.' };
    }
  }
  if (e.buffNote) return { key: 'power', icon: '🗑️', title: 'POWER-UP', body: 'A power-up you armed before kickoff just fired — Garbage Time doubles every point scored in the final five minutes.' };
  if (e.coin) return { key: 'coin', icon: '◇', title: 'DRIP COIN', body: 'Big “events of note” pay drip-coin — the currency you spend on power-ups.' };
  if (e.drip) return { key: 'drip', icon: '💧', title: 'DRIP', body: 'Points trickle in every minute while this player’s team has the ball.' };
  return null;
}

/** Ordered teaching beats from a window's events: each concept taught once,
 *  except NUKE/ERASE which are dramatic enough to re-narrate every time. */
export function buildBeats(events: PbpEvent[]): Beat[] {
  const out: Beat[] = [];
  const taught = new Set<string>();
  for (const e of [...events].sort((a, b) => a.clock - b.clock)) {
    const l = lessonFor(e);
    if (!l) continue;
    const repeatable = l.key === 'nuke' || l.key === 'erase';
    if (!repeatable && taught.has(l.key)) continue;
    taught.add(l.key);
    out.push({ clock: e.clock, ...l });
  }
  return out;
}

export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
