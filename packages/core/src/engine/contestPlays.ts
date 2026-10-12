// THE PLAYS (v0.685.0, PR 2 of the drip-coin plan): a contest league's
// power-ups — pre-kickoff only, one a week (two head-to-head), paid from the
// seat's wallet. The live plays, amplifiers, nukes and metric unlocks of drip
// mode act on drips, windows and sealed metrics, none of which a contest has,
// so this is the whole set: two spot bets, a phantom, and two event bonuses.
// Prices match data/powerups.ts where an id is shared.
export type ContestPlayId = 'underdog' | 'double-or-nothing' | 'ghost' | 'hail-mary' | 'pick-six';
export interface ContestPlayDef {
  id: ContestPlayId; name: string; icon: string; price: number; blurb: string;
  /** 'spot': aimed at one of your filled spots; 'open': fills a spot; 'squad': arms the whole squad. */
  target: 'spot' | 'open' | 'squad';
}
export const GHOST_POINTS = 14;
export const CONTEST_PLAYS: ContestPlayDef[] = [
  { id: 'underdog', name: 'Underdog', icon: '🐕', price: 35, target: 'spot', blurb: 'Aim it at a spot whose player is priced in the bottom third of his position: everything he scores counts ×1.5.' },
  { id: 'double-or-nothing', name: 'Double or Nothing', icon: '⚖️', price: 80, target: 'spot', blurb: 'Stake a spot: at the final it scores double if he beats his projection, zero if he doesn’t.' },
  { id: 'ghost', name: 'Ghost Player', icon: '👻', price: 75, target: 'open', blurb: `Conjure a phantom into a spot at no salary: it banks a flat ${GHOST_POINTS}, guaranteed. The player there, if any, steps out.` },
  { id: 'hail-mary', name: 'Hail Mary', icon: '🙏', price: 35, target: 'squad', blurb: 'If a quarterback in your squad throws a touchdown of 40 yards or more, bank a flat +15.' },
  { id: 'pick-six', name: 'Pick Six', icon: '🛡️', price: 45, target: 'squad', blurb: 'If your defense returns an interception or a fumble for a touchdown, bank a flat +25.' },
];
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
