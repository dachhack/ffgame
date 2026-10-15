// THE LEAGUE TOOLS BAR (v0.715.0). Founder: "Right now the league tools bar is
// just heroes and villains. I'd like it to be a scrollable bar of tools for
// players: all fields, heroes and villains, line up suggestions and alerts,
// waiver targets, trade zone, etc." Pins the folds (lineup alerts, the trade
// zone) and that both clients draw the bar. Run: npx tsx scripts/check-league-tools.mjs
import { readFileSync } from 'node:fs';
import { gameFaces, gameCounts, previewList, injuryTag } from '../packages/core/src/data/heroes';
import { tradeIdeasOf, positionStrength, contenders } from '../packages/core/src/data/tradeIdeas';
import { PROJ_2026 } from '../packages/core/src/data/proj2026';
import { toggleToolLeague, toolHas, forTool, toolLeaguesOffCount, parseToolLeagues, toolsForLeague } from '../packages/core/src/data/toolLeagues';
import { lineupAlerts, lineupAlertCount, tradeZoneOf, sortTradeZone, tradeZoneCount, TRADE_ZONE_ORDER, wireTargetsOf, wireTargets, wireTargetCount, trendLabel, wireLensGroups, wireTargetLine, wireTargetBadge, wireTargetTag, WIRE_LENS_LABEL } from '../packages/core/src/data/leagueTools';
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
// MOMENTUM (v0.716.1): the AI seats' trendMomentum lifts a trending body.
const TPOOL = [prow('kyren-williams', 'Kyren Williams'), prow('breece-hall', 'Breece Hall')];
const tIn = (trend) => wireIn({ pool: TPOOL, rosters: [{ roster_id: 3, slug: 'bijan-robinson', acquired: 'draft' }], activeSeats: 2, max: 1, trend });
const t0 = wireTargetsOf(tIn(null)), t1 = wireTargetsOf(tIn({ 'breece-hall': { a: 60000, d: 1000 } }));
ok('momentum: a point apart, the trending back overtakes the flat one', t0[0]?.add === 'kyren-williams' && t1[0]?.add === 'breece-hall' && t1[0]?.netAdds === 59000, [t0[0], t1[0]]);
ok('momentum: no trend, no tag', t0[0]?.netAdds == null);
ok('momentum: the tag reads in words', trendLabel(59000) === '59k adds' && trendLabel(1234) === '1.2k adds' && trendLabel(-800) === '800 drops' && trendLabel(null) === null && trendLabel(0) === null);
// DYNASTY (v0.717.0): win now, rebuild, and never a dynasty loss.
const me3 = (bench) => [{ slug: 'bijan-robinson', full: 'Bijan Robinson', pos: 'RB', team: null }, { slug: 'jonathan-taylor', full: 'Jonathan Taylor', pos: 'RB', team: null }, bench];
const dIn = (bench, pool, dyn) => wireIn({ roster: me3(bench), pool, rosters: me3(bench).map((p) => ({ roster_id: 3, slug: p.slug, acquired: 'draft' })), activeSeats: 3, dyn });
const stash = { slug: 'young-stash', full: 'Young Stash', pos: 'RB', team: null };
const d0 = wireTargetsOf(dIn(stash, [prow('derrick-henry', 'Derrick Henry')], null));
const d1 = wireTargetsOf(dIn(stash, [prow('derrick-henry', 'Derrick Henry')], { 'young-stash': 7000, 'derrick-henry': 1500 }));
ok('dynasty: redraft-style, a zero-projection bench body goes for a real back', d0.some((t) => t.drop === 'young-stash'), d0);
ok('dynasty: no suggestion drops a player worth more on the dynasty market', !d1.some((t) => t.drop === 'young-stash'), d1);
const henry = { slug: 'derrick-henry', full: 'Derrick Henry', pos: 'RB', team: null };
const d2 = wireTargetsOf(dIn(henry, [prow('young-a', 'Young A'), prow('young-b', 'Young B')], { 'derrick-henry': 1500, 'young-a': 5000, 'young-b': 1600, 'bijan-robinson': 11000, 'jonathan-taylor': 6100 }));
const reb = d2.filter((t) => t.lens === 'rebuild');
ok('rebuild: the best dynasty asset for the bench body worth least, never a starter', reb[0]?.add === 'young-a' && reb[0]?.drop === 'derrick-henry' && reb[0]?.dynGain === 3500, d2);
ok('rebuild: a move under the market\'s noise is no move', !reb.some((t) => t.add === 'young-b'), reb);
ok('win now: still never drops the season\'s better player for a stash', !d2.some((t) => (t.lens ?? 'now') === 'now' && t.drop === 'derrick-henry' && t.add === 'young-a'), d2);
const groups = wireLensGroups(d2);
ok('lenses: a dynasty league groups WIN NOW before REBUILD; a redraft one has no header', groups.map((g) => g.lens).join() === (d2.some((t) => t.lens === 'now') ? 'now,rebuild' : 'rebuild') && wireLensGroups(w1)[0].lens === null, groups.map((g) => g.lens));
ok('lenses: a rebuild row reads in dynasty value', wireTargetLine(reb[0]).startsWith('DYN 5.0k · drop Derrick Henry') && wireTargetBadge(reb[0]) === '+3.5k DYN', [wireTargetLine(reb[0]), wireTargetBadge(reb[0])]);
const ws = (id, name, gain) => ({ leagueId: id, rosterId: 1, leagueName: name, weekLabel: 'WK 7', wire: gain == null ? [] : [{ add: 'x', addName: 'X', pos: 'RB', team: null, drop: null, dropName: null, gain, rosGain: 0, kind: 'hole', claim: false }] });
const wt = wireTargets([ws('a', 'Alpha', 2), ws('b', 'Beta', 9), ws('c', 'Gamma', null), null]);
ok('wire: leagues with targets only, biggest gain first; the count is every target', wt.map((l) => l.leagueId).join() === 'b,a' && wireTargetCount([ws('a', 'A', 2), ws('b', 'B', 1)]) === 2, wt.map((l) => l.leagueId));
const feed = read('packages/core/src/data/widgetFeed.ts');
ok('momentum: the glance hands the market\'s trend to the planner', feed.includes('trend: m?.trend ?? null') && feed.includes('trend: wireMkt.trend'));
ok('dynasty: the glance reads the market\'s dyn for a dynasty league only', feed.includes('dyn: league.dynasty ? m?.dyn ?? null : null') && feed.includes('isDynastyContinuity(e.league?.continuity)'));
ok('wire: the glance plans it only when asked, never for a weekly contest', feed.includes('const wantWire = !!opts.wire && classic') && feed.includes("league.kind !== 'dfs' && league.kind !== 'bullseye'"));

