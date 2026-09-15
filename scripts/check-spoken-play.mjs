// Guard for THE PLAY, SAID OUT LOUD + THE READER (v0.389.0).
//
// Founder: "have the option to expand the play by play for each game and have
// it read off to you — catch up or live." Both hosts speak through these two
// modules, so what a voice says and when it says it is pinned here, against
// real gamebook lines from 2026 week 1 (LAC@ARI, DEN@KC).
// Run: npx tsx scripts/check-spoken-play.mjs
import { spokenText, spokenPlay, spokenDown, spokenScore, clubCity, clubNick } from '../packages/core/src/data/spokenPlay.ts';
import { PlayReader } from '../packages/core/src/data/playReader.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const eq = (got, want, label) => ok(got === want, `${label}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);

// ── 1. The sentence ────────────────────────────────────────────────────────
eq(spokenText('K.Walker right end to DEN 5 for 3 yards (M.Roach; P.Surtain).', 'Rush'),
  'K. Walker right end to the Denver 5 for 3 yards, tackled by M. Roach and P. Surtain.',
  'a rush: initial spaced, club read as a city, the parenthetical read as the tackle');
eq(spokenText('(Shotgun) J.Brissett pass short right to Mi.Wilson to LAC 22 for 10 yards (D.Jackson).', 'Pass Reception'),
  'J. Brissett pass short right to Mi. Wilson to the Los Angeles 22 for 10 yards, tackled by D. Jackson.',
  'a pass: the formation note dropped, the gamebook\'s two-letter prefix kept ("Mi. Wilson")');
eq(spokenText('(No Huddle, Shotgun) J.Brissett pass incomplete deep right to Mi.Wilson (C.Hart).', 'Pass Incompletion'),
  'J. Brissett pass incomplete deep right to Mi. Wilson, broken up by C. Hart.',
  'an incompletion: the parenthetical is coverage, not a tackle');
eq(spokenText('(5:33) (No Huddle, Shotgun) J.Brissett pass short right to Mi.Wilson to ARZ 41 for 14 yards (C.Hart) [T.Tuipulotu]', 'Pass Reception'),
  'J. Brissett pass short right to Mi. Wilson to the Arizona 41 for 14 yards, tackled by C. Hart.',
  'a clock stamp, two notes and the bracketed hurry dropped; ESPN\'s ARZ reads as Arizona');
eq(spokenText('J.Brissett pass short middle to Mi.Wilson to ARZ 47 for 6 yards (D.Phillips).PENALTY on ARZ-H.Froholdt, Offensive Holding, 10 yards, enforced at JAX 39 - No Play.', 'Pass Reception'),
  'J. Brissett pass short middle to Mi. Wilson to the Arizona 47 for 6 yards, tackled by D. Phillips. Penalty on Arizona, H. Froholdt, Offensive Holding, 10 yards, no play.',
  'a penalty reads plainly: club, player, foul, yards, no play');
eq(spokenText('C.Santos 40 yard field goal is GOOD, Center-B.Gardner, Holder-T.Taylor.', 'Field Goal Good'),
  'C. Santos 40 yard field goal is good, Center-B. Gardner, Holder-T. Taylor.',
  'a field goal: "is GOOD" lower-cased for the voice');
eq(spokenText('(Shotgun) J.Brissett pass deep right to Mi.Wilson pushed ob at LAC 25 for 17 yards (T.Still).', 'Pass Reception'),
  'J. Brissett pass deep right to Mi. Wilson pushed out of bounds at the Los Angeles 25 for 17 yards, tackled by T. Still.',
  '"pushed ob" reads as out of bounds');

// ── 2. Down and distance ───────────────────────────────────────────────────
eq(spokenDown({ dn: 1, dist: 10, yl: 75 }), 'First and 10', 'first and ten');
eq(spokenDown({ dn: 3, dist: 5, yl: 5 }), 'Third and goal', 'goal to go when the distance reaches the end zone');
eq(spokenDown({ dn: 0, dist: 0, yl: 65 }), null, 'a kickoff has no down');

// ── 3. The whole play, with the score when it moves ────────────────────────
const P = (o) => ({ c: 0, drv: 0, tm: 'KC', dn: 1, dist: 10, yl: 30, yl2: 25, ty: 'Rush', txt: 'x', hs: 0, as: 0, ...o });
const ctx = { home: 'KC', away: 'DEN' };
eq(spokenPlay(P({ dn: 1, dist: 5, yl: 5, txt: 'K.Walker right end to DEN 5 for 3 yards (M.Roach; P.Surtain).' }), ctx),
  'First and goal. K. Walker right end to the Denver 5 for 3 yards, tackled by M. Roach and P. Surtain.',
  'situation first, then the sentence; no score line when nothing scored');
