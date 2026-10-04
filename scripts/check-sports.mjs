// The sport spine (v0.616.0): every sport definition is complete and
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
const sql = readFileSync(new URL('../supabase/migrations/0424_sports.sql', import.meta.url), 'utf8');
const inList = /sport in \(([^)]*)\)/.exec(sql)?.[1]?.match(/'([a-z]+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];
ok(inList.join() === SPORT_IDS.join(), `league.sport's check list is SPORT_IDS (${inList.join(', ')})`);

ok(SPORT_WEEK_BASE_LOCAL === SPORT_WEEK_BASE && weekTitle(301) === 'WEEK 1' && weekLabel(304) === 'WK 4' && boardWeekTitle(310) === 'WEEK 10' && weekTitle(5) === 'WEEK 5', 'sport weeks title from 301 as week 1; the slate\'s base is core\'s');

// ── 6. the lineup builder's positions and the card ──────────────────────────
{
  const sql403 = readFileSync(new URL('../supabase/migrations/0431_sport_lineup_and_card.sql', import.meta.url), 'utf8');
  for (const id of ['nba', 'wnba', 'nhl', 'mlb']) {
    const m = new RegExp(`when '${id}'\\s+then array\\[([^\\]]*)\\]`).exec(sql403);
    const list = m ? m[1].match(/'([A-Z0-9]+)'/g).map((x) => x.replace(/'/g, '')) : [];
    ok(list.join() === SPORTS[id].positions.join(), `${id}: sport_positions() is the SportDef's list (${list.join(' ')})`);
  }
  const { seasonCardStats, gameCardStats, cardGroup, seasonPoints, seasonLine } = await import('../packages/core/src/sports/card.ts');
  const nbaSeason = seasonCardStats(SPORTS.nba, { gp: 10, pts: 250, reb: 100, ast: 50, stl: 10, blk: 5, tpm: 20, tov: 30, fgm: 90, fga: 200, ftm: 50, fta: 60, min: 340 });
  ok(nbaSeason.find((c) => c.short === 'PTS/G')?.value === '25' && nbaSeason.find((c) => c.short === 'FG%')?.value === '0.450', `NBA season card: ${nbaSeason.map((c) => `${c.short} ${c.value}`).join(' · ')}`);
  const goalie = seasonCardStats(SPORTS.nhl, { gapp: 20, gs: 19, w: 12, l: 6, otl: 2, ga: 50, sv: 500, sa: 550, so: 2, gtoi: 1180 }, 'G');
  ok(cardGroup(SPORTS.nhl, null, 'G') === 'goalie' && goalie.find((c) => c.short === 'W')?.value === '12' && goalie.find((c) => c.short === 'GAA')?.value === '2.54' && goalie.find((c) => c.short === 'SV%')?.value === '0.909', `NHL goalie card: ${goalie.map((c) => `${c.short} ${c.value}`).join(' · ')}`);
  const pitcher = seasonCardStats(SPORTS.mlb, { pgp: 30, gs: 30, outs: 540, w: 15, l: 6, p_k: 200, er: 60, p_h: 150, p_bb: 40 });
  ok(cardGroup(SPORTS.mlb, { pgp: 30, outs: 540 }) === 'pitcher' && pitcher.find((c) => c.short === 'ERA')?.value === '3.00' && pitcher.find((c) => c.short === 'IP/G')?.value === '6', `MLB pitcher card: ${pitcher.map((c) => `${c.short} ${c.value}`).join(' · ')}`);
  ok(goalie.find((c) => c.short === 'SV/G')?.value === '25' && goalie.find((c) => c.short === 'SHO')?.value === '2', 'a goalie\'s saves are per game, his shutouts a total');
  const hitter = seasonCardStats(SPORTS.mlb, { hgp: 150, ab: 500, h: 150, bb: 60, hbp: 5, sf: 5, hr: 30, r: 90, rbi: 100, sb: 10, k: 120, '2b': 30, '3b': 2 });
  ok(hitter.find((c) => c.short === 'AVG')?.value === '0.300' && hitter.find((c) => c.short === 'OBP')?.value === '0.377', `MLB hitter card: AVG ${hitter.find((c) => c.short === 'AVG')?.value} OBP ${hitter.find((c) => c.short === 'OBP')?.value}`);
  ok(pitcher.find((c) => c.short === 'WHIP')?.value === '1.06' && pitcher.find((c) => c.short === 'QS')?.value === '—', 'WHIP from the season line; a quality-start count the source never had is unknown, not derived');
  const withQs = seasonCardStats(SPORTS.mlb, { pgp: 30, gs: 30, outs: 540, er: 60, p_h: 150, p_bb: 40, qs: 20 });
  ok(withQs.find((c) => c.short === 'QS')?.value === '20', 'a stored quality-start count shows as a total');
  const nbaLine = { gp: 10, pts: 250, reb: 100, ast: 50, stl: 10, blk: 5, tov: 30, dd: 6, td: 1 };
  ok(seasonLine(SPORTS.nba, nbaLine).dd === 6 && seasonPoints(SPORTS.nba, nbaLine, { pts: 1, dd: 5, td: 10 }) === 250 + 30 + 10, 'a season\'s double-doubles are the stored count, not derived from totals, and score as such');
  const game = gameCardStats(SPORTS.nba, { pts: 31, reb: 12, ast: 4, stl: 0, blk: 2, tpm: 3, tov: 1, fgm: 12, fga: 20 });
  ok(game.map((c) => c.short).join() === 'PTS,REB,AST,BLK,3PM,TO' && game[0].value === '31', 'a game line shows its non-zero counting stats, no ratios');
}

// ── 7. the sports flag gates the one door ───────────────────────────────────
{
  const sql404 = readFileSync(new URL('../supabase/migrations/0432_sports_flag.sql', import.meta.url), 'utf8');
  ok(/create or replace function has_sports\(\)/.test(sql404) && /features \? 'sports'/.test(sql404), 'has_sports() reads the sports feature, admins pass');
  ok(/if sp <> 'nfl' and not has_sports\(\) then/.test(sql404) && /create or replace function create_native_league\(/.test(sql404), 'create_native_league refuses a daily sport without the flag');
  const web = readFileSync(new URL('../src/screens/NativeLeague.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../apps/mobile/src/screens/Recruit.tsx', import.meta.url), 'utf8');
  ok(/kind === 'league' && sportsOn &&/.test(web) && /f\.sports === true/.test(web), 'the web create form shows WHICH SPORT to flag holders and admins only');
  ok(/sportsOn && <LabelInfo label="WHICH SPORT\?"/.test(app) && /f\.sports === true/.test(app), 'the app create flow shows WHICH SPORT to flag holders and admins only');
}

// ── v0.629.0: best ball and scoped spots for a daily sport ───────────────────
{
  const { SPORT_FORMATS, SPORT_FORMAT_LABEL, isSeasonFormat, sportSettingsOf, sportRosterSlots, sportRelabelSlots, sportAddSlot, sportRemoveSlot, sportSlotTypeOf, sportSpotScopeLabel, sportHasTenure } = await import('../packages/core/src/sports/league.ts');
  const { leagueBestball, classicSlotsFromSpec, slotAllows, assignByValue } = await import('../packages/core/src/engine/classic.ts');
  ok(SPORT_FORMATS.join() === 'points,cats,roto,season' && SPORT_FORMAT_LABEL.season === 'SEASON POINTS' && isSeasonFormat('roto') && isSeasonFormat('season') && !isSeasonFormat('points'), 'four formats; roto and season are the schedule-less ones');
  ok(sportSettingsOf({ sport: { period_start: '2026-10-19', format: 'season' } }).format === 'season' && sportSettingsOf({ sport: { period_start: '2026-10-19', format: 'bogus' } }).format === 'points', 'the season format reads back; an unknown one is points');
  // the spot spec is the NFL SlotSpec's keys, so the board's own helpers read it
  const spec = [{ pos: ['PG', 'SG'], label: 'G', bb: true }, { pos: ['C'], label: 'C', teams: ['BOS', 'LAL'] }, { pos: ['PG', 'SG', 'SF', 'PF', 'C'], label: 'UTIL', max_exp: 0 }];
  ok(leagueBestball({ slots: spec }).join() === 'S1', 'leagueBestball sees a sport spot\'s bb flag');
  const defs = classicSlotsFromSpec(spec);
  ok(defs[1].flt?.teams?.join() === 'BOS,LAL' && defs[2].flt?.max_exp === 0 && !defs[0].flt, 'classicSlotsFromSpec carries the team and tenure scope');
  ok(slotAllows(defs[1], { pos: 'C', team: 'BOS' }) && !slotAllows(defs[1], { pos: 'C', team: 'MIA' }) && slotAllows(defs[2], { pos: 'SF', team: 'MIA', exp: 0 }) && !slotAllows(defs[2], { pos: 'SF', team: 'MIA', exp: 3 }) && !slotAllows(defs[2], { pos: 'SF', team: 'MIA', exp: null }), 'the board\'s slotAllows applies the scope to a sport player (unknown tenure refused)');
  ok(sportSpotScopeLabel(spec[1]) === 'BOS/LAL' && sportSpotScopeLabel(spec[2]) === 'ROOKIES ONLY' && sportSpotScopeLabel({ min_exp: 5 }) === '5+ YRS' && sportSpotScopeLabel({ min_exp: 1, max_exp: 3 }) === '1–3 YRS' && sportSpotScopeLabel(spec[0]) === '', 'scope labels');
  ok(sportHasTenure('nba') && sportHasTenure('mlb') && !sportHasTenure('nhl') && !sportHasTenure('wnba'), 'tenure is known for the NBA and MLB only');
  // the builder's spot list
  const nba = SPORTS.nba;
  ok(sportSlotTypeOf(nba, ['SG', 'PG'])?.type === 'G' && sportSlotTypeOf(nba, ['PG', 'C']) === null, 'a spot\'s slot type by its eligibility set');
  const base = sportRosterSlots(nba);
  const plus = sportAddSlot(nba, base, 'G');
  ok(plus.length === base.length + 1 && plus.filter((s) => s.label.startsWith('G')).map((s) => s.label).join() === 'G1,G2' && plus.indexOf(plus.find((s) => s.label === 'G2')) === base.findIndex((s) => s.label === 'G') + 1, `adding a G puts G2 after G1: ${plus.map((s) => s.label).join(' ')}`);
  const minus = sportRemoveSlot(nba, plus, 'G');
  ok(minus.length === base.length && minus.map((s) => s.label).join() === base.map((s) => s.label).join(), 'removing it restores the labels');
  const flagged = sportRelabelSlots(nba, [{ pos: ['C'], label: 'x', bb: true, teams: ['BOS'] }, { pos: ['C'], label: 'y' }]);
  ok(flagged.map((s) => s.label).join() === 'C1,C2' && flagged[0].bb === true && flagged[0].teams.join() === 'BOS' && flagged[1].bb === undefined, 'relabelling keeps every spot\'s flags');
  ok(sportRelabelSlots(nba, [{ pos: ['PG', 'C'], label: '' }])[0].label === 'C/PG' && sportRemoveSlot(nba, base, 'ZZ') === base, 'a custom set keeps its joined codes; removing a type the lineup lacks is a no-op');
  // the fill's matching: fill every spot you can, then maximize
  const held = assignByValue(2, 3, [[10, -Infinity, 8], [9, -Infinity, 7]]);
  ok(held.join() === '0,2' || held.join() === '2,0', `assignByValue seats two of three (${held.join(',')})`);
  // the database accepts exactly these keys
  const sql = readFileSync(new URL('../supabase/migrations/0436_sport_bestball_and_scope.sql', import.meta.url), 'utf8');
  ok(/spot -> 'bb'/.test(sql) && /spot -> 'teams'/.test(sql) && /spot -> 'min_exp'/.test(sql) && /spot -> 'max_exp'/.test(sql), 'set_sport_lineup reads bb, teams, min_exp and max_exp');
  ok(/'points', 'cats', 'roto', 'season'/.test(sql), 'set_sport_settings accepts the season format');
  ok(/coalesce\(nr\.spot, 'active'\) = 'active'/.test(sql) && /s\.played/.test(sql), 'the day-lines RPC reads active roster spots and the played flag');
}

console.log(fails ? `\n${fails} FAILED` : '\nall sport checks passed');
process.exit(fails ? 1 : 0);

// ── v0.625.0: the vocabulary and the board's slate helper ───────────────────
{
  const { sportGameFor, sportEntryState, sportKickLabel, sportOpponentLabel, sportToday } = await import('../packages/core/src/sports/slate.ts');
  for (const id of SPORT_IDS) {
    const v = SPORTS[id].vocab;
    ok(v && ['start', 'starts', 'started', 'slate', 'noGame'].every((k) => typeof v[k] === 'string' && v[k].length > 0), `${id}: a full vocabulary`);
    ok(v.slate === `${SPORTS[id].league} SLATE`, `${id}: the slate chip names the league`);
  }
  ok(SPORTS.nfl.vocab.start === 'kickoff' && SPORTS.nba.vocab.start === 'tip-off' && SPORTS.nhl.vocab.start === 'puck drop' && SPORTS.mlb.vocab.start === 'first pitch', 'the four words');
  const games = [
    { game_id: 'a', game_date: '2026-10-06', start_utc: '2026-10-06T23:00:00Z', status: 'pre', away: 'BOS', home: 'TOR', away_score: null, home_score: null, clock: null },
    { game_id: 'b', game_date: '2026-10-08', start_utc: '2026-10-08T23:30:00Z', status: 'pre', away: 'TOR', home: 'MTL', away_score: null, home_score: null, clock: null },
    { game_id: 'c', game_date: '2026-10-06', start_utc: '2026-10-06T17:00:00Z', status: 'final', away: 'NYY', home: 'BOS', away_score: 3, home_score: 5, clock: null },
    { game_id: 'd', game_date: '2026-10-06', start_utc: '2026-10-06T23:00:00Z', status: 'pre', away: 'NYY', home: 'BOS', away_score: null, home_score: null, clock: null },
    { game_id: 'e', game_date: '2026-10-07', start_utc: null, status: 'postponed', away: 'CHI', home: 'DET', away_score: null, home_score: null, clock: null },
  ];
  const today = '2026-10-06';
  const tor = sportGameFor('TOR', games, today);
  ok(tor && tor.today && tor.home && tor.opponent === 'BOS' && sportOpponentLabel(tor) === 'vs BOS', 'today\'s game wins, home side read');
  ok(sportKickLabel(tor) === '7p', `today's game prints the time (${sportKickLabel(tor)})`);
  const mtl = sportGameFor('MTL', games, today);
  ok(mtl && !mtl.today && mtl.date === '2026-10-08' && sportKickLabel(mtl) === 'Thu 7:30p', `no game today → the next one in the period (${sportKickLabel(mtl)})`);
  const bos = sportGameFor('BOS', games, today);
  ok(bos && bos.gameId === 'd', 'a doubleheader: the game not yet final is the one the row talks about');
  ok(sportGameFor('CHI', games, today) === null && sportGameFor('', games, today) === null, 'postponed games and blank teams give nothing');
  ok(sportEntryState(tor, Date.parse('2026-10-06T22:00:00Z')) === 'pre' && sportEntryState(tor, Date.parse('2026-10-06T23:01:00Z')) === 'live', 'pre until the start passes, then live even before the poll');
  ok(sportEntryState(sportGameFor('NYY', games.slice(2, 3), today), Date.now()) === 'done' && sportEntryState(mtl, Date.now()) === 'pre', 'final is done; a later day is pre');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(sportToday()), 'sportToday is an ISO date');
}

// ── v0.626.0: the replay clock ──────────────────────────────────────────────
{
  const { sportLeagueSettings, sportSettingsOf, sportNow, daysBetween, priorSeason } = await import('../packages/core/src/sports/league.ts');
  ok(daysBetween('2025-08-04', '2026-08-03') === 364 && daysBetween('2026-10-05', '2026-10-01') === -4, 'daysBetween counts whole days, signed');
  const live = sportLeagueSettings('mlb', { periodStart: '2026-10-07' });
  ok(!live.sport.replay, 'a live league has no replay block');
  const rp = sportLeagueSettings('mlb', { periodStart: '2025-08-04', replay: { season: '2025', anchor: '2026-10-07' } });
  ok(rp.sport.replay?.season === '2025' && rp.sport.replay?.offset_days === daysBetween('2025-08-04', '2026-10-05'), `a replay stores the season and the offset to this week's Monday (${rp.sport.replay?.offset_days}d)`);
  const parsed = sportSettingsOf(rp);
  ok(parsed?.replay?.offset_days === rp.sport.replay?.offset_days && sportSettingsOf(live)?.replay === null, 'the block round-trips; absent reads null');
  const real = new Date('2026-10-07T23:00:00Z');
  ok(sportNow(parsed, real).getTime() === real.getTime() - rp.sport.replay.offset_days * 86400e3 && sportNow(sportSettingsOf(live), real).getTime() === real.getTime(), 'sportNow shifts a replay league and leaves a live one alone');
  ok(priorSeason('mlb', new Date('2026-10-04T12:00:00Z')) === '2025' && priorSeason('nhl', new Date('2026-10-04T12:00:00Z')) === '2025' && priorSeason('nba', new Date('2026-03-01T12:00:00Z')) === '2024', 'priorSeason is the season before the current one');
}

// ── v0.627.0: the sport market on the client ────────────────────────────────
{
  const { installSportMarket, clearSportMarket, sportAdpFor, sportPpgFor, sportWeekProjFor, sportSeasonProjFor, sportGamesLeftThisWeek } = await import('../packages/core/src/sports/market.ts');
  const { adpFor, projFor } = await import('../packages/core/src/data/poolSort.ts');
  const nba = SPORTS.nba;
  installSportMarket(nba, { pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, tov: -1 }, {
    ok: true, today: '2026-10-07',
    rows: [
      { slug: 'nba-1', adp: 1.6, gp: 70, season_line: { pts: 2100, reb: 840, ast: 700, stl: 70, blk: 70, tov: 210 }, team: 'DEN' },
      { slug: 'nba-2', adp: null, gp: 0, season_line: null, team: 'LAL' },
      { slug: 'nba-3', adp: 12.5, gp: 10, season_line: { pts: 100 }, team: 'BOS' },
    ],
    week_games: { DEN: ['2026-10-05', '2026-10-07', '2026-10-09'], LAL: ['2026-10-06'] },
    season_left: { DEN: 80, LAL: 79 },
    calendar: true, adp_at: '2026-10-04T00:00:00Z',
  });
  const ppg = (2100 + 840 * 1.2 + 700 * 1.5 + 70 * 3 + 70 * 3 - 210) / 70;
  ok(Math.abs((sportPpgFor('nba-1') ?? 0) - ppg) < 1e-9, `per-game rate under the league's table (${ppg.toFixed(2)})`);
  ok(sportGamesLeftThisWeek('nba-1').join() === '2026-10-07,2026-10-09' && Math.abs((sportWeekProjFor('nba-1') ?? 0) - 2 * ppg) < 1e-9, 'this week: the games on or after today');
  ok(Math.abs((sportSeasonProjFor('nba-1') ?? 0) - 80 * ppg) < 1e-9, 'the season: games left × the rate');
  ok(sportPpgFor('nba-2') === null && sportWeekProjFor('nba-2') === null && sportAdpFor('nba-2') === null, 'no line, no games: null, not 0');
  ok(sportWeekProjFor('nba-3') === 0 && sportSeasonProjFor('nba-3') === null, 'a team with no dates left this week projects 0; no calendar row → null season');
  ok(adpFor('nba-1') === 1.6 && Math.abs((projFor('nba-1', 'C') ?? 0) - ppg) < 1e-9, 'poolSort routes sport keys to the sport market');
  ok(adpFor('josh-allen') !== 1.6, 'an NFL slug never reads the sport market');
  clearSportMarket();
  ok(sportAdpFor('nba-1') === null, 'cleared with the league');
}
console.log('ALL SPORT CHECKS PASSED');
