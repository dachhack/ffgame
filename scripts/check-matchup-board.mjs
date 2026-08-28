// The classic MATCHUP BOARD's arithmetic, checked in Node.
//
// This lives in check:parity rather than beside the screens because the
// numbers are the product: live totals, projected finals, who is left to
// play, and the win chance derived from them. Two hosts render this board;
// them disagreeing about any figure is worse than either looking wrong.
// The cases that earn their keep are the ones where the obvious
// implementation is wrong — a live player must not be worth live+proj, a
// finished player must not be improved by a projection, and an EMPTY
// starting spot is not "yet to play".
import { projectEntry, winProbability, yetToPlayBreakdown, buildMatchupBoard, gameFor, entryState, isPrimetime, venueTeam, isBye, slateChips, slateScores, slateSummary, lineupChipSummary, isRehearsalPool, WHOLE_POOL_MIN } from '../packages/core/src/engine/matchupBoard';
import { roofFor, isRoofed, STADIUM_ROOF } from '../packages/core/src/data/stadiums';
import { slugMeta, setSlugMetaOverrides, clearSlugMetaOverrides } from '../packages/core/src/data/slugMeta';
let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const E = (o) =>
  ({ slug: 's', name: 'N', pos: 'RB', team: 'KC', live: 0, proj: 10, state: 'pre', ...o });

// projectEntry — the case the naive version gets wrong
ok('done keeps its final, projection cannot improve it', projectEntry(E({ state: 'done', live: 20, proj: 10 })) === 20);
ok('pre is the projection', projectEntry(E({ state: 'pre', live: 0, proj: 12 })) === 12);
ok('live over projection keeps the live score', projectEntry(E({ state: 'live', live: 20, proj: 10 })) === 20);
ok('live under projection floors at the projection', projectEntry(E({ state: 'live', live: 3, proj: 10 })) === 10);
ok('live NEVER adds live+proj', projectEntry(E({ state: 'live', live: 20, proj: 10 })) !== 30);

// winProbability
const wideOpen = winProbability(110, 100, 9, 9);
const nearlyDone = winProbability(110, 100, 1, 0);
ok('same margin is more decisive with fewer left', nearlyDone > wideOpen, { wideOpen, nearlyDone });
ok('a 10-pt edge with everyone to play stays modest', wideOpen < 0.75, wideOpen);
ok('never claims 100% while anything is unresolved', winProbability(200, 100, 1, 0) <= 0.99);
ok('a settled blowout may read 100%', winProbability(200, 100, 0, 0) === 1);
ok('dead heat is a coin flip', Math.abs(winProbability(100, 100, 5, 5) - 0.5) < 1e-9);
const a = winProbability(110, 100, 4, 4), b = winProbability(100, 110, 4, 4);
ok('the two sides sum to 1', Math.abs(a + b - 1) < 1e-9, { a, b });

// yet-to-play breakdown
ok('roster order, not alphabetical',
  yetToPlayBreakdown([E({ pos: 'WR' }), E({ pos: 'QB' }), E({ pos: 'WR' }), E({ pos: 'TE' })]) === '1 QB, 2 WR, 1 TE',
  yetToPlayBreakdown([E({ pos: 'WR' }), E({ pos: 'QB' }), E({ pos: 'WR' }), E({ pos: 'TE' })]));
ok('finished players drop out', yetToPlayBreakdown([E({ pos: 'QB', state: 'done' }), E({ pos: 'RB' })]) === '1 RB');
// v0.368.0: a player mid-game is PLAYING, not yet to play — nine starters all
// live used to read "yet to play (9)" over nine live rows.
ok('live players drop out too', yetToPlayBreakdown([E({ pos: 'QB', state: 'live' }), E({ pos: 'RB' })]) === '1 RB');

