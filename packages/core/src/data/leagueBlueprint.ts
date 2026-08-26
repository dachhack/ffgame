// COPY THE SETTINGS FROM AN EXISTING LEAGUE (founder: "When creating a new
// league, you should be able to copy the settings from an existing").
//
// A league's settings do not live in one place, and that is the whole reason
// this module exists rather than a `p_copy_from` argument on create:
//
//   TIER 1 — settable AT CREATION. Teams, roster size, draft type and clock,
//     auction budget/lots, the overnight window, positional caps, drip vs
//     classic, keeper/dynasty and its N. These ride create_native_league.
//   TIER 2 — the SCORING catalog, one call after the league exists.
//   TIER 3 — roster and transaction rules: waivers, FAAB, trade review, the
//     waiver/FA windows, the taxi squad, which tags qualify for IR. Several
//     calls, all after creation.
//
// So a copy is a create followed by a short sequence of setters, and the
// sequence can PARTIALLY FAIL while leaving a perfectly real league behind.
// That is the fact this module is built around: `applyBlueprint` never throws
// and never rolls back. It returns what carried and what didn't, so the screen
// can say so. A copy that silently dropped the scoring catalog would be worse
// than one that never offered to bring it — the commissioner would find out in
// week 1, from a score.
//
// ORDER IS LOAD-BEARING, in one place: setLeagueFormat presets a $1000 FAAB
// market for a guillotine league, so the format goes on BEFORE the transaction
// rules. Reverse them and the copied FAAB budget is overwritten by the preset.
import {
  draftState, leagueGameMode, leagueScoringGet, rosterRules,
  leagueScoringSet, setLeagueFormat, setTransactionRules, setTaxiRules, setIrRules,
  setLeagueGolf, setLeagueBestball, setLeagueClassicRoster, setLeagueClassicSlots,
  setLeagueRosterShape, setLeagueClassicScoring, setLeagueGameMode,
  type LeagueContinuity, type LeagueFormat, type PosCaps, type WaiverMode, type TradeReview,
} from './liveApi';

/** The league-list fields a blueprint cannot be read from an RPC — they come
 *  off the row the picker already has in hand (`Enrollment.league`). Passing
 *  them beats inventing a read: every caller is choosing from a list that
 *  carries them, and a commissioner cannot copy a league they cannot see. */
export interface BlueprintSource {
  rosters?: number | null;
  continuity?: LeagueContinuity | null;
  format?: LeagueFormat | null;
  game_mode?: 'drip' | 'classic' | null;
}

/** Tier 3, kept as one object so `applyBlueprint` can skip the whole group
 *  when the source league had nothing worth carrying. */
export interface BlueprintRules {
  waiverMode: WaiverMode | null;
  faabBudget: number | null;
  tradeReview: TradeReview | null;
  waiverClearMin: number | null;
  waiverClearDow: number[] | null;
  faAfterWaiversDow: number[] | null;
  waiverHoldDays: number | null;
  faStartMin: number | null;
  faEndMin: number | null;
  taxiMaxExp: number | null;
  taxiLock: boolean | null;
  irTags: string[] | null;
}

/** The classic-league SHAPE (0175 onward): what a classic league is actually
 *  made of. Null on a drip league, where the shape is the game's own. */
export interface BlueprintClassic {
  ppr: number | null;
  golf: boolean;
  bestball: string[] | null;
  roster: Record<string, number> | null;
  slots: unknown[] | null;
  shape: { bench?: number; taxi?: number; ir?: number } | null;
  scoring: Record<string, number> | null;
}

