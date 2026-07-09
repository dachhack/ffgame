// Powerup catalog for the drip-coin economy. Everything is a consumable —
// bought into inventory (qty) and spent when applied. Two kinds by effect:
//   • action — a one-time tactical effect (swap, extra slot)
//   • metric — enables an extra metric for the CURRENT WEEK only (not permanent)
// Timing gates how/when a powerup may be APPLIED (phase-based in the demo):
//   • 'pre'  — pre-match: appliable during SETUP, locks once any window starts
//   • 'live' — real-time: appliable anytime a window is live (not retroactive)
export type PowerupTiming = 'pre' | 'live';
export type PowerupKind = 'action' | 'metric';

// What a powerup must be pointed at when applied (undefined = no target; it's a
// whole-lineup buff armed with one click).
export type PowerupTarget = 'slot-you' | 'slot-opp' | 'bye' | 'window';

export interface Powerup {
  id: string;
  name: string;
  blurb: string;
  kind: PowerupKind;
  timing: PowerupTiming;
  price: number;
  icon: string;
  target?: PowerupTarget;
}

export const POWERUPS: Powerup[] = [
  { id: 'metric-swap', name: 'Metric Swap', blurb: 'Change a slot’s effective metric. Real-time — applies going forward, not retroactive.', kind: 'action', timing: 'live', price: 30, icon: '🔀' },
  { id: 'player-swap', name: 'Player Swap', blurb: 'Swap a slotted player for one on your bench — anytime, even mid-game.', kind: 'action', timing: 'live', price: 50, icon: '🔁' },
  { id: 'extra-slot', name: 'Extra Slot', blurb: 'Add a slot to any window — for you AND your opponent. Must be applied before any window starts.', kind: 'action', timing: 'pre', price: 80, icon: '➕' },
  { id: 'unlock-return', name: 'Return Yards', blurb: 'This week only: unlock the Return Yards metric for a kick/punt returner — flat 0.1 pts per real return yard + 6 per return TD.', kind: 'metric', timing: 'pre', price: 60, icon: '🏈' },
  { id: 'unlock-carries-wipe', name: 'WR/TE Carries', blurb: 'Arm before kickoff: all week, every carry by a WR or TE in your starting spots wipes its matched opponent to 0 — a plus-up on TOP of whatever metric that slot is scoring.', kind: 'action', timing: 'pre', price: 70, icon: '💥' },
  { id: 'unlock-combo-drip', name: 'Combo Drip', blurb: 'This week only: unlock a Rush + Receiving combo drip for ONE player — both carries AND catches feed a single drip rate (yds × 0.01 pts/min). One slot per purchase: buy it again to field another.', kind: 'metric', timing: 'pre', price: 65, icon: '🌀' },
  { id: 'unlock-pass-td10', name: 'Air Raid', blurb: 'This week only: unlock a QB metric where passing TDs are worth 10 pts (plus 0.04 / passing yd). Flat — no nuke or erase.', kind: 'metric', timing: 'pre', price: 40, icon: '🚀' },
  { id: 'trick-play', name: 'Trick Play', blurb: 'Arm before kickoff: if ANY non-QB in your starting spots throws a TD pass this week, your lineup banks a flat +50.', kind: 'action', timing: 'pre', price: 90, icon: '🎺' },
  { id: 'pick-six', name: 'Pick Six', blurb: 'Arm before kickoff: if any of your DST starters returns an INT or fumble for a touchdown, bank a flat +25.', kind: 'action', timing: 'pre', price: 45, icon: '🛡️' },
  { id: 'hail-mary', name: 'Hail Mary', blurb: 'Arm before kickoff: if a QB in your starting spots throws a touchdown of 40+ yards, bank a flat +15.', kind: 'action', timing: 'pre', price: 35, icon: '🙏' },
  { id: 'momentum', name: 'Momentum', blurb: 'Arm before kickoff: all week, your drips run 3× when hot instead of 2×.', kind: 'action', timing: 'pre', price: 70, icon: '📈' },
  { id: 'garbage-time', name: 'Garbage Time', blurb: 'Arm before kickoff: any points your players score in the final 5 game-minutes count double.', kind: 'action', timing: 'pre', price: 75, icon: '🗑️' },
  { id: 'amp-2', name: 'Second Amp', blurb: 'Amplifiers (Momentum · Overtime · Garbage Time) are limited to ONE per week. Arm this to run a second one alongside it.', kind: 'action', timing: 'pre', price: 40, icon: '🔊' },
  { id: 'amp-3', name: 'Third Amp', blurb: 'The full stack: with Second Amp armed, this unlocks a third amplifier for the week — Momentum, Overtime AND Garbage Time together.', kind: 'action', timing: 'pre', price: 60, icon: '📢' },
  { id: 'floodgates', name: 'Floodgates', blurb: 'Arm before kickoff: your drips are immune to opponent pauses and erases all week (TD wipes still apply).', kind: 'action', timing: 'pre', price: 85, icon: '🌊' },
  { id: 'overtime', name: 'Overtime', blurb: 'Arm before kickoff: your Field General multiplier and drips carry into overtime. Without it they reset the moment regulation ends.', kind: 'action', timing: 'pre', price: 60, icon: '⏱️' },
  { id: 'ot-shield', name: 'Overtime Shield', blurb: 'Arm before kickoff: any points your opponent scores in overtime this week are negated.', kind: 'action', timing: 'pre', price: 70, icon: '🧊' },
  { id: 'fg-stack', name: 'Twin Generals', blurb: 'Arm before kickoff: a second Field General QB in the same window stacks — the top two multipliers multiply together instead of you taking just the higher one.', kind: 'action', timing: 'pre', price: 85, icon: '🎖️' },
  { id: 'counter-nuke', name: 'Counter-Nuke', blurb: 'Arm before kickoff: the first time an opponent nukes one of your slots, it is reflected back — their player is wiped instead.', kind: 'action', timing: 'pre', price: 95, icon: '↩️' },
  { id: 'insurance', name: 'Insurance', blurb: 'Arm before kickoff: the first time one of your slots is nuked, half its banked score is refunded instead of zeroed.', kind: 'action', timing: 'pre', price: 80, icon: '🛟' },
  { id: 'double-or-nothing', name: 'Double or Nothing', blurb: 'Stake one of your slots before kickoff: at FINAL it scores double if it wins its head-to-head, or zero if it loses.', kind: 'action', timing: 'pre', price: 80, icon: '⚖️', target: 'slot-you' },
  { id: 'rivalry', name: 'Rivalry', blurb: 'Arm on a window before kickoff (blind): for every slot where your opponent fields the SAME position as you, siphon 50% of that opponent’s slot score to you at the window’s end. Whiffs entirely if they don’t mirror your position — a bet on how they build the window.', kind: 'action', timing: 'pre', price: 70, icon: '⚔️', target: 'window' },
  { id: 'spy', name: 'Spy', blurb: 'Before a window kicks off: pick any slate slot (blind) and reveal the opponent’s current sealed pick there — their player OR their chosen metric. They can still change it until kickoff; re-checking your peek is free.', kind: 'action', timing: 'pre', price: 40, icon: '👁️', target: 'slot-opp' },
  { id: 'bye-steal', name: 'Bye Steal', blurb: 'Before kickoff, field one of your players who is on bye in an open slot for a flat projected score.', kind: 'action', timing: 'pre', price: 55, icon: '🪂', target: 'bye' },
  { id: 'mulligan', name: 'Mulligan', blurb: 'Re-roll one slot’s metric mid-game for free — does not spend a Metric Swap.', kind: 'action', timing: 'live', price: 30, icon: '🎲', target: 'slot-you' },
  { id: 'emp', name: 'EMP', blurb: 'Fire during a live window to freeze every opponent drip in that window for 10 minutes.', kind: 'action', timing: 'live', price: 65, icon: '💥', target: 'window' },
  { id: 'turnover-boost', name: 'Ball Hawk', blurb: 'Arm before kickoff: raise the turnover coin swing from 10 to 25 this week, across all windows — your giveaways cost more, their giveaways pay more.', kind: 'action', timing: 'pre', price: 55, icon: '🦅' },
];

