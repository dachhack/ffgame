// FEED INGEST: EVERY ACTION A SCORING KNOB READS (v0.533.0).
//
// Founder: "how is our feed ingest for these metrics? do we capture all these
// actions?" The audit (48 real 2025 games, before/after) found ESPN filing
// ordinary plays under types the adapter never looked at, and tacklers that
// were not at the very end of the text. Each case here is a REAL 2025 play
// text, run through gameToRealPlays exactly as the poller does.
// Run: tsx scripts/check-feed-ingest.mjs
import { readFileSync } from 'node:fs';
import { gameToRealPlays } from './espn/espnAdapter.mjs';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// A one-play game. `off`/`def` are the ESPN participants; `people` are
// { name, team, cat } boxscore entries (cat: passing/rushing/receiving/defensive).
const TEAMS = { NE: '1', PIT: '2', MIA: '3', CIN: '4', MIN: '5', KC: '6', LAC: '7', ATL: '8', CHI: '9', BAL: '10' };
function game({ type, text, off, def, start = off, spot, down = 1, dist = 10, yds = 0, turnover = false, scoring = false, people }) {
  const byTeam = {};
  for (const p of people) (byTeam[p.team] ||= []).push(p);
  return gameToRealPlays({
    header: { id: '9', competitions: [{ competitors: Object.entries(TEAMS).map(([ab, id]) => ({ id, team: { abbreviation: ab } })) }] },
    boxscore: { players: Object.entries(byTeam).map(([team, ps]) => ({
      team: { abbreviation: team },
      statistics: ['passing', 'rushing', 'receiving', 'defensive'].map((cat) => ({
        name: cat, athletes: ps.filter((p) => p.cat === cat).map((p) => ({ athlete: { id: p.name, displayName: p.name } })),
      })),
    })) },
    drives: { previous: [{ plays: [{
      id: '91', type: { text: type }, text, period: { number: 2 }, clock: { displayValue: '5:00' },
      start: { team: { id: TEAMS[start] }, down, distance: dist, ...(spot ? { possessionText: spot } : {}) }, statYardage: yds, isTurnover: turnover, scoringPlay: scoring,
      teamParticipants: [{ type: 'offense', id: TEAMS[off] }, { type: 'defense', id: TEAMS[def] }],
    }] }] },
  });
}
const kinds = (pbp, slug) => (pbp[slug] ?? []).map((r) => r.k);
const rowOf = (pbp, slug, k) => (pbp[slug] ?? []).find((r) => r.k === k);

