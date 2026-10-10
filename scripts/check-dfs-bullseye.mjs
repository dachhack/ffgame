// DFS BULLSEYE (v0.660.0) — the squad shape, the card, the scoring and the
// aimed auto-build (packages/core/src/engine/dfsBullseye.ts), and the wiring
// that makes the worker use them. Spec: docs/dfs-bullseye.md.
import fs from 'node:fs';
import {
  DFS_SLOTS, DFS_SLOT_NAMES, DFS_CAP, dfsCard, dfsSlotsOf, scoreDfsBullseye, aimBuild, dfsBullseyeConfigOf, squadSalary,
  dfsTiebreak, tiebreakDistance, TIEBREAK_SLOTS,
} from '../packages/core/src/engine/dfsBullseye.ts';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// ── the setting ─────────────────────────────────────────────────────────────
ok('config: off without dfs_bullseye', dfsBullseyeConfigOf({ bullseye: 'slots' }) === null);
const slots = dfsBullseyeConfigOf({ dfs_bullseye: true, bullseye: 'slots' });
ok('config: slots, radius 10, shared', slots?.variant === 'slots' && slots.radius === 10 && slots.deal === 'shared', slots);
ok('config: total with its radius', dfsBullseyeConfigOf({ dfs_bullseye: true, bullseye: 'total', bullseye_radius: 12 })?.radius === 12);

// ── the card ────────────────────────────────────────────────────────────────
const card = dfsCard('league-a', 6);
ok('card: a target per slot', DFS_SLOT_NAMES.every((s) => card.targets[s] > 0), card.targets);
ok('card: every target a multiple of 5', Object.values(card.targets).every((t) => t % 5 === 0));
ok('card: total is the sum', card.total === Object.values(card.targets).reduce((a, b) => a + b, 0));
ok('card: dealt the same every time', JSON.stringify(dfsCard('league-a', 6)) === JSON.stringify(card));
ok('card: another week deals differently somewhere', [7, 8, 9, 10].some((w) => JSON.stringify(dfsCard('league-a', w).targets) !== JSON.stringify(card.targets)));

// ── a stored squad ──────────────────────────────────────────────────────────
const named = DFS_SLOT_NAMES.map((s, i) => ({ slot: s, player_slug: `p${i}`, pos: DFS_SLOTS[i].pos[0] }));
ok('slots: named rows read by name', JSON.stringify(Object.values(dfsSlotsOf(named))) === JSON.stringify(named.map((r) => r.player_slug)));
const legacy = [
  { slot: 0, player_slug: 'qb', pos: 'QB' }, { slot: 1, player_slug: 'rb-a', pos: 'RB' }, { slot: 2, player_slug: 'rb-b', pos: 'RB' },
  { slot: 3, player_slug: 'wr-a', pos: 'WR' }, { slot: 4, player_slug: 'wr-b', pos: 'WR' }, { slot: 5, player_slug: 'wr-c', pos: 'WR' },
  { slot: 6, player_slug: 'te', pos: 'TE' }, { slot: 7, player_slug: 'buf-k', pos: 'K' }, { slot: 8, player_slug: 'buf-dst', pos: 'DEF' },
];
const ls = dfsSlotsOf(legacy);
ok('slots: a numbered (save_pod_entry) squad fills in position order', ls.RB1 === 'rb-a' && ls.RB2 === 'rb-b' && ls.WR3 === 'wr-c' && ls.DEF === 'buf-dst', ls);
ok('slots: junk is empty slots', Object.values(dfsSlotsOf(null)).every((v) => v === null));

// ── scoring ─────────────────────────────────────────────────────────────────
const fixed = { targets: Object.fromEntries(DFS_SLOT_NAMES.map((s) => [s, 10])), total: 90 };
const squad = Object.fromEntries(DFS_SLOT_NAMES.map((s) => [s, `${s}-guy`]));
const exact = scoreDfsBullseye({ home: squad, away: squad }, fixed, slots, () => 10);
ok('slots: nine bullseyes bank 9 × (10 + 10)', exact.home === 180 && exact.away === 180, exact.home);
ok('slots: every row carries its dart', exact.slots.filter((r) => r.side === 'home').every((r) => r.aim && r.aim.target === 10));
ok('slots: rows are the classic wk window', exact.slots.every((r) => r.win === 'wk') && exact.states[0].window === 'wk');
const zero = scoreDfsBullseye({ home: squad, away: squad }, fixed, slots, (slug) => (slug === 'QB-guy' ? 0 : 10));
ok('slots: a zero misses AND costs the radius', zero.home === 8 * 20 - 10, zero.home);
const short = { ...squad, K: null };
const missing = scoreDfsBullseye({ home: short, away: squad }, fixed, slots, () => 10);
ok('slots: an empty slot is a zero too', missing.home === 8 * 20 - 10 && missing.away === 180, [missing.home, missing.away]);
const total = dfsBullseyeConfigOf({ dfs_bullseye: true, bullseye: 'total' });
const t1 = scoreDfsBullseye({ home: squad, away: squad }, fixed, total, () => 10);
ok('total: landing on 90 with nine players is a bullseye at radius 90', t1.home === 180, t1.home);
const t2 = scoreDfsBullseye({ home: squad, away: squad }, fixed, total, () => 12);
ok('total: 108 against 90 is 18 off', t2.home === 90 - 18, t2.home);

