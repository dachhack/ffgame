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
const TEAMS = { NE: '1', PIT: '2', MIA: '3', CIN: '4', MIN: '5', KC: '6', LAC: '7', ATL: '8' };
function game({ type, text, off, def, start = off, down = 1, dist = 10, yds = 0, turnover = false, scoring = false, people }) {
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
      start: { team: { id: TEAMS[start] }, down, distance: dist }, statYardage: yds, isTurnover: turnover, scoringPlay: scoring,
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
// ── the scorer reads every flag the feed writes ───────────────────────────
const resolveSrc = readFileSync(new URL('../server/src/resolve.js', import.meta.url), 'utf8');
ok('official finals read fd/cp/ic/sk/rk/tt/hf/p6', /select\('player_slug,c,t,pid,k,y,td,ca,tg,"to",fd,cp,ic,sk,rk,tt,hf,p6'\)/.test(resolveSrc));
const idx = readFileSync(new URL('../server/src/index.js', import.meta.url), 'utf8');
ok('a closing week gives its finals a last poll', /final pass:/.test(idx));
const cli = readFileSync(new URL('../server/src/cli.js', import.meta.url), 'utf8');
ok('a played week can be re-polled (repoll-week, ops mode "repoll")', /case 'repoll-week'/.test(cli) && /req\.mode === 'repoll'/.test(cli));

if (fails) { console.log(`\n${fails} FEED-INGEST ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL FEED-INGEST ASSERTIONS PASSED');
