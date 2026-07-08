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
  { id: 'fg-dual', name: 'Dual Threat', blurb: 'Arm before kickoff: your Field General QB’s rushing yards count toward the multiplier alongside passing yards — a scrambler builds it on the ground.', kind: 'action', timing: 'pre', price: 40, icon: '🏃' },
  { id: 'counter-nuke', name: 'Counter-Nuke', blurb: 'Arm before kickoff: the first time an opponent nukes one of your slots, it is reflected back — their player is wiped instead.', kind: 'action', timing: 'pre', price: 95, icon: '↩️' },
  { id: 'insurance', name: 'Insurance', blurb: 'Arm before kickoff: the first time one of your slots is nuked, half its banked score is refunded instead of zeroed.', kind: 'action', timing: 'pre', price: 80, icon: '🛟' },
  { id: 'double-or-nothing', name: 'Double or Nothing', blurb: 'Stake one of your slots before kickoff: at FINAL it scores double if it wins its head-to-head, or zero if it loses.', kind: 'action', timing: 'pre', price: 80, icon: '⚖️', target: 'slot-you' },
  { id: 'spy', name: 'Spy', blurb: 'Before a window kicks off: pick any slate slot (blind) and reveal the opponent’s current sealed pick there — their player OR their chosen metric. They can still change it until kickoff; re-checking your peek is free.', kind: 'action', timing: 'pre', price: 40, icon: '👁️', target: 'slot-opp' },
  { id: 'bye-steal', name: 'Bye Steal', blurb: 'Before kickoff, field one of your players who is on bye in an open slot for a flat projected score.', kind: 'action', timing: 'pre', price: 55, icon: '🪂', target: 'bye' },
  { id: 'mulligan', name: 'Mulligan', blurb: 'Re-roll one slot’s metric mid-game for free — does not spend a Metric Swap.', kind: 'action', timing: 'live', price: 30, icon: '🎲', target: 'slot-you' },
  { id: 'emp', name: 'EMP', blurb: 'Fire during a live window to freeze every opponent drip in that window for 10 minutes.', kind: 'action', timing: 'live', price: 65, icon: '💥', target: 'window' },
  { id: 'turnover-boost', name: 'Ball Hawk', blurb: 'Arm before kickoff: raise the turnover coin swing from 10 to 25 this week, across all windows — your giveaways cost more, their giveaways pay more.', kind: 'action', timing: 'pre', price: 55, icon: '🦅' },
];

export function powerupById(id: string): Powerup | undefined {
  return POWERUPS.find((p) => p.id === id);
}

