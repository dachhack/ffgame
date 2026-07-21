// PUBLIC PODS — weekly maintenance for solo-joinable drop-in leagues (0089).
//
// Pods have no Sleeper source, so the worker fills the two things the Sleeper
// sync normally provides: each seat's weekly roster (DEALT — a deterministic,
// projection-weighted draw from players actually on this week's slate) and the
// week's matchup pairings (a seeded shuffle of the 6 seats → 3 head-to-heads).
// Everything downstream (lock → resolve → live board → coin) is unchanged: AI
// seats are app_user-less, so the resolver auto-lineups them exactly like the
// fake test league's.
//
// Deterministic by construction — every draw seeds off (league_id, week, seat),
// so re-runs upsert identical rows and a preview matches the resolve.
import { db } from './supabase.js';
import { config } from './config.js';
import { weekKickoffMs, buildSlate } from './poll/scoreboard.js';
import { statsForSlug, hasStatsForSlug } from '../../src/data/players.ts';

// ── Seeded RNG (mulberry32 over a string hash — mirrors the playtester) ──────
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seedStr) {
  let a = hashStr(seedStr);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A dealt starting squad mirrors the playtester's honest roster shape.
const DEAL_COUNTS = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 };

/** Projection-weighted draw without replacement (managers start studs). */
function weightedDraw(rand, cand, weightOf) {
  let total = 0;
  const w = cand.map((c) => { const v = Math.max(0.5, weightOf(c)); total += v; return v; });
  let r = rand() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return w.length - 1;
}

/** PURE: deal rosters for every seat of one pod-week. `pool` is
 *  { QB: slug[], RB: [], ... } of players whose teams play this week.
 *  Returns Map(rosterId → slug[]). Players are unique within the pod. */
export function dealPodRosters(leagueId, week, seats, pool) {
  const taken = new Set();
  const out = new Map();
  for (const rosterId of [...seats].sort((a, b) => a - b)) {
    const rand = rng(`${leagueId}|w${week}|seat${rosterId}`);
    const squad = [];
    for (const [pos, n] of Object.entries(DEAL_COUNTS)) {
      const cand = (pool[pos] ?? []).filter((s) => !taken.has(s));
      const weighted = pos !== 'K' && pos !== 'DEF';
      for (let i = 0; i < n && cand.length; i++) {
        const idx = weighted ? weightedDraw(rand, cand, (s) => statsForSlug(s, pos).ppr || 0.5) : Math.floor(rand() * cand.length);
        const slug = cand.splice(idx, 1)[0];
        taken.add(slug);
        squad.push({ slug, pos });
      }
    }
    out.set(rosterId, squad);
  }
  return out;
}

/** PURE: seeded pairing of a pod's seats into head-to-heads (odd seat count
 *  would leave the last seat unpaired — pods are built with 6, so 3 games). */
export function pairPodSeats(leagueId, week, seats) {
  const rand = rng(`${leagueId}|w${week}|pairs`);
  const s = [...seats].sort((a, b) => a - b);
  for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
  const pairs = [];
  for (let i = 0; i + 1 < s.length; i += 2) pairs.push([s[i], s[i + 1]]);
  return pairs;
}

/** Build the position pool: skill players from the index, slate-gated to teams
 *  playing this week and floored on season relevance so deals are startable;
 *  K/DEF as the engine's team-keyed `<team>-k` / `<team>-dst` slugs (kdst.ts). */
export function podPool(idx, slateTeams) {
  const pool = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  for (const p of idx.allSlugs()) {
    if (!p.slug || !p.pos || !pool[p.pos] || p.pos === 'K' || p.pos === 'DEF') continue;
    if (!p.team || !slateTeams.has(p.team)) continue;
    // Skill floor: must have a REAL baked stat row (statsForSlug falls back to a
    // positional baseline for unknowns, which would wave everyone through) and
    // enough season ppr to be ~startable.
    if (!hasStatsForSlug(p.slug) || (statsForSlug(p.slug, p.pos).ppr || 0) < 40) continue;
    pool[p.pos].push(p.slug);
  }
  for (const t of slateTeams) { pool.K.push(`${t.toLowerCase()}-k`); pool.DEF.push(`${t.toLowerCase()}-dst`); }
  return pool;
}

