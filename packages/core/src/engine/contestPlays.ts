// THE PLAYS (v0.685.0, PR 2 of the drip-coin plan): a contest league's
// power-ups — pre-kickoff only, one a week (two head-to-head), paid from the
// seat's wallet. The live plays, amplifiers, nukes and metric unlocks of drip
// mode act on drips, windows and sealed metrics, none of which a contest has,
// so this is the whole set: two spot bets, a phantom, and two event bonuses.
// Prices match data/powerups.ts where an id is shared.
export type ContestPlayId = 'underdog' | 'double-or-nothing' | 'ghost' | 'hail-mary' | 'pick-six' | 'spy' | 'jinx' | 'magnet' | 're-deal'
  // THE SECOND DEAL (v0.696.0): one effect each, said in a line
  | 'trick-play' | 'return-man' | 'bomb-squad' | 'hat-trick' | 'century-club' | 'two-for-one' | 'iron-grip' | 'goal-line-stand' | 'long-boot'
  | 'floor' | 'garbage-time' | 'smoke' | 'mirror' | 'curse';
export interface ContestPlayDef {
  id: ContestPlayId; name: string; icon: string; price: number; blurb: string;
  /** 'spot': aimed at one of your filled spots; 'open': fills a spot; 'squad': arms the whole squad;
   *  'opp': aimed at one of the opponent's spots (head-to-head). */
  target: 'spot' | 'open' | 'squad' | 'opp';
  /** PR 3 (v0.686.0): a head-to-head play, or a Bullseye one. */
  h2hOnly?: boolean; bullseyeOnly?: boolean;
  /** v0.696.0: offered under these contests only (a floor or a doubling only means something where higher wins). */
  only?: readonly string[];
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
  // THE SECOND DEAL (v0.696.0, founder: "no compound effect power ups. It should have one effect and one effect
  // only and it should be easy to explain in three rows of text"). Nine event bonuses from the squad's real plays,
  // two spot plays, three across the table. Each is one line.
  { id: 'trick-play', name: 'Trick Play', icon: '🎩', price: 35, target: 'squad', blurb: 'A wide receiver or tight end in your squad takes a carry of 10 yards or more: bank a flat +10.' },
  { id: 'return-man', name: 'Return Man', icon: '🏃', price: 40, target: 'squad', blurb: 'Your squad returns kicks and punts for 100 yards or more, all told: bank a flat +12.' },
  { id: 'bomb-squad', name: 'Bomb Squad', icon: '💣', price: 35, target: 'squad', blurb: 'A quarterback in your squad throws a touchdown of 60 yards or more: bank a flat +25.' },
  { id: 'hat-trick', name: 'Hat Trick', icon: '🔥', price: 50, target: 'squad', blurb: 'One player in your squad scores three touchdowns, rushing or receiving: bank a flat +20.' },
  { id: 'century-club', name: 'Century Club', icon: '💯', price: 30, target: 'squad', blurb: 'A player in your squad runs for 100 yards, or catches for 100: bank a flat +10.' },
  { id: 'two-for-one', name: 'Two for One', icon: '✌️', price: 25, target: 'squad', blurb: 'Every two-point conversion your squad scores banks +6.' },
  { id: 'iron-grip', name: 'Iron Grip', icon: '🤝', price: 30, target: 'squad', blurb: 'Nobody in your squad fumbles all week: bank a flat +10 at the final.' },
  { id: 'goal-line-stand', name: 'Goal Line Stand', icon: '🧱', price: 45, target: 'squad', blurb: 'Your defense records a safety or blocks a kick: bank a flat +15.' },
  { id: 'long-boot', name: 'Long Boot', icon: '🦵', price: 25, target: 'squad', blurb: 'Every field goal of 50 yards or more by your kicker banks +8.' },
  { id: 'floor', name: 'Floor', icon: '🪨', price: 60, target: 'spot', only: ['high'], blurb: 'Stake a spot: at the final it scores at least his projection.' },
  { id: 'garbage-time', name: 'Garbage Time', icon: '🗑️', price: 40, target: 'spot', only: ['high'], blurb: 'Aim it at a spot: everything the player scores in the fourth quarter and overtime counts twice.' },
  { id: 'smoke', name: 'Smoke', icon: '🌫️', price: 45, target: 'spot', h2hOnly: true, blurb: 'Pick one of your spots: their Spy cannot reveal it this week.' },
  { id: 'mirror', name: 'Mirror', icon: '🪞', price: 70, target: 'spot', h2hOnly: true, only: ['high'], blurb: 'Pick one of your spots: at the final it scores the higher of its own and their matching spot.' },
  { id: 'curse', name: 'Curse', icon: '🕯️', price: 60, target: 'squad', h2hOnly: true, only: ['high'], blurb: 'At the final, their highest-scoring spot counts for 80%.' },
];
/** The plays a league offers: the head-to-head pair only head-to-head, the Bullseye pair only under the dart. */
/** The plays a league of this shape offers; `off` (0490) is what its commissioner turned off. */
export const contestPlaysFor = (format: 'h2h' | 'board', contest: string, off?: readonly string[] | null): ContestPlayDef[] =>
  CONTEST_PLAYS.filter((d) => (!d.h2hOnly || format === 'h2h') && (!d.bullseyeOnly || contest === 'bullseye') && (!d.only || d.only.includes(contest)) && !(off ?? []).includes(d.id));
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
export interface PlayEvent { k: string; td?: number; y?: number; /** the source play id, to count a play once across two players (v0.696.0) */ pid?: number }
/** The event bonuses a squad's plays earn from its players' real plays. */
export function contestEventBonus(plays: ContestPlay[], slugs: string[], playsOf: (slug: string) => PlayEvent[],
  /** v0.696.0: a player's position (Trick Play wants a receiver's carry) and whether the week is final (Iron Grip pays once nobody can fumble). */
  o: { posOf?: (slug: string) => string | undefined; settled?: boolean } = {}): { id: ContestPlayId; delta: number }[] {
  const out: { id: ContestPlayId; delta: number }[] = [];
  const on = (id: ContestPlayId) => plays.some((p) => p.id === id);
  const all = slugs.flatMap((s) => playsOf(s));
  const sum = (es: PlayEvent[], k: string) => es.filter((e) => e.k === k).reduce((s, e) => s + (e.y ?? 0), 0);
  if (on('hail-mary') && all.some((e) => e.k === 'pass' && (e.td ?? 0) > 0 && (e.y ?? 0) >= 40)) out.push({ id: 'hail-mary', delta: 15 });
  if (on('pick-six') && all.some((e) => e.k === 'dst_td' || ((e.k === 'int' || e.k === 'fumrec') && (e.td ?? 0) > 0))) out.push({ id: 'pick-six', delta: 25 });
  // THE SECOND DEAL (v0.696.0): each one effect, from the squad's real plays
  if (on('trick-play') && slugs.some((s) => ['WR', 'TE'].includes(o.posOf?.(s) ?? '') && playsOf(s).some((e) => e.k === 'rush' && (e.y ?? 0) >= 10))) out.push({ id: 'trick-play', delta: 10 });
  if (on('return-man') && sum(all, 'return') >= 100) out.push({ id: 'return-man', delta: 12 });
  if (on('bomb-squad') && all.some((e) => e.k === 'pass' && (e.td ?? 0) > 0 && (e.y ?? 0) >= 60)) out.push({ id: 'bomb-squad', delta: 25 });
  if (on('hat-trick') && slugs.some((s) => playsOf(s).filter((e) => (e.k === 'rush' || e.k === 'rec') && (e.td ?? 0) > 0).length >= 3)) out.push({ id: 'hat-trick', delta: 20 });
  if (on('century-club') && slugs.some((s) => sum(playsOf(s), 'rush') >= 100 || sum(playsOf(s), 'rec') >= 100)) out.push({ id: 'century-club', delta: 10 });
  if (on('two-for-one')) {
    // a conversion is one play, though the passer and the catcher each carry a row: count it once by its play id
    const tp = all.filter((e) => e.k === 'tp_pass' || e.k === 'tp_rush' || e.k === 'tp_rec');
    const n = new Set(tp.map((e, i) => (e.pid != null ? `p${e.pid}` : `i${i}`))).size;
    if (n) out.push({ id: 'two-for-one', delta: 6 * n });
  }
  if (on('iron-grip') && o.settled && !all.some((e) => e.k === 'fum')) out.push({ id: 'iron-grip', delta: 10 });
  if (on('goal-line-stand') && all.some((e) => e.k === 'safety' || e.k === 'blk')) out.push({ id: 'goal-line-stand', delta: 15 });
  if (on('long-boot')) { const n = all.filter((e) => e.k === 'fg' && (e.y ?? 0) >= 50).length; if (n) out.push({ id: 'long-boot', delta: 8 * n }); }
  return out;
}

