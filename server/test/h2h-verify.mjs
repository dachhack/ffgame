// Verify the new head-to-head mechanics fire end-to-end on real Week-1 data:
//   1. RIVALRY / DUEL — a duel leader siphons a cut of the trailing side's gains.
//   2. FIELD MARSHAL SHIELD — a window shield blunts an opposing nuke's bank wipe.
//   3. WINDOW BATTLE + MVP — resolveLiveMatchup awards the window bonus + MVP coin.
import { readFileSync } from 'node:fs';
import { makePlayer, injectWeek, EMPTY } from '../src/engine.js';
import { resolveSlot, windowShield, defEarnScore, defSuppressScore } from '../../src/engine/sim.ts';
import { resolveLiveMatchup } from '../../src/engine/liveResolve.ts';
import { clutchOffers } from '../../src/engine/matchup.ts';

const WEEK = 1;
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));
injectWeek(WEEK, w.pbp, w.points);

const P = (slug, pos, team) => makePlayer(slug, pos, team);
const ok = (label, cond) => console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`);

// ── 1. UNDERDOG ──────────────────────────────────────────────────────────────
// An underdog trailing a strong opponent should surface ×1.5 comeback-boosted
// plays (fired while behind) and bank a non-zero score.
const A = P('marquise-brown', 'WR', 'KC'), B = P('puka-nacua', 'WR', 'LA');
const under = resolveSlot({ player: A, metricId: 'underdog' }, { player: B, metricId: 'recyd' }, WEEK, 'underdog');
const boostEvents = under.events.filter((e) => e.effect && /UNDERDOG/.test(e.effect.text));
console.log(`\nUNDERDOG: A underdog ${under.youFinal} vs B recyd ${under.theirFinal} · ${boostEvents.length} boosted plays`);
ok('underdog surfaced ×1.5 comeback-boosted plays while trailing', boostEvents.length > 0);
ok('underdog side banks a non-zero score', under.youFinal > 0);

// ── 2. FIELD MARSHAL SHIELD ──────────────────────────────────────────────────
// A TD-nuke attacker vs a drip victim. With a maxed shield the victim keeps a
// fraction of the wiped bank instead of being zeroed.
const attacker = { player: P('saquon-barkley', 'RB', 'PHI'), metricId: 'td' };   // scores rush TDs → nukes
const victim = { player: P('puka-nacua', 'WR', 'LA'), metricId: 'rec' };          // banks 1/catch steadily
const noShield = resolveSlot(victim, attacker, WEEK, 'noshield');
const fullShield = resolveSlot(victim, attacker, WEEK, 'shield', { youShield: () => 0.5 });
const shieldNote = fullShield.events.some((e) => e.effect && /SHIELD/.test(e.effect.text));
console.log(`\nSHIELD: victim final no-shield ${noShield.youFinal} vs 50%-shield ${fullShield.youFinal}`);
ok('shield raised the victim final vs no-shield (blunted the nuke)', fullShield.youFinal > noShield.youFinal);
ok('shield note surfaced in the log', shieldNote);

// windowShield builds a ramping fraction from a real DST's splash plays.
const shieldFn = windowShield([{ player: P('den-dst', 'DEF', 'DEN'), metricId: 'marshal' }], WEEK, { reg: 3600 });
console.log(`windowShield(DEN DST marshal): ${shieldFn ? 'built · end-of-game ' + shieldFn(3300).toFixed(2) : 'none (no splash plays baked)'}`);

// ── 3. WINDOW BATTLE + MVP (resolveLiveMatchup) ──────────────────────────────
// One window, two slots each side. Home should win the window (bonus) if it
// out-totals away; the top slot overall is the MVP (coin only).
const home = [
  { win: 'early', slot: '0', player: P('saquon-barkley', 'RB', 'PHI'), metricId: 'rush' },
  { win: 'early', slot: '1', player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' },
];
const away = [
  { win: 'early', slot: '0', player: P('chase-brown', 'RB', 'CIN'), metricId: 'rush' },
  { win: 'early', slot: '1', player: P('marquise-brown', 'WR', 'KC'), metricId: 'recyd' },
];
const raw = resolveLiveMatchup(home, away, WEEK); // no bonus wiring here — compute base
// Re-run with a hand-check: sum slot scores, confirm the returned totals include
// a +5 window bonus for the higher side and +12 MVP coin for the top slot's side.
const st = raw.states.find((s) => s.window === 'early');
const slotSum = { home: 0, away: 0 };
for (const s of raw.slots) slotSum[s.side] += s.score;
console.log(`\nWINDOW BATTLE: state home ${st.home} / away ${st.away} · slot-sum home ${slotSum.home.toFixed(1)} / away ${slotSum.away.toFixed(1)}`);
const bonusApplied = Math.abs((st.home - slotSum.home)) >= 4.9 || Math.abs((st.away - slotSum.away)) >= 4.9;
ok('window-win bonus (+5) baked into the winning window state', bonusApplied);
console.log(`coin: home ${raw.coin.home} / away ${raw.coin.away} (includes window MVP ◈5/slot + 50 stipend + unopposed/notes)`);
ok('coin totals are positive (stipend + MVP + notes)', raw.coin.home > 50 && raw.coin.away > 50);

// ── 4. DEF EARN DRIP vs MARSHAL (distinct identities) ────────────────────────
// A splashy DST on `earn` should out-score the same DST on `marshal` (earn drips,
// marshal doesn't) — and marshal's shield is what it trades the drip for.
const dstSlug = 'den-dst';
const earnDst = resolveSlot({ player: P(dstSlug, 'DEF', 'DEN'), metricId: 'earn' }, { player: EMPTY, metricId: 'none' }, WEEK, 'earn');
const marshalDst = resolveSlot({ player: P(dstSlug, 'DEF', 'DEN'), metricId: 'marshal' }, { player: EMPTY, metricId: 'none' }, WEEK, 'marshal');
const defDripEvents = earnDst.events.filter((e) => e.effect && /DEF DRIP/.test(e.effect.text));
console.log(`\nDEF: ${dstSlug} earn ${earnDst.youFinal} (drip) vs marshal ${marshalDst.youFinal} (flat + shield)`);
ok('earn DST out-scores marshal DST (the drip is the ceiling)', earnDst.youFinal > marshalDst.youFinal);
ok('earn DST surfaced DEF DRIP tick events', defDripEvents.length > 0);

// ── 6. RIVALRY power-up — blind same-position siphon at window-end ────────────
// Home & away both field a WR in the same slot (a positional mirror). Home arms
// Rivalry on the window → siphons 50% of away's slot score. A non-mirror (WR vs
// RB) should whiff.
const rHome = [{ win: 'early', slot: '0', player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' }];
const rAwayMirror = [{ win: 'early', slot: '0', player: P('marquise-brown', 'WR', 'KC'), metricId: 'recyd' }];
const rAwayNoMirror = [{ win: 'early', slot: '0', player: P('chase-brown', 'RB', 'CIN'), metricId: 'rush' }];
const noRiv = resolveLiveMatchup(rHome, rAwayMirror, WEEK);
const withRiv = resolveLiveMatchup(rHome, rAwayMirror, WEEK, {}, { home: { rivalry: ['early'] } });
const whiff = resolveLiveMatchup(rHome, rAwayNoMirror, WEEK, {}, { home: { rivalry: ['early'] } });
const awayNo = noRiv.slots.find((s) => s.side === 'away').score;
const awayRiv = withRiv.slots.find((s) => s.side === 'away').score;
const whiffAway = whiff.slots.find((s) => s.side === 'away').score;
const whiffNo = resolveLiveMatchup(rHome, rAwayNoMirror, WEEK).slots.find((s) => s.side === 'away').score;
console.log(`\nRIVALRY: mirror away ${awayNo} → ${awayRiv} (siphoned) · non-mirror away ${whiffNo} → ${whiffAway} (whiff)`);
ok('rivalry siphons ~50% of a same-position rival', Math.abs(awayRiv - awayNo * 0.5) < 0.2);
ok('rivalry whiffs when the opponent plays a different position', Math.abs(whiffAway - whiffNo) < 0.05);

// ── 5. SUPPRESS drips into a bigger kill-bar (still banks 0) ──────────────────
const flatBar = defEarnScore(P(dstSlug, 'DEF', 'DEN'), WEEK);
const dripBar = defSuppressScore(P(dstSlug, 'DEF', 'DEN'), WEEK);
console.log(`\nSUPPRESS: ${dstSlug} kill-bar flat ${flatBar} → with drip ${dripBar}`);
ok('suppress kill-bar is raised by the DEF drip', dripBar > flatBar);

// ── 7. JINX — negate the opponent's first TD ─────────────────────────────────
// Away runs a TD-nuke RB (scores rush TDs). Home jinxes that slot → away's first
// TD is negated, so away's score drops.
const jHome = [{ win: 'early', slot: '0', player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' }];
const jAway = [{ win: 'early', slot: '0', player: P('saquon-barkley', 'RB', 'PHI'), metricId: 'td' }];
const jNo = resolveLiveMatchup(jHome, jAway, WEEK).slots.find((s) => s.side === 'away').score;
const jYes = resolveLiveMatchup(jHome, jAway, WEEK, {}, { home: { jinx: ['early|0'] } }).slots.find((s) => s.side === 'away').score;
console.log(`\nJINX: away TD-scorer ${jNo} → jinxed ${jYes}`);
ok('jinx lowered the opponent by negating their first TD', jYes < jNo);

// ── 8. RED HERRING — cap opposing same-position players in the window ─────────
// Home fields a low WR decoy + arms Red Herring on it; away's strong WR in the
// same window is capped to the decoy's total.
const rhHome = [{ win: 'early', slot: '0', player: P('keon-coleman', 'WR', 'BUF'), metricId: 'recyd' }];
const rhAway = [{ win: 'early', slot: '0', player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' }];
const rhNo = resolveLiveMatchup(rhHome, rhAway, WEEK);
const rhYes = resolveLiveMatchup(rhHome, rhAway, WEEK, {}, { home: { redHerring: ['early|0'] } });
const decoy = rhYes.slots.find((s) => s.side === 'home').score;
const capped = rhYes.slots.find((s) => s.side === 'away').score;
const uncapped = rhNo.slots.find((s) => s.side === 'away').score;
console.log(`\nRED HERRING: decoy ${decoy} · rival ${uncapped} → capped ${capped}`);
ok('red herring capped the opposing WR to the decoy total', capped <= decoy + 0.05 && capped < uncapped);

// ── 9. GRUDGE MATCH — win by 10+ → +25, lose → −25, else 0 ────────────────────
const gHome = [{ win: 'early', slot: '0', player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' }];
const gAway = [{ win: 'early', slot: '0', player: P('chase-brown', 'RB', 'CIN'), metricId: 'rush' }];
const gm = resolveLiveMatchup(gHome, gAway, WEEK);
const gh = gm.slots.find((s) => s.side === 'home').score, ga = gm.slots.find((s) => s.side === 'away').score;
const gYes = resolveLiveMatchup(gHome, gAway, WEEK, {}, { home: { grudge: ['early|0'] } }).slots.find((s) => s.side === 'home').score;
const gExpected = gh - ga >= 10 ? gh + 25 : gh - ga < 0 ? gh - 25 : gh;
console.log(`\nGRUDGE: home ${gh} vs away ${ga} (margin ${(gh - ga).toFixed(1)}) → with grudge ${gYes} (expected ${gExpected.toFixed(1)})`);
ok('grudge applied the correct ±25 by margin', Math.abs(gYes - gExpected) < 0.05 && gh - ga >= 10);

// ── 10. LEAD CHANGE — bonus is monotonic (never lowers) and ≥ 0 ───────────────
const lcPicks = [{ win: 'early', slot: '0', player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' }];
const lcAway = [{ win: 'early', slot: '0', player: P('marquise-brown', 'WR', 'KC'), metricId: 'recyd' }];
const lcNo = resolveLiveMatchup(lcPicks, lcAway, WEEK).slots.find((s) => s.side === 'home').score;
const lcYes = resolveLiveMatchup(lcPicks, lcAway, WEEK, {}, { home: { leadChange: ['early|0'] } }).slots.find((s) => s.side === 'home').score;
console.log(`\nLEAD CHANGE: home ${lcNo} → with lead-change ${lcYes} (+2 per seize)`);
ok('lead change never lowers the score (bonus ≥ 0, multiple of 2)', lcYes >= lcNo && Math.abs((lcYes - lcNo) % 2) < 0.001);

// ── 11. LIVE POWER-UPS: Surge / Cold Snap / Bunker ───────────────────────────
// SURGE: a flat QB scoring ×2 over the whole game (window [0, REG]) ≈ doubles.
const sqb = { player: P('josh-allen', 'QB', 'BUF'), metricId: 'pass' };
const sBase = resolveSlot(sqb, { player: EMPTY, metricId: 'none' }, WEEK, 'base').youFinal;
const sSurge = resolveSlot(sqb, { player: EMPTY, metricId: 'none' }, WEEK, 'surge', { youSurge: [0, 3600] }).youFinal;
console.log(`\nSURGE: base ${sBase} → surged ${sSurge} (≈2×)`);
ok('surge roughly doubled the score', sSurge > sBase * 1.8);

// COLD SNAP: freeze the same QB the whole game → scores ~0.
const sFroze = resolveSlot(sqb, { player: EMPTY, metricId: 'none' }, WEEK, 'freeze', { youFreeze: [0, 3600] }).youFinal;
console.log(`COLD SNAP: base ${sBase} → frozen ${sFroze}`);
ok('cold snap froze all scoring to ~0', sFroze < 0.1);

// BUNKER: a nuked victim keeps its bank when bunkered from kickoff.
const bVictim = { player: P('puka-nacua', 'WR', 'LA'), metricId: 'rec' };
const bAtk = { player: P('saquon-barkley', 'RB', 'PHI'), metricId: 'td' };
const bNo = resolveSlot(bVictim, bAtk, WEEK, 'nobunker').youFinal;
const bYes = resolveSlot(bVictim, bAtk, WEEK, 'bunker', { youBunkerFrom: 0 }).youFinal;
console.log(`BUNKER: nuked ${bNo} → bunkered ${bYes} (nuke blocked)`);
ok('bunker preserved the bank through the nuke', bYes > bNo);

// ── 12. CLUTCH PLAYS: Encore / Counter-Wipe / offer detection ────────────────
// ENCORE: arm from kickoff → the first TD banks +12.
const eTd = { player: P('saquon-barkley', 'RB', 'PHI'), metricId: 'td' };
const eNo = resolveSlot(eTd, { player: EMPTY, metricId: 'none' }, WEEK, 'no-encore').youFinal;
const eYes = resolveSlot(eTd, { player: EMPTY, metricId: 'none' }, WEEK, 'encore', { youDoubleTd: 0 }).youFinal;
console.log(`\nENCORE: base ${eNo} → +encore ${eYes} (next TD +12)`);
ok('encore added +12 to a post-arm TD', Math.abs(eYes - (eNo + 12)) < 0.05);

// COUNTER-WIPE: negate the nuke at its own clock → victim keeps its bank.
const cwVictim = { player: P('puka-nacua', 'WR', 'LA'), metricId: 'rec' };
const cwAtk = { player: P('saquon-barkley', 'RB', 'PHI'), metricId: 'td' };
const cwBase = resolveSlot(cwVictim, cwAtk, WEEK, 'cw');
const nukeEv = cwBase.events.find((e) => e.side === 'their' && e.effect?.type === 'nuke');
const cwYes = resolveSlot(cwVictim, cwAtk, WEEK, 'cw', { youCounterWipe: nukeEv?.clock ?? -1 }).youFinal;
console.log(`COUNTER-WIPE: nuked ${cwBase.youFinal} → countered ${cwYes} (nuke at ${nukeEv?.clock})`);
ok('counter-wipe negated the nuke and preserved the bank', cwYes > cwBase.youFinal);

// OFFER DETECTION: a first-half TD scorer surfaces a clutch-encore offer.
const oRes = resolveSlot(eTd, { player: P('marquise-brown', 'WR', 'KC'), metricId: 'recyd' }, WEEK, '');
const rSlot = { win: 'early', slotIndex: 0, you: eTd, their: { player: P('marquise-brown', 'WR', 'KC'), metricId: 'recyd' }, events: oRes.events, youFinal: oRes.youFinal, theirFinal: oRes.theirFinal };
const offers = clutchOffers(rSlot, WEEK);
console.log(`OFFERS: ${offers.map((o) => `${o.id}(${o.note})`).join(', ') || 'none'}`);
ok('clutch offer detection surfaced an Encore for a first-half TD', offers.some((o) => o.id === 'clutch-encore'));

// ── 13. NAPALM: a hot drip burns (accrual goes negative) ─────────────────────
// A WR drip vs an empty opponent goes HOT (3 straight catches, nobody to cool it).
// Napalm over the whole game should end far lower — the hot stretch bleeds points.
const napWR = { player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' };
const napBase = resolveSlot(napWR, { player: EMPTY, metricId: 'none' }, WEEK, 'base').youFinal;
const napRes = resolveSlot(napWR, { player: EMPTY, metricId: 'none' }, WEEK, 'napalm', { youNapalm: [0, 3600] });
const burns = napRes.events.filter((e) => e.effect === undefined && /NAPALM/.test(e.buffNote ?? '')).length;
console.log(`\nNAPALM: hot drip ${napBase} → napalmed ${napRes.youFinal} (${burns} burn ticks)`);
ok('napalm drove a hot drip well below its normal total', napRes.youFinal < napBase);
ok('napalm never pushed the bank below 0', napRes.youFinal >= 0 && burns > 0);

// ── 14. GHOST PLAYER: a phantom fills an empty slot for a flat set score ──────
// Away fields nobody in the window; a Ghost armed on that slot conjures a
// phantom worth a flat 14, opposing home's real player head-to-head.
const ghHome = [{ win: 'early', slot: '0', player: P('puka-nacua', 'WR', 'LA'), metricId: 'recyd' }];
const gRes = resolveLiveMatchup(ghHome, [], WEEK, {}, { away: { ghost: ['early|0'] } });
const ghostSlot = gRes.slots.find((s) => s.side === 'away' && s.slug === '__ghost__');
console.log(`\nGHOST: away conjured a phantom → ${ghostSlot ? ghostSlot.score : 'none'} (expected 14)`);
ok('ghost filled the empty away slot with a phantom', !!ghostSlot);
ok('ghost banked the flat set score of 14', ghostSlot?.score === 14);

console.log('\nDONE.');