/** Ensure every pod (season-long) and weekly showdown (0090) with at least one
 *  enrolled human has dealt rosters and paired matchups for `week`. Weekly
 *  leagues only deal in their own contest_week, and are TOSSED (all seats
 *  unenrolled) two weeks after it — one week of crown-display, then gone.
 *  Idempotent (deterministic upserts). */
export async function ensurePods(week, season, idx) {
  const { data: all } = await db().from('league')
    .select('id, name, kind, contest_week').in('kind', ['pod', 'weekly']).eq('season', season);
  // Toss expired showdowns: their members' home screens drop the card once
  // every seat is unenrolled. League + matchup rows stay as history.
  let tossed = 0;
  const expired = (all ?? []).filter((l) => l.kind === 'weekly' && l.contest_week != null && l.contest_week <= week - 2);
  if (expired.length) {
    const { data: gone } = await db().from('league_membership')
      .update({ enrolled: false })
      .in('league_id', expired.map((l) => l.id)).eq('enrolled', true).select('id');
    tossed = gone?.length ?? 0;
  }
  const pods = (all ?? []).filter((l) => l.kind === 'pod' || l.contest_week === week);
  if (!pods?.length) return { pods: 0, dealt: 0, matchups: 0, tossed };

  // Slate: prefer the synced nfl_slate rows; fall back to a live ESPN build.
  let { data: slateRows } = await db().from('nfl_slate').select('home, away').eq('season', season).eq('week', week);
  if (!slateRows?.length) {
    try {
      const slate = await buildSlate(season, week, config.seasonType);
      slateRows = slate.map((g) => ({ home: g.home, away: g.away }));
    } catch { slateRows = []; }
  }
  const slateTeams = new Set(slateRows.flatMap((g) => [g.home, g.away]).filter(Boolean));
  if (!slateTeams.size) return { pods: pods.length, dealt: 0, matchups: 0, tossed, skipped: 'no slate' };

  const pool = podPool(idx, slateTeams);
  const lockMs = await weekKickoffMs(season, week, config.seasonType).catch(() => null);
  const lockAt = lockMs ? new Date(lockMs).toISOString() : null;

  let dealt = 0, made = 0;
  for (const pod of pods) {
    const { data: mems } = await db().from('league_membership')
      .select('sleeper_roster_id, enrolled, app_user_id').eq('league_id', pod.id);
    const seats = (mems ?? []).map((m) => m.sleeper_roster_id);
    const hasHuman = (mems ?? []).some((m) => m.enrolled && m.app_user_id);
    if (!seats.length || !hasHuman) continue;

    // Deal once per (pod, week): skip if lineups already exist.
    const { data: existing } = await db().from('sleeper_lineup')
      .select('roster_id').eq('league_id', pod.id).eq('week', week).limit(1);
    if (!existing?.length) {
      const squads = dealPodRosters(pod.id, week, seats, pool);
      const rows = [...squads.entries()].map(([rosterId, squad]) => ({
        league_id: pod.id, week, roster_id: rosterId,
        starters_json: squad.map((p, i) => ({ slot: i, sleeper_id: null, player_slug: p.slug, pos: p.pos })),
      }));
      await db().from('sleeper_lineup').upsert(rows, { onConflict: 'league_id,week,roster_id' });
      dealt += rows.length;
    }

    const { data: haveM } = await db().from('matchup')
      .select('id').eq('league_id', pod.id).eq('week', week).limit(1);
    if (!haveM?.length) {
      const pairs = pairPodSeats(pod.id, week, seats);
      const rows = pairs.map(([home, away]) => ({
        league_id: pod.id, week, sleeper_matchup_id: null,
        home_roster_id: home, away_roster_id: away, status: 'scheduled', lock_at: lockAt,
      }));
      if (rows.length) { await db().from('matchup').upsert(rows, { onConflict: 'league_id,week,home_roster_id,away_roster_id' }); made += rows.length; }
    }
  }
  return { pods: pods.length, dealt, matchups: made, tossed };
}
