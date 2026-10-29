// THE BLIND AUTO-PICK (v0.735.0). Founder: "Let's have the game auto assign
// the player to another spot as a back up then the player can change it if
// they like ... like low scoring players or players that don't score like
// field general QBs." An unassigned backup now commits before kickoff to the
// starter who banks nothing himself (Field General, Suppress, Negation), else
// the lowest stock projection, instead of being matched at final onto
// whoever ended lowest. Pins the pick, that it ignores the scores, that a
// manual assignment wins and holds its target, and the window rule.
import { applyPostSlotPipeline, blindBackupRank, backupPlanForBoard } from '../packages/core/src/engine/orchestrate.ts';
import { autoBackupTargets } from '../packages/core/src/engine/scoringRules.ts';
import { windowsForWeek } from '../packages/core/src/data/nflSlate.ts';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };
const P = (id, pos) => ({ id, name: id, full: id, pos, team: 'X', stats: {} });
const sideLens = (side) => ({
  key: (s) => `${s.win}#${s.slot}`, win: (s) => s.win,
  player: (s) => (side === 'home' ? s.homeP : s.awayP),
  metric: (s) => (side === 'home' ? s.homeMetric : s.awayMetric),
  opp: (s) => (side === 'home' ? s.awayP : s.homeP),
  get: (s) => (side === 'home' ? s.home : s.away),
  set: (s, v) => { if (side === 'home') s.home = v; else s.away = v; },
});
const WEEK = 8;
const order = windowsForWeek(WEEK).map((w) => w.id);
const winRank = (w) => order.indexOf(w);
const slot = (win, slotN, me, metric, score, them = P('opp', 'WR')) =>
  ({ win, slot: slotN, homeP: me, awayP: them, homeMetric: metric, awayMetric: 'recyd', home: score, away: 5, events: [] });
const run = (slots, backups = {}) => applyPostSlotPipeline(slots, {
  week: WEEK,
  a: { lens: sideLens('home'), evSide: 'you', backups },
  b: { lens: sideLens('away'), evSide: 'their' },
  eventsOf: (s) => s.events,
});
const plan = (slots, assign = {}) => autoBackupTargets(slots, sideLens('home'), assign, winRank, blindBackupRank(sideLens('home')));
// TNF left empty by the opponent: Caleb Williams is the backup.
const lineup = (o = {}) => [
  slot('tnf', '0', P('caleb-williams', 'QB'), 'pass', o.caleb ?? 20, null),
  slot('early', '0', P('joe-burrow', 'QB'), o.burrowMetric ?? 'pass', o.burrow ?? 3),
  slot('early', '1', P('breece-hall', 'RB'), 'rush', o.hall ?? 12),
  slot('snf', '0', P('george-holani', 'RB'), 'rush', o.holani ?? 9),
];

{ // a Field General banks nothing: he's covered first, whatever the others project
  const s = lineup({ burrowMetric: 'fg', burrow: 0 }); run(s);
  ok(plan(s)['tnf#0'] === 'early#0', `the pick is the Field General QB (${plan(s)['tnf#0']})`);
  ok(s[1].home === 20 && s[3].home === 9, `Caleb's 20 lands on the FG spot, Holani keeps his 9 (${s[1].home}, ${s[3].home})`);
}
{ // no Field General: the lowest stock projection, not the lowest final score
  const s = lineup({ burrow: 3, holani: 9 }); run(s);
  ok(plan(s)['tnf#0'] === 'snf#0', `the pick is Holani, the lowest projection (${plan(s)['tnf#0']})`);
  ok(s[3].home === 20 && s[1].home === 3, `Caleb covers Holani (20), not Burrow's lower 3 (${s[3].home}, ${s[1].home})`);
}
{ // blind: the same pick before a snap as at final
  const pre = lineup({ caleb: 0, burrow: 0, hall: 0, holani: 0 });
  ok(plan(pre)['tnf#0'] === plan(lineup())['tnf#0'], 'the pick is the same before the games as after');
}
{ // all-or-nothing still: he lands only if he outscores the pick
  const s = lineup({ caleb: 6, holani: 9 }); run(s);
  ok(s[3].home === 9 && s[0].home === 0, `Caleb's 6 doesn't beat Holani's 9: no sub, no fallback (${s[3].home})`);
}
{ // a manual assignment wins, and the pick never doubles up on its target
  const s = lineup(); run(s, { 'tnf#0': 'early#1' });
  ok(s[2].home === 20 && s[3].home === 9, `the manual target (Hall) takes the sub (${s[2].home}, ${s[3].home})`);
  const two = [...lineup(), slot('tnf', '1', P('puka-nacua', 'WR'), 'recyd', 15, null)];
  const p2 = plan(two, { 'tnf#0': 'snf#0' });
  ok(p2['tnf#1'] && p2['tnf#1'] !== 'snf#0' && !p2['tnf#0'], `a second backup's pick skips the manually held spot (${JSON.stringify(p2)})`);
}
{ // the window rule: a Sunday backup never covers Thursday
  const s = [
    slot('tnf', '0', P('tanner-mckee', 'QB'), 'pass', 1),
    slot('early', '0', P('puka-nacua', 'WR'), 'recyd', 20, null),
    slot('snf', '0', P('joe-burrow', 'QB'), 'pass', 4),
  ];
  ok(plan(s)['early#0'] === 'snf#0', `skips the earlier TNF spot (${plan(s)['early#0']})`);
}
{ // the boards' helper names the engine's target, and a sealed window counts as opposed
  const s = lineup();
  const rows = s.map((r) => ({ key: `${r.win}#${r.slot}`, win: r.win, slug: r.homeP.id, pos: r.homeP.pos, metric: r.homeMetric, opposed: !!r.awayP }));
  const b = backupPlanForBoard(WEEK, rows, {});
  ok(b.backups.join() === 'tnf#0' && b.auto['tnf#0'] === plan(s)['tnf#0'], `board and engine agree (${JSON.stringify(b)})`);
  const sealed = backupPlanForBoard(WEEK, rows.map((r) => (r.win === 'tnf' ? { ...r, opposed: true } : r)), {});
  ok(sealed.backups.length === 0, 'a sealed window not reported empty shows no backup');
  const fg = backupPlanForBoard(WEEK, rows.map((r) => (r.win === 'tnf' ? { ...r, metric: 'fg' } : r)), {});
  ok(fg.backups.length === 0 && !fg.auto['tnf#0'], 'a Field General backup has nothing to give and takes no target');
}
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('\nALL BACKUP-AUTOPICK ASSERTIONS PASSED');
