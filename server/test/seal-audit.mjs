// The seal audit (v0.600.0): a pick sealed before its player's kickoff is early.
import assert from 'node:assert';
import { auditSeals } from '../src/sealAudit.js';

const THU = Date.parse('2026-10-02T00:15:00Z');
const SUN = Date.parse('2026-10-04T17:00:00Z');
const kicks = { CLE: THU, PIT: THU, PHI: SUN, LA: SUN };
const r = auditSeals([
  { slug: 'stafford', team: 'LAR', sealedAt: '2026-10-02T00:15:30Z' },   // the #1095 bug
  { slug: 'puka', team: 'LAR', sealedAt: '2026-10-04T17:00:20Z' },       // on time
  { slug: 'browns-wr', team: 'CLE', sealedAt: '2026-10-02T00:15:10Z' },  // on time
  { slug: 'bye-guy', team: 'DAL', sealedAt: '2026-10-02T00:15:10Z' },    // no game: can't judge
  { slug: null, team: null, sealedAt: '2026-10-06T00:15:00Z' },          // an empty spot
], kicks);
assert.deepStrictEqual(r, { checked: 4, early: 1, onTime: 2, unplaced: 1, earlyTeams: { LA: 1 } });
console.log('PASS — the seal audit flags a pick sealed before its own kickoff.');
