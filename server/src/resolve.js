// Server-authoritative resolution.
//
// When BOTH managers are enrolled, this runs the REAL Drip engine (the same
// src/engine/sim.ts the client runs, via server/src/engine.js): each side's
// sealed picks are paired by (game_window, roster_slot) and resolved with full
// metric effects (nuke/erase/streak/drip). When an opponent is NOT enrolled, we
// fall back to base fantasy points off their real Sleeper starters (no hidden
// metrics to resolve) — see baseScore.
//
// Inputs:
//   • live_play rows for the week → injected into the engine via injectWeek so
//     resolveSlot reads them through realPbpFor(week, slug).
//   • sealed_pick rows (enrolled, post-lock) or sleeper_lineup (fallback).
//
// The live H2H path runs the shared resolver (src/engine/liveResolve.ts) — the
// SAME one the in-browser admin force-resolve uses — so the worker and the
// founder's preview produce identical scores. It layers cross-window Field
// General + best-ball backups on top of per-slot resolveSlot. DEF suppress,
// cross-window TE-TD nukes, and the K banker bonus remain simplified there.
import { db } from './supabase.js';
import { config } from './config.js';
import { injectWeek, makePlayer, resolveLiveMatchup, resolveWindow, rowsToPbp, autoLineup, EMPTY, resolveClassicMatchup, CLASSIC_WIN, classicSlots, leagueSlotDefs, leagueBestball, assignSealedRows, playsFor } from './engine.js';
import { matchupPremium, premiumTier, hasPremiumContent, gateSide, hasPremiumTargeted, gateTargeted } from './premium.js';
import { slugMeta } from '../../packages/core/src/data/slugMeta.ts';
import { starterSlugs } from '../../packages/core/src/data/poolEntry.ts';
// Shared with the client and migration 0110: board weeks above PRESEASON_BASE
// are throwaway practice and never move real coin.
import { isPreseasonWeek as isPracticeWeek } from '../../packages/core/src/data/nflSlate.ts';
import { setLeagueScoring, parseScoring } from '../../packages/core/src/engine/leagueScoring.ts';
import { setLeagueFlags } from '../../packages/core/src/data/commish.ts';

/** PPR + K + DST points from a player's RealPlay rows (unenrolled-opponent fallback). */
export function baseScore(plays) {
  let recYds = 0, rushYds = 0, passYds = 0, rec = 0, rushTd = 0, recTd = 0, passTd = 0, sp = 0;
  for (const p of plays) {
    if (p.k === 'pass') { passYds += p.y; if (p.td) passTd++; }
    else if (p.k === 'rush') { rushYds += p.y; if (p.td) rushTd++; }
    else if (p.k === 'rec') { rec++; recYds += p.y; if (p.td) recTd++; }
    else if (p.k === 'fg') sp += p.y < 40 ? 3 : p.y < 50 ? 4 : 5;
    else if (p.k === 'xp') sp += 1; else if (p.k === 'sack') sp += 1;
    else if (p.k === 'int') sp += 3; else if (p.k === 'fumrec') sp += 2;
    else if (p.k === 'dst_td') sp += 6; else if (p.k === 'safety') sp += 2;
  }
  return Math.round((rec + recYds * 0.1 + rushYds * 0.1 + (rushTd + recTd) * 6 + passYds * 0.04 + passTd * 4 + sp) * 10) / 10;
}