// ── THE VAULT: designed, NOT LIVE ────────────────────────────────────────────
// A bench of future power-ups, specced and priced but deliberately off. They
// are NOT in POWERUPS, so the shop doesn't list them, the AI doesn't buy them,
// and scripts/check-powerup-prices.mjs doesn't demand SQL prices — server-side
// they resolve to powerup_price() = 9999 ('unknown powerup'), which is the off
// switch even against a dishonest client. To ship one: move it into POWERUPS,
// add its price to a new powerup_price() migration, build the engine hook
// noted on its line, and measure it with the study tools before locking price.
export const POWERUP_VAULT: Powerup[] = [
  // Counter-intel — no engine work; reveal via a pre-lock RPC like Spy's.
  { id: 'wiretap', name: 'Wiretap', blurb: 'Before kickoff: reveal every buff your opponent has armed this week. They can still change them until lock — so can you.', kind: 'action', timing: 'pre', price: 35, icon: '🎙️' },
  // Anti-FG denial — engine: clamp the OPPONENT's windowFgMult at 2.0×.
  { id: 'jammer', name: 'Jammer', blurb: 'Arm before kickoff: the opponent’s Field General multiplier is capped at 2× all week — Twin Generals and Dual Threat push against the same ceiling.', kind: 'action', timing: 'pre', price: 45, icon: '📡' },
  // Symmetric FG blackout — engine: disable windowFgMult both sides in one window.
  { id: 'blackout', name: 'Blackout', blurb: 'Before kickoff, pick a window: NO Field General multipliers fire there — yours or theirs. Scorched earth for the QB duel.', kind: 'action', timing: 'pre', price: 55, icon: '🕶️', target: 'window' },
  // Targeted defense — engine: per-slot immunity to pauses, erases AND nukes.
  { id: 'bodyguard', name: 'Bodyguard', blurb: 'Assign to one of your slots before kickoff: it cannot be paused, erased, or nuked this week. One player, untouchable.', kind: 'action', timing: 'pre', price: 55, icon: '🕴️', target: 'slot-you' },
  // Risk/reward drip — engine: per-slot rate 1.5×, but erases against it hit 2×.
  { id: 'overclock', name: 'Overclock', blurb: 'Assign to one drip slot before kickoff: its rate runs 1.5× all week — but any erase against it wipes double. Loud and fragile.', kind: 'action', timing: 'pre', price: 45, icon: '⚡', target: 'slot-you' },
  // Wipe-theft — engine: bank 25% of points your erases/nukes remove.
  { id: 'scavenger', name: 'Scavenger', blurb: 'Arm before kickoff: when your erases or nukes wipe opponent points this week, you bank 25% of what they lost.', kind: 'action', timing: 'pre', price: 60, icon: '🦴' },
  // Comeback mechanic — engine: 1.25× your final window if trailing at its kickoff.
  { id: 'two-minute-drill', name: 'Two-Minute Drill', blurb: 'Arm before kickoff: if you trail the matchup when your last window kicks off, everything you score in it counts 1.25×.', kind: 'action', timing: 'pre', price: 50, icon: '🕑' },
  // Bench shadow — engine: resolve slot as max(starter, shadow) at FINAL.
  { id: 'sixth-man', name: 'Sixth Man', blurb: 'Before kickoff, shadow one of your slots with a bench player: at FINAL the slot keeps whichever of the two scored more.', kind: 'action', timing: 'pre', price: 90, icon: '🧢', target: 'slot-you' },

  // ── income: invest coin to earn more coin ──────────────────────────────────
  // Today's earn side is fixed (◎50 stipend + ◎15/unopposed + per-event drips
  // ◎5 / nukes ◎10 / suppress ◎10 / turnover ±10 — coinFor in liveResolve.ts,
  // mirrored in matchup.ts). These give it a decision layer. Hooks live in
  // coinFor()/the worker credit pass, not resolveSlot — scores never change.
  // Next-week effects need a small deferred-credit table (arm week N, worker
  // pays at week N+1 settle).
  { id: 'booster-club', name: 'Booster Club', blurb: 'Arm this week: NEXT week’s stipend is doubled — ◎100 instead of ◎50. Patience pays.', kind: 'action', timing: 'pre', price: 30, icon: '📣' },
  { id: 'gate-receipts', name: 'Gate Receipts', blurb: 'Arm before kickoff: win this week’s matchup and the box office pays out ◎60 on top of your normal earnings.', kind: 'action', timing: 'pre', price: 25, icon: '🎟️' },
  { id: 'rebuild-fund', name: 'Rebuild Fund', blurb: 'Arm before kickoff: lose this week’s matchup and the league office cuts you a ◎50 check. Losing hurts less.', kind: 'action', timing: 'pre', price: 20, icon: '🧱' },
  { id: 'highlight-reel', name: 'Highlight Reel', blurb: 'Arm before kickoff: every touchdown your starters score this week also pays ◎8 to your wallet.', kind: 'action', timing: 'pre', price: 40, icon: '📸' },
  { id: 'double-coupons', name: 'Double Coupons', blurb: 'Arm before kickoff: all your per-event coin this week — drips, nukes, suppress, unopposed — pays out 2×.', kind: 'action', timing: 'pre', price: 35, icon: '🏷️' },
  { id: 'salvage-rights', name: 'Salvage Rights', blurb: 'Arm before kickoff: every time YOUR points get erased or nuked this week, you bank ◎10 from the wreckage.', kind: 'action', timing: 'pre', price: 30, icon: '🛒' },
  { id: 'payday-loan', name: 'Payday Loan', blurb: 'Free to arm: take ◎100 into your wallet right now — ◎125 comes out of next week’s earnings. The vig is real.', kind: 'action', timing: 'pre', price: 0, icon: '🏦' },

  // ── live plays: fired DURING a live window ─────────────────────────────────
  // The live roster is thin (swap/mulligan/EMP are all utility). These add
  // reactive drama: lock in gains, answer an erase, kill the clock. All hooks
  // are event-time in resolveSlot/liveResolve (a fired-at clock arrives via
  // extras, like EMP's emp[win] clock — nothing retroactive), so the demo,
  // worker, and playtester replay them identically.
  { id: 'cash-out', name: 'Cash Out', blurb: 'Fire on one of your live drip slots: bank its points as they stand — it stops accruing, but what’s banked can’t be paused, erased, or nuked.', kind: 'action', timing: 'live', price: 45, icon: '💰', target: 'slot-you' },
  { id: 'challenge-flag', name: 'Challenge Flag', blurb: 'Throw within 5 game-minutes of an erase or nuke landing on one of your slots: the booth overturns it and the points come back.', kind: 'action', timing: 'live', price: 55, icon: '🚩', target: 'slot-you' },
  { id: 'fair-catch', name: 'Fair Catch', blurb: 'Fire during a live window: for the next 5 game-minutes your drips there can’t be paused or erased. A burst shield when their eraser is heating up.', kind: 'action', timing: 'live', price: 30, icon: '🙌', target: 'window' },
  { id: 'hurry-up', name: 'Hurry-Up', blurb: 'Fire during a live window: your drips there run HOT for the next 10 game-minutes, no scoring event required. Stacks with Momentum’s 3×.', kind: 'action', timing: 'live', price: 50, icon: '⏩', target: 'window' },
  { id: 'kneel-down', name: 'Kneel Down', blurb: 'Fire during a live window: its final 5 game-minutes score NOTHING — for either side. Protect a lead by killing the clock.', kind: 'action', timing: 'live', price: 35, icon: '🧎', target: 'window' },
  { id: 'all-out-blitz', name: 'All-Out Blitz', blurb: 'Fire during a live window: your NEXT erase there hits every opponent drip in the window, not just its matched slot.', kind: 'action', timing: 'live', price: 40, icon: '🚨', target: 'window' },
  { id: 'pile-on', name: 'Pile-On', blurb: 'Fire within 5 game-minutes of an opponent slot getting erased or nuked: it can’t bank anything for the next 5. Kick ’em while they’re down.', kind: 'action', timing: 'live', price: 35, icon: '💢', target: 'slot-opp' },
  { id: 'send-the-house', name: 'Send the House', blurb: 'Fire on one of your live slots: its next scoring play counts TRIPLE. If nothing scores there in the next 5 game-minutes, the bet is simply gone.', kind: 'action', timing: 'live', price: 30, icon: '🎰', target: 'slot-you' },
];

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
