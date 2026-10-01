// THE DEVY PLAYER CARD (0406), pinned against real ESPN responses (trimmed,
// Oct 1 2026: Jeremiah Smith, WR Ohio State; Arch Manning's game log for the
// QB line) and a real StatHead devy-board row. Offline.
import { readFileSync } from 'node:fs';
import {
  parseCollegeBio, parseCollegeOverview, parseCollegeGameLog, collegePprPoints, collegeStatLine,
  statheadEvalRows, collegeSeasonOf,
} from '../packages/core/src/data/collegeCard.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const fx = (f) => JSON.parse(readFileSync(new URL(`./espn/college-card/${f}`, import.meta.url), 'utf8'));

// ── bio ──
const bio = parseCollegeBio(fx('bio-wr.json'));
ok(bio.height === '6\' 4"' && bio.weight === '222 lbs', `height and weight (${bio.height}, ${bio.weight})`);
ok(bio.hometown === 'Miami Gardens, FL' && bio.classLabel === 'JR' && bio.jersey === '4' && bio.active, 'hometown, class, jersey, active');
ok(/5079720\.png$/.test(bio.headshot ?? ''), 'and his headshot');

// ── seasons, news, next game ──
const ov = parseCollegeOverview(fx('overview-wr.json'), 'WR');
ok(ov.seasons.map((s) => s.season).join(',') === '2026,2025,2024', `a line for every college season (${ov.seasons.map((s) => s.season)})`);
// 2025: 87 rec, 1,243 yd, 12 TD; 3 rush for 21, 1 TD → 87 + 124.3 + 72 + 2.1 + 6 = 291.4
ok(ov.seasons[1].pts === 291.4, `2025 PPR from the thousands-separated line: ${ov.seasons[1].pts}`);
ok(ov.seasons[1].line === '87 rec 1243 yd 12 TD · 3 ru 21 yd 1 TD', `a receiver's line leads with receiving: ${ov.seasons[1].line}`);
ok(ov.news.length === 3 && ov.news[0].headline && /^https:\/\/www\.espn\.com\//.test(ov.news[0].url ?? ''), 'news with links');
ok(ov.next?.short === 'OSU @ IOWA', `the next game: ${ov.next?.short}`);

// ── game log ──
const gl = parseCollegeGameLog(fx('gamelog-wr.json'), 'WR');
ok(gl.length === 3 && gl.every((g, i) => i === 0 || String(g.date) <= String(gl[i - 1].date)), 'one row a game, newest first');
const ill = gl.find((g) => g.opp === 'ILL');
ok(ill && ill.pts === 57.7 && ill.line === '12 rec 217 yd 4 TD' && ill.result === 'W' && ill.score === '42-19' && ill.atVs === 'vs',
  `12 rec 217 yd 4 TD vs ILL is 57.7 PPR (${ill?.pts}, ${ill?.line})`);
const qb = parseCollegeGameLog(fx('gamelog-qb.json'), 'QB');
ok(qb.length > 0 && /^\d+\/\d+ \d+ yd \d+ TD \d+ INT · \d+ ru -?\d+ yd/.test(qb[0].line), `a QB's line leads with passing: ${qb[0]?.line}`);

// ── points and lines, by hand ──
ok(collegePprPoints({ passingYards: 300, passingTouchdowns: 3, interceptions: 1, rushingYards: 40, fumblesLost: 1 }) === 24,
  '300 pass yd, 3 TD, 1 INT, 40 rush yd, a lost fumble = 12 + 12 − 2 + 4 − 2 = 24');
ok(collegeStatLine('RB', { rushingAttempts: 20, rushingYards: 110, rushingTouchdowns: 2, receptions: 3, receivingYards: 25 })
  === '20 ru 110 yd 2 TD · 3 rec 25 yd', 'a back\'s line leads with rushing');
ok(collegeStatLine('WR', {}) === 'no offensive stats', 'and an empty line says so');

// ── StatHead's evaluation ──
const card = fx('stathead-card-wr.json');
const ev = statheadEvalRows(card, 'WR', '1qb');
const by = Object.fromEntries(ev.map((r) => [r.label, r.value]));
ok(by['DEVY RANK'] === '#1 overall · WR1 · 2027 class', `rank: ${by['DEVY RANK']}`);
ok(by['PRICES AS'] === 'a 2027 Early 1st rookie pick', `rookie-draft slot: ${by['PRICES AS']}`);
ok(/^Generational · projected pick 3$/.test(by['NFL TIER'] ?? ''), `NFL tier: ${by['NFL TIER']}`);
ok(/^17\.0 PPR\/g/.test(by['NFL OUTLOOK'] ?? '') && /top 1%/.test(by['NFL OUTLOOK']), `outlook: ${by['NFL OUTLOOK']}`);
ok(/breakout 18\.9/.test(by.PROFILE ?? '') && /dominator 36%/.test(by.PROFILE) && /★★★★★ recruit/.test(by.PROFILE), `profile: ${by.PROFILE}`);
ok(/3 college seasons with stats/.test(by.AGE ?? ''), `age: ${by.AGE}`);
ok(!JSON.stringify(ev).match(/market|ktc|keeptradecut/i), 'nothing on the panel is a third-party number or names one');
ok(statheadEvalRows(null, 'WR').length === 0, 'no profile, no panel');

// ── the season a date belongs to ──
ok(collegeSeasonOf(new Date('2026-10-01T00:00:00Z')) === 2026 && collegeSeasonOf(new Date('2027-01-10T00:00:00Z')) === 2026,
  'October and the January bowls are one college season');

// v0.585.0: nothing filled in — a missing number is a dash, never a 0
{
  const cc = await import('../packages/core/src/data/collegeCard.ts');
  const m = cc.statMap(['receptions', 'receivingYards', 'receivingTouchdowns'], ['5', '-', '1']);
  ok(m.receptions === 5 && !('receivingYards' in m), 'ESPN\'s "-" is missing, not zero');
  ok(cc.collegeStatLine('WR', m) === '5 rec — yd 1 TD', 'a missing number in a line reads —', cc.collegeStatLine('WR', m));
  ok(cc.collegePprPoints({}) === null && cc.collegePprPoints({ receptions: 2 }) === 2, 'no scoring stats → no points, not 0');
  const strip = Object.fromEntries(cc.collegeFactStrip({ ok: true, stathead: { rank_1qb: 12, rank_sf: null }, market: { price: 1, rank: null } }, null, 'sf'));
  ok(strip['DEVY #'] === '—' && strip.PRICE === '—', 'superflex never borrows the 1QB rank; an unpriced player has no price', strip);
  const rows = cc.storedSeasonRows({ ok: true, seasons: [{ season: 2025, gp: 3, pass_yds: null, pass_td: null, ints: null, rush_yds: 120, rush_td: null, rec: null, rec_yds: null, rec_td: null }] });
  ok(rows[0].line === '3 G · 120 ru yd' && rows[0].pts === 12, 'stored lines keep their nulls', rows[0]);
}

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE-CARD CHECKS PASS');