eq(spokenPlay(P({ dn: 2, dist: 2, yl: 2, txt: 'K.Walker up the middle for 2 yards, TOUCHDOWN.', sc: 1, hs: 6, as: 0 }), { ...ctx, prev: P({}) }),
  'Second and goal. K. Walker up the middle for 2 yards, touchdown. Broncos 0, Chiefs 6.',
  'a scoring play ends with the score, away first, nicknames');
eq(spokenScore({ hs: 24, as: 17 }, ctx), 'Broncos 17, Chiefs 24.', 'the scoreline alone');
ok(clubCity('WSH') === 'Washington' && clubNick('SF') === '49ers' && clubCity('XYZ') === 'XYZ', 'ESPN spellings map; an unknown club passes through');

// ── 4. The reader ──────────────────────────────────────────────────────────
// A synchronous voice: every `speak` completes at once and is logged.
const said = [];
let stops = 0;
const voice = { speak: (t, done) => { said.push(t); done(); }, stop: () => { stops++; } };
const plays = [
  P({ pid: 1, txt: 'K.Walker right end to DEN 5 for 3 yards (M.Roach).', dn: 1, dist: 10, yl: 30 }),
  P({ pid: 2, txt: 'P.Mahomes pass short left to T.Kelce for 5 yards, TOUCHDOWN.', dn: 2, dist: 7, yl: 5, sc: 1, hs: 6, as: 0 }),
  P({ pid: 3, txt: 'H.Butker extra point is GOOD.', dn: 0, dist: 0, yl: 15, hs: 7, as: 0 }),
];
{
  said.length = 0;
  const r = new PlayReader(voice, ctx);
  r.catchUp(plays.slice(0, 2), false);
  ok(said.length === 2 && said[0].startsWith('First and 10.') && said[1].endsWith('Broncos 0, Chiefs 6.'),
    'CATCH UP says every play from the top, in order, with the score on the touchdown');
  ok(r.state().mode === 'live', 'caught up on a live game → the reader is now LIVE, waiting for the feed');
  r.update(plays, false);
  ok(said.length === 3 && said[2].includes('extra point is good'), 'a new play in the feed is said once it lands');
  r.update(plays, false);
  ok(said.length === 3, 'the same feed again says nothing new');
  r.update(plays, true);
  ok(said.length === 4 && said[3] === "That's the final. Broncos 0, Chiefs 7." && r.state().mode === 'idle',
    'the game going final says the final score once and stops');
  r.update(plays, true);
  ok(said.length === 4, 'the final is said once, not on every tick');
}
{
  said.length = 0;
  const r = new PlayReader(voice, ctx);
  r.live(plays, false);
  ok(said.length === 1 && said[0].includes('extra point'), 'LIVE says only the latest play, then waits');
  r.update([...plays, P({ pid: 4, txt: 'H.Butker kicks 65 yards from KC 35 to end zone, Touchback.', dn: 0, dist: 0, yl: 65, hs: 7, as: 0 })], false);
  ok(said.length === 2 && said[1].includes('Touchback'), 'the next play to land is said');
}
{
  // An asynchronous voice: STOP mid-sentence must swallow the late `done`.
  said.length = 0; stops = 0;
  let pending = null;
  const slow = { speak: (t, done) => { said.push(t); pending = done; }, stop: () => { stops++; } };
  const r = new PlayReader(slow, ctx);
  r.catchUp(plays, false);
  ok(said.length === 1 && r.state().speaking, 'a slow voice: one sentence in flight');
  r.stop();
  ok(stops >= 1 && r.state().mode === 'idle' && !r.state().speaking, 'STOP cuts the voice and idles the reader');
  pending();
  ok(said.length === 1, 'the cut sentence\'s late `done` does not start the next one');
  r.catchUp(plays, false);
  ok(said.length === 2 && said[1] === said[0], 'resuming after a stop re-says the cut play (the cursor had not advanced past it)');
}

console.log(fails ? `\n${fails} SPOKEN-PLAY PROBE(S) FAILED` : '\nALL SPOKEN-PLAY PROBES PASSED');
process.exit(fails ? 1 : 0);
