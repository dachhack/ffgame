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
import { isPreseasonWeek, isCollegeWeek, weekLabel, weekTick, weekTitle } from '../packages/core/src/data/nflSlate.ts';
import { slotAllows, classicSlotsFromSpec, slotFilterLabel, slateAwareProj, optimalLineup } from '../packages/core/src/engine/classic.ts';
import { setCollegeProjections, collegeHasGame, projectedPoints, setLeagueProjScoring, clearLeagueProjScoring, hasProjection } from '../packages/core/src/engine/projScoring.ts';
import { levelClassMatch, poolSearchMatch, projFor, DRAFT_POS_FILTERS } from '../packages/core/src/data/poolSort.ts';

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

// ── 5. college weeks (0371): 201+ is college, 101..199 preseason ──
ok(isPreseasonWeek(102) && !isPreseasonWeek(203) && !isPreseasonWeek(5), 'preseason is 101..199 only');
ok(isCollegeWeek(203) && !isCollegeWeek(103) && !isCollegeWeek(3), 'college is 201+');
ok(weekLabel(203) === 'CFB 3' && weekTick(203) === 'C3' && weekTitle(203) === 'CFB WK 3', 'college weeks read as CFB');
ok(weekLabel(217) === 'BOWL 2' && weekTick(217) === 'B2' && weekTitle(217) === 'BOWL WK 2', 'bowl weeks (0375) read as BOWL');
ok(weekLabel(102) === 'PRE 2' && weekTitle(5) === 'WEEK 5', 'preseason and NFL labels unchanged');
const cal = readFileSync(new URL('../supabase/migrations/0371_college_calendar.sql', import.meta.url), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
ok(/is_practice_week[\s\S]*?coalesce\(p_week, 0\) between 101 and 199/.test(cal), 'SQL practice weeks match isPreseasonWeek (101..199)');

// ── 6. spot levels in a mixed league (0372) ──
{
  const [nflOnly, cfbOnly, either] = classicSlotsFromSpec([
    { pos: ['RB', 'WR', 'TE'], level: 'nfl' }, { pos: ['RB', 'WR', 'TE'], level: 'college' }, { pos: ['RB', 'WR', 'TE'] }]);
  const college = { id: 'c-4890973', pos: 'RB', team: '' };
  const pro = { id: 'bijan-robinson', pos: 'RB', team: 'ATL' };
  ok(nflOnly.flt?.level === 'nfl' && cfbOnly.flt?.level === 'college' && either.flt == null, 'the spec carries each spot\'s level');
  ok(slotAllows(cfbOnly, college) && !slotAllows(cfbOnly, pro), 'a college spot takes college players only');
  ok(slotAllows(nflOnly, pro) && !slotAllows(nflOnly, college), 'an NFL spot takes NFL players only');
  ok(slotAllows(either, pro) && slotAllows(either, college), 'a spot with no level takes either');
  ok(!slotAllows(cfbOnly, { pos: 'RB', team: '' }), 'no id cannot prove a college player');
  ok(slotFilterLabel(cfbOnly.flt) === 'CFB ONLY' && slotFilterLabel(nflOnly.flt) === 'NFL ONLY', 'levels read on the spot');
  const mixed = readFileSync(new URL('../supabase/migrations/0372_mixed_leagues.sql', import.meta.url), 'utf8');
  ok(/lvl not in \('nfl', 'college'\)/.test(mixed) && /jsonb_build_object\('level', lvl\)/.test(mixed), 'the SQL builder stores the same two levels');
}

// ── 7. college projections for the AI (0373) ──
{
  const line = (o) => ({ passYd: 0, passTd: 0, int: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, ...o });
  setCollegeProjections([
    { slug: 'c-1', line: line({ rushYd: 100, rushTd: 1, rec: 2, recYd: 20 }), has_game: true },   // 10+6+2+2 = 20 PPR
    { slug: 'c-2', line: line({ rushYd: 60, rec: 1, recYd: 10 }), has_game: true },               // 6+1+1 = 8
    { slug: 'c-3', line: line({ rushYd: 150, rushTd: 2 }), has_game: false },                     // 27, but no game
    { slug: 'c-4', line: null, has_game: true },                                                  // no season yet
    { slug: 'c-5', line: line({ rec: 5, recYd: 50 }), has_game: true },                           // a TE: 5+5 = 10
  ], 7);
  const P = (id, pos = 'RB') => ({ id, pos, team: '' });
  ok(projectedPoints(P('c-1')) === 20 && projectedPoints(P('c-2')) === 8, 'a college line projects its PPR points per game');
  ok(projectedPoints(P('c-4')) === 0, 'no qualifying season → no projection');
  setLeagueProjScoring({ teRec: 1 });
  ok(projectedPoints(P('c-5', 'TE')) === 15, 'the league\'s own catalog applies (TE premium: 10 → 15)');
  clearLeagueProjScoring();
  ok(collegeHasGame(7, 'c-3') === false && collegeHasGame(7, 'c-1') === true && collegeHasGame(8, 'c-1') === null, 'has-a-game is per week, unknown elsewhere');
  const val = slateAwareProj(7);
  ok(val(P('c-3')) === 0 && val(P('c-1')) === 20, 'no game this week is a bye: 27 → 0');
  const [flex] = classicSlotsFromSpec([{ pos: ['RB', 'WR', 'TE'] }]);
  const lu = optimalLineup([flex], [P('c-4'), P('c-3'), P('c-2'), P('c-1')], val);
  ok(lu.spots[0].player?.id === 'c-1', `THE POINT: the AI starts the best college player with a game (got ${lu.spots[0].player?.id})`);
  setCollegeProjections([], 7);
}

// ── 8. drafts (0379 / v0.554.0) ──
{
  setCollegeProjections([{ slug: 'c-9', line: { passYd: 0, passTd: 0, int: 0, rushYd: 100, rushTd: 1, rec: 2, recYd: 20, recTd: 0 } }]);
  ok(hasProjection('c-9') && projFor('c-9', 'RB') === 20 && projFor('c-10', 'RB') === null,
    'THE POINT: an installed college line is a projection the draft PROJ column can rank (20.0/g)');
  setCollegeProjections([]);
  const cfb = { slug: 'c-9', cls: 2 }, nfl = { slug: 'bijan-robinson' }, sr = { slug: 'c-8', cls: 5 };
  ok(levelClassMatch(cfb, 'cfb', new Set()) && !levelClassMatch(nfl, 'cfb', new Set()) && !levelClassMatch(cfb, 'nfl', new Set())
     && levelClassMatch(nfl, 'all', new Set()), 'NFL / CFB level filter');
  ok(levelClassMatch(cfb, 'all', new Set([2])) && !levelClassMatch(cfb, 'all', new Set([1])) && !levelClassMatch(nfl, 'all', new Set([2]))
     && levelClassMatch(sr, 'all', new Set([4])), 'class filter: sophomores; a class choice means college; 5th-years count as SR+');
  ok(poolSearchMatch({ full_name: 'Cam Ward', team: '', school: 'MIA' }, 'mia') && !poolSearchMatch({ full_name: 'X', team: 'KC', school: null }, 'mia'),
    'search finds a school');
  ok(['DL', 'LB', 'DB', 'FB', 'HC', 'P'].every((p) => DRAFT_POS_FILTERS.includes(p)), 'the draft position list carries IDP and the extras');
}

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE CHECKS PASS');
