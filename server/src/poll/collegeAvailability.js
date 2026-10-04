// WHO IS OUT BEFORE A COLLEGE KICKOFF (v0.615.0).
//
// Founder, after T. Green (TE, LSU) scored 0.00 in Devy Test 1: "We need to
// know status BEFORE the game so people can make roster changes."
//
// College football has no league-wide injury report, and ESPN's college
// injuries feed is empty in practice (three entries nationally the day this
// was written). What exists since 2025 is the CONFERENCE AVAILABILITY REPORT:
// the SEC, Big Ten, ACC and Big 12 each make their schools file one for
// conference games — three days, two days and one day before kickoff
// (Probable / Questionable / Doubtful / Out) and a final one ninety minutes
// to two hours before (Available / Game Time Decision / Out / Out (1st
// Half)). All four publish through the same vendor, HD Intelligence, whose
// public report page reads one unauthenticated JSON endpoint. This poll reads
// that endpoint, once per conference.
//
// WHAT IT WRITES. The injury_status table the NFL poll keeps (0001), keyed by
// the college slug c-<espn_id> with source 'conf', so every badge, player
// card, projection discount and the classic auto-slot's ruled-out set work
// unchanged for college players. Out → O; Doubtful → D; Questionable and Game
// Time Decision → Q; Out (1st Half) → Q (a targeting carry-over: he plays the
// second half). Probable and Available are a statement that he plays, and
// clear him. The comment carries the conference's own words and the game.
//
// CONFERENCE GAMES ONLY — the conferences' rule, not ours. LSU–McNeese, the
// game Green sat out, had no report. What the reports did say was that he was
// Out the Saturday before (vs Texas A&M), and that is still worth a manager's
// glance: a player Out on his school's last report, whose school has filed
// nothing for this week's game, is carried as Q for ten days with a comment
// that says exactly that. Nothing is invented; the hedge names its evidence.
//
// NAMES, NOT IDS. A report row reads "TE #0 Trey'Dez Green"; the conference
// knows no ESPN id. Matching is per school (the report's team is ESPN's
// location name, mapped to its team id below), by folded full name first,
// then jersey + surname, then surname + first initial when that is unique.
// Against six real rosters that resolved 601 of 604 rows; the three misses
// were walk-ons ESPN does not list. A row that matches nobody is counted and
// logged, never guessed.
//
// THE PRUNE IS GUARDED like the NFL poll's: a college designation is cleared
// only when every conference answered with a well-formed report set, so one
// vendor outage cannot un-injure the Power Four. And the NFL poll's own prune
// leaves c- slugs alone (poll/injuries.js) — before this it would have
// deleted every college row within three hours of it landing.
import { db } from '../supabase.js';
import { collegePos } from '../../../packages/core/src/data/college.ts';

export const REPORT_URL = 'https://app.hdintelligence.com/api/get-publish-public';
export const ESPN_TEAMS = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000';

/** The conferences that publish through HD Intelligence, by its code. */
export const CONFERENCES = [
  { code: 'SEC', name: 'SEC' }, { code: 'B10', name: 'Big Ten' },
  { code: 'ACC', name: 'ACC' }, { code: 'B12', name: 'Big 12' },
];

export const SOURCE = 'conf';
export const CARRY_SOURCE = 'conf-carry';
export const CARRY_DAYS = 10;
/** A report about a game this long over is history: its Q/D are dropped, its
 *  Out stands (the injury did not end with the game) until the next report. */
export const PLAYED_AFTER_MS = 36 * 3600e3;

/** ESPN location name → [ESPN team id, abbreviation], the Power Four for the
 *  2026 season (ESPN standings groups 1/4/5/8 joined to its team list). The
 *  reports' teamDisplayName is ESPN's location name — verified for all 56
 *  schools that filed in week 5. A name missing here is looked up on ESPN's
 *  team list at poll time and logged, so a realignment degrades, not breaks. */
