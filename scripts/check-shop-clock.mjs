// Guard for THE SHOP'S CLOCK (core powerupAvailability, v0.388.6).
//
// Founder: "in the power up shop, let's have the power ups that you can't
// apply because the usage window has passed, have some kind of sign so we
// know what we can buy and apply last minute." Both shops label every card
// from this one rule, and the rule must say exactly what the SERVER gates say
// — a card the shop calls open that apply_targeted then refuses is worse than
// no sign at all. So this pins the rule to the migrations it mirrors: 0259
// (pre-match plays go per window), 0260 (on the LOCK clock; Extra Slot is
// scope 1 — closes at the week's first lock), 0255 (buying never blocks —
// a card keeps), 0121 (practice inventory is per week and doesn't carry).
// Run: npx tsx scripts/check-shop-clock.mjs
import { POWERUPS, powerupById, powerupAvailability, closesInLabel } from '../packages/core/src/data/powerups.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};
const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 13, 20, 0, 0);
const W = (id, phase, locksAt) => ({ id, label: id.toUpperCase(), phase, locksAt });
const pu = (id) => { const p = powerupById(id); if (!p) throw new Error('no powerup ' + id); return p; };
const momentum = pu('momentum'), extra = pu('extra-slot'), don = pu('double-or-nothing'), surge = pu('surge'), combo = pu('unlock-combo-drip'), clutch = pu('clutch-encore');

// ── 1. Tuesday: nothing locked → everything pre-match is open, live waits ──
{
  const wins = [W('thu', 'setup', NOW + 2 * 24 * H), W('early', 'setup', NOW + 5 * 24 * H), W('late', 'setup', NOW + 5 * 24 * H + 3 * H)];
  const a = powerupAvailability(momentum, wins);
  ok(a.state === 'open' && a.note === 'Before lock-in', 'Tuesday: a buff is open, before lock-in');
  ok(a.closesAt === NOW + 5 * 24 * H + 3 * H, 'Tuesday: a buff closes at the LAST window’s lock (last chance to arm)');
  const x = powerupAvailability(extra, wins);
  ok(x.state === 'open' && x.closesAt === NOW + 2 * 24 * H, 'Tuesday: Extra Slot closes at the week’s FIRST lock (scope 1, 0260)');
  ok(powerupAvailability(surge, wins).state === 'waiting', 'Tuesday: a real-time card is waiting for a live window');
  ok(powerupAvailability(clutch, wins).state === 'waiting', 'Tuesday: a clutch card is waiting too');
}

// ── 2. Thursday night: TNF live, Sunday still open ─────────────────────────
{
  const wins = [W('thu', 'live', NOW - 2 * H), W('early', 'setup', NOW + 3 * 24 * H), W('late', 'setup', NOW + 3 * 24 * H + 3 * H)];
  const a = powerupAvailability(momentum, wins);
  ok(a.state === 'open' && a.note === 'Counts the 2 windows still to lock', 'TNF live: a buff is still open, counting the 2 windows still to lock (0259)');
  ok(a.closesAt === NOW + 3 * 24 * H + 3 * H, 'TNF live: the buff’s deadline is Sunday’s last lock');
  ok(powerupAvailability(don, wins).state === 'open', 'TNF live: a targeted bet is open — Sunday’s windows accept it');
  const x = powerupAvailability(extra, wins);
  ok(x.state === 'passed' && x.note.startsWith('The week’s first window has locked'), 'TNF live: Extra Slot has PASSED — the first lock came and went');
  const s = powerupAvailability(surge, wins);
  ok(s.state === 'live' && s.note === 'Live now: THU', 'TNF live: a real-time card reads live now, naming the window');
}

