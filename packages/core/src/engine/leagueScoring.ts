// Per-league scoring adjustments (0143) — LAYERING knobs, not literal editing.
//
// The base scoring system is measured and tuned (see the findings citations
// through sim.ts), and every metric's catalog text quotes its exact numbers —
// so leagues don't get to rewrite the literals. What a commissioner gets is a
// small set of adjustments that LAYER on top of the tuned base, the same way
// Underdog's trailing ×1.5 layers on a flat scorer:
//
//   • tdBonus   — extra points on every touchdown a fielded player scores
//                 (all TD scoring paths, defensive TDs included). Can be
//                 negative for low-TD leagues.
//   • ydMult    — multiplies ALL yardage-derived scoring: flat per-yard
//                 points, drip-rate growth (skill and DST alike). Per-event
//                 scoring (receptions, targets, carries, splash plays, FGs)
//                 is deliberately untouched — scaling those would change the
//                 denial economy the findings priced.
//   • toPenalty — points removed from a player's own bank when he commits a
//                 turnover (INT thrown / fumble lost). Clamped at the bank's
//                 floor: banks never go negative in this game (nukes wipe TO
//                 zero), so the penalty bites what's there.
//
// Defaults are the identity — a league with no adjustments scores bit-for-bit
// identically to before this existed, which is what keeps every parity check
// and every existing league honest.
//
// One league at a time, module-global, same contract as the other engine
// caches: the client sets it when a live board loads (and clears on exit);
// the worker sets it synchronously before EACH matchup's resolve from that
// matchup's league settings. resolveSlot reads it at call time.

import { PLAYER_BIO } from '../data/playerBio';
import { teamFor } from '../data/playerTeam';
import { flagFor } from '../data/commish';

/** A scoped bonus rule (0145): applies only to players matching EVERY given
 *  filter (a missing filter matches all). Rules stack — multipliers multiply,
 *  point bonuses sum. Tenure resolves from the directory bake (exp), team
 *  from the live team layer, position from the player object itself. */
export interface ScopedBonus {
  pos?: string[];
  team?: string[];
  tenure?: 'rookie' | 'y2_3' | 'vet4';
  /** THE SPOT HE IS STANDING IN (v0.300.0, founder: "allow scoped bonuses to
   *  apply to each/any of the starting roster positions as a rule"). Slot ids
   *  from the league's own lineup — `S1…Sn` under the builder — so "the FLEX
   *  scores ×1.5" is a rule about the SPOT, not about the player who happens to
   *  fill it this week. A rule naming spots only matches when the caller says
   *  which spot is being scored; a screen that scores a player outside a lineup
   *  (a card, a projection) passes none, and the rule stands aside rather than
   *  paying out where there is no spot. */
  slot?: string[];
  /** THE COMMISSIONER'S FLAG on him (v0.300.0, founder: "we also want scoped
   *  bonuses for flags"). Matched on the flag's LABEL, case-insensitively,
   *  because the label is what the commissioner typed and what everyone in the
   *  league reads. Flags already carry their own ×/+ rules (0144); this is the
   *  other direction — one scoped rule that pays every player wearing a flag,
   *  set once instead of edited into each flag. */
  flag?: string[];
  bonusMult?: number;
  bonusPts?: number;
  tdBonus?: number;
}

/** What the SCORER knows beyond the player — the spot being scored, when there
 *  is one. Optional everywhere: absent means "not in a lineup right now". */
export interface ScopeContext { slot?: string | null }

export interface LeagueScoring {
  tdBonus: number;
  ydMult: number;
  toPenalty: number;
  scoped: ScopedBonus[];
}

export const DEFAULT_SCORING: LeagueScoring = { tdBonus: 0, ydMult: 1, toPenalty: 0, scoped: [] };

