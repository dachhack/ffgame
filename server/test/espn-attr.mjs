// ESPN adapter ATTRIBUTION under namesakes + the named kicker (v0.369.6).
//
// Founder, over a live preseason box score: four DEFENDERS carried rushing and
// receiving lines, and "folk is the Atlanta kicker" while ATL K held his XPs.
// The first was buildRoster's first-write-wins: one man owned each play-text
// abbreviation, so "T.Dodson up the middle" credited whichever T.Dodson the
// boxscore listed first — a linebacker, when he iterated ahead of the runner.
// The second: kicks were written only to the team pseudo-player.
//
// Synthetic summary, not a fetch: the collision is a data SHAPE, and the test
// must fail on the regression, not on ESPN's availability. The fixture lists
// the DEFENSIVE namesake first — the exact order that reproduced the bug.
import { gameToRealPlays } from '../../scripts/espn/espnAdapter.mjs';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) fails++;
};

const athlete = (id, name) => ({ athlete: { id, displayName: name } });
const play = (id, typeText, text, offenseId, defenseId, extra = {}) => ({
  id: `40100${id}`, type: { text: typeText }, text,
  period: { number: 1 }, clock: { displayValue: '10:00' },
  start: { team: { id: offenseId }, down: 1, distance: 10 },
  teamParticipants: [{ type: 'offense', id: offenseId }, { type: 'defense', id: defenseId }],
  statYardage: extra.yds ?? 0, scoringPlay: !!extra.sc, isTurnover: !!extra.to,
});

const summary = {
  header: {
    id: '40100',
    competitions: [{ competitors: [
      { id: '1', team: { id: '1', abbreviation: 'MIA' }, homeAway: 'home' },
      { id: '2', team: { id: '2', abbreviation: 'ATL' }, homeAway: 'away' },
    ] }],
  },
  boxscore: {
    players: [
      // MIA FIRST, defensive category first — the shadowing order. Both men
      // abbreviate to "T.Dodson"; the LB used to own every mention.
      { team: { abbreviation: 'MIA' }, statistics: [
        { name: 'defensive', athletes: [athlete(22, 'Tyrel Dodson'), athlete(33, 'Zed Zztackler')] },
        { name: 'rushing', athletes: [athlete(44, 'Carl Carrier')] },
      ] },
      { team: { abbreviation: 'ATL' }, statistics: [
        { name: 'rushing', athletes: [athlete(11, 'Trevor Dodson')] },
        { name: 'kicking', athletes: [athlete(55, 'Nate Folkish')] },
      ] },
    ],
  },
  drives: { previous: [{ plays: [
    // ATL on offense: the runner must be ATL's Trevor, the tackler MIA's Zed.
    play(1, 'Rush', 'T.Dodson up the middle for 7 yards (Z.Zztackler).', '2', '1', { yds: 7 }),
    // The beautiful case: ONE abbreviation, BOTH roles, one play — the runner
    // is the offense's Trevor, the parenthesized tackler the defense's Tyrel.
    play(2, 'Rush', 'T.Dodson left end for 4 yards (T.Dodson).', '2', '1', { yds: 4 }),
    // ATL field goal: the pseudo AND the named kicker both get the row.
    play(3, 'Field Goal Good', 'N.Folkish 44 yard field goal is GOOD.', '2', '1', { sc: 1 }),
  ] }] },
};

const pbp = gameToRealPlays(summary);
const kinds = (slug) => (pbp[slug] ?? []).map((p) => p.k);

ok(kinds('trevor-dodson').includes('rush'),
  "THE POINT: the rush credits the OFFENSE'S T.Dodson, not the defender listed first");
ok(!kinds('tyrel-dodson').includes('rush'),
  'the defensive namesake carries no rushing line');
ok(kinds('zed-zztackler').includes('tackle'),
  'the parenthesized tackler resolves on the defense');
ok(kinds('tyrel-dodson').includes('tackle'),
  'one abbreviation, both roles, one play: the tackle goes to the DEFENSIVE namesake');
ok((pbp['trevor-dodson'] ?? []).filter((p) => p.k === 'rush').length === 2,
  'and the runner keeps both carries');
ok(kinds('atl-k').includes('fg'),
  'the team pseudo-kicker keeps its FG row (classic scoring keys on it)');
ok(kinds('nate-folkish').includes('fg'),
  'v0.369.6: the NAMED kicker gets the same FG row — the man scores, not just the unit');

console.log(fails ? `\n${fails} FAIL(s)` : '\nALL ESPN-ATTR ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
