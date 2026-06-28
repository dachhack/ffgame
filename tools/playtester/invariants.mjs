// Automated playtester — INVARIANT GUARD. Asserts the structural + balance properties
// the harness established and the AI/engine changes rely on, so a future edit can't
// silently break them. Exits non-zero on any failure (CI-friendly).
//
//   npx tsx tools/playtester/invariants.mjs
import { rng, useWeek, drawRoster, buildMatchup, resolve, honestMatch, slugMeta } from './lib.mjs';
import { aiLineup } from '../../src/data/aiLineup.ts';
import { statsForSlug } from '../../src/data/players.ts';
import { windowForTeam } from '../../src/data/nflSlate.ts';
import { resolveLiveMatchup, makePlayer } from '../../server/src/engine.js';

let failed = 0;
const check = (name, ok, detail) => { console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const DRIP = new Set(['rush', 'recyd', 'combodrip', 'retyd']);
const proj = (s) => { const { pos } = slugMeta(s); return statsForSlug(s, pos).ppr; };
const ROSTER = { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 };
const live = (slug, metric, win, slot) => { const m = slugMeta(slug); return { win, slot, player: makePlayer(slug, m.pos, m.team), metricId: metric }; };

console.log('\nPLAYTESTER INVARIANTS\n');

// 1. Mirror baseline is EXACTLY symmetric (the adversary/iterate harnesses rely on 0).
{
  let maxAbs = 0;
  for (const week of [1, 5, 9, 14]) { const c = useWeek(week); const rand = rng(week); for (let i = 0; i < 100; i++) { const R = drawRoster(rand, c, ROSTER); const { homePicks, awayPicks } = buildMatchup(R, R, week, {}, {}); maxAbs = Math.max(maxAbs, Math.abs(resolve(homePicks, awayPicks, week).margin)); } }
  check('mirror roster + identical loadout → margin 0', maxAbs === 0, `max |margin| ${maxAbs}`);
}

// 2. A Field General never shares its window with a non-drip skill slot.
{
  let fg = 0, bad = 0;
  for (const week of [1, 3, 5, 7, 9, 11, 13]) { const c = useWeek(week); const rand = rng(week * 9); for (let i = 0; i < 300; i++) {
    const picks = aiLineup(drawRoster(rand, c, ROSTER), week, new Set(['unlock-combo-drip']));
    const byW = {}; for (const p of picks) (byW[p.win] ||= []).push(p);
    for (const g of Object.values(byW)) { if (!g.some((p) => p.metric === 'fg')) continue; fg++; if (g.some((p) => p.metric !== 'fg' && ['RB', 'WR', 'TE'].includes(slugMeta(p.slug).pos) && !DRIP.has(p.metric))) bad++; }
  } }
  check('Field General windows are all-drip', bad === 0, `${bad}/${fg} FG windows with a non-drip skill slot`);
}

// 3. No benched player outranks a fielded same-window player (best-players-first).
{
  let viol = 0;
  for (const week of [1, 5, 9, 14]) { const c = useWeek(week); const rand = rng(week + 1); for (let i = 0; i < 200; i++) {
    const roster = drawRoster(rand, c, ROSTER); const picks = aiLineup(roster, week); const fielded = new Set(picks.map((p) => p.slug));
    for (const b of roster) { if (fielded.has(b)) continue; const w = windowForTeam(week, slugMeta(b).team); if (!w) continue; if (picks.some((p) => p.win === w && proj(p.slug) < proj(b) - 0.01)) viol++; }
  } }
  check('best players fielded (overflow by projection)', viol === 0, `${viol} benched-outranks-fielded`);
}

// 4. The harness is fair — honest-field home win-rate ≈ 50%.
{
  let wins = 0, n = 0;
  for (const week of [1, 4, 8, 12]) { useWeek(week); const rand = rng(week * 31); for (let i = 0; i < 400; i++) { const m = honestMatch(rand, week, `inv${i}`); n++; if (m.winner === 'home') wins++; } }
  const wr = wins / n * 100;
  check('honest-field home win-rate ~50%', Math.abs(wr - 50) < 4, `${wr.toFixed(1)}%`);
}

// 5. NUKE works: a TD nuke meaningfully suppresses the matched drip (the §6 retune that
//    revived it from "dead"). Mechanic-level, so it's robust vs sampling noise.
{
  const week = 1; const c = useWeek(week);
  const wr = [...c.pool.WR].sort((a, b) => proj(b) - proj(a))[0];
  const tdRb = [...c.pool.RB].find((s) => (c.pbp[s] || []).some((p) => p.td));
  const home = [live(wr, 'recyd', 'early', '0')];
  const scoreVs = (rbMetric) => resolveLiveMatchup(home, [live(tdRb, rbMetric, 'early', '0')], week, {}).slots.find((s) => s.side === 'home')?.score ?? 0;
  const unNuked = scoreVs('rush');   // RB drips, doesn't nuke → WR scores its drip
  const nuked = scoreVs('td');       // RB's TD nukes → WR's drip wiped + blacked out
  check('a TD nuke suppresses the matched drip', nuked < 0.6 * unNuked, `unnuked ${unNuked.toFixed(1)} → nuked ${nuked.toFixed(1)}`);
}

// 6. The nuke counters work: vs a TD nuke, insurance keeps the slot alive (drip survives).
{
  const week = 1; const c = useWeek(week);
  // a drip WR (slot 0) nuked by a matched RB on `td` that scores a TD; with insurance the
  // WR keeps its drip and ends well above 0, without it the slot is blacked out.
  const wr = [...c.pool.WR].sort((a, b) => proj(b) - proj(a))[0];
  const tdRb = [...c.pool.RB].find((s) => (c.pbp[s] || []).some((p) => p.td));
  const home = [live(wr, 'recyd', 'early', '0')];
  const away = [live(tdRb, 'td', 'early', '0')];
  const bare = resolveLiveMatchup(home, away, week, {}).slots.find((s) => s.side === 'home')?.score ?? 0;
  const ins = resolveLiveMatchup(home, away, week, { homeBuffs: new Set(['insurance']) }).slots.find((s) => s.side === 'home')?.score ?? 0;
  check('insurance keeps a nuked drip alive', ins > bare + 1, `bare ${bare.toFixed(1)} → insured ${ins.toFixed(1)}`);
}

console.log(failed ? `\n✗ ${failed} invariant(s) FAILED\n` : '\n✓ all invariants hold\n');
process.exit(failed ? 1 : 0);