/** Bounds a commissioner can set (and the server enforces — 0143). */
export const SCORING_BOUNDS = {
  tdBonus: { min: -3, max: 6, step: 1 },
  ydMult: { min: 0.5, max: 2, step: 0.1 },
  toPenalty: { min: 0, max: 5, step: 1 },
} as const;

let active: LeagueScoring = DEFAULT_SCORING;

/** Install a league's adjustments (null/undefined/partial → defaults fill). */
export function setLeagueScoring(s?: Partial<LeagueScoring> | null): void {
  active = { ...DEFAULT_SCORING, scoped: [], ...(s ?? {}) };
}

export function clearLeagueScoring(): void {
  active = DEFAULT_SCORING;
}

/** The adjustments in force — engine internals read this at resolve time. */
export function leagueScoring(): LeagueScoring {
  return active;
}

/** Clamp arbitrary (settings_json) input into a valid LeagueScoring. */
export function parseScoring(raw: unknown): LeagueScoring {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, dflt: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  const scopedRaw = o.scoped;
  const scoped: ScopedBonus[] = [];
  if (Array.isArray(scopedRaw)) {
    for (const e of scopedRaw.slice(0, 12)) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      const rule: ScopedBonus = {};
      if (Array.isArray(r.pos)) rule.pos = r.pos.filter((x): x is string => typeof x === 'string').map((x) => x.toUpperCase()).slice(0, 8);
      if (Array.isArray(r.team)) rule.team = r.team.filter((x): x is string => typeof x === 'string').map((x) => x.toUpperCase()).slice(0, 32);
      if (r.tenure === 'rookie' || r.tenure === 'y2_3' || r.tenure === 'vet4') rule.tenure = r.tenure;
      if (Array.isArray(r.slot)) rule.slot = r.slot.filter((x): x is string => typeof x === 'string').map((x) => x.toUpperCase()).slice(0, 20);
      if (Array.isArray(r.flag)) rule.flag = r.flag.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 12);
      const bm = Math.round(num(r.bonus_mult ?? r.bonusMult, 1, 0.5, 3) * 10) / 10;
      if (bm !== 1) rule.bonusMult = bm;
      const bp = Math.round(num(r.bonus_pts ?? r.bonusPts, 0, -10, 10) * 10) / 10;
      if (bp !== 0) rule.bonusPts = bp;
      const td = Math.round(num(r.td_bonus ?? r.tdBonus, 0, -3, 6));
      if (td !== 0) rule.tdBonus = td;
      if (rule.bonusMult != null || rule.bonusPts != null || rule.tdBonus != null) scoped.push(rule);
    }
  }
  return {
    tdBonus: Math.round(num(o.td_bonus ?? o.tdBonus, 0, SCORING_BOUNDS.tdBonus.min, SCORING_BOUNDS.tdBonus.max)),
    ydMult: Math.round(num(o.yd_mult ?? o.ydMult, 1, SCORING_BOUNDS.ydMult.min, SCORING_BOUNDS.ydMult.max) * 10) / 10,
    toPenalty: Math.round(num(o.to_penalty ?? o.toPenalty, 0, SCORING_BOUNDS.toPenalty.min, SCORING_BOUNDS.toPenalty.max)),
    scoped,
  };
}

/** The aggregated scoped adjustment for one player: multipliers multiply,
 *  point bonuses sum, across every matching rule. Identity when nothing
 *  matches, so call sites can apply unconditionally. */
