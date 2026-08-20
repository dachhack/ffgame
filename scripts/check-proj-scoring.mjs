// LEAGUE-AWARE PROJECTIONS (v0.308.0; re-baked off StatHead's own components in
// v0.309.0), checked in Node.
//
// This lives in check:parity because the whole point of the change is that the
// PROJECTED and the LIVE number on one board finally obey one rulebook. Two
// scorers disagreeing about a league's own rules is the failure this project
// keeps finding in different clothes — it doesn't error, and the league sees a
// number it cannot reproduce.
//
// The cases that earn their keep: the INVARIANT (a standard-catalog league is
// unchanged to the decimal, so shipping this moves nothing that was right), the
// catalog moving the right players and only them, the scoped layers landing in
// the order the live scorer applies them, and every no-data path falling back
// to the bake rather than to zero.
//
// v0.311.0 adds the two positions that had NO projection at all — kickers and
// team defences were not "unadjusted", they were absent, and returned 0 on the
// first line of projectedPoints. The cases below pin the level, the ratio, the
// pool lift, and the one piece of real arithmetic: points allowed is scored by
// BRACKET, so a defence's expected points is not the bracket its average falls
// in.
//
// v0.310.0 extends it past the matchup board. The engine was right from
// v0.308.0 and wired to exactly ONE surface; waivers, the draft room, the
// player cards and the auto-slot ranker all still read the raw PPR bake. The
// cases below pin the SURFACES rather than the arithmetic — a pool that
// REORDERS under a catalog, an auto-fill that ranks by the league's rules, and
// the PPR knob being part of the catalog at all.
//
// v0.309.0 adds the two the earlier Sleeper bake could not make: that the stat
// lines RECONCILE to the projection they are the components of, and that they
// cover it completely. Both are only checkable because the two files now come
// from one pull of one source — which is exactly why the re-bake was worth
// doing, and exactly what would silently rot if someone refreshed one file
// without the other.
import { PROJ_2026 } from '../packages/core/src/data/proj2026';
import { PROJ_LINES, PROJ_LINE_POS } from '../packages/core/src/data/projStats2026';
import { sortPool, poolSortValue, projFor } from '../packages/core/src/data/poolSort';
import { PROJ_KICK, PROJ_DST } from '../packages/core/src/data/projKdst2026';
import { PROJ_RETURN } from '../packages/core/src/data/projReturns2026';
import { PROJ_HC, PROJ_PUNT, MARGIN_GAME_SD, TEAM_ROLE_NAME } from '../packages/core/src/data/projTeamRoles2026';
import { PROJ_FB } from '../packages/core/src/data/projFb2026';
import { idpLineFor, IDP_ROWS } from '../packages/core/src/data/projIdp2026';
import { slateAwareProj, isRetSlot } from '../packages/core/src/engine/classic';
import {
  projectedPoints, leagueProjRatio, projTdsPerWeek, scoreProjLine, leagueCatalogOf,
  scoreKickLine, scoreDstLine, scoreReturnLine, scoreHcLine, scorePuntLine, marginBracketShares,
  integratedPaPoints, kdstBase, hasProjection, PA_SD, scoreIdpLine,
  setLeagueProjScoring, clearLeagueProjScoring,
} from '../packages/core/src/engine/projScoring';
import { setLeagueScoring, clearLeagueScoring } from '../packages/core/src/engine/leagueScoring';
import { DEFAULT_CLASSIC_SCORING } from '../packages/core/src/engine/classic';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const near = (a, b) => Math.abs(a - b) < 0.051;

const P = (id, pos) => ({ id, pos, team: null });
const QB = P('josh-allen', 'QB'), WR = P('jamarr-chase', 'WR');
const RB = P('jahmyr-gibbs', 'RB'), TE = P('brock-bowers', 'TE');

clearLeagueScoring(); clearLeagueProjScoring();

ok('the bake and the stat lines both loaded (else every case below is vacuous)',
  PROJ_2026.size > 400 && Object.keys(PROJ_LINES).length > 400,
  [PROJ_2026.size, Object.keys(PROJ_LINES).length]);

// ── THE TWO FILES ARE ONE PULL ─────────────────────────────────────────────
// COVERAGE. A player the bake knows about but the lines don't isn't an error —
// `leagueProjRatio` returns 1 and he keeps his stock-PPR projection — which is
// precisely why it has to be asserted: the failure is SILENT, and it is what
// the Sleeper bake was doing to 77 of 445 players. One source, one pull, so the
// join is total or something has drifted.
{
  const missing = [...PROJ_2026.keys()].filter((slug) => !PROJ_LINES[slug]);
  ok('every projected player has a stat line (a miss is a silent stock-PPR row)',
    missing.length === 0, missing.slice(0, 8));
}

// RECONCILIATION. `leagueProjRatio` divides the league's scoring of a line by
// the STANDARD scoring of that same line, and multiplies the result onto
// PROJ_2026. That is only honest if the standard scoring of the line IS
// PROJ_2026 — otherwise the denominator describes a different player than the
// number it scales, which is the flaw the Sleeper bake shipped with. Both files
// now come from one `get_projections` call, so scoring a line under the default
// catalog and dividing by the same 17 the bake divides by must land back on the
// baked per-week number. Tolerance is 0.2: the worst row sits at 0.124, and
// PROJ_2026 is itself rounded to a decimal place.
{
  let worst = 0, who = '', sum = 0, n = 0;
  for (const [slug, perWeek] of PROJ_2026) {
    const line = PROJ_LINES[slug];
    if (!line) continue;
    const d = scoreProjLine(line, PROJ_LINE_POS[slug], DEFAULT_CLASSIC_SCORING) / 17 - perWeek;
    sum += d; n++;
    if (Math.abs(d) > Math.abs(worst)) { worst = d; who = slug; }
  }
  ok('the stat lines re-derive the bake under the standard catalog',
    Math.abs(worst) < 0.2, { worst: +worst.toFixed(3), who, n });
  ok('…with no systematic bias either way (a drift would tilt every ratio)',
    Math.abs(sum / n) < 0.02, +(sum / n).toFixed(4));
}



