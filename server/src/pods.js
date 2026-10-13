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
import { normTeam, TeamMap } from '../../packages/core/src/data/teamCodes.ts';
import { statsForSlug, hasStatsForSlug } from '../../packages/core/src/data/players.ts';
import { PROJ_2026, PROJ_2026_SID } from '../../packages/core/src/data/proj2026.ts';
import { dfsBullseyeConfigOf, dfsCard, aimBuild, DFS_SLOT_NAMES, dfsSlotPos } from '../../packages/core/src/engine/dfsBullseye.ts';
import { contestConfigOf, contestCard, contestAutoBuild, noShowBuilds, contestPlayoffs, contestPlaysFor, contestPlayCap, aiContestPlays, contestCoinRules } from '../../packages/core/src/engine/contest.ts';
import { leagueWeekProj } from '../../packages/core/src/engine/contestBuilder.ts';
import { leagueCatalogOf } from '../../packages/core/src/engine/projScoring.ts';
import { priceBoard } from '../../packages/core/src/engine/salaryPricing.ts';
import { ruledOutSlugs } from './injuries.js';

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
  const bySid = new Map(), defByTeam = new TeamMap(), kByTeam = new TeamMap(); // team maps normalise (v0.707.0)
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
    const bySid = new Map(), defByTeam = new TeamMap(), kByTeam = new TeamMap(); // team maps normalise (v0.707.0)
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
/** The pre-0.666 flat rate, $400 a projected point. Kept for the probes
 *  that pin the old boards' numbers; a board is priced by priceBoard now. */
export function salaryOf(ppg) {
  return Math.max(MIN_SALARY, Math.round((ppg * 400) / 100) * 100);
}

/** PURE: the week's salary board — one row per pickable option. Skill players
 *  slate-gated + floored on season relevance OR weekly projection; K/DST as
 *  the engine's team-keyed synthetics, priced from weekly K/DEF projections
 *  when available. `weekly` may be null (season-projection pricing only). */
export function buildSalaryBoard(idx, slateTeams, weekly, extras = new Set(), roleNames = new Map()) {
  const rows = [];
  // THE EXTRA POSITIONS (0466): a contest league's admin-unlocked spots (FB,
  // the IDP three, HC, P — positions_extra) put those players on the board.
  // No weekly projection prices them, so they sit at the floor ($3,000, proj
  // 0 — a flyer); the season's production prices anyone it knows. IDP only
  // with a stat line on file, or the board would be every backup linebacker.
  const skill = new Set(['QB', 'RB', 'WR', 'TE']);
  const more = new Set([...extras].filter((p) => ['FB', 'DL', 'LB', 'DB'].includes(p)));
  // THE RAMS (v0.707.0, a member: "Stafford is not a QB option in Bullseye or here but is not on bye"): the index
  // says LAR where the slate says LA (#1095 again), so every Rams skill player failed this check and no board ever
  // carried one. Matched normalised now, and the row wears the SLATE's code — the kickoff locks and the slate map
  // the screens read are keyed by it.
  const codeOf = new Map([...slateTeams].map((t) => [normTeam(String(t)), String(t).toUpperCase()]));
  for (const p of idx.allSlugs()) {
    if (!p.slug || !(skill.has(p.pos) || more.has(p.pos))) continue;
    const team = p.team ? codeOf.get(normTeam(String(p.team))) : null;
    if (!team) continue;
    const seasonPpg = dealPpg(p.slug, p.pos, p.sid);
    const weekPpg = weekly?.bySid.get(String(p.sid));
    if (skill.has(p.pos)) {
      if (seasonPpg < MIN_DEAL_PPG && (weekPpg ?? 0) < MIN_DEAL_PPG) continue;
    } else if (['DL', 'LB', 'DB'].includes(p.pos) && !hasStatsForSlug(p.slug)) continue;
    const ppg = weekPpg ?? seasonPpg;
    rows.push({ slug: p.slug, name: p.full, pos: p.pos, team, salary: salaryOf(ppg), proj: Math.round(ppg * 10) / 10, exp: p.exp ?? null });
  }
  for (const t of slateTeams) {
    const kPpg = weekly?.kByTeam.get(t) ?? 7.5;
    const dPpg = weekly?.defByTeam.get(t) ?? 7;
    rows.push({ slug: `${t.toLowerCase()}-k`, name: `${t} Kicker`, pos: 'K', team: t, salary: salaryOf(kPpg), proj: Math.round(kPpg * 10) / 10, exp: null });
    rows.push({ slug: `${t.toLowerCase()}-dst`, name: `${t} D/ST`, pos: 'DEF', team: t, salary: salaryOf(dPpg), proj: Math.round(dPpg * 10) / 10, exp: null });
    // The classic engine's team units (0171): the head coach and the punter.
    // The coach carries his NAME when the scan (0468) knows it — the unit
    // is still `jax-hc`, the number still the team's.
    if (extras.has('HC')) rows.push({ slug: `${t.toLowerCase()}-hc`, name: roleNames.get(`${t.toLowerCase()}-hc`) ?? `${t} Head Coach`, pos: 'HC', team: t, salary: salaryOf(0), proj: 0, exp: null });
    if (extras.has('P')) rows.push({ slug: `${t.toLowerCase()}-p`, name: `${t} Punter`, pos: 'P', team: t, salary: salaryOf(0), proj: 0, exp: null });
  }
  // SCARCITY PRICING (v0.666.0, engine/salaryPricing.ts): value over the
  // position's replacement, the rate calibrated so the all-studs nine lands
  // just over the budget. The projection the price was set from rides along
  // (priced_proj) and is frozen with it; `proj` is refreshed through the week.
  const { priced } = priceBoard(rows);
  return priced.map(({ row, salary }) => ({ ...row, salary, priced_proj: row.proj }));
}

