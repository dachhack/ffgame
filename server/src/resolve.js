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
  const { data } = await db().from('live_play').select('player_slug,c,t,pid,k,y,td,ca,tg,"to"').eq('week', week);
  return data ?? [];
}

/** Enrolled side's revealed picks: [{ win, slot, slug, metric }] — or null if the
 *  manager isn't enrolled / picks aren't locked yet (caller uses the fallback). */
async function enrolledPicks(matchup, membership) {
  if (!(membership?.enrolled && membership.app_user_id && matchup.status !== 'scheduled')) return null;
  const { data } = await db().from('sealed_pick').select('game_window,roster_slot,player_slug,metric_id')
    .eq('matchup_id', matchup.id).eq('app_user_id', membership.app_user_id).eq('locked', true);
  return data && data.length ? data.map((p) => ({ win: p.game_window, slot: p.roster_slot, slug: p.player_slug, metric: p.metric_id })) : null;
}

/** A roster's real Sleeper starters (the unenrolled-opponent fallback / player pool). */
async function lineupSlugs(matchup, rosterId) {
  const { data } = await db().from('sleeper_lineup').select('starters_json')
    .eq('league_id', matchup.league_id).eq('week', matchup.week).eq('roster_id', rosterId).maybeSingle();
  return ((data?.starters_json) ?? []).map((s) => s.player_slug).filter(Boolean);
}

/** The league's missed-pick policy: 'best_lineup' (default) | 'ai' | 'empty'. */
async function lineupPolicy(leagueId) {
  const { data } = await db().from('league').select('lineup_policy').eq('id', leagueId).maybeSingle();
  return data?.lineup_policy ?? 'best_lineup';
}

/** Resolve one matchup → write matchup_state (per game_window) + finals when final.
 *  `override` (sim only): { home, away } pick arrays [{win,slot,slug,metric}] that
 *  bypass enrollment/sealed-pick gathering so both sides resolve with full metrics. */
export async function resolveMatchup(matchup, playerIndex, override) {
  const rows = await weekPlayRows(matchup.week);
  const bySlug = rowsToPbp(rows);
  injectWeek(matchup.week, bySlug);
  const meta = (slug) => playerIndex?.metaForSlug(slug) ?? null;
  const player = (slug) => { const m = meta(slug); return makePlayer(slug, m?.pos, m?.team, m?.full); };

  const { data: members } = await db().from('league_membership')
    .select('sleeper_roster_id,app_user_id,enrolled,controller').eq('league_id', matchup.league_id)
    .in('sleeper_roster_id', [matchup.home_roster_id, matchup.away_roster_id]);
  const byRoster = new Map((members ?? []).map((m) => [m.sleeper_roster_id, m]));
  const policy = await lineupPolicy(matchup.league_id);

  // A side's effective lineup: explicit AI → auto-lineup; a human's sealed picks if
  // set; an empty seat (no manager) → auto-lineup; an enrolled manager who missed →
  // the league policy (best_lineup/ai → auto-lineup; empty → null, scores 0).
  const sidePicks = async (rosterId) => {
    const mem = byRoster.get(rosterId);
    if (mem?.controller === 'ai') return autoLineup(await lineupSlugs(matchup, rosterId));
    const picks = await enrolledPicks(matchup, mem);
    if (picks) return picks;
    if (!mem?.enrolled || !mem?.app_user_id) return autoLineup(await lineupSlugs(matchup, rosterId));
    if (policy === 'empty') return null;
    return autoLineup(await lineupSlugs(matchup, rosterId));
  };
  const homePicks = override ? override.home : await sidePicks(matchup.home_roster_id);
  const awayPicks = override ? override.away : await sidePicks(matchup.away_roster_id);

  const states = []; // { game_window, home_score, away_score }
  let homeTotal = 0, awayTotal = 0;
  let coin = null; // weekly drip-coin per side (only the real-engine H2H path earns it)
  const toLive = (p) => ({ win: p.win, slot: p.slot, player: player(p.slug), metricId: p.metric || 'rush' });

  if (homePicks && awayPicks) {
    // ── Both sides have a lineup (human, AI, or auto-backup): real H2H engine ──
    const r = resolveLiveMatchup(homePicks.map(toLive), awayPicks.map(toLive), matchup.week);
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
  return { home: round(homeTotal), away: round(awayTotal), coin };
}

const round = (n) => Math.round(n * 10) / 10;