// the whole board
const slots = [
  { slot: 'S1', type: 'QB', pos: ['QB'] },
  { slot: 'S2', type: 'RB', pos: ['RB'] },
];
const board = buildMatchupBoard({
  week: 1, locked: true, slots, labelFor: (d) => d.type,
  home: { rosterId: 1, team: 'Us', starters: { S1: E({ pos: 'QB', live: 20, proj: 18, state: 'done' }), S2: E({ pos: 'RB', live: 4, proj: 12, state: 'live' }) } },
  away: { rosterId: 2, team: 'Them', starters: { S1: E({ pos: 'QB', live: 10, proj: 15, state: 'done' }), S2: null } },
});
ok('live total counts only what is scored', board.home.live === 24, board.home.live);
ok('projected blends done + live floor', board.home.projected === 32, board.home.projected);
ok('an EMPTY spot is not "yet to play"', board.away.yetToPlay === 0, board.away.yetToPlay);
// v0.368.0: yetToPlay counts only 'pre'; a live starter lands in `playing`.
ok('a live starter is playing, not yet to play', board.home.yetToPlay === 0 && board.home.playing === 1,
  { yetToPlay: board.home.yetToPlay, playing: board.home.playing });
ok('a finished side has nobody playing', board.away.playing === 0, board.away.playing);
ok('an empty spot contributes nothing', board.away.projected === 10, board.away.projected);
ok('win pcts still sum to 1', Math.abs(board.home.winPct + board.away.winPct - 1) < 1e-9);

// slate helpers
const slate = [{ home: 'CIN', away: 'TB', kickoff: '2026-09-13T17:00:00Z' }];
ok('away team reads its opponent', gameFor('TB', slate)?.opponent === 'CIN');
ok('home team reads its opponent', gameFor('CIN', slate)?.opponent === 'TB');
ok('home/away is distinguished', gameFor('CIN', slate)?.home === true && gameFor('TB', slate)?.home === false);
ok('a team with no game is a bye (null)', gameFor('KC', slate) === null);

const T = Date.parse('2026-09-13T17:00:00Z');
ok('before kickoff is pre', entryState('2026-09-13T17:00:00Z', 'TB', T - 1000) === 'pre');
ok('after kickoff is live', entryState('2026-09-13T17:00:00Z', 'TB', T + 1000) === 'live');
ok('a FINAL team is done even mid-window', entryState('2026-09-13T17:00:00Z', 'TB', T + 1000, new Set(['TB'])) === 'done');
ok('no kickoff (bye) is pre, never live', entryState(null, 'KC', T + 1e9) === 'pre');

// ── The game line's two markers (v0.237.0) ─────────────────────────────────
// Both are FACTS — a roof from a table, a kickoff hour from the clock. The
// third thing Sleeper's board shows there is WEATHER, which we have no feed
// for and therefore never draw.
ok('every NFL team has a roof on file', Object.keys(STADIUM_ROOF).length === 32, Object.keys(STADIUM_ROOF).length);
ok('a dome is roofed', isRoofed('MIN') && roofFor('MIN') === 'dome');
ok('a retractable roof counts as roofed', isRoofed('DAL') && roofFor('DAL') === 'retractable');
ok('an open stadium is not roofed', !isRoofed('GB') && roofFor('GB') === 'open');
ok('Miami is OPEN — the canopy covers the seats, not the field', roofFor('MIA') === 'open');
ok('an unknown team says nothing rather than guessing', roofFor('XXX') === null && !isRoofed('XXX') && !isRoofed(null));
ok('lower case is the same team', roofFor('min') === 'dome');
// The one that would have shipped broken: the slate calls the Rams LA, so a
// table keyed on the broadcast code would answer null for both SoFi tenants.
ok('the Rams answer under the slate code AND the broadcast one',
  roofFor('LA') === 'canopy' && roofFor('LAR') === 'canopy', [roofFor('LA'), roofFor('LAR')]);
ok('the other relocation codes normalize too',
  roofFor('WSH') === roofFor('WAS') && roofFor('JAC') === roofFor('JAX') && roofFor('OAK') === 'dome',
  [roofFor('WSH'), roofFor('JAC'), roofFor('OAK')]);
// The venue is the HOME team's building, whichever side the player is on.
ok('an away player takes the opponent’s roof', venueTeam('BUF', { opponent: 'DET', home: false }) === 'DET');
ok('a home player takes their own', venueTeam('BUF', { opponent: 'DET', home: true }) === 'BUF');
ok('a road game in a dome is roofed', isRoofed(venueTeam('GB', { opponent: 'MIN', home: false })));

