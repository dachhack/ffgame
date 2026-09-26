// Guard for COLLEGE IDENTITY (0365).
//
// A college player's slug is c-<espn_id>, and the rule is stated twice: in
// packages/core/src/data/college.ts and in league_pool.level's generated
// expression plus seed_league_pool's gate (0365). A drift between them would
// have the client call a player college while the database files him as NFL.
// This pins both, and pins that no NFL-style slug can be read as college.
// Run: npx tsx scripts/check-college.mjs
import { readFileSync } from 'node:fs';
import { collegeSlug, isCollegeSlug, collegeEspnId, levelOf, collegePos, COLLEGE_POSITIONS } from '../packages/core/src/data/college.ts';
import { slugOf } from './espn/espnAdapter.mjs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

// ── 1. the slug ──
ok(collegeSlug('4688380') === 'c-4688380' && collegeSlug(4890973) === 'c-4890973', 'collegeSlug from string or number');
let threw = false; try { collegeSlug('abc'); } catch { threw = true; }
ok(threw, 'collegeSlug refuses a non-numeric id');
ok(isCollegeSlug('c-4688380') && collegeEspnId('c-4688380') === '4688380' && levelOf('c-4688380') === 'college',
  'a college slug reads back its ESPN id and level');

// ── 2. THE POINT: no NFL name slug is ever college ──
for (const name of ['C. Smith', 'C.J. Stroud', 'C J Anderson', 'Christian McCaffrey', 'CeeDee Lamb']) {
  const s = slugOf(name);
  ok(!isCollegeSlug(s) && levelOf(s) === 'nfl', `"${name}" slugs to ${s}, which is NFL`);
}
ok(!isCollegeSlug('c-') && !isCollegeSlug('c-12a') && !isCollegeSlug('xc-123') && !isCollegeSlug(null),
  'near misses are not college');

// ── 3. the SQL states the same rule ──
const sql = readFileSync(new URL('../supabase/migrations/0365_college_players.sql', import.meta.url), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
ok(/generated always as \(case when slug ~ '\^c-\[0-9\]\+\$' then 'college' else 'nfl' end\)/.test(sql),
  'league_pool.level is generated from ^c-[0-9]+$');
ok((sql.match(/'\^c-\[0-9\]\+\$'/g) ?? []).length >= 3, 'seed_league_pool uses the same pattern for its gate and its espn_id');
const upsertPos = /in \('QB', 'RB', 'WR', 'TE', 'K', 'P', 'FB', 'DL', 'LB', 'DB'\)/.test(sql);
ok(upsertPos && COLLEGE_POSITIONS.join() === 'QB,RB,WR,TE,K,P,FB,DL,LB,DB', 'the upsert\'s position list matches COLLEGE_POSITIONS');

// ── 4. positions ──
const map = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FB: 'FB', PK: 'K', P: 'P', EDGE: 'DL', DE: 'DL', DT: 'DL',
  DL: 'DL', LB: 'LB', CB: 'DB', S: 'DB', DB: 'DB', OL: null, C: null, LS: null, ATH: null };
for (const [espn, want] of Object.entries(map)) ok(collegePos(espn) === want, `ESPN ${espn} → ${want}`);
ok(Object.values(map).filter(Boolean).every((p) => COLLEGE_POSITIONS.includes(p)), 'every mapped position is storable');

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE CHECKS PASS');