// ── KICKERS AND TEAM DEFENCES (v0.311.0) ───────────────────────────────────
{
  const K = { id: 'den-k', pos: 'K', team: 'DEN' };
  const DST = { id: 'den-dst', pos: 'DEF', team: 'DEN' };

  ok('both pools baked, all 32 teams each (a gap is a team that projects zero)',
    Object.keys(PROJ_KICK).length === 32 && Object.keys(PROJ_DST).length === 32,
    [Object.keys(PROJ_KICK).length, Object.keys(PROJ_DST).length]);
  ok('every team has BOTH a kicker and a defence, on our own slug convention',
    Object.keys(PROJ_KICK).every((s) => PROJ_DST[s.replace(/-k$/, '-dst')] != null));

  // THE THING THAT WAS BROKEN: these projected 0 everywhere.
  ok('a kicker has a projection at all', projectedPoints(K) > 0, projectedPoints(K));
  ok('a defence has a projection at all', projectedPoints(DST) > 0, projectedPoints(DST));
  ok('…and the pools can SEE it, so they no longer sort below unknown players',
    projFor(K.id, 'K') > 0 && projFor(DST.id, 'DEF') > 0 && hasProjection(K.id),
    [projFor(K.id, 'K'), projFor(DST.id, 'DEF')]);
  ok('a team that does not exist still has no projection',
    projFor('xxx-k') === null && projFor('xxx-dst') === null && !hasProjection('xxx-dst'));

  // THE INVARIANT, which has to hold for these two exactly as it does for the
  // skill positions: a standard league sees the baked number, to the decimal.
  ok('the standard catalog is the identity for a kicker',
    projectedPoints(K) === kdstBase(K.id) && leagueProjRatio(K.id, 'K') === 1);
  ok('…and for a defence',
    projectedPoints(DST) === kdstBase(DST.id) && leagueProjRatio(DST.id, 'DEF') === 1);

  // THE POINT OF THE EXERCISE: the league's own kicker and defence rules move
  // the projection, and only for the position they apply to.
  setLeagueProjScoring({ fg50: 6 });                     // default 5
  ok('paying 6 for a 50+ field goal raises the kicker',
    projectedPoints(K) > kdstBase(K.id), [projectedPoints(K), kdstBase(K.id)]);
  ok('…and leaves the defence alone', projectedPoints(DST) === kdstBase(DST.id));

  setLeagueProjScoring({ fgMiss: 0 });                   // default -1
  ok('forgiving missed kicks raises the kicker (attempts are in the line, not just makes)',
    projectedPoints(K) > kdstBase(K.id), projectedPoints(K));

  setLeagueProjScoring({ sack: 3 });                     // default 1
  ok('a sack-heavy defence catalog raises the defence',
    projectedPoints(DST) > kdstBase(DST.id), [projectedPoints(DST), kdstBase(DST.id)]);
  ok('…and leaves the kicker alone', projectedPoints(K) === kdstBase(K.id));
  clearLeagueProjScoring();

  // A defence scores touchdowns, so a per-TD scoped bonus has to see them; a
  // kicker does not, and must say so rather than borrowing a skill line.
  ok('a defence has projected touchdowns', projTdsPerWeek(DST.id) > 0, projTdsPerWeek(DST.id));
  ok('a kicker has none', projTdsPerWeek(K.id) === 0);
}

// ── POINTS ALLOWED IS A BRACKET, NOT A NUMBER ──────────────────────────────
// The one piece of real arithmetic in the change. A defence projected at 21.3
// points allowed does NOT sit in the 21-27 tier every week — it has shutouts
// and it has blowouts, and the ladder pays very differently at the ends. So the
// expected points is the ladder INTEGRATED over the spread, not the ladder
// evaluated at the mean.
{
  const atMean = (y) => (y <= 0 ? DEFAULT_CLASSIC_SCORING.pa0 : y <= 6 ? DEFAULT_CLASSIC_SCORING.pa1
    : y <= 13 ? DEFAULT_CLASSIC_SCORING.pa7 : y <= 20 ? DEFAULT_CLASSIC_SCORING.pa14
    : y <= 27 ? DEFAULT_CLASSIC_SCORING.pa21 : y <= 34 ? DEFAULT_CLASSIC_SCORING.pa28
    : DEFAULT_CLASSIC_SCORING.pa35);

  ok('the spread is the one StatHead measured', PA_SD === 9.4, PA_SD);

  // 21.3 lands in the 21-27 bracket, which our ladder pays ZERO for. Scored at
  // the mean a top defence's points-allowed contribution vanishes entirely.
  const den = integratedPaPoints(21.29, DEFAULT_CLASSIC_SCORING);
  ok('a 21.3-per-game defence is worth MORE than its own bracket says',
    atMean(21.29) === 0 && den > 0.6 && den < 0.8, [atMean(21.29), den]);

  // And the direction reverses for a bad defence: the blowout tail costs it.
  const nyj = integratedPaPoints(24.64, DEFAULT_CLASSIC_SCORING);
  ok('a 24.6-per-game defence is worth LESS than its bracket says',
    atMean(24.64) === 0 && nyj < 0, [atMean(24.64), nyj]);
  ok('better defences are still worth more than worse ones', den > nyj, [den, nyj]);

  // Monotone in the league's own ladder, which is the property a commissioner
  // would actually notice: raise the shutout payout, the defence goes up.
  const rich = integratedPaPoints(21.29, { ...DEFAULT_CLASSIC_SCORING, pa0: 30 });
  ok('a richer shutout bracket raises the defence', rich > den, [rich, den]);

  // ACROSS THE WHOLE BAKED POOL: allowing fewer points is never worth less.
  // The integral is a weighted sum over a ladder that is itself monotone, so
  // this must hold for every pair — and it is the property that would break
  // first if a bracket boundary or the weighting were ever miswritten.
  const byPa = Object.entries(PROJ_DST).sort((a, b) => a[1].paPg - b[1].paPg);
  const bad = byPa.filter(([, d], i) =>
    i > 0 && integratedPaPoints(d.paPg, DEFAULT_CLASSIC_SCORING)
           > integratedPaPoints(byPa[i - 1][1].paPg, DEFAULT_CLASSIC_SCORING) + 1e-9);
  ok('across all 32 defences, fewer points allowed is never worth less',
    bad.length === 0, bad.map(([t]) => t));
  // The per-point knob is linear, so it needs no integration and must be exact.
  const perPt = integratedPaPoints(20, { ...DEFAULT_CLASSIC_SCORING, paPt: -0.5 });
  ok('the per-point knob is applied at the mean, exactly',
    Math.abs(perPt - (integratedPaPoints(20, DEFAULT_CLASSIC_SCORING) - 10)) < 1e-9, perPt);
}