// Primetime is evaluated in ET, not in the reader's zone — the whole point.
ok('Sunday night is primetime', isPrimetime('2026-09-14T00:20:00Z'), new Date('2026-09-14T00:20:00Z').toISOString());  // 8:20pm ET Sun
ok('Monday night is primetime', isPrimetime('2026-09-15T00:15:00Z'));                                                   // 8:15pm ET
ok('the 1pm window is not', !isPrimetime('2026-09-13T17:00:00Z'));                                                      // 1:00pm ET
ok('the 4:25 window is not', !isPrimetime('2026-09-13T20:25:00Z'));                                                     // 4:25pm ET
ok('a London 9:30am kickoff is not primetime', !isPrimetime('2026-10-04T13:30:00Z'));                                   // 9:30am ET
ok('no kickoff (bye) is not primetime', !isPrimetime(null) && !isPrimetime(undefined) && !isPrimetime('not a date'));

// ── A BYE has to be PROVEN (v0.245.0) ──────────────────────────────────────
// The bug this fixes: a rookie the baked slug map doesn't know resolves with an
// EMPTY team, an empty team is in nobody's slate, and the board printed
// "BYE · No game this week" for a man playing his season opener.
{
  const wk1 = [{ home: 'CIN', away: 'TB', kickoff: '2026-09-13T17:00:00Z' }];
  ok('a known team missing from a loaded slate IS a bye', isBye('KC', wk1));
  ok('a team that is playing is not', !isBye('CIN', wk1) && !isBye('TB', wk1));
  ok('an UNKNOWN team is never a bye — no team, no claim',
    !isBye('', wk1) && !isBye(null, wk1) && !isBye(undefined, wk1));
  ok('an UNLOADED slate never makes anyone a bye', !isBye('KC', []) && !isBye('KC', null));
}

// ── Who IS this player? (v0.246.0) ─────────────────────────────────────────
// It lives in the board suite because the board is where getting it wrong
// showed: an unresolvable player read as a BYE, and — because mkPlayer takes a
// position from here — was scored as a WR.
{
  clearSlugMetaOverrides();
  // A player with baked 2025 plays still answers from the PBP bake, whose team
  // is what that play stream's possession gating is written against.
  ok('a baked player still resolves from the PBP bake', slugMeta('saquon-barkley').pos === 'RB');
  // The case the founder hit: a 2026 rookie has no 2025 plays, so the PBP bake
  // cannot contain him at any freshness. The DIRECTORY bake can.
  const tate = slugMeta('carnell-tate');
  ok('a 2026 rookie resolves from the directory bake', tate.pos === 'WR' && tate.team === 'TEN', tate);
  ok('…and is NOT the WR/"" default that read as a bye', tate.team !== '');
  // Genuinely unknown still degrades quietly rather than throwing.
  ok('an unknown slug still degrades to a neutral answer',
    slugMeta('nobody-at-all').team === '' && slugMeta('').pos === 'WR');
  // Team units keep their shortcuts.
  ok('DST and K slugs are unchanged', slugMeta('kc-dst').pos === 'DEF' && slugMeta('kc-k').pos === 'K');
  // The live overlay still wins over both bakes.
  setSlugMetaOverrides([{ slug: 'carnell-tate', pos: 'RB', team: 'KC' }]);
  ok('a live pool override still beats every bake', slugMeta('carnell-tate').team === 'KC');
  clearSlugMetaOverrides();
}


