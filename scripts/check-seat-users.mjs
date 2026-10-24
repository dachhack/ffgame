// CPU SEATS ON BOTH SIDES (0522, v0.732.9). Devy Test 1: with a seat agent in
// both seats, neither has a membership uid, so a matchup's rows came back
// unsplit and Team 6's locked starters drew in Team 4's lineup. With each
// seat's agent uid (matchup_seat_users), assignSealedRows splits them.
// Run: tsx scripts/check-seat-users.mjs
import { readFileSync } from 'node:fs';
import { assignSealedRows } from '../packages/core/src/engine/seatPicks.ts';
import { seatUserIn } from '../packages/core/src/data/liveApi.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const A6 = 'agent-6', A4 = 'agent-4';
const rows = [
  { app_user_id: A6, roster_slot: 'S1', player_slug: 'c-4880272', locked: true },    // Byrum Brown
  { app_user_id: A4, roster_slot: 'S1', player_slug: 'c-4870857', locked: false },   // Avery Johnson
  { app_user_id: A6, roster_slot: 'S3', player_slug: 'c-5085006', locked: true },    // Jalen Buckley
  { app_user_id: A4, roster_slot: 'S3', player_slug: 'c-4920901', locked: false },   // Darius Taylor
];
const su = { home_roster_id: 6, away_roster_id: 4, home_user: A6, away_user: A4 };
ok('seatUserIn finds the home agent', seatUserIn(su, 6) === A6);
ok('seatUserIn finds the away agent', seatUserIn(su, 4) === A4);
ok('seatUserIn: a seat not in the matchup is nobody', seatUserIn(su, 2) === null);
ok('seatUserIn: no answer is nobody', seatUserIn(null, 6) === null);
const split = assignSealedRows(rows, seatUserIn(su, 6), seatUserIn(su, 4));
ok('two agent seats split by their own uids: Team 6 keeps Brown and Buckley',
  split.home.map((r) => r.player_slug).join() === 'c-4880272,c-5085006', split.home);
ok('…and Team 4 keeps Johnson and Taylor, none of Team 6\'s',
  split.away.map((r) => r.player_slug).join() === 'c-4870857,c-4920901', split.away);

// The wiring: getRevealedPicks asks the RPC, and both boards look a browsed
// CPU seat up through it.
const api = readFileSync(new URL('../packages/core/src/data/liveApi.ts', import.meta.url), 'utf8');
ok('getRevealedPicks reads matchup_seat_users', /export async function getRevealedPicks[\s\S]*?matchupSeatUsers\(matchupId\)/.test(api));
for (const f of ['../apps/mobile/src/ui/ClassicBoard.tsx', '../src/screens/ClassicBoard.tsx']) {
  ok(`${f.split('/').slice(-3).join('/')}: a browsed CPU seat is found by its agent`, /seatUserIn\(await matchupSeatUsers\(m\.id\)/.test(readFileSync(new URL(f, import.meta.url), 'utf8')));
}

if (fails) { console.log(`\n${fails} SEAT-USER ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL SEAT-USER ASSERTIONS PASSED');
