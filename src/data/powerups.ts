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
  { id: 'unlock-return', name: 'Return Yards', blurb: 'This week only: unlock the KR/PR Return Yards metric — 0.1/yd banked + a 0.003 drip multiplier.', kind: 'metric', timing: 'pre', price: 60, icon: '🏈' },
  { id: 'unlock-carries-wipe', name: 'WR/TE Carries', blurb: 'Arm before kickoff: all week, every carry by a WR or TE in your starting spots wipes its matched opponent to 0 — a plus-up on TOP of whatever metric that slot is scoring.', kind: 'action', timing: 'pre', price: 70, icon: '💥' },
  { id: 'unlock-combo-drip', name: 'Combo Drip', blurb: 'This week only: unlock a Rush + Receiving combo drip for one player — both carries AND catches feed a single drip rate (yds × 0.01 pts/min).', kind: 'metric', timing: 'pre', price: 65, icon: '🌀' },
  { id: 'unlock-pass-td10', name: 'Air Raid', blurb: 'This week only: unlock a QB metric where passing TDs are worth 10 pts (plus 0.04 / passing yd). Flat — no nuke or erase.', kind: 'metric', timing: 'pre', price: 60, icon: '🚀' },
  { id: 'trick-play', name: 'Trick Play', blurb: 'Arm before kickoff: if ANY non-QB in your starting spots throws a TD pass this week, your lineup banks a flat +50.', kind: 'action', timing: 'pre', price: 90, icon: '🎺' },
  { id: 'pick-six', name: 'Pick Six', blurb: 'Arm before kickoff: if any of your DST starters returns an INT or fumble for a touchdown, bank a flat +25.', kind: 'action', timing: 'pre', price: 45, icon: '🛡️' },
  { id: 'hail-mary', name: 'Hail Mary', blurb: 'Arm before kickoff: if a QB in your starting spots throws a touchdown of 40+ yards, bank a flat +15.', kind: 'action', timing: 'pre', price: 35, icon: '🙏' },
  { id: 'momentum', name: 'Momentum', blurb: 'Arm before kickoff: all week, your drips run 3× when hot instead of 2×.', kind: 'action', timing: 'pre', price: 70, icon: '📈' },
  { id: 'garbage-time', name: 'Garbage Time', blurb: 'Arm before kickoff: any points your players score in the final 5 game-minutes count double.', kind: 'action', timing: 'pre', price: 75, icon: '🗑️' },
  { id: 'floodgates', name: 'Floodgates', blurb: 'Arm before kickoff: your drips are immune to opponent pauses and erases all week (TD wipes still apply).', kind: 'action', timing: 'pre', price: 85, icon: '🌊' },
  { id: 'overtime', name: 'Overtime', blurb: 'Arm before kickoff: your drips keep accruing for 5 extra minutes after each game ends.', kind: 'action', timing: 'pre', price: 60, icon: '⏱️' },
  { id: 'counter-nuke', name: 'Counter-Nuke', blurb: 'Arm before kickoff: the first time an opponent nukes one of your slots, it is reflected back — their player is wiped instead.', kind: 'action', timing: 'pre', price: 95, icon: '↩️' },
  { id: 'insurance', name: 'Insurance', blurb: 'Arm before kickoff: the first time one of your slots is nuked, half its banked score is refunded instead of zeroed.', kind: 'action', timing: 'pre', price: 80, icon: '🛟' },
  { id: 'double-or-nothing', name: 'Double or Nothing', blurb: 'Stake one of your slots before kickoff: at FINAL it scores double if it wins its head-to-head, or zero if it loses.', kind: 'action', timing: 'pre', price: 80, icon: '⚖️', target: 'slot-you' },
  { id: 'spy', name: 'Spy', blurb: 'Before kickoff, reveal the hidden metric on one opponent slot.', kind: 'action', timing: 'pre', price: 40, icon: '👁️', target: 'slot-opp' },
  { id: 'bye-steal', name: 'Bye Steal', blurb: 'Before kickoff, field one of your players who is on bye in an open slot for a flat projected score.', kind: 'action', timing: 'pre', price: 55, icon: '🪂', target: 'bye' },
  { id: 'mulligan', name: 'Mulligan', blurb: 'Re-roll one slot’s metric mid-game for free — does not spend a Metric Swap.', kind: 'action', timing: 'live', price: 30, icon: '🎲', target: 'slot-you' },
  { id: 'emp', name: 'EMP', blurb: 'Fire during a live window to freeze every opponent drip in that window for 10 minutes.', kind: 'action', timing: 'live', price: 65, icon: '💥', target: 'window' },
  { id: 'turnover-boost', name: 'Ball Hawk', blurb: 'Arm before kickoff: raise the turnover coin swing from 10 to 25 this week, across all windows — your giveaways cost more, their giveaways pay more.', kind: 'action', timing: 'pre', price: 55, icon: '🦅' },
];

export function powerupById(id: string): Powerup | undefined {
  return POWERUPS.find((p) => p.id === id);
}
