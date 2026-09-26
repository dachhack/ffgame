// THE COLLEGE DIRECTORY (0365) — every FBS fantasy-position player, by ESPN id.
//
// Phase 1 of college players (devy, college-only and mixed leagues; classic
// only). This poll only FILLS college_player; nothing puts those players in a
// league pool yet.
//
// WHERE FROM. ESPN's free endpoints, the same family the NFL pollers read:
//   · the FBS team list from the core API (`groups/80`). The site API's
//     `teams?groups=80` ignores the filter and returns 300 schools, FCS
//     included; the core API returned 148 for 2026.
//   · one roster per school from the site API (~100 athletes each, with
//     position, class year and jersey).
//
// NO NAME MATCHING. The key is the ESPN athlete id, which ESPN keeps when a
// player reaches the NFL; the slug a league would hold him by is c-<espn_id>
// (packages/core/src/data/college.ts).
//
// RETIREMENT. finish_college_sweep marks inactive anyone the sweep did not see,
// so it runs ONLY after every school's roster came back. One timeout skips the
// retirement for that sweep rather than retiring a school.
//
// CADENCE. Weekly in season; daily from February through August, when
// transfers and signings move players between schools. The sweep is ~150
// requests, so it runs detached from the tick and never delays live scoring.
import { db } from '../supabase.js';
import { collegePos } from '../../../packages/core/src/data/college.ts';

const CORE_TEAMS = (season) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2/groups/80/teams?limit=300`;
const ROSTER = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/roster`;
// 0382: every FBS conference and its teams, in one request.
const STANDINGS = (season) => `https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80&season=${season}`;

// ESPN conference group ids → the short name the draft filter shows, and its tier.
export const CONFERENCES = {
  1: ['ACC', 'P4'], 4: ['Big 12', 'P4'], 5: ['Big Ten', 'P4'], 8: ['SEC', 'P4'],
  151: ['American', 'G5'], 12: ['C-USA', 'G5'], 15: ['MAC', 'G5'], 17: ['Mountain West', 'G5'],
  9: ['Pac-12', 'G5'], 37: ['Sun Belt', 'G5'], 18: ['Independent', 'IND'],
};

/** PURE (0382): ESPN's FBS standings → one row per school with its conference.
 *  A conference's teams sit under its `standings.entries`, or under its
 *  children's when it splits into divisions. An unknown conference id is
 *  skipped rather than guessed. */
export function schoolsFromStandings(feed) {
  const out = [];
  for (const c of feed?.children ?? []) {
    const known = CONFERENCES[Number(c.id)];
    if (!known) continue;
    const entries = [...(c.standings?.entries ?? []), ...(c.children ?? []).flatMap((d) => d.standings?.entries ?? [])];
    for (const e of entries) {
      const t = e?.team;
      if (!t?.id) continue;
      out.push({ school_id: String(t.id), school_abbr: t.abbreviation ?? null, conference: known[0], conf_id: Number(c.id), tier: known[1] });
    }
  }
  return out;
}

