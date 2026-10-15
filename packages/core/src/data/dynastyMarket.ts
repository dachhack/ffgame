// THE DYNASTY MARKET FOR THE WORKER (v0.719.0). Founder: "Make the AI teams
// use the dynasty guard too." The clients get the market through
// league_market (0335); the worker reads dyn_board itself, so the three rules
// that RPC applies are transcribed here, once, for it:
//
//   • WHICH LEAGUES ARE DYNASTY — league_continuity / league_is_dynasty
//     (0453): an explicit continuity wins; else rookie rounds or the old
//     `dynasty` flag make it one. contract_dynasty is a dynasty.
//   • WHICH MARKET — _league_adp_format (0334): a lineup starting more than
//     one quarterback is superflex; everyone else reads 1QB.
//   • HOW FRESH — dyn_board_is_fresh (0335): ten days, or no market at all.
// Pure.
import type { ClassicSlotDef } from '../engine/classic';

const CONTINUITIES = ['redraft', 'keeper', 'dynasty', 'contract', 'contract_dynasty'];

/** league_is_dynasty, from a league's settings_json. */
export function isDynastySettings(s: Record<string, unknown> | null | undefined): boolean {
  const c = s?.continuity;
  if (typeof c === 'string' && CONTINUITIES.includes(c)) return c === 'dynasty' || c === 'contract_dynasty';
  return (Number(s?.rookie_rounds) || 0) > 0 || s?.dynasty === true || s?.dynasty === 'true';
}

/** 'sf' when more than one starting spot takes a quarterback. */
export const dynFormatOfSlots = (slots: ClassicSlotDef[]): 'sf' | '1qb' =>
  slots.filter((d) => d.pos.includes('QB')).length > 1 ? 'sf' : '1qb';

export interface DynBoardRow { slug: string | null; v1qb: number | null; vsf: number | null; fetched_at: string | null }
export const DYN_FRESH_MS = 10 * 24 * 3600e3;

/** slug → value in one format, or an empty map when the board is stale
 *  (its newest row older than ten days) — no market beats last month's. */
export function dynValues(rows: DynBoardRow[], fmt: 'sf' | '1qb', nowMs: number): Map<string, number> {
  const out = new Map<string, number>();
  const newest = Math.max(-Infinity, ...rows.map((r) => (r.fetched_at ? Date.parse(r.fetched_at) : NaN)).filter(Number.isFinite));
  if (!Number.isFinite(newest) || nowMs - newest > DYN_FRESH_MS) return out;
  for (const r of rows) {
    if (!r.slug) continue;
    const v = Number(fmt === 'sf' ? r.vsf : r.v1qb);
    if (Number.isFinite(v)) out.set(r.slug, Math.round(v));
  }
  return out;
}