// ── a lost fumble on a run: the run counts, the runner is charged ─────────
{
  const pbp = game({ type: 'Fumble Recovery (Opponent)', off: 'NE', def: 'PIT', turnover: true, yds: -6,
    text: '(Shotgun) A.Gibson up the middle to PIT 42 for 1 yard (T.Watt; J.Peppers). FUMBLES (T.Watt), RECOVERED by PIT-J.Peppers at PIT 43.',
    people: [{ name: 'Antonio Gibson', team: 'NE', cat: 'rushing' }, { name: 'T.J. Watt', team: 'PIT', cat: 'defensive' }, { name: 'Jabrill Peppers', team: 'PIT', cat: 'defensive' }] });
  const run = rowOf(pbp, 'antonio-gibson', 'rush');
  // Yards run to where the ball was recovered (PIT 42 → PIT 43): 1 − 1 = 0.
  ok('a fumbled run still counts as a carry, yards to the recovery spot', run && run.y === 0, run);
  ok('…and the runner is charged the lost fumble (to)', run && run.to === 1, run);
  ok('the fumble is the RUNNER\'s, not the tackler\'s', kinds(pbp, 'antonio-gibson').includes('fum') && !kinds(pbp, 'jabrill-peppers').includes('fum'));
  ok('the defenders who made the tackle before the fumble are credited', kinds(pbp, 'j-watt').length + kinds(pbp, 'tj-watt').length > 0 || kinds(pbp, 'jabrill-peppers').includes('tackle'), pbp);
  ok('no first down on a lost fumble', !run?.fd);
}
// ── a lost fumble after a catch: the catch counts ─────────────────────────
{
  const pbp = game({ type: 'Fumble Recovery (Opponent)', off: 'CIN', def: 'MIN', turnover: true,
    text: '(Shotgun) J.Browning pass short right to N.Fant to MIN 32 for 4 yards (I.Rodgers). FUMBLES (I.Rodgers), RECOVERED by MIN-I.Rodgers at MIN 34. I.Rodgers to CIN 40 for 26 yards (J.Browning).',
    people: [{ name: 'Jake Browning', team: 'CIN', cat: 'passing' }, { name: 'Noah Fant', team: 'CIN', cat: 'receiving' }, { name: 'Isaiah Rodgers', team: 'MIN', cat: 'defensive' }] });
  ok('the completion counts for the passer', rowOf(pbp, 'jake-browning', 'pass')?.cp === 1, pbp['jake-browning']);
  const rec = rowOf(pbp, 'noah-fant', 'rec');
  // MIN 32 → recovered at MIN 34: 4 − 2 = 2.
  ok('the catch counts for the receiver, who is charged the fumble', rec && rec.y === 2 && rec.to === 1, rec);
  ok('the QB who tackles the returner gets an offensive tackle', kinds(pbp, 'jake-browning').includes('tackle'), pbp['jake-browning']);
  ok('team defense return yards are recorded', rowOf(pbp, 'min-dst', 'fumrec')?.y === 26, pbp['min-dst']);
}
// ── a sack fumbled and kept: the team and the sacker get the sack ─────────
{
  const pbp = game({ type: 'Fumble Recovery (Own)', off: 'KC', def: 'LAC', yds: -7,
    text: '(Shotgun) P.Mahomes sacked at KC 24 for -7 yards (K.Mack). FUMBLES (K.Mack), recovered by KC-T.Kelce at KC 26.',
    people: [{ name: 'Patrick Mahomes', team: 'KC', cat: 'passing' }, { name: 'Travis Kelce', team: 'KC', cat: 'receiving' }, { name: 'Khalil Mack', team: 'LAC', cat: 'defensive' }] });
  ok('the team defense gets the sack', kinds(pbp, 'lac-dst').includes('sack'), pbp['lac-dst']);
  const sk = rowOf(pbp, 'khalil-mack', 'sack');
  ok('the sacker gets the sack with its yards', sk && sk.y === 7, pbp['khalil-mack']);
  ok('the QB is marked sacked, not charged a lost fumble', rowOf(pbp, 'patrick-mahomes', 'pass')?.sk === 1 && !rowOf(pbp, 'patrick-mahomes', 'pass')?.to);
}
// ── a kickoff-return TD belongs to the RECEIVING side ─────────────────────
{
  const pbp = game({ type: 'Kickoff Return Touchdown', off: 'NE', def: 'MIA', start: 'MIA', scoring: true,
    text: 'R.Patterson kicks 55 yards from MIA 35 to NE 10. A.Gibson for 90 yards, TOUCHDOWN.',
    people: [{ name: 'Antonio Gibson', team: 'NE', cat: 'rushing' }] });
  ok('the kickoff-return TD is the returning team\'s', kinds(pbp, 'ne-dst').includes('dst_td') && !kinds(pbp, 'mia-dst').includes('dst_td'), { ne: pbp['ne-dst'], mia: pbp['mia-dst'] });
}
// ── a 4th-down field goal is not a conversion ─────────────────────────────
{
  const pbp = game({ type: 'Field Goal Good', off: 'KC', def: 'LAC', down: 4, dist: 6, yds: 45,
    text: 'H.Butker 45 yard field goal is GOOD, Center-J.Winchester, Holder-M.Araiza.', people: [] });
  ok('a 4th-down field goal does not credit the coach a conversion', !kinds(pbp, 'kc-hc').includes('hc_4dc'), pbp['kc-hc']);
  const run = game({ type: 'Rush', off: 'KC', def: 'LAC', down: 4, dist: 1, yds: 3,
    text: 'I.Pacheco up the middle to LAC 30 for 3 yards (D.James).',
    people: [{ name: 'Isiah Pacheco', team: 'KC', cat: 'rushing' }, { name: 'Derwin James', team: 'LAC', cat: 'defensive' }] });
  ok('a 4th-down run that moves the chains does', kinds(run, 'kc-hc').includes('hc_4dc'), run['kc-hc']);
}
// ── tacklers that are not at the very end of the text ─────────────────────
{
  const pbp = game({ type: 'Rush', off: 'KC', def: 'LAC', yds: 4,
    text: 'I.Pacheco left end to LAC 30 for 4 yards (D.James) [K.Mack]. PENALTY on KC-J.Smith, Offensive Holding, 10 yards, enforced at LAC 34.',
    people: [{ name: 'Isiah Pacheco', team: 'KC', cat: 'rushing' }, { name: 'Derwin James', team: 'LAC', cat: 'defensive' }, { name: 'Khalil Mack', team: 'LAC', cat: 'defensive' }] });
  ok('a tackler followed by a bracket and a penalty is still credited', kinds(pbp, 'derwin-james').includes('tackle'), pbp['derwin-james']);
}
// ── safeties, aborted snaps, muffed punts, negative returns ───────────────
{
  const pbp = game({ type: 'Safety', off: 'NE', def: 'PIT', text: 'Team Safety', people: [] });
  ok('a "Safety"-typed play credits the defense', kinds(pbp, 'pit-dst').includes('safety'), pbp['pit-dst']);
  const nul = game({ type: 'Rush', off: 'NE', def: 'PIT', text: 'R.Stevenson up the middle for -2 yards. SAFETY NULLIFIED on review.', people: [{ name: 'Rhamondre Stevenson', team: 'NE', cat: 'rushing' }] });
  ok('a nullified safety is not one', !kinds(nul, 'pit-dst').includes('safety'), nul['pit-dst']);
  const ab = game({ type: 'Fumble Recovery (Own)', off: 'NE', def: 'PIT', text: '(Shotgun) D.Maye Aborted. G.Bradbury FUMBLES (Aborted) at NE 17, recovered by NE-D.Maye at NE 8.', people: [{ name: 'Drake Maye', team: 'NE', cat: 'passing' }] });
  ok('an aborted snap is not a forced fumble', !kinds(ab, 'pit-dst').includes('ff'), ab['pit-dst']);
  const muff = game({ type: 'Muffed Punt Recovery (Opponent)', off: 'ATL', def: 'MIN', turnover: true,
    text: 'B.Pinion punts 46 yards to MIN 42, Center-L.McCullough. M.Price MUFFS catch, RECOVERED by ATL-M.Ford at MIN 44.', people: [] });
  ok('a muffed punt is a punt and the kicking team\'s recovery', kinds(muff, 'atl-p').includes('punt') && kinds(muff, 'atl-dst').includes('fumrec'), { p: muff['atl-p'], d: muff['atl-dst'] });
}
// ── QB hits and passes defended, live (v0.535.0) ──────────────────────────
{
  const hit = game({ type: 'Pass Reception', off: 'KC', def: 'LAC', yds: 6,
    text: '(Shotgun) P.Mahomes pass short right to T.Kelce to LAC 30 for 6 yards (D.James) [K.Mack].',
    people: [{ name: 'Patrick Mahomes', team: 'KC', cat: 'passing' }, { name: 'Travis Kelce', team: 'KC', cat: 'receiving' }, { name: 'Derwin James', team: 'LAC', cat: 'defensive' }, { name: 'Khalil Mack', team: 'LAC', cat: 'defensive' }] });
  ok('a bracketed name is a live QB hit, for him and his defense', kinds(hit, 'khalil-mack').includes('qbhit') && kinds(hit, 'lac-dst').includes('qbhit'), { mack: hit['khalil-mack'], d: hit['lac-dst'] });
  ok('…and the tackler is not', !kinds(hit, 'derwin-james').includes('qbhit'));
  const sack = game({ type: 'Sack', off: 'KC', def: 'LAC', yds: -7,
    text: '(Shotgun) P.Mahomes sacked at KC 24 for -7 yards (K.Mack).',
    people: [{ name: 'Patrick Mahomes', team: 'KC', cat: 'passing' }, { name: 'Khalil Mack', team: 'LAC', cat: 'defensive' }] });
  ok('a sacker is credited a QB hit', kinds(sack, 'khalil-mack').includes('qbhit'), sack['khalil-mack']);
  const ob = game({ type: 'Sack', off: 'KC', def: 'LAC', yds: -1,
    text: '(Shotgun) P.Mahomes sacked ob at KC 30 for -1 yards (K.Mack).',
    people: [{ name: 'Patrick Mahomes', team: 'KC', cat: 'passing' }, { name: 'Khalil Mack', team: 'LAC', cat: 'defensive' }] });
  ok('a "sacked ob" is not a hit', !kinds(ob, 'khalil-mack').includes('qbhit'), ob['khalil-mack']);
  const inc = game({ type: 'Pass Incompletion', off: 'KC', def: 'LAC',
    text: '(Shotgun) P.Mahomes pass incomplete deep left to T.Kelce (D.James).',
    people: [{ name: 'Patrick Mahomes', team: 'KC', cat: 'passing' }, { name: 'Travis Kelce', team: 'KC', cat: 'receiving' }, { name: 'Derwin James', team: 'LAC', cat: 'defensive' }] });
  ok('the defender named on an incompletion has a pass defended', kinds(inc, 'derwin-james').includes('pd') && kinds(inc, 'lac-dst').includes('pd'), inc['derwin-james']);
  const pick = game({ type: 'Pass Interception Return', off: 'KC', def: 'LAC', turnover: true,
    text: '(Shotgun) P.Mahomes pass short left intended for T.Kelce INTERCEPTED by D.James (K.Mack) at LAC 25. D.James to LAC 40 for 15 yards (T.Kelce).',
    people: [{ name: 'Patrick Mahomes', team: 'KC', cat: 'passing' }, { name: 'Travis Kelce', team: 'KC', cat: 'receiving' }, { name: 'Derwin James', team: 'LAC', cat: 'defensive' }, { name: 'Khalil Mack', team: 'LAC', cat: 'defensive' }] });
  ok('an interception is a pass defended for the intercepter and the tipper', kinds(pick, 'derwin-james').includes('pd') && kinds(pick, 'khalil-mack').includes('pd'), { james: pick['derwin-james'], mack: pick['khalil-mack'] });
  const nul = game({ type: 'Penalty', off: 'KC', def: 'LAC',
    text: '(Shotgun) P.Mahomes pass incomplete short right to T.Kelce [K.Mack].PENALTY on LAC-D.James, Illegal Contact, 5 yards, enforced at KC 31 - No Play.',
    people: [{ name: 'Patrick Mahomes', team: 'KC', cat: 'passing' }, { name: 'Travis Kelce', team: 'KC', cat: 'receiving' }, { name: 'Derwin James', team: 'LAC', cat: 'defensive' }, { name: 'Khalil Mack', team: 'LAC', cat: 'defensive' }] });
  ok('nothing on a play wiped out by a penalty', !kinds(nul, 'khalil-mack').includes('qbhit'), nul['khalil-mack']);
}
// ── a penalty's yards are not the runner's (v0.732.2) ─────────────────────
// Founder, NE@CHI 2026 wk 7: "Roschon Johnson with negative yards on two
// carries". ESPN's statYardage is the play's net, the penalty included.
{
  const rj = [{ name: 'Roschon Johnson', team: 'CHI', cat: 'rushing' }];
  const hold = game({ type: 'Rush', off: 'CHI', def: 'NE', spot: 'CHI 31', yds: -11,
    text: '(Shotgun) R.Johnson left end ran ob at CHI 43 for 12 yards (C.Woodson).PENALTY on CHI-Z.Thomas, Offensive Holding, 10 yards, enforced at CHI 40.',
    people: rj });
  ok('an offensive hold beyond the line: the runner keeps his yards to the spot of the foul (9, not −11)', rowOf(hold, 'roschon-johnson', 'rush')?.y === 9, hold['roschon-johnson']);
  const rough = game({ type: 'Pass Reception', off: 'CHI', def: 'MIN', spot: 'CHI 40', yds: 5,
    text: 'C.Williams pass short right to K.Raymond to CHI 45 for 5 yards (B.Murphy).PENALTY on MIN-D.Turner, Roughing the Passer, 15 yards, enforced at CHI 45.',
    people: [{ name: 'Caleb Williams', team: 'CHI', cat: 'passing' }, { name: 'Kalif Raymond', team: 'CHI', cat: 'receiving' }] });
  ok('a defensive foul\'s yards are the team\'s: the catch is its own 5', rowOf(rough, 'kalif-raymond', 'rec')?.y === 5 && rowOf(rough, 'caleb-williams', 'pass')?.y === 5, rough);
  const noPlay = game({ type: 'Rush', off: 'CHI', def: 'NE', spot: 'CHI 18', yds: -10,
    text: 'R.Johnson right end to CHI 21 for 3 yards (A.Thomas).PENALTY on CHI-J.Monk, Offensive Holding, 10 yards, enforced at CHI 18 - No Play.',
    people: rj });
  // v0.740.0: not even a carry. The books have no snap there, so the row is
  // not written at all (it was a 0-yard carry — and, on a catch, a reception).
  ok('a carry wiped out ("No Play") is not a carry at all', !rowOf(noPlay, 'roschon-johnson', 'rush'), noPlay['roschon-johnson']);
  const blt = game({ type: 'Rush', off: 'BAL', def: 'NE', spot: 'BAL 36', yds: -18,
    text: '(Shotgun) D.Henry left tackle to BLT 44 for 8 yards (C.Bynum).PENALTY on BLT-O.Ioane, Offensive Holding, 10 yards, enforced at BLT 38.',
    people: [{ name: 'Derrick Henry', team: 'BAL', cat: 'rushing' }] });
  ok('the gamebook\'s own codes (BLT) still name the offense: 2 yards to the foul', rowOf(blt, 'derrick-henry', 'rush')?.y === 2, blt['derrick-henry']);
  const clean = game({ type: 'Rush', off: 'CHI', def: 'NE', spot: 'NE 47', yds: 4,
    text: 'R.Johnson right end to NE 43 for 4 yards (C.Elliss).', people: rj });
  ok('no penalty: ESPN\'s yards stand', rowOf(clean, 'roschon-johnson', 'rush')?.y === 4, clean['roschon-johnson']);
}
const plays = readFileSync(new URL('../server/src/poll/plays.js', import.meta.url), 'utf8');
const trueup = readFileSync(new URL('../server/src/poll/trueup.js', import.meta.url), 'utf8');
ok('the true-up retires a game\'s live estimates when the official credits land', /replaced .* live QB-hit\/PD estimates/.test(trueup));
ok('…and the poller stops re-emitting them for a confirmed game', /confirmed && \(p\.k === 'qbhit' \|\| p\.k === 'pd'\)/.test(plays));

