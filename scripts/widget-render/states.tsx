// Every widget state the three home-screen widgets can be asked to draw, fed
// through the widget library's own tree builder (check-widget-render.mjs).
import React from 'react';
import { buildWidgetTree, FlexWidget, TextWidget } from 'react-native-android-widget';
import { MatchupWidget } from '../../apps/mobile/src/widget/MatchupWidget';
import { AlertsWidget, FieldsWidget } from '../../apps/mobile/src/widget/ExtraWidgets';
import { inert } from '../../apps/mobile/src/widget/inert';
import { alertsSummary, fieldGames } from '@drip/core/data/widgetExtras';
import { setRuntimeSlate } from '@drip/core/data/nflSlate';
import { setLiveGameFeed, feedRowsToWeek } from '@drip/core/data/gameFeed';

let fails = 0, n = 0;
const count = (t: any): number => 1 + (t.children ?? []).reduce((k: number, c: any) => k + count(c), 0);
const tryIt = (label: string, el: React.JSX.Element) => {
  n++;
  try { const t = buildWidgetTree(el); console.log(`ok   ${label} (${count(t)} nodes)`); }
  catch (e: any) { fails++; console.log(`FAIL ${label}: ${e.message}`); }
};
const card = (o: any) => ({ win: 'early', winLabel: 'SUN 1PM', phase: 'setup', slot: '1', slug: 'x', name: 'A. Guy', pos: 'RB', team: 'ATL', metric: 'Rush Yards', image: 'https://a.espncdn.com/x.png', status: 'set', points: null, hot: false, ...o });
const base: any = { leagueId: 'L', leagueName: 'Gridiron Gang', rosterId: 4, week: 3, weekLabel: 'Wk 3', me: { name: 'Me', score: 42.6, avatar: null }, them: { name: 'TheRFM', score: 38.1, avatar: 'https://x/a.png' },
  phase: 'live', line: 'LIVE · SUN 1PM', at: 0, windows: [{ id: 'tnf', label: 'TNF', phase: 'final', me: 10, them: 3 }, { id: 'early', label: 'SUN 1PM', phase: 'live', me: 5, them: 9 }],
  left: { me: { waiting: 1, playing: 2, done: 3 }, them: { waiting: 2, playing: 1, done: 1 } }, hot: 1, alarm: { win: 'early', winLabel: 'SUN 1PM', lockMs: Date.now() + 3600e3, empty: 1 },
  fixes: [{ win: 'early', winLabel: 'SUN 1PM', kind: 'injury', text: 'A. Guy is OUT' }], assessable: true, lead: 'score', standing: { wins: 1, losses: 1, ties: 0, place: 4, of: 12 } };
const drip = { ...base, cards: [card({ win: 'tnf', status: 'final', points: 10 }), card({ status: 'live', points: 5.2, hot: true, injury: 'Q' }), card({ status: 'empty', slug: null, name: '' }), card({ status: 'none', slug: null, name: '' }), card({ status: 'set', metricId: 'fg', kick: Date.now() })] };
for (const w of [250, 330, 420]) tryIt(`matchup drip w${w}`, <MatchupWidget state={{ kind: 'ok', snap: drip, leagues: 3 }} widthDp={w} heightDp={180} />);
const classic = { ...base, assessable: false, projected: true, actual: { me: 20, them: 18 }, winPct: 0.62,
  fixes: [{ win: 'RB2', winLabel: 'RB 2', kind: 'empty', text: 'empty · start B. Robinson 22.2' }, { win: 'FLEX', winLabel: 'FLEX', kind: 'swap', text: 'K. G 11.9 over E. H 0.6' }],
  cards: [card({ win: 'QB', winLabel: 'QB', slot: 'QB', proj: 21.6, bestball: false, status: 'live', points: 9.1, injury: 'D' }), card({ win: 'RB2', winLabel: 'RB 2', slot: 'RB2', slug: null, name: '', proj: null, bestball: false, status: 'empty' }),
    card({ win: 'FLEX', winLabel: 'FLEX', slot: 'FLEX', proj: 12.1, bestball: true, status: 'set', bye: true }), card({ win: 'WR', winLabel: 'WR', slot: 'WR', proj: 14, bestball: false, status: 'final', points: 18.4 })] };
tryIt('matchup classic', <MatchupWidget state={{ kind: 'ok', snap: classic, leagues: 2 }} widthDp={330} heightDp={200} />);
tryIt('matchup classic no winPct, themLive', <MatchupWidget state={{ kind: 'ok', snap: { ...classic, winPct: undefined, themLive: true }, leagues: 1 }} widthDp={250} />);
tryIt('matchup score (bye)', <MatchupWidget state={{ kind: 'ok', snap: { ...base, them: null, cards: [], assessable: false, phase: 'bye' }, leagues: 1, offline: true }} widthDp={250} heightDp={260} />);
for (const k of ['signed-out', 'no-leagues'] as const) tryIt(`matchup ${k}`, <MatchupWidget state={{ kind: k }} />);
tryIt('matchup error', <MatchupWidget state={{ kind: 'error', message: 'offline' }} />);
tryIt('matchup loading', <MatchupWidget state={{ kind: 'loading', title: 'x', body: 'y' }} />);

