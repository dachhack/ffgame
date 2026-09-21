// THE MATCHUP MULTIPLIER, PINNED (v0.447.0).
//
// The claim this version rests on is arithmetic, and arithmetic can be
// tested offline: StatHead's weekly feed scales a player's WHOLE line by one
// number, so this league's season rate × that number is this league's week.
// What can go wrong is not the model — it is the plumbing around it:
//
//   · reading the multiplier off the wrong pair of fields;
//   · turning a BYE into a zero (a projection of nothing is a lie about a
//     week that does not exist);
//   · joining on a name, or on an id the other source uses;
//   · showing a source's PPR total as though the league's rules were
//     applied to it.
//
// Offline on purpose: no network, so it can live in check:parity. The live
// feed is checked by `npm run validate:weekmult`.
import { readFileSync } from 'node:fs';
import { statheadRows } from '../server/src/poll/projections.js';
import { weekPointsFor } from '../packages/core/src/data/weekProj.ts';
import { setLeagueProjScoring, projectedPoints } from '../packages/core/src/engine/projScoring.ts';
import { PROJ_2026 } from '../packages/core/src/data/proj2026.ts';
import { slugMeta } from '../packages/core/src/data/slugMeta.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// A feed in the real shape: one starter, one man on IR, one with no sleeper
// id, one on bye in the week we ask for.
const feed = {
  season: 2026,
  teamWeeks: { DET: [{ w: 1, opp: 'NO', home: true }, { w: 2, opp: 'BUF', home: false }, { w: 3, opp: 'NYJ', home: true }],
               SEA: [{ w: 1, opp: 'SF', home: false }, { w: 2, opp: 'LAR', home: true }] },
  players: [
    { name: 'A Starter', pos: 'RB', team: 'DET', sleeper: '9221', ppg: 20, active: true, backup: false, wk: [21.0, 18.0, null] },
    { name: 'On IR', pos: 'WR', team: 'DET', sleeper: '7547', ppg: 15, active: false, status: 'RES', wk: [0, 0, 0] },
    { name: 'No Id', pos: 'TE', team: 'SEA', sleeper: null, ppg: 10, active: true, wk: [11, 9, 8] },
    { name: 'A Backup', pos: 'QB', team: 'SEA', sleeper: '4984', ppg: 12, active: true, backup: true, wk: [12.6, 11.4, 10] },
  ],
};

// 1. the multiplier is week ÷ season rate, and nothing else
const w1 = statheadRows(feed, 1);
const starter = w1.find((r) => r.key === '9221');
ok(starter && Math.abs(starter.mult - 1.05) < 1e-9, 'mult is the week over the season rate (21.0 / 20 = 1.05)');
ok(starter.pts === 21, 'and the source\'s own points ride along beside it');
ok(starter.opp === 'NO' && starter.home === true, 'the matchup comes from the schedule, not the player row');
const away = statheadRows(feed, 2).find((r) => r.key === '9221');
ok(away.opp === 'BUF' && away.home === false, 'and the home flag follows the week');

// 2. a bye is ABSENT, never zero
ok(!statheadRows(feed, 3).some((r) => r.key === '9221'), 'a bye week is absent rather than a zero');

// 3. ids only — a player the feed cannot key is not guessed at by name
ok(!w1.some((r) => r.name === 'No Id' || r.key === 'null' || r.key === null),
  'a player with no sleeper id is dropped rather than name-matched');

// 4. "he is out" is an answer, and carries its reason
const ir = w1.find((r) => r.key === '7547');
ok(ir && ir.pts === 0 && ir.mult === 0 && ir.status === 'RES', 'a man on IR comes back at zero WITH the reason');
ok(w1.find((r) => r.key === '4984').status === 'backup', 'a conditional backup line is labelled');

// 5. every row says which source it is, so the reader can be told
ok(w1.every((r) => r.source === 'stathead'), 'rows name their source');

// ── the client half: the multiplier lands on THIS league's number ─────────
setLeagueProjScoring(null);
const real = [...PROJ_2026.entries()].map(([slug, pts]) => ({ slug, pts, pos: slugMeta(slug)?.pos ?? null }))
  .filter((p) => p.pos === 'RB' && p.pts > 5).sort((a, b) => b.pts - a.pts)[0];
const season = projectedPoints({ id: real.slug, pos: 'RB' });
const scored = weekPointsFor({ slug: real.slug, pos: 'RB' },
  { pts: 999, mult: 1.1, opp: 'ARI', home: false, status: null, source: 'stathead' });
ok(scored.scored === true, 'with a multiplier the week is scored in THIS league');
ok(Math.abs(scored.pts - Math.round(season * 1.1 * 10) / 10) < 1e-9,
  'and it is the league\'s own season rate times the multiplier — not the source\'s total');
ok(scored.matchup === '@ ARI', 'an away game prints with the @');

// 6. no multiplier ⇒ the source's total, and SAID to be the source's total
const plain = weekPointsFor({ slug: real.slug, pos: 'RB' },
  { pts: 14.2, mult: null, opp: 'ARI', home: true, status: null, source: 'espn' });
ok(plain.pts === 14.2 && plain.scored === false, 'without one, the source\'s PPR total, flagged as such');
ok(plain.matchup === 'ARI', 'and a home game prints bare');

// 6b. ZERO is a multiplier (he is out); null is the absence of one. The two
// must not collapse into each other — Number(null) is 0, which is exactly how
// "no multiplier served" would silently become "projected to score nothing".
const out = weekPointsFor({ slug: real.slug, pos: 'RB' },
  { pts: 0, mult: 0, opp: 'ARI', home: true, status: 'RES', source: 'stathead' });
ok(out.pts === 0 && out.scored === true && out.status === 'RES',
  'a multiplier of zero means OUT, and is not mistaken for a missing one');

// 7. an unbaked player cannot be scaled, so he falls back rather than zeroing
const unknown = weekPointsFor({ slug: 'not-a-real-player', pos: 'RB' },
  { pts: 8.8, mult: 1.2, opp: 'KC', home: true, status: null, source: 'stathead' });
ok(unknown.pts === 8.8 && unknown.scored === false, 'a player with no baked season rate falls back to the total');

// 8. the reader in the database prefers StatHead per player, and says so
const sql = readFileSync(new URL('../supabase/migrations/0330_the_matchup_multiplier.sql', import.meta.url), 'utf8');
ok(/p\.source = 'stathead' and p\.player_key = lp\.sleeper_id/.test(sql), 'the StatHead join is on the sleeper id');
ok(/p\.source <> 'stathead' and p\.player_key = lp\.espn_id/.test(sql), 'the ESPN fallback is on the athlete id');
ok(/order by case when p\.source = 'stathead' then 0 else 1 end/.test(sql), 'and StatHead is preferred per player');
ok(/'source', source/.test(sql), 'the row tells the client which source answered');

console.log(fails === 0 ? '\nALL WEEK-MULT ASSERTIONS PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
