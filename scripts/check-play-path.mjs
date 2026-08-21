// THE PLAY PATH SPLIT (v0.332.0), checked in Node.
//
// Founder, on a punt: "we've got a double line thing going on." Both field
// views drew the AIR and CARRY halves of a play on the same horizontal line.
// For a pass that is right — the run-after continues the same way, so they meet
// end to end. For a KICK the returner runs BACK the way the ball came, so the
// runback retraced the arc in the same colour at the same y and read as one
// line drawn twice.
//
// In check:parity because the geometry is shared by two platforms that each
// used to own a copy, and because "do these two strokes lie on top of each
// other" is exactly the kind of thing you cannot see in a diff.
import { playPath, arcControlY, playSide, playSideDy } from '../packages/core/src/engine/playPath';
import { unopposedCopy, claimsOpponentAbsent } from '../packages/core/src/data/slotLabels';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// The FieldViews' own constants and xOf, so this tests the REAL geometry.
const W = 400, EZ = 26, FX = EZ, FW = W - 2 * EZ;
const AWAY = 'LV';
const xOf = (yte, tm) => FX + ((tm === AWAY ? 100 - yte : yte) / 100) * FW;
const run = (cur) => {
  const x1 = xOf(cur.yl, cur.tm);
  const x2 = xOf(cur.yl2, cur.tm2 ?? cur.tm);
  return { ...playPath(cur, x1, x2, xOf), x1, x2 };
};

// ── A PASS MEETS END TO END ────────────────────────────────────────────────
{
  const r = run({ ty: 'Pass Reception', tm: 'HOU', yl: 75, yl2: 45, yac: 15 });
  ok('a completed pass splits at the catch', r.carrying && r.catchX != null);
  ok('…and its two halves do NOT overlap — the run-after continues forward',
    !r.overlaps, r);
}

// ── A KICK DOUBLES BACK: THE CASE THAT WAS REPORTED ────────────────────────
{
  const punt = run({ ty: 'Punt', tm: 'HOU', tm2: 'LV', yl: 70, yl2: 75, ret: 12 });
  ok('a punt with a return splits', punt.carrying);
  ok('…and its halves DO overlap — the runback retraces the flight',
    punt.overlaps, punt);
  const ko = run({ ty: 'Kickoff', tm: 'HOU', tm2: 'LV', yl: 65, yl2: 70, ret: 25 });
  ok('a returned kickoff overlaps too', ko.overlaps, ko);
}

// ── PLAYS THAT NEVER SPLIT ─────────────────────────────────────────────────
{
  ok('a plain rush is one stroke', !run({ ty: 'Rush', tm: 'HOU', yl: 70, yl2: 62 }).carrying);
  ok('a sack is one stroke', !run({ ty: 'Sack', tm: 'HOU', yl: 70, yl2: 77 }).carrying);
  ok('an incompletion is one stroke — nothing was carried',
    !run({ ty: 'Pass Incompletion', tm: 'HOU', yl: 70, yl2: 70 }).carrying);
  ok('a catch with no yac does not split',
    !run({ ty: 'Pass Reception', tm: 'HOU', yl: 75, yl2: 45 }).carrying);
  ok('a return of zero does not draw a zero-length carry',
    !run({ ty: 'Punt', tm: 'HOU', tm2: 'LV', yl: 70, yl2: 75, ret: 0 }).carrying);
  ok('nothing at all is not a crash', !playPath(null, 0, 0, xOf).carrying);
}

// ── THE CLAMPS ARE REAL, NOT DECORATION ────────────────────────────────────
{
  const deep = run({ ty: 'Kickoff', tm: 'HOU', tm2: 'LV', yl: 65, yl2: 98, ret: 30 });
  ok('a kick fielded in the end zone still yields a finite split',
    Number.isFinite(deep.catchX), deep);
  const silly = run({ ty: 'Pass Reception', tm: 'HOU', yl: 75, yl2: 45, yac: 900 });
  ok('an absurd yac is clamped rather than drawn off the field',
    silly.catchX <= xOf(100, 'HOU') + 0.01 && silly.catchX >= FX - 0.01, silly);
}

// ── THE ARC'S HEIGHT SCALES WITH THE THROW (v0.333.0) ──────────────────────
// It was pinned at TOP-6 whatever the distance, so a five-yard checkdown got a
// 50-yard bomb's apex squeezed into a fifth of the width — a tall narrow spike
// over a short flat line, which is why one play read as two marks.
{
  const TOP = 12, MID = 63;                       // the FieldViews' own numbers
  const y = (d) => arcControlY(0, d, MID, TOP);
  ok('a long throw keeps exactly the height it had — no regression',
    Math.abs(y(200) - (TOP - 6)) < 0.01, y(200));
  ok('a short throw is much lower than a long one', y(17) > y(200) + 20, [y(17), y(200)]);
  ok('…but still visibly airborne, or a pass looks like a run', y(17) < MID - 10, y(17));
  ok('height never dips below the baseline', y(0) < MID && y(1) < MID);
  ok('it rises with distance and never falls', (() => {
    let prev = Infinity;
    for (let d = 0; d <= 250; d += 5) { const v = y(d); if (v > prev + 1e-9) return false; prev = v; }
    return true;
  })());
  ok('it is clamped at the top — a cross-field throw does not leave the card',
    y(10_000) === TOP - 6, y(10_000));
  ok('direction does not matter, only distance',
    Math.abs(arcControlY(300, 100, MID, TOP) - arcControlY(100, 300, MID, TOP)) < 1e-9);
  ok('junk input does not produce NaN',
    Number.isFinite(y(NaN)) && Number.isFinite(arcControlY(undefined, null, MID, TOP)));
}