const sum = alertsSummary([drip, classic, { ...drip, leagueId: 'L2', leagueName: 'A very long league name that must truncate' }]);
tryIt(`alerts ${sum.total}`, <AlertsWidget state={{ kind: 'ok', summary: sum, leagues: 2 }} />);
tryIt('alerts clean offline', <AlertsWidget state={{ kind: 'ok', summary: alertsSummary([]), leagues: 1, offline: true }} />);
tryIt('alerts one league no lock', <AlertsWidget state={{ kind: 'ok', summary: { total: 2, leagues: [{ leagueId: 'L', rosterId: 1, name: 'X', n: 2, lockMs: null }], lockMs: null }, leagues: 1 }} />);
for (const k of ['signed-out', 'no-leagues'] as const) tryIt(`alerts ${k}`, <AlertsWidget state={{ kind: k }} />);
// v0.511.0 — the 2×1: total block + scrolling leagues; ✓ row; a narrow widget still stacks.
tryIt('alerts 2×1 list', <AlertsWidget state={{ kind: 'ok', summary: sum, leagues: 3 }} widthDp={140} />);
tryIt('alerts 2×1 offline, no lock', <AlertsWidget state={{ kind: 'ok', summary: { total: 2, leagues: [{ leagueId: 'L', rosterId: 1, name: 'X', n: 2, lockMs: null }], lockMs: null }, leagues: 1, offline: true }} widthDp={140} />);
tryIt('alerts 2×1 all set', <AlertsWidget state={{ kind: 'ok', summary: alertsSummary([]), leagues: 4 }} widthDp={140} />);
tryIt('alerts 1×1 still stacks', <AlertsWidget state={{ kind: 'ok', summary: sum, leagues: 3 }} widthDp={70} />);
{
  n++;
  const wide = JSON.stringify(buildWidgetTree(<AlertsWidget state={{ kind: 'ok', summary: sum, leagues: 3 }} widthDp={140} />));
  const narrow = JSON.stringify(buildWidgetTree(<AlertsWidget state={{ kind: 'ok', summary: sum, leagues: 3 }} widthDp={70} />));
  const rowRoot = /"orientation":"HORIZONTAL"/.test(wide.slice(0, 400)) && !/"orientation":"HORIZONTAL"/.test(narrow.slice(0, 400));  // the builder spells a row HORIZONTAL
  if (wide === narrow || !rowRoot) { fails++; console.log('FAIL alerts: the 2×1 must lay out as a row, not the 1×1 stack'); }
  else console.log('ok   alerts: 2×1 lays out as a row, 1×1 stacks');
}

setRuntimeSlate(3, [{ away: 'MIA', home: 'BUF', aScore: 0, hScore: 0, win: 'tnf', kickoff: Date.now() - 864e5 }, { away: 'ATL', home: 'CAR', aScore: 0, hScore: 0, win: 'early', kickoff: Date.now() - 3600e3 }, { away: 'DET', home: 'BAL', aScore: 0, hScore: 0, win: 'mnf', kickoff: Date.now() + 864e5 }]);
const P = (c: number, tm: string, yl2: number, hs: number, as: number, txt: string, x: any = {}) => ({ c, drv: 0, tm, dn: 1, dist: 10, yl: yl2, yl2, ty: 'Rush', txt, hs, as, ...x });
setLiveGameFeed(3, feedRowsToWeek([{ key: 'MIA@BUF', away: 'MIA', home: 'BUF', state: 'post', plays: [P(3590, 'BUF', 60, 31, 17, 'Kneel')] },
  { key: 'ATL@CAR', away: 'ATL', home: 'CAR', state: 'in', plays: [P(1500, 'CAR', 34, 3, 7, 'C.Hubbard left end for 9 yards', { to: 1 })] },
  { key: 'KC@NYG', away: 'KC', home: 'NYG', state: 'in', plays: [] }]) as any);
