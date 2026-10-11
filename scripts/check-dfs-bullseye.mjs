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
ok('worker: the contest branch comes before classic', resolve.indexOf('if (contestCfg) {') > 0 && resolve.indexOf('if (contestCfg) {') < resolve.indexOf("} else if (gameMode.mode === 'classic') {"));
ok('worker: modeOfSettings carries dfs_bullseye', /dfs_bullseye: s\?\.dfs_bullseye === true/.test(resolve));
ok('worker: scored under the league\'s catalog, RET spots as RET', /classicPoints\(player\(slug\), matchup\.week, catalog, contestScoreAs\(def\), slot\)/.test(resolve));
ok('lock: no drip auto-lineup for a Bullseye contest', /settings_json\?\.dfs_bullseye === true\) continue/.test(read('server/src/lock.js')));
const pods = read('server/src/pods.js');
ok('pods: AI seats and no-shows aim at the card', /aimBuild\(board, card/.test(pods) && /contestAutoBuild\(board, contest,/.test(pods));
ok('pods: a leaderboard contest is skipped in the seat loop', /if \(contest && contest\.format === 'board'\) continue;/.test(pods));
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
ok('phone: CommishTools takes `contest`, shows the CONTEST card and hides MODE', tools.includes("{ id: 'contest', label: '🏁 CONTEST', contestOnly: true }") && tools.includes("{ id: 'mode', label: 'MODE', notContest: true }") && tools.includes("section === 'contest' && <ContestCommishCard"));
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
ok('board read: every position, with exp, past the 1000-row page', (() => { const api = read('packages/core/src/data/liveApi.ts'); return api.includes("select('slug, name, pos, team, salary, proj, exp')") && /proj, exp'\)[\s\S]{0,200}\.range\(0, 4999\)/.test(api); })());
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

// ── weekly leagues are listings like any other (v0.662.0) ────────────────────
const { isWeeklyKind } = await import('../packages/core/src/data/liveApi.ts');
ok('weekly: pods, showdowns, DFS and Bullseye; a season league is not', ['pod', 'weekly', 'dfs', 'bullseye'].every(isWeeklyKind) && !isWeeklyKind('league') && !isWeeklyKind(null));
ok('no weekly-contest banner on the leagues page', !read('src/screens/LiveOnboard.tsx').includes('<BullseyeContestCard') && !read('apps/mobile/src/screens/Leagues.tsx').includes('<BullseyeContestBanner'));
for (const f of ['src/screens/LiveOnboard.tsx', 'apps/mobile/src/screens/Leagues.tsx', 'src/screens/LeagueBoard.tsx', 'apps/mobile/src/screens/Recruit.tsx']) {
  ok(`${f}: a WEEKLY filter`, read(f).includes('WEEKLY') && read(f).includes('isWeeklyKind('));
}

if (fails) { console.log(`\n${fails} DFS-BULLSEYE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL DFS-BULLSEYE ASSERTIONS PASSED');
