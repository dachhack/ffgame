// THE LEAGUE TOOLS BAR (v0.715.0). Founder: "Right now the league tools bar is
// just heroes and villains. I'd like it to be a scrollable bar of tools for
// players: all fields, heroes and villains, line up suggestions and alerts,
// waiver targets, trade zone, etc." Pins the folds (lineup alerts, the trade
// zone) and that both clients draw the bar. Run: npx tsx scripts/check-league-tools.mjs
import { readFileSync } from 'node:fs';
import { lineupAlerts, lineupAlertCount, tradeZoneOf, sortTradeZone, tradeZoneCount, TRADE_ZONE_ORDER, wireTargetsOf, wireTargets, wireTargetCount } from '../packages/core/src/data/leagueTools';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); } else console.log(`ok   ${name}`); };

// ── lineup alerts ─────────────────────────────────────────────────────────
const snap = (id, name, phase, fixes) => ({ leagueId: id, rosterId: 1, leagueName: name, weekLabel: 'WK 6', phase, fixes });
const fix = (text, kind = 'empty') => ({ win: 'wk', winLabel: 'WK', kind, text });
const al = lineupAlerts([snap('a', 'Alpha', 'live', [fix('1 empty slot')]), snap('b', 'Beta', 'setup', [fix('start X', 'swap'), fix('Y is OUT', 'injury')]), snap('c', 'Gamma', 'final', [fix('old')]), snap('d', 'Delta', 'live', []), null]);
ok('alerts: leagues with fixes only, most first; a final week has none', al.map((a) => a.leagueId).join() === 'b,a', al.map((a) => a.leagueId));
ok('alerts: the count is every fix', lineupAlertCount([snap('a', 'A', 'live', [fix('x'), fix('y')]), snap('b', 'B', 'final', [fix('z')])]) === 2);

// ── trade zone ────────────────────────────────────────────────────────────
const L = { id: 'L1', name: 'Turf', rosterId: 3 };
const tr = (id, from, to, give, get, status = 'pending', extra = {}) => ({ id, from_roster: from, to_roster: to, give, get, status, note: null, created_at: `2026-10-1${id}T00:00:00Z`, resolved_at: null, ...extra });
const trades = [tr(1, 5, 3, ['a-gives'], ['my-guy']), tr(2, 3, 7, ['my-other'], ['their-guy']), tr(3, 5, 3, ['x'], ['y'], 'executed'), tr(4, 5, 6, ['p'], ['q']), tr(5, 5, 3, [], [], 'pending', { legs: [{ roster_id: 3 }] })];
const sig = (kind, roster, slug, holder) => ({ kind, roster_id: roster, slug, holder_roster: holder, created_at: '2026-10-12T00:00:00Z' });
const signals = [sig('want', 5, 'my-guy', 3), sig('block', 6, 'blocked-guy', 6), sig('block', 3, 'mine-on-block', 3), sig('want', 3, 'their-guy', 7)];
const name = (s) => s.toUpperCase(), team = (r) => `T${r}`;
const z = tradeZoneOf(L, trades, signals, name, team);
const kinds = z.map((i) => i.kind).sort().join();
ok('zone: an offer to me, an offer from me, a want on my player, a block elsewhere', kinds === ['block', 'offer_in', 'offer_out', 'want'].sort().join(), z.map((i) => i.kind));
const inn = z.find((i) => i.kind === 'offer_in');
ok('zone: an incoming offer says what I get and give, from whom', inn && inn.team === 'T5' && inn.get.join() === 'A-GIVES' && inn.give.join() === 'MY-GUY', inn);
ok('zone: settled trades, others\' trades and multi-team deals stay out', z.filter((i) => i.kind.startsWith('offer')).length === 2);
ok('zone: my own block and my own wants are not news to me', !z.some((i) => i.get.includes('MINE-ON-BLOCK')) && !z.some((i) => i.kind === 'want' && i.team === 'T3'));
const sorted = sortTradeZone(z);
ok('zone: waiting on you first, then wants, then yours, then the block', sorted.map((i) => i.kind).join() === TRADE_ZONE_ORDER.filter((k) => z.some((i) => i.kind === k)).join(), sorted.map((i) => i.kind));
ok('zone: the count is what wants an answer (offers in + wants)', tradeZoneCount(z) === 2);

