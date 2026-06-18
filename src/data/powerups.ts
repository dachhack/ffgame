// Powerup catalog for the drip-coin economy. Two kinds:
//   • consumable — bought into inventory (qty), consumed when applied
//   • unlock     — bought once, permanently enables a new metric in the picker
// Timing gates how/when a powerup may be APPLIED (phase-based in the demo):
//   • 'pre'  — pre-match: appliable during SETUP, locks once any window starts
//   • 'live' — real-time: appliable anytime a window is live (not retroactive)
export type PowerupTiming = 'pre' | 'live';
export type PowerupKind = 'consumable' | 'unlock';

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
  { id: 'metric-swap', name: 'Metric Swap', blurb: 'Change a slot’s effective metric. Real-time — applies going forward, not retroactive.', kind: 'consumable', timing: 'live', price: 30, icon: '🔀' },
  { id: 'player-swap', name: 'Player Swap', blurb: 'Swap a slotted player for one on your bench — anytime, even mid-game.', kind: 'consumable', timing: 'live', price: 50, icon: '🔁' },
  { id: 'extra-slot', name: 'Extra Slot', blurb: 'Add a slot to any window — for you AND your opponent. Must be applied before any window starts.', kind: 'consumable', timing: 'pre', price: 80, icon: '➕' },
  { id: 'unlock-return', name: 'Unlock · Return Yards', blurb: 'Permanently unlock the KR/PR Return Yards metric: 0.1/yd banked + a 0.003 drip multiplier.', kind: 'unlock', timing: 'pre', price: 100, icon: '🏈' },
  { id: 'unlock-carries-wipe', name: 'Unlock · WR/TE Carries', blurb: 'Permanently unlock a WR/TE carries metric that wipes the opposing player to 0 the moment it fires.', kind: 'unlock', timing: 'live', price: 120, icon: '💥' },
];

export function powerupById(id: string): Powerup | undefined {
  return POWERUPS.find((p) => p.id === id);
}
