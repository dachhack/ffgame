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
// v0.683.0 (founder: "why are there rings? It's just a target number and how far you are from it"): the
// total variant's score IS the distance from the target, lowest winning, like golf — no longer a ring.
ok('total: landing on 90 with nine players is dead on — 0 off', t1.home === 0, t1.home);
const t2 = scoreDfsBullseye({ home: squad, away: squad }, fixed, total, () => 12);
ok('total: 108 against 90 is 18 off', t2.home === 18, t2.home);

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
ok('worker: the contest branch comes before classic', resolve.indexOf('if (contestCfg) {') > 0 && resolve.indexOf('if (contestCfg) {') < resolve.indexOf("} else if (gameMode.mode === 'classic') {"));
ok('worker: modeOfSettings carries dfs_bullseye', /dfs_bullseye: s\?\.dfs_bullseye === true/.test(resolve));
ok('worker: scored under the league\'s catalog, RET spots as RET', /classicPoints\(player\(slug\), matchup\.week, catalog, contestScoreAs\(def\), slot\)/.test(resolve));
ok('lock: no drip auto-lineup for a Bullseye contest', /settings_json\?\.dfs_bullseye === true\) continue/.test(read('server/src/lock.js')));
const pods = read('server/src/pods.js');
// v0.695.0: contest builds take cpuPool — `playable` (the ruled out dropped) re-priced the league's way.
ok('pods: AI seats and no-shows aim at the card', /aimBuild\(board, card/.test(pods) && /contestAutoBuild\(cpuPool\.filter\(\(b\) => !teamLocked\(b\.team\)\), contest,/.test(pods) && /const cpuPool = contest \? playable\.map/.test(pods));
// v0.673.0: a leaderboard league takes the no-show block (its NO SQUAD BY LOCK
// rule) and then leaves the loop — no AI seats to sub, no pairs to make.
ok('pods: a leaderboard contest gets its no-shows, then leaves the seat loop', /noShowBuilds\(contest, mems \?\? \[\], haveSet, lockPassed\)/.test(pods) && /if \(boardLeague\) continue;/.test(pods) && !/if \(contest && contest\.format === 'board'\) continue;/.test(pods));
const sql = read('supabase/migrations/0462_dfs_bullseye.sql');
ok('sql: slot names match the engine', /array\['QB','RB1','RB2','WR1','WR2','WR3','TE','K','DEF'\]/.test(sql));
ok('sql: the cap matches the engine', sql.includes('cap int := 50000') && DFS_CAP === 50000);

// ── Bullseye leagues (v0.661.0, 0463) ──────────────────────────────────────
const { bullseyeMaxSeats, bullseyeLeagueLine } = await import('../packages/core/src/data/liveApi.ts');
const { readInviteParams } = await import('../packages/core/src/data/invite.ts');
ok('size: 32 for anyone', bullseyeMaxSeats(false, {}) === 32);
ok('size: 50,000 for an admin or a bullseye_host', bullseyeMaxSeats(true, {}) === 50000 && bullseyeMaxSeats(false, { bullseye_host: true }) === 50000);
const line = bullseyeLeagueLine({ variant: 'total', radius: 10, span: 'season', week: null, max_seats: 50000, seats_taken: 1234 });
ok('board line: variant, span, cap and size', line.includes('one team total') && line.includes('all season') && line.includes('$50k') && line.includes('1,234 of 50,000'), line);
ok('invite link: ?bullseye=CODE is read', readInviteParams((k) => (k === 'bullseye' ? 'abcd1234' : null))?.bullseye === 'ABCD1234');
const sql2 = read('supabase/migrations/0463_bullseye_leagues.sql');
ok('sql: 32 for anyone, 50,000 for a host', /then 50000 else 32 end/.test(sql2) && sql2.includes("'bullseye_host'"));
ok('sql: the board counts a Bullseye league\'s open spots, not empty seat rows', sql2.includes("'seats_open',  _league_seats_open(l.id)") && sql2.includes('_league_seats_open(l.id) > 0'));
ok('sql: joining from the board takes a Bullseye seat', /if k = 'bullseye' then return _bullseye_take_seat/.test(sql2));
ok('sql: the open contest is found, never made', !/insert into league[^;]*'BULL-'/.test(sql2));
ok('sql: a season league takes a squad from the week in play on', sql2.includes("lg.contest_week is null and p_week < coalesce(_contest_week(lg.season), 1)"));
ok('pods: no open contest made; season leagues get the board', !pods.includes('ensureBullseyeContest(') && pods.includes("(l.kind === 'bullseye' && l.contest_week == null)"));
const web = read('src/screens/LiveOnboard.tsx');
ok('web: a contest league opens its own rooms', web.includes("isContestKind(e.league?.kind)") && web.includes('<BullseyeLeaguePage'));
const app = read('apps/mobile/App.tsx');
ok('phone: a contest league opens its own rooms on the room bar', app.includes("open && isContestKind(open.kind) && view !== 'chat' && view !== 'commishtools'") && app.includes('<BullseyeLeagueRoom'));
for (const f of ['src/screens/BullseyeLeague.tsx', 'apps/mobile/src/screens/BullseyeLeague.tsx']) {
  const src = read(f);
  ok(`${f}: matchup, league, team and settings rooms on the contest squad`, ['TeamRoom', 'LeagueRoom', 'SettingsRoom', 'ContestSquad', 'contestLeague(', 'contestBoard('].every((k) => src.includes(k)));
}
// COMMISH is the classic console, trimmed, with the CONTEST card (v0.664.0).
ok('web: the commish room is CommishDash, with the CONTEST panel', read('src/screens/BullseyeLeague.tsx').includes('<CommishDash focusId={leagueId}') && read('src/screens/CommishDash.tsx').includes('contest: <ContestCommishPanel'));
ok('web: a contest league\'s map drops draft, waivers, playoffs, contracts and coin', /const navGroups: NavGroup<LeagueTab>\[\] = contest \? \[/.test(read('src/screens/AdminPage.tsx')));
const tools = read('apps/mobile/src/screens/CommishTools.tsx');
// The one CONTEST card became five contest-only sections (THE GAME, SEATS & ENTRIES, DRIP COIN, WEEKS & PLAYOFFS, DUES & PRIZES).
ok('phone: CommishTools takes `contest`, shows the contest sections and hides MODE', tools.includes("{ id: 'contest', label: '🏁 THE GAME', contestOnly: true }") && tools.includes("{ id: 'contestseats', label: 'SEATS & ENTRIES', contestOnly: true }") && tools.includes("{ id: 'mode', label: 'MODE', notContest: true }") && tools.includes("section === 'contest' && <ContestCommishCard"));
ok('phone: the commish room goes through CommishTools with the contest flag', app.includes('contest={isContestKind(open.kind)}'));

// ── contest leagues (v0.664.0, 0466): one league type, three contests ────────
const C = await import('../packages/core/src/engine/contest.ts');
const { leagueSlotDefs } = await import('../packages/core/src/engine/classic.ts');
ok('contest: a bullseye league with no `contest` key is a Bullseye contest, leaderboard, $50k, the DFS nine', (() => {
  const c = C.contestConfigOf({ dfs_bullseye: true, bullseye: 'total', bullseye_radius: 12 }, 'bullseye');
  return c?.contest === 'bullseye' && c.format === 'board' && c.budget === 50000 && c.slots.length === 9 && c.bullseye?.variant === 'total' && c.bullseye.radius === 12 && c.bullseye.deal === 'shared';
})());
ok('contest: a dfs league with no `contest` key is HIGH, head-to-head', C.contestConfigOf({}, 'dfs')?.contest === 'high' && C.contestConfigOf({}, 'dfs')?.format === 'h2h');
ok('contest: not a contest without a kind or key', C.contestConfigOf({ game_mode: 'classic' }, 'league') === null);
// THE SQUAD CARD (v0.676.0)
{
  const SC = await import('../packages/core/src/data/squadCard.ts');
  const slots = [{ slot: 'S1', type: 'QB', pos: ['QB'] }, { slot: 'S2', type: 'RB', pos: ['RB'] }];
  const names = { hurts: 'Jalen Hurts', barkley: 'Saquon Barkley' };
  const base = { league: 'Kickoff Bullseye', week: 6, contest: 'bullseye', slots, labels: { S1: 'QB', S2: 'RB' }, picks: { S1: 'hurts', S2: 'barkley' },
    nameOf: (s) => names[s] ?? s, scoreOf: (slot) => (slot === 'S1' ? 22.4 : null), total: 142.3, rank: 2, entries: 12, opponent: { team: 'Mud Dogs', score: 131 }, link: 'https://www.dripfantasy.com/?bullseye=ABCD1234' };
  const t = SC.squadCardText({ ...base, status: 'final' });
  ok('card: the head, a line per spot with points once played, the ring and place, the result, the link',
    t === '🎯 Kickoff Bullseye · Week 6 · FINAL\nQB: Jalen Hurts 22.4\nRB: Saquon Barkley\nRing 142.3 ring · 2nd of 12\nvs Mud Dogs 131.0 — won\nJoin: https://www.dripfantasy.com/?bullseye=ABCD1234', t);
  const g = SC.squadCardText({ ...base, contest: 'golf', status: 'final', total: 40, opponent: { team: 'Mud Dogs', score: 55 }, link: null, rank: null });
  ok('card: golf wins low, says Total, and leaves out what it lacks', /⛳ Kickoff Bullseye/.test(g) && /Total 40.0 pts\nvs Mud Dogs 55.0 — won$/.test(g) && !/Join:/.test(g), g);
  const pre = SC.squadCardText({ ...base, status: null, total: null, opponent: null, scoreOf: () => null });
  ok('card: before kickoff it says squad set and shows no points', /· squad set\nQB: Jalen Hurts\nRB: Saquon Barkley\nJoin:/.test(pre), pre);
}
// PLAYOFFS (v0.674.0): a season head-to-head league plays the classic bracket by default
{
  const h2h = C.contestConfigOf({ contest_format: 'h2h' }, 'dfs'), board = C.contestConfigOf({ contest_format: 'board' }, 'dfs');
  ok('playoffs: head-to-head over the season — four from week 15 by default', JSON.stringify(C.contestPlayoffs({}, h2h, null)) === '{"teams":4,"startWeek":15}');
  ok('playoffs: the commissioner’s rules are read; off is 0', JSON.stringify(C.contestPlayoffs({ playoff_teams: 6, playoff_start_week: 14 }, h2h, null)) === '{"teams":6,"startWeek":14}' && C.contestPlayoffs({ playoff_teams: 0 }, h2h, null).teams === 0);
  ok('playoffs: a leaderboard or a one-week league plays none', C.contestPlayoffs({}, board, null).teams === 0 && C.contestPlayoffs({}, h2h, 6).teams === 0);
  const pods = read('server/src/pods.js');
  ok('pods: the round-robin stops at the bracket and the SQL is poked', /week >= po\.startWeek/.test(pods) && /rpc\('generate_playoffs'/.test(pods) && /rpc\('advance_playoffs'/.test(pods));
}
// NO SQUAD BY LOCK and ENTRIES (v0.673.0)
ok('late: head-to-head builds, a leaderboard sits out, entries open — by default', C.contestConfigOf({}, 'dfs')?.lateEntry === 'cpu' && C.contestConfigOf({ contest_format: 'board' }, 'dfs')?.lateEntry === 'drop' && C.contestConfigOf({}, 'dfs')?.entryDeadline === 'open');
ok('late: the settings are read; drop on head-to-head falls back', C.contestConfigOf({ late_entry: 'zero', entry_deadline: 'first' }, 'dfs')?.lateEntry === 'zero' && C.contestConfigOf({ late_entry: 'zero' }, 'dfs')?.entryDeadline === 'open' && C.contestConfigOf({ late_entry: 'drop' }, 'dfs')?.lateEntry === 'cpu' && C.contestConfigOf({ late_entry: 'drop', contest_format: 'board' }, 'dfs')?.lateEntry === 'drop');
{
  const mems = [{ sleeper_roster_id: 1, enrolled: true, app_user_id: 'u1', controller: 'human' }, { sleeper_roster_id: 2, enrolled: true, app_user_id: null, controller: 'ai' }, { sleeper_roster_id: 3, enrolled: true, app_user_id: 'u3', controller: 'human' }];
  const have = new Set([3]);
  const h2h = C.contestConfigOf({ contest_format: 'h2h' }, 'dfs');
  ok('noShow: before lock only the CPU seat is built', JSON.stringify(C.noShowBuilds(h2h, mems, have, false)) === '[{"roster_id":2,"how":"cpu"}]', C.noShowBuilds(h2h, mems, have, false));
  ok('noShow: at lock a head-to-head no-show gets a CPU squad by default', JSON.stringify(C.noShowBuilds(h2h, mems, have, true)) === '[{"roster_id":1,"how":"cpu"},{"roster_id":2,"how":"cpu"}]', C.noShowBuilds(h2h, mems, have, true));
  const zero = C.contestConfigOf({ contest_format: 'h2h', late_entry: 'zero' }, 'dfs');
  ok('noShow: SCORES ZERO writes an empty squad for the human, still builds the CPU', JSON.stringify(C.noShowBuilds(zero, mems, have, true)) === '[{"roster_id":1,"how":"zero"},{"roster_id":2,"how":"cpu"}]', C.noShowBuilds(zero, mems, have, true));
  const board = C.contestConfigOf({ contest_format: 'board' }, 'dfs');
  ok('noShow: a leaderboard no-show sits out by default', C.noShowBuilds(board, mems.filter((m) => m.app_user_id), have, true).length === 0);
  const boardCpu = C.contestConfigOf({ contest_format: 'board', late_entry: 'cpu' }, 'dfs');
  ok('noShow: …unless the league says the CPU builds', JSON.stringify(C.noShowBuilds(boardCpu, mems.filter((m) => m.app_user_id), have, true)) === '[{"roster_id":1,"how":"cpu"}]');
  const golfZero = C.contestConfigOf({ contest: 'golf', contest_format: 'h2h', late_entry: 'zero' }, 'dfs');
  ok('noShow: golf with no zero penalty builds instead of a zero (a scoreless squad would win)', C.noShowBuilds(golfZero, mems, have, true)[0].how === 'cpu');
  const golfPen = C.contestConfigOf({ contest: 'golf', contest_format: 'h2h', late_entry: 'zero', roster_slots: [{ pos: ['QB'], zero_pts: 30 }, { pos: ['RB'], zero_pts: 25 }] }, 'dfs');
  ok('noShow: golf with every spot priced takes the zero', C.noShowBuilds(golfPen, mems, have, true)[0].how === 'zero');
}
const cfgG = C.contestConfigOf({ contest: 'golf', contest_format: 'h2h', budget: 80000, roster_slots: [{ pos: ['QB'] }, { pos: ['RB', 'WR'], zero_pts: 25 }, { pos: ['HC'], label: 'COACH' }] }, 'dfs');
ok('contest: the league\'s own spots, budget and labels', cfgG?.budget === 80000 && cfgG.slots.map((d) => d.slot).join() === 'S1,S2,S3' && C.contestSlotLabels(cfgG.slots).S2 === 'RB/WR' && C.contestSlotLabels(cfgG.slots).S3 === 'COACH');
ok('contest: a repeated type numbers up (RB1, RB2, D/ST)', (() => { const l = C.contestSlotLabels(leagueSlotDefs({ slots: C.CONTEST_DEFAULT_SLOTS })); return l.S2 === 'RB1' && l.S3 === 'RB2' && l.S9 === 'D/ST' && l.S1 === 'QB'; })());
const pts = { a: 20, b: 0, c: 5, d: 12, e: 0, f: 3 };
const pointsOf = (slug) => pts[slug] ?? 0;
const gRes = C.scoreContest({ home: { S1: 'a', S2: 'b', S3: 'c' }, away: { S1: 'd', S2: 'e', S3: 'f' } }, cfgG, pointsOf);
ok('golf: a scoreless FLEX banks its zero_pts penalty', gRes.home === 50 && gRes.away === 40, [gRes.home, gRes.away]);
const cfgH = C.contestConfigOf({ contest: 'high', contest_format: 'board', roster_slots: [{ pos: ['QB'] }, { pos: ['RB', 'WR'] }] }, 'dfs');
const hRes = C.scoreContest({ home: { S1: 'a', S2: 'd' }, away: { S1: 'a', S2: 'd' } }, cfgH, pointsOf, { pending: (s) => s === 'd' });
ok('high: a SOLO row scores the same squad both sides; a pending player is not scored yet', hRes.home === 20 && hRes.away === 20 && hRes.slots.length === 2);
const cfgB = C.contestConfigOf({ contest: 'bullseye', bullseye: 'slots', bullseye_radius: 10, roster_slots: [{ pos: ['RB'] }, { pos: ['WR'] }] }, 'dfs');
const cardB = C.contestCard('L', 3, cfgB.slots);
ok('bullseye: a card over the league\'s spots, a multiple of 5 each', Object.keys(cardB.targets).join() === 'S1,S2' && Object.values(cardB.targets).every((t) => t % 5 === 0));
const tbB = C.contestTiebreak('L', 3, 7, cardB, cfgB.slots);
ok('bullseye: the tie-break is one RB/WR spot near its target', tbB != null && ['S1', 'S2'].includes(tbB.slot) && Math.abs(tbB.target - cardB.targets[tbB.slot]) <= 4);
ok('bullseye: no RB/WR spot, no tie-break', C.contestTiebreak('L', 3, 7, cardB, [{ slot: 'S1', type: 'QB', pos: ['QB'] }]) === null);
const exactB = { a: cardB.targets.S1, d: cardB.targets.S2 };
const bRes = C.scoreContest({ home: { S1: 'a', S2: 'd' }, away: { S1: 'a', S2: null } }, cfgB, (s) => exactB[s] ?? 0, { card: cardB, tiebreak: { home: tbB, away: tbB } });
ok('bullseye: two dead-on players bank 2 × (10 + 10); a dead-on and an empty spot bank 20 − 10', bRes.home === 40 && bRes.away === 10, [bRes.home, bRes.away]);
ok('bullseye: tie-break distances stamped both sides', bRes.tiebreak.home != null && bRes.tiebreak.away != null);
const boardC = [
  { slug: 'qb1', pos: 'QB', team: 'KC', salary: 9000, proj: 22 }, { slug: 'qb2', pos: 'QB', team: 'BUF', salary: 5000, proj: 14 },
  { slug: 'rb1', pos: 'RB', team: 'SF', salary: 8000, proj: 18, exp: 1 }, { slug: 'rb2', pos: 'RB', team: 'DAL', salary: 4000, proj: 9, exp: 7 }, { slug: 'rb3', pos: 'RB', team: 'DAL', salary: 3000, proj: 0, exp: 0 },
  { slug: 'hc1', pos: 'HC', team: 'KC', salary: 3000, proj: 5 },
];
const cfgR = C.contestConfigOf({ contest: 'golf', budget: 16000, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'], max_exp: 2 }, { pos: ['HC'] }] }, 'dfs');
const bR = C.contestAutoBuild(boardC, cfgR, 'seed');
ok('build: every spot filled under the budget, the tenure rule kept, golf taking the smallest real projection', bR.S1 === 'qb2' && bR.S2 === 'rb1' && bR.S3 === 'hc1' && C.contestSalary(bR, (s) => boardC.find((b) => b.slug === s).salary) <= 16000, bR);
// THE CAP IS OPTIONAL; GOLF GETS A FLOOR (v0.668.0).
{
  const noCap = C.contestConfigOf({ contest: 'bullseye', budget: 0, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }] }, 'dfs');
  ok('config: budget 0 is NO CAP', noCap.capped === false && noCap.budget === C.CONTEST_NO_CAP && noCap.minSpend === 0, noCap);
  const floored = C.contestConfigOf({ contest: 'golf', budget: 0, min_spend: 13000, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['HC'] }] }, 'dfs');
  ok('config: golf carries its floor', floored.capped === false && floored.minSpend === 13000);
  ok('config: a cap still reads as before', cfgR.capped === true && cfgR.minSpend === 0 && cfgR.budget === 16000);
  const bF = C.contestAutoBuild(boardC, floored, 'seed');
  const spentF = C.contestSalary(bF, (s) => boardC.find((b) => b.slug === s).salary);
  ok('build: golf under a $13k floor is forced up to it (cheapest real squad is $12k)', spentF >= 13000 && bF.S1 && bF.S2 && bF.S3, { bF, spentF });
  const bN = C.contestAutoBuild(boardC, noCap, 'seed');
  ok('build: no cap takes the biggest projections', bN.S1 === 'qb1' && bN.S2 === 'rb1', bN);
  const tooHigh = C.contestConfigOf({ contest: 'golf', budget: 0, min_spend: 90000, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['HC'] }] }, 'dfs');
  const bT = C.contestAutoBuild(boardC, tooHigh, 'seed');
  ok('build: a floor nobody can reach still fills every spot', bT.S1 && bT.S2 && bT.S3, bT);
  const B = await import('../packages/core/src/engine/contestBuilder.ts');
  const lF = B.budgetLine({ slots: floored.slots, cfg: floored, picks: { S1: 'qb2', S2: 'rb3', S3: null } }, (s) => boardC.find((b) => b.slug === s).salary);
  ok('builder: the budget line knows the floor and how short the squad is', lF.capped === false && lF.floor === 13000 && lF.spent === 8000 && lF.short === 5000 && !lF.over, lF);
  const lN = B.budgetLine({ slots: noCap.slots, cfg: noCap, picks: { S1: 'qb1', S2: 'rb1' } }, (s) => boardC.find((b) => b.slug === s).salary);
  ok('builder: no cap is never over', lN.capped === false && !lN.over && lN.short === 0);
  const { contestMoneyWord } = await import('../packages/core/src/data/liveApi.ts');
  ok('words: the money rule in a few words', contestMoneyWord({ budget: 50000 }) === '$50k budget' && contestMoneyWord({ budget: 0 }) === 'no cap' && contestMoneyWord({ budget: 0, min_spend: 45000 }) === 'min $45k spend' && contestMoneyWord({ budget: 60000, min_spend: 45000 }) === '$60k budget · min $45k');
  const sql = read('supabase/migrations/0469_contest_cap_and_floor.sql');
  ok('sql: the save refuses over the cap only when there is one, and under the floor', sql.includes('if budget > 0 and spent > budget') && sql.includes("minimum spend by $"));
  ok('sql: create and rules take the floor; the old signatures are dropped', sql.includes('p_min_spend int default 0') && sql.includes('drop function if exists set_contest_rules(uuid, text, text, int)') && sql.includes('drop function if exists create_contest_league(text, text, text, text, int, int, text, int, text, text)'));
  for (const f of ['src/screens/ContestSquad.tsx', 'apps/mobile/src/screens/ContestSquad.tsx']) {
    const src = read(f);
    ok(`${f}: the bar reads SPEND under no cap and says how short of the minimum`, src.includes("bl.capped ? 'BUDGET' : 'SPEND'") && src.includes('short of the') && src.includes('under the minimum spend'));
  }
  for (const f of ['src/screens/BullseyeLeague.tsx', 'apps/mobile/src/screens/BullseyeLeague.tsx']) {
    const src = read(f);
    // Creating: golf starts with no cap and a minimum spend; the budget field reads 0 as no cap.
    ok(`${f}: golf starts with no cap and a minimum spend`, src.includes("setBudget(0); setMinSpend(CONTEST_MIN_SPEND_DEFAULT)") && src.includes("'no cap'") && src.includes('MIN SPEND'));
  }
  // …and NO CAP is on COMMISH's budget menu, where the budget lives once the league exists.
  for (const f of ['src/screens/ContestCommish.tsx', 'apps/mobile/src/screens/ContestCommish.tsx']) {
    ok(`${f}: NO CAP is on the commissioner's budget menu`, read(f).includes("'NO CAP'"));
  }
  for (const f of ['src/screens/ContestCommish.tsx', 'apps/mobile/src/screens/ContestCommish.tsx']) {
    ok(`${f}: the commissioner can set the floor and drop the cap`, read(f).includes('minSpend') && read(f).includes("'NO CAP'"));
  }
}
// THE COACH SCORING PRESET (v0.670.1): SQL and core agree, and a coach's week prices under it.
{
  const { HC_SCORING_PRESET } = await import('../packages/core/src/engine/classic.ts');
  const B = await import('../packages/core/src/engine/contestBuilder.ts');
  const sql = read('supabase/migrations/0472_hc_scoring_preset.sql');
  const m = /jsonb_build_object\(([^)]*)\)/.exec(sql.split('_hc_scoring_preset() returns jsonb')[1]);
  const fromSql = Object.fromEntries([...m[1].matchAll(/'(hc\w+)',\s*([\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));
  ok('preset: the SQL preset and HC_SCORING_PRESET are the same ten knobs', JSON.stringify(fromSql) === JSON.stringify(HC_SCORING_PRESET), { fromSql, HC_SCORING_PRESET });
  ok('preset: installed on unlock only when no coach knob is set, and backfilled for contest leagues with HC', sql.includes("cleaned @> '[\"HC\"]'::jsonb") && sql.includes('_hc_scoring_unset(settings_json -> \'scoring_classic\')') && sql.includes("kind in ('dfs', 'bullseye')"));
  const wk = B.leagueWeekProj({ slug: 'det-hc', pos: 'HC', team: 'DET', proj: 0 }, HC_SCORING_PRESET, { opp: 'CAR', home: true });
  ok('preset: a favourite at home projects a real number (about 10)', wk > 7 && wk < 16, wk);
}
ok('allows: a RET spot takes a ball-carrier; a tenure rule refuses a veteran', C.contestSlotAllows({ slot: 'S1', type: 'RET', pos: ['RET'] }, { slug: 'rb2', pos: 'RB' }) && !C.contestSlotAllows(cfgR.slots[1], { slug: 'rb2', pos: 'RB', exp: 7 }));
ok('squad: S-rows read by name, legacy DFS names fall into spots by position', (() => {
  const s1 = C.contestSquadOf([{ slot: 'S2', player_slug: 'x' }], cfgB.slots);
  const s2 = C.contestSquadOf([{ slot: 'WR1', player_slug: 'w', pos: 'WR' }, { slot: 'RB1', player_slug: 'r', pos: 'RB' }], cfgB.slots);
  return s1.S2 === 'x' && s1.S1 === null && s2.S1 === 'r' && s2.S2 === 'w';
})());
const { contestLeagueLine, isContestKind, contestPitch } = await import('../packages/core/src/data/liveApi.ts');
const cline = contestLeagueLine({ contest: 'golf', format: 'h2h', budget: 80000, spots: 9, variant: 'slots', radius: 10, span: 'season', week: null, max_seats: 12, seats_taken: 4 });
ok('board line: contest, format, budget and size', cline.includes('GOLF') && cline.includes('head-to-head') && cline.includes('$80k') && cline.includes('4 of 12'), cline);
ok('bullseyeLeagueLine defers to the contest line', bullseyeLeagueLine({ contest: 'high', format: 'board', budget: 50000, spots: 9, variant: 'slots', radius: 10, span: 'week', week: 5, max_seats: 32, seats_taken: 2 }).includes('highest score'));
ok('kinds: dfs and bullseye are contest leagues', isContestKind('dfs') && isContestKind('bullseye') && !isContestKind('pod') && !isContestKind(null));
ok('pitch: golf says lowest', contestPitch({ contest: 'golf', format: 'h2h' }).includes('LOWEST') && contestPitch({ contest: 'golf', format: 'h2h' }).includes('Head-to-head'));
const sql3 = read('supabase/migrations/0466_contest_leagues.sql');
ok('sql: the salary board prices every position a contest can start', /check \(pos in \('QB','RB','WR','TE','FB','K','DEF','DL','LB','DB','HC','P','RET'\)\)/.test(sql3) && sql3.includes('add column if not exists exp int'));
ok('sql: a contest league is a classic league with its contest in settings', sql3.includes("'game_mode', 'classic', 'contest', p_contest, 'contest_format', p_format, 'budget'"));
ok('sql: head-to-head needs an even count and makes every seat now', sql3.includes("a head-to-head league needs an even number of teams") && sql3.includes("'CON-AI-' || i"));
ok('sql: an entry is checked spot by spot (position, filter, pool, seat rule) and against the budget', ['_contest_spot_error', 'seat_player_rule', 'pool_filter', 'over the budget'].every((k) => sql3.includes(k)) || ['_contest_spot_error', 'seat_player_rule', 'pool_filter', 'budget'].every((k) => sql3.includes(k)));
ok('sql: the format is set only before the first week', sql3.includes("if p_format <> _contest_format_of(lg) and exists (select 1 from matchup where league_id = p_league)"));
ok('sql: the commissioner\'s console knows the kind', sql3.includes("'avatar_url', l.avatar_url, 'kind', l.kind,"));
ok('board read: every position, with exp, past the 1000-row page', (() => { const api = read('packages/core/src/data/liveApi.ts'); return api.includes("select('slug, name, pos, team, salary, proj, exp, priced_proj')") && /priced_proj'\)[\s\S]{0,200}\.range\(0, 4999\)/.test(api); })());
ok('pods: the board carries exp and the extra positions', /expOf|exp:/.test(read('server/src/playerIndex.js')) && /contestExtraPositions/.test(pods));
ok('bullseye cards: not published for a contest league (its card is dealt in the engine)', /settings_json\?\.contest|dfs_bullseye/.test(read('server/src/bullseye.js')));

// ── the squad builder (v0.665.0): engine/contestBuilder.ts ──────────────────
const B = await import('../packages/core/src/engine/contestBuilder.ts');
const bCfg = C.contestConfigOf({ contest: 'high', budget: 24000, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'], max_exp: 2 }, { pos: ['RB', 'WR'] }, { pos: ['HC'] }] }, 'dfs');
const bBoard = [
  { slug: 'qb1', name: 'Q One', pos: 'QB', team: 'KC', salary: 9000, proj: 22 }, { slug: 'qb2', name: 'Q Two', pos: 'QB', team: 'BUF', salary: 5000, proj: 14 },
  { slug: 'rb1', name: 'R One', pos: 'RB', team: 'SF', salary: 8000, proj: 18, exp: 1 }, { slug: 'rb2', name: 'R Two', pos: 'RB', team: 'DAL', salary: 4000, proj: 9, exp: 7 },
  { slug: 'wr1', name: 'W One', pos: 'WR', team: 'DAL', salary: 3000, proj: 6, exp: 3 }, { slug: 'hc1', name: 'Coach', pos: 'HC', team: 'KC', salary: 3000, proj: 5 },
];
const bSal = (sl) => bBoard.find((b) => b.slug === sl).salary;
const bCtx = { slots: bCfg.slots, cfg: bCfg, picks: { S1: null, S2: null, S3: null, S4: null }, seatRule: { roster_id: 1, positions: [], teams: ['KC', 'SF', 'DAL'] }, poolFilter: null, card: null };
ok('builder: tabs are the positions the spots take, ALL first', B.builderTabs(bCfg.slots).join() === 'ALL,QB,RB,WR,HC');
ok('builder: a tenure spot says why in words', B.spotWhyNot(bCfg.slots[1], bBoard[3], bCtx) === 'this spot is up to 2 yrs only');
ok('builder: the seat rule says why', /your seat takes KC\/SF\/DAL only/.test(B.spotWhyNot(bCfg.slots[0], bBoard[1], bCtx) ?? ''));
ok('builder: the pool filter says why', /the league is up to 10 yrs only/.test(B.spotWhyNot(bCfg.slots[0], { slug: 'x', name: 'X', pos: 'QB', team: 'KC', salary: 1, proj: 1, exp: 12 }, { ...bCtx, poolFilter: { min_exp: null, max_exp: 10 } }) ?? ''));
ok('builder: a veteran RB lands in the FLEX, not the rookie spot', B.openSpotFor(bBoard[3], bCtx) === 'S3' && B.openSpotFor(bBoard[2], bCtx) === 'S2');
const bRows = B.rankCandidates(bBoard, bCtx, { slot: null, sort: 'value' }, bSal);
ok('builder: ranked by value, the eligible first, the refused last with the reason', bRows[0].p.slug === 'qb1' && bRows.at(-1).p.slug === 'qb2' && bRows.at(-1).why != null && bRows.every((r, i) => i === 0 || r.fits === false || bRows[i - 1].value >= r.value));
ok('builder: room for a spot reserves the floor for the others', B.roomFor(bCtx, 'S1', bSal) === 24000 - 3 * 3000);
const bFill = B.fillOpenSpots(bBoard, bCtx, 'seed');
ok('builder: FILL FOR ME fills every open spot under the budget, never starving the one-candidate spot', bFill.S1 === 'qb1' && bFill.S2 === 'rb1' && bFill.S4 === 'hc1' && bFill.S3 != null && B.budgetLine({ ...bCtx, picks: bFill }, bSal).left >= 0, bFill);
const bKeep = B.fillOpenSpots(bBoard, { ...bCtx, picks: { S1: 'qb1', S2: null, S3: 'wr1', S4: null } }, 'seed');
ok('builder: FILL FOR ME keeps the picks already made', bKeep.S1 === 'qb1' && bKeep.S3 === 'wr1' && bKeep.S2 === 'rb1' && bKeep.S4 === 'hc1', bKeep);
ok('builder: the budget line counts open spots and what each can have', (() => { const l = B.budgetLine({ ...bCtx, picks: { S1: 'qb1', S2: null, S3: null, S4: null } }, bSal); return l.spent === 9000 && l.left === 15000 && l.open === 3 && l.perSpot === 5000 && !l.over; })());
ok('builder: value is projection per $1k', B.valueOf({ salary: 8000, proj: 18 }) === 2.25);
for (const f of ['src/screens/ContestSquad.tsx', 'apps/mobile/src/screens/ContestSquad.tsx']) {
  const src = read(f);
  ok(`${f}: the builder — budget bar, spot cards, tabs, team filter, sort, search, eligibility, FILL FOR ME, injuries`,
    ['budgetLine(', 'rankCandidates(', 'fillOpenSpots(', 'builderTabs(', 'weekSlateByTeam(', 'seatPlayerRules(', 'leagueGameMode(', 'loadLiveInjuries(', 'injuryFor(', 'FILL FOR ME', 'eligibleOnly', 'BUILDER_SORTS'].every((k) => src.includes(k)));
}

// ── pricing on scarcity, the live projection, the injury rule (v0.666.0) ────
const SP = await import('../packages/core/src/engine/salaryPricing.ts');
ok('pricing: the replacement is the body after the 12-team starters', SP.STARTERS_12.RB === 24 && SP.STARTERS_12.WR === 36 && SP.TARGET_SHARE > 1);
ok('pods: boards are priced by priceBoard and carry priced_proj', /priceBoard\(rows\)/.test(pods) && /priced_proj: row\.proj/.test(pods));
ok('pods: the projection refreshes, the price does not', /export async function refreshBoardProj/.test(pods) && /salary: r\.salary, proj: next/.test(pods));
ok('pods: CPU builds skip the ruled out and swap them before lock', /const playable = board\.filter\(\(r\) => !outs\.has\(r\.slug\)\)/.test(pods) && /contestAutoBuild\(cpuPool\.filter\(\(b\) => !teamLocked\(b\.team\)\), contest,/.test(pods) && /\|sub\$\{e\.roster_id\}/.test(pods));
// v0.679.2: a CPU squad built before the board carried a spot's position gets
// the spot filled later; the board's missing-position check runs every tick.
ok('pods: the CPU pass fills a spot it left empty, not only a ruled-out one', /const empty = contest\.slots\.filter\(\(d\) => !filled\.has\(d\.slot\)\)/.test(pods) && /if \(!hurt\.length && !empty\.length\) continue;/.test(pods) && /if \(contest\) \{\n      const aiSeats/.test(pods));
ok('pods: the board top-up checks for a missing position every tick, the experience fill once', /const first = !toppedUp\.has\(key\);/.test(pods) && /\(first \? board\.filter/.test(pods) && !/if \(toppedUp\.has\(key\) \|\| !board\.length\) return board;/.test(pods));
{
  // The build fills a coach spot and a rookie-only spot when the board carries
  // them, and a tenure spot refuses a player whose experience is unknown.
  const slotsX = [{ pos: ['QB'] }, { pos: ['WR'], max_exp: 0, label: 'Rookie Only' }, { pos: ['HC'] }];
  const cfgX = C.contestConfigOf({ contest: 'high', contest_format: 'h2h', budget: 50000, roster_slots: slotsX }, 'dfs');
  const boardX = [
    { slug: 'qb1', pos: 'QB', salary: 7000, proj: 20, exp: 5 }, { slug: 'wr-vet', pos: 'WR', salary: 6000, proj: 14, exp: 4 },
    { slug: 'wr-rook', pos: 'WR', salary: 4500, proj: 9, exp: 0 }, { slug: 'wr-unknown', pos: 'WR', salary: 3000, proj: 12, exp: null },
    { slug: 'hc-coen', pos: 'HC', salary: 4000, proj: 9.5 },
  ];
  const bX = C.contestAutoBuild(boardX, cfgX, 'seed');
  ok('build: a coach spot and a rookie-only spot fill when the board carries them', bX.S3 === 'hc-coen' && bX.S2 === 'wr-rook', bX);
  const bY = C.contestAutoBuild(boardX.filter((r) => r.pos !== 'HC'), cfgX, 'seed');
  ok('build: without a coach on the board the coach spot stays empty (so the later fill matters)', bY.S3 === null && bY.S2 === 'wr-rook', bY);
  const filled = C.contestAutoBuild(boardX, cfgX, 'seed', null, { S1: 'qb1', S2: 'wr-rook', S3: null });
  ok('build: a kept squad with one empty spot gets just that spot filled', filled.S1 === 'qb1' && filled.S2 === 'wr-rook' && filled.S3 === 'hc-coen', filled);
}
const sql4 = read('supabase/migrations/0467_salary_pricing.sql');
ok('sql: priced_proj, and an O/IR new pick is refused', sql4.includes('add column if not exists priced_proj') && sql4.includes("upper(ist.status) in ('O', 'IR')") && sql4.includes('is ruled out this week'));
ok('builder: a ruled-out body says so, unless already saved', (() => {
  const rowsO = B.rankCandidates(bBoard, bCtx, { slot: null, ruledOut: (s) => s === 'rb1' }, bSal);
  const rowsS = B.rankCandidates(bBoard, bCtx, { slot: null, ruledOut: (s) => s === 'rb1', saved: { S2: 'rb1' } }, bSal);
  return rowsO.find((r) => r.p.slug === 'rb1')?.why === 'ruled out this week' && rowsS.find((r) => r.p.slug === 'rb1')?.fits === true;
})());
ok('builder: the priced delta reads the feed, half a point or more', B.pricedDelta({ proj: 9, feedProj: 18.1, priced: 15.4 })?.dir === '↑' && B.pricedDelta({ proj: 9, feedProj: 15.6, priced: 15.4 }) === null);
// A COACH'S WEEK (v0.667.2): the matchup prices him, not a flat seventeenth.
{
  const P = await import('../packages/core/src/engine/projScoring.ts');
  const sc = { hcWin: 10, hcLoss: -5, hcWm10: 2 };
  const home = B.leagueWeekProj({ slug: 'det-hc', pos: 'HC', team: 'DET', proj: 0 }, sc, { opp: 'CAR', home: true });
  const away = B.leagueWeekProj({ slug: 'det-hc', pos: 'HC', team: 'DET', proj: 0 }, sc, { opp: 'CAR', home: false });
  const tough = B.leagueWeekProj({ slug: 'det-hc', pos: 'HC', team: 'DET', proj: 0 }, sc, { opp: 'KC', home: false });
  const flat = B.leagueWeekProj({ slug: 'det-hc', pos: 'HC', team: 'DET', proj: 0 }, sc);
  ok('coach week: a favourite at home projects more than the same coach away', home > away, { home, away });
  ok('coach week: a tougher opponent projects less', tough < away, { tough, away });
  ok('coach week: a bye projects 0', B.leagueWeekProj({ slug: 'det-hc', pos: 'HC', team: 'DET', proj: 0 }, sc, null) === 0);
  ok('coach week: no slate falls back to the flat number', flat > 0 && flat !== home);
  const odds = P.hcGameOdds('det-hc', { opp: 'CAR', home: true });
  ok('coach week: win + loss + tie is one, and the favourite is over a coin flip', Math.abs(odds.win + odds.loss + odds.tie - 1) < 1e-9 && odds.win > 0.5, odds);
  ok('coach week: the Rams resolve under LAR too', P.hcGameOdds('det-hc', { opp: 'LAR', home: true }).margin === P.hcGameOdds('det-hc', { opp: 'LA', home: true }).margin);
  ok('coach week: not a coach → the ordinary path', B.leagueWeekProj({ slug: 'x', pos: 'WR', proj: 12 }, sc, { opp: 'CAR', home: true }) === 12);
}
ok('builder: a league that pays nothing for a position shows the feed number; HC gets the catalog\'s', B.leagueWeekProj({ slug: 'x', pos: 'WR', proj: 12 }, null) === 12 && B.leagueWeekProj({ slug: 'kc-hc', pos: 'HC', team: 'KC', proj: 0 }, { hcWin: 10 }) >= 0);
for (const f of ['src/screens/ContestSquad.tsx', 'apps/mobile/src/screens/ContestSquad.tsx']) {
  const src = read(f);
  ok(`${f}: the league projection, the priced delta and the ruled-out rule`, ['leagueWeekProj(r, setup?.catalog, r.pos === \'HC\'', 'pricedDelta(', 'ruledOut, saved', ', ruledOut);'].every((k) => src.includes(k)));
  ok(`${f}: the squad's projected total against the card`, src.includes('PROJECTS') && src.includes('card ${theCard.total}'));
}

// ── weekly leagues are listings like any other (v0.662.0) ────────────────────
const { isWeeklyKind } = await import('../packages/core/src/data/liveApi.ts');
ok('weekly: pods, showdowns, DFS and Bullseye; a season league is not', ['pod', 'weekly', 'dfs', 'bullseye'].every(isWeeklyKind) && !isWeeklyKind('league') && !isWeeklyKind(null));
ok('no weekly-contest banner on the leagues page', !read('src/screens/LiveOnboard.tsx').includes('<BullseyeContestCard') && !read('apps/mobile/src/screens/Leagues.tsx').includes('<BullseyeContestBanner'));
for (const f of ['src/screens/LiveOnboard.tsx', 'apps/mobile/src/screens/Leagues.tsx', 'src/screens/LeagueBoard.tsx', 'apps/mobile/src/screens/Recruit.tsx']) {
  ok(`${f}: a WEEKLY filter`, read(f).includes('WEEKLY') && read(f).includes('isWeeklyKind('));
}

// v0.713.10, founder: "in your matchup, my team and when looking at players to swap or add to your lineup we need
// the ability to see the game logs for players. Maybe tap the card and you get the action (select or replace) and
// the option to see the game log?"
{
  const app = read('apps/mobile/src/screens/ContestSquad.tsx'), web = read('src/screens/ContestSquad.tsx');
  ok('game log: the phone\'s My Team card asks Replace or Game log', /askCard\(p, `\$\{labels\[d\.slot\]\} · \$\{fmt\$\(p\.salary\)\}`, \{ label: 'Replace'/.test(app) && /\{ text: 'Game log', onPress: \(\) => logOf\(p\) \}/.test(app));
  ok('game log: the phone\'s player list asks Add / Swap in, or Game log — even a card that can\'t go in', /Swap in for \$\{holder\.name\}/.test(app) && !/<Pressable key=\{p\.slug\} disabled=\{!ok\}/.test(app));
  ok('game log: the web asks the same, in a sheet above the pick sheet', /act: \{ label: 'Replace', run: \(\) => openSheet\(d\.slot\) \}/.test(web) && /Swap in for \$\{holder\.name\}/.test(web) && /zIndex=\{70\}>/.test(web) && />GAME LOG</.test(web));
  ok('game log: the web\'s choice keeps its hook above the early returns', web.indexOf('const [ask, setAsk]') < web.indexOf('if (!st) return'));
  ok('game log: every face-up matchup card opens his log (not only a locked one)', /if \(r\.slug\) \{/.test(read('apps/mobile/src/screens/ContestMatchup.tsx')) && /const logOpen = slug && !onPick \? \(\) =>/.test(read('src/screens/ContestMatchup.tsx')));
}
// v0.730.24: a league Drip runs itself shows no Sleeper import or season-long tools (founder: "hide those for contest leagues")
{
  const web = read('src/screens/AdminPage.tsx');
  ok('web: ownGame = a contest league or any pod-provider league', web.includes("const ownGame = contest || l.provider === 'pod';"));
  ok('web: sync season and go native hide for it', /l\.provider !== 'native' && !ownGame && \(\n\s*<div>\n\s*<div style=\{subhead\}>SCHEDULE/.test(web) && /l\.provider !== 'native' && !ownGame && \(\n\s*<div>\n\s*<div style=\{subhead\}>GO NATIVE/.test(web));
  ok('web: preseason practice and K/D-ST fill hide for it', web.includes('{nflOnly && !ownGame && <PreseasonPractice on=') && web.includes("{tab === 'mode' && nflOnly && !ownGame && ("));
  const ph = read('apps/mobile/src/screens/CommishTools.tsx');
  ok('phone: K/D-ST fill hides in a contest league', ph.includes('{kdst && !contest && (') && ph.includes('<GameModeCard leagueId={leagueId} view="mode" contest={contest} />'));
}
// v0.730.26 (0513): one contest matchup, for anyone with the link
{
  const mig = read('supabase/migrations/0513_public_contest_matchup.sql');
  ok('0513: the matchup as an outsider sees it, to anon', mig.includes('grant execute on function public_contest_matchup(uuid) to anon') && (mig.match(/_contest_sealed_entry\([^)]*, false, null\)/g) ?? []).length === 2 && (mig.match(/_contest_visible_plays\([^)]*, false, null\)/g) ?? []).length === 2);
  ok('0513: an opted-out league or a mock is not served; score rows carry no player id', mig.includes("coalesce((lg.settings_json ->> 'public_api')::boolean, true)") && mig.includes('is_mock') && mig.includes("x - 'slug' - 'player_slug'"));
  const store = read('src/app/store.tsx');
  ok('web: #/watch/<id> is a route a cold load restores', store.includes("case 'watch': return seg[1] ? { name: 'watch', matchupId: decodeURIComponent(seg[1]) } : null;") && read('src/App.tsx').includes("route.name === 'watch' && <WatchMatchup"));
  ok('both matchups carry SHARE with the watch link', read('src/screens/ContestMatchup.tsx').includes('watchMatchupUrl(m.id)') && read('apps/mobile/src/screens/ContestMatchup.tsx').includes('Share.share({ message: `Follow it live: ${watchMatchupUrl(m.id)}`'));
}
// v0.730.27: a contest league's commissioner with no seat can watch its matchups
{
  const app = read('apps/mobile/App.tsx');
  ok('phone: a seatless commissioner opens a contest league on MATCHUP', app.includes("setView(rosterId == null ? (isContestKind(kind) ? 'picks' : 'commishtools') : (landing ?? 'home'));") && app.includes("open.rosterId != null || open.commish ? 'matchup' : 'league'") && app.includes("open.rosterId != null || (open.commish && isContestKind(open.kind))"));
  ok('phone: the managed card says what kind of league it is', read('apps/mobile/src/screens/Leagues.tsx').includes("onOpen(l.league_id, null, l.name, l.provider === 'native', true, undefined, undefined, l.kind)"));
  ok('phone: the matchup room lets the commissioner in', read('apps/mobile/src/screens/BullseyeLeague.tsx').includes("room === 'matchup' && (lg.me || lg.commish) && week != null"));
  const web = read('src/screens/BullseyeLeague.tsx');
  ok('web: the matchup room and its tab let the commissioner in', web.includes("const watching = seated || !!lg.commish;") && web.includes("room === 'matchup' && watching &&") && web.includes('watch={!!lg.commish}') && read('src/app/LeagueStrip.tsx').includes("show: rosterId != null || watch"));
  ok('web: a contest league\'s commissioner-only card has ▦ matchups', read('src/screens/LiveOnboard.tsx').includes('onWatch={isContestKind(l.kind) && onContest ? () => onContest(l.league_id) : undefined}'));
}
if (fails) { console.log(`\n${fails} DFS-BULLSEYE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL DFS-BULLSEYE ASSERTIONS PASSED');