// ── both clients draw the bar ─────────────────────────────────────────────
const phone = read('apps/mobile/src/screens/Leagues.tsx'), web = read('src/screens/LiveOnboard.tsx');
const pbar = read('apps/mobile/src/ui/LeagueToolsBar.tsx'), wbar = read('src/screens/LeagueToolsBar.tsx');
ok('both: the leagues list asks the glance for waiver targets', phone.includes('rosterId: l.rosterId, wire: true }') && web.includes('rosterId: l.rosterId, wire: true }'));
ok('phone: the leagues page carries the bar, not the lone H&V card', phone.includes('<LeagueToolsBar snaps={Object.values(glance)}') && !phone.includes('<HeroesVillains'));
ok('web: the leagues page carries the bar, not the lone H&V card', web.includes('<LeagueToolsBar snaps={Object.values(glance)} onFields={onFields}') && !web.includes('<HeroesVillains'));
for (const [n, src] of [['phone', pbar], ['web', wbar]]) {
  ok(`${n}: fields, preview, lineup, waiver targets, trade zone and options on the bar — no emojis`, src.includes('ALL FIELDS') && src.includes('PREVIEW') && src.includes('`LINEUP${') && src.includes('`WAIVER TARGETS${') && src.includes('`TRADE ZONE${') && src.includes('`OPTIONS${') && !/[▦⚔🧭📈🔁]/u.test(src));
  ok(`${n}: each tool reads only the leagues OPTIONS leaves it`, src.includes("forTool(off, 'preview', snaps)") || src.includes("snapsFor('preview')"));
  ok(`${n}: a waiver target row is worded by core, grouped by lens`, src.includes('wireTargetTag(w)') && src.includes('wireTargetBadge(w)') && src.includes('wireLensGroups(l.targets)'));
  ok(`${n}: the preview opens on the leagues its options leave it`, src.includes('<HeroesVillains snaps={previewSnaps} />'));
}
ok('phone: the bar scrolls sideways', pbar.includes('<ScrollView horizontal'));
ok('web: the bar scrolls sideways, never wraps', wbar.includes("flexWrap: 'nowrap', overflowX: 'auto'"));

