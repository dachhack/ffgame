// PUBLIC PODS — weekly maintenance for solo-joinable drop-in leagues (0089/0090)
// and their DFS-STYLE team building (0092).
//
// Pods have no Sleeper source, so the worker fills what the Sleeper sync
// normally provides: the week's SALARY BOARD (pod_salary — weekly projections
// priced into DFS salaries, one frozen snapshot per week), each AI seat's
// entry (a seeded auto-build from that board; no-show humans get the same at
// lock), and the week's matchup pairings (a seeded shuffle of the 6 seats →
// 3 head-to-heads). Humans build their own entry via save_pod_entry (0092).
// Everything downstream (lock → resolve → live board → coin) is unchanged.
//
// Deterministic by construction — every build seeds off (league_id, week,
// seat), so re-runs upsert identical rows and a preview matches the resolve.
import { readFileSync } from 'node:fs';
import { db } from './supabase.js';
import { config } from './config.js';
import { getWeekProjections } from './sleeper.js';
import { weekKickoffMs, buildSlate } from './poll/scoreboard.js';
import { REGULAR_SEASON } from './seasonType.js';
import { statsForSlug, hasStatsForSlug } from '../../packages/core/src/data/players.ts';
import { PROJ_2026, PROJ_2026_SID } from '../../packages/core/src/data/proj2026.ts';

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

// An entry mirrors the playtester's honest roster shape (also enforced
// server-side by save_pod_entry in 0092 — keep the two in sync).
const DEAL_COUNTS = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 };
export const SALARY_CAP = 50000;
const MIN_SALARY = 3000;

// Slugs whose projection was resolved via Sleeper id at pool time (the name
// join missed — display names drift between sources). Lets the slug-only draw
// weighting agree with pool admission.
const sidResolved = new Map(); // slug -> ppg

/** Deal value in projected PPR points-per-game. Prefers the baked 2026
 *  StatHead projection (proj2026.ts — includes rookies, prices offseason
 *  situation changes), joined by Sleeper id when available (exact) with the
 *  normName slug as the fallback join; vets outside the projection set fall
 *  back to 2025 actual production scaled to per-game. 0 = unknown. */
export function dealPpg(slug, pos, sid) {
  const bySid = sid != null ? PROJ_2026_SID.get(String(sid)) : undefined;
  if (bySid != null) {
    if (!PROJ_2026.has(slug)) sidResolved.set(slug, bySid);
    return bySid;
  }
  const proj = sidResolved.get(slug) ?? PROJ_2026.get(slug);
  if (proj != null) return proj;
  if (!hasStatsForSlug(slug)) return 0;
  const st = statsForSlug(slug, pos);
  return (st.ppr || 0) / Math.max(1, st.games || 14);
}

// Startable floor, in ppg (≈ the old 40-season-ppr bar over a 14-game season).
const MIN_DEAL_PPG = 3;

// ── Weekly projection sources (the salary board prices the WEEK, not the
// season). Per-player chain:
//   1. baked StatHead weekly file (server/data/statheadWeekly2026.json) —
//      matchup-adjusted + injury-aware; landed by the weekly bake session
//   2. Sleeper's live weekly endpoint — news-reactive, includes K + team DST
//   3. dealPpg (baked StatHead season → 2025 actuals)
let bakedWeekly = null; // parsed file | false (missing)
function bakedWeekFor(week) {
  if (bakedWeekly === null) {
    try { bakedWeekly = JSON.parse(readFileSync(new URL('../data/statheadWeekly2026.json', import.meta.url), 'utf8')); }
    catch { bakedWeekly = false; }
  }
  const rows = bakedWeekly && bakedWeekly.weeks && bakedWeekly.weeks[String(week)];
  if (!Array.isArray(rows) || !rows.length) return null;
  const bySid = new Map(), defByTeam = new Map(), kByTeam = new Map();
  for (const r of rows) {
    const ppg = Number(r.ppg);
    if (!Number.isFinite(ppg)) continue;
    if (r.pos === 'DEF' && r.team) defByTeam.set(r.team, ppg);
    else if (r.pos === 'K' && r.team) kByTeam.set(r.team, Math.max(kByTeam.get(r.team) ?? 0, ppg));
    if (r.sid) bySid.set(String(r.sid), ppg);
  }
  return { bySid, defByTeam, kByTeam, source: 'stathead-weekly' };
}