export const SCHOOLS = {
  'Boston College': ['103', 'BC'], California: ['25', 'CAL'], Clemson: ['228', 'CLEM'], Duke: ['150', 'DUKE'],
  'Florida State': ['52', 'FSU'], 'Georgia Tech': ['59', 'GT'], Louisville: ['97', 'LOU'], Miami: ['2390', 'MIA'],
  'NC State': ['152', 'NCSU'], 'North Carolina': ['153', 'UNC'], Pittsburgh: ['221', 'PITT'], SMU: ['2567', 'SMU'],
  Stanford: ['24', 'STAN'], Syracuse: ['183', 'SYR'], Virginia: ['258', 'UVA'], 'Virginia Tech': ['259', 'VT'],
  'Wake Forest': ['154', 'WAKE'],
  Illinois: ['356', 'ILL'], Indiana: ['84', 'IU'], Iowa: ['2294', 'IOWA'], Maryland: ['120', 'MD'], Michigan: ['130', 'MICH'],
  'Michigan State': ['127', 'MSU'], Minnesota: ['135', 'MINN'], Nebraska: ['158', 'NEB'], Northwestern: ['77', 'NU'],
  'Ohio State': ['194', 'OSU'], Oregon: ['2483', 'ORE'], 'Penn State': ['213', 'PSU'], Purdue: ['2509', 'PUR'],
  Rutgers: ['164', 'RUTG'], UCLA: ['26', 'UCLA'], USC: ['30', 'USC'], Washington: ['264', 'WASH'], Wisconsin: ['275', 'WIS'],
  Arizona: ['12', 'ARIZ'], 'Arizona State': ['9', 'ASU'], BYU: ['252', 'BYU'], Baylor: ['239', 'BAY'], Cincinnati: ['2132', 'CIN'],
  Colorado: ['38', 'COLO'], Houston: ['248', 'HOU'], 'Iowa State': ['66', 'ISU'], Kansas: ['2305', 'KU'], 'Kansas State': ['2306', 'KSU'],
  'Oklahoma State': ['197', 'OKST'], TCU: ['2628', 'TCU'], 'Texas Tech': ['2641', 'TTU'], UCF: ['2116', 'UCF'], Utah: ['254', 'UTAH'],
  'West Virginia': ['277', 'WVU'],
  Alabama: ['333', 'ALA'], Arkansas: ['8', 'ARK'], Auburn: ['2', 'AUB'], Florida: ['57', 'FLA'], Georgia: ['61', 'UGA'],
  Kentucky: ['96', 'UK'], LSU: ['99', 'LSU'], 'Mississippi State': ['344', 'MSST'], Missouri: ['142', 'MIZ'], Oklahoma: ['201', 'OU'],
  'Ole Miss': ['145', 'MISS'], 'South Carolina': ['2579', 'SC'], Tennessee: ['2633', 'TENN'], Texas: ['251', 'TEX'],
  'Texas A&M': ['245', 'TA&M'], Vanderbilt: ['238', 'VAN'],
};
const ABBR_TO_ID = new Map(Object.values(SCHOOLS).map(([id, abbr]) => [abbr, id]));

// ── pure pieces ─────────────────────────────────────────────────────────────

const ROW = /^\s*(\S+)\s+#(\d+)\s+(.+?)\s*$/;
/** "TE #0 Trey'Dez Green" → { pos, jersey, name }, or null for a row that is
 *  not shaped like that (the odd "38 #38 Name" is a walk-on with no position
 *  — his pos parses as "38" and matches no roster position, which is fine). */
export function parseRow(name) {
  const m = ROW.exec(String(name ?? ''));
  return m ? { pos: m[1].toUpperCase(), jersey: String(Number(m[2])), name: m[3] } : null;
}

/** A report status → our designation: 'O' | 'D' | 'Q', 'A' for a positive
 *  "he plays" (Available, Probable), null for no statement (Exempt, unknown). */
export function mapAvailability(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return null;
  if (s === 'out') return 'O';
  if (s.startsWith('out') && s.includes('1st half')) return 'Q';
  if (s === 'doubtful') return 'D';
  if (s === 'questionable' || s === 'game time decision') return 'Q';
  if (s === 'probable' || s === 'available') return 'A';
  return null;
}

/** Lower-case ASCII, no punctuation, no generational suffix. */
export function foldName(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’.]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
const surname = (full) => { const q = foldName(full).split(' '); return q[q.length - 1]; };

/** One report row → the roster player it names, or null. Roster rows carry
 *  espn_id, full_name, jersey. */