// ── waiver targets (v0.716.0) ─────────────────────────────────────────────
const WSLOTS = [{ slot: 'S1', type: 'RB', pos: ['RB'] }, { slot: 'S2', type: 'RB', pos: ['RB'] }];
const NOW = Date.parse('2026-10-15T12:00:00Z');
const prow = (slug, full, waived = null) => ({ slug, full_name: full, pos: 'RB', team: '', rank: 1, waived_until: waived });
const wireIn = (over = {}) => ({
  slots: WSLOTS, roster: [{ slug: 'bijan-robinson', full: 'Bijan Robinson', pos: 'RB', team: null }],
  pool: [prow('jahmyr-gibbs', 'Jahmyr Gibbs'), prow('jonathan-taylor', 'Jonathan Taylor'), prow('christian-mccaffrey', 'Christian McCaffrey', '2026-10-17T00:00:00Z'), prow('bijan-robinson', 'Bijan Robinson')],
  rosters: [{ roster_id: 3, slug: 'bijan-robinson', acquired: 'draft', spot: 'active' }, { roster_id: 5, slug: 'jahmyr-gibbs', acquired: 'draft', spot: 'active' }],
  rosterId: 3, copies: 1, injuries: {}, week: 7, slate: [], nowMs: NOW, activeSeats: 4, ...over,
});
const w1 = wireTargetsOf(wireIn());
ok('wire: an empty spot is filled into the open place, and a rostered player is off the wire', w1[0]?.kind === 'hole' && w1[0]?.drop === null && !w1.some((t) => t.add === 'jahmyr-gibbs' || t.add === 'bijan-robinson'), w1);
const cmc = w1.find((t) => t.add === 'christian-mccaffrey');
ok('wire: a player inside his hold is a claim, an open one an add, and names resolve', cmc?.claim === true && w1.find((t) => t.add === 'jonathan-taylor')?.claim === false && cmc?.addName === 'Christian McCaffrey', w1);
const w2 = wireTargetsOf(wireIn({ copies: 2 }));
ok('wire: with two copies a player held once is still on the wire', w2.some((t) => t.add === 'jahmyr-gibbs'), w2.map((t) => t.add));
const w3 = wireTargetsOf(wireIn({ roster: [{ slug: 'bijan-robinson', full: 'Bijan Robinson', pos: 'RB', team: null }, { slug: 'jonathan-taylor', full: 'Jonathan Taylor', pos: 'RB', team: null }], pool: [prow('jonathan-taylor', 'Jonathan Taylor')], rosters: [{ roster_id: 3, slug: 'bijan-robinson', acquired: 'draft' }, { roster_id: 3, slug: 'jonathan-taylor', acquired: 'draft' }] }));
ok('wire: my own players are never targets', w3.length === 0, w3);
const ws = (id, name, gain) => ({ leagueId: id, rosterId: 1, leagueName: name, weekLabel: 'WK 7', wire: gain == null ? [] : [{ add: 'x', addName: 'X', pos: 'RB', team: null, drop: null, dropName: null, gain, rosGain: 0, kind: 'hole', claim: false }] });
const wt = wireTargets([ws('a', 'Alpha', 2), ws('b', 'Beta', 9), ws('c', 'Gamma', null), null]);
ok('wire: leagues with targets only, biggest gain first; the count is every target', wt.map((l) => l.leagueId).join() === 'b,a' && wireTargetCount([ws('a', 'A', 2), ws('b', 'B', 1)]) === 2, wt.map((l) => l.leagueId));
const feed = read('packages/core/src/data/widgetFeed.ts');
ok('wire: the glance plans it only when asked, never for a weekly contest', feed.includes('const wantWire = !!opts.wire && classic') && feed.includes("league.kind !== 'dfs' && league.kind !== 'bullseye'"));

// ── both clients draw the bar ─────────────────────────────────────────────
const phone = read('apps/mobile/src/screens/Leagues.tsx'), web = read('src/screens/LiveOnboard.tsx');
const pbar = read('apps/mobile/src/ui/LeagueToolsBar.tsx'), wbar = read('src/screens/LeagueToolsBar.tsx');
ok('both: the leagues list asks the glance for waiver targets', phone.includes('rosterId: l.rosterId, wire: true }') && web.includes('rosterId: l.rosterId, wire: true }'));
ok('phone: the leagues page carries the bar, not the lone H&V card', phone.includes('<LeagueToolsBar snaps={Object.values(glance)}') && !phone.includes('<HeroesVillains'));
ok('web: the leagues page carries the bar, not the lone H&V card', web.includes('<LeagueToolsBar snaps={Object.values(glance)} onFields={onFields}') && !web.includes('<HeroesVillains'));
for (const [n, src] of [['phone', pbar], ['web', wbar]]) {
  ok(`${n}: fields, heroes & villains, lineup and trade zone on the bar`, src.includes('▦ ALL FIELDS') && src.includes('HEROES') && src.includes('🧭 LINEUP') && src.includes('🔁 TRADE ZONE') && src.includes('📈 WAIVER TARGETS'));
  ok(`${n}: heroes & villains opens bare in its sheet`, src.includes('<HeroesVillains snaps={snaps} bare />'));
}
ok('phone: the bar scrolls sideways', pbar.includes('<ScrollView horizontal'));
ok('web: the bar scrolls sideways, never wraps', wbar.includes("flexWrap: 'nowrap', overflowX: 'auto'"));

if (fails) { console.log(`\n${fails} LEAGUE-TOOLS ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL LEAGUE-TOOLS ASSERTIONS PASSED');
