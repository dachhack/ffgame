// THE DEVY MARKET TABLE (v0.577.0): progress to max, owners, filters, sorting,
// and two-decimal numbers. Offline.
import { fmtPts, stakeProgress, marketLines, shapeMarket, nextSort, marketSubline, slotLabel, timeLeft, launchBanner, launchOrderMax, tradePreview } from '../packages/core/src/data/devyShares.ts';

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

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL DEVY-MARKET CHECKS PASS');