export function scopedAdjustFor(
  player: { id: string; pos: string; team?: string | null },
  ctx?: ScopeContext,
): { mult: number; pts: number; td: number } {
  const out = { mult: 1, pts: 0, td: 0 };
  const rules = active.scoped;
  if (!rules.length) return out;
  const bio = PLAYER_BIO[player.id];
  const team = (teamFor(player.id) ?? player.team ?? '').toUpperCase();
  const exp = bio?.exp;
  const slot = ctx?.slot ? ctx.slot.toUpperCase() : null;
  // The flag is read lazily: most leagues flag nobody, and this runs per play.
  let flagLabel: string | null | undefined;
  for (const r of rules) {
    if (r.pos && !r.pos.includes(player.pos.toUpperCase())) continue;
    if (r.team && !r.team.includes(team)) continue;
    if (r.slot) {
      // No spot in play ⇒ a spot rule cannot claim to apply. Standing aside is
      // the honest answer: paying it would make a projection disagree with the
      // board that actually fields him.
      if (!slot || !r.slot.includes(slot)) continue;
    }
    if (r.flag) {
      if (flagLabel === undefined) flagLabel = flagFor(player.id);
      if (!flagLabel) continue;
      const lab = flagLabel.trim().toLowerCase();
      if (!r.flag.some((f) => f.trim().toLowerCase() === lab)) continue;
    }
    if (r.tenure) {
      if (exp == null) continue;                      // unknown tenure never matches a tenure rule
      if (r.tenure === 'rookie' && exp !== 0) continue;
      if (r.tenure === 'y2_3' && (exp < 1 || exp > 2)) continue;
      if (r.tenure === 'vet4' && exp < 3) continue;
    }
    if (r.bonusMult != null) out.mult *= r.bonusMult;
    if (r.bonusPts != null) out.pts += r.bonusPts;
    if (r.tdBonus != null) out.td += r.tdBonus;
  }
  out.mult = Math.round(out.mult * 100) / 100;
  out.pts = Math.round(out.pts * 10) / 10;   // halves sum clean (0146)
  return out;
}

export function scoringIsDefault(s: LeagueScoring = active): boolean {
  return s.tdBonus === DEFAULT_SCORING.tdBonus && s.ydMult === DEFAULT_SCORING.ydMult
    && s.toPenalty === DEFAULT_SCORING.toPenalty && (s.scoped?.length ?? 0) === 0;
}

/** Short human line for banners/chips: "TD +2 · YDS ×1.5 · TO −2". */
export function scoringLabel(s: LeagueScoring = active): string {
  const parts: string[] = [];
  if (s.tdBonus !== 0) parts.push(`TD ${s.tdBonus > 0 ? '+' : ''}${s.tdBonus}`);
  if (s.ydMult !== 1) parts.push(`YDS ×${s.ydMult}`);
  if (s.toPenalty !== 0) parts.push(`TO −${s.toPenalty}`);
  if (s.scoped?.length) parts.push(`${s.scoped.length} scoped bonus${s.scoped.length === 1 ? '' : 'es'}`);
  return parts.join(' · ');
}

/** One scoped rule as the editor lists it: "QB·WR / DAL / rookies: ×1.5 +3".
 *  `slotNames` (v0.300.0) maps slot ids to the league's own spot names, so a
 *  spot rule reads "in FLEX" rather than "in S7" wherever the caller knows the
 *  lineup; without it the id stands, which is still unambiguous. */
export function scopedRuleLabel(r: ScopedBonus, slotNames?: Record<string, string>): string {
  const scope = [
    r.pos?.length ? r.pos.join('·') : null,
    r.team?.length ? r.team.join('·') : null,
    r.tenure === 'rookie' ? 'rookies' : r.tenure === 'y2_3' ? '2nd–3rd yr' : r.tenure === 'vet4' ? 'vets 4+' : null,
    r.slot?.length ? `in ${r.slot.map((x) => slotNames?.[x] ?? x).join('·')}` : null,
    r.flag?.length ? `⚑ ${r.flag.join('·')}` : null,
  ].filter(Boolean).join(' / ') || 'everyone';
  const vals = [
    r.bonusMult != null ? `×${r.bonusMult}` : null,
    r.bonusPts != null ? `${r.bonusPts > 0 ? '+' : ''}${r.bonusPts}` : null,
    r.tdBonus != null ? `TD ${r.tdBonus > 0 ? '+' : ''}${r.tdBonus}` : null,
  ].filter(Boolean).join(' ');
  return `${scope}: ${vals}`;
}