async function weekPlayRows(week) {
  // Page through the full week. PostgREST caps an un-ranged select at its
  // max-rows default (1000); a busy Sunday runs to several thousand plays, so an
  // un-paged read would silently truncate and the worker would compute the
  // AUTHORITATIVE scores off an incomplete play set.
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from('live_play')
      .select('player_slug,c,t,pid,k,y,td,ca,tg,"to"')
      .eq('week', week)
      .order('id', { ascending: true }) // stable total order (bigint PK) for paging
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Fetch the week's plays ONCE and inject them into the engine's PBP cache. Call
 *  this once per tick before resolving many matchups — they all read the same
 *  global week feed, so per-matchup re-fetching is pure waste at scale. */
export async function injectWeekPlays(week) {
  const rows = await weekPlayRows(week);
  const by = rowsToPbp(rows);
  injectWeek(week, by);
  console.log(new Date().toISOString(), 'inject wk', week, rows.length, 'plays,', Object.keys(by).length, 'players');
}

// The per-matchup gatherers below take an optional `ctx` (from prefetchTick). When
// present they read from the bulk-prefetched maps — no per-matchup query — which is
// what keeps the Sunday tick fast at ~100 leagues (one tick = ~5 bulk reads instead
// of ~6 × 600). When `ctx` is absent (sim / single-matchup CLI) they self-fetch,
// byte-identical to before.

/** Enrolled side's revealed picks: [{ win, slot, slug, metric }] — LOCKED rows
 *  only (windows seal at their own kickoff, so mid-week this is the windows
 *  already underway). Returns [] when the manager HAS picks but none are sealed
 *  yet (e.g. a deliberately-empty TNF — nothing fields until Sunday); null only
 *  when they have no picks at all (caller then uses the auto-lineup fallback).
 *  Without the distinction, a manager's real-but-unsealed week would resolve as
 *  a phantom AI lineup until their first window locked. */
// Saved picks score for ANY claimed seat (founder's ruling, live playtest
// 8/15): a manager who set a lineup gets scored on it whether or not the seat
// is "enrolled" — what the board reveals is what the resolver fields.
// Enrollment still gates everything else it gated; it just no longer zeroes a
// lineup somebody actually set. Truly empty/absent seats keep the aiSide /
// policy fallbacks below.
/** Every sealed row on a matchup, ALL authors — the seat-assignment pass
 *  (assignSealedRows) decides which seat each row belongs to. Fetching by
 *  author was the vacated-seat bug: rows outlive a seat reassignment, so a
 *  previous occupant's locked lineup rendered on the board (getRevealedPicks
 *  reads by matchup) while the resolver, matching rows to the CURRENT
 *  membership, fielded nothing. */
async function matchupSealedRows(matchup, ctx) {
  if (ctx) return ctx.allPicks.get(matchup.id) ?? [];
  const { data } = await db().from('sealed_pick')
    .select('app_user_id,game_window,roster_slot,player_slug,metric_id,locked')
    .eq('matchup_id', matchup.id).not('player_slug', 'is', null);
  return data ?? [];
}

/** A seat's rows → the resolver's pick shape. null = the seat has NO rows at
 *  all (fallbacks apply); [] = rows exist but none locked yet (a set-but-unsealed
 *  lineup fields empty rather than getting an AI rebuild — same distinction
 *  enrolledPicks drew). */
const seatPicks = (rows) => {
  if (!rows.length) return null;
  return rows.filter((p) => p.locked).map((p) => ({ win: p.game_window, slot: p.roster_slot, slug: p.player_slug, metric: p.metric_id }));
};

/** A roster's real Sleeper STARTERS (the unenrolled-opponent fallback / player pool).
 *
 *  starters_json now holds the manager's whole roster — starters, bench, IR,
 *  taxi — because a human fielding a lineup should be able to pick anyone they
 *  own. This fallback deliberately does NOT widen with it: it stands in for an
 *  absent manager, and the lineup an absent manager would have fielded is the
 *  one Sleeper has them starting, not their IR stash. Filtering here keeps the
 *  scoring rule exactly what it was. */
async function lineupSlugs(matchup, rosterId, ctx) {
  if (ctx) return ctx.lineups.get(`${matchup.league_id}:${rosterId}`) ?? [];
  const { data } = await db().from('sleeper_lineup').select('starters_json')
    .eq('league_id', matchup.league_id).eq('week', matchup.week).eq('roster_id', rosterId).maybeSingle();
  return starterSlugs(data?.starters_json);
}

/** A side's armed loadout (applied_state.payload_json) for this matchup — buffs and
 *  metric unlocks bought via the arm RPCs / the AI budget pass. Empty when none. */
async function loadout(matchupId, appUserId, ctx) {
  if (!appUserId) return {};
  if (ctx) return ctx.applied.get(`${matchupId}:${appUserId}`) ?? {};
  const { data } = await db().from('applied_state').select('payload_json')
    .eq('matchup_id', matchupId).eq('app_user_id', appUserId).maybeSingle();
  return data?.payload_json ?? {};
}
/** The league's scoring adjustments (0143) — raw settings_json.scoring or null. */
async function leagueScoringOf(leagueId, ctx) {
  if (ctx) return ctx.scoring?.get(leagueId) ?? null;
  const { data } = await db().from('league').select('settings_json').eq('id', leagueId).maybeSingle();
  return data?.settings_json?.scoring ?? null;
}

/** The league's game mode (0157): 'drip' (default) | 'classic', plus the
 *  classic PPR knob and the best-ball slot set (0159). Classic resolves
 *  through resolveClassicMatchup below. */
const modeOfSettings = (s) => ({
  mode: s?.game_mode === 'classic' ? 'classic' : 'drip',
  ppr: Number.isFinite(Number(s?.ppr)) ? Number(s.ppr) : 1,
  bestball: Array.isArray(s?.bestball) ? s.bestball.map(String) : [],
  // The commissioner's classic scoring overrides (0160) — raw; the engine's
  // normalizeClassicScoring supplies every default.
  scoring: (s?.scoring_classic && typeof s.scoring_classic === 'object') ? s.scoring_classic : null,
  // The configured starting lineup (0161) — raw counts; classicSlots defaults.
  roster: (s?.roster_classic && typeof s.roster_classic === 'object') ? s.roster_classic : null,
  // The roster BUILDER spec (0163) — ordered spots with per-spot eligibility +
  // best ball; when present it wins over roster/bestball (leagueSlotDefs /
  // leagueBestball resolve the precedence engine-side).
  slots: Array.isArray(s?.roster_slots) ? s.roster_slots : null,
});
async function leagueModeOf(leagueId, ctx) {
  if (ctx) return ctx.mode?.get(leagueId) ?? { mode: 'drip', ppr: 1, bestball: [], scoring: null, roster: null, slots: null };
  const { data } = await db().from('league').select('settings_json').eq('id', leagueId).maybeSingle();
  return modeOfSettings(data?.settings_json);
}

/** The league's player flags (0144) — rows for the engine cache, [] when none. */
async function leagueFlagsOf(leagueId, ctx) {
  if (ctx) return ctx.flags?.get(leagueId) ?? [];
  const { data } = await db().from('player_flag').select('slug,label,rules').eq('league_id', leagueId);
  return (data ?? []).map((r) => ({ slug: r.slug, label: r.label, rules: r.rules ?? {} }));
}

/** The league's missed-pick policy: 'best_lineup' (default) | 'ai' | 'empty'. */
async function lineupPolicy(leagueId, ctx) {
  if (ctx) return ctx.policy.get(leagueId) ?? 'best_lineup';
  const { data } = await db().from('league').select('lineup_policy').eq('id', leagueId).maybeSingle();
  return data?.lineup_policy ?? 'best_lineup';
}

/** Bulk-load everything the gatherers above read, for a whole tick's live matchups,
 *  in ~5 queries instead of ~6 per matchup — the round-trip cost the 100-league
 *  load test surfaced (the 0034-indexed scan itself is negligible). Returns a `ctx`
 *  to pass as resolveMatchup's `opts.ctx`. `week` is the tick's week (lineups are
 *  week-scoped; a tick's live matchups all share one week). Without it, resolveMatchup
 *  self-fetches per matchup exactly as before. */
export async function prefetchTick(live, week) {
  const leagueIds = [...new Set(live.map((m) => m.league_id))];
  const matchupIds = live.map((m) => m.id);
  const [mem, lg, lu, ap, pk, fl] = await Promise.all([
    db().from('league_membership').select('league_id,sleeper_roster_id,app_user_id,enrolled,controller').in('league_id', leagueIds),
    db().from('league').select('id,lineup_policy,settings_json').in('id', leagueIds),
    db().from('sleeper_lineup').select('league_id,roster_id,starters_json').in('league_id', leagueIds).eq('week', week),
    db().from('applied_state').select('matchup_id,app_user_id,payload_json').in('matchup_id', matchupIds),
    db().from('sealed_pick').select('matchup_id,app_user_id,game_window,roster_slot,player_slug,metric_id,locked').in('matchup_id', matchupIds).not('player_slug', 'is', null),
    db().from('player_flag').select('league_id,slug,label,rules').in('league_id', leagueIds),
  ]);
  const members = new Map();   // leagueId -> Map(roster -> member)
  for (const m of mem.data ?? []) {
    if (!members.has(m.league_id)) members.set(m.league_id, new Map());
    members.get(m.league_id).set(m.sleeper_roster_id, m);
  }
  const policy = new Map((lg.data ?? []).map((r) => [r.id, r.lineup_policy ?? 'best_lineup']));
  const scoring = new Map((lg.data ?? []).map((r) => [r.id, r.settings_json?.scoring ?? null]));
  const mode = new Map((lg.data ?? []).map((r) => [r.id, modeOfSettings(r.settings_json)]));
  const flags = new Map();     // leagueId -> [{slug,label,rules}] (0144 rules ride the resolve)
  for (const r of fl.data ?? []) {
    if (!flags.has(r.league_id)) flags.set(r.league_id, []);
    flags.get(r.league_id).push({ slug: r.slug, label: r.label, rules: r.rules ?? {} });
  }
  const lineups = new Map();   // `${leagueId}:${roster}` -> slugs[]
  // Starters only — same reasoning as lineupSlugs. The prefetch path and the
  // per-matchup path MUST agree; they are the same rule read two ways, and a
  // divergence would score a league differently depending on tick size.
  for (const r of lu.data ?? []) lineups.set(`${r.league_id}:${r.roster_id}`, starterSlugs(r.starters_json));
  const applied = new Map();   // `${matchupId}:${appUser}` -> payload
  for (const r of ap.data ?? []) applied.set(`${r.matchup_id}:${r.app_user_id}`, r.payload_json ?? {});
  const allPicks = new Map();  // matchupId -> raw sealed rows, ALL authors (seat assignment happens per-resolve)
  for (const p of pk.data ?? []) {
    if (!allPicks.has(p.matchup_id)) allPicks.set(p.matchup_id, []);
    allPicks.get(p.matchup_id).push(p);
  }
  return { members, policy, scoring, mode, flags, lineups, applied, allPicks };
}

/** Resolve one matchup → write matchup_state (per game_window) + finals when final.
 *  `override` (sim only): { home, away } pick arrays [{win,slot,slug,metric}] that
 *  bypass enrollment/sealed-pick gathering so both sides resolve with full metrics. */
export async function resolveMatchup(matchup, playerIndex, override, opts = {}) {
  // Plays are global per week. The tick injects them once (injectWeekPlays) and
  // passes playsInjected, so we skip the whole-week re-fetch per matchup. Standalone
  // callers (sim / single-matchup CLI) omit it and self-fetch as before.
  if (!opts.playsInjected) injectWeek(matchup.week, rowsToPbp(await weekPlayRows(matchup.week)));
  const meta = (slug) => playerIndex?.metaForSlug(slug) ?? null;
  const player = (slug) => { const m = meta(slug); return makePlayer(slug, m?.pos, m?.team, m?.full); };

  const ctx = opts.ctx;
  let members;
  if (ctx) {
    const lm = ctx.members.get(matchup.league_id);
    members = [matchup.home_roster_id, matchup.away_roster_id].map((r) => lm?.get(r)).filter(Boolean);
  } else {
    ({ data: members } = await db().from('league_membership')
      .select('sleeper_roster_id,app_user_id,enrolled,controller').eq('league_id', matchup.league_id)
      .in('sleeper_roster_id', [matchup.home_roster_id, matchup.away_roster_id]));
  }
  const byRoster = new Map((members ?? []).map((m) => [m.sleeper_roster_id, m]));
  const policy = await lineupPolicy(matchup.league_id, ctx);
  // League scoring adjustments (0143): FETCHED here with the other awaits,
  // INSTALLED synchronously right before each resolve call below. The tick
  // resolves matchups 20-at-a-time under Promise.all, so an install separated
  // from its resolve by an await could be overwritten by a sibling matchup —
  // set-then-resolve in one synchronous run is what keeps leagues isolated.
  const scoringKnobs = parseScoring(await leagueScoringOf(matchup.league_id, ctx));
  const flagRows = await leagueFlagsOf(matchup.league_id, ctx);

  // A side's effective lineup AND its armed in-slot buffs. Power-ups (buffs +
  // metric unlocks) are PAID and live in applied_state, keyed by app_user — so any
  // side with an app_user (human OR an AI team flipped from a manager) resolves
  // with exactly what it bought; an app_user-less seat fields a plain lineup, no
  // power-ups. The AI's purchases are made by the lock-time budget pass (it spends
  // its own wallet, blind, on its own roster). Lineups: explicit AI / empty seat /
  // missed-pick (per policy) → auto-lineup using the unlocks the team owns; a
  // human's sealed picks if set. The auto-lineup is rebuilt with exactly the
  // owned unlocks + purchased extra slots in applied_state (written by the
  // lock-time budget pass), so it matches the materialized board picks.
  const aiSide = async (rosterId, mem) => {
    const load = mem?.app_user_id ? await loadout(matchup.id, mem.app_user_id, ctx) : {};
    const owned = new Set(Array.isArray(load.unlocks) ? load.unlocks : []);
    const extra = Number.isFinite(load.extra) ? load.extra : 0;
    return {
      // Permanent AI seats (pods, fake leagues) get the NUKER persona draw —
      // measured drama at zero balance cost (findings §21); human autofill and
      // empty seats stay vanilla, matching lock.js.
      picks: autoLineup(await lineupSlugs(matchup, rosterId, ctx), matchup.week, owned, extra,
        mem?.controller === 'ai' ? `${matchup.league_id}:${rosterId}` : undefined),
      buffs: Array.isArray(load.buffs) ? load.buffs : [],
      // The AI's lock-time budget pass places targeted battle plays (rivalry /
      // ghost — findings §17) into the same targeted payload the human RPCs use.
      targeted: load.targeted,
    };
  };
  // Seat assignment (0199.2): every sealed row on the matchup, split between
  // the two seats by CURRENT occupant — with an orphaned lineup (author on
  // neither seat: a reassigned/vacated seat) adopted by the seat that plainly
  // owns it (single foreign author, exactly one seat without rows of its own).
  // The boards run the SAME rule inside getRevealedPicks, so what renders is
  // what scores. Ambiguous orphans are dropped on both sides of that contract.
  const homeMem = byRoster.get(matchup.home_roster_id);
  const awayMem = byRoster.get(matchup.away_roster_id);
  const seatRows = (matchup.status !== 'scheduled' && !override)
    ? assignSealedRows(await matchupSealedRows(matchup, ctx), homeMem?.app_user_id ?? null, awayMem?.app_user_id ?? null)
    : { home: [], away: [] };
  const sideLineup = async (rosterId) => {
    const mem = byRoster.get(rosterId);
    const picks = seatPicks(rosterId === matchup.home_roster_id ? seatRows.home : seatRows.away);
    // SEALED-FIRST (the 8/15 ruling, completed): locked sealed rows are the
    // lineup for ANY seat that has them — AI/auto-pilot seats included, whose
    // rows were materialized at lock. The aiSide rebuild is for seats with NO
    // sealed rows; letting it override real rows is how an AI seat in a week
    // with no sleeper_lineup (preseason) scored 0 while the board showed its
    // picks. The AI's bought buffs still ride along via the loadout below.
    if (mem?.controller === 'ai' && !(picks && picks.length)) return aiSide(rosterId, mem);
    if (picks) {
      // Buffs + targeted power-ups (swaps / EMP / DoN / Bye Steal) come from the
      // same applied_state payload the arm/apply RPCs write. comboQty = combo
      // drip unlocks purchased (one combodrip slot per purchase; a legacy set
      // flag without a qty reads as 1).
      // mem can be absent when an orphaned lineup was adopted by a seat whose
      // membership row is gone — the picks score, with no purchased extras.
      const load = await loadout(matchup.id, mem?.app_user_id, ctx);
      const unlocks = Array.isArray(load.unlocks) ? load.unlocks : [];
      const comboQty = Number(load.unlockQty?.['unlock-combo-drip'] ?? (unlocks.includes('unlock-combo-drip') ? 1 : 0));
      return { picks, buffs: Array.isArray(load.buffs) ? load.buffs : [], targeted: load.targeted, comboQty };
    }
    if (!mem?.enrolled || !mem?.app_user_id) return aiSide(rosterId, mem);
    if (policy === 'empty') return { picks: null, buffs: [] };
    return aiSide(rosterId, mem);
  };
  const home = override ? { picks: override.home, buffs: [] } : await sideLineup(matchup.home_roster_id);
  const away = override ? { picks: override.away, buffs: [] } : await sideLineup(matchup.away_roster_id);
  let homePicks = home.picks, awayPicks = away.picks;
  let homeBuffs = home.buffs, awayBuffs = away.buffs;
  let homeTargeted = home.targeted, awayTargeted = away.targeted;

  // Premium enforcement (docs/premium-model.md): a NON-premium matchup can't field premium
  // positions (K/DST/IDP), premium-unlock metrics, or premium power-ups. Stripped here at the
  // authoritative resolve regardless of how the rows were written. The cheap pre-check skips
  // the matchup_premium() RPC unless a side actually holds premium content.
  // GATED OFF for the 2026 pilot (config.premiumEnforcement): the premium schema
  // isn't provisioned, so matchup_premium() fails closed and this block would
  // strip every K/DST pick from live scoring while the client shows them unlocked.
  if (config.premiumEnforcement) {
    const tier = await premiumTier();
    const posOf = (slug) => slugMeta(slug).pos;
    if (hasPremiumContent(homePicks, homeBuffs, tier, posOf) || hasPremiumContent(awayPicks, awayBuffs, tier, posOf)
      || hasPremiumTargeted(homeTargeted, tier) || hasPremiumTargeted(awayTargeted, tier)) {
      if (!(await matchupPremium(matchup.id))) {
        if (homePicks) { const g = gateSide(homePicks, homeBuffs, tier, posOf); homePicks = g.picks; homeBuffs = g.buffs; }
        if (awayPicks) { const g = gateSide(awayPicks, awayBuffs, tier, posOf); awayPicks = g.picks; awayBuffs = g.buffs; }
        homeTargeted = gateTargeted(homeTargeted, tier);
        awayTargeted = gateTargeted(awayTargeted, tier);
      }
    }
  }

  const states = []; // { game_window, home_score, away_score }
  let slotRows = []; // per-slot detail: { win, side, slot, slug, metric, score }
  let homeTotal = 0, awayTotal = 0;
  const gameMode = await leagueModeOf(matchup.league_id, ctx);
  let coin = null; // weekly drip-coin per side (only the real-engine H2H path earns it)
  const toLive = (p) => ({ win: p.win, slot: p.slot, player: player(p.slug), metricId: p.metric || 'rush' });

  // Targeted payloads (validated + clamped by the apply RPCs, migration 0060)
  // → engine extras. Slugs become engine Players; numbers re-clamped defensively.
  const toExtras = (t) => {
    if (!t) return undefined;
    const ex = {};
    if (t.don?.win != null && t.don?.slot != null) ex.don = { win: String(t.don.win), slot: String(t.don.slot) };
    // Manual backup assignments (0137): "win#slot" → "win#slot", RPC-validated;
    // re-stringified defensively like everything else in this payload.
    if (t.backups && Object.keys(t.backups).length) {
      ex.backups = {};
      for (const [bk, tk] of Object.entries(t.backups)) ex.backups[String(bk)] = String(tk);
    }
    if (t.byeSteal?.slug) ex.byeSteal = {
      win: String(t.byeSteal.win), slot: String(t.byeSteal.slot),
      // Defensive re-clamp; the engine clamps again at BYE_STEAL_CAP (16, §19).
      player: player(t.byeSteal.slug), pts: Math.max(0, Math.min(16, Number(t.byeSteal.pts) || 0)),
    };
    if (t.emp && Object.keys(t.emp).length) {
      ex.emp = {};
      for (const [w, c] of Object.entries(t.emp)) ex.emp[w] = Math.max(0, Math.min(3900, Number(c) || 0));
    }
    if (t.swaps && Object.keys(t.swaps).length) {
      ex.swaps = {};
      for (const [k, s] of Object.entries(t.swaps)) ex.swaps[k] = {
        toMetricId: s.toMetric ?? undefined,
        toPlayer: s.toPlayer ? player(s.toPlayer) : undefined,
        atClock: Math.max(0, Math.min(3900, Number(s.atClock) || 0)),
        atRt: s.atRt != null ? Number(s.atRt) : undefined,
      };
    }
    // Battle plays (v0.124.0): rivalry = armed window ids; ghost / lead-change /
    // grudge / jinx / red-herring = 'win|slot' lists; the live tacticals map
    // 'win|slot' → fire game-clock (re-clamped). Written by the AI budget pass
    // (lock.js, findings §17) — and by the client apply RPCs once extended.
    for (const k of ['rivalry', 'ghost', 'leadChange', 'grudge', 'jinx', 'redHerring', 'clutchDon']) {
      if (Array.isArray(t[k]) && t[k].length) ex[k] = t[k].map(String);
    }
    for (const k of ['surge', 'coldSnap', 'napalm', 'bunker', 'clutchEncore', 'clutchCounter']) {
      if (t[k] && Object.keys(t[k]).length) {
        ex[k] = {};
        for (const [slot, c] of Object.entries(t[k])) ex[k][slot] = Math.max(0, Math.min(3900, Number(c) || 0));
      }
    }
    return Object.keys(ex).length ? ex : undefined;
  };

  if (gameMode.mode === 'classic') {
    // ── CLASSIC league (0157): standard fantasy, one weekly lineup, no buffs,
    //    no bonuses, no coin. Only 'wk' picks count — a drip-shaped auto-lineup
    //    from the fallback paths must not leak into a classic score, so a side
    //    with no 'wk' rows simply fields nothing (classic's honest missed-lineup:
    //    empty slots score zero, present slots still score). ──
    const classify = (picks) => (picks ?? [])
      .filter((p) => p.win === CLASSIC_WIN && p.slug)
      .map((p) => ({ slot: p.slot, player: player(p.slug) }));
    // Best ball (0159): the flagged slots pick from the FULL drafted roster,
    // so those sides carry it. One 2-row query, only for best-ball leagues.
    const rosters = new Map();
    const bestball = leagueBestball(gameMode);
    const slotDefs = leagueSlotDefs(gameMode);
    if (bestball.length) {
      const { data: ros } = await db().from('native_roster').select('roster_id,slug')
        .eq('league_id', matchup.league_id).eq('spot', 'active') // taxi/IR stashes never fill (0164)
        .in('roster_id', [matchup.home_roster_id, matchup.away_roster_id]);
      // Per-slot tenure filters (0172) check years_exp — visible only via
      // league_pool, so fetch it when a best-ball spot actually has a window.
      const expBySlug = new Map();
      if (slotDefs.some((d) => d.flt && (d.flt.min_exp != null || d.flt.max_exp != null))) {
        const { data: lp } = await db().from('league_pool').select('slug,exp')
          .eq('league_id', matchup.league_id).not('exp', 'is', null).range(0, 1999);
        for (const r of lp ?? []) expBySlug.set(r.slug, r.exp);
      }
      for (const row of ros ?? []) {
        if (!rosters.has(row.roster_id)) rosters.set(row.roster_id, []);
        rosters.get(row.roster_id).push({ ...player(row.slug), exp: expBySlug.get(row.slug) ?? null });
      }
    }
    const sideOf = (picks, rosterId) => ({
      picks: classify(picks),
      roster: rosters.get(rosterId) ?? [],
      bestball,
    });
    // Flags (0144) bite classic scoring too (bonus_mult / bonus_pts /
    // no_start-in-best-ball) — install synchronously right before the resolve,
    // the same isolation rule the drip branches follow.
    setLeagueFlags(matchup.league_id, flagRows);
    const r = resolveClassicMatchup(
      sideOf(homePicks, matchup.home_roster_id), sideOf(awayPicks, matchup.away_roster_id),
      matchup.week, { ...(gameMode.scoring ?? {}), ppr: gameMode.ppr }, slotDefs);
    for (const s of r.states) states.push({ game_window: s.window, home_score: s.home, away_score: s.away });
    slotRows = r.slots;
    homeTotal = r.home; awayTotal = r.away;
  } else if (homePicks && awayPicks) {
    // ── Both sides have a lineup (human, AI, or auto-backup): real H2H engine ──
    setLeagueScoring(scoringKnobs); // sync install — no await between here and the resolve
    setLeagueFlags(matchup.league_id, flagRows); // flags ride the same isolation rule
    const r = resolveLiveMatchup(homePicks.map(toLive), awayPicks.map(toLive), matchup.week,
      { homeBuffs: new Set(homeBuffs), awayBuffs: new Set(awayBuffs),
        homeComboQty: home.comboQty, awayComboQty: away.comboQty },
      { home: toExtras(homeTargeted), away: toExtras(awayTargeted) });
    for (const s of r.states) states.push({ game_window: s.window, home_score: s.home, away_score: s.away });
    slotRows = r.slots ?? [];
    homeTotal = r.home; awayTotal = r.away; coin = r.coin;
  } else {
    // ── 'empty' policy: a missed side scores 0; the other scores its lineup solo
    //    (each slot vs an empty opponent) so the present side isn't corrupted. ──
    const solo = (picks, side) => {
      const byWin = {}; let total = 0;
      for (const p of picks ?? []) {
        const r = resolveWindow({ player: player(p.slug), metricId: p.metric || 'rush' }, { player: EMPTY, metricId: 'none' }, matchup.week, '', {});
        byWin[p.win] = round((byWin[p.win] ?? 0) + r.youFinal); total += r.youFinal;
        slotRows.push({ win: p.win, side, slot: p.slot, slug: p.slug, metric: p.metric || null, score: round(r.youFinal) });
      }
      return { byWin, total: round(total) };
    };
    setLeagueScoring(scoringKnobs); // sync install — solo() resolves synchronously below
    setLeagueFlags(matchup.league_id, flagRows);
    const h = solo(homePicks, 'home'), a = solo(awayPicks, 'away');
    const wins = new Set([...Object.keys(h.byWin), ...Object.keys(a.byWin)]);
    for (const w of wins) states.push({ game_window: w, home_score: h.byWin[w] ?? 0, away_score: a.byWin[w] ?? 0 });
    if (!states.length) states.push({ game_window: 'ALL', home_score: 0, away_score: 0 });
    homeTotal = h.total; awayTotal = a.total;
  }

  // Zero-window probe (0199.3, widened same-day): a STARTED window scoring 0–0
  // while it has fielded picks is the failure signature — whether the cause is
  // a clobbered play store (the first 8/15 find) or something pick-shaped. Log
  // each side's first pick for the window with its metric and how many plays
  // the engine's store held at compute time — visible in the deploy tail.
  if (opts.startedWins?.size) {
    for (const s of states) {
      if (s.home_score || s.away_score || !opts.startedWins.has(s.game_window)) continue;
      const wp = (side, picks) => {
        const p = (picks ?? []).find((x) => x.win === s.game_window);
        return p ? `${side}=${p.slug}/${p.metric ?? 'null'}/${playsFor(matchup.week, p.slug)}p` : `${side}=—`;
      };
      const line = `${wp('H', homePicks)} ${wp('A', awayPicks)}`;
      if (!line.includes('/')) continue; // no picks in this window at all — quiet
      console.log(new Date().toISOString(), 'zero-window', matchup.id.slice(0, 8),
        'wk', matchup.week, s.game_window, line);
    }
  }

  // Per-slot detail → matchup_state.slot_scores (the card-table board's banks).
  // LEAK GUARD: enrolled sides only ever resolve with locked (revealed) picks, but
  // the AI / Sleeper-lineup fallback covers the whole week — so keep slot rows to
  // windows that have kicked off (opts.startedWins, from the tick's slate). A null
  // set means the slate has no kickoffs; then everything seals at lock_at anyway
  // (lock.js falls back the same way) and all rows are safe to write.
  // Classic 'wk' rows have no single window: they reveal once ANY window has
  // kicked off — the same moment lock.js seals them (dueWindows adds 'wk').
  const visSlots = opts.startedWins
    ? slotRows.filter((s) => (s.win === CLASSIC_WIN ? opts.startedWins.size > 0 : opts.startedWins.has(s.win)))
    : slotRows;
  const slotsFor = (win) => visSlots
    .filter((s) => s.win === win)
    .sort((x, y) => String(x.slot).localeCompare(String(y.slot)))
    .map(({ side, slot, slug, metric, score, hot, nuked }) => ({
      side, slot, slug, metric: metric ?? null, score: round(Number(score) || 0),
      ...(hot ? { hot: true } : {}), ...(nuked ? { nuked: true } : {}),
    }));

  const now = new Date().toISOString();
  await db().from('matchup_state').upsert(
    states.map((s) => ({ matchup_id: matchup.id, ...s, slot_scores: slotsFor(s.game_window), events_json: [], updated_at: now })),
    { onConflict: 'matchup_id,game_window' },
  );
  const patch = {};
  if (coin) { patch.home_coin = coin.home; patch.away_coin = coin.away; }
  if (matchup.status === 'final') { patch.home_final = round(homeTotal); patch.away_final = round(awayTotal); }
  if (Object.keys(patch).length) await db().from('matchup').update(patch).eq('id', matchup.id);

  // Bank each side's weekly drip-coin into its persistent wallet, once, when the
  // week settles. Idempotent (credit_wallet guards on an idem_key), so the repeated
  // resolves of a final matchup don't double-credit. Roster-keyed → AI teams bank too.
  //
  // PRACTICE weeks bank nothing: the preseason board weeks (101-103) are
  // throwaway, so three weeks of rehearsal can't fund real Week-1 power-ups. The
  // coin the engine computed is still written to the matchup row above — it's the
  // "what you'd have earned" readout — it just never reaches a wallet. Migration
  // 0110 enforces the same rule inside credit_wallet; skipping the call here
  // keeps the tick from making a round trip per side that can only no-op.
  if (matchup.status === 'final' && coin && !override && !isPracticeWeek(matchup.week)) {
    await creditWallet(matchup, matchup.home_roster_id, coin.home);
    await creditWallet(matchup, matchup.away_roster_id, coin.away);
  }
  return { home: round(homeTotal), away: round(awayTotal), coin };
}

/** Idempotently bank a side's weekly coin into its team wallet (service role). */
async function creditWallet(matchup, rosterId, delta) {
  if (delta == null) return;
  await db().rpc('credit_wallet', {
    p_league_id: matchup.league_id, p_roster_id: rosterId,
    p_matchup_id: matchup.id, p_week: matchup.week, p_delta: delta, p_reason: 'earn',
  });
}

const round = (n) => Math.round(n * 10) / 10;