async function sleeperWeekFor(season, week, idx) {
  try {
    const d = await getWeekProjections(season, week);
    const bySid = new Map(), defByTeam = new Map(), kByTeam = new Map();
    for (const [key, v] of Object.entries(d ?? {})) {
      const pts = Number(v?.pts_ppr);
      if (!Number.isFinite(pts) || pts <= 0) continue;
      if (/^[A-Z]{2,3}$/.test(key)) { defByTeam.set(key, pts); continue; } // team DEF rows
      bySid.set(key, pts);
      const meta = idx.sleeper(key);
      if (meta?.pos === 'K' && meta.team) kByTeam.set(meta.team, Math.max(kByTeam.get(meta.team) ?? 0, pts));
    }
    return bySid.size ? { bySid, defByTeam, kByTeam, source: 'sleeper-weekly' } : null;
  } catch { return null; }
}

/** ppg → DFS salary (deterministic, $100 steps, $3k floor). ~26 ppg ≈ $10,400;
 *  a 9-man cap of $50k averages $5,555/slot — stars-and-scrubs tension. */
export function salaryOf(ppg) {
  return Math.max(MIN_SALARY, Math.round((ppg * 400) / 100) * 100);
}

/** PURE: the week's salary board — one row per pickable option. Skill players
 *  slate-gated + floored on season relevance OR weekly projection; K/DST as
 *  the engine's team-keyed synthetics, priced from weekly K/DEF projections
 *  when available. `weekly` may be null (season-projection pricing only). */
export function buildSalaryBoard(idx, slateTeams, weekly) {
  const rows = [];
  for (const p of idx.allSlugs()) {
    if (!p.slug || !['QB', 'RB', 'WR', 'TE'].includes(p.pos)) continue;
    if (!p.team || !slateTeams.has(p.team)) continue;
    const seasonPpg = dealPpg(p.slug, p.pos, p.sid);
    const weekPpg = weekly?.bySid.get(String(p.sid));
    if (seasonPpg < MIN_DEAL_PPG && (weekPpg ?? 0) < MIN_DEAL_PPG) continue;
    const ppg = weekPpg ?? seasonPpg;
    rows.push({ slug: p.slug, name: p.full, pos: p.pos, team: p.team, salary: salaryOf(ppg), proj: Math.round(ppg * 10) / 10 });
  }
  for (const t of slateTeams) {
    const kPpg = weekly?.kByTeam.get(t) ?? 7.5;
    const dPpg = weekly?.defByTeam.get(t) ?? 7;
    rows.push({ slug: `${t.toLowerCase()}-k`, name: `${t} Kicker`, pos: 'K', team: t, salary: salaryOf(kPpg), proj: Math.round(kPpg * 10) / 10 });
    rows.push({ slug: `${t.toLowerCase()}-dst`, name: `${t} D/ST`, pos: 'DEF', team: t, salary: salaryOf(dPpg), proj: Math.round(dPpg * 10) / 10 });
  }
  return rows;
}

/** PURE: seeded auto-build of a legal entry from the salary board — AI seats,
 *  and no-show humans at lock. Greedy by per-seat jittered value (same board,
 *  different builds), always reserving MIN_SALARY per unfilled slot so the
 *  entry can never bust the cap. Deterministic per (league, week, seat). */
