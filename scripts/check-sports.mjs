// The sport spine (v0.564.0): every sport definition is complete and
// self-consistent, and the stat-line scorer, the categories comparison and
// the roto ranking do what the rulebook says. Run: npx tsx scripts/check-sports.mjs
import { SPORTS, SPORT_IDS, sportOf, sportDef, isDailySport, eligibleFor, slotAccepts, playerKey, parsePlayerKey } from '../packages/core/src/sports/index.ts';
import { readFileSync } from 'node:fs';
import { SPORT_WEEK_BASE } from '../packages/core/src/sports/league.ts';
import { SPORT_WEEK_BASE_LOCAL, weekTitle, weekLabel, boardWeekTitle } from '../packages/core/src/data/nflSlate.ts';
import { sumLines, normalizeScoring, linePoints, linesPoints, categoryTotals, categoryValue, categoryById, compareCategories, rotoStandings } from '../packages/core/src/sports/score.ts';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

// ── 1. every definition is complete ─────────────────────────────────────────
for (const id of SPORT_IDS) {
  const d = SPORTS[id];
  const statIds = new Set(d.stats.map((s) => s.id));
  ok(d.id === id && d.positions.length > 0 && d.slotTypes.length > 0, `${id}: has positions and slot types`);
  ok(d.slotTypes.every((s) => s.pos.every((p) => d.positions.includes(p))), `${id}: every slot type names known positions`);
  ok(Object.keys(d.defaultRoster).every((t) => d.slotTypes.some((s) => s.type === t)), `${id}: default roster uses known slot types`);
  ok(Object.values(d.posMap).flat().every((p) => d.positions.includes(p)), `${id}: position map lands on known positions`);
  ok(Object.keys(d.scoringDefault).every((k) => statIds.has(k)), `${id}: scoring defaults name known stats`);
  ok(d.categories.every((c) => (c.stat ? statIds.has(c.stat) : !!c.ratio)), `${id}: plain categories name known stats`);
  ok(d.categoriesDefault.every((c) => categoryById(d, c)), `${id}: default categories exist`);
  ok(new Set(d.stats.map((s) => s.id)).size === d.stats.length && new Set(d.categories.map((c) => c.id)).size === d.categories.length, `${id}: no duplicate stat or category ids`);
  const derived = d.derive({});
  ok(d.stats.filter((s) => s.derived).every((s) => s.id in derived), `${id}: derive() fills every derived stat`);
}
ok(sportOf(null) === 'nfl' && sportOf('nba') === 'nba' && sportOf({ sport: 'mlb' }) === 'mlb' && sportOf('golf') === 'nfl', 'sportOf defaults unknown to nfl');
ok(!isDailySport('nfl') && isDailySport('nba') && isDailySport('mlb') && sportDef(undefined).id === 'nfl', 'period model per sport');
ok(playerKey('nba', '1627759') === 'nba-1627759' && parsePlayerKey('nba-1627759')?.id === '1627759' && parsePlayerKey('c-4688380') === null && parsePlayerKey('josh-allen') === null, 'player keys parse, NFL and college slugs do not');
let threw = false; try { playerKey('mlb', 'abc'); } catch { threw = true; }
ok(threw, 'a non-numeric feed id is refused');
ok(slotAccepts('nba', 'G', ['SG', 'SF']) && !slotAccepts('nba', 'C', ['PG']) && slotAccepts('mlb', 'P', ['RP']) && !slotAccepts('nhl', 'nope', ['C']), 'slotAccepts by eligibility');
ok(eligibleFor('nba', 'zz').length === 0 && eligibleFor('mlb', 'TWP').includes('SP'), 'unknown codes map to nothing; two-way players pitch');

// ── 2. points ───────────────────────────────────────────────────────────────
const nba = SPORTS.nba;
const dd = { pts: 24, reb: 11, ast: 9, stl: 2, blk: 1, tov: 3, fgm: 10, fga: 20 };
ok(linePoints(nba, dd) === 24 + 11 * 1.2 + 9 * 1.5 + 2 * 3 + 1 * 3 - 3, 'NBA default points');
ok(nba.derive(dd).dd === 1 && nba.derive(dd).td === 0 && nba.derive({ pts: 10, reb: 10, ast: 10 }).td === 1, 'double- and triple-doubles derive');
ok(linePoints(nba, dd, normalizeScoring(nba, { dd: 5, bogus: 100, pts: '2' })) === 2 * 24 + 11 * 1.2 + 9 * 1.5 + 2 * 3 + 1 * 3 - 3 + 5, 'overrides apply, strings coerce, unknown knobs drop');
ok(linesPoints(nba, [dd, dd], normalizeScoring(nba, { dd: 5 })) === 2 * linePoints(nba, dd, normalizeScoring(nba, { dd: 5 })), 'linesPoints derives per game');
const nhl = SPORTS.nhl;
ok(linePoints(nhl, { g: 1, a: 1, ppa: 1, sog: 5, pm: 2 }) === 6 + 4 + 2 + 4.5 + 4, 'NHL: PPP derives from PPG+PPA and scores');
ok(linePoints(nhl, { w: 1, ga: 2, sv: 30 }) === 5 - 6 + 18, 'NHL goalie line');
const mlb = SPORTS.mlb;
const qs = mlb.derive({ gs: 1, outs: 18, er: 3, p_h: 5 });
ok(qs.qs === 1 && qs.ip === 6 && mlb.derive({ gs: 1, outs: 17, er: 0 }).qs === 0 && mlb.derive({ cg: 1, p_h: 0 }).nh === 1, 'MLB derives IP, QS, no-hitter');
ok(mlb.derive({ h: 3, '2b': 1, hr: 1 })['1b'] === 1 && mlb.derive({ h: 3, '2b': 1, hr: 1 }).tb === 1 + 2 + 4, 'MLB derives singles and total bases');
ok(linePoints(mlb, { h: 2, '2b': 1, hr: 1, r: 1, rbi: 3 }) === 5 + 10 + 2 + 6, 'MLB hitter points');
ok(linePoints(SPORTS.nfl, { passYds: 300 }) === 0, 'the NFL scores nothing through the generic table');