// ── THE WEEK'S SLATE AS THIS MATCHUP SEES IT (v0.312.0) ────────────────────
// The scoreboard's chip row. What earns a guard here is that the chips must
// agree with the headline totals above them — a strip telling a second story
// about the same players is worse than no strip — and that a game nobody is in
// is still REPORTED, because it was asked for as the week's slate.
{
  const E = (slug, team, live, proj, state) => ({ slug, name: slug, pos: 'WR', team, live, proj, state });
  const starters = [
    { slot: 'S1', label: 'QB', pos: ['QB'], home: E('a', 'BUF', 10, 12, 'live'), away: E('b', 'HOU', 5, 9, 'live') },
    { slot: 'S2', label: 'RB', pos: ['RB'], home: E('c', 'BUF', 0, 8, 'pre'), away: E('d', 'KC', 0, 7, 'pre') },
    { slot: 'S3', label: 'WR', pos: ['WR'], home: null, away: E('e', 'SF', 20, 6, 'done') },
  ];
  const slate = [
    { home: 'HOU', away: 'BUF', kickoff: '2026-09-13T17:00:00Z' },
    { home: 'LA', away: 'SF', kickoff: '2026-09-13T20:05:00Z' },
    { home: 'DEN', away: 'LV', kickoff: '2026-09-14T00:20:00Z' },   // nobody in it
  ];
  const now = Date.parse('2026-09-13T18:00:00Z');
  const chips = slateChips(starters, slate, now, new Set(['SF', 'LA']));

  ok('every game on the slate gets a chip, including one nobody is in',
    chips.length === 3, chips.map((c) => c.key));
  ok('chips run in kickoff order', chips.map((c) => c.key).join() === 'BUF@HOU,SF@LA,LV@DEN',
    chips.map((c) => c.key));

  const buf = chips[0], lv = chips[2];
  ok('a chip counts BOTH sides of the fantasy matchup separately',
    buf.homeCount === 2 && buf.awayCount === 1, [buf.homeCount, buf.awayCount]);
  ok('…and a game nobody is in reports zero rather than being hidden',
    lv.homeCount === 0 && lv.awayCount === 0 && lv.homePts === 0);

  // THE LOAD-BEARING ONE. A chip's points use projectEntry, the same blend the
  // side totals use — so the strip and the headline can never disagree.
  const expect = (es) => es.reduce((n, e) => n + projectEntry(e), 0);
  ok('chip points are the board\u2019s own blend, not a second opinion',
    Math.abs(buf.homePts - expect([starters[0].home, starters[1].home])) < 1e-9,
    [buf.homePts, expect([starters[0].home, starters[1].home])]);
  ok('a DONE player is worth what he scored, inside a chip too',
    chips[1].awayPts === 20, chips[1].awayPts);

  ok('state comes off the game, and an inferred FINAL wins over the clock',
    buf.state === 'live' && chips[1].state === 'done', [buf.state, chips[1].state]);
  ok('a chip lists the players it counted', buf.homePlayers.length === 2
    && buf.homePlayers.every((e) => ['BUF', 'HOU'].includes(e.team)));

  // Degenerate slates must not mint chips.
  ok('a half-written slate row claims nothing',
    slateChips(starters, [{ home: 'BUF', away: '' }], now).length === 0);
  ok('an empty slate is an empty strip, not a crash',
    slateChips(starters, [], now).length === 0 && slateChips([], slate, now).length === 3);
  // An unknown kickoff sorts LAST — an unknown time is not midnight.
  const noKick = slateChips(starters, [{ home: 'X', away: 'Y' }, ...slate], now);
  ok('a game with no kickoff sorts last rather than first',
    noKick.at(-1).key === 'Y@X', noKick.map((c) => c.key));

  // ── EVERY GAME'S OWN SCORE (v0.323.0) ────────────────────────────────────
  // Founder: "expand the shown game slate to include all nfl games, not just
  // the one's in the matchup." The games were never missing — a game nobody was
  // in simply arrived EMPTY, so the slate read as matchup-only. These assert the
  // half that fixes it: the score, which every game has whoever is in it.
  {
    const P = (c, hs, as) => ({ c, hs, as });
    const feeds = [
      // Out of order on purpose, and with a REVISION: the last play by clock is
      // 14-10, having been 14-17 earlier in the array. A max() would report 17.
      { key: 'BUF@HOU', plays: [P(600, 7, 10), P(1800, 14, 10), P(1200, 14, 17)] },
      { key: 'SF@LA', plays: [P(3600, 24, 31)] },
      { key: 'LV@DEN', plays: [] },                       // kicked off, no plays yet
    ];
    const sc = slateScores(feeds);
    ok('a game\u2019s score is its LAST play by clock, not its highest',
      sc['BUF@HOU'].home === 14 && sc['BUF@HOU'].away === 10, sc['BUF@HOU']);
    ok('\u2026which is the point: a TD overturned on review LOWERS the score',
      sc['BUF@HOU'].away !== 17);
    ok('a feed with no plays yields no score rather than 0-0',
      sc['LV@DEN'] === undefined, sc['LV@DEN']);
    ok('a tie on the clock keeps the LATER array entry (the revised copy)',
      slateScores([{ key: 'A@B', plays: [P(10, 3, 0), P(10, 3, 7)] }])['A@B'].away === 7);
    ok('feed keys are matched case-insensitively',
      slateScores([{ key: 'sf@la', plays: [P(1, 6, 0)] }])['SF@LA'].home === 6);
    ok('junk feeds are skipped rather than crashing',
      Object.keys(slateScores([null, { key: '' }, { key: 'X@Y', plays: null },
        { key: 'Q@R', plays: [{ c: NaN, hs: 1, as: 2 }] }])).length === 0);
    ok('no feeds at all is an empty map, not a throw',
      Object.keys(slateScores(undefined)).length === 0 && Object.keys(slateScores([])).length === 0);

    const scored = slateChips(starters, slate, now, new Set(['SF', 'LA']), sc);
    ok('the score rides on the chip', scored[0].homeScore === 14 && scored[0].awayScore === 10,
      [scored[0].homeScore, scored[0].awayScore]);
    // THE ONE THAT MATTERS TO THE REQUEST: a game with none of your players
    // still carries its own score.
    const den = scored.find((c) => c.key === 'LV@DEN');
    ok('a game NOBODY in the matchup is in is still a first-class chip',
      den.homeCount === 0 && den.awayCount === 0 && den.state === 'pre', den.state);
    const withDen = slateChips(starters, slate, now, new Set(['SF', 'LA']),
      { ...sc, 'LV@DEN': { home: 3, away: 0 } });
    ok('\u2026and shows a real score when it has one',
      withDen.find((c) => c.key === 'LV@DEN').homeScore === 3);
    ok('a game with no feed reports null, never 0 — 0-0 is a real score',
      scored[2].homeScore === null && scored[2].awayScore === null, scored[2].homeScore);
    ok('omitting scores entirely leaves every chip null rather than breaking',
      slateChips(starters, slate, now).every((c) => c.homeScore === null));
  }

  // ── THE SHEET'S CAPTION COUNTS THE SLATE, NOT YOUR SHARE OF IT ───────────
  // The header read `lineupChipSummary`, which counts only the games this side
  // has a starter in — so a sixteen-game sheet was captioned "8 GAMES".
  {
    const sum = slateSummary(chips);
    ok('slateSummary counts EVERY game', sum.games === 3, sum.games);
    ok('\u2026and says how many the matchup is actually in', sum.involved === 2, sum.involved);
    ok('the two summaries disagree ON PURPOSE — that gap was the bug',
      sum.games > lineupChipSummary(chips, 'home').games,
      [sum.games, lineupChipSummary(chips, 'home').games]);
    ok('states partition the slate exactly once',
      sum.live + sum.done + sum.pre === sum.games, sum);
    ok('an empty slate summarises to zeroes rather than NaN',
      slateSummary([]).games === 0 && slateSummary([]).involved === 0);
  }
}

