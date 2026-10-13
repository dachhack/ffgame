// Guard for THE RAMS (v0.707.0). Offline — check:parity.
//
// Founder: "Can we make sure that matching error never happens again at any
// place in the app or web?" The error: one feed says LAR / WSH / JAC, the slate
// says LA / WAS / JAX, and a lookup compared them raw — so a Rams player was
// off the salary board (Mooney: "Stafford is not a QB option in Bullseye"),
// sealed at Thursday's kickoff (#1095), or locked out of a lineup (#1028).
//
// Three guards:
//   1. THE TABLE ROUND-TRIPS: TeamMap / TeamSet / sameTeam, and the real
//      builders the screens and worker read through (locks, slate-by-team,
//      the preseason pool, the depth chart), answer a LAR lookup with LA's row.
//   2. THE MIRRORS AGREE: the SQL `_nfl_team` and scoreboard.js TEAM_FIX fold
//      every alias the table folds, to the same code.
//   3. NO RAW COMPARISON ANYWHERE: a scan of the worker, web and phone source
//      for the bug's shape — `.has(x.team)`, `.get(x.team)`, `[x.team]`,
//      `x.team === y` — that does not normalise on the line. A line whose two
//      sides really do come from one source wears `// team-code: same source —
//      why`, and the waiver is the review.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normTeam, sameTeam, TeamMap, TeamSet, TEAM_ALIASES } from '../packages/core/src/data/teamCodes.ts';
import { locksFromSlate, slateByTeam } from '../packages/core/src/data/liveApi.ts';
import { poolFromRows } from '../packages/core/src/data/preseasonPool.ts';
import { setDepthChart, depthForTeam, clearDepthChart } from '../packages/core/src/data/playerDepth.ts';
import { normTeam as seatNorm } from '../packages/core/src/data/seatRules.ts';
import { normTeam as slugNorm } from '../packages/core/src/data/slugMeta.ts';

let fails = 0;
const ok = (cond, label, extra) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}${!cond && extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); if (!cond) fails++; };
const root = new URL('..', import.meta.url).pathname;

// 1 ── the table and the maps
for (const [alias, canon] of TEAM_ALIASES) {
  ok(normTeam(alias) === canon && normTeam(alias.toLowerCase()) === canon && normTeam(` ${alias} `) === canon, `normTeam folds ${alias} → ${canon}, whatever the case or padding`);
  ok(sameTeam(alias, canon) && sameTeam(canon, alias), `sameTeam(${alias}, ${canon}) both ways`);
}
ok(normTeam('KC') === 'KC' && normTeam('kc') === 'KC' && normTeam(null) === '' && normTeam(undefined) === '', 'an ordinary code passes through upper-cased; nothing is ""');
ok(!sameTeam('', '') && !sameTeam(null, null), 'two empty codes are not the same team');
ok(seatNorm === normTeam && slugNorm === normTeam, 'seatRules and slugMeta export THE one table, not a copy');
const m = new TeamMap([['LA', 1], ['WAS', 2]]);
ok(m.get('LAR') === 1 && m.get('lar') === 1 && m.has('WSH') && m.get('WAS') === 2 && m.get('JAX') === undefined, 'TeamMap: set by the slate, found by the index');
m.set('JAC', 3);
ok(m.get('JAX') === 3 && [...m.keys()].join() === 'LA,WAS,JAX', 'TeamMap: set by the index, found by the slate; keys iterate as the slate spells them');
ok(m.delete('LAR') && !m.has('LA'), 'TeamMap: delete through an alias');
const s = new TeamSet(['LA', 'WAS', null, '']);
ok(s.has('LAR') && s.has('WSH') && !s.has('KC') && s.size === 2, 'TeamSet: a LA slate holds LAR; empties never enter', [...s]);
s.add('jac');
ok(s.has('JAX') && [...s].join() === 'LA,WAS,JAX', 'TeamSet: add an alias, hold the slate code');
ok(m instanceof Map && s instanceof Set, 'they are still a Map and a Set to every consumer');