export function matchPlayer(row, roster) {
  const f = foldName(row.name);
  if (!f) return null;
  const exact = roster.filter((p) => foldName(p.full_name) === f);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact.find((p) => String(Number(p.jersey)) === row.jersey) ?? null;
  const last = f.split(' ').pop();
  const byJersey = roster.filter((p) => String(Number(p.jersey)) === row.jersey && surname(p.full_name) === last);
  if (byJersey.length === 1) return byJersey[0];
  const byInitial = roster.filter((p) => surname(p.full_name) === last && foldName(p.full_name)[0] === f[0]);
  return byInitial.length === 1 ? byInitial[0] : null;
}

// US daylight time: the second Sunday of March to the first Sunday of
// November, taken at day granularity (a report is never posted at 2am).
function usDst(y, m, d) {
  const dow = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
  const secondSundayMarch = 1 + ((7 - dow(y, 3, 1)) % 7) + 7;
  const firstSundayNov = 1 + ((7 - dow(y, 11, 1)) % 7);
  if (m > 3 && m < 11) return true;
  if (m === 3) return d >= secondSundayMarch;
  if (m === 11) return d < firstSundayNov;
  return false;
}
const TZ_STD = { E: -5, C: -6, M: -7, P: -8 };
/** "2026-10-03" + "9:30:00" + "CT" → ISO instant. Null when any piece is
 *  unusable, so a designation is never dated by a guess. */
export function reportStamp(date, time, tz) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time ?? ''));
  const zm = /^([ECMP])[SD]?T$/i.exec(String(tz ?? '').trim());
  if (!dm || !tm || !zm) return null;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const offset = TZ_STD[zm[1].toUpperCase()] + (usDst(y, mo, d) ? 1 : 0);
  return new Date(Date.UTC(y, mo - 1, d, Number(tm[1]) - offset, Number(tm[2]), Number(tm[3] ?? 0))).toISOString();
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-03", "Mississippi State" → "Sat Oct 3 vs Mississippi State". */
export function gameLabel(date, opponent) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  const when = m ? `${DOW[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]} ${MON[+m[2] - 1]} ${+m[3]}` : 'this week';
  return opponent ? `${when} vs ${opponent}` : when;
}
const clock = (t) => String(t ?? '').replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');

/** Flatten one conference's publish payload (an object keyed by report id)
 *  into rows: one per player per report, each knowing its game and its
 *  report's posting time. */
export function reportRows(payload, conf) {
  const out = [];
  const reports = payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.values(payload) : [];
  for (const r of reports) {
    const games = Array.isArray(r?.games) ? r.games : [];
    const gameDate = r?.footer?.date ?? r?.publishDate ?? null;
    const postedAt = reportStamp(r?.publishDate, r?.postedTime, r?.conferenceTimeZone);
    const posted = `${r?.publishDayOfWeek ?? ''} ${clock(r?.postedTime)} ${r?.conferenceTimeZone ?? ''}`.replace(/\s+/g, ' ').trim();
    for (const g of games) {
      const team = g?.teamDisplayName ?? g?.teamName ?? null;
      const opponent = games.find((o) => o !== g)?.teamDisplayName ?? null;
      for (const row of g?.rows ?? []) {
        const p = parseRow(row?.name);
        if (!p || !team) continue;
        out.push({
          conf: conf.code, confName: conf.name, team, opponent, ...p,
          raw: String(row?.status ?? ''), tag: mapAvailability(row?.status),
          reportType: String(r?.ReportType ?? ''), posted, postedAt, gameDate,
        });
      }
    }
  }
  return out;
}

const gameMs = (date) => { const t = Date.parse(`${date}T12:00:00Z`); return Number.isFinite(t) ? t : null; };

/** PURE: the plan. `rows` from reportRows across conferences; `rosterBySchool`
 *  Map<school_id, roster rows>; `schoolId(name)` → ESPN team id or null;
 *  `held` the table's current c- rows; `complete` whether every conference
 *  answered (the prune's guard). */