// ── THE LINEUP CHIP (v0.321.0) ──────────────────────────────────────────────
// The chip that opens the lineup, in the scoreboard column that belonged to
// nobody. It has to be informative enough to justify taking the space, and
// truthful about WHOSE games it is counting.
{
  const E = (slug, team, live, proj, state) => ({ slug, name: slug, pos: 'WR', team, live, proj, state });
  const starters = [
    { slot: 'S1', label: 'QB', pos: ['QB'], home: E('a', 'BUF', 10, 12, 'live'), away: E('b', 'HOU', 5, 9, 'live') },
    { slot: 'S2', label: 'RB', pos: ['RB'], home: E('c', 'BUF', 0, 8, 'pre'), away: E('d', 'KC', 0, 7, 'pre') },
    { slot: 'S3', label: 'WR', pos: ['WR'], home: null, away: E('e', 'SF', 20, 6, 'done') },
  ];
  const slate = [
    { home: 'HOU', away: 'BUF', kickoff: '2026-09-13T17:00:00Z' },   // live, 2 home / 1 away
    { home: 'LA', away: 'SF', kickoff: '2026-09-13T20:05:00Z' },     // done, 1 away
    { home: 'KC', away: 'NE', kickoff: '2026-09-14T00:20:00Z' },     // pre, 1 away
    { home: 'DEN', away: 'LV', kickoff: '2026-09-14T01:00:00Z' },    // nobody in it
  ];
  const now = Date.parse('2026-09-13T18:00:00Z');
  const chips = slateChips(starters, slate, now, new Set(['SF', 'LA']));
  const home = lineupChipSummary(chips, 'home');
  const away = lineupChipSummary(chips, 'away');

  // THE RULE THAT DIFFERS FROM THE STRIP BELOW IT, on purpose. `slateChips`
  // lists every game in the week; this counts only the games this side has a
  // starter in, because "3 LIVE" has to mean three of MINE.
  ok('the chip counts only games this side has a starter in',
    home.games === 1 && away.games === 3, [home.games, away.games]);
  ok('…so a game nobody is in never reaches it',
    !chips.some((c) => c.key === 'LV@DEN' && (c.homeCount || c.awayCount)) && home.games + 0 === 1);

  // GAMES vs STARTERS are different numbers and both are carried: two players
  // in one live game is one game and two starters.
  ok('two starters in one game is ONE live game and TWO players',
    home.live === 1 && home.playersLive === 2, [home.live, home.playersLive]);
  ok('the away side sees its own split', away.live === 1 && away.done === 1 && away.pre === 1,
    [away.live, away.done, away.pre]);

  // TONE drives the colour, and 'live' has to beat everything — a manager with
  // a game on wants that first.
  ok('any live game makes the chip live', home.tone === 'live' && away.tone === 'live');
  ok('the label leads with the live count', home.label === '1 LIVE', home.label);
  ok('the detail splits playing from still to come',
    away.detail === '1 playing · 1 to come', away.detail);

  // A side with nothing left running reads FINAL rather than "0 LIVE".
  const doneOnly = lineupChipSummary(
    slateChips([{ slot: 'S1', label: 'WR', pos: ['WR'], home: E('e', 'SF', 20, 6, 'done'), away: null }],
      [{ home: 'LA', away: 'SF', kickoff: '2026-09-13T20:05:00Z' }], now, new Set(['SF', 'LA'])), 'home');
  ok('a finished slate says ALL FINAL, not 0 LIVE', doneOnly.tone === 'done' && doneOnly.label === 'ALL FINAL',
    [doneOnly.tone, doneOnly.label]);
  ok('…and reports what played', doneOnly.detail === '1 starter played', doneOnly.detail);

  // Before anything starts: the size of the day, and the next kickoff — which
  // is the ONLY place a time appears, because it is the next thing to happen.
  const early = Date.parse('2026-09-13T10:00:00Z');
  const pre = lineupChipSummary(slateChips(starters, slate, early), 'away');
  ok('before kickoff the chip sizes the day', pre.tone === 'pre' && pre.label === '3 GAMES',
    [pre.tone, pre.label]);
  ok('…counts the starters, not the games, in the detail', pre.detail === '3 starters to play', pre.detail);
  ok('…and points at the EARLIEST kickoff still ahead',
    pre.nextKickoff === '2026-09-13T17:00:00Z', pre.nextKickoff);
  ok('singulars are not "1 starters"',
    lineupChipSummary(slateChips([starters[1]], [slate[2]], early), 'away').detail === '1 starter to play');

  // A kickoff nobody knows cannot be the NEXT one — claiming it is would put a
  // countdown on the chip that nothing supports.
  const noTime = lineupChipSummary(
    slateChips([{ slot: 'S1', label: 'WR', pos: ['WR'], home: E('z', 'KC', 0, 5, 'pre'), away: null }],
      [{ home: 'KC', away: 'NE' }], early), 'home');
  ok('an unknown kickoff is not offered as the next one', noTime.nextKickoff === null, noTime.nextKickoff);

  // Degenerate input must produce a chip that says nothing rather than a lie.
  const empty = lineupChipSummary([], 'home');
  ok('no games at all is silent, not "0 GAMES to play"',
    empty.games === 0 && empty.detail === '' && empty.tone === 'pre', empty);
}

// ── THE REHEARSAL POOL (v0.322.0) ───────────────────────────────────────────
// A whole-pool preseason week is indistinguishable from a broken roster unless
// the board says which it is. Detected from the SIZE of what the manager is
// holding, not from the week number.
{
  ok('a real Sleeper roster is not a rehearsal', !isRehearsalPool(20) && !isRehearsalPool(25));
  ok('a whole-pool seed is', isRehearsalPool(1024));
  ok('an empty pool is not a rehearsal either — it is an empty pool',
    !isRehearsalPool(0));
  // The threshold is shared with roster-drop-diag.sql on purpose: the screen
  // and the diagnostic must never disagree about what they are looking at.
  ok('the threshold sits between the two shapes, not near either',
    WHOLE_POOL_MIN > 30 && WHOLE_POOL_MIN < 900, WHOLE_POOL_MIN);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL MATCHUP-BOARD ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