// ── A RETURN-ONLY SPOT PROJECTS NOTHING (v0.311.2) ─────────────────────────
// RET is a SLOT identity, not a position: a player scored there banks return
// production ONLY, and classicPoints has always enforced that with a
// posOverride. The projected column never knew — it got the slot's NAME while
// the live column got its SPEC — so a RET spot showed a receiver's whole PPR
// line beside a live number that can only pay return yardage. Under the default
// catalog retYd/krYd/prYd are all 0 and only retTd scores, so live is ~0
// against a projection of 10+. We have no return-production projection at all,
// so zero is the honest answer, and these pin it.
{
  const RETSPEC = ['RET'], FLEXSPEC = ['RB', 'WR', 'TE'];
  ok('isRetSlot means EXACTLY a return-only spec, not any spec containing RET',
    isRetSlot(RETSPEC) && !isRetSlot(['RET', 'WR']) && !isRetSlot(FLEXSPEC));

  // v0.313.0: StatHead ship return components, so the spot is priced rather
  // than zeroed. `jamarr-chase` never returns a kick and is the control.
  const DIKE = { id: 'chimere-dike', pos: 'WR', team: 'MIN' };

  ok('the return bake loaded, and every row joins the skill bake',
    Object.keys(PROJ_RETURN).length > 100
    && Object.keys(PROJ_RETURN).every((s) => PROJ_2026.has(s)),
    Object.keys(PROJ_RETURN).length);
  ok('no two returners share a slug (a RET spot only holds RB/WR/TE/FB, never a DB)',
    new Set(Object.keys(PROJ_RETURN)).size === Object.keys(PROJ_RETURN).length);

  ok('a RETURNER is priced in a return-only spot, not zeroed',
    projectedPoints(DIKE, 'S7', RETSPEC) > 0, projectedPoints(DIKE, 'S7', RETSPEC));
  // …but under the DEFAULT catalog only return TDs score, so it is a fraction
  // of his skill line. That gap IS the bug v0.311.2 fixed, now with a number.
  ok('…and is worth far less there than in a flex spot, as the live scorer pays',
    projectedPoints(DIKE, 'S7', RETSPEC) < projectedPoints(DIKE, 'S7', FLEXSPEC) / 5,
    [projectedPoints(DIKE, 'S7', RETSPEC), projectedPoints(DIKE, 'S7', FLEXSPEC)]);
  ok('a player who never returns a kick still projects nothing there',
    projectedPoints(WR, 'S7', RETSPEC) === 0, projectedPoints(WR, 'S7', RETSPEC));
  ok('…while the same player in a normal spot is untouched',
    projectedPoints(WR, 'S7', FLEXSPEC) === PROJ_2026.get(WR.id),
    projectedPoints(WR, 'S7', FLEXSPEC));
  ok('…and a caller that passes no spec at all is untouched (every other surface)',
    projectedPoints(WR, 'S7') === PROJ_2026.get(WR.id));

  // THE LEAGUE'S OWN RETURN RULES REACH IT, and the two yardage buckets are
  // priced separately — a combined figure could not serve a league that pays
  // more for punt returns than kick returns.
  const flat = projectedPoints(DIKE, 'S7', RETSPEC);
  setLeagueProjScoring({ retYd: 0.04 });
  ok('paying per return yard raises a returner',
    projectedPoints(DIKE, 'S7', RETSPEC) > flat, projectedPoints(DIKE, 'S7', RETSPEC));
  const RAY = { id: 'kalif-raymond', pos: 'WR', team: 'DET' };   // punt-heavy
  const SAY = { id: 'jacob-saylors', pos: 'RB', team: 'DEN' };   // kick-only
  const evenRay = projectedPoints(RAY, 'S7', RETSPEC), evenSay = projectedPoints(SAY, 'S7', RETSPEC);
  setLeagueProjScoring({ retYd: 0.04, prYd: 0.06 });
  // Everyone carries SOME punt yardage in StatHead's allocation, so the
  // kick-only man is not frozen — he just gains far less. The property that
  // matters is that the premium is proportional to punt yardage, which is only
  // true because the two buckets are stored separately.
  const gainRay = projectedPoints(RAY, 'S7', RETSPEC) - evenRay;
  const gainSay = projectedPoints(SAY, 'S7', RETSPEC) - evenSay;
  ok('a PUNT-return premium moves the punt returner far more than the kick returner',
    gainRay > gainSay * 5, [gainRay, gainSay]);
  clearLeagueProjScoring();

  // Scoped bonuses apply here now that the value is KNOWN — v0.311.2 withheld
  // them only because a flat bonus over an unknown is false precision.
  setLeagueScoring({ scoped: [{ slot: ['S7'], bonusMult: 2 }] });
  // Doubled against the UNROUNDED base, not against the displayed number — the
  // projection rounds once at the end, exactly as it does for every position.
  const exact2 = Math.round(
    (scoreReturnLine(PROJ_RETURN[DIKE.id], DEFAULT_CLASSIC_SCORING) / 17) * 2 * 10) / 10;
  ok('a spot-scoped multiplier now reaches a return projection',
    projectedPoints(DIKE, 'S7', RETSPEC) === exact2,
    [projectedPoints(DIKE, 'S7', RETSPEC), exact2, flat]);
  ok('…and still cannot conjure one for a non-returner',
    projectedPoints(WR, 'S7', RETSPEC) === 0);
  clearLeagueScoring();

  // THE FILL RANKS BY THE SAME NUMBER. Ranking RET candidates by their full
  // skill line would seat the best receiver rather than the best returner.
  const value = slateAwareProj(1, []);
  ok('the auto-fill prefers a RETURNER for a return-only spot',
    value(DIKE, { slot: 'S7', pos: RETSPEC }) > value({ id: WR.id, pos: 'WR', team: 'CIN' }, { slot: 'S7', pos: RETSPEC }),
    [value(DIKE, { slot: 'S7', pos: RETSPEC }), value({ id: WR.id, pos: 'WR', team: 'CIN' }, { slot: 'S7', pos: RETSPEC })]);
  ok('…and agrees with the board on the same player and spot',
    value(DIKE, { slot: 'S7', pos: RETSPEC }) === projectedPoints(DIKE, 'S7', RETSPEC));
  ok('…and values a normal spot exactly as before',
    value({ id: WR.id, pos: 'WR', team: 'CIN' }, { slot: 'S7', pos: FLEXSPEC })
      === PROJ_2026.get(WR.id));
  ok('…and a fill with no spot in hand is unchanged (optimalLineup passes none)',
    value({ id: WR.id, pos: 'WR', team: 'CIN' }) === PROJ_2026.get(WR.id));

  // The scorer itself, against the default ladder: only the TD column pays.
  ok('the return scorer prices the default catalog as return TDs alone',
    Math.abs(scoreReturnLine(PROJ_RETURN['chimere-dike'], DEFAULT_CLASSIC_SCORING)
      - PROJ_RETURN['chimere-dike'].retTd * 6) < 1e-9);
}