// 2 ── the real builders the screens and the worker read through
const rows = [{ home: 'LA', away: 'KC', kickoff: '2026-10-18T20:25:00Z' }, { home: 'WAS', away: 'JAX', kickoff: '2026-10-18T17:00:00Z' }];
const locks = locksFromSlate(rows, 0);
ok(locks.get('LAR') === Date.parse(rows[0].kickoff) && locks.get('WSH') === Date.parse(rows[1].kickoff) && locks.get('JAC') === locks.get('JAX'), 'weekGameLocks: a Rams / Commanders / Jaguars player finds his lock by the index\'s code');
const slate = slateByTeam(rows);
ok(slate.get('LAR')?.opp === 'KC' && slate.get('LAR')?.home === true && slate.get('WSH')?.opp === 'JAX', 'weekSlateByTeam: the same for his matchup line');
const pool = poolFromRows([
  { slug: 'matthew-stafford', full: 'Matthew Stafford', pos: 'QB', team: 'LAR', depth: 1, sid: '421' },
  { slug: 'some-commander', full: 'Some Commander', pos: 'WR', team: 'WSH', depth: 1, sid: '2' },
  { slug: 'a-bye-guy', full: 'A Bye Guy', pos: 'RB', team: 'DAL', depth: 1, sid: '3' },
], new Set(['LA', 'WAS']));
ok(pool.some((p) => p.slug === 'matthew-stafford') && pool.some((p) => p.slug === 'some-commander') && !pool.some((p) => p.slug === 'a-bye-guy'), 'the preseason pool keeps LAR and WSH on a LA / WAS slate, and still drops the bye', pool.map((p) => p.slug));
setDepthChart([{ slug: 'matthew-stafford', team: 'LAR', pos: 'QB', depth: 1 }]);
ok(depthForTeam('LA').length === 1 && depthForTeam('lar').length === 1 && depthForTeam('LA')[0].team === 'LA', 'the depth chart loaded as LAR answers for LA, and says LA');
clearDepthChart();

// 3 ── the mirrors agree with the table
const sql = readFileSync(join(root, 'supabase/migrations/0414_rams_kickoff.sql'), 'utf8');
const sqlBody = sql.match(/create or replace function _nfl_team\(t text\)[\s\S]*?\$\$;/)?.[0] ?? '';
for (const [alias, canon] of TEAM_ALIASES) {
  if (alias === 'LVR') continue; // seatRules' LVR (Raiders on one feed) is newer than the SQL; nothing writes it to a table
  ok(new RegExp(`when '${alias}' then '${canon}'`).test(sqlBody), `SQL _nfl_team folds ${alias} → ${canon}`);
}
const sb = readFileSync(join(root, 'server/src/poll/scoreboard.js'), 'utf8');
const fix = sb.match(/const TEAM_FIX = \{([^}]*)\}/)?.[1] ?? '';
for (const [alias, canon] of TEAM_ALIASES) {
  if (alias === 'LVR' || alias === 'AZ') continue; // ESPN never says either; AZ was nflverse's
  ok(new RegExp(`\\b${alias}: '${canon}'`).test(fix), `scoreboard TEAM_FIX folds ${alias} → ${canon}`);
}

