// THE LIVE ADP FEED, VALIDATED (v0.454.0). NETWORK — `npm run validate:adp`,
// deliberately NOT in check:parity, which stays offline.
//
// The worker now trusts this file to price a draft board without anybody
// looking at it, so the things worth checking are the ones that would be
// silent: a feed that stopped refreshing, a format column that emptied, ids
// that stopped resolving, or a board that quietly disagrees with the bake it
// replaced by more than a market ever should.
import { adpRows } from '../server/src/poll/adp.js';
import { ADP_BY_SID, ADP_AS_OF } from '../packages/core/src/data/adp2026.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const SEASON = Number(process.env.SEASON || 2026);
const RAW = process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead';
const REF = process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd';
const res = await fetch(`${RAW}/${REF}/public/data/sleeper-adp-${SEASON}.json`,
  { headers: { accept: 'application/json', 'user-agent': process.env.AUDIT_UA || 'curl/8.5.0' } });
ok(res.ok, `the board answers (${res.status})`);
const feed = await res.json();

ok(Number(feed.season) === SEASON, `it is ${SEASON}'s board`);
const ageH = (Date.now() - Date.parse(feed.fetchedAt)) / 3600000;
ok(Number.isFinite(ageH) && ageH < 96, `measured ${ageH.toFixed(1)}h ago (${feed.fetchedAt})`);

const rows = adpRows(feed, { sleeper: () => null });
ok(rows.length > 200, `${rows.length} players carry a redraft price (of ${feed.players.length} in the file)`);
for (const [col, label] of [['adp_ppr', 'PPR'], ['adp_half', 'half'], ['adp_std', 'standard'], ['adp_2qb', 'superflex']]) {
  const n = rows.filter((r) => r[col] != null).length;
  ok(n > 150, `${label}: ${n} priced`);
}
ok(rows.every((r) => r.sleeper_id), 'every row is keyed by a sleeper id');

// THE SUPERFLEX BOARD IS A DIFFERENT BOARD. If the 2QB column ever became a
// copy of the PPR one, every superflex league would silently go back to
// reading 1QB prices — the exact bug this version exists to fix.
const qbs = rows.filter((r) => r.adp_2qb != null && r.adp_ppr != null);
const moved = qbs.filter((r) => Math.abs(r.adp_2qb - r.adp_ppr) > 1).length;
ok(moved > 20, `${moved} players are priced differently in superflex — the column is its own market`);

// AND IT AGREES WITH THE BAKE IT OVERLAYS, roughly. Two different markets
// measured days apart should be close but never identical; both extremes are
// worth knowing about.
const pairs = [];
for (const r of rows) {
  const baked = ADP_BY_SID.get(r.sleeper_id);
  if (baked != null && r.adp_ppr != null) pairs.push(Math.abs(baked - r.adp_ppr));
}
const mean = pairs.reduce((a, b) => a + b, 0) / (pairs.length || 1);
ok(pairs.length > 100, `${pairs.length} players priced by both this feed and the ${ADP_AS_OF} bake`);
ok(mean > 0.05, `mean gap ${mean.toFixed(1)} picks — not a copy of the bake`);
ok(mean < 40, `mean gap ${mean.toFixed(1)} picks — and not a different sport`);

console.log(fails === 0 ? '\nALL ADP-FEED ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
