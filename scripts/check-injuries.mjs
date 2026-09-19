// Guard for the injury report's PRECEDENCE rules — the ones the badges and the
// engine's healthy() both hang off, and which are easy to break silently.
//
// Silently is the operative word, and why this file exists. The worker has
// polled ESPN into `injury_status` since 0001, but nothing read it until
// v0.167.0: on a 2026 board every badge rendered blank and `defaultLineup` /
// `aiLineup` believed the whole league was available. Nothing errored. A wrong
// answer here looks exactly like a healthy league, so only an assertion catches
// it.
// Run: npx tsx scripts/check-injuries.mjs
import {
  injuryFor, setLiveInjuries, clearLiveInjuries, hasLiveInjuries, injuryRowFor,
  setInjurySeason,
} from '../packages/core/src/data/injuries.ts';

let fails = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) { fails++; console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

// 1. The baked 2025 report still serves a 2025 board, unchanged.
clearLiveInjuries();
setInjurySeason(2025);
eq('2025 baked: a week designation', injuryFor(1, 'christian-mccaffrey'), 'Q');
eq('2025 baked: IR applies from its start week', injuryFor(4, 'james-conner'), 'IR');
eq('2025 baked: IR does not apply before it', injuryFor(3, 'james-conner'), null);
eq('2025 baked: an unlisted player is healthy', injuryFor(1, 'josh-allen'), null);

// 2. A season with no live report loaded shows nothing (rather than replaying
//    last year's tags against this year's roster).
setInjurySeason(2026);
eq('2026, no report loaded', injuryFor(1, 'christian-mccaffrey'), null);
eq('2026, no report loaded: hasLiveInjuries', hasLiveInjuries(1), false);

// 3. The live report serves the week it was polled for, detail included.
setLiveInjuries(3, {
  'christian-mccaffrey': { status: 'O', comment: 'knee' },
  'ceedee-lamb': { status: 'Q' },
});
eq('live: designation', injuryFor(3, 'christian-mccaffrey'), 'O');
eq('live: hasLiveInjuries', hasLiveInjuries(3), true);
eq('live: player off the report', injuryFor(3, 'josh-allen'), null);
eq('live: detail row', injuryRowFor(3, 'christian-mccaffrey')?.comment, 'knee');

// 4. And ONLY that week. The ESPN feed is a snapshot of the designations
//    standing right now — it carries no week and keeps no history, so tagging
//    any other week with it would be an invention.
eq('live: another week is not covered', injuryFor(4, 'christian-mccaffrey'), null);
eq('live: another week has no detail', injuryRowFor(4, 'christian-mccaffrey'), null);

// 5. For a week it covers, the live report WINS — the two reports must never
//    blend into one board.
setInjurySeason(2025);
setLiveInjuries(1, { 'ceedee-lamb': { status: 'D' } });
eq('live outranks baked: baked designation suppressed', injuryFor(1, 'christian-mccaffrey'), null);
eq('live outranks baked: baked IR suppressed', injuryFor(1, 'brandon-aiyuk'), null);
eq('live outranks baked: live designation served', injuryFor(1, 'ceedee-lamb'), 'D');
eq('baked still serves an uncovered week', injuryFor(2, 'isaiah-likely'), 'O');

// 6. Clearing reverts cleanly — a league exit must not strand the last board's
//    designations over the next one.
clearLiveInjuries();
eq('cleared: baked is back', injuryFor(1, 'christian-mccaffrey'), 'Q');
eq('cleared: hasLiveInjuries', hasLiveInjuries(1), false);

// 7. The engine's rule, on live data: `s !== 'O' && s !== 'IR'`. Out and IR are
//    never auto-fielded; Questionable and Doubtful are legitimate starts and
//    stay startable. Keep in step with defaultLineup/aiLineup in engine/matchup.
setInjurySeason(2026);
setLiveInjuries(5, {
  'p-out': { status: 'O' }, 'p-ir': { status: 'IR' },
  'p-q': { status: 'Q' }, 'p-d': { status: 'D' },
});
const healthy = (slug) => { const s = injuryFor(5, slug); return s !== 'O' && s !== 'IR'; };
eq('engine: Out is not auto-fielded', healthy('p-out'), false);
eq('engine: IR is not auto-fielded', healthy('p-ir'), false);
eq('engine: Questionable is startable', healthy('p-q'), true);
eq('engine: Doubtful is startable', healthy('p-d'), true);
eq('engine: an unlisted player is startable', healthy('p-clean'), true);

clearLiveInjuries();

// 8. THE BULK FEED'S SHAPE (v0.423.0). By September 2026 ESPN's report carried
//    team entries as `{ id, displayName }` with no abbreviation, and athletes
//    with no `id` — so every designation reached the resolver with team ''
//    and id null, and the id-first / team-settled resolution (0200, v0.345.0)
//    silently degraded to a ranked-name guess. The normalizer now reads the
//    id off the player-card link and the team off ESPN's team id.
const { normalizeInjuries, athleteIdOf, teamAbbrOf } = await import('../scripts/espn/injuries.mjs');
const seen = [];
const feed = { injuries: [
  { id: '23', displayName: 'Pittsburgh Steelers', injuries: [
    { status: 'Out', type: { abbreviation: 'O' }, date: '2026-09-19T17:09Z', details: { returnDate: '2026-09-27' },
      shortComment: 'Pittman (foot) has been ruled out',
      athlete: { displayName: 'Michael Pittman Jr.', links: [
        { href: 'https://www.espn.com/nfl/player/_/id/4035687/michael-pittman-jr' },
        { href: 'sportscenter://x-callback-url/showClubhouse?uid=s:20~l:28~a:4035687' },
      ] } },
    { status: 'Active', type: { abbreviation: 'A' }, athlete: { displayName: 'Healthy Guy', links: [{ href: 'https://www.espn.com/nfl/player/_/id/1/healthy-guy' }] } },
  ] },
  // The older shape still resolves the same way.
  { team: { abbreviation: 'LAR' }, injuries: [
    { status: 'Questionable', type: { abbreviation: 'Q' }, athlete: { id: 111, displayName: 'Old Shape' } },
  ] },
  // A team the table does not know, an athlete with no link: nothing invented.
  { id: '99', displayName: 'Nowhere', injuries: [
    { status: 'Doubtful', type: { abbreviation: 'D' }, athlete: { displayName: 'No Link' } },
  ] },
] };
const rows = normalizeInjuries(feed, (name, espnId, team) => { seen.push({ name, espnId, team }); return name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '-'); });
eq('feed: athlete id read off the player-card link', athleteIdOf(feed.injuries[0].injuries[0].athlete), '4035687');
eq('feed: an explicit id still wins', athleteIdOf({ id: 111, links: [{ href: 'https://x/_/id/222/y' }] }), '111');
eq('feed: no id anywhere is null, not ""', athleteIdOf({ displayName: 'No Link' }), null);
eq('feed: team from ESPN id', teamAbbrOf(feed.injuries[0]), 'PIT');
eq('feed: team from abbreviation, in the slate vocabulary', teamAbbrOf(feed.injuries[1]), 'LA');
eq('feed: unknown team id is ""', teamAbbrOf(feed.injuries[2]), '');
eq('feed: the resolver sees Pittman with id and team', JSON.stringify(seen[0]), JSON.stringify({ name: 'Michael Pittman Jr.', espnId: '4035687', team: 'PIT' }));
eq('feed: Active is skipped before resolution', seen.length, 3);
eq('feed: status O', rows['michael-pittman-jr']?.status, 'O');
eq('feed: team stored', rows['michael-pittman-jr']?.team, 'PIT');
eq('feed: return date', rows['michael-pittman-jr']?.returnDate, '2026-09-27');
eq('feed: the old shape resolves with its id', JSON.stringify(seen[1]), JSON.stringify({ name: 'Old Shape', espnId: '111', team: 'LA' }));
eq('feed: nothing invented', JSON.stringify(seen[2]), JSON.stringify({ name: 'No Link', espnId: null, team: '' }));

console.log(fails ? `FAIL  ${fails} injury assertion(s) failed` : 'OK    injury report precedence');
process.exit(fails ? 1 : 0);