export function aiSalaryEntry(leagueId, week, rosterId, board) {
  const rand = rng(`${leagueId}|w${week}|dfs${rosterId}`);
  const byPos = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  for (const r of board) byPos[r.pos]?.push(r);
  const pref = new Map(board.map((r) => [r.slug, r.proj * (0.8 + rand() * 0.4)]));
  const slots = Object.entries(DEAL_COUNTS).flatMap(([pos, n]) => Array(n).fill(pos));
  const squad = [];
  const taken = new Set();
  let budget = SALARY_CAP;
  for (let i = 0; i < slots.length; i++) {
    const pos = slots[i];
    const maxSpend = budget - (slots.length - i - 1) * MIN_SALARY;
    const pick = byPos[pos]
      .filter((r) => !taken.has(r.slug) && r.salary <= maxSpend)
      .sort((a, b) => (pref.get(b.slug) ?? 0) - (pref.get(a.slug) ?? 0))[0];
    if (!pick) continue; // board too thin at this price — resolver copes with a short lineup
    taken.add(pick.slug);
    budget -= pick.salary;
    squad.push({ slug: pick.slug, pos });
  }
  return squad;
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

/** Ensure every pod (season-long) and weekly showdown (0090) with at least one
 *  enrolled human has this week's salary board, AI entries, and paired
 *  matchups. Humans build their own entry (save_pod_entry); a human with no
 *  entry by lock gets the seeded auto-build so a no-show still has a game.
 *  Weekly leagues only run in their own contest_week, and are TOSSED (all
 *  seats unenrolled) two weeks after it — one week of crown-display, then
 *  gone. Idempotent (deterministic upserts; the board freezes once written
 *  so cap math never shifts under a part-built entry). */
export async function ensurePods(week, season, idx) {
  const { data: all } = await db().from('league')
    .select('id, name, kind, contest_week').in('kind', ['pod', 'weekly', 'dfs']).eq('season', season);
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
  const pods = (all ?? []).filter((l) => l.kind === 'pod' || l.kind === 'dfs' || l.contest_week === week);
  if (!pods?.length) return { pods: 0, dealt: 0, matchups: 0, tossed };

  // Slate: prefer the synced nfl_slate rows; fall back to a live ESPN build.
  let { data: slateRows } = await db().from('nfl_slate').select('home, away').eq('season', season).eq('week', week);
  if (!slateRows?.length) {
    try {
      const slate = await buildSlate(season, week, REGULAR_SEASON);
      slateRows = slate.map((g) => ({ home: g.home, away: g.away }));
    } catch { slateRows = []; }
  }
  const slateTeams = new Set(slateRows.flatMap((g) => [g.home, g.away]).filter(Boolean));
  if (!slateTeams.size) return { pods: pods.length, dealt: 0, matchups: 0, tossed, skipped: 'no slate' };

  // The week's salary board: build + freeze on first sight of the week, then
  // always read back the frozen rows (weekly projections drift; the board a
  // human is building against must not).
  let board;
  const { data: haveSal } = await db().from('pod_salary')
    .select('slug').eq('season', season).eq('week', week).limit(1);
  if (!haveSal?.length) {
    const weekly = bakedWeekFor(week) ?? await sleeperWeekFor(season, week, idx);
    board = buildSalaryBoard(idx, slateTeams, weekly);
    if (board.length) {
      await db().from('pod_salary').upsert(
        board.map((r) => ({ season, week, ...r })), { onConflict: 'season,week,slug' });
    }
  } else {
    const { data: rows } = await db().from('pod_salary')
      .select('slug, name, pos, team, salary, proj').eq('season', season).eq('week', week);
    board = rows ?? [];
  }
  if (!board.length) return { pods: pods.length, dealt: 0, matchups: 0, tossed, skipped: 'no board' };

  const lockMs = await weekKickoffMs(season, week, REGULAR_SEASON).catch(() => null);
  // Same 1h-before-kickoff lead as league matchups (config.lockLeadMs).
  const lockAt = lockMs ? new Date(lockMs - config.lockLeadMs).toISOString() : null;
  const lockPassed = lockMs != null && lockMs - config.lockLeadMs <= Date.now();

  let dealt = 0, made = 0;
  for (const pod of pods) {
    const { data: mems } = await db().from('league_membership')
      .select('sleeper_roster_id, enrolled, app_user_id, controller').eq('league_id', pod.id);
    const seats = (mems ?? []).map((m) => m.sleeper_roster_id);
    const hasHuman = (mems ?? []).some((m) => m.enrolled && m.app_user_id);
    if (!seats.length || !hasHuman) continue;

    // Entries: AI seats auto-build immediately; human seats build their own
    // via save_pod_entry, but an entry-less human gets the auto-build at lock.
    const { data: have } = await db().from('sleeper_lineup')
      .select('roster_id').eq('league_id', pod.id).eq('week', week);
    const haveSet = new Set((have ?? []).map((r) => r.roster_id));
    const need = (mems ?? []).filter((m) => {
      if (haveSet.has(m.sleeper_roster_id)) return false;
      const isAi = m.controller === 'ai' || !m.app_user_id;
      return isAi || lockPassed;
    });
    if (need.length) {
      const rows = need.map((m) => {
        const squad = aiSalaryEntry(pod.id, week, m.sleeper_roster_id, board);
        return {
          league_id: pod.id, week, roster_id: m.sleeper_roster_id,
          starters_json: squad.map((p, i) => ({ slot: i, sleeper_id: null, player_slug: p.slug, pos: p.pos })),
        };
      });
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