// ── the scorer reads every flag the feed writes ───────────────────────────
const resolveSrc = readFileSync(new URL('../server/src/resolve.js', import.meta.url), 'utf8');
ok('official finals read fd/cp/ic/sk/rk/tt/hf/p6', /select\('player_slug,c,t,pid,k,y,td,ca,tg,"to",fd,cp,ic,sk,rk,tt,hf,p6'\)/.test(resolveSrc));
const idx = readFileSync(new URL('../server/src/index.js', import.meta.url), 'utf8');
ok('a closing week gives its finals a last poll', /final pass:/.test(idx));
const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
ok('a played week can be re-polled (repoll-week, ops mode "repoll")', /case 'repoll-week'/.test(cli) && /req\.mode === 'repoll'/.test(cli));

// ── the man the play names, where it names him (v0.740.0) ─────────────────
// 2026 wk 10, reconciled play by play against the books: two touchdowns ESPN
// sent as scoring-summary text, catches credited to the man a "Direct snap
// to" named, a back's carries on the men who tackled him, a touchdown catch
// on the kicker of its extra point, a completion the books call "No Play",
// an interception read as a completion to the tackler.
{
  const QB = { name: 'Josh Allen', team: 'NE', cat: 'passing' };
  const sumRun = game({ type: 'Rushing Touchdown', off: 'NE', def: 'PIT', scoring: true, yds: 1, down: 1, dist: 1,
    text: 'Josh Allen 1 Yd Run (Tyler Bass Kick)',
    people: [QB, { name: 'Josh Allen', team: 'NE', cat: 'rushing' }, { name: 'Tyler Bass', team: 'NE', cat: 'kicking' }] });
  ok('a touchdown in scoring-summary text is the runner\'s: 1 yard, a TD', rowOf(sumRun, 'josh-allen', 'rush')?.y === 1 && rowOf(sumRun, 'josh-allen', 'rush')?.td === 1, sumRun['josh-allen']);
  ok('…and its extra point is the kicker\'s', kinds(sumRun, 'ne-k').includes('xp'), sumRun['ne-k']);
  const sumPass = game({ type: 'Passing Touchdown', off: 'CIN', def: 'PIT', scoring: true, yds: 4,
    text: 'Chase Brown 4 Yd pass from Joe Burrow (Evan McPherson Kick)',
    people: [{ name: 'Joe Burrow', team: 'CIN', cat: 'passing' }, { name: 'Chase Brown', team: 'CIN', cat: 'receiving' }] });
  ok('a touchdown pass in scoring-summary text pays the passer and the receiver',
    rowOf(sumPass, 'joe-burrow', 'pass')?.td === 1 && rowOf(sumPass, 'joe-burrow', 'pass')?.y === 4 && rowOf(sumPass, 'chase-brown', 'rec')?.td === 1 && rowOf(sumPass, 'chase-brown', 'rec')?.ca === 1, sumPass);

  const snap = game({ type: 'Pass Reception', off: 'MIN', def: 'KC', yds: 15,
    text: '(Shotgun) Direct snap to T.Kraft.  J.Love pass short right to C.Watson to MIN 29 for 15 yards (J.Metellus).',
    people: [{ name: 'Jordan Love', team: 'MIN', cat: 'passing' }, { name: 'Tucker Kraft', team: 'MIN', cat: 'receiving' }, { name: 'Christian Watson', team: 'MIN', cat: 'receiving' }, { name: 'Josh Metellus', team: 'KC', cat: 'defensive' }] });
  ok('the receiver is the man after the PASS\'s "to", not a "Direct snap to"', rowOf(snap, 'christian-watson', 'rec')?.y === 15 && !rowOf(snap, 'tucker-kraft', 'rec'), snap);
  const snapRun = game({ type: 'Rush', off: 'MIN', def: 'KC', yds: 3,
    text: '(Shotgun) Direct snap to T.Kraft.  T.Kraft up the middle to MIN 32 for 3 yards (J.Metellus).',
    people: [{ name: 'Tucker Kraft', team: 'MIN', cat: 'receiving' }, { name: 'Josh Metellus', team: 'KC', cat: 'defensive' }] });
  ok('a direct-snap run is still the runner\'s', rowOf(snapRun, 'tucker-kraft', 'rush')?.y === 3, snapRun);

  const knight = game({ type: 'Rush', off: 'ATL', def: 'LAC', yds: 4,
    text: '(Shotgun) Z.Knight up the middle to ARZ 39 for 4 yards (B.Fiske; S.Dolac).',
    people: [{ name: 'Bam Knight', team: 'ATL', cat: 'rushing' }, { name: 'Braden Fiske', team: 'LAC', cat: 'defensive' }] });
  ok('a runner the gamebook names differently is found by last name, never the tackler', rowOf(knight, 'bam-knight', 'rush')?.y === 4 && !rowOf(knight, 'braden-fiske', 'rush'), knight);
  const nobody = game({ type: 'Rush', off: 'ATL', def: 'LAC', yds: 4,
    text: 'Z.Knight up the middle to ARZ 39 for 4 yards (B.Fiske).',
    people: [{ name: 'Braden Fiske', team: 'LAC', cat: 'defensive' }] });
  ok('a runner nobody can place is credited to nobody', !rowOf(nobody, 'braden-fiske', 'rush') && Object.values(nobody).flat().every((r) => r.k !== 'rush'), nobody);
  const two = game({ type: 'Rush', off: 'ATL', def: 'LAC', yds: 4,
    text: 'Z.Knight up the middle to ARZ 39 for 4 yards (B.Fiske).',
    people: [{ name: 'Bam Knight', team: 'ATL', cat: 'rushing' }, { name: 'Qadir Knight', team: 'ATL', cat: 'rushing' }] });
  ok('two men with that last name is a guess: nobody', Object.values(two).flat().every((r) => r.k !== 'rush'), two);
  const kicker = game({ type: 'Passing Touchdown', off: 'MIN', def: 'KC', scoring: true, yds: 32,
    text: '(No Huddle) J.Love pass deep right to J.Sturdivant for 32 yards, TOUCHDOWN. T.Smack extra point is GOOD, Center-M.Orzech, Holder-D.Whelan.',
    people: [{ name: 'Jordan Love', team: 'MIN', cat: 'passing' }, { name: 'J. Michael Sturdivant', team: 'MIN', cat: 'receiving' }, { name: 'Trey Smack', team: 'MIN', cat: 'kicking' }] });
  ok('a touchdown catch is the receiver\'s, not the kicker\'s of its extra point',
    rowOf(kicker, 'j-michael-sturdivant', 'rec')?.td === 1 && !rowOf(kicker, 'trey-smack', 'rec'), kicker);
  ok('…and the extra point is the team kicker\'s, never the quarterback\'s', kinds(kicker, 'min-k').includes('xp') && !kinds(kicker, 'jordan-love').includes('xp'), kicker);

  const offset = game({ type: 'Pass Reception', off: 'NE', def: 'PIT', yds: 45,
    text: '(No Huddle, Shotgun) G.Smith pass short right to I.Williams to BUF 24 for 45 yards (A.Hooker).Penalty on NYJ-M.Taylor, Offensive Pass Interference, offsetting, enforced at NYJ 31 - No Play.Penalty on BUF-D.Igbinosun, Illegal Use of Hands, offsetting.',
    people: [{ name: 'Geno Smith', team: 'NE', cat: 'passing' }, { name: 'Isaiah Williams', team: 'NE', cat: 'receiving' }] });
  ok('a catch wiped out by offsetting fouls ("No Play") is no attempt and no catch', !rowOf(offset, 'isaiah-williams', 'rec') && !rowOf(offset, 'geno-smith', 'pass'), offset);

  const pickFum = game({ type: 'Fumble Recovery (Opponent)', off: 'NE', def: 'PIT', turnover: true, yds: 0,
    text: '(Shotgun) C.Klubnik pass deep right intended for G.Wilson INTERCEPTED by D.Igbinosun at 50. D.Igbinosun to NYJ 33 for 17 yards (J.Ruckert; B.Hall). FUMBLES (J.Ruckert), RECOVERED by NE-J.Myers at NYJ 23.',
    people: [{ name: 'Cade Klubnik', team: 'NE', cat: 'passing' }, { name: 'Garrett Wilson', team: 'NE', cat: 'receiving' }, { name: 'Jeremy Ruckert', team: 'NE', cat: 'receiving' }, { name: 'Davison Igbinosun', team: 'PIT', cat: 'defensive' }] });
  const kp = rowOf(pickFum, 'cade-klubnik', 'pass');
  ok('an interception the defender fumbles is still an interception: no yards, a turnover', kp && kp.y === 0 && kp.to === 1, kp);
  ok('…and no catch for the man who made the tackle', !rowOf(pickFum, 'jeremy-ruckert', 'rec'), pickFum['jeremy-ruckert']);
  ok('…the defense has its interception, not a fumble recovery the offense made', kinds(pickFum, 'pit-dst').includes('int') && !kinds(pickFum, 'pit-dst').includes('fumrec'), pickFum['pit-dst']);

  const kept = game({ type: 'Fumble Recovery (Own)', off: 'NE', def: 'PIT', yds: 12,
    text: 'T.DeVito pass short right to R.Gilliam to NE 19 for 6 yards (C.Clark). FUMBLES (C.Clark), recovered by NE-A.Brown at NE 25.',
    people: [{ name: 'Tommy DeVito', team: 'NE', cat: 'passing' }, { name: 'Reggie Gilliam', team: 'NE', cat: 'receiving' }, { name: 'A.J. Brown', team: 'NE', cat: 'receiving' }] });
  ok('a fumble a TEAMMATE keeps: the catch is its own 6, not the play\'s 12', rowOf(kept, 'reggie-gilliam', 'rec')?.y === 6 && rowOf(kept, 'tommy-devito', 'pass')?.y === 6, kept);
  const self = game({ type: 'Fumble Recovery (Own)', off: 'NE', def: 'PIT', yds: 1,
    text: 'K.Black left end to DAL 47 for no gain (Q.Williams). FUMBLES (Q.Williams), and recovers at DAL 46.',
    people: [{ name: 'Kaelon Black', team: 'NE', cat: 'rushing' }] });
  ok('a fumble the runner keeps himself: the whole play is his', rowOf(self, 'kaelon-black', 'rush')?.y === 1, self['kaelon-black']);
}

if (fails) { console.log(`\n${fails} FEED-INGEST ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL FEED-INGEST ASSERTIONS PASSED');
