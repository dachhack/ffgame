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
import { injectWeek, makePlayer, resolveLiveMatchup, resolveWindow, rowsToPbp, autoLineup, EMPTY } from './engine.js';
import { matchupPremium, premiumTier, hasPremiumContent, gateSide } from './premium.js';
import { slugMeta } from '../../src/data/slugMeta.ts';

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
  injectWeek(week, rowsToPbp(await weekPlayRows(week)));
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
async function enrolledPicks(matchup, membership, ctx) {
  if (!(membership?.enrolled && membership.app_user_id && matchup.status !== 'scheduled')) return null;
  const key = `${matchup.id}:${membership.app_user_id}`;
  if (ctx) {
    const ps = ctx.picks.get(key);
    if (ps && ps.length) return ps;
    return ctx.hasPicks.has(key) ? [] : null;
  }
  const { data } = await db().from('sealed_pick').select('game_window,roster_slot,player_slug,metric_id,locked')
    .eq('matchup_id', matchup.id).eq('app_user_id', membership.app_user_id).not('player_slug', 'is', null);
  if (!data || !data.length) return null;
  return data.filter((p) => p.locked).map((p) => ({ win: p.game_window, slot: p.roster_slot, slug: p.player_slug, metric: p.metric_id }));
}

/** A roster's real Sleeper starters (the unenrolled-opponent fallback / player pool). */
async function lineupSlugs(matchup, rosterId, ctx) {
  if (ctx) return ctx.lineups.get(`${matchup.league_id}:${rosterId}`) ?? [];
  const { data } = await db().from('sleeper_lineup').select('starters_json')
    .eq('league_id', matchup.league_id).eq('week', matchup.week).eq('roster_id', rosterId).maybeSingle();
  return ((data?.starters_json) ?? []).map((s) => s.player_slug).filter(Boolean);
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
async function humanBuffs(matchupId, appUserId, ctx) {
  const b = (await loadout(matchupId, appUserId, ctx)).buffs;
  return Array.isArray(b) ? b : [];
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
  const [mem, lg, lu, ap, pk] = await Promise.all([
    db().from('league_membership').select('league_id,sleeper_roster_id,app_user_id,enrolled,controller').in('league_id', leagueIds),
    db().from('league').select('id,lineup_policy').in('id', leagueIds),
    db().from('sleeper_lineup').select('league_id,roster_id,starters_json').in('league_id', leagueIds).eq('week', week),
    db().from('applied_state').select('matchup_id,app_user_id,payload_json').in('matchup_id', matchupIds),
    db().from('sealed_pick').select('matchup_id,app_user_id,game_window,roster_slot,player_slug,metric_id,locked').in('matchup_id', matchupIds).not('player_slug', 'is', null),
  ]);
  const members = new Map();   // leagueId -> Map(roster -> member)
  for (const m of mem.data ?? []) {
    if (!members.has(m.league_id)) members.set(m.league_id, new Map());
    members.get(m.league_id).set(m.sleeper_roster_id, m);
  }
  const policy = new Map((lg.data ?? []).map((r) => [r.id, r.lineup_policy ?? 'best_lineup']));
  const lineups = new Map();   // `${leagueId}:${roster}` -> slugs[]
  for (const r of lu.data ?? []) lineups.set(`${r.league_id}:${r.roster_id}`, (r.starters_json ?? []).map((s) => s.player_slug).filter(Boolean));
  const applied = new Map();   // `${matchupId}:${appUser}` -> payload
  for (const r of ap.data ?? []) applied.set(`${r.matchup_id}:${r.app_user_id}`, r.payload_json ?? {});
  const picks = new Map();     // `${matchupId}:${appUser}` -> [{win,slot,slug,metric}] (LOCKED rows)
  const hasPicks = new Set();  // `${matchupId}:${appUser}` — has ANY pick rows, locked or not
  for (const p of pk.data ?? []) {
    const k = `${p.matchup_id}:${p.app_user_id}`;
    hasPicks.add(k);
    if (!p.locked) continue; // unsealed window — not revealed, not scored yet
    if (!picks.has(k)) picks.set(k, []);
    picks.get(k).push({ win: p.game_window, slot: p.roster_slot, slug: p.player_slug, metric: p.metric_id });
  }
  return { members, policy, lineups, applied, picks, hasPicks };
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
      picks: autoLineup(await lineupSlugs(matchup, rosterId, ctx), matchup.week, owned, extra),
      buffs: Array.isArray(load.buffs) ? load.buffs : [],
    };
  };
  const sideLineup = async (rosterId) => {
    const mem = byRoster.get(rosterId);
    if (mem?.controller === 'ai') return aiSide(rosterId, mem);
    const picks = await enrolledPicks(matchup, mem, ctx);
    if (picks) return { picks, buffs: await humanBuffs(matchup.id, mem.app_user_id, ctx) };
    if (!mem?.enrolled || !mem?.app_user_id) return aiSide(rosterId, mem);
    if (policy === 'empty') return { picks: null, buffs: [] };
    return aiSide(rosterId, mem);
  };
  const home = override ? { picks: override.home, buffs: [] } : await sideLineup(matchup.home_roster_id);
  const away = override ? { picks: override.away, buffs: [] } : await sideLineup(matchup.away_roster_id);
  let homePicks = home.picks, awayPicks = away.picks;
  let homeBuffs = home.buffs, awayBuffs = away.buffs;

  // Premium enforcement (docs/premium-model.md): a NON-premium matchup can't field premium
  // positions (K/DST/IDP), premium-unlock metrics, or premium power-ups. Stripped here at the
  // authoritative resolve regardless of how the rows were written. The cheap pre-check skips
  // the matchup_premium() RPC unless a side actually holds premium content.
  {
    const tier = await premiumTier();
    const posOf = (slug) => slugMeta(slug).pos;
    if (hasPremiumContent(homePicks, homeBuffs, tier, posOf) || hasPremiumContent(awayPicks, awayBuffs, tier, posOf)) {
      if (!(await matchupPremium(matchup.id))) {
        if (homePicks) { const g = gateSide(homePicks, homeBuffs, tier, posOf); homePicks = g.picks; homeBuffs = g.buffs; }
        if (awayPicks) { const g = gateSide(awayPicks, awayBuffs, tier, posOf); awayPicks = g.picks; awayBuffs = g.buffs; }
      }
    }
  }

  const states = []; // { game_window, home_score, away_score }
  let homeTotal = 0, awayTotal = 0;
  let coin = null; // weekly drip-coin per side (only the real-engine H2H path earns it)
  const toLive = (p) => ({ win: p.win, slot: p.slot, player: player(p.slug), metricId: p.metric || 'rush' });

  if (homePicks && awayPicks) {
    // ── Both sides have a lineup (human, AI, or auto-backup): real H2H engine ──
    const r = resolveLiveMatchup(homePicks.map(toLive), awayPicks.map(toLive), matchup.week,
      { homeBuffs: new Set(homeBuffs), awayBuffs: new Set(awayBuffs) });
    for (const s of r.states) states.push({ game_window: s.window, home_score: s.home, away_score: s.away });
    homeTotal = r.home; awayTotal = r.away; coin = r.coin;
  } else {
    // ── 'empty' policy: a missed side scores 0; the other scores its lineup solo
    //    (each slot vs an empty opponent) so the present side isn't corrupted. ──
    const solo = (picks) => {
      const byWin = {}; let total = 0;
      for (const p of picks ?? []) {
        const r = resolveWindow({ player: player(p.slug), metricId: p.metric || 'rush' }, { player: EMPTY, metricId: 'none' }, matchup.week, '', {});
        byWin[p.win] = round((byWin[p.win] ?? 0) + r.youFinal); total += r.youFinal;
      }
      return { byWin, total: round(total) };
    };
    const h = solo(homePicks), a = solo(awayPicks);
    const wins = new Set([...Object.keys(h.byWin), ...Object.keys(a.byWin)]);
    for (const w of wins) states.push({ game_window: w, home_score: h.byWin[w] ?? 0, away_score: a.byWin[w] ?? 0 });
    if (!states.length) states.push({ game_window: 'ALL', home_score: 0, away_score: 0 });
    homeTotal = h.total; awayTotal = a.total;
  }

  const now = new Date().toISOString();
  await db().from('matchup_state').upsert(
    states.map((s) => ({ matchup_id: matchup.id, ...s, events_json: [], updated_at: now })),
    { onConflict: 'matchup_id,game_window' },
  );
  const patch = {};
  if (coin) { patch.home_coin = coin.home; patch.away_coin = coin.away; }
  if (matchup.status === 'final') { patch.home_final = round(homeTotal); patch.away_final = round(awayTotal); }
  if (Object.keys(patch).length) await db().from('matchup').update(patch).eq('id', matchup.id);

  // Bank each side's weekly drip-coin into its persistent wallet, once, when the
  // week settles. Idempotent (credit_wallet guards on an idem_key), so the repeated
  // resolves of a final matchup don't double-credit. Roster-keyed → AI teams bank too.
  if (matchup.status === 'final' && coin && !override) {
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