// 4 ── no raw team comparison anywhere in the app, the web or the worker
const ROOTS = ['src', 'apps/mobile/src', 'packages/core/src', 'server/src'];
const SKIP = /\/(college|golf|sports)\/|collegeAvailability|\.test\.|\/__tests__\//;
const SHAPES = [
  /\.(has|get|set|delete)\(\s*(String\()?[A-Za-z_$][\w$.?!]*\.team\b/,   // m.get(p.team)
  /\[\s*[A-Za-z_$][\w$.?!]*\.team\s*\]/,                                   // o[p.team]
  /[A-Za-z_$][\w$.?!]*\.team\s*[!=]==/,                                     // p.team === x
  /[!=]==\s*[A-Za-z_$][\w$.?!]*\.team\b/,                                   // x === p.team
  /\.team\)?\.toUpperCase\(\)\s*[!=]==|[!=]==\s*[\w$.?!]*\.team\)?\.toUpperCase\(\)/, // p.team.toUpperCase() === x
  /\.(has|get|set)\(\s*(String\()?[\w$.?!]*\.team\)?\.toUpperCase\(\)/,         // m.get(p.team.toUpperCase())
  /\[\s*(String\()?[\w$.?!]*\.team\)?\.toUpperCase\(\)\s*\]/,                    // o[p.team.toUpperCase()]
  /String\([\w$.?!]*\.team\)\.toUpperCase\(\)/,                                 // the key, spelled out first
  /\[\s*String\(\s*(g\.home|g\.away|t|team|tm)\s*\)\.toUpperCase\(\)\s*\]/,   // kicks[String(t).toUpperCase()]: an upper-cased slate side as a key
];
/** `.has/.get/.set(x.team)` on a receiver the file binds to a TeamMap / TeamSet (or fills from
 *  weekGameLocks / weekSlateByTeam, which build one) is the fix, not the bug. */
const guardedReceiver = (code, src) => {
  const m = code.match(/([A-Za-z_$][\w$]*(?:\?\.|\.)?)*?([A-Za-z_$][\w$]*)\??\.(has|get|set|delete)\(\s*(String\()?[A-Za-z_$][\w$.?!]*\.team\b/);
  if (!m) return false;
  const id = m[2];
  if (new RegExp(`\\b${id}\\b[^\\n]*new Team(Map|Set)\\b`).test(src)) return true;
  if (id === 'locks' && /weekGameLocks\(/.test(src)) return true;
  if (id === 'slate' && /weekSlateByTeam\(/.test(src)) return true;
  return false;
};
const SAFE = /normTeam\(|sameTeam\(|new TeamMap|new TeamSet|team-code: same source/;
const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (f === 'node_modules' || f.startsWith('.')) continue; const st = statSync(p); if (st.isDirectory()) walk(p, out); else if (/\.(ts|tsx|js|mjs)$/.test(f)) out.push(p); } return out; };
const hits = [];
for (const r of ROOTS) for (const f of walk(join(root, r))) {
  const rel = relative(root, f);
  if (SKIP.test(rel)) continue;
  const src = readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/(?!.*team-code:).*$/, '');
    if (!code.includes('.team')) return;
    if (SAFE.test(line)) return;
    if (/\.team_|\.teamId|\.team\.(id|name|roster)|\.team_name/.test(code) && !/\.team\b(?!_|Id|\.)/.test(code)) return;
    if (!SHAPES.some((re) => re.test(code))) return;
    if (guardedReceiver(code, src) && !SHAPES.slice(1).some((re) => re.test(code))) return;
    hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}
// the scan must still see the bug's shapes (a check that passes on everything guards nothing)
const BAD = [
  "    if (!p.team || !slateTeams.has(p.team)) continue;",
  "    kicks[String(t).toUpperCase()] = Math.min(kicks[String(t).toUpperCase()] ?? Infinity, ms);",
  "      : g ? `${g.home === player.team ? 'vs' : '@'} ${g.away}` : null;",
  "    if (teams && (!p.team || !teams.has(p.team.toUpperCase()))) continue;",
  "      const kick = kicks.get(String(b.team ?? '').toUpperCase());",
  "      && (nflTeam === 'ALL' || p.team.toUpperCase() === nflTeam)",
];
const GOOD = [
  "    if (f.team && !sameTeam(p.team, f.team)) return false;",
  "  const sched = new TeamMap(Object.entries(feed?.teamWeeks ?? {}));",
  "          <span>{S.team.toUpperCase()}</span>",
  "        if (fTeam !== 'ALL' && b.team !== fTeam) continue; // team-code: same source — the filter's chips are the bio's own codes",
];
ok(BAD.every((l) => SHAPES.some((re) => re.test(l))), 'the scan sees every shape the bug has taken', BAD.filter((l) => !SHAPES.some((re) => re.test(l))));
ok(GOOD.every((l) => SAFE.test(l) || !SHAPES.some((re) => re.test(l))), 'and lets a normalised, a TeamMap, a display and a waived line through', GOOD.filter((l) => !SAFE.test(l) && SHAPES.some((re) => re.test(l))));
ok(!hits.length, `no raw team-code comparison in ${ROOTS.join(', ')} (normalise it, or waive it with "// team-code: same source — why")`);
for (const h of hits) console.log(`   ${h}`);

console.log(fails ? `\n${fails} TEAM-CODE ASSERTION(S) FAILED` : '\nALL TEAM-CODE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