// ESPN fills only the category a request names (a plain `offense` page came
// back with every stat blank), so each season is three walks — passing,
// rushing, receiving — merged per athlete before anything is written.
const STAT_CATS = [['passing', 'passingYards'], ['rushing', 'rushingYards'], ['receiving', 'receivingYards']];
const STATS = (season, page, cat, sort) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/statistics/byathlete?season=${season}&seasontype=2&limit=1000&page=${page}&category=offense:${cat}&sort=${cat}.${sort}:desc&isqualified=false&group=80`;

const DAY = 86400000;
const CHUNK = 500;
const CONCURRENCY = 4;

/** FBS school ids from the core API's list of `$ref` links. */
export function fbsTeamIds(feed) {
  const out = [];
  for (const it of feed?.items ?? []) {
    const m = /\/teams\/(\d+)(?:[/?]|$)/.exec(it?.$ref ?? '');
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** One school's roster → college_player rows. Non-fantasy positions drop. */
export function rosterRows(roster) {
  const team = roster?.team ?? {};
  const out = [];
  for (const group of roster?.athletes ?? []) {
    for (const a of group?.items ?? []) {
      const pos = collegePos(a?.position?.abbreviation);
      const id = String(a?.id ?? '');
      const name = (a?.fullName ?? a?.displayName ?? '').trim();
      if (!pos || !/^\d+$/.test(id) || !name) continue;
      const status = a?.status?.type;
      out.push({
        espn_id: id,
        full_name: name,
        pos,
        espn_pos: a.position.abbreviation,
        school_id: team.id != null ? String(team.id) : null,
        school: team.displayName ?? null,
        school_abbr: team.abbreviation ?? null,
        class_year: Number.isFinite(a?.experience?.years) ? a.experience.years : null,
        class_label: a?.experience?.abbreviation ?? null,
        jersey: a?.jersey != null ? String(a.jersey) : null,
        active: status == null ? true : status === 'active',
      });
    }
  }
  return out;
}

// ESPN prints numbers as strings with thousands separators, and '-' for none.
const num = (v) => {
  if (v == null || v === '-' || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** One page of ESPN's byathlete stats → college_player_stats rows (0369).
 *  Columns are found by NAME in the page's own category headers, so a
 *  reordered feed can't shift yards into touchdowns. */
export function statRows(page) {
  const idx = {};
  for (const c of page?.categories ?? []) idx[c.name] = c.names ?? [];
  const pick = (cats, cat, name) => {
    const i = (idx[cat] ?? []).indexOf(name);
    const col = cats.find((c) => c.name === cat);
    return i < 0 || !col ? null : num((col.totals ?? col.values ?? [])[i]);
  };
  const out = [];
  for (const a of page?.athletes ?? []) {
    const id = String(a?.athlete?.id ?? '');
    if (!/^\d+$/.test(id)) continue;
    const c = a.categories ?? [];
    out.push({
      espn_id: id,
      gp: pick(c, 'general', 'gamesPlayed'),
      pass_yds: pick(c, 'passing', 'passingYards'), pass_td: pick(c, 'passing', 'passingTouchdowns'),
      ints: pick(c, 'passing', 'interceptions'),
      rush_yds: pick(c, 'rushing', 'rushingYards'), rush_td: pick(c, 'rushing', 'rushingTouchdowns'),
      rec: pick(c, 'receiving', 'receptions'), rec_yds: pick(c, 'receiving', 'receivingYards'),
      rec_td: pick(c, 'receiving', 'receivingTouchdowns'),
    });
  }
  return out;
}

/** Merge per-category rows into one line per athlete: a value from any
 *  category beats a null, so a WR's receiving survives the rushing walk. */
export function mergeStatRows(lists) {
  const by = new Map();
  for (const r of lists.flat()) {
    const cur = by.get(r.espn_id) ?? { espn_id: r.espn_id };
    for (const [k, v] of Object.entries(r)) if (v != null && cur[k] == null) cur[k] = v;
    by.set(r.espn_id, cur);
  }
  return [...by.values()];
}

/** One season's passing, rushing and receiving lines → upsert_college_stats. */
export async function runStatsSweep(season, log = () => {}, fetchJson = getJson, rpc = (fn, args) => db().rpc(fn, args)) {
  const lists = [];
  for (const [cat, sort] of STAT_CATS) {
    for (let page = 1, pages = 1; page <= pages && page <= 10; page++) {
      const d = await fetchJson(STATS(season, page, cat, sort));
      pages = Number(d?.pagination?.pages ?? 1);
      lists.push(statRows(d));
    }
  }
  const merged = mergeStatRows(lists);
  let rows = 0;
  for (let i = 0; i < merged.length; i += CHUNK) {
    const { data, error } = await rpc('upsert_college_stats', { p_season: season, p_rows: merged.slice(i, i + CHUNK) });
    if (error) { log('college stats', season, error.message); return rows; }
    rows += Number(data?.rows ?? 0);
  }
  return rows;
}

/** How long to wait between sweeps on a given date: daily Feb–Aug, weekly otherwise. */
export function sweepEveryMs(now = new Date()) {
  if (process.env.COLLEGE_POLL_MS) return Number(process.env.COLLEGE_POLL_MS);
  const m = now.getUTCMonth(); // 0 = January
  return m >= 1 && m <= 7 ? DAY : 7 * DAY;
}

// Three tries, like the scoreboard poller: one dropped connection in ~150
// requests would otherwise cost the whole sweep its retirement pass.
async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return res.json();
      last = new Error(`${res.status} ${url}`);
    } catch (e) { last = e; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw last;
}

/** Fetch every roster, write the rows, and retire the unseen if nothing failed. */
export async function runCollegeSweep(season, log = () => {}, fetchJson = getJson, rpc = (fn, args) => db().rpc(fn, args)) {
  const started = new Date().toISOString();
  const ids = fbsTeamIds(await fetchJson(CORE_TEAMS(season)));
  if (!ids.length) return { schools: 0, rows: 0, failed: 0, retired: 0, error: 'no FBS teams' };

  const rows = [];
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { rows.push(...rosterRows(await fetchJson(ROSTER(id)))); }
      catch (e) { failed++; log('college roster', id, e.message); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  let wrote = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await rpc('upsert_college_players', { p_rows: rows.slice(i, i + CHUNK) });
    if (error) return { schools: ids.length, rows: wrote, failed, retired: 0, error: error.message };
    wrote += Number(data?.rows ?? 0);
  }

  let retired = 0;
  if (failed === 0) {
    const { data, error } = await rpc('finish_college_sweep', { p_started: started });
    if (error) log('college retire', error.message);
    else retired = Number(data?.retired ?? 0);
  }

  // 0382: conferences, from one standings request. Best-effort.
  try {
    const schools = schoolsFromStandings(await fetchJson(STANDINGS(season)));
    if (schools.length) {
      const { error } = await rpc('upsert_college_schools', { p_rows: schools });
      if (error) log('college conferences', error.message);
    }
  } catch (e) { log('college conferences', e.message); }

  // 0369: last season's lines and this season's so far — the pool's ranking.
  let stats = 0;
  for (const yr of [Number(season) - 1, Number(season)]) {
    try { stats += await runStatsSweep(yr, log, fetchJson, rpc); }
    catch (e) { log('college stats', yr, e.message); }
  }
  return { schools: ids.length, rows: wrote, failed, retired, stats };
}

let last = 0;
let inflight = null;

/** The tick's entry point: starts a sweep when one is due, never awaits it. */
export function sweepCollege(season, log = () => {}) {
  if (inflight || Date.now() - last < sweepEveryMs()) return false;
  last = Date.now();
  inflight = runCollegeSweep(season, log)
    .then((r) => log(`college: ${r.rows} players from ${r.schools} schools, ${r.stats ?? 0} stat lines` +
      (r.failed ? `, ${r.failed} rosters failed (no retirement this sweep)` : `, ${r.retired} retired`) +
      (r.error ? ` — ${r.error}` : '')))
    .catch((e) => log('college sweep error', e.message))
    .finally(() => { inflight = null; });
  return true;
}
