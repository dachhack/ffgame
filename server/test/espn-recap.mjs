// ESPN adapter: the RECAP-FORM scoring plays and the college PAT / FG grammar
// (v0.664.0). Founder, over a devy league's week: "scoring is off for some
// college players." MD@OSU 2026 wk 6 carried two Ohio State touchdowns as
// scoreboard lines — "Jeremiah Smith 33 Yd pass from Julian Sayin (Connor
// Hawkins Kick)", "Nate Roberts 68 Yd pass from …" — and the parser, which
// reads gamebook grammar, scored nobody on either: Sayin 141/2 for a real
// 242/4, Smith 60/1 for 93/2, Roberts nothing for 68/1. College kickers had
// no extra points ("kick attempt good") and no field goals ("field goal
// attempt from 39 yards GOOD") all season. Synthetic summary, so the shapes
// are pinned without a fetch; every text below is one ESPN actually sent.
import { gameToRealPlays, recapToGamebook, buildRoster, abbrevKeys } from '../../scripts/espn/espnAdapter.mjs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

const athlete = (id, name) => ({ athlete: { id, displayName: name } });
let n = 0;
const play = (typeText, text, offenseId, defenseId, extra = {}) => ({
  id: `40100${++n}`, type: { text: typeText }, text,
  period: { number: 1 }, clock: { displayValue: `${15 - n}:00` },
  start: { team: { id: offenseId }, down: 1, distance: 10 },
  teamParticipants: [{ type: 'offense', id: offenseId }, { type: 'defense', id: defenseId }],
  statYardage: extra.yds ?? 0, scoringPlay: !!extra.sc, isTurnover: !!extra.to,
});
const OSU = '194', MD = '120';
const summary = {
  header: { id: '40100', competitions: [{ competitors: [
    { id: OSU, team: { id: OSU, abbreviation: 'OSU' }, homeAway: 'home' },
    { id: MD, team: { id: MD, abbreviation: 'MD' }, homeAway: 'away' },
  ] }] },
  boxscore: { players: [
    { team: { abbreviation: 'OSU' }, statistics: [
      { name: 'passing', athletes: [athlete('5079712', 'Julian Sayin')] },
      { name: 'rushing', athletes: [athlete('5141517', 'Bo Jackson')] },
      { name: 'receiving', athletes: [athlete('5079720', 'Jeremiah Smith'), athlete('5141656', 'Nate Roberts')] },
      { name: 'kicking', athletes: [athlete('4900001', 'Connor Hawkins')] },
    ] },
    { team: { abbreviation: 'MD' }, statistics: [
      { name: 'passing', athletes: [athlete('5141695', 'Malik Washington')] },
      // A namesake on the other side: "J.Smith" names two men in this game.
      { name: 'receiving', athletes: [athlete('4870770', 'Ray Ray Joseph Jr.'), athlete('4900002', 'Jalen Smith')] },
      { name: 'interceptions', athletes: [athlete('4921326', 'Daniel Wingate')] },
      { name: 'kicking', athletes: [athlete('4900003', "Sean O'Haire")] },
    ] },
  ] },
  drives: { previous: [{ plays: [
    play('Passing Touchdown', 'Jeremiah Smith 33 Yd pass from Julian Sayin (Connor Hawkins Kick)', OSU, MD, { yds: 33, sc: 1 }),
    play('Rushing Touchdown', 'Bo Jackson 2 Yd Run (Two-Point Pass Conversion Failed)', OSU, MD, { yds: 2, sc: 1 }),
    play('Field Goal Good', 'Connor Hawkins 50 Yd Field Goal ', OSU, MD, { yds: 50, sc: 1 }),
    play('Interception Return Touchdown', "Daniel Wingate 52 Yd Interception Return (Sean O'Haire PAT failed)", OSU, MD, { yds: 52, sc: 1, to: 1 }),
    play('Passing Touchdown', "M. Washington pass to R. Joseph Jr. for 7 yds, for a TD (S. O'Haire KICK)", MD, OSU, { yds: 7, sc: 1 }),
    play('Rushing Touchdown', 'B. Jackson run for 25 yds, for a TD (C. Hawkins KICK) (C. Hawkins PAT MISSED)', OSU, MD, { yds: 25, sc: 1 }),
    play('Rushing Touchdown', 'Bo Jackson 1 Yd Run (Julian Sayin Pass to Nate Roberts for Two-Point Conversion)', OSU, MD, { yds: 1, sc: 1 }),
    play('Rushing Touchdown', 'Bo Jackson 3 Yd Run (Julian Sayin Run for Two-Point Conversion)', OSU, MD, { yds: 3, sc: 1 }),
    // The college gamebook's own grammar: PAT and field goal.
    play('Passing Touchdown', '#10 J.Sayin pass complete short left to #4 J.Smith caught at Maryla44, for 40 yards to the Maryla00 TOUCHDOWN, clock 08:32, 1ST DOWN #96 C.Hawkins kick attempt good (H: #42 J.McGuire, LS: #55 D.Riggs)', OSU, MD, { yds: 40, sc: 1 }),
    play('Field Goal Good', '#96 C.Hawkins field goal attempt from 40 yards GOOD (H: #42 J.McGuire, LS: #55 D.Riggs), clock 05:55', OSU, MD, { yds: 40, sc: 1 }),
    play('Field Goal Missed', "#36 S.O'Haire field goal attempt from 39 yards NO GOOD (H: #34 B.McFerson, LS: #97 L.O'Hare), clock 03:55", MD, OSU, { yds: 39 }),
    play('Rushing Touchdown', '#7 M.Washington rush middle for 5 yards gain to the OhioSt00 TOUCHDOWN, clock 11:23 #36 S.O\'Haire kick attempt failed', MD, OSU, { yds: 5, sc: 1 }),
    // Gamebook text with no recap marker passes through untouched.
    play('Pass Reception', '#10 J.Sayin pass complete short right to #83 N.Roberts caught at OhioSt41, for 3 yards to the OhioSt48 (#11 S.Stewart)', OSU, MD, { yds: 3 }),
  ] }] },
};

