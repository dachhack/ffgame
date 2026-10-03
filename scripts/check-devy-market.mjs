// THE DEVY MARKET TABLE (v0.577.0): progress to max, owners, filters, sorting,
// and two-decimal numbers. Offline.
import { refreshedLabel, devyValueSub, fmtValue } from '../packages/core/src/data/devyValues.ts';
import { pickRoundLabel, isDevyPickRound, devyBlockRound, draftRoundLabel, devyBlockLine } from '../packages/core/src/data/devyDraft.ts';
import { fmtPts, stakeProgress, marketLines, shapeMarket, nextSort, marketSubline, slotLabel, timeLeft, launchBanner, launchOrderMax, tradePreview, underclassMult, underclassLabel, marketRowDetail } from '../packages/core/src/data/devyShares.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

ok(fmtPts(1) === '1.00' && fmtPts(10.375) === '10.38' && fmtPts(12.5) === '12.50' && fmtPts(0) === '0.00', 'points always carry two decimals');

ok(stakeProgress(5, 15) === 0.25, '5 shares / 15 points: a quarter of the way (shares 25%, points 25%)');
ok(stakeProgress(5, 51.9) === 51.9 / 60, 'an expensive stake maxes by points first');
ok(stakeProgress(20, 20) === 1 && stakeProgress(30, 90) === 1, 'maxed is 1, never past it');

const rows = [
  { slug: 'c-1', name: 'Zed Back', pos: 'RB', school: 'OKST', class_year: 2, rank: 14, sh_rank: 40, youth: false, price: 10.38 },
  { slug: 'c-2', name: 'Al End', pos: 'TE', school: 'GT', class_year: 2, rank: 285, sh_rank: null, youth: false, price: 1 },
  { slug: 'c-3', name: 'Mo Wide', pos: 'WR', school: 'SAM', class_year: 1, rank: null, sh_rank: 900, youth: false, price: 1, fcs: true },
];
const st = { ok: true, rules: { max: 20, max_spend: 60 }, players: [
  { slug: 'c-1', name: 'Zed Back', price: 10.38, right: { roster_id: 1, via: 'sole' },
    holders: [{ roster_id: 1, team: 'Team 1', shares: 5, cost: 51.9, maxed_at: null }] },
  { slug: 'c-2', name: 'Al End', price: 1, right: null,
    holders: [{ roster_id: 1, team: 'Team 1', shares: 3, cost: 3, maxed_at: null }, { roster_id: 2, team: 'Team 2', shares: 12, cost: 12, maxed_at: null }] },
] };
const lines = marketLines(rows, st, 1);
const [zed, al, mo] = lines;
ok(zed.mine === 5 && zed.right?.mine && zed.leadMine && Math.abs(zed.lead - 51.9 / 60) < 1e-9, 'my stake, my right, and I lead');
ok(al.owners.length === 2 && al.owners[0].team === 'Team 2' && al.lead === 0.6 && !al.leadMine && al.myProgress === 0.15,
  'owners ordered by who is closest to maxing; the bar is the leader');
ok(al.totalShares === 15 && mo.owners.length === 0 && mo.lead === 0, 'totals, and nobody in');

ok(shapeMarket(lines, 'TE', 'rank', 'asc').map((l) => l.row.slug).join() === 'c-2', 'position filter');
ok(shapeMarket(lines, 'OPEN', 'rank', 'asc').map((l) => l.row.slug).join() === 'c-2,c-3', 'NO RIGHT YET leaves out a player whose right is held');
ok(shapeMarket(lines, 'ALL', 'price', 'desc')[0].row.slug === 'c-1', 'price, highest first');
ok(shapeMarket(lines, 'ALL', 'name', 'asc').map((l) => l.row.name).join() === 'Al End,Mo Wide,Zed Back', 'names A→Z');
ok(shapeMarket(lines, 'ALL', 'lead', 'desc')[0].row.slug === 'c-1' && shapeMarket(lines, 'ALL', 'owners', 'desc')[0].row.slug === 'c-2', 'closest to maxed, most owners');

let s = { key: 'rank', dir: 'asc' };
s = nextSort(s, 'price'); ok(s.key === 'price' && s.dir === 'desc', 'a number column starts highest first');
s = nextSort(s, 'price'); ok(s.dir === 'asc', 'the same header flips');
s = nextSort(s, 'price'); ok(s.key === 'rank', 'a third tap returns to the market order');
ok(nextSort({ key: 'rank', dir: 'asc' }, 'name').dir === 'asc', 'names start A→Z');

ok(marketSubline({ ...rows[0], declared: true }).startsWith('DECLARED · OKST'), 'a declared player says so first (0409)', marketSubline({ ...rows[0], declared: true }));
ok(marketSubline(rows[0]) === 'OKST · SO · devy #40' && marketSubline(rows[2]) === 'SAM · FCS · FR · devy #900' && marketSubline(rows[1]) === 'GT · SO · #285 in college',
  'the line under a name');

// ── launches (0407) ──
ok(slotLabel({ dow: 2, hour: 12 }) === 'Tue 12:00 PM ET' && slotLabel({ dow: 0, hour: 0 }) === 'Sun 12:00 AM ET' && slotLabel({ dow: 5, hour: 18 }) === 'Fri 6:00 PM ET', 'slot labels');
const t0 = Date.parse('2026-10-01T12:00:00Z');
ok(timeLeft('2026-10-04T16:30:00Z', t0) === '3d 4h' && timeLeft('2026-10-01T17:20:00Z', t0) === '5h 20m' && timeLeft('2026-10-01T12:12:00Z', t0) === '12m'
  && timeLeft('2026-10-01T11:00:00Z', t0) === 'closing', 'time left');
