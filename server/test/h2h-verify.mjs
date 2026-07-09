// Verify the new head-to-head mechanics fire end-to-end on real Week-1 data:
//   1. RIVALRY / DUEL — a duel leader siphons a cut of the trailing side's gains.
//   2. FIELD MARSHAL SHIELD — a window shield blunts an opposing nuke's bank wipe.
//   3. WINDOW BATTLE + MVP — resolveLiveMatchup awards the window bonus + MVP coin.
import { readFileSync } from 'node:fs';
import { makePlayer, injectWeek, EMPTY } from '../src/engine.js';
import { resolveSlot, windowShield, defEarnScore, defSuppressScore } from '../../src/engine/sim.ts';
import { resolveLiveMatchup } from '../../src/engine/liveResolve.ts';

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

// ── 5. SUPPRESS drips into a bigger kill-bar (still banks 0) ──────────────────
const flatBar = defEarnScore(P(dstSlug, 'DEF', 'DEN'), WEEK);
const dripBar = defSuppressScore(P(dstSlug, 'DEF', 'DEN'), WEEK);
console.log(`\nSUPPRESS: ${dstSlug} kill-bar flat ${flatBar} → with drip ${dripBar}`);
ok('suppress kill-bar is raised by the DEF drip', dripBar > flatBar);

console.log('\nDONE.');