// ── 3. categories ───────────────────────────────────────────────────────────
const a = categoryTotals(nba, [{ fgm: 10, fga: 20, ftm: 5, fta: 10, pts: 25, tov: 3 }, { fgm: 0, fga: 10, ftm: 0, fta: 0, pts: 0, tov: 0 }]);
const b = categoryTotals(nba, [{ fgm: 5, fga: 10, ftm: 4, fta: 4, pts: 14, tov: 5 }]);
ok(categoryValue(categoryById(nba, 'fgpct'), a) === 0.333 && categoryValue(categoryById(nba, 'fgpct'), b) === 0.5, 'team FG% is made from summed makes and attempts');
const v = compareCategories(nba, a, b, ['pts', 'fgpct', 'ftpct', 'tov', 'reb']);
ok(v.cats.map((c) => c.result).join() === 'a,b,b,a,tie' && v.wins === 2 && v.losses === 2 && v.ties === 1 && v.winner === 'tie', `H2H cats: ${v.wins}-${v.losses}-${v.ties} (lower-is-better TO, 0-0 REB tie)`);
const noG = categoryTotals(nhl, [{ g: 1 }]);
const withG = categoryTotals(nhl, [{ w: 1, ga: 2, sv: 28, sa: 30, gtoi: 60 }]);
const gv = compareCategories(nhl, noG, withG, ['gaa', 'svpct', 'w']);
ok(gv.cats[0].result === 'tie' && gv.cats[1].result === 'tie' && gv.cats[2].result === 'b', 'a ratio nobody registered is a tie; GAA scales to 60 minutes');
ok(categoryValue(categoryById(nhl, 'gaa'), withG) === 2, 'GAA = GA × 60 / minutes');
const era = categoryTotals(mlb, [{ er: 3, outs: 27, p_h: 6, p_bb: 2, h: 8, ab: 30, bb: 3, hbp: 1, sf: 1 }]);
ok(categoryValue(categoryById(mlb, 'era'), era) === 3 && categoryValue(categoryById(mlb, 'whip'), era) === 0.89 && categoryValue(categoryById(mlb, 'obp'), era) === 0.343, 'ERA, WHIP and OBP from outs and on-base parts');

// ── 4. roto ─────────────────────────────────────────────────────────────────
const teams = [
  { id: 't1', totals: { hr: 30, sb: 5, er: 10, outs: 90 } },
  { id: 't2', totals: { hr: 20, sb: 5, er: 5, outs: 90 } },
  { id: 't3', totals: { hr: 10, sb: 9, er: 20, outs: 90 } },
  { id: 't4', totals: { hr: 5, sb: 1, er: 0, outs: 0 } },
];
const roto = rotoStandings(mlb, teams, ['hr', 'sb', 'era']);
const row = (id) => roto.find((r) => r.id === id);
ok(row('t1').cats.hr.points === 4 && row('t4').cats.hr.points === 1, 'best HR takes N, worst takes 1');
ok(row('t1').cats.sb.points === 2.5 && row('t2').cats.sb.points === 2.5 && row('t3').cats.sb.points === 4, 'a tie splits the places it spans');
ok(row('t4').cats.era.points === 1 && row('t2').cats.era.points === 4, 'no innings pitched is last in ERA; lowest ERA is first');
ok(roto[0].id === 't1' || roto[0].id === 't2', `standings lead: ${roto[0].id} with ${roto[0].total}`);
ok(sumLines([{ a: 1 }, { a: 2, b: 1 }]).a === 3, 'sumLines');

// ── 5. the database names the same sports ───────────────────────────────────
const sql = readFileSync(new URL('../supabase/migrations/0396_sports.sql', import.meta.url), 'utf8');
const inList = /sport in \(([^)]*)\)/.exec(sql)?.[1]?.match(/'([a-z]+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];
ok(inList.join() === SPORT_IDS.join(), `league.sport's check list is SPORT_IDS (${inList.join(', ')})`);

ok(SPORT_WEEK_BASE_LOCAL === SPORT_WEEK_BASE && weekTitle(301) === 'WEEK 1' && weekLabel(304) === 'WK 4' && boardWeekTitle(310) === 'WEEK 10' && weekTitle(5) === 'WEEK 5', 'sport weeks title from 301 as week 1; the slate\'s base is core\'s');

console.log(fails ? `\n${fails} FAILED` : '\nall sport checks passed');
process.exit(fails ? 1 : 0);
