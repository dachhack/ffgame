// Powerup catalog for the drip-coin economy. Everything is a consumable —
// bought into inventory (qty) and spent when applied. Two kinds by effect:
//   • action — a one-time tactical effect (swap, extra slot)
//   • metric — enables an extra metric for the CURRENT WEEK only (not permanent)
// Timing gates how/when a powerup may be APPLIED (phase-based in the demo):
//   • 'pre'  — pre-match: appliable during SETUP, locks once any window starts
//   • 'live' — real-time: appliable anytime a window is live (not retroactive)
export type PowerupTiming = 'pre' | 'live';
export type PowerupKind = 'action' | 'metric';

export interface Powerup {
  id: string;
  name: string;
  blurb: string;
  kind: PowerupKind;
  timing: PowerupTiming;
  price: number;
  icon: string;
}

export const POWERUPS: Powerup[] = [
  { id: 'metric-swap', name: 'Metric Swap', blurb: 'Change a slot’s effective metric. Real-time — applies going forward, not retroactive.', kind: 'action', timing: 'live', price: 30, icon: '🔀' },
  { id: 'player-swap', name: 'Player Swap', blurb: 'Swap a slotted player for one on your bench — anytime, even mid-game.', kind: 'action', timing: 'live', price: 50, icon: '🔁' },
  { id: 'extra-slot', name: 'Extra Slot', blurb: 'Add a slot to any window — for you AND your opponent. Must be applied before any window starts.', kind: 'action', timing: 'pre', price: 80, icon: '➕' },
  { id: 'unlock-return', name: 'Return Yards', blurb: 'This week only: unlock the KR/PR Return Yards metric — 0.1/yd banked + a 0.003 drip multiplier.', kind: 'metric', timing: 'pre', price: 60, icon: '🏈' },
  { id: 'unlock-carries-wipe', name: 'WR/TE Carries', blurb: 'This week only: unlock a WR/TE carries metric that wipes the opposing player to 0 the moment it fires.', kind: 'metric', timing: 'pre', price: 70, icon: '💥' },
  { id: 'unlock-combo-drip', name: 'Combo Drip', blurb: 'This week only: unlock a Rush + Receiving combo drip for one player — both carries AND catches feed a single drip rate (yds × 0.01 pts/min).', kind: 'metric', timing: 'pre', price: 65, icon: '🌀' },
  { id: 'unlock-pass-td10', name: 'Air Raid', blurb: 'This week only: unlock a QB metric where passing TDs are worth 10 pts (plus 0.04 / passing yd). Flat — no nuke or erase.', kind: 'metric', timing: 'pre', price: 60, icon: '🚀' },
  { id: 'trick-play', name: 'Trick Play', blurb: 'Arm before kickoff: if ANY non-QB in your starting spots throws a TD pass this week, your lineup banks a flat +50.', kind: 'action', timing: 'pre', price: 90, icon: '🎺' },
  { id: 'pick-six', name: 'Pick Six', blurb: 'Arm before kickoff: if any of your DST starters returns an INT or fumble for a touchdown, bank a flat +25.', kind: 'action', timing: 'pre', price: 45, icon: '🛡️' },
  { id: 'hail-mary', name: 'Hail Mary', blurb: 'Arm before kickoff: if a QB in your starting spots throws a touchdown of 40+ yards, bank a flat +15.', kind: 'action', timing: 'pre', price: 35, icon: '🙏' },
  { id: 'momentum', name: 'Momentum', blurb: 'Arm before kickoff: all week, your drips run 3× when hot instead of 2×.', kind: 'action', timing: 'pre', price: 70, icon: '📈' },
  { id: 'garbage-time', name: 'Garbage Time', blurb: 'Arm before kickoff: any points your players score in the final 5 game-minutes count double.', kind: 'action', timing: 'pre', price: 75, icon: '🗑️' },
  { id: 'floodgates', name: 'Floodgates', blurb: 'Arm before kickoff: your drips are immune to opponent pauses and erases all week (TD wipes still apply).', kind: 'action', timing: 'pre', price: 85, icon: '🌊' },
  { id: 'overtime', name: 'Overtime', blurb: 'Arm before kickoff: your drips keep accruing for 5 extra minutes after each game ends.', kind: 'action', timing: 'pre', price: 60, icon: '⏱️' },
];

export function powerupById(id: string): Powerup | undefined {
  return POWERUPS.find((p) => p.id === id);
}
