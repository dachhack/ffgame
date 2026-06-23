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
// Still simplified vs the client's buildMatchup: no best-ball backups, coin
// economy, or cross-window Field-General multiplier yet — those live in
// matchup.ts and can be layered on once the pilot needs them.
import { db } from './supabase.js';
import { injectWeek, makePlayer, resolveWindow, rowsToPbp, EMPTY } from './engine.js';

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

/** Resolve one matchup → write matchup_state (per game_window) + finals when final. */
export async function resolveMatchup(matchup, playerIndex) {
  const rows = await weekPlayRows(matchup.week);
  const bySlug = rowsToPbp(rows);
  injectWeek(matchup.week, bySlug);
  const playsOf = (slug) => bySlug[slug] ?? [];
  const meta = (slug) => playerIndex?.metaForSlug(slug) ?? null;
  const player = (slug) => { const m = meta(slug); return makePlayer(slug, m?.pos, m?.team, m?.full); };

  const { data: members } = await db().from('league_membership')
    .select('sleeper_roster_id,app_user_id,enrolled').eq('league_id', matchup.league_id)
    .in('sleeper_roster_id', [matchup.home_roster_id, matchup.away_roster_id]);
  const byRoster = new Map((members ?? []).map((m) => [m.sleeper_roster_id, m]));

  const homePicks = await enrolledPicks(matchup, byRoster.get(matchup.home_roster_id));
  const awayPicks = await enrolledPicks(matchup, byRoster.get(matchup.away_roster_id));

  const states = []; // { game_window, home_score, away_score }
  let homeTotal = 0, awayTotal = 0;

  if (homePicks && awayPicks) {
    // ── Live H2H: real engine, paired by (window, slot) ──
    const key = (p) => `${p.win}|${p.slot}`;
    const awayBy = new Map(awayPicks.map((p) => [key(p), p]));
    const win = {}; // game_window -> {home, away}
    const bump = (w, side, v) => { (win[w] ||= { home: 0, away: 0 })[side] += v; };
    for (const hp of homePicks) {
      const ap = awayBy.get(key(hp));
      const you = { player: player(hp.slug), metricId: hp.metric || 'rush' };
      const them = ap ? { player: player(ap.slug), metricId: ap.metric || 'rush' } : { player: EMPTY, metricId: '' };
      const r = resolveWindow(you, them, matchup.week, key(hp));
      bump(hp.win, 'home', r.youFinal); homeTotal += r.youFinal;
      if (ap) { bump(hp.win, 'away', r.theirFinal); awayTotal += r.theirFinal; awayBy.delete(key(hp)); }
    }
    // Away picks with no home opponent in that slot → unopposed for away.
    for (const ap of awayBy.values()) {
      const r = resolveWindow({ player: player(ap.slug), metricId: ap.metric || 'rush' }, { player: EMPTY, metricId: '' }, matchup.week, key(ap));
      bump(ap.win, 'away', r.youFinal); awayTotal += r.youFinal;
    }
    for (const [w, s] of Object.entries(win)) states.push({ game_window: w, home_score: round(s.home), away_score: round(s.away) });
  } else {
    // ── Fallback: base points off whichever side(s) aren't enrolled picks ──
    const homeSlugs = homePicks ? homePicks.map((p) => p.slug) : await lineupSlugs(matchup, matchup.home_roster_id);
    const awaySlugs = awayPicks ? awayPicks.map((p) => p.slug) : await lineupSlugs(matchup, matchup.away_roster_id);
    homeTotal = round(homeSlugs.reduce((t, s) => t + baseScore(playsOf(s)), 0));
    awayTotal = round(awaySlugs.reduce((t, s) => t + baseScore(playsOf(s)), 0));
    states.push({ game_window: 'ALL', home_score: homeTotal, away_score: awayTotal });
  }

  const now = new Date().toISOString();
  await db().from('matchup_state').upsert(
    states.map((s) => ({ matchup_id: matchup.id, ...s, events_json: [], updated_at: now })),
    { onConflict: 'matchup_id,game_window' },
  );
  if (matchup.status === 'final') {
    await db().from('matchup').update({ home_final: round(homeTotal), away_final: round(awayTotal) }).eq('id', matchup.id);
  }
  return { home: round(homeTotal), away: round(awayTotal) };
}

const round = (n) => Math.round(n * 10) / 10;
