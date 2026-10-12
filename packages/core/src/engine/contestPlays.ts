// THE PLAYS (v0.685.0, PR 2 of the drip-coin plan): a contest league's
// power-ups — pre-kickoff only, one a week (two head-to-head), paid from the
// seat's wallet. The live plays, amplifiers, nukes and metric unlocks of drip
// mode act on drips, windows and sealed metrics, none of which a contest has,
// so this is the whole set: two spot bets, a phantom, and two event bonuses.
// Prices match data/powerups.ts where an id is shared.
export type ContestPlayId = 'underdog' | 'double-or-nothing' | 'ghost' | 'hail-mary' | 'pick-six' | 'spy' | 'jinx' | 'magnet' | 're-deal';
export interface ContestPlayDef {
  id: ContestPlayId; name: string; icon: string; price: number; blurb: string;
  /** 'spot': aimed at one of your filled spots; 'open': fills a spot; 'squad': arms the whole squad;
   *  'opp': aimed at one of the opponent's spots (head-to-head). */
  target: 'spot' | 'open' | 'squad' | 'opp';
  /** PR 3 (v0.686.0): a head-to-head play, or a Bullseye one. */
  h2hOnly?: boolean; bullseyeOnly?: boolean;
}
export const GHOST_POINTS = 14;
export const CONTEST_PLAYS: ContestPlayDef[] = [
  { id: 'underdog', name: 'Underdog', icon: '🐕', price: 35, target: 'spot', blurb: 'Aim it at a spot whose player is priced in the bottom third of his position: everything he scores counts ×1.5.' },
  { id: 'double-or-nothing', name: 'Double or Nothing', icon: '⚖️', price: 80, target: 'spot', blurb: 'Stake a spot: at the final it scores double if he beats his projection, zero if he doesn’t.' },
  { id: 'ghost', name: 'Ghost Player', icon: '👻', price: 75, target: 'open', blurb: `Conjure a phantom into a spot at no salary: it banks a flat ${GHOST_POINTS}, guaranteed. The player there, if any, steps out.` },
  { id: 'hail-mary', name: 'Hail Mary', icon: '🙏', price: 35, target: 'squad', blurb: 'If a quarterback in your squad throws a touchdown of 40 yards or more, bank a flat +15.' },
  { id: 'pick-six', name: 'Pick Six', icon: '🛡️', price: 45, target: 'squad', blurb: 'If your defense returns an interception or a fumble for a touchdown, bank a flat +25.' },
  // PR 3 (v0.686.0): the head-to-head pair and the Bullseye pair
  { id: 'spy', name: 'Spy', icon: '👁️', price: 40, target: 'opp', h2hOnly: true, blurb: 'Before kickoff, pick one of your opponent’s spots: their sealed pick there shows to you. They can still change it until his game; re-checking is free.' },
  { id: 'jinx', name: 'Jinx', icon: '🧿', price: 55, target: 'opp', h2hOnly: true, blurb: 'Before kickoff, blind, pick one of your opponent’s spots: the first touchdown the player there scores is struck off. Whiffs if he never scores one.' },
  { id: 'magnet', name: 'Magnet', icon: '🧲', price: 50, target: 'spot', bullseyeOnly: true, blurb: 'At the final, one spot lands half as far from its number (per-spot leagues), or the whole squad lands half a radius closer to its total.' },
  { id: 're-deal', name: 'Re-deal', icon: '🔄', price: 40, target: 'squad', bullseyeOnly: true, blurb: 'Deal your tie-breaker spot and its number again, before kickoff. One re-deal a week; what comes up, stays.' },
];
/** The plays a league offers: the head-to-head pair only head-to-head, the Bullseye pair only under the dart. */
export const contestPlaysFor = (format: 'h2h' | 'board', contest: string): ContestPlayDef[] =>
  CONTEST_PLAYS.filter((d) => (!d.h2hOnly || format === 'h2h') && (!d.bullseyeOnly || contest === 'bullseye'));
/** Magnet aims at a spot under a per-spot card; under a one-team total it is the whole squad's. */
export const contestPlayTarget = (d: ContestPlayDef, variant?: string | null): ContestPlayDef['target'] => (d.id === 'magnet' && variant === 'total' ? 'squad' : d.target);
/** How many times the seat's tie-breaker has been re-dealt this week (0 or 1). */
export const contestRedeal = (plays?: ContestPlay[] | null): number => (plays?.some((p) => p.id === 're-deal') ? 1 : 0);
/** JINX: the first touchdown the player scored, as the points it was worth — or 0. */
export function contestJinxValue(events: PlayEvent[], td: { pass: number; rush: number; rec: number }): number {
  const first = events.find((e) => (e.td ?? 0) > 0 && (e.k === 'pass' || e.k === 'rush' || e.k === 'rec'));
  return first ? (first.k === 'pass' ? td.pass : first.k === 'rush' ? td.rush : td.rec) : 0;
}
export const contestPlayById = (id: string): ContestPlayDef | undefined => CONTEST_PLAYS.find((p) => p.id === id);
/** How many plays a seat may arm in a week: one, or two head-to-head. */
export const contestPlayCap = (format: 'h2h' | 'board'): number => (format === 'h2h' ? 2 : 1);
/** An armed play, as the seat's row carries it. */
export interface ContestPlay { id: ContestPlayId; slot?: string | null; proj?: number | null }
/** The shape of a play-by-play row the event plays read (data/realPbp.ts's RealPlay, the fields that matter). */
export interface PlayEvent { k: string; td?: number; y?: number }
/** The event bonuses a squad's plays earn from its players' real plays. */
export function contestEventBonus(plays: ContestPlay[], slugs: string[], playsOf: (slug: string) => PlayEvent[]): { id: ContestPlayId; delta: number }[] {
  const out: { id: ContestPlayId; delta: number }[] = [];
  const all = slugs.flatMap((s) => playsOf(s));
  if (plays.some((p) => p.id === 'hail-mary') && all.some((e) => e.k === 'pass' && (e.td ?? 0) > 0 && (e.y ?? 0) >= 40)) out.push({ id: 'hail-mary', delta: 15 });
  if (plays.some((p) => p.id === 'pick-six') && all.some((e) => e.k === 'dst_td' || ((e.k === 'int' || e.k === 'fumrec') && (e.td ?? 0) > 0))) out.push({ id: 'pick-six', delta: 25 });
  return out;
}