export function planAvailability({ rows, rosterBySchool, schoolId, held = [], now = Date.now(), complete = true }) {
  const nowIso = new Date(now).toISOString();
  const latest = new Map();          // slug → { postedAt, record | null }
  const unmatched = [];
  const seenSchools = new Set();
  let statements = 0;
  for (const row of rows) {
    const sid = schoolId(row.team);
    if (!sid) { unmatched.push({ ...row, why: 'school' }); continue; }
    seenSchools.add(sid);
    if (row.tag == null) continue;                                  // Exempt / unknown: no statement
    const player = matchPlayer(row, rosterBySchool.get(sid) ?? []);
    if (!player) { if (collegePos(row.pos) && row.tag !== 'A') unmatched.push({ ...row, why: 'player' }); continue; }
    statements++;
    const slug = `c-${player.espn_id}`;
    const prev = latest.get(slug);
    const t = Date.parse(row.postedAt ?? '') || 0;
    if (prev && prev.t > t) continue;                                // an older report in the same set
    const gm = gameMs(row.gameDate);
    const played = gm != null && now - gm > PLAYED_AFTER_MS;
    let record = null;
    if (row.tag !== 'A' && !(played && row.tag !== 'O')) {
      record = {
        player_slug: slug, status: row.tag, source: SOURCE,
        designation_date: row.postedAt, return_date: null,
        comment: `${row.confName} availability report · ${row.reportType || 'report'} (${row.posted}) · ${row.raw} · ${gameLabel(row.gameDate, row.opponent)}`,
        team: abbrFor(sid), updated_at: nowIso,
      };
    }
    latest.set(slug, { t, record });
  }
  const upserts = new Map([...latest].filter(([, v]) => v.record).map(([k, v]) => [k, v.record]));

  // ── the carry: Out on his school's last report, nothing filed this week ──
  let carried = 0;
  for (const h of held) {
    if (upserts.has(h.player_slug) || latest.has(h.player_slug)) continue;   // spoken for this week
    if (h.source !== SOURCE && h.source !== CARRY_SOURCE) continue;
    const sid = ABBR_TO_ID.get(h.team);
    if (!sid || seenSchools.has(sid)) continue;                      // his school filed; the set decides
    const at = Date.parse(h.designation_date ?? '');
    if (!Number.isFinite(at) || now - at > CARRY_DAYS * 86400e3) continue;
    if (h.source === SOURCE && h.status !== 'O') continue;
    const label = h.source === SOURCE ? String(h.comment ?? '').split(' · ').pop() : /\((.+?)\)/.exec(h.comment ?? '')?.[1] ?? 'his last game';
    upserts.set(h.player_slug, {
      player_slug: h.player_slug, status: 'Q', source: CARRY_SOURCE,
      designation_date: h.designation_date, return_date: null,
      comment: `Out on his school's last availability report (${label}) · no report filed for this game — check before kickoff`,
      team: h.team, updated_at: nowIso,
    });
    carried++;
  }

  const deletes = complete
    ? held.filter((h) => (h.source === SOURCE || h.source === CARRY_SOURCE) && !upserts.has(h.player_slug)).map((h) => h.player_slug)
    : [];
  return { upserts: [...upserts.values()], deletes, unmatched, carried, statements, schools: seenSchools.size, prunedSkipped: !complete };
}
const abbrFor = (sid) => Object.values(SCHOOLS).find(([id]) => id === sid)?.[1] ?? null;

// ── IO ──────────────────────────────────────────────────────────────────────

/** One conference's reports: { conf, payload } or { conf, error }. */
export async function fetchReports(fetchImpl = fetch, confs = CONFERENCES) {
  const out = [];
  for (const conf of confs) {
    try {
      const res = await fetchImpl(REPORT_URL, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sport: 'Football', organization: conf.code, conference: conf.code }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('not a report set');
      out.push({ conf, payload });
    } catch (e) { out.push({ conf, error: e?.message ?? String(e) }); }
  }
  return out;
}