// ── the aimed auto-build ────────────────────────────────────────────────────
const board = [];
const pos = { QB: [12, 18, 24, 30], RB: [5, 9, 14, 19, 24], WR: [5, 9, 14, 19, 24], TE: [5, 8, 12], K: [6, 8, 10], DEF: [4, 7, 10] };
for (const [p, projs] of Object.entries(pos)) projs.forEach((pr, i) => board.push({ slug: `${p}-${i}`, pos: p, proj: pr, salary: Math.max(3000, Math.round(pr * 400 / 100) * 100) }));
const target = dfsCard('league-b', 3);
const built = aimBuild(board, target, 'seed-1');
ok('build: fills every slot', DFS_SLOT_NAMES.every((s) => built[s]), built);
ok('build: each player plays his position', DFS_SLOTS.every((d) => board.find((b) => b.slug === built[d.slot])?.pos === d.pos[0]));
ok('build: never over the cap', squadSalary(built, (s) => board.find((b) => b.slug === s)?.salary ?? 0) <= DFS_CAP);
ok('build: no player twice', new Set(Object.values(built)).size === 9);
const offBy = DFS_SLOT_NAMES.reduce((sum, s) => sum + Math.abs((board.find((b) => b.slug === built[s])?.proj ?? 0) - target.targets[s]), 0);
const greedy = DFS_SLOT_NAMES.reduce((sum, s) => sum + Math.abs(Math.max(...board.filter((b) => b.pos === DFS_SLOTS.find((d) => d.slot === s).pos[0]).map((b) => b.proj)) - target.targets[s]), 0);
ok('build: aims closer than taking the biggest projection', offBy < greedy, { offBy, greedy });
ok('build: the same seed builds the same squad', JSON.stringify(aimBuild(board, target, 'seed-1')) === JSON.stringify(built));

// ── the tie-breaker (v0.660.1) ──────────────────────────────────────────────
const tbs = [1, 2, 3, 4, 5, 6, 7, 8].map((rid) => ({ rid, tb: dfsTiebreak('league-a', 6, rid, card) }));
ok('tiebreak: always an RB or WR spot', tbs.every(({ tb }) => TIEBREAK_SLOTS.includes(tb.slot)), tbs);
ok('tiebreak: within 1–4 of that spot\'s card target, never on it', tbs.every(({ tb }) => { const d = Math.abs(tb.target - card.targets[tb.slot]); return (d >= 1 && d <= 4) || tb.target === 3; }));
ok('tiebreak: every team its own (not all the same spot and number)', new Set(tbs.map(({ tb }) => `${tb.slot}:${tb.target}`)).size > 1);
ok('tiebreak: dealt the same every time', JSON.stringify(dfsTiebreak('league-a', 6, 3, card)) === JSON.stringify(tbs[2].tb));
ok('tiebreak distance: |points − target|', tiebreakDistance(13.5, 12, 10) === 1.5);
ok('tiebreak distance: a zero is the target plus the radius', tiebreakDistance(0, 12, 10) === 22);
const tbA = { slot: 'RB1', target: 12 };
const scored = scoreDfsBullseye({ home: squad, away: squad }, fixed, slots, (slug) => (slug === 'RB1-guy' ? 13 : 10), { tiebreak: { home: tbA, away: { slot: 'WR2', target: 9 } } });
ok('tiebreak: each side measured on its own spot', scored.tiebreak.home === 1 && scored.tiebreak.away === 1, scored.tiebreak);
ok('tiebreak: it does not change the ring score', scored.home === scoreDfsBullseye({ home: squad, away: squad }, fixed, slots, (slug) => (slug === 'RB1-guy' ? 13 : 10)).home);

// ── sealed (v0.660.1): a player still to kick off is neither written nor a zero ─
const live = scoreDfsBullseye({ home: squad, away: squad }, fixed, slots, () => 10, { pending: (slug) => slug === 'K-guy' || slug === 'DEF-guy' });
ok('sealed: no row for a player whose game hasn\'t started', !live.slots.some((r) => r.slug === 'K-guy' || r.slug === 'DEF-guy'));
ok('sealed: and no zero penalty for him either', live.home === 7 * 20, live.home);

// ── the wiring ──────────────────────────────────────────────────────────────
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const resolve = read('server/src/resolve.js');
ok('worker: the DFS branch comes before classic', resolve.indexOf('if (dfsCfg) {') > 0 && resolve.indexOf('if (dfsCfg) {') < resolve.indexOf("} else if (gameMode.mode === 'classic') {"));
ok('worker: modeOfSettings carries dfs_bullseye', /dfs_bullseye: s\?\.dfs_bullseye === true/.test(resolve));
ok('worker: scored under stock PPR with the slot position', /classicPoints\(player\(slug\), matchup\.week, 1, dfsSlotPos\(slot\)/.test(resolve));
ok('lock: no drip auto-lineup for a Bullseye contest', /settings_json\?\.dfs_bullseye === true\) continue/.test(read('server/src/lock.js')));
const pods = read('server/src/pods.js');
ok('pods: AI seats and no-shows aim at the card', /aimBuild\(board, card/.test(pods));
ok('pods: the open contest is skipped in the seat loop', /if \(pod\.kind === 'bullseye'\) continue;/.test(pods));
const sql = read('supabase/migrations/0462_dfs_bullseye.sql');
ok('sql: slot names match the engine', /array\['QB','RB1','RB2','WR1','WR2','WR3','TE','K','DEF'\]/.test(sql));
ok('sql: the cap matches the engine', sql.includes('cap int := 50000') && DFS_CAP === 50000);

if (fails) { console.log(`\n${fails} DFS-BULLSEYE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL DFS-BULLSEYE ASSERTIONS PASSED');