const games = fieldGames(3, new Map([['CAR', [{ name: 'C. Hubbard', pts: 6, proj: null, live: true }]], ['BAL', [{ name: 'L. Jackson', pts: null, proj: 22.1, live: false }]]]));
tryIt(`fields ${games.length} games`, <FieldsWidget state={{ kind: 'ok', week: 3, games }} />);
const starred = games.map((g, i) => (i === 0 ? { ...g, mine: [
  { name: 'P. One', pts: null, proj: 12.3, live: false, state: 'pre' as const, injury: 'Q' },
  { name: 'P. Two', pts: 20.1, proj: null, live: false, state: 'final' as const, injury: null },
  { name: 'P. Three', pts: 4, proj: null, live: true, state: 'live' as const, injury: 'O' },
  { name: 'P. Four', pts: null, proj: null, live: false, state: 'pre' as const },
  { name: 'P. Five', pts: 1, proj: 2, live: false, state: 'final' as const },
] } : g));
tryIt('fields with nav, a picked league, stars in every state', <FieldsWidget state={{ kind: 'ok', week: 2, games: starred, current: 3, hasPrev: true, hasNext: false, leagueLabel: 'Gridiron Gang' }} />);
tryIt('fields at the slate\'s start, now', <FieldsWidget state={{ kind: 'ok', week: 3, games: [], current: 3, hasPrev: false, hasNext: true }} />);
tryIt('fields offline', <FieldsWidget state={{ kind: 'ok', week: 3, games, offline: true }} />);
for (const s of [{ kind: 'loading' }, { kind: 'empty' }, { kind: 'error', message: 'x' }] as const) tryIt(`fields ${s.kind}`, <FieldsWidget state={s as any} />);
// v0.508.0 — a game opened in place: last plays, leaders, the app button.
const opened = games.map((g) => ({ ...g, dd: g.state === 'live' ? '2nd & 7' : null, spot: g.state === 'live' ? 'BUF 34' : null,
  recent: g.state === 'pre' ? [] : [{ clock: 'Q2 6:40', txt: 'B.Young pass short right to X for 9 yards', big: null }, { clock: 'Q2 7:10', txt: 'TOUCHDOWN', big: 'score' as const }],
  leaders: g.state === 'pre' ? [] : [{ team: g.away, cat: 'pass' as const, name: 'A. Guy', line: '12/18, 140 YDS' }, { team: g.home, cat: 'rush' as const, name: 'B. Guy', line: '9 CAR, 61 YDS' }] }));
for (const g of opened) tryIt(`fields, ${g.key} (${g.state}) opened`, <FieldsWidget state={{ kind: 'ok', week: 3, games: opened, openKey: g.key, current: 3 }} />);

// v0.507.0 — the frames drawn while a tap is answered: busy, and INERT — they
// must build, and no node in them may carry a tap.
const taps = (t: any): number => ((t.props?.clickAction ? 1 : 0) + (t.children ?? []).reduce((k: number, c: any) => k + taps(c), 0));
const inertIt = (label: string, el: React.JSX.Element) => {
  n++;
  try {
    const live = taps(buildWidgetTree(el)), dead = taps(buildWidgetTree(inert(el)));
    if (live === 0) { fails++; console.log(`FAIL ${label}: the live picture has no taps to strip`); }
    else if (dead !== 0) { fails++; console.log(`FAIL ${label}: ${dead} tap(s) survive inert`); }
    else console.log(`ok   ${label}: ${live} taps live, 0 inert`);
  } catch (e: any) { fails++; console.log(`FAIL ${label}: ${e.message}`); }
};
inertIt('matchup drip, NEXT loading', <MatchupWidget state={{ kind: 'ok', snap: drip, leagues: 3, busy: 'next' }} widthDp={330} />);
inertIt('matchup classic, ⟳ loading', <MatchupWidget state={{ kind: 'ok', snap: classic, leagues: 2, busy: 'refresh' }} widthDp={330} />);
inertIt('matchup score card, NEXT loading', <MatchupWidget state={{ kind: 'ok', snap: { ...base, them: null, cards: [], assessable: false, phase: 'bye' }, leagues: 2, busy: 'next' }} widthDp={250} />);
inertIt('matchup switching notice', <MatchupWidget state={{ kind: 'loading', title: 'Switching…', body: 'x' }} />);
inertIt('alerts list, busy', <AlertsWidget state={{ kind: 'ok', summary: sum, leagues: 3, busy: true }} />);
inertIt('alerts ✓, busy', <AlertsWidget state={{ kind: 'ok', summary: alertsSummary([]), leagues: 1, busy: true }} />);
inertIt('alerts 2×1, busy', <AlertsWidget state={{ kind: 'ok', summary: sum, leagues: 3, busy: true }} widthDp={140} />);
inertIt('alerts 2×1 ✓, busy', <AlertsWidget state={{ kind: 'ok', summary: alertsSummary([]), leagues: 2, busy: true }} widthDp={140} />);
inertIt('fields, busy', <FieldsWidget state={{ kind: 'ok', week: 2, games: starred, current: 3, hasPrev: true, hasNext: true, leagueLabel: 'X', busy: true }} />);

// The harness itself: the two shapes that blank a widget must still fail here.
const mustThrow = (label: string, el: React.JSX.Element) => { n++; try { buildWidgetTree(el); fails++; console.log(`FAIL ${label}: built, but must throw`); } catch { console.log(`ok   ${label} throws, as it must`); } };
const Nothing = () => null;
mustThrow('a fragment', <FlexWidget><><TextWidget text="a" /></></FlexWidget>);
mustThrow('a component returning null', <FlexWidget><Nothing /></FlexWidget>);
const Two = () => <FlexWidget>{[['a', 'b'].map((t) => [<TextWidget key={t} text={t} />])]}</FlexWidget>;
mustThrow('children nested two arrays deep (map inside map)', <FlexWidget><Two /></FlexWidget>);
console.log(fails ? `\n${fails} of ${n} FAILED` : `\nall ${n} widget states build`);
process.exit(fails ? 1 : 0);