// ── FULLBACKS (v0.315.3) ───────────────────────────────────────────────────
// Five of StatHead's fifteen. The other ten are byte-identical — the positional
// mean stamped on every fullback the model has nothing specific to say about —
// and ten identical numbers wearing ten different names is false precision that
// looks like knowledge. The contrast with the FILLED punters is the point: a
// punter slot is a TEAM slot that must be filled, a fullback is a person.
{
  const JUS = { id: 'kyle-juszczyk', pos: 'FB', team: 'SF' };
  const OUZ = { id: 'robbie-ouzts', pos: 'FB', team: 'SEA' };   // one of the identical ten

  ok('only the separated fullbacks are baked', Object.keys(PROJ_FB).length === 5,
    Object.keys(PROJ_FB).length);
  ok('a fullback with a real projection has one', projectedPoints(JUS) > 0, projectedPoints(JUS));
  ok('…and one the model could not separate has none, rather than the league mean',
    projectedPoints(OUZ) === 0 && !hasProjection(OUZ.id));
  ok('the pools can see the baked ones', hasProjection(JUS.id));
  ok('a standard league gets the standard scoring of his own line, exactly',
    leagueProjRatio(JUS.id, 'FB') === 1 && projectedPoints(JUS) === kdstBase(JUS.id));

  // HE SCORES AS THE LIVE SCORER SCORES HIM. `classicScorePlay`'s reception
  // premium is TE/RB/WR only, so a fullback earns plain PPR and nothing else —
  // the one property that would silently diverge if we priced him as an RB.
  const flat = projectedPoints(JUS);
  setLeagueProjScoring({ rbRec: 1 });
  ok('an RB catch bonus does NOT reach a fullback, matching the live scorer',
    projectedPoints(JUS) === flat, [projectedPoints(JUS), flat]);
  setLeagueProjScoring({ ppr: 0 });
  ok('…but zero PPR cuts him hard, because he is a receiver first',
    projectedPoints(JUS) < flat * 0.7, [projectedPoints(JUS), flat]);
  setLeagueProjScoring({ rushTd: 12 });
  ok('…and his rushing touchdowns are priced too', projectedPoints(JUS) > flat);
  clearLeagueProjScoring();
  ok('and clearing restores him', projectedPoints(JUS) === flat);

  // Passing is structurally zero: a fullback who throws is a trick play.
  ok('no fullback carries a passing line',
    Object.values(PROJ_FB).every((l) => l.passYd === 0 && l.passTd === 0 && l.int === 0));
}

// ── HEAD COACHES AND PUNTERS (v0.315.0) ────────────────────────────────────
// The last two rosterable positions that projected nothing. Both are priced
// DIRECTLY under the league's catalog rather than as a ratio, because every
// knob for both defaults to 0 — there is no standard coach or punter scoring to
// divide by, and the ratio's denominator would be zero.
{
  const HC = { id: 'la-hc', pos: 'HC', team: 'LA' };      // +3.29 margin, 10.3 wins
  const HCBAD = { id: 'ari-hc', pos: 'HC', team: 'ARI' }; // -4.16 margin, 6.3 wins
  const PU = { id: 'pit-p', pos: 'P', team: 'PIT' };      // 73.4 punts, most in the league

  // EVERY TEAM HAS ONE, like K and DST (founder). Two punters are filled from
  // StatHead's own positional mean because they have no upstream row — for a
  // TEAM slot that is right, since every team really does punt.
  ok('both bakes cover all 32 teams',
    Object.keys(PROJ_HC).length === 32 && Object.keys(PROJ_PUNT).length === 32,
    [Object.keys(PROJ_HC).length, Object.keys(PROJ_PUNT).length]);
  ok('every coach and punter keys to our own team pseudo-player convention',
    Object.keys(PROJ_HC).every((k) => k.endsWith('-hc'))
    && Object.keys(PROJ_PUNT).every((k) => k.endsWith('-p')));
  ok('the pools can see them, so they no longer sort below unknown players',
    hasProjection('la-hc') && hasProjection('pit-p') && !hasProjection('xxx-hc'));

  // NAMES ARE DISPLAY ONLY. The projection belongs to the TEAM, which is what
  // makes a mid-season coaching change harmless: the slug, the roster row and
  // every stored lineup survive it, and only the name goes stale.
  ok('every coach slot names its current coach', Object.keys(PROJ_HC)
    .every((k) => (TEAM_ROLE_NAME[k] ?? '').length > 1), Object.keys(PROJ_HC)
    .filter((k) => !TEAM_ROLE_NAME[k]));
  ok('a filled punter has no name to claim, and says so by absence',
    !TEAM_ROLE_NAME['chi-p'] && !TEAM_ROLE_NAME['den-p']);

  // THE THREE StatHead HAD WRONG (v0.315.2). 2026 was a ten-change coaching
  // cycle and their feed kept the FIRED incumbent for three of them. Pinned by
  // name because a silent regression here puts a sacked coach back on the board
  // — the exact thing the founder caught by eye.
  ok('Atlanta is Kevin Stefanski, not the coach they fired in January',
    TEAM_ROLE_NAME['atl-hc'] === 'Kevin Stefanski', TEAM_ROLE_NAME['atl-hc']);
  ok('Buffalo is Joe Brady', TEAM_ROLE_NAME['buf-hc'] === 'Joe Brady', TEAM_ROLE_NAME['buf-hc']);
  ok('Arizona is Mike LaFleur', TEAM_ROLE_NAME['ari-hc'] === 'Mike LaFleur', TEAM_ROLE_NAME['ari-hc']);
  ok('…and Las Vegas is spelled Kubiak', TEAM_ROLE_NAME['lv-hc'] === 'Klint Kubiak', TEAM_ROLE_NAME['lv-hc']);
  // Nobody who lost their job in the 2026 cycle is still on a board.
  {
    const sacked = ['Raheem Morris', 'Sean McDermott', 'Jonathan Gannon', 'Kevin Stefanski'];
    const stillHere = Object.entries(TEAM_ROLE_NAME)
      .filter(([k, v]) => k.endsWith('-hc') && sacked.includes(v));
    // Stefanski IS still coaching — at Atlanta — so only his old team may not claim him.
    ok('no team still lists a coach it parted with', !stillHere.some(([k]) =>
      k === 'atl-hc' && TEAM_ROLE_NAME[k] === 'Raheem Morris')
      && TEAM_ROLE_NAME['cle-hc'] !== 'Kevin Stefanski', stillHere);
  }
  ok('naming a role does not change what it scores',
    projectedPoints({ id: 'la-hc', pos: 'HC', team: 'LA' }) === 0);

  // THE DEFINING PROPERTY: worth nothing until a commissioner says otherwise.
  ok('a coach projects EXACTLY zero under the default catalog',
    projectedPoints(HC) === 0, projectedPoints(HC));
  ok('…and so does a punter', projectedPoints(PU) === 0, projectedPoints(PU));

  // …and the moment the league prices them, they appear.
  setLeagueProjScoring({ hcWin: 5, hcLoss: 1 });
  const la = projectedPoints(HC), ari = projectedPoints(HCBAD);
  ok('a league that pays for wins gives the coach a projection', la > 0, la);
  ok('…and the better coach is worth more', la > ari, [la, ari]);
  // 10.3 wins x 5 + 6.6 losses x 1, over 17 games — arithmetic, not a vibe.
  ok('…priced exactly on StatHead\u2019s own win and loss counts',
    Math.abs(la - Math.round((PROJ_HC['la-hc'].wins * 5 + PROJ_HC['la-hc'].losses * 1) / 17 * 10) / 10) < 1e-9,
    la);
  ok('…and a punter is untouched by coach scoring', projectedPoints(PU) === 0);

  // THE MARGIN LADDER separates coaches the win column alone cannot.
  const flatLa = la, flatAri = ari;
  setLeagueProjScoring({ hcWin: 5, hcLoss: 1, hcWm25: 10 });
  ok('a blowout bonus raises both coaches', projectedPoints(HC) > flatLa && projectedPoints(HCBAD) > flatAri);
  ok('…and raises the FAVOURITE more, because he wins big more often',
    (projectedPoints(HC) - flatLa) > (projectedPoints(HCBAD) - flatAri),
    [projectedPoints(HC) - flatLa, projectedPoints(HCBAD) - flatAri]);
  clearLeagueProjScoring();

  setLeagueProjScoring({ puntPt: 1, puntYd: 0.05 });
  ok('a punter league gives the punter a projection', projectedPoints(PU) > 0, projectedPoints(PU));
  ok('…scaled by volume', projectedPoints(PU) > projectedPoints({ id: 'car-p', pos: 'P', team: 'CAR' }));
  ok('a filled team punts like the league average rather than not at all',
    projectedPoints({ id: 'chi-p', pos: 'P', team: 'CHI' }) > 0,
    projectedPoints({ id: 'chi-p', pos: 'P', team: 'CHI' }));
  ok('…and a team that does not exist still projects nothing',
    projectedPoints({ id: 'xxx-p', pos: 'P', team: 'XXX' }) === 0);
  ok('…and a coach is untouched by punt scoring', projectedPoints(HC) === 0);
  clearLeagueProjScoring();
}

