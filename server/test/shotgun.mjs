// SHOTGUN WEDDING clock and week (v0.653.0): weddingDue is Tuesday 5 AM–6 PM
// Eastern only; weddingWeekOf picks the latest fully-final, fresh, regular week.
import { weddingDue, weddingWeekOf } from '../src/shotgun.js';

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.log('FAIL ', name); } else console.log('PASS ', name); };
// 2026-10-13 is a Tuesday. EDT is UTC−4.
const et = (d, h, m = 0) => Date.UTC(2026, 9, d, h + 4, m);
check('Tuesday 4:59 AM ET is too early (the finals are still being re-stamped)', !weddingDue(et(13, 4, 59)));
check('Tuesday 5:00 AM ET files', weddingDue(et(13, 5)));
check('Tuesday 5:59 PM ET still files', weddingDue(et(13, 17, 59)));
check('Tuesday 6 PM ET does not — no time left to talk', !weddingDue(et(13, 18)));
check('Monday never', !weddingDue(et(12, 10)));
check('Wednesday never', !weddingDue(et(14, 10)));

const now = et(13, 6);
const kick = (d) => new Date(et(d, 13)).toISOString();
const rows = [
  { week: 5, status: 'final', home_final: 100, away_final: 90, lock_at: kick(1) },
  { week: 6, status: 'final', home_final: 80, away_final: 95, lock_at: kick(8) },
  { week: 6, status: 'final', home_final: 70, away_final: 70, lock_at: kick(8) },
  { week: 7, status: 'scheduled', home_final: null, away_final: null, lock_at: kick(15) },
];
check('the latest fully-final week is the one married', weddingWeekOf(rows, now) === 6);
check('a week with one matchup unscored is not final',
  weddingWeekOf([...rows.slice(0, 2), { ...rows[2], away_final: null }, rows[3]], now) === null);
check('a stale week (late finals) gets nothing rather than an old wedding',
  weddingWeekOf(rows.slice(0, 1), now) === null);
check('practice weeks are not the season', weddingWeekOf([{ week: 101, status: 'final', home_final: 1, away_final: 2, lock_at: kick(8) }], now) === null);

if (fails) { console.log(`\n${fails} SHOTGUN TEST(S) FAILED`); process.exit(1); }
console.log('\nALL SHOTGUN TESTS PASSED');
