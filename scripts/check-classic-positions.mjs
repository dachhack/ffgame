// THE NON-STANDARD CLASSIC POSITIONS, END TO END (v0.531.0).
//
// Founder: "Do we have all the wiring in place for IDP positions? HC? Punter?
// Others? … Make sure to audit position and player mismatches and unexpected
// gaps in scoring or data." The audit found the ENGINE right and the WORKER
// wrong: it resolved players through Sleeper's raw position and the slug, so a
// head coach and a punter (`kc-hc`, `kc-p`) were WRs and a CB or a DE was
// neither DB nor DL — all scoring 0 in stored finals while the boards, which
// read the league pool, showed their points. This pins each piece:
//   • position resolution (slug suffixes, Sleeper → game positions);
//   • each position scores its own plays, and would NOT as a WR;
//   • a defender's return TD is one touchdown, not two;
//   • the box score has a line for HC, P and a full IDP line;
//   • a RET spot is filled by the best RETURNER.
// Run: tsx scripts/check-classic-positions.mjs
import { slugMeta } from '../packages/core/src/data/slugMeta';
import { fantasyPos } from '../packages/core/src/data/sleeperPlayers';
import { classicPointsFrom, normalizeClassicScoring, optimalLineup } from '../packages/core/src/engine/classic';
import { statlineFrom, fmtStat } from '../packages/core/src/engine/sim';
import { hasStats } from '../packages/core/src/engine/boxScore';
import { setLeagueScoring, clearLeagueScoring } from '../packages/core/src/engine/leagueScoring';
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const play = (kind, o = {}) => ({ clock: o.clock ?? 100, kind, yards: o.yards ?? 0, td: !!o.td, catch: false, target: false, ...o });
const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos) => ({ id, name: id, full: id, pos, team: '', stats: { ...ZERO } });

// ── 1. who is who ───────────────────────────────────────────────────────────
ok('kc-hc is a head coach on KC', slugMeta('kc-hc').pos === 'HC' && slugMeta('kc-hc').team === 'KC', slugMeta('kc-hc'));
ok('la-p is a punter on LA', slugMeta('la-p').pos === 'P', slugMeta('la-p'));
ok('a name collision ending -p is not a punter', slugMeta('john-smith-p').pos !== 'P');
ok('team K and DST still resolve', slugMeta('bal-k').pos === 'K' && slugMeta('car-dst').pos === 'DEF');
ok('Sleeper DE/DT/EDGE → DL', ['DE', 'DT', 'NT', 'EDGE'].every((p) => fantasyPos(p) === 'DL'));
ok('Sleeper ILB/OLB/MLB → LB', ['ILB', 'OLB', 'MLB', 'LB'].every((p) => fantasyPos(p) === 'LB'));
ok('Sleeper CB/S/FS/SS → DB', ['CB', 'S', 'FS', 'SS', 'DB'].every((p) => fantasyPos(p) === 'DB'));
ok('a position the game does not roster is null (OL)', fantasyPos('OL') === null && fantasyPos(null) === null);

