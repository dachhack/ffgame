// THE COMMISSIONER FIXES A LINEUP (0356), the part both consoles share: which
// spots the league has, which of the seat's players each one accepts, and the
// payload the RPC takes. The server checks WHO may start (the seat's own
// players that week); which SPOT fits is decided here with core's slotAllows,
// the rule every lineup screen already uses, so the fix can't place a player
// the manager's own board would refuse.
import { leagueSlotDefs, leagueBestball, slotAllows, slotDisplayNames, type ClassicSlotDef, type SlotSpec, type ClassicRoster } from '../engine/classic';
import type { LineupFixCandidate } from './liveApi';

export interface FixSlot { slot: string; name: string; bestball: boolean; def: ClassicSlotDef }

type Mode = { roster?: ClassicRoster | null; slots?: SlotSpec[] | null; bestball?: string[] | null };

/** The league's spots, in lineup order. A best-ball spot fills itself at
 *  resolve (any stored row in it is ignored), so the console shows it and
 *  doesn't offer to set it. */
export function fixSlots(mode: Mode | null | undefined): FixSlot[] {
  const defs = leagueSlotDefs(mode);
  const names = slotDisplayNames(defs);
  const bb = new Set(leagueBestball(mode));
  return defs.map((d, i) => ({ slot: d.slot, name: names[i], bestball: bb.has(d.slot), def: d }));
}

/** The stored rows as a spot → player map, over this league's spots only. */
export function fixChosen(slots: FixSlot[], stored: { slot: string; slug: string | null }[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const s of slots) out[s.slot] = stored.find((r) => r.slot === s.slot)?.slug ?? null;
  return out;
}

/** Who may fill `slot`: accepted by the spot, and not already started in
 *  another. */
export function fixOptions(slots: FixSlot[], slot: string, cands: LineupFixCandidate[], chosen: Record<string, string | null>): LineupFixCandidate[] {
  const s = slots.find((x) => x.slot === slot);
  if (!s) return [];
  const elsewhere = new Set(Object.entries(chosen).filter(([k, v]) => k !== slot && v).map(([, v]) => v));
  return cands.filter((c) => !elsewhere.has(c.slug) && slotAllows(s.def, { id: c.slug, pos: c.pos, team: c.team, exp: c.exp }));
}

/** The whole lineup for the RPC. Best-ball spots are left out: the resolver
 *  fills them itself. */
export function fixPayload(slots: FixSlot[], chosen: Record<string, string | null>): { slot: string; slug: string | null }[] {
  return slots.filter((s) => !s.bestball).map((s) => ({ slot: s.slot, slug: chosen[s.slot] ?? null }));
}

/** Did anything change? */
export function fixChanged(slots: FixSlot[], a: Record<string, string | null>, b: Record<string, string | null>): boolean {
  return slots.some((s) => !s.bestball && (a[s.slot] ?? null) !== (b[s.slot] ?? null));
}
