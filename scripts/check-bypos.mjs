// SCORING BY POSITION (v0.532.0) — classic leagues.
//
// Founder: "What would it take to have very fine grained scoring options. Like
// a tackle for QB at 50 points and a tackle for a WR at 20 points? Maybe scope
// it as per position specific metric bonuses?" … "yeah, not for drip leagues."
//
// Pins: the override map is parsed and clamped the same way everywhere; the
// live scorer and the projection read the SAME merged table; the new offensive
// tackle knob pays nothing by default (no league's score moves); and the feed
// credits the passing side's tacklers on an interception return.
// Run: tsx scripts/check-bypos.mjs
import { readFileSync } from 'node:fs';
import {
  parseByPos, scoringFor, normalizeClassicScoring, classicPointsFrom, byPosKeys, byPosSummary,
  DEFAULT_CLASSIC_SCORING, BYPOS_SECTIONS,
} from '../packages/core/src/engine/classic';
import { setLeagueProjScoring, clearLeagueProjScoring, leagueProjRatio, leagueCatalogOf } from '../packages/core/src/engine/projScoring';
import { gameToRealPlays } from './espn/espnAdapter.mjs';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const play = (kind, o = {}) => ({ clock: 100, kind, yards: 0, td: false, catch: false, target: false, ...o });
const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos) => ({ id, name: id, full: id, pos, team: '', stats: { ...ZERO } });

// ── parsing ────────────────────────────────────────────────────────────────
const bp = parseByPos({ qb: { offTackle: '50', passYd: 9, idpTackle: 3, bogus: 1 }, WR: { offTackle: 20, recTd: 500 }, ZZ: { offTackle: 1 }, TE: {} });
ok('positions are upper-cased; unknown positions dropped', bp && 'QB' in bp && 'WR' in bp && !('ZZ' in bp) && !('TE' in bp), bp);
ok('a QB override keeps offense keys, drops IDP and junk keys', bp.QB.offTackle === 50 && !('idpTackle' in bp.QB) && !('bogus' in bp.QB), bp.QB);
ok('per-yard overrides clamp to [-1, 2]', bp.QB.passYd === 2, bp.QB.passYd);
ok('event overrides clamp to [-50, 100]', bp.WR.recTd === 100, bp.WR.recTd);
ok('an empty map parses to null', parseByPos({}) === null && parseByPos(null) === null && parseByPos({ QB: { passTd: '' } }) === null);
ok('every position offers something to override', Object.keys(BYPOS_SECTIONS).every((p) => byPosKeys(p).size > 0));
ok('IDP positions offer the IDP tackle, not the offensive one', byPosKeys('LB').has('idpTackle') && !byPosKeys('LB').has('offTackle'));
ok('offense positions offer the offensive tackle', ['QB', 'RB', 'WR', 'TE', 'FB'].every((p) => byPosKeys(p).has('offTackle')));

// ── the founder's example ───────────────────────────────────────────────────
const league = normalizeClassicScoring({ byPos: { QB: { offTackle: 50 }, WR: { offTackle: 20 } } });
const tackle = [play('tackle', { tt: 's' })];
ok('a QB tackle pays 50', classicPointsFrom(tackle, mk('some-qb', 'QB'), league) === 50, classicPointsFrom(tackle, mk('some-qb', 'QB'), league));
ok('a WR tackle pays 20', classicPointsFrom(tackle, mk('some-wr', 'WR'), league) === 20);
ok('an RB tackle pays the league value (0 by default)', classicPointsFrom(tackle, mk('some-rb', 'RB'), league) === 0);
ok('with no overrides an offensive tackle pays nothing — no league moves', classicPointsFrom(tackle, mk('some-qb', 'QB'), normalizeClassicScoring({})) === 0);
ok('a defender\'s tackle is untouched by the QB/WR overrides', classicPointsFrom(tackle, mk('some-lb', 'LB'), league)
  === classicPointsFrom(tackle, mk('some-lb', 'LB'), normalizeClassicScoring({})));
ok('the offensive knob default is 0', DEFAULT_CLASSIC_SCORING.offTackle === 0);

