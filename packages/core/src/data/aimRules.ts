// AIMED CARDS (v0.515.0) — which spot or window each targeted card can be
// played on, and when. One table for both hosts.
//
// Founder, on the app: "Why can't I use my spy or ghost?" The app's hand could
// only ARM whole-lineup buffs, so every card played on a spot or a window sat
// greyed out with "Aimed cards play on the web for now". The web had the
// tap-a-target step all along, but its Spy rule asked for the opponent's pick
// to be KNOWN before it would light a spot — and before kickoff the live board
// never has it (that is what sealed means), so Spy could not be played in the
// only moment it exists for. The server's use_spy has always taken a blind
// slot and done the peek itself.
//
// The timing words mirror the server (apply_targeted / use_spy /
// apply_underdog), which stays the authority — this table only decides what
// the board offers:
//   pre-lock  the window has not locked (window_locks_at > now)
//   pre-kick  the window has not kicked off (use_spy's own rule)
//   live      the window is playing (window_kickoff <= now, matchup live)

export type AimTarget = 'mine-filled' | 'mine-empty' | 'theirs' | 'window';
export type AimWhen = 'pre-lock' | 'pre-kick' | 'live';
/** What the card asks for after its target is tapped. */
export type AimFollow = 'spy-reveal' | 'bye-player' | 'metric' | 'bench-player' | 'confirm';

export interface AimRule {
  target: AimTarget;
  when: AimWhen;
  /** The word on the tap strip: "TAP TO SPY". */
  verb: string;
  follow?: AimFollow;
}

export const AIM_RULES: Record<string, AimRule> = {
  // Before the window locks (or, for Spy, kicks off)
  spy: { target: 'theirs', when: 'pre-kick', verb: 'SPY', follow: 'spy-reveal' },
  jinx: { target: 'theirs', when: 'pre-lock', verb: 'JINX' },
  'double-or-nothing': { target: 'mine-filled', when: 'pre-lock', verb: 'STAKE' },
  'lead-change': { target: 'mine-filled', when: 'pre-lock', verb: 'BET' },
  grudge: { target: 'mine-filled', when: 'pre-lock', verb: 'BET' },
  'red-herring': { target: 'mine-filled', when: 'pre-lock', verb: 'PLANT' },
  'unlock-underdog': { target: 'mine-filled', when: 'pre-lock', verb: 'ATTACH', follow: 'confirm' },
  ghost: { target: 'mine-empty', when: 'pre-lock', verb: 'FIELD GHOST' },
  'bye-steal': { target: 'mine-empty', when: 'pre-lock', verb: 'FIELD BYE', follow: 'bye-player' },
  rivalry: { target: 'window', when: 'pre-lock', verb: 'START RIVALRY' },
  // While the window is playing
  mulligan: { target: 'mine-filled', when: 'live', verb: 'MULLIGAN', follow: 'metric' },
  'metric-swap': { target: 'mine-filled', when: 'live', verb: 'SWAP METRIC', follow: 'metric' },
  'player-swap': { target: 'mine-filled', when: 'live', verb: 'SWAP PLAYER', follow: 'bench-player' },
  surge: { target: 'mine-filled', when: 'live', verb: 'SURGE' },
  bunker: { target: 'mine-filled', when: 'live', verb: 'BUNKER' },
  'cold-snap': { target: 'theirs', when: 'live', verb: 'FREEZE' },
  napalm: { target: 'theirs', when: 'live', verb: 'NAPALM' },
  emp: { target: 'window', when: 'live', verb: 'FIRE EMP' },
};

export const isAimed = (id: string): boolean => id in AIM_RULES;

/** A window's phase, as core's windowPhase names it. */
export type AimPhase = 'setup' | 'locked' | 'live' | 'final';

/** Is a window in this card's moment at all? */
export function aimWindowOpen(id: string, phase: AimPhase): boolean {
  const r = AIM_RULES[id];
  if (!r) return false;
  if (r.when === 'pre-lock') return phase === 'setup';
  if (r.when === 'pre-kick') return phase === 'setup' || phase === 'locked';
  return phase === 'live';
}

/** Can this card be played on this side of this spot?
 *
 *  `mine` / `theirs` say whether that side has a player there, as far as the
 *  board knows. An opponent's pick is SEALED until kickoff, so a card aimed at
 *  their spot before kickoff (Spy, Jinx) goes on blind — it never asks. Live
 *  cards on their spot (Cold Snap, Napalm) need a revealed player to hit. */
export function aimSpotOk(id: string, phase: AimPhase, side: 'you' | 'their', spot: { mine: boolean; theirs: boolean }): boolean {
  const r = AIM_RULES[id];
  if (!r || r.target === 'window' || !aimWindowOpen(id, phase)) return false;
  if (r.target === 'theirs') return side === 'their' && (r.when !== 'live' || spot.theirs);
  if (side !== 'you') return false;
  return r.target === 'mine-filled' ? spot.mine : !spot.mine;
}

/** Can this card be played on this whole window? */
export function aimWindowOk(id: string, phase: AimPhase): boolean {
  return AIM_RULES[id]?.target === 'window' && aimWindowOpen(id, phase);
}

/** Does the card consume itself server-side? use_spy and apply_underdog take
 *  the card in the same call; every other aimed card is recorded by
 *  apply_targeted and the card is spent with consume_inventory after. */
export const AIM_SELF_CONSUMING = new Set(['spy', 'unlock-underdog']);

/** What the board says while a card is waiting for its target. */
export function aimPrompt(id: string): string {
  const r = AIM_RULES[id];
  if (!r) return '';
  const where = r.target === 'window' ? 'a window'
    : r.target === 'theirs' ? 'one of their spots'
    : r.target === 'mine-empty' ? 'one of your EMPTY spots'
    : 'one of your filled spots';
  const when = r.when === 'live' ? 'in a live window' : r.when === 'pre-kick' ? 'before its window kicks off' : 'before its window locks';
  return `Tap ${where} ${when}.`;
}