const pbp = gameToRealPlays(summary, (_n, id) => `c-${id}`);
const rows = (slug, k) => (pbp[slug] ?? []).filter((p) => p.k === k);
const sum = (slug, k, f = 'y') => rows(slug, k).reduce((a, p) => a + (p[f] || 0), 0);

// 1) "X N Yd pass from Y (Z Kick)"
ok(sum('c-5079712', 'pass') === 33 + 40 + 3 && sum('c-5079712', 'pass', 'td') === 2, `Sayin: 76 passing yards (two recap TDs and the gamebook catch), 2 TD (got ${sum('c-5079712', 'pass')}/${sum('c-5079712', 'pass', 'td')})`);
ok(sum('c-5079720', 'rec') === 73 && sum('c-5079720', 'rec', 'td') === 2 && sum('c-5079720', 'rec', 'ca') === 2, 'Jeremiah Smith: 2 catches, 73 yards, 2 TD — and the recap form picked HIM over Jalen Smith');
ok(!pbp['c-4900002'], 'the namesake on the other team got nothing');
// 2) "X N Yd Run (…)", both recap grammars, with the 2-pt notes
ok(sum('c-5141517', 'rush') === 2 + 25 + 1 + 3 && sum('c-5141517', 'rush', 'td') === 4, `Bo Jackson: 31 rushing yards, 4 TD (got ${sum('c-5141517', 'rush')}/${sum('c-5141517', 'rush', 'td')})`);
ok(rows('c-5079712', 'tp_pass').length === 1 && rows('c-5141656', 'tp_rec').length === 1 && rows('c-5079712', 'tp_rush').length === 1, 'two-point pass (Sayin → Roberts) and two-point run (Sayin) from the parenthesized note');
ok(rows('osu-hc', 'hc_2pt').length === 2, 'the coach\'s two 2-pt conversions');
// 3) kickers: recap FG, college FG grammar, "kick attempt good/failed", "PAT failed/MISSED"
ok(rows('c-4900001', 'fg').map((p) => p.y).sort().join() === '40,50' && rows('osu-k', 'fg').length === 2, 'Hawkins: 50-yard recap field goal and the 40-yard "field goal attempt from" one');
ok(rows('c-4900003', 'fgmiss').length === 1 && rows('c-4900003', 'fgmiss')[0].y === 39 && rows('c-4900003', 'fg').length === 0, 'O\'Haire: "NO GOOD" is a miss, not a make');
ok(rows('c-4900001', 'xp').length === 2 && rows('osu-k', 'xp').length === 2, `Hawkins: two extra points — "(Connor Hawkins Kick)" and "kick attempt good" (got ${rows('c-4900001', 'xp').length})`);
ok(rows('c-4900001', 'xpmiss').length === 1, '"(C. Hawkins KICK) (C. Hawkins PAT MISSED)": the later note wins, a miss');
ok(rows('c-4900003', 'xp').length === 1 && rows('c-4900003', 'xpmiss').length === 2, `O'Haire: one "(S. O'Haire KICK)", a "PAT failed" and a "kick attempt failed" (got ${rows('c-4900003', 'xp').length}/${rows('c-4900003', 'xpmiss').length})`);
// 4) "X N Yd Interception Return"
ok(rows('c-4921326', 'int').length === 1 && rows('c-4921326', 'int')[0].y === 52 && rows('c-4921326', 'dst_td').length === 1, 'Wingate: the pick, 52 return yards, the defensive TD');
ok(rows('md-dst', 'int').length === 1 && rows('md-dst', 'dst_td').length === 1, 'MD DST: int + TD');
ok(!rows('c-5079712', 'pass').some((p) => p.to), 'nobody is charged a pick the recap line does not name');
// 5) "F. Last pass to F. Last for N yds, for a TD" — and the two-word first name
ok(sum('c-5141695', 'pass') === 7 && sum('c-5141695', 'pass', 'td') === 1 && sum('c-5141695', 'rush') === 5 && sum('c-5141695', 'rush', 'td') === 1, 'Washington: 7-yard TD pass, 5-yard TD run');
ok(sum('c-4870770', 'rec') === 7 && sum('c-4870770', 'rec', 'td') === 1, 'Ray Ray Joseph Jr. ("R. Joseph Jr.") caught the touchdown');
ok(abbrevKeys('Ray Ray Joseph Jr.').includes('R.Joseph'), 'a two-word first name also indexes as initial + surname');
// 6) gamebook text is untouched
ok(sum('c-5141656', 'rec') === 3 && rows('c-5141656', 'rec').length === 1, 'the ordinary gamebook catch still scores as before');
const roster = buildRoster(summary, (_n, id) => `c-${id}`);
const nfl = 'D.Prescott pass short right to C.Lamb for 12 yards (T.Gipson).';
ok(recapToGamebook(nfl, roster) === nfl, 'recapToGamebook: NFL gamebook text passes through');
ok(recapToGamebook('Team Safety', roster, 'Safety') === 'Team Safety', 'recapToGamebook: "Team Safety" passes through');
ok(recapToGamebook('Justin Jefferson 13 Yd pass from J.J. McCarthy (Two-Point Pass Conversion Failed)', new Map(), 'Passing Touchdown')
  === 'J.McCarthy pass complete to J.Jefferson for 13 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ATTEMPT FAILS.', 'recapToGamebook: the NFL recap form (MIN@CHI 2025 wk 1), "J.J. McCarthy" → "J.McCarthy"');

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL ESPN-RECAP ASSERTIONS PASSED');
