// THE STAT MAP, CHECKED AGAINST THE SOURCE (0329).
//
// server/src/poll/projections.js decodes ESPN's numeric stat ids into our own
// field names. Those ids are undocumented, so the only honest way to know the
// map is right is to score the decoded line ourselves and compare it to the
// total ESPN scored from the same row. A drift here would be silent: every
// projection would still LOOK like a number.
//
// NETWORK TEST — `npm run validate:proj`, not part of check:parity, which has
// to run offline.
import { weekLineFor } from '../server/src/poll/projections.js';

const SEASON = process.env.PROJ_CHECK_SEASON || '2025';
const WEEKS = [1, 2, 3, 10];
const TOLERANCE = 0.5;     // points, per player-week, under PPR

const ppr = (l) => (l.paYd || 0) / 25 + (l.paTd || 0) * 4 - (l.paInt || 0) * 2
  + (l.ruYd || 0) / 10 + (l.ruTd || 0) * 6
  + (l.rec || 0) + (l.reYd || 0) / 10 + (l.reTd || 0) * 6
  - (l.fumLost || 0) * 2 + ((l.pa2p || 0) + (l.ru2p || 0) + (l.re2p || 0)) * 2;

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const res = await fetch(
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/3?view=kona_player_info`,
  { headers: { 'x-fantasy-filter': JSON.stringify({ players: { limit: 60, sortPercOwned: { sortAsc: false, sortPriority: 1 } } }) } },
);
ok(res.ok, `the projections endpoint answers (${res.status})`);
const feed = await res.json();
ok((feed?.players ?? []).length > 20, `${feed?.players?.length ?? 0} players in the feed`);

let checked = 0, sum = 0, worst = 0, worstWho = '';
let skill = 0, kdst = 0;
for (const e of feed.players ?? []) {
  const pos = Number(e?.player?.defaultPositionId);
  for (const wk of WEEKS) {
    const got = weekLineFor(e.player, wk);
    if (!got || !Number.isFinite(got.pts) || !got.pts) continue;
    if (got.line === null) { kdst++; continue; }     // a kicker or a defense, by design
    skill++;
    const err = Math.abs(ppr(got.line) - got.pts);
    checked++; sum += err;
    if (err > worst) { worst = err; worstWho = `${e.player.fullName} (pos ${pos}) wk ${wk}: ours ${ppr(got.line).toFixed(2)} vs theirs ${got.pts.toFixed(2)}`; }
  }
}
ok(checked > 50, `${checked} skill-player weeks decoded (and ${kdst} K/DST weeks left as totals, by design)`);
ok(sum / checked < TOLERANCE, `mean error ${(sum / checked).toFixed(3)} pts is under ${TOLERANCE}`);
ok(worst < 3, `worst case ${worst.toFixed(2)} pts — ${worstWho || 'none'}`);

console.log(fails === 0 ? '\nALL PROJECTION-MAP ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