/** The scanned unit names (0468): `jax-hc` → "Liam Coen". Empty when the
 *  table is missing or unreadable; the board then says "JAX Head Coach" and
 *  the next scan's `sync_team_role_names` renames the stored row. */
async function teamRoleNames() {
  const { data } = await db().from('team_role').select('slug, name');
  return new Map((data ?? []).map((r) => [r.slug, r.name]));
}

/** The positions some contest league this season has unlocked (positions_extra). */
async function contestExtraPositions(season) {
  const { data } = await db().from('league').select('settings_json').in('kind', ['dfs', 'bullseye']).eq('season', season);
  const out = new Set();
  for (const l of data ?? []) for (const p of l.settings_json?.positions_extra ?? []) if (typeof p === 'string') out.add(p.toUpperCase());
  if (out.has('IDP')) { out.add('DL'); out.add('LB'); out.add('DB'); }
  return out;
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

/** PURE: THE ROUND-ROBIN (v0.670.0). Founder: "Head-to-head records and a
 *  round-robin schedule." A contest league's head-to-head pairings used to
 *  be a fresh seeded shuffle every week, so a seat could draw the same
 *  opponent three weeks running and never meet another. The circle method:
 *  seat one stays put, the rest rotate one place a round, so over n−1
 *  rounds everyone plays everyone once; the rotation then repeats. Which
 *  round a week is comes from the league's first played week, offset by a
 *  hash of the league id so two leagues don't run in step. Home and away
 *  swap each round. An odd count gives one seat a bye (paired with null). */
export function roundRobinPairs(leagueId, week, seats, firstWeek = week) {
  const s = [...new Set(seats)].sort((a, b) => a - b);
  if (s.length < 2) return [];
  if (s.length % 2) s.push(null);
  const n = s.length, rounds = n - 1;
  const rand = rng(`${leagueId}|robin`);
  const offset = Math.floor(rand() * rounds);
  const r = (((week - firstWeek) + offset) % rounds + rounds) % rounds;
  const fixed = s[0];
  const ring = s.slice(1);
  const rot = ring.slice(rounds - r).concat(ring.slice(0, rounds - r));   // rotate right by r
  const circle = [fixed, ...rot];
  const pairs = [];
  for (let i = 0; i < n / 2; i++) {
    const a = circle[i], b = circle[n - 1 - i];
    if (a == null || b == null) continue;                                  // the bye
    pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
  }
  return pairs;
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
  // (0463 retired the automatic weekly open Bullseye contest: Bullseye is now
  // leagues a commissioner makes — one week, or the season.)
  const { data: all } = await db().from('league')
    .select('id, name, kind, contest_week, settings_json').in('kind', ['pod', 'weekly', 'dfs', 'bullseye']).eq('season', season);
  // Toss expired showdowns: their members' home screens drop the card once
  // every seat is unenrolled. League + matchup rows stay as history.
  let tossed = 0;
  // An open Bullseye contest (0462) leaves the leagues list the same way.
  const expired = (all ?? []).filter((l) => (l.kind === 'weekly' || l.kind === 'bullseye') && l.contest_week != null && l.contest_week <= week - 2);
  if (expired.length) {
    const { data: gone } = await db().from('league_membership')
      .update({ enrolled: false })
      .in('league_id', expired.map((l) => l.id)).eq('enrolled', true).select('id');
    tossed = gone?.length ?? 0;
  }
  const pods = (all ?? []).filter((l) => l.kind === 'pod' || l.kind === 'dfs' || l.contest_week === week
    || (l.kind === 'bullseye' && l.contest_week == null));
  // CONTEST LEAGUES (0466): kind dfs or bullseye — the league's own spots and
  // budget shape the auto-builds, and only a head-to-head league is paired
  // (a leaderboard seat scores on its own row, made when it saves a squad).
  // (A Bullseye league — this week's, or a season one — is in `pods` for one
  // reason: the week's salary board below must exist for it to be built
  // against. It has no AI seats and no pairing — each entrant's scoring row
  // is made when they save an entry.)
  if (!pods?.length) return { pods: 0, dealt: 0, matchups: 0, tossed };

  const { board, skipped, kicks, slate } = await ensureSalaryBoard(season, week, idx);
  if (skipped) return { pods: pods.length, dealt: 0, matchups: 0, tossed, skipped };
  if (!board.length) return { pods: pods.length, dealt: 0, matchups: 0, tossed, skipped: 'no board' };
  // RULED OUT (v0.666.0): the injury report's O and IR, for the CPU's builds
  // and the auto-sub below. A human's squad is theirs until his game locks.
  const outs = await ruledOutSlugs().catch(() => new Set());
  const playable = board.filter((r) => !outs.has(r.slug));
  const lockMs = await weekKickoffMs(season, week, REGULAR_SEASON).catch(() => null);

  let dealt = 0, made = 0, subbed = 0, aiPlays = 0;
  for (const pod of pods) {
    const contest = pod.kind === 'dfs' || pod.kind === 'bullseye' ? contestConfigOf(pod.settings_json, pod.kind) : null;
    // A LEADERBOARD league (v0.673.0) is here for its no-shows only: a seat
    // scores on its own row, made when it saves a squad — or, under the
    // league's NO SQUAD BY LOCK rule, made for it below. No AI seats, no pairs.
    const boardLeague = !!contest && contest.format === 'board';
    // THE LOCK LEAD (v0.669.0): a drip pod seals picks an hour before kickoff;
    // a contest player locks AT his kickoff, like any DFS site.
    const lead = contest ? 0 : config.lockLeadMs;
    const teamLocked = (team) => { const k = kicks?.get(team); return Number.isFinite(k) && k - lead <= Date.now(); };
    const lockAt = lockMs ? new Date(lockMs - lead).toISOString() : null;
    const lockPassed = lockMs != null && lockMs - lead <= Date.now();
    const podCatalog = contest ? leagueCatalogOf({ scoring: pod.settings_json?.scoring_classic ?? null, ppr: pod.settings_json?.ppr }) : null;
    const contestCardNow = contest?.contest === 'bullseye' ? contestCard(pod.id, week, contest.slots, podCatalog) : null;
    // THE CPU'S POOL (v0.695.0, founder: "CPUs failed to set HC"): priced the league's own way, as the builder's
    // FILL FOR ME prices it (leagueWeekProj) — a head coach by his game this week, who the shared board carries
    // at 0 and the dart's auto-build therefore never picked.
    const cpuPool = contest ? playable.map((r) => ({ ...r, proj: leagueWeekProj(r, podCatalog, r.pos === 'HC' ? (slate?.get(r.team) ?? null) : undefined) })) : playable;
    // DFS Bullseye (0462): AI seats and no-shows AIM at the card instead.
    const bullCfg = contest ? null : dfsBullseyeConfigOf(pod.settings_json);
    const card = bullCfg ? dfsCard(pod.id, week) : null;
    const { data: mems } = await db().from('league_membership')
      .select('sleeper_roster_id, enrolled, app_user_id, controller').eq('league_id', pod.id);
    const seats = (mems ?? []).map((m) => m.sleeper_roster_id);
    const hasHuman = (mems ?? []).some((m) => m.enrolled && m.app_user_id);
    if (!seats.length || !hasHuman) continue;

    // Entries: AI seats auto-build immediately; human seats build their own
    // via save_pod_entry, but an entry-less human gets the auto-build at lock
    // — or, in a contest league (v0.673.0), whatever its NO SQUAD BY LOCK rule
    // says: a built squad, an empty one that scores zero, or nothing.
    const { data: have } = await db().from('sleeper_lineup')
      .select('roster_id').eq('league_id', pod.id).eq('week', week);
    const haveSet = new Set((have ?? []).map((r) => r.roster_id));
    const need = contest
      ? noShowBuilds(contest, mems ?? [], haveSet, lockPassed)
      : (mems ?? []).filter((m) => {
          if (haveSet.has(m.sleeper_roster_id)) return false;
          const isAi = m.controller === 'ai' || !m.app_user_id;
          return isAi || lockPassed;
        }).map((m) => ({ roster_id: m.sleeper_roster_id, how: 'cpu' }));
    if (need.length) {
      const rows = need.map(({ roster_id, how }) => {
        if (contest) {
          if (how === 'zero') return { league_id: pod.id, week, roster_id, starters_json: [] };
          const built = contestAutoBuild(cpuPool, contest, `${pod.id}|w${week}|aim${roster_id}`, contestCardNow);
          return {
            league_id: pod.id, week, roster_id,
            starters_json: contest.slots.filter((d) => built[d.slot]).map((d) => ({ slot: d.slot, sleeper_id: null, player_slug: built[d.slot], pos: board.find((b) => b.slug === built[d.slot])?.pos ?? d.pos[0] })),
          };
        }
        if (card) {
          const aimed = aimBuild(board, card, `${pod.id}|w${week}|aim${roster_id}`);
          return {
            league_id: pod.id, week, roster_id,
            starters_json: DFS_SLOT_NAMES.filter((sl) => aimed[sl]).map((sl) => ({ slot: sl, sleeper_id: null, player_slug: aimed[sl], pos: dfsSlotPos(sl) })),
          };
        }
        const squad = aiSalaryEntry(pod.id, week, roster_id, board);
        return {
          league_id: pod.id, week, roster_id,
          starters_json: squad.map((p, i) => ({ slot: i, sleeper_id: null, player_slug: p.slug, pos: p.pos })),
        };
      });
      await db().from('sleeper_lineup').upsert(rows, { onConflict: 'league_id,week,roster_id' });
      dealt += rows.length;
      // A leaderboard seat's scoring row is its own (save_contest_entry makes
      // it on a save); the worker's write for a no-show makes it the same way.
      if (boardLeague) {
        await db().from('matchup').upsert(need.map(({ roster_id }) => ({
          league_id: pod.id, week, sleeper_matchup_id: null, home_roster_id: roster_id, away_roster_id: roster_id, status: 'scheduled', lock_at: lockAt,
        })), { onConflict: 'league_id,week,home_roster_id,away_roster_id' });
      }
    }
    if (boardLeague) continue;

    // THE CPU SWAPS A RULED-OUT MAN (v0.666.0). A DFS site gives a human
    // nothing when his player is ruled out after lock, and lets him swap
    // before it; a CPU seat nobody is watching gets the swap made for it —
    // an Out/IR player whose game has not locked is replaced by the best
    // affordable body for that spot, the rest of the squad kept. The hourly
    // seat wire does the same job for a season roster.
    // …and FILLS A SPOT IT LEFT EMPTY (v0.679.2): a squad built before the
    // board carried the spot's position (a coach, a rookie-only WR) gets the
    // spot filled on a later tick, once the board does, from the unlocked.
    if (contest) {
      const aiSeats = new Set((mems ?? []).filter((m) => m.controller === 'ai' || !m.app_user_id).map((m) => m.sleeper_roster_id));
      if (aiSeats.size) {
        const { data: entries } = await db().from('sleeper_lineup')
          .select('roster_id, starters_json').eq('league_id', pod.id).eq('week', week).in('roster_id', [...aiSeats]);
        const fixes = [];
        for (const e of entries ?? []) {
          const rowsE = Array.isArray(e.starters_json) ? e.starters_json : [];
          const bySlug = new Map(board.map((b) => [b.slug, b]));
          const hurt = rowsE.filter((r) => r?.player_slug && outs.has(r.player_slug) && !teamLocked(bySlug.get(r.player_slug)?.team));
          const filled = new Set(rowsE.filter((r) => r?.player_slug).map((r) => r.slot));
          const empty = contest.slots.filter((d) => !filled.has(d.slot));
          if (!hurt.length && !empty.length) continue;
          const keep = Object.fromEntries(contest.slots.map((d) => [d.slot, null]));
          for (const r of rowsE) if (r?.slot in keep && r.player_slug && !hurt.includes(r)) keep[r.slot] = r.player_slug;
          const keptSlugs = new Set(Object.values(keep).filter(Boolean));
          const built = contestAutoBuild(cpuPool.filter((b) => keptSlugs.has(b.slug) || !teamLocked(b.team)), contest, `${pod.id}|w${week}|sub${e.roster_id}|${hurt.map((h) => h.player_slug).join(',')}`, contestCardNow, keep);
          const changed = contest.slots.some((d) => built[d.slot] !== keep[d.slot]);
          if (!changed) continue;
          fixes.push({ league_id: pod.id, week, roster_id: e.roster_id,
            starters_json: contest.slots.filter((d) => built[d.slot]).map((d) => ({ slot: d.slot, sleeper_id: null, player_slug: built[d.slot], pos: bySlug.get(built[d.slot])?.pos ?? d.pos[0] })) });
        }
        if (fixes.length) { await db().from('sleeper_lineup').upsert(fixes, { onConflict: 'league_id,week,roster_id' }); subbed += fixes.length; }
      }
      // THE AI'S PLAY (v0.699.0, founder: "add power up purchase and use to the AI seats in weekly contest leagues with
      // drip coin"): before the week's first kickoff, each AI seat with a squad and room under the cap buys and plays
      // from its wallet — the engine picks (aiContestPlays), ai_contest_play applies every rule a human's play meets.
      if (aiSeats.size && contest.coin && !lockPassed) {
        try {
          const ids = [...aiSeats];
          const [{ data: entriesP }, { data: played }, { data: wallets }] = await Promise.all([
            db().from('sleeper_lineup').select('roster_id, starters_json').eq('league_id', pod.id).eq('week', week).in('roster_id', ids),
            db().from('contest_play').select('roster_id, play_id, slot').eq('league_id', pod.id).eq('week', week).in('roster_id', ids),
            db().from('team_wallet').select('roster_id, coins').eq('league_id', pod.id).in('roster_id', ids),
          ]);
          const off = Array.isArray(pod.settings_json?.plays_off) ? pod.settings_json.plays_off : [];
          const offered = contestPlaysFor(contest.format, contest.contest, off);
          const cap = contestPlayCap(contest.format);
          const seedCoin = Number(contestCoinRules(pod.settings_json?.coin_rules ?? null).seed ?? 0);
          for (const e of entriesP ?? []) {
            const held = (played ?? []).filter((p) => p.roster_id === e.roster_id).map((p) => ({ id: p.play_id, slot: p.slot }));
            if (held.length >= cap) continue;
            const w = (wallets ?? []).find((x) => x.roster_id === e.roster_id);
            const wallet = w ? Number(w.coins) : seedCoin;   // no wallet yet: ai_contest_play seeds it on the first play
            const rowsE = Array.isArray(e.starters_json) ? e.starters_json : [];
            const squad = Object.fromEntries(contest.slots.map((d) => [d.slot, rowsE.find((r) => r?.slot === d.slot)?.player_slug ?? null]));
            const picks = aiContestPlays({ offered, wallet, cap, held, squad, slots: contest.slots, board: cpuPool, contest: contest.contest, format: contest.format, variant: contest.bullseye?.variant ?? null, seed: `${pod.id}|w${week}|ai${e.roster_id}` });
            for (const pk of picks) {
              const { data: r, error } = await db().rpc('ai_contest_play', { p_league: pod.id, p_week: week, p_roster: e.roster_id, p_play: pk.id, p_slot: pk.slot });
              if (r?.ok) aiPlays += 1; else console.log(new Date().toISOString(), 'ai play', pod.id, e.roster_id, pk.id, pk.slot ?? '', r?.error ?? error?.message ?? '?');
            }
          }
        } catch (e) { console.log(new Date().toISOString(), 'ai plays', pod.id, e?.message ?? e); }
      }
    }

    // PLAYOFFS (v0.674.0): a season head-to-head contest league plays the
    // classic bracket from its playoff start — the round-robin stops there,
    // and the SQL that books and advances the bracket is poked instead (both
    // idempotent and self-guarding: generate refuses until the regular season
    // is final and never builds over a bracket; advance no-ops until a round
    // is final). A playoff week's rows are the bracket's.
    const po = contest ? contestPlayoffs(pod.settings_json, contest, pod.contest_week) : { teams: 0, startWeek: 15 };
    if (contest && po.teams > 0 && week >= po.startWeek) {
      try {
        const { data: g } = await db().rpc('generate_playoffs', { p_league_id: pod.id, p_seeds: null, p_auto: true });
        if (g?.bracket) made += 1;
        const { data: a } = await db().rpc('advance_playoffs', { p_league_id: pod.id });
        if (a?.advanced) made += 1;
      } catch (e) { console.log(new Date().toISOString(), 'pods playoffs', pod.id, e.message); }
      continue;
    }
    const { data: haveM } = await db().from('matchup')
      .select('id').eq('league_id', pod.id).eq('week', week).limit(1);
    if (!haveM?.length) {
      // A contest league plays the round-robin from its first week (v0.670.0);
      // a drip pod is built fresh each week and keeps the shuffle.
      let pairs;
      if (contest) {
        const { data: first } = await db().from('matchup').select('week').eq('league_id', pod.id).order('week').limit(1);
        pairs = roundRobinPairs(pod.id, week, seats, first?.[0]?.week ?? week);
      } else {
        pairs = pairPodSeats(pod.id, week, seats);
      }
      const rows = pairs.map(([home, away]) => ({
        league_id: pod.id, week, sleeper_matchup_id: null,
        home_roster_id: home, away_roster_id: away, status: 'scheduled', lock_at: lockAt,
      }));
      if (rows.length) { await db().from('matchup').upsert(rows, { onConflict: 'league_id,week,home_roster_id,away_roster_id' }); made += rows.length; }
    }
  }
  return { pods: pods.length, dealt, matchups: made, tossed, subbed, aiPlays };
}

/** The week's salary board: built and FROZEN on first sight of the week, then
 *  always read back (weekly projections drift; the board a squad is being
 *  built against must not). Shared by the pods and the open Bullseye contest. */
export async function ensureSalaryBoard(season, week, idx) {
  // Slate: prefer the synced nfl_slate rows; fall back to a live ESPN build.
  let { data: slateRows } = await db().from('nfl_slate').select('home, away, kickoff').eq('season', season).eq('week', week);
  if (!slateRows?.length) {
    try {
      const slate = await buildSlate(season, week, REGULAR_SEASON);
      slateRows = slate.map((g) => ({ home: g.home, away: g.away, kickoff: g.kickoff }));
    } catch { slateRows = []; }
  }
  const slateTeams = new Set(slateRows.flatMap((g) => [g.home, g.away]).filter(Boolean));
  if (!slateTeams.size) return { board: [], skipped: 'no slate' };
  // Each team's kickoff (ms), for the per-player lock the auto-sub honours.
  const kicks = new TeamMap();
  // THE SLATE BY TEAM (v0.695.0): who each team plays and where, for pricing a head coach's week
  const slate = new TeamMap();
  for (const g of slateRows) { if (g.home && g.away) { slate.set(g.home, { opp: g.away, home: true }); slate.set(g.away, { opp: g.home, home: false }); } }
  for (const g of slateRows) {
    const ms = g.kickoff ? Date.parse(g.kickoff) : NaN;
    if (!Number.isFinite(ms)) continue;
    for (const t of [g.home, g.away]) if (t) kicks.set(t, Math.min(kicks.get(t) ?? Infinity, ms));
  }

  // The week's salary board: build + freeze on first sight of the week, then
  // always read back the frozen rows (weekly projections drift; the board a
  // human is building against must not).
  let board;
  const { data: haveSal } = await db().from('pod_salary')
    .select('slug').eq('season', season).eq('week', week).limit(1);
  if (!haveSal?.length) {
    const weekly = bakedWeekFor(week) ?? await sleeperWeekFor(season, week, idx);
    board = buildSalaryBoard(idx, slateTeams, weekly, await contestExtraPositions(season).catch(() => new Set()), await teamRoleNames().catch(() => new Map()));
    if (board.length) {
      await db().from('pod_salary').upsert(
        board.map((r) => ({ season, week, ...r })), { onConflict: 'season,week,slug' });
    }
  } else {
    const { data: rows } = await db().from('pod_salary')
      .select('slug, name, pos, team, salary, proj, exp, priced_proj').eq('season', season).eq('week', week).range(0, 4999);
    board = rows ?? [];
    board = await topUpSalaryBoard(season, week, idx, slateTeams, board);
    board = await refreshBoardProj(season, week, idx, board);
  }
  if (!board.length) return { board, skipped: 'no board', kicks, slate };
  return { board, skipped: null, kicks, slate };
}

/** THE PROJECTION MOVES, THE PRICE DOESN'T (v0.666.0). The DFS rule: a
 *  salary never changes after the board is out — that is the fairness to
 *  whoever built on Tuesday — but the projection is news, and a teammate's
 *  injury on Thursday is exactly what a builder wants to see on Friday. Once
 *  every REFRESH_MS per process: re-read the weekly feed and write the new
 *  `proj` where it moved by a tenth or more; `salary` and `priced_proj`
 *  stay as they were. Rows the feed does not price (HC, P, a flyer) keep
 *  their number. */
const REFRESH_MS = 6 * 3600e3;
const refreshedAt = new Map();
export async function refreshBoardProj(season, week, idx, board, now = Date.now()) {
  const key = `${season}|${week}`;
  if (now - (refreshedAt.get(key) ?? 0) < REFRESH_MS || !board.length) return board;
  refreshedAt.set(key, now);
  try {
    const weekly = bakedWeekFor(week) ?? await sleeperWeekFor(season, week, idx);
    if (!weekly) return board;
    const writes = [];
    for (const r of board) {
      let p = null;
      if (r.pos === 'K') p = weekly.kByTeam.get(r.team) ?? null;
      else if (r.pos === 'DEF') p = weekly.defByTeam.get(r.team) ?? null;
      else if (['QB', 'RB', 'WR', 'TE', 'FB'].includes(r.pos)) {
        const sid = idx.metaForSlug(r.slug)?.sid;
        p = sid != null ? weekly.bySid.get(String(sid)) ?? null : null;
      }
      if (p == null || !Number.isFinite(p)) continue;
      const next = Math.round(p * 10) / 10;
      if (Math.abs(next - Number(r.proj)) < 0.1) continue;
      r.proj = next;
      writes.push({ season, week, slug: r.slug, name: r.name, pos: r.pos, team: r.team, salary: r.salary, proj: next, exp: r.exp ?? null, priced_proj: r.priced_proj ?? null });
    }
    if (writes.length) await db().from('pod_salary').upsert(writes, { onConflict: 'season,week,slug' });
    return board;
  } catch (e) {
    refreshedAt.delete(key);
    console.log('salary board refresh', season, week, e?.message ?? e);
    return board;
  }
}

/** THE FROZEN BOARD LEARNS WHAT A CONTEST LEAGUE NEEDS (v0.665.2). Founder:
 *  "I have a HC spot and a rookie only spot and the players are not
 *  populating." A week's board is built once and frozen — so a board built
 *  before 0466 carries no `exp` (every tenure spot refuses everyone) and no
 *  HC/P/FB rows (an HC spot has nobody to pick), and a position a
 *  commissioner unlocks mid-week never appears. Once per week per process:
 *  fill in `exp` where it is missing, and ADD the rows a fresh build would
 *  carry that the frozen board lacks — at today's price, since nobody has
 *  built against them yet. Frozen salaries and projections are never
 *  touched. */
const toppedUp = new Set();
const toppedPos = new Map();   // `${season}|${week}` → positions this process has tried to add (v0.679.2)
const toppedTeams = new Map();   // v0.707.0: slate teams this process has tried to people
export async function topUpSalaryBoard(season, week, idx, slateTeams, board) {
  const key = `${season}|${week}`;
  if (!board.length) return board;
  // ONCE A WEEK for the experience fill; EVERY TICK for a position the board
  // lacks (v0.679.2). A commissioner who adds a HEAD COACH or a rookie-only
  // spot after the week's board is up used to wait for the next worker
  // boot: the once-a-week memo hid the new position, the CPU's squads were
  // built against a board without it, and a tenure spot refused everyone
  // whose experience the board hadn't filled in yet (Kickoff League, week
  // 6: two CPU spots EMPTY). The position check is a set compare in memory.
  const first = !toppedUp.has(key);
  toppedUp.add(key);
  const seenPos = toppedPos.get(key) ?? new Set();
  toppedPos.set(key, seenPos);
  try {
    const extras = await contestExtraPositions(season).catch(() => new Set());
    const wantPos = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', ...extras]);
    const havePos = new Set(board.map((r) => r.pos));
    const people = new Set(['QB', 'RB', 'WR', 'TE', 'FB', 'DL', 'LB', 'DB']);
    const expFixes = (first ? board.filter((r) => r.exp == null && people.has(r.pos)) : [])
      .map((r) => ({ r, exp: idx.metaForSlug(r.slug)?.exp ?? null })).filter((x) => x.exp != null);
    // a position this process has already tried to add is not tried again
    // (a board with no punters would otherwise be rebuilt every tick)
    const missingPos = [...wantPos].some((p) => !havePos.has(p) && !seenPos.has(p));
    for (const p of wantPos) if (!havePos.has(p)) seenPos.add(p);
    // A SLATE TEAM WITH NOBODY ON THE BOARD (v0.707.0): the Rams, every week until now — the board was frozen
    // without them. A team playing this week whose people are all missing gets them added, once per process.
    const seenTeams = toppedTeams.get(key) ?? new Set();
    toppedTeams.set(key, seenTeams);
    const peopled = new Set(board.filter((r) => people.has(r.pos)).map((r) => normTeam(String(r.team ?? ''))));
    const missingTeam = [...slateTeams].some((t) => !peopled.has(normTeam(String(t))) && !seenTeams.has(normTeam(String(t))));
    for (const t of slateTeams) if (!peopled.has(normTeam(String(t)))) seenTeams.add(normTeam(String(t)));
    if (!expFixes.length && !missingPos && !missingTeam) return board;
    let adds = [];
    if (missingPos || missingTeam) {
      const weekly = bakedWeekFor(week) ?? await sleeperWeekFor(season, week, idx);
      const have = new Set(board.map((r) => r.slug));
      adds = buildSalaryBoard(idx, slateTeams, weekly, extras, await teamRoleNames().catch(() => new Map())).filter((r) => !have.has(r.slug));
    }
    const writes = [
      ...expFixes.map(({ r, exp }) => ({ season, week, slug: r.slug, name: r.name, pos: r.pos, team: r.team, salary: r.salary, proj: r.proj, exp, priced_proj: r.priced_proj ?? r.proj })),
      ...adds.map((r) => ({ season, week, ...r })),
    ];
    if (writes.length) await db().from('pod_salary').upsert(writes, { onConflict: 'season,week,slug' });
    for (const { r, exp } of expFixes) r.exp = exp;
    return board.concat(adds);
  } catch (e) {
    if (first) toppedUp.delete(key);   // the experience fill tries again next tick
    console.log('salary board top-up', season, week, e?.message ?? e);
    return board;
  }
}

/** NEXT week's board, when a Bullseye league will play it — a season league,
 *  or one made for that week (the SQL answers "the week about to be played"
 *  from the slate, which can run ahead of this worker's week on a Tuesday). */
export async function ensureNextBullseyeBoard(season, week, idx) {
  const { data: lg } = await db().from('league').select('id').in('kind', ['dfs', 'bullseye']).eq('season', season)
    .or(`contest_week.is.null,contest_week.eq.${Number(week)}`).limit(1);
  if (!lg?.length) return null;
  const { skipped } = await ensureSalaryBoard(season, week, idx);
  return skipped ?? 'ok';
}
