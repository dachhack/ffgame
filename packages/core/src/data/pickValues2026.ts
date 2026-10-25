// GENERATED — what a DRAFT PICK trades for, from the same dynasty market
// board as dyn2026.ts. Source: StatHead MCP `get_dynasty_values` with
// position RDP ("rookie draft pick"), which returns the pick rows dyn2026
// deliberately drops — the Early / Mid / Late tiers for 2027, 2028 and 2029,
// rounds 1–4, each with a 1QB value and a superflex one, on the SAME scale
// as the player rows.
//
// v0.572.0: rebaked on StatHead's Oct 1 rule. Until then StatHead passed
// pick rows through at KTC's raw value while players went through its
// FantasyCalc rescale (~0.35×), so a pick was priced ~2.9× a player of the
// same market standing. Picks now take the mean positional ratio, in tens —
// the same scale as every player value. (The 2026 slots are gone with the
// 2026 rookie draft.)
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
export const PICK_AS_OF = '2026-10-01';

// year | label | 1qb | superflex
const PICK_CSV = `2027|Early 1st|2490|3250
2027|Mid 1st|2160|2680
2028|Early 1st|2060|2510
2027|Late 1st|1960|2320
2028|Mid 1st|1810|2150
2029|Early 1st|1800|2090
2028|Late 1st|1690|1930
2029|Mid 1st|1610|1880
2027|Early 2nd|1580|1770
2029|Late 1st|1480|1750
2027|Mid 2nd|1440|1630
2028|Early 2nd|1400|1500
2027|Late 2nd|1370|1510
2028|Mid 2nd|1330|1450
2029|Early 2nd|1230|1390
2028|Late 2nd|1200|1360
2029|Mid 2nd|1140|1270
2027|Early 3rd|1080|1210
2029|Late 2nd|1040|1200
2027|Mid 3rd|1010|1170
2028|Early 3rd|980|1110
2027|Late 3rd|960|1100
2028|Mid 3rd|930|1070
2029|Early 3rd|860|1030
2028|Late 3rd|860|990
2029|Mid 3rd|820|950
2027|Early 4th|790|910
2027|Mid 4th|770|860
2029|Late 3rd|770|910
2028|Early 4th|720|820
2027|Late 4th|680|810
2028|Mid 4th|670|740
2029|Early 4th|640|720
2029|Mid 4th|590|630
2028|Late 4th|580|660
2029|Late 4th|520|560`;

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
// THE LIVE PICK BOARD (v0.455.0). The picks ride in the same published KTC
// file as the player values, keyed by the market's own label ("2027 Early
// 1st"), so the worker refreshes both together (0335). The baked rows below
// answer for a label the live board has dropped, and for every screen that
// has not installed one.
//
// THE MAP IS FORMAT-RESOLVED, so it carries the format it was resolved FOR.
// The server hands a league one column — 1QB or superflex — and a caller
// asking for the other one must fall through to the bake rather than be
// handed a superflex price wearing a 1QB label.
let livePicks: Record<string, number> | null = null;
let livePickFmt: PickFormat | null = null;
export function setLivePickValues(m?: Record<string, number> | null, fmt?: PickFormat | null): void {
  livePicks = m && Object.keys(m).length ? m : null;
  livePickFmt = livePicks ? fmt ?? null : null;
}
export function clearLivePickValues(): void { livePicks = null; livePickFmt = null; }
export const pickBoardIsLive = (): boolean => livePicks != null;

/** The market's own label for a row, which is how the live board keys it. */
function labelFor(year: number, round: number, tier: PickTier, slot?: number): string[] {
  const ord = ORD[round - 1] ?? `${round}th`;
  const tierWord = tier === 'early' ? 'Early' : tier === 'late' ? 'Late' : 'Mid';
  const out = [`${year} ${tierWord} ${ord}`];
  if (slot != null) out.unshift(`${year} Pick ${round}.${String(slot).padStart(2, '0')}`);
  return out;
}

function slotTier(slot?: number): PickTier {
  if (slot == null) return 'mid';
  return slot <= 4 ? 'early' : slot >= 9 ? 'late' : 'mid';
}

export function pickMarketValue(
  season: number | string, round: number, fmt: PickFormat = '1qb',
  opts?: { tier?: PickTier; slot?: number },
): number | null {
  const rd = Math.round(Number(round));
  if (!Number.isFinite(rd) || rd < 1 || rd > PICK_MAX_ROUND) return null;
  const y = Math.min(Math.max(Number(season) || YEARS[0], YEARS[0]), YEARS[YEARS.length - 1]);
  // The live board first, by the market's own label — the exact slot where
  // one is known, else the tier.
  if (livePicks && livePickFmt === fmt) {
    for (const label of labelFor(y, rd, opts?.tier ?? slotTier(opts?.slot), opts?.slot)) {
      const v = livePicks[label];
      if (v != null) return v;
    }
  }
  if (opts?.slot != null) {
    const exact = ROWS.find((r) => r.year === y && r.round === rd && r.slot === opts.slot);
    if (exact) return val(exact, fmt);
  }
  // v0.572.0: a known slot with only tiers to read it by takes its tier
  // (1–4 early, 9+ late), so 1.01 still outprices 1.12.
  const tier = opts?.tier ?? slotTier(opts?.slot);
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
