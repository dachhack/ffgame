// THE LIVE FEED, VALIDATED (v0.447.0). NETWORK — `npm run validate:weekmult`,
// deliberately NOT in check:parity, which stays offline.
//
// v0.445.0 decoded ESPN's weekly stat ids and then PROVED the decode against
// the source's own scored total rather than trusting it (check-proj-map).
// Same discipline here, for the claim the whole version rests on:
//
//   1. the file is where we say it is, and fresh;
//   2. every position we care about is in it — including the K, DST and IDP
//      rows ESPN's weekly feed could only ever give us as a total;
//   3. a player's 17 (or 16) weekly numbers sum back to his season line, so
//      the weekly split really is the season projection redistributed and
//      not a second, disagreeing model;
//   4. the multiplier is the whole story: for each team and position the
//      week's ratio is SHARED by every player on that team, which is what
//      makes "our season number × mult" legitimate rather than a guess;
//   5. the ids we join on are actually there.
import { statheadFeed, statheadRows } from '../server/src/poll/projections.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const season = Number(process.env.SEASON || 2026);
const feed = await statheadFeed(season);

ok(Number(feed.season) === season, `the feed is for ${season}`);
const age = (Date.now() - Date.parse(feed.generatedAt)) / 3600000;
ok(Number.isFinite(age) && age < 72, `built ${age.toFixed(1)}h ago (stamped ${feed.generatedAt})`);

const byPos = {};
for (const p of feed.players ?? []) byPos[p.pos] = (byPos[p.pos] ?? 0) + 1;
for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DL', 'LB', 'DB']) {
  ok((byPos[pos] ?? 0) > 20, `${pos}: ${byPos[pos] ?? 0} players`);
}

// The weeks sum back to the season line. `wk` is a per-game rate for each
// scheduled week, so the mean over played weeks is the season ppg — one
// model, split, rather than two models disagreeing.
// The feed publishes points rounded to a cent, so a man projected for 0.15 a
// game carries ±3% of rounding in his ratio and nothing else. Both tests
// below therefore look only at players with a real number to divide by.
const REAL_PPG = 3;
let worst = 0; let worstName = '';
for (const p of feed.players ?? []) {
  const wk = (p.wk ?? []).filter((x) => x != null);
  if (!wk.length || !(p.ppg >= REAL_PPG) || p.active === false || p.backup) continue;
  const mean = wk.reduce((a, b) => a + b, 0) / wk.length;
  const err = Math.abs(mean - p.ppg) / p.ppg;
  if (err > worst) { worst = err; worstName = p.name; }
}
ok(worst < 0.05, `the weeks average back to the season line (worst ${(worst * 100).toFixed(2)}% — ${worstName})`);

// The multiplier is shared within a team and position — the property that
// makes it a MATCHUP term rather than a per-player opinion, and therefore
// safe to apply to a number of our own.
const week = Number(process.env.WEEK || feed.currentWeek || 1);
const rows = statheadRows(feed, week);
const groups = new Map();
for (const p of feed.players ?? []) {
  const pts = (p.wk ?? [])[week - 1];
  if (pts == null || !(p.ppg >= REAL_PPG) || p.active === false) continue;
  const k = `${p.team}/${p.pos}`;
  const list = groups.get(k) ?? [];
  list.push(pts / p.ppg);
  groups.set(k, list);
}
let spread = 0; let spreadKey = '';
for (const [k, list] of groups) {
  if (list.length < 2) continue;
  const s = Math.max(...list) - Math.min(...list);
  if (s > spread) { spread = s; spreadKey = k; }
}
ok(spread < 0.02, `one multiplier per team and position (widest spread ${spread.toFixed(4)} — ${spreadKey})`);

ok(rows.length > 300, `week ${week}: ${rows.length} rows with a sleeper id to join on`);
ok(rows.every((r) => r.key && r.source === 'stathead'), 'every row is keyed and sourced');
ok(rows.some((r) => r.opp), 'and carries the opponent it was computed against');
const idless = (feed.players ?? []).filter((p) => !p.sleeper).length;
console.log(`     (${idless} of ${feed.players.length} feed rows carry no sleeper id and are skipped)`);

console.log(fails === 0 ? '\nALL WEEK-FEED ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
