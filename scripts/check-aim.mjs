// AIMED CARDS (v0.515.0) — the table both hosts light targets from.
//
// Founder: "Why can't I use my spy or ghost?" The app could not aim a card at
// all, and the web's Spy asked for the opponent's pick before lighting a spot —
// a pick that is sealed until kickoff, so Spy could never be played when it
// matters. This pins the table (core/data/aimRules): every aimed card has a
// rule, each rule points the way its card does, Spy goes on blind before
// kickoff, and every card the app records through apply_targeted is one the
// server's apply_targeted actually knows.
// Run: tsx scripts/check-aim.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { AIM_RULES, AIM_SELF_CONSUMING, aimSpotOk, aimWindowOk, aimPrompt, isAimed } from '../packages/core/src/data/aimRules';
import { POWERUPS } from '../packages/core/src/data/powerups';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// ── the table covers the cards ──
const aimedCards = POWERUPS.filter((p) => p.target && p.id !== 'extra-slot');
ok('every card with a target has an aim rule (Extra Slot plays through its own chooser)',
  aimedCards.every((p) => isAimed(p.id)), aimedCards.filter((p) => !isAimed(p.id)).map((p) => p.id));
ok('the swaps are aimed too (the web plays them on a spot)', isAimed('metric-swap') && isAimed('player-swap'));
ok('no rule for a card that does not exist', Object.keys(AIM_RULES).every((id) => POWERUPS.some((p) => p.id === id)),
  Object.keys(AIM_RULES).filter((id) => !POWERUPS.some((p) => p.id === id)));

const want = { 'slot-opp': 'theirs', 'slot-you': 'mine-filled', bye: 'mine-empty', window: 'window' };
ok('each rule points where its card does (their spot / your spot / an empty spot / a window)',
  aimedCards.every((p) => AIM_RULES[p.id].target === want[p.target]),
  aimedCards.filter((p) => AIM_RULES[p.id].target !== want[p.target]).map((p) => [p.id, p.target, AIM_RULES[p.id].target]));
ok('each rule plays in its card\'s moment (pre-match before kickoff, real-time while live)',
  Object.entries(AIM_RULES).every(([id, r]) => (POWERUPS.find((p) => p.id === id).timing === 'live') === (r.when === 'live')));

// ── Spy: the founder's card ──
const blind = { mine: false, theirs: false };
ok('Spy goes on BLIND before its window locks — their pick is sealed, the server peeks', aimSpotOk('spy', 'setup', 'their', blind));
ok('Spy still plays in the lock hour, up to kickoff (use_spy\'s own clock)', aimSpotOk('spy', 'locked', 'their', blind));
ok('Spy is done once the window kicks off', !aimSpotOk('spy', 'live', 'their', { mine: true, theirs: true }));
ok('Spy never aims at your own spot', !aimSpotOk('spy', 'setup', 'you', { mine: true, theirs: false }));
ok('Spy asks what to reveal once a spot is tapped', AIM_RULES.spy.follow === 'spy-reveal');

// ── Ghost: the other card ──
ok('Ghost lands on YOUR EMPTY spot before lock', aimSpotOk('ghost', 'setup', 'you', { mine: false, theirs: false }));
ok('Ghost never lands on a filled spot', !aimSpotOk('ghost', 'setup', 'you', { mine: true, theirs: false }));
ok('Ghost is closed once the window locks (apply_targeted refuses)', !aimSpotOk('ghost', 'locked', 'you', blind));
ok('Bye Steal is Ghost\'s shape, with a bye player to pick', AIM_RULES['bye-steal'].target === 'mine-empty' && AIM_RULES['bye-steal'].follow === 'bye-player');

// ── the rest of the shapes ──
ok('Jinx aims at their spot before lock, blind', aimSpotOk('jinx', 'setup', 'their', blind) && !aimSpotOk('jinx', 'locked', 'their', blind));
ok('Double or Nothing needs your filled spot', aimSpotOk('double-or-nothing', 'setup', 'you', { mine: true, theirs: false })
  && !aimSpotOk('double-or-nothing', 'setup', 'you', blind));
ok('Cold Snap needs a REVEALED player to freeze, live only', !aimSpotOk('cold-snap', 'live', 'their', blind)
  && aimSpotOk('cold-snap', 'live', 'their', { mine: false, theirs: true }) && !aimSpotOk('cold-snap', 'setup', 'their', { mine: false, theirs: true }));
ok('Surge plays on your live spot, not before', aimSpotOk('surge', 'live', 'you', { mine: true, theirs: true }) && !aimSpotOk('surge', 'setup', 'you', { mine: true, theirs: false }));
ok('Mulligan and Metric Swap ask for a metric', AIM_RULES.mulligan.follow === 'metric' && AIM_RULES['metric-swap'].follow === 'metric');
ok('Player Swap asks for a bench player', AIM_RULES['player-swap'].follow === 'bench-player');
ok('EMP aims at a LIVE window, never a spot', aimWindowOk('emp', 'live') && !aimWindowOk('emp', 'setup') && !aimSpotOk('emp', 'live', 'you', { mine: true, theirs: true }));
ok('Rivalry aims at a window before it locks', aimWindowOk('rivalry', 'setup') && !aimWindowOk('rivalry', 'locked'));
ok('nothing aims at a FINAL window', Object.keys(AIM_RULES).every((id) => !aimWindowOk(id, 'final')
  && !aimSpotOk(id, 'final', 'you', { mine: true, theirs: true }) && !aimSpotOk(id, 'final', 'their', { mine: true, theirs: true })));
ok('every card says where to tap', Object.keys(AIM_RULES).every((id) => aimPrompt(id).startsWith('Tap ')));

// ── the server knows every card the app records ──
// The app records a play with apply_targeted and then spends the card; Spy and
// Underdog take their own card (use_spy / apply_underdog). A card the server's
// apply_targeted does not handle would come back "not targetable".
const mig = 'supabase/migrations';
const files = readdirSync(mig).filter((f) => f.endsWith('.sql')).sort();
const latest = files.filter((f) => /create or replace function (public\.)?apply_targeted\(/.test(readFileSync(`${mig}/${f}`, 'utf8'))).pop();
const sql = readFileSync(`${mig}/${latest}`, 'utf8');
const body = sql.slice(sql.search(/create or replace function (public\.)?apply_targeted\(/));
const recorded = Object.keys(AIM_RULES).filter((id) => !AIM_SELF_CONSUMING.has(id));
ok(`apply_targeted (${latest}) handles every card the app records through it`,
  recorded.every((id) => body.includes(`'${id}'`)), recorded.filter((id) => !body.includes(`'${id}'`)));
ok('the self-consuming pair are exactly Spy and Underdog', [...AIM_SELF_CONSUMING].sort().join() === 'spy,unlock-underdog');

if (fails) { console.log(`\n${fails} AIM ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL AIM ASSERTIONS PASSED');
