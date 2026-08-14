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

export interface LeagueScoring {
  tdBonus: number;
  ydMult: number;
  toPenalty: number;
}

export const DEFAULT_SCORING: LeagueScoring = { tdBonus: 0, ydMult: 1, toPenalty: 0 };

/** Bounds a commissioner can set (and the server enforces — 0143). */
export const SCORING_BOUNDS = {
  tdBonus: { min: -3, max: 6, step: 1 },
  ydMult: { min: 0.5, max: 2, step: 0.1 },
  toPenalty: { min: 0, max: 5, step: 1 },
} as const;

let active: LeagueScoring = DEFAULT_SCORING;

/** Install a league's adjustments (null/undefined/partial → defaults fill). */
export function setLeagueScoring(s?: Partial<LeagueScoring> | null): void {
  active = { ...DEFAULT_SCORING, ...(s ?? {}) };
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
  return {
    tdBonus: Math.round(num(o.td_bonus ?? o.tdBonus, 0, SCORING_BOUNDS.tdBonus.min, SCORING_BOUNDS.tdBonus.max)),
    ydMult: Math.round(num(o.yd_mult ?? o.ydMult, 1, SCORING_BOUNDS.ydMult.min, SCORING_BOUNDS.ydMult.max) * 10) / 10,
    toPenalty: Math.round(num(o.to_penalty ?? o.toPenalty, 0, SCORING_BOUNDS.toPenalty.min, SCORING_BOUNDS.toPenalty.max)),
  };
}

export function scoringIsDefault(s: LeagueScoring = active): boolean {
  return s.tdBonus === DEFAULT_SCORING.tdBonus && s.ydMult === DEFAULT_SCORING.ydMult && s.toPenalty === DEFAULT_SCORING.toPenalty;
}

/** Short human line for banners/chips: "TD +2 · YDS ×1.5 · TO −2". */
export function scoringLabel(s: LeagueScoring = active): string {
  const parts: string[] = [];
  if (s.tdBonus !== 0) parts.push(`TD ${s.tdBonus > 0 ? '+' : ''}${s.tdBonus}`);
  if (s.ydMult !== 1) parts.push(`YDS ×${s.ydMult}`);
  if (s.toPenalty !== 0) parts.push(`TO −${s.toPenalty}`);
  return parts.join(' · ');
}