// ── AN EMPTY HALF OF A SLOT MEANS TWO DIFFERENT THINGS (v0.334.0) ─────────
// Founder: "hmm game hasn't started yet and this is unopposed, but there's a
// whole full roster on my opponent's side." Nothing was wrong with the roster —
// one component draws both a genuinely UNOPPOSED STARTER (the opponent really
// did leave the spot empty) and a BACKUP (no counterpart anywhere, by
// construction), and they shared the same words.
{
  const starter = unopposedCopy(false);
  const backup = unopposedCopy(true);

  // THE RULE, asserted rather than the wording — which is free to change.
  ok('an unopposed STARTER may say the opponent is absent, because they are',
    claimsOpponentAbsent(starter), starter);
  ok('a BACKUP must NEVER say it — it has no counterpart to be absent',
    !claimsOpponentAbsent(backup), backup);

  ok('the two are actually different', starter.blank !== backup.blank && starter.chip !== backup.chip);
  ok('both halves are filled — a blank blank is how this went unnoticed',
    [starter, backup].every((c) => c.blank.trim() && c.chip.trim()));
  ok('the backup copy names what it IS', /BACKUP|BENCH/i.test(`${backup.blank} ${backup.chip}`), backup);
  // The chip sits in a fixed-width strip beside the row.
  ok('the chips stay short enough for the strip',
    starter.chip.length <= 8 && backup.chip.length <= 8, [starter.chip, backup.chip]);
}

// ── WHICH SIDE THE PLAY WENT (v0.335.0) ───────────────────────────────────
// Founder: "If the play says right or left can we have the play draw on that
// side of the field?" ESPN's text says so; the field drew everything down the
// centre line.
{
  // Real ESPN strings, including the one from the founder's screenshot.
  ok('a short right pass is right',
    playSide("(Shotgun) A.O'Connell pass short right to D.Laube to HST 4 for 14 yards (J.Reed).") === 'right');
  ok('a deep left pass is left', playSide('J.Allen pass deep left to S.Diggs for 34 yards') === 'left');
  ok('up the middle is middle', playSide('D.Henry rush up the middle for 3 yards') === 'middle');
  ok('a run direction counts too', playSide('S.Barkley rush left tackle for 8 yards') === 'left');
  ok('no direction is null', playSide('D.Henry rush for no gain') === null);
  ok('empty and null never throw', playSide('') === null && playSide(null) === null && playSide(undefined) === null);

  // THE CASE THE WORD BOUNDARY EXISTS FOR. Play text is full of names, and a
  // play drawn on the wrong side looks exactly as plausible as the right one.
  ok('a receiver called Wright is not a direction',
    playSide('J.Goff pass short middle to J.Wright for 9 yards') === 'middle');
  ok('…and Wright alone names no side', playSide('J.Goff pass to J.Wright for 9 yards') === null);
  ok('a tackler called Leftwich is not a direction',
    playSide('D.Henry rush for 3 yards (B.Leftwich)') === null);
  ok('the FIRST direction wins — later ones are surnames',
    playSide('A.Rodgers pass short right to C.Left for 5 yards') === 'right');
  ok('case does not matter', playSide('PASS DEEP LEFT') === 'left');
}

// ── THE SIGN IS THE PART THAT GETS DRAWN BACKWARDS ────────────────────────
// "Right" is the OFFENSE's right. An offense moving right on screen has its
// right hand toward the bottom; moving left, toward the top. Same word, opposite
// pixels — and a flipped field mirrors it again.
{
  const LANE = 22;
  ok('attacking right, a right-side play draws DOWN the screen',
    playSideDy('right', true, LANE) === LANE);
  ok('attacking right, a left-side play draws UP',
    playSideDy('left', true, LANE) === -LANE);
  ok('attacking LEFT, the same word draws the other way',
    playSideDy('right', false, LANE) === -LANE && playSideDy('left', false, LANE) === LANE);
  ok('middle is dead centre whichever way they attack',
    playSideDy('middle', true, LANE) === 0 && playSideDy('middle', false, LANE) === 0);
  ok('an unnamed side is centre, not a guess',
    playSideDy(null, true, LANE) === 0 && playSideDy(null, false, LANE) === 0);
  ok('left and right are always opposite each other',
    playSideDy('left', true, LANE) === -playSideDy('right', true, LANE)
    && playSideDy('left', false, LANE) === -playSideDy('right', false, LANE));
  ok('the offset scales with the lane it is given',
    playSideDy('right', true, 10) === 10 && playSideDy('right', true, 0) === 0);
}

if (fails) { console.log(`\n${fails} PLAY-PATH ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL PLAY-PATH ASSERTIONS PASSED');