// The worker resolves with the league pool's position first (resolve.js
// poolPos) — pinned in the source, since the resolver needs a database.
const resolveSrc = readFileSync(new URL('../server/src/resolve.js', import.meta.url), 'utf8');
ok('the resolver reads league_pool.pos', /from\('league_pool'\)\.select\('slug,pos,/.test(resolveSrc));
ok('…and prefers it when building a player', /makePlayer\(slug, poolPos\.get\(slug\) \?\? m\?\.pos/.test(resolveSrc));
const idxSrc = readFileSync(new URL('../server/src/playerIndex.js', import.meta.url), 'utf8');
ok('the worker index stores the GAME position (fantasyPos)', (idxSrc.match(/fantasyPos\(e\.p\.position\)/g) ?? []).length >= 2);

// ── 2. each position scores its own plays ───────────────────────────────────
const pay = normalizeClassicScoring({
  hcWin: 5, hcWm10: 2, hc3dc: 0.5, hc4dc: 1, hc2pt: 1,
  puntPt: 1, puntYd: 0.05, pta44: 3,
  idpTackle: 1, idpSolo: 0.5, idpSack: 2, idpTfl: 1, idpFf: 2, idpQbHit: 0.5, idpPd: 1, idpInt: 3, idpTd: 6,
  retYd: 0.1, retTd: 6,
});
const hcPlays = [play('hc_3dc'), play('hc_3dc'), play('hc_4dc'), play('hc_2pt'), play('hc_res', { yards: 12, clock: 3600 })];
const hcPts = classicPointsFrom(hcPlays, mk('kc-hc', 'HC'), pay);
ok('a head coach scores his win, margin and conversions', Math.abs(hcPts - (5 + 2 + 0.5 * 2 + 1 + 1)) < 0.01, hcPts);
ok('…and would score 0 as the WR the worker used to make him', classicPointsFrom(hcPlays, mk('kc-hc', 'WR'), pay) === 0);
const pPlays = [play('punt', { yards: 50 }), play('punt', { yards: 44 })];
const pPts = classicPointsFrom(pPlays, mk('kc-p', 'P'), pay);
ok('a punter scores per punt, per yard and his average band', Math.abs(pPts - (2 + 94 * 0.05 + 3)) < 0.01, pPts);
ok('…and 0 as a WR', classicPointsFrom(pPlays, mk('kc-p', 'WR'), pay) === 0);
const dPlays = [play('tackle', { tt: 's' }), play('tfl'), play('sack', { hf: true }), play('qbhit'), play('pd'), play('ff')];
const dbPts = classicPointsFrom(dPlays, mk('some-cb', 'DB'), pay);
ok('a DB scores tackles, TFL, half a sack, QB hit, PD, FF', Math.abs(dbPts - (1.5 + 1 + 1 + 0.5 + 1 + 2)) < 0.01, dbPts);
// (FF left out here: an offensive player's forced fumble pays stFf, so a
// mislabelled defender kept only that one knob's worth.)
ok('…and none of his tackles, sacks, hits or PDs as the raw "CB" the worker used to hand the scorer',
  classicPointsFrom(dPlays.filter((p) => p.kind !== 'ff'), mk('some-cb', 'CB'), pay) === 0);

// ── 3. a defender's return TD is ONE touchdown ──────────────────────────────
// The live feed writes the takeaway (td flag, for the 50+ bonus) AND a dst_td
// row. A scoped per-TD bonus must count one.
setLeagueScoring({ scoped: [{ pos: ['DB'], tdBonus: 10 }] });
const pick6 = [play('int', { yards: 30, td: true }), play('dst_td')];
const withRule = classicPointsFrom(pick6, mk('some-cb', 'DB'), pay);
clearLeagueScoring();
const noRule = classicPointsFrom(pick6, mk('some-cb', 'DB'), pay);
ok('a pick-six pays the per-TD rule once', Math.abs(withRule - noRule - 10) < 0.01, { withRule, noRule });
const trueupSrc = readFileSync(new URL('../server/src/poll/trueup.js', import.meta.url), 'utf8');
ok('the true-up does not re-credit INT/fumble return TDs', /takeawayReturn/.test(trueupSrc) && /retired .* duplicate return-TD rows/.test(trueupSrc));

// ── 4. the box score has a line for everyone who scores ─────────────────────
const hcLine = statlineFrom(hcPlays, 9999);
ok('a head coach has a box-score line', hasStats(hcLine) && /W \+12/.test(fmtStat('HC', hcLine)), fmtStat('HC', hcLine));
const pLine = statlineFrom(pPlays, 9999);
ok('a punter has a box-score line with his average', hasStats(pLine) && /2 punts · 94 yd · 47 avg/.test(fmtStat('P', pLine)), fmtStat('P', pLine));
const dLine = statlineFrom(dPlays, 9999);
const dTxt = fmtStat('DB', dLine);
ok('an IDP line shows TFL, QB hits, PD and FF', ['TFL', 'QBH', 'PD', 'FF'].every((k) => dTxt.includes(k)), dTxt);
ok('a split sack reads as half a sack', dLine.sacks === 0.5, dLine.sacks);

// ── 5. a RET spot takes the best returner ───────────────────────────────────
const WR1 = { id: 'star-wr', pos: 'WR' }, RET1 = { id: 'returner', pos: 'WR' }, WR2 = { id: 'depth-wr', pos: 'WR' };
const full = { 'star-wr': 20, returner: 6, 'depth-wr': 9 };
const rets = { 'star-wr': 0, returner: 8, 'depth-wr': 1 };
const val = (p, d) => (d && d.pos.length === 1 && d.pos[0] === 'RET' ? rets[p.id] : full[p.id]);
const slots = [{ slot: 'S1', pos: ['WR'] }, { slot: 'S2', pos: ['RET'] }];
const lu = optimalLineup(slots, [WR1, RET1, WR2], val);
ok('the WR spot takes the best receiver', lu.spots[0].player?.id === 'star-wr', lu.spots.map((r) => r.player?.id));
ok('the RET spot takes the best RETURNER, not the next-best receiver', lu.spots[1].player?.id === 'returner', lu.spots.map((r) => r.player?.id));
const only = optimalLineup([{ slot: 'S1', pos: ['RET'] }], [WR1, RET1, WR2], val);
ok('a RET-only lineup is priced for returns too', only.spots[0].player?.id === 'returner', only.spots.map((r) => r.player?.id));

// ── 6. smaller holes the audit found ────────────────────────────────────────
const adapter = readFileSync(new URL('./espn/espnAdapter.mjs', import.meta.url), 'utf8');
// (v0.533.0 narrowed it further — only a run or a catch converts; the play
// itself is exercised in check:feedingest.)
ok('a penalty snap is not a coach\'s 3rd/4th-down conversion', /const ranPlay = typeText === 'Rush'/.test(adapter) && /fd && ranPlay/.test(adapter));
const mig = readFileSync(new URL('../supabase/migrations/0361_a_return_spot_takes_ball_carriers.sql', import.meta.url), 'utf8');
ok('the server roster cap counts a RET spot as a home for RB/WR/TE/FB', /\["RET"\]/.test(mig));

if (fails) { console.log(`\n${fails} CLASSIC-POSITION ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL CLASSIC-POSITION ASSERTIONS PASSED');
