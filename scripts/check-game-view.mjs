// Guard for THE GAME VIEW'S WORDS (core data/gameView, v0.390.3).
//
// Founder: "the sleeper field view is pretty good can we emulate this?" Its
// header, drive line and play rows are readings off the play feed; both
// hosts' Game views take them from here, pinned against real week-1 lines.
// Run: npx tsx scripts/check-game-view.mjs
import { qClock, spotLabel, situationLabel, driveSummary, playNames, ballCarrier, stripEligible } from '../packages/core/src/data/gameView.ts';
import { namesFromSlugs, resolveGamebookPerson } from '../packages/core/src/engine/gameNames.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const eq = (got, want, label) => ok(got === want, `${label}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);

eq(qClock(0), 'Q1 15:00', 'kickoff reads Q1 15:00');
eq(qClock(900 + 627), 'Q2 04:33', '1527s in reads Q2 04:33 (Sleeper\'s 2Q 04:33)');
eq(qClock(3300), 'OT', 'past regulation reads OT');
eq(spotLabel('KC', 80, 'KC', 'DEN'), 'KC 20', '80 to go from KC\'s view is the KC 20');
eq(spotLabel('KC', 35, 'KC', 'DEN'), 'DEN 35', '35 to go is the DEN 35');
eq(spotLabel('KC', 50, 'KC', 'DEN'), '50', 'midfield is the 50');
eq(situationLabel({ dn: 3, dist: 10, yl: 80, tm: 'KC' }, 'KC', 'DEN'), '3rd & 10 · KC 20', 'the header situation: 3rd & 10 · KC 20');
eq(situationLabel({ dn: 2, dist: 4, yl: 4, tm: 'DEN' }, 'KC', 'DEN'), '2nd & Goal · KC 4', 'goal to go names the defended end');
eq(situationLabel({ dn: 0, dist: 0, yl: 65, tm: 'KC' }, 'KC', 'DEN'), null, 'a kickoff has no situation');

const P = (o) => ({ c: 0, drv: 3, tm: 'KC', dn: 1, dist: 10, yl: 80, yl2: 80, ty: 'Rush', txt: '', hs: 7, as: 7, ...o });
{
  const plays = [
    P({ drv: 2, tm: 'DEN', ty: 'Punt', txt: 'R.Dixon punts 45 yards to KC 20, Center-M.Fraboni. K.Walker to KC 20 for no gain.', yl: 35, yl2: 80, tm2: 'KC' }),
    P({ drv: 3, ty: 'Pass Incompletion', txt: '(Shotgun) P.Mahomes pass incomplete short right to K.Walker.', dn: 1, yl: 80, yl2: 80 }),
    P({ drv: 3, ty: 'Pass Incompletion', txt: '(Shotgun) P.Mahomes pass incomplete deep left to R.Rice (P.Surtain).', dn: 2, yl: 80, yl2: 80 }),
    P({ drv: 3, ty: 'Rush', txt: 'K.Walker right end to KC 23 for 3 yards (M.Roach; P.Surtain).', dn: 3, yl: 80, yl2: 77 }),
  ];
  const d = driveSummary({ plays, home: 'KC', away: 'DEN' });
  eq(d.text, 'KC from own 20 · 3 plays · 0/2 pass · 3 yds', 'THE DRIVE LINE: Sleeper\'s "KC from own 20: 2-plays, 0/2 pass", with the third play in');
  ok(d.rush === 1 && !d.scored, 'one rush, nothing scored');
  eq(driveSummary({ plays: [], home: 'KC', away: 'DEN' }), null, 'no plays, no drive');
}
{
  ok(JSON.stringify(playNames('K.Walker right end to KC 23 for 3 yards (M.Roach; P.Surtain).')) === JSON.stringify(['K.Walker', 'M.Roach', 'P.Surtain']),
    'every name on a play, in order');
  eq(ballCarrier({ ty: 'Rush', txt: 'K.Walker right end to KC 23 for 3 yards (M.Roach; P.Surtain).' }), 'K.Walker', 'a rush: the rusher has the ball');
  eq(ballCarrier({ ty: 'Pass Reception', txt: '(Shotgun) P.Mahomes pass short right to K.Walker to KC 28 for 8 yards (D.Jones).' }), 'K.Walker', 'a completion: the receiver has the ball');
  eq(ballCarrier({ ty: 'Pass Incompletion', txt: '(Shotgun) P.Mahomes pass incomplete short right to K.Walker.' }), 'K.Walker', 'an incompletion: the target (Sleeper shows K. Walker)');
  eq(ballCarrier({ ty: 'Punt', txt: 'R.Dixon punts 45 yards to KC 20, Center-M.Fraboni. K.Walker to KC 20 for no gain.' }), 'K.Walker', 'a punt: the returner');
  eq(ballCarrier({ ty: 'Timeout', txt: 'Timeout #1 by KC at 04:33.' }), null, 'a timeout names nobody');
  const people = namesFromSlugs(['kenneth-walker', 'patrick-mahomes', 'rashee-rice']);
  eq(resolveGamebookPerson(people, 'K.Walker')?.slug, 'kenneth-walker', 'the carrier resolves to a slug for the headshot');
}

// ── the jumbo package (v0.390.4, founder: "Tonga?") ─────────────────────────
{
  const J1 = '(Shotgun) H.Nourzad and K.Tonga reported in as eligible.  K.Walker up the middle to DEN 35 for 3 yards (E.Uwazurike; T.Hufanga).';
  const J2 = 'J.Ezeudu, J.Moore and K.Tonga reported in as eligible.  K.Walker left end for 60 yards, TOUCHDOWN. H.Butker extra point is GOOD, Center-J.Winchester, Holder-M.Araiza.';
  eq(stripEligible(J1), '(Shotgun) K.Walker up the middle to DEN 35 for 3 yards (E.Uwazurike; T.Hufanga).', 'the preamble goes; the formation note before it stays');
  eq(stripEligible(J2), 'K.Walker left end for 60 yards, TOUCHDOWN. H.Butker extra point is GOOD, Center-J.Winchester, Holder-M.Araiza.', 'a three-man preamble at the very start goes');
  eq(ballCarrier({ ty: 'Rush', txt: J1 }), 'K.Walker', 'THE POINT: the carrier is Walker, not the reported-eligible tackle');
  eq(ballCarrier({ ty: 'Rushing Touchdown', txt: J2 }), 'K.Walker', 'the 60-yard touchdown is Walker\'s');
  ok(!playNames(J1).includes('K.Tonga') && !playNames(J1).includes('H.Nourzad'), 'the linemen are not "on" the play');
  eq(stripEligible('(Shotgun) J.Dobbins up the middle to KC 39 for 4 yards (K.Tonga; G.Karlaftis).'), '(Shotgun) J.Dobbins up the middle to KC 39 for 4 yards (K.Tonga; G.Karlaftis).', 'a play without the clause is untouched — Tonga keeps his tackle');
}

console.log(fails ? `\n${fails} GAME-VIEW PROBE(S) FAILED` : '\nALL GAME-VIEW PROBES PASSED');
process.exit(fails ? 1 : 0);
