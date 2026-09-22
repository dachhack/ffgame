// Guard for THE SHELF'S OWN LANGUAGE (0347). Offline — check:parity.
//
// The numbers on the leagues list are the server's; what is asserted here is
// the SENTENCE, because every way of getting it wrong is silent. A card that
// calls a live 40-point lead a "win", or prints 0.00 for a game nobody has
// played, or drops a record to (0-0) on week 1, looks exactly like a card that
// works — right up until somebody reads it and believes it.
import {
  recordLabel, verdictOf, isLoud, unreadBadge, sideLabel, scoreLabel, sortSlate,
} from '../packages/core/src/data/leagueSlate.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

const side = (o = {}) => ({ roster_id: 1, team: 'dachhack', points: null, live: false, record: null, ...o });
const row = (o = {}) => ({ league_id: 'l', name: 'League', roster_id: 1, week: 2, game: null,
  unread: { league: 0, dm: 0, mention: 0 }, ...o });
const game = (mine, theirs, status = 'final') => ({
  status, playoff: false, consolation: false, label: null,
  me: side({ points: mine }), opp: side({ roster_id: 2, team: 'Farmer Casey', points: theirs }),
});

// ── the record ──
ok(recordLabel({ wins: 2, losses: 0, ties: 0 }) === '2-0',
  'no ties, two columns — "2-0-0" reads like a third column you must decode');
ok(recordLabel({ wins: 1, losses: 0, ties: 1 }) === '1-0-1', 'a tie earns the third column');
ok(recordLabel(null) === null, 'no standings yet is nothing, not "0-0"');

// ── the verdict: FINAL and LIVE are different sentences ──
ok(verdictOf(game(147.4, 111.7)) === 'won', 'a finished game ahead is won');
ok(verdictOf(game(111.7, 147.4)) === 'lost', '…and behind is lost');
ok(verdictOf(game(120, 120)) === 'tied', '…and level is tied');
ok(verdictOf(game(147.4, 111.7, 'live')) === 'leading',
  'a game IN PROGRESS is only ever leading — a 35-point first-quarter lead is not a win');
ok(verdictOf(game(111.7, 147.4, 'live')) === 'trailing', '…and behind is trailing, not lost');
ok(verdictOf(game(120, 120, 'live')) === 'level', '…and level is level');
ok(verdictOf(game(null, null)) === null,
  'before either side has a published score there is no verdict to give');
ok(verdictOf(game(100, null)) === null, '…and one score alone is still not a comparison');
ok(verdictOf(null) === null, 'a bye has no verdict');

// ── the scores ──
ok(scoreLabel(147.4) === '147.40', 'two decimals, like every other score in the product');
ok(scoreLabel(null) === '—',
  'a game not yet played prints a dash — 0.00 claims a game happened and nobody scored');
ok(scoreLabel(0) === '0.00', '…but a real zero is a real zero');

// ── the name line ──
ok(sideLabel(side({ record: { wins: 1, losses: 0, ties: 1 } })) === 'dachhack (1-0-1)',
  'the seat carries its record');
ok(sideLabel(side()) === 'dachhack', '…and drops it rather than faking (0-0)');
ok(sideLabel(side({ team: null, roster_id: 4 })) === 'Seat 4',
  'an unnamed seat is still identified — a blank row is worse than a dull one');
ok(sideLabel(null) === '—', 'no side at all is a dash');

// ── the badge ──
ok(unreadBadge(row({ unread: { league: 3, dm: 2, mention: 0 } }))?.n === 5,
  'league chat and DMs add up — the badge answers "anything for me in here"');
ok(unreadBadge(row({ unread: { league: 0, dm: 1, mention: 1 } }))?.mention === true,
  'a mention is carried separately, because it is louder than a count');
ok(unreadBadge(row()) === null, 'nothing unread renders nothing, not a 0');

// ── loud, and the order ──
ok(isLoud(row({ unread: { league: 1, dm: 0, mention: 0 } })), 'unread is loud');
ok(isLoud(row({ game: { ...game(10, 10, 'live'), me: side({ points: 10, live: true }) } })),
  'a live game is loud');
ok(!isLoud(row({ game: game(147.4, 111.7) })), 'a finished, read league is quiet');
{
  const rows = [
    row({ league_id: 'z', name: 'Zebra' }),
    row({ league_id: 'a', name: 'Alpha' }),
    row({ league_id: 'q', name: 'Quiet', unread: { league: 4, dm: 0, mention: 0 } }),
  ];
  const out = sortSlate(rows).map((r) => r.league_id);
  ok(out[0] === 'q', 'anything happening sorts first');
  ok(out[1] === 'a' && out[2] === 'z',
    '…and the rest stay alphabetical, so a list a person has learned does not reshuffle itself');
  ok(rows[0].league_id === 'z', 'sortSlate copies — the caller’s array is not reordered underneath it');
}

console.log(fails ? `\n${fails} SLATE ASSERTION(S) FAILED` : '\nALL SLATE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
