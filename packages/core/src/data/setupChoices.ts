// THE SETTINGS THAT LOCK AT THE DRAFT, ASKED AT CREATION (v0.714.1).
// Founder: "Basically anything that can't be reversed after the draft needs
// to be in the setup flow." Game mode, format, league size, draft type,
// college/devy and the clock were already asked. These were not:
//
//   • ROSTER SIZE — set_roster_rules refuses it once the draft starts (0192).
//   • WHO'S IN THE POOL — set_league_pool_filter locks with the draft (0383);
//     the filter bites when the pool is seeded, so it is set BEFORE the seed.
//   • COPIES OF EVERY PLAYER — set_league_copies, before the draft only (0500).
//   • HOW A CLASSIC LEAGUE IS WON — golf (0446) and Bullseye (0450) both lock.
//
// The draft's own order, lottery and start time lock too, but they are the
// draft room's business and stay there. Pure — both create flows and the
// check read it.

export type PoolTenure = 'all' | 'rookies' | 'vets';
export type WinStyle = 'points' | 'golf' | 'bullseye_slots' | 'bullseye_total';

/** The pool filter a tenure choice writes: rookies only is max 0 years, no
 *  rookies is min 1. Null clears it (everyone). */
export function tenureFilter(t: PoolTenure): { min_exp: number | null; max_exp: number | null } | null {
  return t === 'rookies' ? { min_exp: null, max_exp: 0 } : t === 'vets' ? { min_exp: 1, max_exp: null } : null;
}

/** Why copies can't be offered for this league, or null when they can.
 *  Mirrors set_league_copies (0500): snake/linear only, no salaries, no
 *  college players, head-to-head only. */
export function copiesBlocked(o: { auction: boolean; contract: boolean; format: string; college: boolean }): string | null {
  if (o.contract) return 'not with salaries';
  if (o.auction) return 'not with an auction draft';
  if (o.format !== 'standard') return `not with ${o.format}`;
  if (o.college) return 'not with college players';
  return null;
}

/** The roster sizes the flow offers; the default is the one each game used. */
export const SETUP_ROSTER_SIZES = [10, 12, 14, 15, 16, 18, 20, 25] as const;
export const defaultRosterSize = (classic: boolean): number => (classic ? 15 : 12);

export const WIN_STYLES: { id: WinStyle; label: string }[] = [
  { id: 'points', label: 'MOST POINTS' },
  { id: 'golf', label: '⛳ GOLF' },
  { id: 'bullseye_slots', label: '🎯 BULLSEYE · SLOTS' },
  { id: 'bullseye_total', label: '🎯 BULLSEYE · TOTAL' },
];

export const SETUP_INFO = {
  size: 'How many players each team holds — the draft fills it. It locks when the draft starts.',
  pool: 'Who the player pool holds. ROOKIES ONLY is this year’s class; NO ROOKIES leaves them out. Teams, years and college rules are in ⚑ COMMISH → ELIGIBLE PLAYERS until the draft — then the pool is set.',
  copies: 'How many teams can roster the same player. At 2, two different teams can each draft or add him; a team never holds two of him. For big leagues where one pool runs thin. Locks when the draft starts.',
  win: 'MOST POINTS is ordinary fantasy. GOLF: the lowest weekly total wins. BULLSEYE: each week a number is dealt for every starting spot (SLOTS) or the whole lineup (TOTAL), and the closest lands win. Each locks when the draft starts.',
};
