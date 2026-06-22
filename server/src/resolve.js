// Server-authoritative resolution. Gathers both sides' inputs and writes
// matchup_state for Realtime push.
//
// INPUTS per matchup:
//   • enrolled side  → its revealed sealed_pick rows (player_slug + metric_id per
//                      window/slot). Only readable here post-lock; the worker uses
//                      the service role so it sees them, but it must NOT resolve a
//                      window before its lock (enforce in the scheduler).
//   • unenrolled side → the opponent's real Sleeper starters (sleeper_lineup) — no
//                      sealed picks, no hidden metrics.
//   • plays          → live_play rows for the week, by player_slug.
//
// SCORING SEAM: this scaffold computes base fantasy points per side (PPR + K +
// DST — identical formula to scripts/pbp/genRealPbp.mjs). The full game — hidden
// metrics and their effects (nuke/erase/streak/…) and the drip economy — is the
// shared engine (src/engine/{sim,matchup}.ts). Extract that engine into a package
// both client and worker import, then replace `baseScore` with buildMatchup() so
// the authoritative resolution matches the client's optimistic display exactly.
import { db } from './supabase.js';

/** PPR + K + DST points from a player's RealPlay rows. */
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

/** Plays-by-slug for a week (one query, indexed in memory). */
async function playsForWeek(week) {
  const { data } = await db().from('live_play').select('player_slug,c,t,pid,k,y,td,ca,tg').eq('week', week);
  const by = new Map();
  for (const r of data ?? []) { if (!by.has(r.player_slug)) by.set(r.player_slug, []); by.get(r.player_slug).push(r); }
  return by;
}

/** Each side's slugs for a matchup: revealed sealed picks if enrolled+locked,
 *  else the roster's real Sleeper starters. */
async function sideSlugs(matchup, rosterId, membership, plays) {
  if (membership?.enrolled && membership.app_user_id && matchup.status !== 'scheduled') {
    const { data } = await db().from('sealed_pick').select('window,roster_slot,player_slug,metric_id')
      .eq('matchup_id', matchup.id).eq('app_user_id', membership.app_user_id).eq('locked', true);
    if (data && data.length) return data.map((p) => ({ slug: p.player_slug, window: p.window, metric: p.metric_id }));
  }
  const { data: lu } = await db().from('sleeper_lineup').select('starters_json')
    .eq('league_id', matchup.league_id).eq('week', matchup.week).eq('roster_id', rosterId).maybeSingle();
  return ((lu?.starters_json) ?? []).map((s) => ({ slug: s.player_slug, window: null, metric: null }));
}

/** Resolve one matchup → write matchup_state. Returns { home, away }. */
export async function resolveMatchup(matchup) {
  const plays = await playsForWeek(matchup.week);
  const { data: members } = await db().from('league_membership')
    .select('sleeper_roster_id,app_user_id,enrolled').eq('league_id', matchup.league_id)
    .in('sleeper_roster_id', [matchup.home_roster_id, matchup.away_roster_id]);
  const byRoster = new Map((members ?? []).map((m) => [m.sleeper_roster_id, m]));

  const home = await sideSlugs(matchup, matchup.home_roster_id, byRoster.get(matchup.home_roster_id), plays);
  const away = await sideSlugs(matchup, matchup.away_roster_id, byRoster.get(matchup.away_roster_id), plays);
  const sum = (side) => side.reduce((t, s) => t + baseScore(plays.get(s.slug) ?? []), 0);
  const homeScore = Math.round(sum(home) * 10) / 10;
  const awayScore = Math.round(sum(away) * 10) / 10;

  // SEAM: write one aggregate row for now. With the shared engine this becomes
  // per-window home/away scores + the resolved event feed (events_json).
  await db().from('matchup_state').upsert({
    matchup_id: matchup.id, window: 'ALL', home_score: homeScore, away_score: awayScore,
    events_json: [], updated_at: new Date().toISOString(),
  }, { onConflict: 'matchup_id,window' });

  const final = matchup.status === 'final';
  if (final) await db().from('matchup').update({ home_final: homeScore, away_final: awayScore }).eq('id', matchup.id);
  return { home: homeScore, away: awayScore };
}