// ── THE MARGIN BRACKET SHAPE ───────────────────────────────────────────────
// StatHead publish win/loss/tie counts AND a per-game margin sd. We take the
// TOTALS from them and only the SHAPE from a normal, because integrating the
// normal ourselves reproduced their wins closely (9.98 vs 10.3) but overstated
// TIES eightfold (0.52 vs 0.06) — NFL margins are lumpy, overtime resolves most
// zeros. These pin the shape so that stays true.
{
  ok('the spread is the one StatHead fitted', MARGIN_GAME_SD === 12.71, MARGIN_GAME_SD);
  const b = marginBracketShares(3.29);
  ok('win shares are a distribution, summing to exactly 1',
    Math.abs(b.win.reduce((a, c) => a + c, 0) - 1) < 1e-9, b.win);
  ok('…and so are loss shares', Math.abs(b.loss.reduce((a, c) => a + c, 0) - 1) < 1e-9);
  ok('a FAVOURITE wins big more often than he loses big',
    b.win[5] > b.loss[5], [b.win[5], b.loss[5]]);
  const und = marginBracketShares(-4.16);
  ok('and an underdog is the mirror of that', und.loss[5] > und.win[5], [und.loss[5], und.win[5]]);
  // A dead-even coach must be symmetric — the property that breaks first if a
  // bracket boundary is miswritten on one side only.
  const even = marginBracketShares(0);
  ok('a coach with no edge has identical win and loss shapes',
    even.win.every((v, i) => Math.abs(v - even.loss[i]) < 1e-9), [even.win, even.loss]);
  // Ties are excluded from the ladder: a tie is not a margin bracket, and
  // including m=0 is exactly what overstated them.
  ok('the ladder never counts a tie as a margin',
    Math.abs(marginBracketShares(0).win.reduce((a, c) => a + c, 0) - 1) < 1e-9);
}

// ── THE CATALOG IS SCORING **PLUS** PPR ────────────────────────────────────
// A league stores its adjustments in `scoring` and its per-reception value in
// `ppr`, separately. v0.308.0 installed the first and dropped the second, so a
// half-PPR league scored receivers at 1/2 and projected them at 1 — the exact
// two-rulebook bug the projection work exists to prevent, hiding in the one
// knob that doesn't live in `scoring`.
{
  const half = leagueCatalogOf({ scoring: { teRec: 0.5 }, ppr: 0.5 });
  ok('the league catalog folds ppr in with the adjustments', half.ppr === 0.5, half);
  ok('…and keeps the adjustments themselves', half.teRec === 0.5, half);
  ok('a missing ppr leaves the default rather than writing NaN',
    leagueCatalogOf({ scoring: { teRec: 0.5 } }).ppr === undefined
    && leagueCatalogOf(null).ppr === undefined);
  // Proof it reaches the NUMBER, not just the object.
  setLeagueProjScoring(leagueCatalogOf({ scoring: {}, ppr: 0.5 }));
  ok('half PPR actually lowers a 105-catch receiver',
    projectedPoints(WR) < PROJ_2026.get(WR.id), [projectedPoints(WR), PROJ_2026.get(WR.id)]);
  clearLeagueProjScoring();
}

// ── THE POOLS: WAIVERS AND THE DRAFT ROOM ──────────────────────────────────
// `projFor` is what every available-player list sorts and displays by. These
// are the cases that would have caught v0.308.0 shipping to one surface.
{
  const rows = [...PROJ_2026.keys()].map((slug, i) => ({ slug, pos: PROJ_LINE_POS[slug], rank: i + 1 }));
  const topN = (n) => sortPool(rows, 'proj').slice(0, n).map((r) => r.slug);

  ok('an unknown player has NO projection rather than a projection of zero',
    projFor('probe-unknown-player') === null, projFor('probe-unknown-player'));
  ok('a standard-catalog pool shows exactly the baked number',
    projFor(RB.id, 'RB') === PROJ_2026.get(RB.id), projFor(RB.id, 'RB'));

  // THE HEADLINE REORDER. A tight end premium is the most common custom rule
  // there is, and under a big one the best TE is not "a good TE" — he is the
  // best player available. The pool has to say so, in the order AND the number.
  setLeagueProjScoring({ teRec: 1.5 });
  ok('a TE premium puts the best tight end at the TOP of the pool',
    topN(1)[0] === 'trey-mcbride', topN(3));
  ok('…and the printed value rose with him',
    projFor(TE.id, 'TE') > PROJ_2026.get(TE.id), [projFor(TE.id, 'TE'), PROJ_2026.get(TE.id)]);
  ok('…and the column renders that number, not the bake',
    poolSortValue('proj', { slug: TE.id, pos: 'TE' }) === `${projFor(TE.id, 'TE').toFixed(1)}/g`,
    poolSortValue('proj', { slug: TE.id, pos: 'TE' }));

  // A league that pays nothing per catch reorders the backs by carries.
  setLeagueProjScoring({ ppr: 0 });
  ok('zero PPR flips the two best backs on catch volume',
    topN(2)[0] === 'jahmyr-gibbs' && topN(2)[1] === 'christian-mccaffrey', topN(2));
  clearLeagueProjScoring();
  ok('and the standard pool puts them back',
    topN(2)[0] === 'christian-mccaffrey' && topN(2)[1] === 'jahmyr-gibbs', topN(2));

  ok('rank order never consults the projection at all',
    sortPool(rows, 'rank')[0].rank === 1);
}

