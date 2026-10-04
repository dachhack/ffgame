// THE LEAGUE CARD'S LINES AND WHERE A TAP LANDS (v0.609.0 / v0.610.0).
//
// Both rules live in core so the app and the web say the same thing about the
// same league; this pins them. leagueLandingRoom: the matchup once drafted,
// the draft room while it runs, the hub otherwise — and, since v0.609.0, the
// matchup for an imported league with a seat (it has no draft row of ours
// because it drafted on its own platform). leagueDetailLine (0421): the second
// line prints only what is news and drops what it doesn't know. Offline.
// Run: npx tsx scripts/check-league-line.mjs
import { leagueLandingRoom, leagueTypeLine, leagueDetailLine } from '../packages/core/src/data/liveApi.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const seat = (league, rosterId = 3) => ({ league_id: 'L', team_name: 'T', sleeper_roster_id: rosterId, avatar_url: null, league });
const native = (over = {}) => ({ name: 'N', season: '2026', provider: 'native', rosters: 12, continuity: 'dynasty', game_mode: 'drip', ...over });
const sleeper = (over = {}) => ({ name: 'S', season: '2026', provider: 'sleeper', rosters: 10, draft_status: null, ...over });

// ── Where a tap lands ────────────────────────────────────────────────────────
ok(leagueLandingRoom(seat(native({ draft_status: 'live' }))) === 'draft', 'a running draft opens the draft room');
ok(leagueLandingRoom(seat(native({ draft_status: 'complete' }))) === 'matchup', 'a drafted native league opens the matchup');
ok(leagueLandingRoom(seat(native({ draft_status: 'complete' }), null)) === 'home', 'a seatless commissioner lands on the hub even when drafted');
ok(leagueLandingRoom(seat(native({ draft_status: 'pending' }))) === 'home', 'a native league that has not drafted opens the hub');
ok(leagueLandingRoom(seat(sleeper())) === 'matchup', 'v0.609.0: an imported league with a seat opens the matchup (it drafted on its platform)');
ok(leagueLandingRoom(seat(sleeper({ provider: 'espn' }))) === 'matchup', 'any imported provider counts, not only Sleeper');
ok(leagueLandingRoom(seat(sleeper(), null)) === 'home', 'an imported league with no seat still opens the hub');
ok(leagueLandingRoom(seat(native({ draft_status: null, kind: 'pod' }))) === 'home', 'a native pod with no draft row keeps the hub');
ok(leagueLandingRoom(seat(null)) === 'home', 'no league block → hub, no throw');

// ── The type line is unchanged ───────────────────────────────────────────────
ok(leagueTypeLine(seat(native())) === '2026 12-Team Dynasty Drip', 'the first line still reads as before');
ok(leagueTypeLine(seat(sleeper())) === '2026 10-Team Sleeper', 'an imported league still names its platform on the first line');

// ── The second line (0421) ───────────────────────────────────────────────────
ok(leagueDetailLine(seat(native())) === '', 'no details block (an older build) → empty, so the card leaves the line out');
ok(leagueDetailLine(seat(native({ details: {} }))) === '', 'a details block with nothing in it → empty');
ok(leagueDetailLine(seat(native({ details: { superflex: null, ppr: null, bestball: false, devy: false, contracts: false, keepers: null, dues: null, scoring_custom: false } }))) === '',
  'a plain drip league says nothing extra: no "1QB", no "lineups"');
ok(leagueDetailLine(seat(native({ game_mode: 'classic', details: { superflex: true, ppr: 0.5, bestball: true } }))) === 'Superflex · Half PPR · Best Ball',
  'a classic league: superflex, reception scoring, best ball');
ok(leagueDetailLine(seat(native({ game_mode: 'classic', details: { superflex: false, ppr: 1 } }))) === 'Full PPR', 'a 1QB classic league prints its scoring, not "1QB"');
ok(leagueDetailLine(seat(native({ game_mode: 'classic', details: { superflex: false, ppr: 0 } }))) === 'Standard scoring', 'zero PPR is "Standard scoring"');
ok(leagueDetailLine(seat(native({ details: { devy: true, devy_mode: 'spots' } }))) === 'Devy', 'devy spots say Devy');
ok(leagueDetailLine(seat(native({ details: { devy: true, devy_mode: 'shares' } }))) === 'Devy Shares', 'devy shares say so');
ok(leagueDetailLine(seat(native({ details: { college_calendar: true, devy: false } }))) === 'College', 'a college-calendar league says College');
ok(leagueDetailLine(seat(native({ details: { contracts: true, salary_cap: 200, keepers: 3, dues: 50, scoring_custom: true } }))) === '$200 cap · 3 keepers · $50 dues · Custom scoring',
  'cap, keepers, dues and custom scoring, in that order');
ok(leagueDetailLine(seat(native({ details: { keepers: 1 } }))) === '1 keeper', 'one keeper, singular');
ok(leagueDetailLine(seat(native({ details: { contracts: true, salary_cap: null } }))) === '', 'contracts with no cap add nothing (the type line already says Contract)');
ok(leagueDetailLine(seat(sleeper({ details: { continuity: 'dynasty', superflex: true, ppr: 1, bestball: false, starters: 10 } }))) === 'Dynasty · Superflex · Full PPR · 10 starters',
  'an imported league prints its platform type, superflex, scoring and starters');
ok(leagueDetailLine(seat(sleeper({ details: { continuity: null, superflex: false, ppr: 0.5, bestball: true, starters: 9 } }))) === 'Half PPR · Best Ball · 9 starters',
  'an imported redraft league prints no continuity word');
ok(leagueDetailLine(seat(native({ details: { starters: 9, continuity: 'dynasty' } }))) === '', 'starters and the platform type are imported-only words');

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