// ── 3. Sunday 12:30pm: the early window LOCKED (inside its final hour) ─────
{
  const wins = [W('thu', 'final', NOW - 3 * 24 * H), W('early', 'locked', NOW - 30 * 60_000), W('late', 'setup', NOW + 2.5 * H)];
  const a = powerupAvailability(momentum, wins);
  ok(a.state === 'open' && a.note === 'Counts the 1 window still to lock', 'Sunday noon: a locked window no longer counts; ONE still to lock');
  ok(a.closesAt === NOW + 2.5 * H, 'Sunday noon: the deadline is the late window’s lock');
  ok(closesInLabel(a.closesAt, NOW) === 'in 2h 30m', 'Sunday noon: the countdown reads “in 2h 30m”');
  ok(powerupAvailability(surge, wins).state === 'waiting', 'Sunday noon: nothing live yet (locked ≠ live) — real-time card waits');
}

// ── 4. Sunday night: every window locked or done → pre-match has PASSED ────
{
  const wins = [W('thu', 'final', NOW - 3 * 24 * H), W('early', 'final', NOW - 8 * H), W('late', 'live', NOW - 4 * H)];
  const a = powerupAvailability(momentum, wins);
  ok(a.state === 'passed' && a.note === 'Every window has locked — keeps for next week', 'Sunday night: a buff has PASSED, and says the card keeps for next week (0255)');
  ok(a.closesAt === null, 'Sunday night: a passed card has no deadline');
  ok(powerupAvailability(don, wins).state === 'passed', 'Sunday night: a targeted bet has passed');
  ok(powerupAvailability(combo, wins).state === 'passed', 'Sunday night: a metric card has passed for THIS week (using it needs an open pick)');
  ok(powerupAvailability(surge, wins).state === 'live', 'Sunday night: a real-time card is live (SNF running)');
  const pr = powerupAvailability(momentum, wins, { practice: true });
  ok(pr.note === 'Every window has locked — practice cards don’t carry over', 'Practice week: a passed card says it will NOT carry (0121 per-week inventory)');
}

// ── 5. Monday night over: everything final → everything passed ─────────────
{
  const wins = [W('thu', 'final', 0), W('early', 'final', 0), W('late', 'final', 0), W('mnf', 'final', 0)];
  ok(POWERUPS.every((p) => powerupAvailability(p, wins).state === 'passed'), 'All windows final: EVERY card in the catalogue reads passed');
  ok(powerupAvailability(surge, wins).note.startsWith('Every window has finished'), 'All windows final: a real-time card says the windows have finished');
  const settled = powerupAvailability(momentum, [W('thu', 'setup', NOW + H)], { matchupFinal: true });
  ok(settled.state === 'passed' && settled.note.startsWith('This week is settled'), 'A settled matchup closes everything, whatever the windows say');
}

// ── 6. No honest deadline without a kickoff; no windows = no verdict ───────
{
  const wins = [W('thu', 'final', NOW - 3 * 24 * H), W('early', 'setup', null), W('late', 'setup', NOW + 2 * H)];
  const a = powerupAvailability(momentum, wins);
  ok(a.state === 'open' && a.closesAt === null, 'An open window with an unknown kickoff: still open, but no countdown is invented');
  const none = powerupAvailability(momentum, []);
  ok(none.state === 'open' && none.closesAt === null, 'No windows known: open, no deadline (the board hasn’t loaded them)');
}

// ── 7. The countdown label ─────────────────────────────────────────────────
{
  ok(closesInLabel(NOW + 30_000, NOW) === 'in under a minute', 'countdown: under a minute');
  ok(closesInLabel(NOW + 35 * 60_000, NOW) === 'in 35m', 'countdown: minutes');
  ok(closesInLabel(NOW + 2 * H, NOW) === 'in 2h', 'countdown: whole hours drop the minutes');
  ok(closesInLabel(NOW + 26 * H + 5 * 60_000, NOW) === 'in 1d 2h', 'countdown: days and hours');
  ok(closesInLabel(NOW - 1, NOW) === null, 'countdown: a deadline already gone renders nothing');
  ok(closesInLabel(null, NOW) === null, 'countdown: null in, null out');
}

if (fails) { console.error(`\n${fails} SHOP CLOCK PROBE(S) FAILED`); process.exit(1); }
console.log('\nALL SHOP CLOCK PROBES PASSED');