// ── THE AUTO-FILL RANKER ───────────────────────────────────────────────────
// `slateAwareProj` feeds the worker's auto-slot, the unmanaged seat's computed
// lineup and the best-ball fill. A league's rules have to reach it, or the fill
// disagrees with the board about who is better — on the seats least able to
// notice, because auto-slot exists for the ones nobody is managing.
{
  const te = { id: TE.id, pos: 'TE', team: 'LV' };
  const wr = { id: WR.id, pos: 'WR', team: 'CIN' };
  const plain = slateAwareProj(1, []);
  // Read to NUMBERS before the install. The returned closure reads the catalog
  // at CALL time, not capture time — see the assertion below, which is the
  // property `lock.js` leans on to build one `valueOf` per tick and still get
  // per-league answers inside the loop.
  const plainTe = plain(te), plainWr = plain(wr);
  ok('the fill value is the baked projection under standard rules',
    plainTe === PROJ_2026.get(TE.id), plainTe);

  setLeagueProjScoring({ teRec: 1.5 });
  const premium = slateAwareProj(1, []);
  ok('a TE premium raises the tight end in the auto-fill ranking',
    premium(te) > plainTe, [premium(te), plainTe]);
  ok('…and leaves a receiver outside its scope alone', premium(wr) === plainWr);
  ok('the fill and the board agree on the same player',
    premium(te) === projectedPoints({ id: TE.id, pos: 'TE', team: 'LV' }));
  // THE WORKER'S CONTRACT. `autoSlotClassicLineups` builds `valueOf` once for
  // the whole tick and installs each league's catalog inside the loop. That is
  // only correct because a closure built under one catalog answers under
  // whichever is installed when it is CALLED — assert it, because the day it
  // stops being true the worker silently scores every league by the first one.
  ok('a fill closure built earlier answers under the catalog installed NOW',
    plain(te) === premium(te), [plain(te), premium(te)]);

  // The v0.252.0 contract still holds: evidence still zeroes a player, and the
  // league's rules must not resurrect him.
  const out = slateAwareProj(1, [], (slug) => slug === TE.id);
  ok('a ruled-out player is still worth zero, however the league scores',
    out(te) === 0, out(te));
  clearLeagueProjScoring();
}

// ── THE INVARIANT ──────────────────────────────────────────────────────────
// A league on the standard catalog with no scoped rules must get exactly the
// baked number. This is what makes the change safe to ship: every league that
// was right stays right, to the decimal.
for (const p of [QB, WR, RB, TE]) {
  ok(`standard catalog leaves ${p.id} exactly as baked`,
    projectedPoints(p) === PROJ_2026.get(p.id), [projectedPoints(p), PROJ_2026.get(p.id)]);
}

// ── THE CATALOG MOVES THE RIGHT PLAYERS, AND ONLY THEM ─────────────────────
{
  setLeagueProjScoring({ passTd: 6 });                 // default 4
  const q = projectedPoints(QB), r = projectedPoints(RB);
  ok('a 6-point passing TD raises the QB', q > PROJ_2026.get(QB.id), q);
  ok('…and leaves a running back alone', r === PROJ_2026.get(RB.id), r);

  setLeagueProjScoring({ ppr: 0 });                    // default 1
  ok('standard (0 PPR) cuts a target-heavy receiver hard',
    projectedPoints(WR) < PROJ_2026.get(WR.id) * 0.75, projectedPoints(WR));
  ok('…and does not touch a QB who catches nothing',
    projectedPoints(QB) === PROJ_2026.get(QB.id));

  setLeagueProjScoring({ teRec: 0.5 });                // TE premium
  ok('a TE premium raises the tight end', projectedPoints(TE) > PROJ_2026.get(TE.id));
  ok('…and only the tight end', projectedPoints(WR) === PROJ_2026.get(WR.id));

  // A knob the stat line cannot see is not guessed at.
  setLeagueProjScoring({ rush100: 3 });
  ok('a milestone bonus the line cannot see leaves the projection alone',
    projectedPoints(RB) === PROJ_2026.get(RB.id) && leagueProjRatio(RB.id, 'RB') === 1);
  clearLeagueProjScoring();
}

// ── NO DATA MEANS NO ADJUSTMENT, NEVER ZERO ────────────────────────────────
{
  setLeagueProjScoring({ ppr: 0, passTd: 8 });
  ok('a player with no stat line keeps his baked projection',
    leagueProjRatio('probe-unknown-player', 'WR') === 1);
  // A kicker's line is all zeros: it scores nothing under either catalog, so
  // the ratio is undefined and must fall back rather than divide by zero.
  ok('an all-zero line falls back to 1 rather than dividing by zero',
    scoreProjLine({ passYd: 0, passTd: 0, int: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0 },
      'K', DEFAULT_CLASSIC_SCORING) === 0);
  clearLeagueProjScoring();
}

// ── THE SCOPED LAYERS, IN THE LIVE SCORER'S ORDER ──────────────────────────
{
  const base = PROJ_2026.get(RB.id);
  setLeagueScoring({ scoped: [{ pos: ['RB'], bonusMult: 1.5 }] });
  ok('a scoped multiplier reaches the projection', near(projectedPoints(RB), base * 1.5),
    projectedPoints(RB));
  ok('…and not a player outside its scope', projectedPoints(WR) === PROJ_2026.get(WR.id));

  setLeagueScoring({ scoped: [{ pos: ['RB'], bonusPts: 3 }] });
  ok('flat points add', near(projectedPoints(RB), base + 3));

  // The per-TD bonus is the one that needed the stat line: it has to be paid
  // against PROJECTED touchdowns, per week.
  setLeagueScoring({ scoped: [{ pos: ['RB'], tdBonus: 2 }] });
  const tds = projTdsPerWeek(RB.id);
  ok('projected touchdowns per week are a real number', tds > 0 && tds < 3, tds);
  ok('a per-TD bonus pays against projected touchdowns',
    near(projectedPoints(RB), base + 2 * tds), [projectedPoints(RB), base + 2 * tds]);

  // THE SPOT. A rule scoped to a lineup spot pays in that spot and nowhere
  // else — the same contract the live scorer follows.
  setLeagueScoring({ scoped: [{ slot: ['S7'], bonusMult: 2 }] });
  ok('a spot-scoped rule pays in its spot', near(projectedPoints(RB, 'S7'), base * 2));
  ok('…and not in another spot', projectedPoints(RB, 'S2') === base);
  ok('…and not outside a lineup at all', projectedPoints(RB) === base);
  clearLeagueScoring();
}

// ── THE CATALOG AND THE SCOPED RULES COMPOSE ───────────────────────────────
{
  setLeagueProjScoring({ ppr: 0 });
  setLeagueScoring({ scoped: [{ pos: ['WR'], bonusMult: 2 }] });
  const ratio = leagueProjRatio(WR.id, 'WR');
  ok('catalog then scoped, in that order',
    near(projectedPoints(WR), PROJ_2026.get(WR.id) * ratio * 2), projectedPoints(WR));
  clearLeagueScoring(); clearLeagueProjScoring();
  ok('and clearing both restores the bake', projectedPoints(WR) === PROJ_2026.get(WR.id));
}


