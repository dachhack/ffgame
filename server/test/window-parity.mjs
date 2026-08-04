// Window-id parity gate: the `win` the server writes to nfl_slate
// (slateFromGames) must equal the window id the client derives for the same
// game (nflSlate.ts deriveWeek) — those ids key per-window pick sealing
// (lock.js winKicks) and the 0058 DB lock trigger, so a divergence means a
// window that never seals and never publishes scores. Runs offline.
//   npx tsx test/window-parity.mjs
import { slateFromGames } from '../src/poll/scoreboard.js';
import { setRuntimeSlate, clearRuntimeSlate, windowForTeam, windowsForWeek } from '../../src/data/nflSlate.ts';

// Real 2026 preseason kickoffs (migration 0099) — Thu doubleheaders, Fri and
// multi-slot Sat slates — plus a regular-season-shaped week with a Sunday
// morning (London) game and a Wednesday opener, the shapes that diverged.
const CASES = {
  901: [ // preseason week 2 shape
    ['CIN', 'DET', '2026-08-13T23:00Z'], ['NE', 'IND', '2026-08-13T23:30Z'], ['SF', 'TEN', '2026-08-14T01:00Z'],
    ['ATL', 'DEN', '2026-08-14T23:00Z'], ['BUF', 'CAR', '2026-08-15T17:00Z'], ['KC', 'LA', '2026-08-15T20:00Z'],
    ['BAL', 'PHI', '2026-08-15T23:00Z'], ['SEA', 'DAL', '2026-08-16T00:00Z'],
  ],
  902: [ // regular-season shape: Wed opener, Sun-am London game, the fixed five
    ['PHI', 'DAL', '2026-09-10T00:20Z'], ['LAC', 'KC', '2026-09-11T00:15Z'], ['JAX', 'MIA', '2026-09-13T13:30Z'],
    ['ATL', 'TB', '2026-09-13T17:00Z'], ['CLE', 'CIN', '2026-09-13T17:00Z'], ['SEA', 'SF', '2026-09-13T20:05Z'],
    ['NYG', 'WAS', '2026-09-14T00:20Z'], ['CHI', 'MIN', '2026-09-15T00:15Z'],
  ],
};

let fail = 0;
for (const [week, rows] of Object.entries(CASES)) {
  const games = rows.map(([home, away, date]) => ({ home, away, date, eventId: 'x', state: 'pre' }));
  const slate = slateFromGames(games);
  setRuntimeSlate(Number(week), slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win, kickoff: Date.parse(g.kickoff) })));
  for (const g of slate) {
    const clientWin = windowForTeam(Number(week), g.home);
    if (clientWin !== g.win) {
      fail++;
      console.error(`MISMATCH wk${week} ${g.away}@${g.home} ${g.kickoff}: server '${g.win}' vs client '${clientWin}'`);
    }
  }
  console.log(`wk${week}: ${slate.length} games → windows ${windowsForWeek(Number(week)).map((w) => w.id).join(', ')}`);
}
clearRuntimeSlate();
if (fail) { console.error(`FAIL — ${fail} server/client window-id mismatches`); process.exit(1); }
console.log('PASS — server slate window ids match the client derivation.');
