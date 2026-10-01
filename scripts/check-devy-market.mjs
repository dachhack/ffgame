// THE DEVY MARKET TABLE (v0.577.0): progress to max, owners, filters, sorting,
// and two-decimal numbers. Offline.
import { fmtPts, stakeProgress, marketLines, shapeMarket, nextSort, marketSubline } from '../packages/core/src/data/devyShares.ts';

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

ok(marketSubline(rows[0]) === 'OKST · SO · devy #40' && marketSubline(rows[2]) === 'SAM · FCS · FR · devy #900' && marketSubline(rows[1]) === 'GT · SO · #285 in college',
  'the line under a name');

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL DEVY-MARKET CHECKS PASS');