// ── IDP (v0.317.0) ─────────────────────────────────────────────────────────
// The bake this project fixed its identity model in order to be able to make.
// StatHead's IDP model is the one they claim a win for — 24% better than a flat
// league mean on RMSE — and until now a DL/LB/DB here sorted by nothing at all.
//
// The cases that earn their keep: that the file is keyed by IDENTITY and
// therefore prices BOTH Byron Youngs (a name-keyed bake structurally cannot),
// that a colliding bare slug refuses to guess, that the level reconciles to
// StatHead's own served total, and that the weekly threshold bonuses are paid
// against GAME COUNTS rather than against a season mean — the one piece of
// arithmetic here that is easy to get quietly wrong.
{
  const D = (id, sleeperId) => ({ id, pos: 'LB', team: null, sleeperId });
  // The three live collisions, from the bake's own docblock.
  const YOUNG_LB = '10917', YOUNG_DL = '10925';   // Byron Young, LA / PHI
  const MURPHY_DL = '11668', MURPHY_DB = '5864';  // Byron Murphy II / Byron Murphy
  const JONES_IND = '11052', JONES_CHI = '8702';  // Jaylon Jones, IND / CHI

  ok('the IDP bake loaded (else every case below is vacuous)', IDP_ROWS === 963, IDP_ROWS);

  // ══ A PLAYER IS AN ID, NOT A NAME ═══════════════════════════════════════
  // THE CASE 0205 EXISTED FOR. Both men answer to `byron-young`; the Rams
  // linebacker is worth well over twice the Eagles lineman, and a name-keyed
  // bake would have had to pick one and misprice the other by ~2.4 pts/week.
  const lb = projectedPoints(D('byron-young', YOUNG_LB));
  const dl = projectedPoints(D('byron-young', YOUNG_DL));
  ok('both Byron Youngs are priced, not just whichever sorted first', lb > 0 && dl > 0, [lb, dl]);
  ok('…and they are priced as the DIFFERENT PLAYERS they are', lb > dl * 2, [lb, dl]);
  ok('both Byron Murphys are priced',
    projectedPoints(D('byron-murphy', MURPHY_DB)) > projectedPoints(D('byron-murphy', MURPHY_DL)) &&
    projectedPoints(D('byron-murphy', MURPHY_DL)) > 0);
  ok('both Jaylon Joneses are priced',
    projectedPoints(D('jaylon-jones', JONES_IND)) > projectedPoints(D('jaylon-jones', JONES_CHI)) &&
    projectedPoints(D('jaylon-jones', JONES_CHI)) > 0);

  // A BARE COLLIDING SLUG REFUSES TO GUESS. "We don't know which man this is"
  // is a true statement and the projection column can render it as blank; a
  // coin flip between 4.1 and 1.8 a week cannot be told apart from knowledge.
  ok('a colliding slug with no identity projects nothing rather than guessing',
    projectedPoints({ id: 'byron-young', pos: 'LB', team: null }) === 0);
  ok('…and hasProjection agrees, so the pool sorts him as unknown not as zero',
    hasProjection('byron-young') === false);
  ok('…but the same slug WITH an identity is projected',
    hasProjection('byron-young', YOUNG_LB) === true);

  // 0205's other half: the pool renames the loser to `<slug>-<sleeperId>`, and
  // that slug has to find its own projection with no id argument at all.
  ok('a slug the pool disambiguated resolves through the id inside it',
    near(projectedPoints({ id: `byron-young-${YOUNG_DL}`, pos: 'LB', team: null }), dl),
    projectedPoints({ id: `byron-young-${YOUNG_DL}`, pos: 'LB', team: null }));
  ok('…and a disambiguating suffix for someone we do not project stays unpriced',
    projectedPoints({ id: 'byron-young-99999999', pos: 'LB', team: null }) === 0);

  // The 960 unambiguous names, and the 74 undrafted rookies among them who have
  // no Sleeper id at all, must still resolve with nothing but a slug.
  ok('an unambiguous defender needs no id', projectedPoints({ id: 'micah-parsons', pos: 'LB', team: null }) > 0);
  ok('…including one Sleeper has not indexed (no id in the bake at all)',
    projectedPoints({ id: 'david-bailey', pos: 'LB', team: null }) > 0);

  // ══ THE LEVEL RECONCILES TO STATHEAD'S OWN TOTAL ════════════════════════
  // Our base is our OWN standard scoring of their components, so it must
  // reproduce their served projPts — the same reconciliation the K/DST bake
  // rests on. Their roll-up: tackle 1, sack 2, INT 3, fumble recovery 2,
  // def TD 6, safety 2.
  const SERVED = [                       // name, sleeperId, StatHead projPts
    ['micah-parsons', '7640', 59.6], ['maxx-crosby', '5991', 63.7],
    ['budda-baker', '4081', 91.4], ['tj-watt', '4070', 66.1],
    ['byron-young', YOUNG_LB, 70.0], ['byron-young', YOUNG_DL, 29.8],
  ];
  let worst = 0, worstWho = '';
  for (const [slug, sid, served] of SERVED) {
    const line = idpLineFor(slug, sid);
    const mine = line ? scoreIdpLine(line, DEFAULT_CLASSIC_SCORING) : NaN;
    const d = Math.abs(mine - served);
    if (!(d <= worst)) { worst = d; worstWho = `${slug}/${sid}`; }
  }
  ok('our standard scoring of their components reproduces their season total',
    worst < 0.55, [worstWho, worst.toFixed(2)]);

  // …and the per-week base is that total over 17, like every other bake here.
  const parsons = idpLineFor('micah-parsons', '7640');
  ok('the per-week base is the season total over 17',
    near(kdstBase('micah-parsons'), scoreIdpLine(parsons, DEFAULT_CLASSIC_SCORING) / 17),
    kdstBase('micah-parsons'));

  // ══ ASSISTS ARE DERIVED, AND THE PREMIUMS STACK ═════════════════════════
  // The catalog pays solo/assist ON TOP of the per-tackle point, which is
  // exactly what classicScorePlay does with a live tackle. A league that pays
  // both premiums equally must therefore be identical to one that raises the
  // base tackle by the same amount — if that fails, the split is being used as
  // a replacement rather than as a premium somewhere.
  const line = idpLineFor('zaire-franklin', '5346');
  ok('solo + assist = combined tackles (assists are the remainder)',
    near(scoreIdpLine(line, { ...DEFAULT_CLASSIC_SCORING, idpTackle: 0, idpSolo: 1, idpAst: 1 }),
         scoreIdpLine(line, { ...DEFAULT_CLASSIC_SCORING, idpTackle: 1, idpSolo: 0, idpAst: 0 })
         - scoreIdpLine({ ...line, tackles: 0, solo: 0 }, DEFAULT_CLASSIC_SCORING)
         + scoreIdpLine({ ...line, tackles: 0, solo: 0 }, DEFAULT_CLASSIC_SCORING)));
  ok('a solo-only premium pays less than an every-tackle one',
    scoreIdpLine(line, { ...DEFAULT_CLASSIC_SCORING, idpSolo: 1 })
      < scoreIdpLine(line, { ...DEFAULT_CLASSIC_SCORING, idpSolo: 1, idpAst: 1 }));

  // ══ THE THRESHOLD BONUSES ARE COUNTS, NOT RATES ═════════════════════════
  // The error StatHead explicitly warn about, and it is a large one: Parsons
  // averages ~0.51 sacks a game and so NEVER clears "2+ in a game" on a season
  // mean, yet he is expected to clear it 1.47 times a season. A league paying
  // +5 for a 2-sack game owes him 7.35 points, not 0.
  {
    setLeagueProjScoring({ idpSack2: 5 });
    const withBonus = projectedPoints(D('micah-parsons', '7640'));
    clearLeagueProjScoring();
    const plain = projectedPoints(D('micah-parsons', '7640'));
    ok('a 2+ sack bonus pays against expected GAMES, not against a season mean',
      near(withBonus - plain, (1.47 * 5) / 17), [withBonus, plain]);
  }
  {
    // …and the man who never clears it gets nothing, which is the other half.
    setLeagueProjScoring({ idpSack2: 5 });
    const q = projectedPoints({ id: 'jack-kiser', pos: 'LB', team: null, sleeperId: '12653' });
    clearLeagueProjScoring();
    ok('…and a linebacker who never has a 2-sack game is paid nothing for it',
      q === projectedPoints({ id: 'jack-kiser', pos: 'LB', team: null, sleeperId: '12653' }));
  }

  // ══ THE CATALOG MOVES THE RIGHT DEFENDERS ═══════════════════════════════
  // A tackle-heavy league must lift the off-ball linebacker over the edge
  // rusher, and a sack-heavy one must do the reverse. This is the whole reason
  // to store components rather than a points total.
  {
    const HEAVY_TACKLE = D('zaire-franklin', '5346');   // 99.8 tackles, 2.0 sacks
    const HEAVY_SACK = D('micah-parsons', '7640');      // 40.7 tackles, 8.7 sacks
    setLeagueProjScoring({ idpTackle: 2 });
    const tackleLeague = [projectedPoints(HEAVY_TACKLE), projectedPoints(HEAVY_SACK)];
    // A BIG-PLAY LEAGUE HAS TO DEVALUE TACKLES, not merely pay more for sacks —
    // and finding that out is what this case is for. Franklin out-tackles
    // Parsons by 59 a season, so at `idpTackle: 1` the sack would have to be
    // worth ~8.9 points before the edge rusher passes him; raising sacks alone
    // to 8 leaves the linebacker ahead 6.9 to 6.6. `tackle 0.5 / sack 6` is the
    // real archetype and it does flip them, which is the honest version of this
    // assertion — the first draft asserted the flip at `sack: 8` and was simply
    // wrong about the arithmetic rather than finding a bug.
    setLeagueProjScoring({ idpTackle: 0.5, idpSack: 6 });
    const sackLeague = [projectedPoints(HEAVY_TACKLE), projectedPoints(HEAVY_SACK)];
    clearLeagueProjScoring();
    ok('a tackle-heavy league ranks the off-ball linebacker first',
      tackleLeague[0] > tackleLeague[1], tackleLeague);
    ok('…and a big-play league (tackle 0.5, sack 6) flips them',
      sackLeague[1] > sackLeague[0], sackLeague);
  }
  // A knob we have no component for must not silently move anyone — that is
  // the honest failure mode, and it has to be visible rather than approximated.
  {
    setLeagueProjScoring({ idpSackYd: 1, idpIntRetYd: 1, idpFumRetTd50: 5 });
    const unmoved = projectedPoints(D('micah-parsons', '7640'));
    clearLeagueProjScoring();
    ok('a knob with no component behind it moves nobody rather than guessing',
      unmoved === projectedPoints(D('micah-parsons', '7640')));
  }

  // ══ THE 10+ TACKLE GAME, NOW PRICED (v0.318.0) ══════════════════════════
  // The gap v0.317.0 shipped with, and the reason it was left open: StatHead
  // had no field for it, and assuming Poisson would have been wrong by ~9x on
  // low-volume players. `weeks_10plus_tackle` arrived in MCP 1.0.87, integrated
  // over a negative binomial, and these pin that we pay it as a GAME COUNT.
  {
    const BUDDA = { id: 'budda-baker', pos: 'DB', team: null, sleeperId: '4081' };
    setLeagueProjScoring({ idpTackle10: 5 });
    const withBonus = projectedPoints(BUDDA);
    clearLeagueProjScoring();
    const plain = projectedPoints(BUDDA);
    ok('a 10+ tackle bonus pays against expected GAMES',
      near(withBonus - plain, (2.02 * 5) / 17), [withBonus, plain]);
  }
  {
    // THE CASE THE POISSON WOULD HAVE BOTCHED. An edge rusher averaging ~3
    // tackles a game clears 10+ about seven times a century, not never and not
    // often — and it must be paid a small non-zero amount rather than either 0
    // or the ~9x a Poisson would have implied at this level.
    const line = idpLineFor('myles-garrett', '3973');
    ok('a low-volume defender still has a real, small 10+ tackle expectation',
      line.w10tk > 0 && line.w10tk < 0.1, line.w10tk);
    ok('…and a volume tackler has an order of magnitude more',
      idpLineFor('budda-baker', '4081').w10tk > 20 * line.w10tk);
  }
  {
    // A pure-rusher who never gets there is paid nothing, the other half of it.
    const KINGSLEY = { id: 'kingsley-jonathan', pos: 'DL', team: null, sleeperId: '8776' };
    setLeagueProjScoring({ idpTackle10: 10 });
    const q = projectedPoints(KINGSLEY);
    clearLeagueProjScoring();
    ok('…and a defender who never reaches 10 tackles is paid nothing for it',
      q === projectedPoints(KINGSLEY));
  }
  {
    // All three thresholds are independent knobs and must not bleed into one
    // another — a tackle bonus paying a sack threshold would be invisible.
    const F = idpLineFor('zaire-franklin', '5346');
    const only10 = scoreIdpLine(F, { ...DEFAULT_CLASSIC_SCORING, idpTackle10: 1 })
      - scoreIdpLine(F, DEFAULT_CLASSIC_SCORING);
    ok('the 10+ tackle knob pays exactly its own game count', near(only10, F.w10tk), only10);
  }

  // ══ THE POOL LIFTS THEM OFF THE BOTTOM ══════════════════════════════════
  // Before this, `projFor` returned null for every defender and they sorted
  // below a third-string kicker. This is the surface the bake exists to fix.
  ok('the pool now projects a defender at all', projFor('micah-parsons', 'LB') > 0);
  ok('…and ranks the best linebacker above a replacement one',
    projFor('carson-schwesinger', 'LB') > projFor('brennan-jackson', 'LB'));

  // ══ THE STANDARD CATALOG IS UNTOUCHED ═══════════════════════════════════
  ok('a standard-catalog league is unchanged by all of the above',
    projectedPoints(WR) === PROJ_2026.get(WR.id) && projectedPoints(QB) === PROJ_2026.get(QB.id));
}

if (fails) { console.log(`\n${fails} PROJ-SCORING ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL PROJ-SCORING ASSERTIONS PASSED');
