// CLUTCH OFFERS (v0.624.1) — the rule both boards light an offer from.
//
// Founder, Turf Warriors, with Zay Flowers up 22.7 on a first-half TD:
// "I should be able to fire encore on Zay flowers" — and the app's hand read
// "The week has started — arms are closed." The clutch cards had no aim rule
// on the app, and the web's Encore waited for 30:00 to tick over before it
// offered a first-half TD. This pins core's clutchOffersFor (what the app
// now reads, and what the web's clutchOffers wraps) and the clutch aim rules.
// Run: tsx scripts/check-clutch.mjs
import { setLivePlays, clearLivePlays } from '../packages/core/src/data/realPbp.ts';
import { clutchOffersFor, clutchArmClock, ENCORE_ARM_UNTIL } from '../packages/core/src/engine/matchup.ts';
import { AIM_RULES, CLUTCH_TRIGGER, aimSpotOk, aimPrompt, isAimed, isClutch } from '../packages/core/src/data/aimRules.ts';
import { POWERUPS } from '../packages/core/src/data/powerups.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const WEEK = 906; // a week no bake owns
const zero = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const zay = { id: 'zay-flowers', name: 'Z. Flowers', full: 'Zay Flowers', pos: 'WR', team: 'BAL', stats: zero };
const rec = (c, y, td = 0) => ({ c, k: 'rec', y, td, ca: 1, tg: 1 });
const ev = (clock, side, youBank, theirBank, effect) => ({ clock, side, play: 'x', delta: 0, youBank, theirBank, ...(effect ? { effect } : {}) });
const ids = (o) => o.map((x) => x.id).sort().join(',');
const KEY = 'early|0';

// ── Encore: a first-half TD, from the TD itself ──
setLivePlays(WEEK, { 'zay-flowers': [rec(300, 24), rec(1788, 31, 1)] }); // the TD with 0:12 left in Q2
let o = clutchOffersFor({ player: zay, metricId: 'recyd', events: [], hasOpponent: true }, WEEK, KEY);
ok('a first-half TD offers Encore on that spot', ids(o) === 'clutch-encore', ids(o));
const enc = o.find((x) => x.id === 'clutch-encore');
ok('Encore is open from the TD, not from halftime (the founder was 12 game-seconds short)', enc.armFrom === 0 && 1788 >= enc.armFrom, enc);
ok('Encore stays open until late in the game', enc.armUntil === ENCORE_ARM_UNTIL && ENCORE_ARM_UNTIL > 1800, enc.armUntil);
ok('the note counts the half\'s TDs', enc.note === '1 first-half TD', enc.note);
ok('the slot key is the caller\'s (the app keys win|slot, the web win#slot)', enc.slotKey === KEY, enc.slotKey);
ok('Encore records the window clock it was armed at', clutchArmClock(enc, 1788) === 1788);

setLivePlays(WEEK, { 'zay-flowers': [rec(300, 24), rec(2000, 31, 1)] }); // a second-half TD only
o = clutchOffersFor({ player: zay, metricId: 'recyd', events: [], hasOpponent: true }, WEEK, KEY);
ok('a second-half TD earns no Encore', !o.some((x) => x.id === 'clutch-encore'), ids(o));

setLivePlays(WEEK, { 'zay-flowers': [rec(300, 24), rec(900, 31)] });
o = clutchOffersFor({ player: zay, metricId: 'recyd', events: [], hasOpponent: true }, WEEK, KEY);
ok('no TD, no Encore', o.length === 0, ids(o));

// ── Halftime Gamble: a 10+ lead at the half, until Q3 gets going ──
const lead = [ev(600, 'you', 8, 2), ev(1500, 'you', 14.5, 3), ev(2400, 'their', 14.5, 12)];
o = clutchOffersFor({ player: zay, metricId: 'recyd', events: lead, hasOpponent: true }, WEEK, KEY);
const don = o.find((x) => x.id === 'clutch-don');
ok('up 11.5 at the half offers the Gamble', !!don && don.note === 'Up 11.5 at half', o);
ok('the Gamble opens at halftime and closes five game-minutes later', don.armFrom === 1800 && don.armUntil === 2100, don);
ok('no opponent across the spot, no Gamble', !clutchOffersFor({ player: zay, metricId: 'recyd', events: lead, hasOpponent: false }, WEEK, KEY).some((x) => x.id === 'clutch-don'));
ok('a 9-point lead is not enough', !clutchOffersFor({ player: zay, metricId: 'recyd', events: [ev(1500, 'you', 12, 3)], hasOpponent: true }, WEEK, KEY).some((x) => x.id === 'clutch-don'));

// ── Counter-Wipe: a nuke just landed ──
const nuked = [ev(600, 'you', 8, 2), ev(2210, 'their', 0, 9, { type: 'nuke', text: '💥 NUKE — bank wiped' })];
o = clutchOffersFor({ player: zay, metricId: 'recyd', events: nuked, hasOpponent: true }, WEEK, KEY);
const cw = o.find((x) => x.id === 'clutch-counter');
ok('their nuke offers Counter-Wipe for a short window after it', !!cw && cw.armFrom === 2210 && cw.armUntil === 2510, o);
ok('Counter-Wipe records the nuke\'s clock, whatever the window reads now', clutchArmClock(cw, 2400) === 2210);
clearLivePlays();

// ── the aim table knows the clutch cards (the app's hand reads it) ──
const clutchIds = POWERUPS.filter((p) => p.id.startsWith('clutch-')).map((p) => p.id).sort();
ok('every clutch card is an aimed card now', clutchIds.every((id) => isAimed(id) && isClutch(id)), clutchIds.filter((id) => !isClutch(id)));
ok('the three are exactly the catalog\'s', clutchIds.join() === 'clutch-counter,clutch-don,clutch-encore', clutchIds);
ok('no other card is clutch', Object.keys(AIM_RULES).filter(isClutch).sort().join() === clutchIds.join());
ok('a clutch card lands on YOUR filled spot in a LIVE window', clutchIds.every((id) => AIM_RULES[id].target === 'mine-filled' && AIM_RULES[id].when === 'live'));
ok('…and so passes the plain spot check there', clutchIds.every((id) => aimSpotOk(id, 'live', 'you', { mine: true, theirs: true })));
ok('never before kickoff, never on their spot', clutchIds.every((id) => !aimSpotOk(id, 'setup', 'you', { mine: true, theirs: true }) && !aimSpotOk(id, 'locked', 'you', { mine: true, theirs: true }) && !aimSpotOk(id, 'live', 'their', { mine: true, theirs: true })));
ok('the prompt says the spot has to have earned it', clutchIds.every((id) => aimPrompt(id).startsWith('Tap ') && /earned/.test(aimPrompt(id))));
ok('each clutch card says what earns it', clutchIds.every((id) => (CLUTCH_TRIGGER[id] ?? '').length > 20));

if (fails) { console.log(`\n${fails} CLUTCH ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL CLUTCH ASSERTIONS PASSED');