// ── any stat, any position ─────────────────────────────────────────────────
const passTd = [play('pass', { yards: 20, td: true, cmp: true })];
const six = normalizeClassicScoring({ byPos: { QB: { passTd: 6 } } });
ok('an override replaces the league value for that position only', classicPointsFrom(passTd, mk('qb', 'QB'), six)
  - classicPointsFrom(passTd, mk('qb', 'QB'), normalizeClassicScoring({})) === 2);
const lbOnly = normalizeClassicScoring({ byPos: { LB: { idpTackle: 3 } } });
ok('an LB-only tackle value leaves DBs on the league value', classicPointsFrom(tackle, mk('lb', 'LB'), lbOnly) > classicPointsFrom(tackle, mk('db', 'DB'), lbOnly));
ok('scoringFor answers the same table object each time (memoised)', scoringFor(league, 'QB') === scoringFor(league, 'QB'));
ok('a position with no overrides gets the league table itself', scoringFor(league, 'TE') === league);
ok('the summary reads back what was set', byPosSummary(league.byPos).map((r) => `${r.pos}:${r.key}=${r.value}`).join() === 'QB:offTackle=50,WR:offTackle=20',
  byPosSummary(league.byPos));

// ── projection and live read the same table ────────────────────────────────
// A QB whose passing TDs are worth more in THIS position must project higher,
// by the same override the live scorer applies.
const cat = leagueCatalogOf({ scoring: { byPos: { QB: { passTd: 8 } } }, ppr: 1 });
setLeagueProjScoring(cat);
const qbRatio = leagueProjRatio('josh-allen', 'QB');
const wrRatio = leagueProjRatio('jamarr-chase', 'WR');
clearLeagueProjScoring();
ok('a QB-only override raises a QB projection', qbRatio > 1.01, qbRatio);
ok('…and leaves a WR projection alone', Math.abs(wrRatio - 1) < 1e-9, wrRatio);

// ── the feed credits the passer's side on an INT return ───────────────────
const summary = {
  header: { id: '401', competitions: [{ competitors: [{ id: '1', team: { abbreviation: 'BUF' } }, { id: '2', team: { abbreviation: 'NYJ' } }] }] },
  boxscore: { players: [
    { team: { abbreviation: 'BUF' }, statistics: [{ name: 'passing', athletes: [{ athlete: { id: 'a1', displayName: 'Josh Allen' } }] }] },
    { team: { abbreviation: 'NYJ' }, statistics: [{ name: 'interceptions', athletes: [{ athlete: { id: 'b1', displayName: 'Sauce Gardner' } }] }] },
  ] },
  drives: { previous: [{ plays: [{
    id: '4011', type: { text: 'Pass Interception Return' }, period: { number: 2 }, clock: { displayValue: '5:00' },
    start: { team: { id: '1' }, down: 2, distance: 7 }, teamParticipants: [{ type: 'offense', id: '1' }, { type: 'defense', id: '2' }],
    isTurnover: true, statYardage: 0,
    text: 'J.Allen pass short left INTERCEPTED by S.Gardner at NYJ 30. S.Gardner to BUF 40 for 30 yards (J.Allen).',
  }] }] },
};
const pbp = gameToRealPlays(summary);
const allen = (pbp['josh-allen'] ?? []).map((r) => r.k ?? r.kind);
ok('the QB who made the tackle on the return gets a tackle row', allen.includes('tackle'), allen);
const gardner = (pbp['sauce-gardner'] ?? []).map((r) => r.k ?? r.kind);
ok('…and the returner is not credited with tackling himself', !gardner.includes('tackle'), gardner);

// ── the server keeps what the editors send ────────────────────────────────
const mig = readFileSync(new URL('../supabase/migrations/0362_scoring_by_position.sql', import.meta.url), 'utf8');
ok('set_league_classic_scoring stores byPos', /jsonb_build_object\('byPos', bp\)/.test(mig));
ok('…and knows the offensive tackle knob', /'offTackle'/.test(mig));

if (fails) { console.log(`\n${fails} BY-POSITION ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL BY-POSITION ASSERTIONS PASSED');
