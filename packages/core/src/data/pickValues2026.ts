// GENERATED — what a DRAFT PICK trades for, from the same dynasty market
// board as dyn2026.ts. Source: StatHead MCP `get_dynasty_values` with
// position RDP ("rookie draft pick"), which returns the pick rows dyn2026
// deliberately drops — 2026's exact slots (1.01 … 4.12) plus the Early /
// Mid / Late tiers for 2026, 2027 and 2028, each with a 1QB value and a
// superflex one, on the SAME scale as the player rows.
//
// WHY THIS FILE EXISTS. v0.444.0's trade grade priced a pick as an invented
// fraction of a replacement starter — `[0, 0.85, 0.45, 0.22, 0.1, 0.05]`,
// with a comment admitting it was blunt. It was the one number in the grade
// that came from nowhere, in a feature whose whole argument is "you can
// disagree with the arithmetic". Now the arithmetic is the market's.
//
// REFRESH alongside the dyn2026 rebake: pull
//   get_dynasty_values { position: 'RDP', limit: 200, output_format: 'csv',
//                        fields: 'player_name,value,superflexValue' }
// and paste the rows below. Keep the as-of line current.
//
// WHAT IT IS NOT. These are ROOKIE-draft-pick values, the asset a dynasty
// league trades. A STARTUP slot — a pick in a draft of this league's actual
// players — is not on this board and must not be read off it; tradeGrade
// prices one by the pool it will draft from, which needs no market at all.

/** The market as of the pull below. */
export const PICK_AS_OF = '2026-09-21';

// year | label | 1qb | superflex
const PICK_CSV = `2026|1.01|7905|7186
2027|Early 1st|7174|6944
2026|1.02|6529|5893
2027|Mid 1st|6133|5603
2026|Early 1st|6062|5548
2026|1.03|6010|5393
2028|Early 1st|5889|5383
2026|1.04|5802|5199
2026|1.05|5589|5002
2027|Late 1st|5521|5042
2026|1.06|5375|4800
2026|Mid 1st|5287|4735
2026|1.07|5212|4623
2028|Mid 1st|5145|4603
2026|1.08|5091|4471
2026|1.09|4967|4330
2026|1.10|4842|4169
2026|Late 1st|4795|4126
2028|Late 1st|4771|4169
2026|1.11|4733|4028
2026|1.12|4602|3876
2027|Early 2nd|4590|3805
2026|2.01|4155|3446
2027|Mid 2nd|4150|3462
2026|2.02|4087|3395
2026|Early 2nd|4069|3372
2026|2.03|4020|3345
2026|2.04|3955|3286
2028|Early 2nd|3954|3293
2026|2.05|3890|3238
2027|Late 2nd|3879|3232
2026|2.06|3825|3185
2026|Mid 2nd|3811|3160
2026|2.07|3769|3121
2028|Mid 2nd|3728|3066
2026|2.08|3726|3068
2026|2.09|3682|3016
2026|2.10|3632|2954
2026|Late 2nd|3617|2878
2026|2.11|3583|2896
2026|2.12|3539|2849
2028|Late 2nd|3398|2835
2027|Early 3rd|3097|2625
2026|3.01|3008|2579
2026|3.02|2953|2529
2026|Early 3rd|2944|2422
2027|Mid 3rd|2914|2466
2026|3.03|2899|2493
2026|3.04|2844|2440
2026|3.05|2789|2390
2026|Mid 3rd|2748|2339
2027|Late 3rd|2735|2387
2026|3.06|2735|2363
2028|Early 3rd|2724|2336
2026|3.07|2696|2314
2026|3.08|2673|2280
2026|3.09|2650|2237
2028|Mid 3rd|2637|2200
2026|3.10|2630|2203
2026|Late 3rd|2627|2199
2026|3.11|2601|2165
2026|3.12|2581|2131
2028|Late 3rd|2432|2101
2027|Early 4th|2274|1976
2027|Mid 4th|2169|1853
2026|4.01|2156|1819
2026|Early 4th|2147|1783
2026|4.02|2109|1793
2026|4.03|2072|1771
2028|Early 4th|2067|1722
2026|4.04|2028|1742
2026|Mid 4th|1991|1748
2026|4.05|1987|1735
2026|4.06|1946|1715
2027|Late 4th|1943|1739
2026|4.07|1908|1681
2026|4.08|1873|1631
2028|Mid 4th|1844|1512
2026|4.09|1837|1586
2026|Late 4th|1813|1501
2026|4.10|1805|1536
2026|4.11|1767|1491
2026|4.12|1731|1443
2028|Late 4th|1574|1350`;

