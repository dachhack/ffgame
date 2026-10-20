// THE LIVE PROJECTION (v0.730.36). Founder, an hour into Monday Showdown:
// "Projections look off" — "31.2 PTS · proj 31.2": a player's points so far
// replaced his projection once he scored. Now the projection is his points
// plus his projection for the share of his game still to play.
import { contestLiveProj, CONTEST_GAME_MS } from '../../packages/core/src/engine/contest.ts';
import { readFileSync } from 'node:fs';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const k = Date.parse('2026-10-20T00:15:00Z');
ok('before kickoff: the projection', contestLiveProj(null, 17.6, k, k - 60_000) === 17.6);
ok('a third of the way in, 4.2 so far: 4.2 + two-thirds of 17.6', Math.abs(contestLiveProj(4.2, 17.6, k, k + CONTEST_GAME_MS / 3) - (4.2 + 17.6 * 2 / 3)) < 1e-9, contestLiveProj(4.2, 17.6, k, k + CONTEST_GAME_MS / 3));
ok('no stat yet mid-game: what is left of his projection', Math.abs(contestLiveProj(null, 9, k, k + CONTEST_GAME_MS / 2) - 4.5) < 1e-9);
ok('after three hours: the score alone', contestLiveProj(12.3, 17.6, k, k + CONTEST_GAME_MS + 1) === 12.3);
ok('no kickoff known: the score if any, else the projection', contestLiveProj(3, 10, null, k) === 3 && contestLiveProj(null, 10, null, k) === 10);
for (const f of ['../../src/screens/ContestMatchup.tsx', '../../apps/mobile/src/screens/ContestMatchup.tsx']) {
  const src = readFileSync(new URL(f, import.meta.url), 'utf8');
  ok(`${f.replace('../../', '')}: the team line projects live`, src.includes('contestLiveProj(score, projOf(r.slug)') && !src.includes('const v = score ?? (r.slug ? projOf(r.slug) : null) ?? 0;'));
}
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('contest-liveproj: all passed');