export interface LeagueBlueprint {
  /** Where it came from, for the screen to name and for a STATUS trail. */
  sourceLeagueId: string;
  // ── tier 1 ────────────────────────────────────────────────────────────────
  teams: number;
  rounds: number;
  pickSeconds: number;
  mode: 'snake' | 'linear' | 'auction';
  budget: number;
  lotSeconds: number;
  maxLots: number;
  nightStartMin: number | null;
  nightEndMin: number | null;
  posCaps: PosCaps | null;
  gameMode: 'drip' | 'classic';
  continuity: LeagueContinuity;
  continuityN: number | null;
  format: LeagueFormat;
  // ── tier 2 ────────────────────────────────────────────────────────────────
  scoring: { tdBonus: number; ydMult: number; toPenalty: number; scoped: unknown[] } | null;
  // ── tier 3 ────────────────────────────────────────────────────────────────
  rules: BlueprintRules | null;
  classic: BlueprintClassic | null;
  /** Settings the source league HAS but this read could not see — surfaced so
   *  the screen can be honest rather than implying a total copy. */
  unread: string[];
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Read every copyable setting off an existing league.
 *
 *  Four reads, run together. A failure in any ONE of them costs only the tier
 *  it covers — the blueprint still creates a league, it just carries less, and
 *  says which part it lost in `unread`. Refusing to produce a blueprint at all
 *  because the scoring row would not load is the wrong trade: the commissioner
 *  asked to copy a league, not to copy it perfectly or not at all. */
export async function readBlueprint(leagueId: string, src: BlueprintSource = {}): Promise<LeagueBlueprint> {
  const [draft, game, rules, scoring] = await Promise.all([
    draftState(leagueId).catch(() => null),
    leagueGameMode(leagueId).catch(() => null),
    rosterRules(leagueId).catch(() => null),
    leagueScoringGet(leagueId).catch(() => null),
  ]);
  const unread: string[] = [];
  if (!draft || draft.error) unread.push('draft setup');
  if (!game || game.error) unread.push('game mode');
  if (!rules || rules.error) unread.push('roster & transaction rules');
  if (!scoring || scoring.error) unread.push('scoring');

  const gameMode = (game?.mode ?? src.game_mode ?? 'drip') as 'drip' | 'classic';
  // rounds means ROSTER SIZE (a load-bearing decision — see draft.rounds in the
  // kickoff notes), and three reads know it. Prefer the draft's, which is the
  // one create_native_league is going to be handed.
  const rounds = num(draft?.rounds, num(rules?.rounds, num(game?.rounds, 15)));

  return {
    sourceLeagueId: leagueId,
    teams: num(src.rosters, 12),
    rounds,
    pickSeconds: num(draft?.pick_seconds, 90),
    mode: (draft?.mode ?? 'snake') as 'snake' | 'linear' | 'auction',
    budget: num(draft?.budget, 200),
    lotSeconds: num(draft?.lot_seconds, 15),
    maxLots: num(draft?.max_lots, 1),
    nightStartMin: draft?.night ? num(draft.night.start_min, 0) : null,
    nightEndMin: draft?.night ? num(draft.night.end_min, 0) : null,
    posCaps: rules?.pos_caps ?? null,
    gameMode,
    continuity: (src.continuity ?? 'redraft') as LeagueContinuity,
    // The keeper/rookie count is not read back anywhere, so it is deliberately
    // NOT guessed: create_native_league treats null as "the continuity's own
    // default", which is a defensible copy, and the form still shows the field.
    continuityN: null,
    format: (src.format ?? 'standard') as LeagueFormat,
    scoring: scoring && !scoring.error && typeof scoring.td_bonus === 'number'
      ? {
        tdBonus: num(scoring.td_bonus, 0),
        ydMult: num(scoring.yd_mult, 1),
        toPenalty: num(scoring.to_penalty, 0),
        scoped: Array.isArray(scoring.scoped) ? scoring.scoped : [],
      }
      : null,
    rules: rules && !rules.error
      ? {
        waiverMode: (rules.waiver_mode ?? null) as WaiverMode | null,
        faabBudget: typeof rules.faab_budget === 'number' ? rules.faab_budget : null,
        tradeReview: (rules.trade_review ?? null) as TradeReview | null,
        waiverClearMin: rules.waiver_clear_min ?? null,
        waiverClearDow: rules.waiver_clear_dow ?? null,
        faAfterWaiversDow: rules.fa_after_waivers_dow ?? null,
        waiverHoldDays: typeof rules.waiver_hold_days === 'number' ? rules.waiver_hold_days : null,
        faStartMin: rules.fa_start_min ?? null,
        faEndMin: rules.fa_end_min ?? null,
        taxiMaxExp: rules.taxi_max_exp ?? null,
        taxiLock: typeof rules.taxi_lock === 'boolean' ? rules.taxi_lock : null,
        irTags: Array.isArray(rules.ir_tags) ? (rules.ir_tags as string[]) : null,
      }
      : null,
    classic: gameMode === 'classic' && game && !game.error
      ? {
        ppr: typeof game.ppr === 'number' ? game.ppr : null,
        golf: !!game.golf,
        bestball: Array.isArray(game.bestball) ? game.bestball : null,
        roster: game.roster ?? null,
        slots: (game.slots ?? null) as unknown[] | null,
        shape: game.shape ?? null,
        scoring: game.scoring ?? null,
      }
      : null,
    unread,
  };
}

/** The tier-1 arguments, in `createNativeLeague`'s own parameter order. Kept
 *  as a tuple so a change to that signature breaks HERE, at compile time,
 *  rather than silently shifting an argument in two different create forms. */
export function blueprintCreateArgs(bp: LeagueBlueprint, name: string, season: string) {
  return [
    name, season, bp.teams, bp.rounds, bp.pickSeconds,
    bp.mode, bp.budget, bp.lotSeconds, bp.mode === 'auction' ? bp.maxLots : 1,
    bp.nightStartMin, bp.nightEndMin, bp.posCaps, bp.gameMode,
    bp.continuity, bp.continuityN,
  ] as const;
}

export interface ApplyStep { step: string; ok: boolean; error?: string }

/** Everything a blueprint carries that create_native_league could NOT.
 *
 *  Never throws, never rolls back: by the time this runs the league exists and
 *  the commissioner is looking at it. Each step is independent and reports
 *  itself, so a screen can print "scoring and waivers carried, the taxi squad
 *  did not" instead of a single word that hides which half worked. */
export async function applyBlueprint(leagueId: string, bp: LeagueBlueprint): Promise<ApplyStep[]> {
  const steps: ApplyStep[] = [];
  const run = async (step: string, fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    try {
      const r = await fn();
      steps.push(r && r.ok === false
        ? { step, ok: false, error: r.error ?? 'refused' }
        : { step, ok: true });
    } catch (e) {
      steps.push({ step, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // FORMAT FIRST — guillotine presets a $1000 FAAB market, so a copied budget
  // has to be written after it or the preset wins.
  if (bp.format !== 'standard') await run('format', () => setLeagueFormat(leagueId, bp.format));

  if (bp.gameMode === 'classic' && bp.classic) {
    const c = bp.classic;
    if (typeof c.ppr === 'number') await run('PPR', () => setLeagueGameMode(leagueId, 'classic', c.ppr as number));
    if (c.roster) await run('classic roster', () => setLeagueClassicRoster(leagueId, c.roster as Record<string, number>));
    if (c.slots) await run('lineup slots', () => setLeagueClassicSlots(leagueId, c.slots as never));
    if (c.shape) {
      await run('bench / taxi / IR', () => setLeagueRosterShape(
        leagueId, num(c.shape?.bench, 0), num(c.shape?.taxi, 0), num(c.shape?.ir, 0)));
    }
    if (c.scoring) await run('classic scoring', () => setLeagueClassicScoring(leagueId, c.scoring as Record<string, number>));
    if (c.bestball) await run('best ball', () => setLeagueBestball(leagueId, c.bestball as string[]));
    // Golf LOCKS at the first pick, so it has to be set on a pending draft —
    // which a league created seconds ago always is.
    if (c.golf) await run('golf mode', () => setLeagueGolf(leagueId, true));
  }

  if (bp.scoring) {
    const s = bp.scoring;
    await run('scoring', () => leagueScoringSet(leagueId, s.tdBonus, s.ydMult, s.toPenalty, s.scoped));
  }

  if (bp.rules) {
    const r = bp.rules;
    await run('waivers & trades', () => setTransactionRules(
      leagueId, r.waiverMode, r.faabBudget, r.tradeReview,
      r.waiverClearMin, r.waiverHoldDays, r.faStartMin, r.faEndMin,
      r.waiverClearDow, r.faAfterWaiversDow, null));
    if (r.taxiMaxExp !== null || r.taxiLock !== null) {
      await run('taxi squad', () => setTaxiRules(leagueId, r.taxiMaxExp, r.taxiLock));
    }
    if (r.irTags && r.irTags.length) await run('IR tags', () => setIrRules(leagueId, r.irTags as string[]));
  }

  return steps;
}

/** One line per setting group, for the picker to say what is about to carry.
 *  Deliberately describes the BLUEPRINT rather than the league it came from —
 *  what the reader needs to know is what the new league will be. */
export function blueprintSummary(bp: LeagueBlueprint): string[] {
  const out: string[] = [];
  const draft = bp.mode === 'auction'
    ? `auction · $${bp.budget} · ${bp.lotSeconds}s lots`
    : `${bp.mode} · ${bp.pickSeconds}s`;
  out.push(`${bp.teams} teams · ${bp.rounds}-man roster · ${draft}`);
  out.push(`${bp.gameMode === 'classic' ? 'CLASSIC' : 'DRIP'}${bp.format !== 'standard' ? ` · ${bp.format.toUpperCase()}` : ''}${bp.continuity !== 'redraft' ? ` · ${bp.continuity.replace('_', ' ').toUpperCase()}` : ''}`);
  if (bp.classic?.golf) out.push('golf mode — lowest weekly total wins');
  if (bp.scoring) out.push(`scoring: TD +${bp.scoring.tdBonus} · yards ×${bp.scoring.ydMult} · TO ${bp.scoring.toPenalty}${bp.scoring.scoped.length ? ` · ${bp.scoring.scoped.length} scoped` : ''}`);
  if (bp.classic?.scoring) out.push(`classic catalog: ${Object.keys(bp.classic.scoring).length} priced fields`);
  if (bp.rules?.waiverMode) {
    out.push(`waivers: ${bp.rules.waiverMode}${bp.rules.waiverMode === 'faab' && bp.rules.faabBudget != null ? ` · $${bp.rules.faabBudget}` : ''}${bp.rules.tradeReview === 'commish' ? ' · commish reviews trades' : ''}`);
  }
  return out;
}