const PAGE = 1000;
async function allRows(select) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await select(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

let rosterCache = null; // { at, key, map }
const ROSTER_TTL_MS = 6 * 3600e3;
/** college_player for these schools, Map<school_id, rows>; cached 6h. */
async function rostersFor(schoolIds, now = Date.now()) {
  const key = [...schoolIds].sort().join(',');
  if (rosterCache && rosterCache.key === key && now - rosterCache.at < ROSTER_TTL_MS) return rosterCache.map;
  const map = new Map();
  if (schoolIds.length) {
    const rows = await allRows((from, to) => db().from('college_player')
      .select('espn_id, full_name, jersey, pos, school_id').in('school_id', schoolIds).eq('active', true)
      .order('espn_id').range(from, to));
    for (const r of rows) { if (!map.has(r.school_id)) map.set(r.school_id, []); map.get(r.school_id).push(r); }
  }
  rosterCache = { at: now, key, map };
  return map;
}

let espnLocations = null; // { at, map } — only consulted for a name SCHOOLS lacks
async function lookupSchool(name, fetchImpl, log) {
  if (!espnLocations || Date.now() - espnLocations.at > 86400e3) {
    try {
      const res = await fetchImpl(ESPN_TEAMS, { signal: AbortSignal.timeout(30_000) });
      const j = await res.json();
      const map = new Map();
      for (const l of j?.sports?.[0]?.leagues ?? []) for (const t of l?.teams ?? []) if (t?.team?.location) map.set(t.team.location, [String(t.team.id), t.team.abbreviation ?? null]);
      espnLocations = { at: Date.now(), map };
    } catch (e) { log('college availability: ESPN team list unavailable —', e.message); espnLocations = { at: Date.now(), map: new Map() }; }
  }
  const hit = espnLocations.map.get(name);
  if (hit) { SCHOOLS[name] = hit; ABBR_TO_ID.set(hit[1], hit[0]); log(`college availability: learned school ${name} → ${hit[0]} (${hit[1]})`); }
  return hit?.[0] ?? null;
}

/** Read every conference, write the designations, clear the stale ones.
 *  `dryRun` plans and prints without touching the table. */
export async function pollCollegeAvailability({ dryRun = false, log = () => {}, fetchImpl = fetch, now = Date.now() } = {}) {
  const fetched = await fetchReports(fetchImpl);
  const rows = [];
  const perConf = {};
  for (const f of fetched) {
    if (f.error) { perConf[f.conf.code] = { error: f.error }; continue; }
    const r = reportRows(f.payload, f.conf);
    rows.push(...r);
    const reports = Object.values(f.payload);
    perConf[f.conf.code] = {
      reports: reports.length,
      types: [...new Set(reports.map((x) => x?.ReportType).filter(Boolean))],
      games: [...new Set(reports.map((x) => x?.footer?.date).filter(Boolean))].sort(),
    };
  }
  const complete = fetched.every((f) => !f.error);

  // Schools named this week (so their rosters are read), unknown names learned.
  const schoolIds = new Set();
  for (const row of rows) {
    let sid = SCHOOLS[row.team]?.[0] ?? null;
    if (!sid) sid = await lookupSchool(row.team, fetchImpl, log);
    if (sid) schoolIds.add(sid);
  }
  const rosterBySchool = await rostersFor([...schoolIds], now);
  const held = await allRows((from, to) => db().from('injury_status')
    .select('player_slug, status, source, designation_date, comment, team').like('player_slug', 'c-%')
    .order('player_slug').range(from, to));

  const plan = planAvailability({ rows, rosterBySchool, schoolId: (name) => SCHOOLS[name]?.[0] ?? null, held, now, complete });
  let wrote = 0; let pruned = 0;
  if (!dryRun) {
    for (let i = 0; i < plan.upserts.length; i += 500) {
      const chunk = plan.upserts.slice(i, i + 500);
      const { error } = await db().from('injury_status').upsert(chunk, { onConflict: 'player_slug' });
      if (error) { log('college availability: upsert failed —', error.message); break; }
      wrote += chunk.length;
    }
    // Never subtraction without the addition having landed.
    if (wrote === plan.upserts.length) {
      for (let i = 0; i < plan.deletes.length; i += 200) {
        const chunk = plan.deletes.slice(i, i + 200);
        const { error } = await db().from('injury_status').delete().in('player_slug', chunk);
        if (!error) pruned += chunk.length;
      }
    }
  }
  return {
    conferences: perConf, rows: rows.length, statements: plan.statements, schools: plan.schools,
    designated: plan.upserts.length, carried: plan.carried, wrote, pruned, planned: plan.deletes.length,
    prunedSkipped: plan.prunedSkipped, unmatched: plan.unmatched, upserts: plan.upserts, dryRun,
  };
}
