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

/** A scoped bonus rule (0145): applies only to players matching EVERY given
 *  filter (a missing filter matches all). Rules stack — multipliers multiply,
 *  point bonuses sum. Tenure resolves from the directory bake (exp), team
 *  from the live team layer, position from the player object itself. */
export interface ScopedBonus {
  pos?: string[];
  team?: string[];
  tenure?: 'rookie' | 'y2_3' | 'vet4';
  bonusMult?: number;
  bonusPts?: number;
  tdBonus?: number;
}

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
      const bm = Math.round(num(r.bonus_mult ?? r.bonusMult, 1, 0.5, 3) * 10) / 10;
      if (bm !== 1) rule.bonusMult = bm;
      const bp = Math.round(num(r.bonus_pts ?? r.bonusPts, 0, -10, 10));
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
export function scopedAdjustFor(player: { id: string; pos: string; team?: string | null }): { mult: number; pts: number; td: number } {
  const out = { mult: 1, pts: 0, td: 0 };
  const rules = active.scoped;
  if (!rules.length) return out;
  const bio = PLAYER_BIO[player.id];
  const team = (teamFor(player.id) ?? player.team ?? '').toUpperCase();
  const exp = bio?.exp;
  for (const r of rules) {
    if (r.pos && !r.pos.includes(player.pos.toUpperCase())) continue;
    if (r.team && !r.team.includes(team)) continue;
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

/** One scoped rule as the editor lists it: "QB·WR / DAL / rookies: ×1.5 +3". */
export function scopedRuleLabel(r: ScopedBonus): string {
  const scope = [
    r.pos?.length ? r.pos.join('·') : null,
    r.team?.length ? r.team.join('·') : null,
    r.tenure === 'rookie' ? 'rookies' : r.tenure === 'y2_3' ? '2nd–3rd yr' : r.tenure === 'vet4' ? 'vets 4+' : null,
  ].filter(Boolean).join(' / ') || 'everyone';
  const vals = [
    r.bonusMult != null ? `×${r.bonusMult}` : null,
    r.bonusPts != null ? `${r.bonusPts > 0 ? '+' : ''}${r.bonusPts}` : null,
    r.tdBonus != null ? `TD ${r.tdBonus > 0 ? '+' : ''}${r.tdBonus}` : null,
  ].filter(Boolean).join(' ');
  return `${scope}: ${vals}`;
}