/** A play as the drip shop and hand draw a card (data/powerups.ts's Powerup shape, the fields they read). */
export const contestPlayAsPowerup = (d: ContestPlayDef) => ({ id: d.id, name: d.name, blurb: d.blurb, kind: 'action' as const, timing: 'pre' as const, price: d.price, icon: d.icon });

// ═══ THE HAND ON THE MATCHUP (v0.695.0) ═══════════════════════════════════════
// Founder: "Only Josh Allen and DJ Moore should be able to be targeted by
// double or nothing. Let's put the card hand and power up application on the
// matchup." The two builders (web and phone) read a card's state and a
// spot's openness from here, so the hand says the same thing everywhere and
// the taps match SQL _contest_play_window (0490).

/** Is this play a SPOT play — one that waits for a tap on a spot (mine or theirs)? Spy
 *  aims at a spot too, but reveals a sealed pick, so it keeps the squad play's clock. */
export const contestSpotPlay = (d: ContestPlayDef, variant?: string | null): boolean => {
  const t = contestPlayTarget(d, variant);
  return (t === 'spot' || t === 'open' || t === 'opp') && d.id !== 'spy';
};

/** May `play` land on this spot NOW? A play on a filled spot goes on until that
 *  player's own kickoff; the phantom and Jinx take an empty or sealed spot
 *  before the week's first kickoff; everything else on a spot wants a player. */
