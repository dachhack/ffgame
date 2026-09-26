// Scoring a week as it stands (0378): whose lineup, and when a week is over. No network.
import { asIsLineup, weekIsOver } from '../src/scoreAsIs.js';
import { classicSlotsFromSpec } from '../../packages/core/src/engine/classic.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

const slots = classicSlotsFromSpec([{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['WR'] }, { pos: ['RB', 'WR', 'TE'] }]);
const P = (id, pos) => ({ id, pos, team: 'KC' });
const roster = [P('qb1', 'QB'), P('rb1', 'RB'), P('rb2', 'RB'), P('wr1', 'WR'), P('wr2', 'WR'), P('te1', 'TE')];
const proj = { qb1: 20, rb1: 15, rb2: 9, wr1: 14, wr2: 8, te1: 10 };
const valueOf = (p) => proj[p.id] ?? 0;
const bySlot = (rows) => Object.fromEntries(rows.map((r) => [r.slot, r.player]));

{
  const r = asIsLineup({ slots, bestball: [], stored: {}, saved: null, roster, valueOf });
  ok(JSON.stringify(bySlot(r.rows)) === JSON.stringify({ S1: 'qb1', S2: 'rb1', S3: 'wr1', S4: 'te1' }), 'nothing saved anywhere: the best projected lineup');
}
{
  const saved = { S1: 'qb1', S2: 'rb2', S3: 'wr2', S4: 'gone-guy' };
  const r = asIsLineup({ slots, bestball: [], stored: {}, saved, roster, valueOf });
  const l = bySlot(r.rows);
  ok(l.S2 === 'rb2' && l.S3 === 'wr2', 'THE POINT: the saved lineup from next week is the lineup — a manager\'s choices stand');
  ok(l.S4 === 'rb1' && r.copied.length === 3 && r.planned.length === 1, 'a player no longer on the roster leaves a gap, filled by projection: ' + JSON.stringify(l));
}
{
  const stored = { S1: 'qb1', S2: 'rb2' };
  const r = asIsLineup({ slots, bestball: [], stored, saved: { S2: 'rb1', S3: 'wr2' }, roster, valueOf });
  const l = bySlot(r.rows);
  ok(l.S2 === 'rb2' && r.copied.length === 0, 'a lineup saved for THIS week wins over next week\'s');
  ok(l.S3 === 'wr1' && l.S4 === 'rb1', 'and its empty spots are filled by projection');
}
{
  const r = asIsLineup({ slots, bestball: [], stored: { S1: 'qb1', S3: null }, saved: null, roster, valueOf });
  ok(bySlot(r.rows).S3 === 'wr1', 'a spot cleared on purpose is still filled: as it stands means a full lineup');
}
{
  const r = asIsLineup({ slots, bestball: ['S4'], stored: {}, saved: null, roster, valueOf });
  ok(!('S4' in bySlot(r.rows)), 'a best-ball spot is left to fill itself');
}
{
  const r = asIsLineup({ slots, bestball: [], stored: {}, saved: { S1: 'qb1', S2: 'qb1' }, roster, valueOf });
  ok(r.rows.filter((x) => x.player === 'qb1').length === 1, 'nobody starts twice');
}

const now = Date.parse('2026-09-27T12:00:00Z');
ok(weekIsOver([Date.parse('2026-09-21T00:15:00Z'), Date.parse('2026-09-18T00:15:00Z')], now), 'last kickoff days ago: the week is over');
ok(!weekIsOver([Date.parse('2026-09-26T16:00:00Z'), Date.parse('2026-09-28T00:20:00Z')], now), 'a game still to come: the week is live');
ok(!weekIsOver([Date.parse('2026-09-27T09:00:00Z')], now), 'a game that kicked off three hours ago is still on');
ok(!weekIsOver([], now), 'no slate: not over');

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL SCORE-AS-IS CHECKS PASS');