const cfg = { on: true, dow: 2, hour: 12, window_h: 72, catchup_h: 168, cap: 20 };
ok(launchBanner({ ok: true, cfg, open: { id: 1, kind: 'weekly', opens_at: '', closes_at: '2099-01-01T00:00:00Z', players: [{}, {}] } })?.title === '🚀 LAUNCH OPEN · 2 new players',
  'an open launch leads the banner');
ok(launchBanner({ ok: true, cfg, open: { id: 1, kind: 'catchup', opens_at: '', closes_at: '2099-01-01T00:00:00Z', players: [{}] } })?.title.includes('CATCH-UP'), 'and says when it is a catch-up');
ok(/catch-up launch when the market reopens/.test(launchBanner({ ok: true, cfg, locked: true, pending_count: 3 })?.sub ?? ''), 'while locked: a catch-up promise');
ok(/Tue 12:00 PM ET/.test(launchBanner({ ok: true, cfg, pending_count: 1, next_at: '2099-01-01T00:00:00Z' })?.sub ?? ''), 'otherwise: the next slot');
ok(launchBanner({ ok: true, cfg, pending_count: 0 }) === null && launchBanner({ ok: true, cfg: { ...cfg, on: false }, pending_count: 4 }) === null, 'nothing waiting, or launches off: no banner');
ok(launchOrderMax(9.2, cfg) === 7 && launchOrderMax(1, cfg) === 20 && launchOrderMax(1, { cap: 5 }) === 5 && launchOrderMax(0, cfg) === 0,
  'an order holds a full stake, the 60-point cap, or the commissioner\'s cap');

// ── the purchase sheet (v0.579.0) ──
let tp = tradePreview({ mode: 'buy', n: 5, cur: 0, cost: 0, price: 10.38, cash: 28.1 });
ok(tp.n === 5 && tp.amount === 51.9 && !tp.ok && /you have 28.10/.test(tp.why ?? ''), 'a buy you can\'t afford says so');
ok(tp.maxN === 2, 'and the most you could buy is 2 (cash)');
tp = tradePreview({ mode: 'buy', n: 1, cur: 5, cost: 51.9, price: 10.38, cash: 28.1 });
ok(tp.ok && tp.maxes && tp.sharesAfter === 6 && tp.costAfter === 62.28 && tp.progressAfter === 1, 'a buy that passes 60 points maxes him');
ok(tradePreview({ mode: 'buy', n: 3, cur: 5, cost: 51.9, price: 10.38, cash: 99 }).n === 1, 'and a buy past the max is trimmed to it');
ok(tradePreview({ mode: 'buy', n: 1, cur: 20, cost: 20, price: 1, cash: 99 }).why === 'your stake is maxed', 'a maxed stake takes no more');
tp = tradePreview({ mode: 'sell', n: 5, cur: 5, cost: 10, price: 10, cash: 20 });
ok(tp.amount === 30 && tp.capped && tp.sharesAfter === 0 && tp.ok, 'a sale pays at most 3× what was paid');
ok(!tradePreview({ mode: 'sell', n: 5, cur: 5, cost: 50, price: 10, cash: 190 }).ok, 'and never past the 200 cash ceiling');

// ── the devy draft (0411) ──
ok(pickRoundLabel(3) === 'R3' && pickRoundLabel(101) === 'DEVY R1' && isDevyPickRound(102) && !isDevyPickRound(99), 'devy picks are rounds 101+, labelled DEVY R<k>');
ok(devyBlockRound(22, 2, 23) === null && devyBlockRound(23, 2, 23) === 1 && devyBlockRound(25, 2, 23) === 2 && devyBlockRound(5, 2, null) === null, 'which devy round a pick falls in');
ok(draftRoundLabel(11, 2, 23) === 'R11' && draftRoundLabel(12, 2, 23) === 'D1' && draftRoundLabel(13, 2, 23) === 'D2', 'board columns: R… then D…');
ok(devyBlockLine(23, 2, 23, 2) === 'DEVY ROUND 1 of 2 — college players only' && devyBlockLine(3, 2, 23, 2).includes('pick 23') && devyBlockLine(3, 2, null, 0) === null, 'the room\'s devy line');
ok(underclassMult(1) === 0.85 && underclassMult(2) === 0.92 && underclassMult(3) === 1 && underclassMult(null) === 1, '0413: freshman ×0.85, sophomore ×0.92, junior up full');
ok(underclassLabel(1) === 'underclass −15%' && underclassLabel(2) === 'underclass −8%' && underclassLabel(4) === null, 'the discount\'s label');
ok(marketRowDetail({ slug: 'c-9', name: 'Y', pos: 'WR', school: 'OSU', class_year: 2, rank: 8, sh_rank: 8, youth: true, price: 9.38 }).includes('underclass −8%'), 'the market row names the discount');
ok(refreshedLabel('2026-10-03T00:48:29Z', 'UTC') === 'Refreshed Oct 3, 2026' && refreshedLabel(null) === 'Not loaded yet', 'v0.601.0: the refreshed-on date');
ok(devyValueSub({ espn_id: '1', name: 'X', pos: 'WR', school: 'OSU', class_year: 2, rank_1qb: 1, rank_sf: 2, value_1qb: 11.04, value_sf: 10.49, underclass: true }) === 'WR · OSU · SO · underclass discount', 'the values row line');
ok(fmtValue(8) === '8.00' && fmtValue(null) === '—', 'values print with two decimals, or a dash');
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL DEVY-MARKET CHECKS PASS');