export function contestSpotOpen(play: ContestPlayId, spot: { slug: string | null; locked: boolean }, weekStarted: boolean): boolean {
  if (play === 'spy') return !weekStarted;
  if (spot.slug) return !spot.locked;
  return (play === 'ghost' || play === 'jinx') && !weekStarted;
}

export interface HandCardState { usable: boolean; note?: string; deadline: string; action: 'arm' | 'apply' }
/** One hand card's state: playable now, and if not, why (or how). */
export function contestHandCard(d: ContestPlayDef, o: { variant?: string | null; started: boolean; off?: readonly string[] | null; plays: readonly { id: string }[]; cap: number; busy?: boolean }): HandCardState {
  const spot = contestSpotPlay(d, o.variant);
  const off = (o.off ?? []).includes(d.id);
  const inPlay = o.plays.some((x) => x.id === d.id);
  const full = o.plays.length >= o.cap;
  const usable = !off && (!o.started || spot) && !o.busy && !full && !inPlay;
  const note = off ? 'the commissioner turned this play off'
    : o.started && !spot ? 'the week has kicked off — playable next week'
    : inPlay ? 'already in play this week'
    : full ? 'your plays for the week are set'
    : o.started ? (d.target === 'opp' ? 'until their player’s kickoff — tap one of their spots' : 'until his own kickoff — tap a spot that hasn’t')
    : d.target === 'opp' ? 'tap one of their spots'
    : spot ? 'tap one of your spots' : undefined;
  return { usable, note, deadline: spot ? 'before his own kickoff' : 'before the first kickoff', action: contestPlayTarget(d, o.variant) === 'squad' ? 'arm' : 'apply' };
}