// ── the preview (v0.718.0) ───────────────────────────────────────────────
const P = (slug, count, proj) => ({ slug, name: slug, count, proj, heroIn: [], villainIn: [] });
const kg = { key: 'A@B', heroes: [P('h1', 3, 10), P('h2', 2, 9), P('h3', 1, 8)], villains: [P('v1', 2, 7), P('v2', 1, 6), P('v3', 1, 5), P('v4', 1, 4)] };
const gf = gameFaces(kg);
ok('preview: a quad game shows the first two a side, the rest counted', gf.mine.map((p) => p.slug).join() === 'h1,h2' && gf.theirs.map((p) => p.slug).join() === 'v1,v2' && gf.more === 3, gf);
ok('preview: a key game reads as counts', gameCounts(kg) === '3 yours · 4 theirs' && gameCounts({ heroes: [], villains: [] }) === 'nobody of yours');
// ── suggested trades (v0.720.0) ──────────────────────────────────────────
{
  const SL = [{ slot: 'R1', type: 'RB', pos: ['RB'] }, { slot: 'R2', type: 'RB', pos: ['RB'] }, { slot: 'W1', type: 'WR', pos: ['WR'] }, { slot: 'W2', type: 'WR', pos: ['WR'] }];
  const pl = (id, pos) => ({ id, pos });
  const rosters = new Map([
    [1, [pl('jahmyr-gibbs', 'RB'), pl('bijan-robinson', 'RB'), pl('jonathan-taylor', 'RB'), pl('nico-collins', 'WR'), pl('drake-london', 'WR')]],
    [2, [pl('jerome-ford', 'RB'), pl('tyjae-spears', 'RB'), pl('jamarr-chase', 'WR'), pl('jaxon-smith-njigba', 'WR'), pl('justin-jefferson', 'WR')]],
    [3, [pl('rico-dowdle', 'RB'), pl('breece-hall', 'RB'), pl('ceedee-lamb', 'WR'), pl('puka-nacua', 'WR')]],
  ]);
  const v = (p) => PROJ_2026.get(p.id) ?? 0;
  const base = { slots: SL, rosters, me: 1, valueOf: v, names: (s) => s, teamName: (r) => `T${r}` };
  const st = positionStrength(SL, rosters, v);
  ok('trades: strength ranks each team by position', st.get(1).RB.rank === 1 && st.get(1).WR.rank === 3 && st.get(2).RB.rank === 3 && st.get(2).WR.rank === 1, [...st.entries()]);
  const fit = tradeIdeasOf(base);
  const f2 = fit.find((t) => t.partner === 2);
  ok('trades: strong RBs and weak WRs meet weak RBs and strong WRs — your spare back for their receiver', f2?.kind === 'fit' && f2.give[0].pos === 'RB' && f2.get[0].pos === 'WR' && f2.give[0].slug === 'bijan-robinson', fit);
  ok('trades: fair by construction — both lineups get better', fit.every((t) => t.myGain >= 1 && t.theirGain >= 0.5), fit.map((t) => [t.myGain, t.theirGain]));
  ok('trades: never a fleece — what you get projects within the fair band of what you give', fit.every((t) => v({ id: t.get[0].slug }) <= v({ id: t.give[0].slug }) * 1.25 + 1), fit);
  const dynFit = tradeIdeasOf({ ...base, dyn: { 'bijan-robinson': 11033, 'jamarr-chase': 2000, 'jaxon-smith-njigba': 2100, 'justin-jefferson': 2200 } });
  ok('trades: in dynasty a lineup fix never bleeds long-term value (bijan for a far cheaper WR is out)', !dynFit.some((t) => t.give[0].slug === 'bijan-robinson'), dynFit);
  ok('trades: no fit with a team strong where you are', !fit.some((t) => t.kind === 'fit' && t.partner === 3 && t.get[0].pos === 'RB'));
  ok('trades: a redraft league suggests no dynasty moves', !fit.some((t) => t.kind !== 'fit'));
  const standings = [{ roster_id: 1, wins: 1, losses: 5, pf: 500 }, { roster_id: 2, wins: 5, losses: 1, pf: 700 }, { roster_id: 3, wins: 3, losses: 3, pf: 600 }];
  ok('trades: contenders are the top half of the table', [...contenders(standings)].sort().join() === '2,3');
  const dyn = { 'jonathan-taylor': 6139, 'justin-jefferson': 6884, 'jahmyr-gibbs': 11106, 'bijan-robinson': 11033 };
  const reb = tradeIdeasOf({ ...base, standings, dyn, max: 6 }).filter((t) => t.kind === 'rebuild');
  ok('trades: out of the race in dynasty — a starter to a contender for future value he isn\'t starting', reb.some((t) => t.partner === 2 && t.get[0].slug === 'justin-jefferson' && t.dynGain >= 250 && t.theirGain >= 1), reb);
  ok('trades: never rebuild with a team that is also out of it', reb.every((t) => contenders(standings).has(t.partner)));
  const buy = tradeIdeasOf({ ...base, me: 2, standings: [{ roster_id: 1, wins: 1, losses: 5, pf: 500 }, { roster_id: 2, wins: 5, losses: 1, pf: 700 }, { roster_id: 3, wins: 4, losses: 2, pf: 600 }], dyn: { 'justin-jefferson': 6884, 'jonathan-taylor': 6139 }, max: 6 }).filter((t) => t.kind === 'buy');
  ok('trades: in the race — buy a starter from a team that is out of it with future value you are not starting', buy.some((t) => t.partner === 1 && t.give[0].slug === 'justin-jefferson' && t.myGain >= 1), buy);
  ok('trades: no rosters, no ideas', tradeIdeasOf({ ...base, me: 9 }).length === 0);
}
const feedSrc = read('packages/core/src/data/widgetFeed.ts');
ok('trades: the glance suggests them with the waiver targets, valued for the season', feedSrc.includes('snapshot.tradeIdeas = tradeIdeasOf(') && feedSrc.includes("tags[p.id] === 'IR' ? 0 : projectedPoints"));
for (const [n, path] of [['phone', 'apps/mobile/src/ui/LeagueToolsBar.tsx'], ['web', 'src/screens/LeagueToolsBar.tsx']]) {
  const src = read(path);
  ok(`${n}: the trade zone lists SUGGESTED trades from the leagues its options leave it`, src.includes('SUGGESTED') && src.includes('tradeIdeaLeagues(') && src.includes("'trades'"));
}
// ── tool options (v0.718.0) ──────────────────────────────────────────────
let tl = toggleToolLeague({}, 'wire', 'L1');
ok('options: a league switched off leaves only that tool', !toolHas(tl, 'wire', 'L1') && toolHas(tl, 'lineup', 'L1') && toolHas(tl, 'wire', 'L2'));
ok('options: a tool reads only its leagues', forTool(tl, 'wire', [{ leagueId: 'L1' }, { leagueId: 'L2' }]).map((x) => x.leagueId).join() === 'L2');
tl = toggleToolLeague(tl, 'wire', 'L1');
ok('options: switched back on', toolHas(tl, 'wire', 'L1'));
ok('options: the count is what is off in leagues you are in', toolLeaguesOffCount({ wire: ['L1', 'gone'], trades: ['L1'] }, ['L1']) === 2);
ok('options: a stored value that is junk reads as nothing off', JSON.stringify(parseToolLeagues('nope')) === '{}' && JSON.stringify(parseToolLeagues('{"wire":["a",3],"x":["b"]}')) === '{"wire":["a"]}');
for (const [n, path] of [['phone', 'apps/mobile/src/ui/HeroesVillains.tsx'], ['web', 'src/screens/HeroesVillains.tsx']]) {
  const src = read(path);
  ok(`${n} preview: faces on every player row`, src.includes('p.image') && src.includes('face(p, side)'));
  ok(`${n} preview: key games as counts, players on a tap`, src.includes('yours`') && src.includes('theirs`') && src.includes('{open && all(g)}'));
  ok(`${n} preview: the quad box shows two a side (gameFaces), all on a tap`, src.includes('gameFaces(g)') && src.includes('open ? all(g)'));
  ok(`${n} preview: one tab row that never wraps, the explanations in its ⓘ`, src.includes('PREVIEW_INFO') && !src.includes("flexWrap: 'wrap'") && !src.includes('Ranked by how many'));
  ok(`${n} preview: no summary line above the tabs`, !src.includes('summary'));
}
ok('options: a native league feeds all four tools; a contest or imported one, preview and lineup', toolsForLeague({ native: true, contest: false }).join() === 'preview,lineup,wire,trades' && toolsForLeague({ native: true, contest: true }).join() === 'preview,lineup' && toolsForLeague({ native: false, contest: false }).join() === 'preview,lineup');
for (const [n, path] of [['phone', 'apps/mobile/src/ui/LeagueToolsBar.tsx'], ['web', 'src/screens/LeagueToolsBar.tsx']]) {
  const src = read(path);
  ok(`${n}: options list each league, then a checkbox per tool`, src.includes('leagues.map((l) =>') && src.includes('toolsForLeague(l).map((tool)') && (src.includes('accessibilityRole="checkbox"') || src.includes('type="checkbox"')));
}
for (const [n, path] of [['phone', 'apps/mobile/src/ui/LeagueToolsBar.tsx'], ['web', 'src/screens/LeagueToolsBar.tsx']]) {
  const src = read(path);
  ok(`${n}: waiver targets and suggested trades list each league with its avatar and a count, details with faces on a tap`,
    src.includes("leagueRow(k, leagueOf(l.leagueId)?.avatar") || src.includes('leagueRow(k, lg?.avatar'));
  ok(`${n}: faces on the targets, their drops and both sides of a trade`, /Face image=\{w\.addImage\}/.test(src) && /Face image=\{w\.dropImage\}/.test(src) && /Face image=\{p\.image\}/.test(src));
}
ok('waiver targets: no emojis in the labels', !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(Object.values(WIRE_LENS_LABEL).join('') + trendLabel(5000) + trendLabel(-5000) + wireTargetTag({ kind: 'hole', lens: 'now', netAdds: 3000, dropName: null, claim: true })));
ok('waiver targets: the tag leaves the drop to the row (drawn with his face)', wireTargetTag({ kind: 'upgrade', lens: 'now', netAdds: null, dropName: 'X', claim: false }) === 'UPGRADE' && wireTargetTag({ kind: 'hole', lens: 'now', netAdds: null, dropName: null, claim: true }) === 'FILLS A HOLE · open spot · claim');
ok('faces: the glance hands headshots to the targets and the trades', feedSrc.includes('imageOf = (slug: string) => headshot(slug) ?? espnHeadshot(') && (feedSrc.match(/ imageOf,/g) ?? []).length >= 2);
// ── v0.723.0: the preview's list, and injury status everywhere ──
{
  const SP = (slug, count, proj) => ({ slug, name: slug, count, proj, pts: null, heroIn: [], villainIn: [] });
  const many = [SP('a', 3, 5), SP('b', 2, 9), SP('c', 2, 1), SP('d', 2, 4), SP('e', 2, 3), SP('f', 2, 2), SP('g', 1, 30)];
  ok('preview: everyone at 2x or more when there are five or more — no 1x', previewList(many).map((p) => p.slug).join() === 'a,b,c,d,e,f');
  const few = [SP('a', 3, 5), SP('b', 2, 9), SP('x', 1, 4), SP('y', 1, 20), SP('z', 1, 12), SP('w', 1, 1)];
  ok('preview: under five, topped up with the highest-projected 1x', previewList(few).map((p) => p.slug).join() === 'a,b,y,z,x', previewList(few).map((p) => p.slug));
  ok('preview: only 1x — the five projected highest', previewList([SP('p', 1, 1), SP('q', 1, 8), SP('r', 1, 3), SP('s', 1, 9), SP('t', 1, 2), SP('u', 1, 7)]).map((p) => p.slug).join() === 's,q,u,r,t');
  ok('injury: a designation prints, a healthy player prints nothing', injuryTag('q') === 'Q' && injuryTag('IR') === 'IR' && injuryTag(null) === null && injuryTag('') === null && injuryTag('Active') === null);
  const wi = wireTargetsOf(wireIn({ injuries: { 'jonathan-taylor': 'Q' } }));
  ok('injury: waiver targets carry the add\'s designation', wi.find((t) => t.add === 'jonathan-taylor')?.addInjury === 'Q' && wi.every((t) => 'addInjury' in t), wi);
  for (const [n, path] of [['phone', 'apps/mobile/src/ui/LeagueToolsBar.tsx'], ['web', 'src/screens/LeagueToolsBar.tsx']]) {
    const src = read(path);
    ok(`${n}: injury status beside every player the tools name (targets, their drops, both sides of a trade)`, src.includes('inj(w.addInjury)') && src.includes('inj(w.dropInjury)') && src.includes('inj(p.injury)'));
  }
  for (const [n, path] of [['phone', 'apps/mobile/src/ui/HeroesVillains.tsx'], ['web', 'src/screens/HeroesVillains.tsx']]) {
    const src = read(path);
    ok(`${n} preview: heroes and villains via previewList, with injury status`, src.includes('previewList(hv.heroes)') && src.includes('previewList(hv.villains)') && src.includes('inj(p.injury)') && !src.includes('slice(0, 40)'));
  }
  ok('injury: the glance hands designations to the sides and the trades', feedSrc.includes("injury: injuries?.[p.slug] ?? null") && feedSrc.includes('injuryOf: (slug) => tags[slug] ?? null'));
}
{
  const app = read('apps/mobile/App.tsx');
  const pin = app.indexOf('THE PINNED "my leagues" CHIP'), fold = app.indexOf('THE FOLDING TOP (v0.356.0)');
  ok('phone: "my leagues" is pinned outside the folding header, for anyone signed in, everywhere', pin > 0 && pin < fold && app.includes("{!!session && chipBox && (") && app.includes("position: 'absolute', zIndex: 5, left: chipBox.x") && !app.includes("{open && (\n            <Pressable\n              // Resets the view too"));
  ok('phone: on the list itself it re-reads your leagues; anywhere else it goes home', app.includes("if (!open && view === 'picks') setLeaguesEpoch((n) => n + 1); setOpen(null); setView('picks');"));
}
ok('phone: the header has no fields button (ALL FIELDS is on the bar)', !read('apps/mobile/App.tsx').includes('>▦ fields</Text>'));
const lo = read('src/screens/LiveOnboard.tsx');
ok('web: the leagues header has no fields chip (the bar has ALL FIELDS)', !lo.includes('▦ fields</button>'));

if (fails) { console.log(`\n${fails} LEAGUE-TOOLS ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL LEAGUE-TOOLS ASSERTIONS PASSED');