export function powerupById(id: string): Powerup | undefined {
  return POWERUPS.find((p) => p.id === id);
}

// ── Drip AMPLIFIERS are capacity-limited ─────────────────────────────────────
// Momentum / Overtime / Garbage Time all multiply the same drip accrual, and
// the measured meta (findings §2/§12) is "everyone stacks all three". Capacity
// replaces the old anything-goes stack: ONE amplifier per week by default; the
// Second Amp (◎40) and Third Amp (◎60) power-ups raise the cap to 2 and 3 —
// the full stack now costs its amps PLUS ◎100 of capacity, priced as product
// instead of a hidden surcharge.
export const AMPLIFIERS = ['momentum', 'garbage-time', 'overtime'] as const;
export const isAmplifier = (id: string): boolean => (AMPLIFIERS as readonly string[]).includes(id);

/** How many amplifiers a buff set may run: 1 + Second Amp + Third Amp. */
export function ampCapacity(buffs: ReadonlySet<string>): number {
  return 1 + (buffs.has('amp-2') ? 1 : 0) + (buffs.has('amp-2') && buffs.has('amp-3') ? 1 : 0);
}

/** Authoritative engine-side cap: drop amplifiers beyond capacity, in fixed
 *  priority order (momentum > garbage-time > overtime) so every surface —
 *  worker, demo, playtester — resolves the same set regardless of arm order. */
export function capAmplifiers(buffs: ReadonlySet<string>): Set<string> {
  const cap = ampCapacity(buffs);
  const armed = (AMPLIFIERS as readonly string[]).filter((a) => buffs.has(a));
  if (armed.length <= cap) return new Set(buffs);
  const keep = new Set(armed.slice(0, cap));
  const out = new Set<string>();
  for (const b of buffs) if (!isAmplifier(b) || keep.has(b)) out.add(b);
  return out;
}