export type PickFormat = '1qb' | 'sf';
export type PickTier = 'early' | 'mid' | 'late';

interface PickRow { year: number; round: number; tier: PickTier | null; slot: number | null; v1: number; vsf: number; }

const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
const ROWS: PickRow[] = PICK_CSV.split('\n').map((ln) => {
  const [y, label, a, b] = ln.split('|');
  const tierWord = label.split(' ')[0].toLowerCase();
  const slotted = /^(\d+)\.(\d+)$/.exec(label);
  return {
    year: Number(y),
    round: slotted ? Number(slotted[1]) : ORD.indexOf(label.split(' ')[1]) + 1,
    tier: slotted ? null : (tierWord as PickTier),
    slot: slotted ? Number(slotted[2]) : null,
    v1: Number(a), vsf: Number(b),
  };
}).filter((r) => r.round > 0);

const YEARS = [...new Set(ROWS.map((r) => r.year))].sort((a, b) => a - b);
/** The seasons the market has an opinion about. */
export const PICK_YEARS: number[] = YEARS;
/** The deepest round it prices. Beyond this the market says nothing, which
 *  is itself the answer: a fifth-round rookie pick is not an asset. */
export const PICK_MAX_ROUND: number = Math.max(...ROWS.map((r) => r.round));

const val = (r: PickRow, fmt: PickFormat) => (fmt === 'sf' ? r.vsf : r.v1);

/** What this pick trades for on the dynasty market, on the same scale as
 *  dyn2026's player values — or null where the market prices nothing (a
 *  round past the board's depth).
 *
 *  A season BEFORE the board's first year is priced as its first year (the
 *  pick is imminent), a season after its last as the last: the market's
 *  furthest-out opinion is the best available statement about a pick even
 *  further out, and it is already the cheapest tier on the board.
 *
 *  `slot` prices an exact pick where the caller knows one (a startup order
 *  is known; a rookie pick's is not until the standings say so). Without it
 *  the MID tier answers, which is what an unknown pick is worth: the middle
 *  of the round. */
export function pickMarketValue(
  season: number | string, round: number, fmt: PickFormat = '1qb',
  opts?: { tier?: PickTier; slot?: number },
): number | null {
  const rd = Math.round(Number(round));
  if (!Number.isFinite(rd) || rd < 1 || rd > PICK_MAX_ROUND) return null;
  const y = Math.min(Math.max(Number(season) || YEARS[0], YEARS[0]), YEARS[YEARS.length - 1]);
  if (opts?.slot != null) {
    const exact = ROWS.find((r) => r.year === y && r.round === rd && r.slot === opts.slot);
    if (exact) return val(exact, fmt);
  }
  const tier = opts?.tier ?? 'mid';
  const tiered = ROWS.find((r) => r.year === y && r.round === rd && r.tier === tier);
  if (tiered) return val(tiered, fmt);
  // A year with only slotted rows (2026, where the draft order is known):
  // average the round as the tier would have.
  const inRound = ROWS.filter((r) => r.year === y && r.round === rd && r.slot != null);
  if (!inRound.length) return null;
  const sorted = inRound.slice().sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const pick = tier === 'early' ? sorted[0]
    : tier === 'late' ? sorted[sorted.length - 1]
      : sorted[Math.floor(sorted.length / 2)];
  return val(pick, fmt);
}
