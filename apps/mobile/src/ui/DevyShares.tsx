// DEVY SHARES (0387) AND THE MARKET (0388) — the app's sheet.
//
// Every team starts with 100 points to buy shares in college players, at most
// 20 shares in one. A share's price follows how the player is playing (his
// college rank, +1 for a young riser) and how much of the league wants him.
// Buying locks in what you paid; selling, or his turning pro, pays today's
// price (up to 3× what you paid). The first team to 20 shares holds his right
// — failing that, the only team in does, with 5+ — and the right reserves him
// in the rookie draft, at any of the holder's picks.
import { useEffect, useMemo, useState, useRef } from 'react';
import { Alert, ScrollView, Text, TextInput, View, Pressable } from 'react-native';
import { allotDevyShares, devyMarket, devySharesState, devyLaunchState, placeDevyLaunchOrder, friendlyError, type DevyLaunchState, type DevyLaunchPlayer, type DevyMarketRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeClassLabel } from '@drip/core/data/college';
import { openPlayerCard } from './PlayerCardSheet';
import { teamBook, myStake, rightLine, lockLine, stakeLine, fmtPts, maxBuy, devyRulesText, DEEP_SEARCH_MIN, MARKET_PAGE, MARKET_FIRST_FETCH, marketNext, marketFooter, marketLines, shapeMarket, nextSort, marketSubline, MARKET_FILTERS, launchBanner, launchOrderMax, launchRulesText, tradePreview, type MarketLine, type MarketSort, type MarketFilter } from '@drip/core/data/devyShares';
import { InfoChip } from './InfoChip';
import { useTheme, MONO } from '../theme.native';
import { onNearEnd, isNearEnd } from './scrollChrome';
import { Overlay } from './Overlay';
import { Chip, Mono, PosPill, PrimaryButton } from './prims';
import { tap, commit, warn } from './feedback';

type View3 = 'mine' | 'league' | 'add' | 'trade';

/** The devy market as a sheet (opened from a roster row). */
export function DevySharesSheet(p: { visible: boolean; leagueId: string; myRoster: number | null; onClose: () => void }) {
  return <DevyMarketView {...p} />;
}

/** The devy market inline — My Team's DEVY tab (v0.575.0, founder: "Let's
 *  make it more prominent. Let's make it one of the top tabs on the my team
 *  page."). The same market, laid into the page instead of a sheet. */
export function DevyMarketTab({ leagueId, myRoster }: { leagueId: string; myRoster: number | null }) {
  return <DevyMarketView visible inline leagueId={leagueId} myRoster={myRoster} />;
}

function DevyMarketView({ visible, leagueId, myRoster, onClose, inline }: {
  visible: boolean; leagueId: string; myRoster: number | null; onClose?: () => void; inline?: boolean;
}) {
  const t = useTheme();
  const [st, setSt] = useState<DevySharesState | null>(null);
  // v0.577.0: the DEVY tab opens on the market.
  const [view, setView] = useState<View3>('add');
  const [filter, setFilter] = useState<MarketFilter>('ALL');
  const [sort, setSort] = useState<{ key: MarketSort; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' });
  const [openOwners, setOpenOwners] = useState<string | null>(null);
  // v0.579.0: the purchase sheet — which player, buy or sell, how many.
  const [trade, setTrade] = useState<{ slug: string; mode: 'buy' | 'sell'; n: number } | null>(null);
  const [market, setMarket] = useState<DevyMarketRow[] | null>(null);
  // v0.605.0: lazy loading — rows showing, and how many the market fetch asks for.
  const [shown, setShown] = useState(MARKET_PAGE);
  const [limit, setLimit] = useState(MARKET_FIRST_FETCH);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 0407: new-player launches — the banner, sealed orders, the preview.
  const [ls, setLs] = useState<DevyLaunchState | null>(null);
  const [launchView, setLaunchView] = useState(false);
  const load = () => Promise.all([
    devySharesState(leagueId).then(setSt).catch(() => {}),
    devyLaunchState(leagueId, myRoster).then(setLs).catch(() => {}),
  ]);
  useEffect(() => { if (visible) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [visible, leagueId]);
  useEffect(() => {
    if (visible && view === 'add') devyMarket(leagueId, limit).then((r) => setMarket(Array.isArray(r) ? r : [])).catch(() => setMarket([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, view, leagueId, st, limit]);
  // 0404: past two letters the search covers every college player, deep ones
  // included — debounced so typing doesn't fire a query per keystroke.
  const [deep, setDeep] = useState<DevyMarketRow[] | null>(null);
  useEffect(() => {
    const needle = q.trim();
    if (!visible || view !== 'add' || needle.length < DEEP_SEARCH_MIN) { setDeep(null); return; }
    let live = true;
    const h = setTimeout(() => {
      devyMarket(leagueId, 60, needle).then((r) => { if (live) setDeep(Array.isArray(r) ? r : []); }).catch(() => { if (live) setDeep([]); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [q, visible, view, leagueId]);

  const rules = { budget: 100, max: 20, floor: 5, cash_cap: 200, payout_cap: 3, max_spend: 60, min_spend: 15, refund: 0.5, ...(st?.rules ?? {}) };
  const book = teamBook(st, myRoster);
  const mine = (st?.players ?? []).filter((p) => myStake(p, myRoster) > 0);
  // 0396: last season's league row is read-only; the lock and the freeze say so.
  const locked = !!st?.locked || st?.current === false;

  /** True when it went through — the purchase sheet closes only then. */
  const set = async (slug: string, n: number): Promise<boolean> => {
    if (myRoster == null || busy) return false;
    setBusy(true); setMsg(null);
    try {
      const r = await allotDevyShares(leagueId, myRoster, slug, Math.max(0, Math.min(rules.max, n)));
      if (!r.ok) { warn(); setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`); return false; }
      commit();
      if (r.spent) setMsg(`✓ bought at ${fmtPts(Number(r.price))} a share: −${fmtPts(Number(r.spent))}`);
      else if (r.received) setMsg(`✓ sold at ${fmtPts(Number(r.price))} a share: +${fmtPts(Number(r.received))}`);
      await load();
      return true;
    } catch (e) { warn(); setMsg(`✗ ${friendlyError(e instanceof Error ? e.message : String(e))}`); return false; }
    finally { setBusy(false); }
  };

  /** Buy/sell chips; a buy chip shows what it costs at today's price. A stake
   *  maxes at 20 shares or 60 points spent (0396), so TO MAX may be fewer than 20. */
  const stakeControls = (slug: string, cur: number, price: number, cost: number, maxed: boolean, active: boolean) => {
    const room = maxBuy(cur, cost, price, rules.max, rules.max_spend);
    const buy = (k: number) => Math.min(k, room);
    const afford = (k: number) => active && buy(k) > 0 && buy(k) * price <= book.cash + 1e-9;
    const pts = (k: number) => fmtPts(Math.round(buy(k) * price * 100) / 100);
    const sell = (to: number) => {
      if (maxed && to < cur) {
        Alert.alert('Give up your place?', 'This stake is maxed. Selling any of it drops you out of line for his right, and buying back puts you behind anyone else who is maxed.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sell', style: 'destructive', onPress: () => void set(slug, to) },
        ]);
      } else void set(slug, to);
    };
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {cur > 0 && <Chip label="SELL 5" disabled={busy || locked} onPress={() => { tap(); sell(Math.max(0, cur - 5)); }} />}
        {cur > 0 && <Chip label="SELL 1" disabled={busy || locked} onPress={() => { tap(); sell(cur - 1); }} />}
        {active && room > 0 && <Chip label={`+1 · ${pts(1)}`} disabled={busy || locked || !afford(1)} onPress={() => { tap(); void set(slug, cur + 1); }} />}
        {active && room > 1 && <Chip label={`+${buy(5)} · ${pts(5)}`} disabled={busy || locked || !afford(5)} onPress={() => { tap(); void set(slug, cur + buy(5)); }} />}
        {active && room > 0 && <Chip label={`MAX +${room} · ${pts(room)}`} on disabled={busy || locked || !afford(room)} onPress={() => { tap(); void set(slug, cur + room); }} />}
        {maxed && <Mono size={9} tone="you" style={{ alignSelf: 'center' }}>MAXED</Mono>}
        {cur > 0 && <Chip label="SELL ALL" dim disabled={busy || locked} onPress={() => { tap(); sell(0); }} />}
      </View>
    );
  };

  const playerRow = (p: DevySharePlayer, controls: boolean) => {
    const cur = myStake(p, myRoster);
    const mineH = p.holders.find((h) => h.roster_id === myRoster);
    const yours = p.right?.roster_id === myRoster && myRoster != null;
    const price = p.price ?? 1;
    return (
      <View key={p.slug} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.bd }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!!p.pos && <PosPill pos={p.pos} />}
          <Pressable hitSlop={6} style={{ flex: 1 }} onPress={() => { tap(); openPlayerCard({ slug: p.slug, name: p.name ?? p.slug, pos: p.pos ?? '', team: p.school ?? '', leagueId }); }}>
            <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: t.text }}>{p.name ?? p.slug} <Text style={{ fontSize: 11, color: t.faint }}>ⓘ</Text></Text>
          </Pressable>
          <Mono size={11} weight="700" tone="you">{fmtPts(price)}/sh</Mono>
        </View>
        <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
          {[p.school, p.class_year ? collegeClassLabel(p.class_year) : null, p.rank ? `#${p.rank} in college` : 'unranked', p.graduated_to ? 'TURNED PRO' : null].filter(Boolean).join(' · ')}
        </Mono>
        {mineH && <Mono size={10} weight="700" tone={Number(mineH.value) >= Number(mineH.cost) ? 'you' : 'opp'} style={{ marginTop: 3 }}>
          {`YOU: ${cur} shares · ${stakeLine(mineH.cost, mineH.value)}`}
        </Mono>}
        <Mono size={9.5} tone={yours ? 'you' : 'dim'} style={{ marginTop: 3 }}>{rightLine(p, myRoster, rules.floor, rules.max, rules.min_spend)}</Mono>
        <Mono size={9} tone="faint" style={{ marginTop: 2 }}>{p.holders.map((h) => `${h.team} ${h.shares}`).join(' · ')}</Mono>
        {p.active === false && !p.graduated_to && <Mono size={9} tone="warn" style={{ marginTop: 3 }}>
          {`LEFT COLLEGE — sell at his last price, or if he isn't drafted, ${Math.round(rules.refund * 100)}% of what was paid comes back at the rookie draft`}
        </Mono>}
        {controls && myRoster != null && !p.graduated_to && stakeControls(p.slug, cur, price, Number(mineH?.cost ?? 0), !!mineH?.maxed, p.active !== false)}
      </View>
    );
  };

  /** INVEST (v0.576.0 → v0.579.0, founder: "Instead of the own chip and the
   *  +1 +5 chips, let's have your share, an in row owners chip, and a buy
   *  chip that pops up a purchase interaction"). One row a player: name over
   *  school · class · rank, price, the TO MAX bar, YOUR shares, an owners
   *  chip (who holds him, in a pop-up), and BUY, which opens the purchase
   *  sheet — how many, what it costs, where it leaves the stake. */
  const W = { price: 40, bar: 46, you: 26, own: 34, buy: 44 };
  const investRow = (l: MarketLine) => {
    const r = l.row;
    const cur = l.mine;
    const price = l.price;
    return (
      <View key={r.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: t.bd, paddingVertical: 6 }}>
        <PosPill pos={r.pos} />
        <Pressable hitSlop={6} style={{ flex: 1, minWidth: 0 }} onPress={() => { tap(); openPlayerCard({ slug: r.slug, name: r.name, pos: r.pos, team: r.school ?? '', leagueId }); }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>
            {l.right?.mine ? '★ ' : ''}{r.name} <Text style={{ fontSize: 10, fontWeight: '400', color: t.faint }}>ⓘ</Text>
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9, color: t.faint, marginTop: 1 }}>{marketSubline(r)}</Text>
        </Pressable>
        <Text style={{ width: W.price, textAlign: 'right', fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: t.text }}>{fmtPts(price)}</Text>
        <View style={{ width: W.bar, gap: 2 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.bd, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(l.lead * 100)}%`, backgroundColor: l.leadMine ? t.you : l.right ? t.opp : t.dim }} />
            {!l.leadMine && l.myProgress > 0 && (
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(l.myProgress * 100)}%`, backgroundColor: t.you }} />
            )}
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, color: l.lead >= 1 ? (l.leadMine ? t.you : t.opp) : t.faint, textAlign: 'center' }}>
            {l.lead >= 1 ? 'OWNED' : `${Math.round(l.lead * 100)}%`}
          </Text>
        </View>
        <Text style={{ width: W.you, textAlign: 'center', fontFamily: MONO, fontSize: 11, fontWeight: '700', color: cur ? t.you : t.faint }}>{cur || '—'}</Text>
        <Pressable disabled={l.owners.length === 0} hitSlop={4} onPress={() => { tap(); setOpenOwners(r.slug); }}
          style={{ width: W.own, alignItems: 'center', borderWidth: 1, borderColor: l.owners.length ? t.bd : 'transparent', borderRadius: 10, paddingVertical: 3 }}>
          <Mono size={9.5} weight="700" tone={l.owners.length ? 'dim' : 'faint'}>{l.owners.length ? `👥${l.owners.length}` : '—'}</Mono>
        </Pressable>
        {myRoster != null ? (
          <Pressable hitSlop={4} disabled={locked} onPress={() => { tap(); setTrade({ slug: r.slug, mode: 'buy', n: 1 }); }}
            style={{ width: W.buy, alignItems: 'center', borderWidth: 1, borderColor: t.you, backgroundColor: locked ? 'transparent' : t.you, borderRadius: 6, paddingVertical: 5, opacity: locked ? 0.4 : 1 }}>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '800', color: locked ? t.you : t.bg }}>BUY</Text>
          </Pressable>
        ) : <View style={{ width: W.buy }} />}
      </View>
    );
  };

  const addList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const listed = new Set([...(ls?.open?.players ?? []), ...(ls?.pending ?? [])].map((x) => x.slug));
    const rows = (deep ?? (market ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.school ?? '').toLowerCase().includes(needle)))
      .filter((r) => !listed.has(r.slug));
    return shapeMarket(marketLines(rows, st, myRoster), filter, sort.key, sort.dir);
  }, [market, q, deep, st, myRoster, filter, sort, ls]);
  // A new filter, sort or search starts back at the first page.
  useEffect(() => { setShown(MARKET_PAGE); }, [filter, sort, q]);
  const fetched = deep ? 0 : (market?.length ?? 0);
  const more = () => {
    if (view !== 'add' || launchView) return;
    const n = marketNext(shown, addList.length, fetched, deep ? Infinity : limit);
    if (n.shown !== shown) setShown(n.shown);
    if (n.fetch) setLimit(n.fetch);
  };
  const moreRef = useRef(more);
  moreRef.current = more;
  // Inline (My Team's DEVY tab), the page's own ScrollView reports the end.
  useEffect(() => (inline && visible ? onNearEnd(() => moreRef.current()) : undefined), [inline, visible]);

  const order = async (slug: string, n: number) => {
    if (myRoster == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await placeDevyLaunchOrder(leagueId, myRoster, slug, n);
      if (!r.ok) { warn(); setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`); return; }
      commit();
      setMsg(n === 0 ? '✓ order cancelled' : `✓ sealed order: ${n} share${n === 1 ? '' : 's'} · ${fmtPts(Number(r.committed ?? 0))} committed this launch`);
      setLs(await devyLaunchState(leagueId, myRoster));
    } catch (e) { warn(); setMsg(`✗ ${friendlyError(e instanceof Error ? e.message : String(e))}`); }
    finally { setBusy(false); }
  };
  const banner = launchBanner(ls);
  const launchPlayers = (ls?.open?.players ?? ls?.pending ?? []).filter((x) =>
    (filter === 'ALL' || filter === 'OPEN' || x.pos === filter)
    && (!q.trim() || x.name.toLowerCase().includes(q.trim().toLowerCase()) || (x.school ?? '').toLowerCase().includes(q.trim().toLowerCase())));
  const myOrders = (ls?.open?.players ?? []).filter((x) => (x.my_order ?? 0) > 0);
  const launchRow = (x: DevyLaunchPlayer) => {
    const open = !!ls?.open;
    const price = Number(x.price ?? 0);
    const mx = launchOrderMax(price, ls?.cfg);
    const cur = x.my_order ?? 0;
    const step = (label: string, to: number, on = false) => (
      <Pressable key={label} disabled={busy || to === cur || to < 0 || to > mx} hitSlop={4} onPress={() => { tap(); void order(x.slug, to); }}
        style={{ borderWidth: 1, borderColor: on ? t.you : t.bd, backgroundColor: on ? t.you : 'transparent', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4,
          opacity: busy || to === cur || to < 0 || to > mx ? 0.4 : 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: on ? t.bg : t.you }}>{label}</Text>
      </Pressable>
    );
    return (
      <View key={x.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.bd }}>
        <PosPill pos={x.pos} />
        <Pressable hitSlop={6} style={{ flex: 1, minWidth: 0 }} onPress={() => { tap(); openPlayerCard({ slug: x.slug, name: x.name, pos: x.pos, team: x.school ?? '', leagueId }); }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{x.name} <Text style={{ fontSize: 10, fontWeight: '400', color: t.faint }}>ⓘ</Text></Text>
          <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9, color: t.faint, marginTop: 1 }}>
            {[x.school, x.fcs ? 'FCS' : null, x.class_year ? collegeClassLabel(x.class_year) : null, x.sh_rank ? `devy #${x.sh_rank}` : null].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
        {open ? (<>
          <Text style={{ width: 40, textAlign: 'right', fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: t.text }}>{fmtPts(price)}</Text>
          {myRoster != null && (<>
            {step('−', cur - 1)}
            <Text style={{ width: 20, textAlign: 'center', fontFamily: MONO, fontSize: 11, fontWeight: '700', color: cur ? t.you : t.faint }}>{cur}</Text>
            {step('+', cur + 1)}
            {step('MAX', mx, cur === mx && mx > 0)}
          </>)}
        </>) : <Mono size={9} tone="faint">lists soon</Mono>}
      </View>
    );
  };
  const head = (label: string, key: MarketSort | null, width?: number, align: 'left' | 'center' | 'right' = 'center') => {
    const on = key != null && sort.key === key;
    return (
      <Pressable key={label} disabled={key == null} onPress={() => { if (key) { tap(); setSort((c) => nextSort(c, key)); } }}
        style={width ? { width } : { flex: 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.6, color: on ? t.you : t.faint, textAlign: align }}>
          {label}{on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
        </Text>
      </Pressable>
    );
  };

  const subtitle = myRoster != null ? `CASH ${fmtPts(book.cash)} · STAKES WORTH ${fmtPts(book.value)} · ${book.shares} SHARES` : 'THE LEAGUE’S STAKES';
  const body = (<>
        {/* v0.577.0: INVEST on the left, MINE and LEAGUE on the right. */}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <Chip label="INVEST" on={view === 'add'} onPress={() => { tap(); setView('add'); }} />
          <View style={{ flex: 1 }} />
          <Chip label={`MINE (${mine.length})`} on={view === 'mine'} onPress={() => { tap(); setView('mine'); }} />
          <Chip label={`LEAGUE (${st?.players?.length ?? 0})`} on={view === 'league'} onPress={() => { tap(); setView('league'); }} />
        </View>
        {!!msg && <Mono size={9.5} tone={msg.startsWith('✗') ? 'opp' : 'you'}>{msg}</Mono>}
        {st && !st.ok && <Mono size={9.5} tone="opp">{st.error ?? 'Couldn’t load the market.'}</Mono>}

        {view === 'mine' && (mine.length
          ? mine.map((p) => playerRow(p, true))
          : <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>No shares yet. Tap INVEST to find a college player before everyone else does.</Mono>)}

        {view === 'league' && ((st?.players ?? []).length
          ? (st?.players ?? []).map((p) => playerRow(p, false))
          : <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Nobody in the league has bought shares yet.</Mono>)}


        {view === 'add' && banner && (
          <View style={{ borderWidth: 1, borderColor: banner.tone === 'open' ? t.you : t.bd, borderRadius: 8, padding: 10, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mono size={10} weight="700" tone={banner.tone === 'open' ? 'you' : 'text'} style={{ flex: 1 }}>{banner.title}</Mono>
              <InfoChip title="New-player launches">{launchRulesText(ls?.cfg)}</InfoChip>
            </View>
            <Mono size={9} tone="dim" style={{ lineHeight: 13 }}>{banner.sub}</Mono>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Chip label={launchView ? 'BACK TO THE MARKET' : banner.tone === 'open' ? `ORDER${myOrders.length ? ` (${myOrders.length} placed)` : ''}` : 'PREVIEW'}
                on={launchView} onPress={() => { tap(); setLaunchView((v) => !v); }} />
            </View>
          </View>
        )}
        {view === 'add' && (<>
          <TextInput value={q} onChangeText={setQ} placeholder="Search any college QB, RB, WR, TE or school…" placeholderTextColor={t.faint}
            style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.text, fontFamily: MONO, fontSize: 12 }} />
          {!market && <Mono size={9.5} tone="faint">Loading the market…</Mono>}
          {market && market.length === 0 && !deep && <Mono size={9.5} tone="faint">No prices yet: they appear after the first weekly stats update.</Mono>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {MARKET_FILTERS.map((f) => (
              <Chip key={f.id} label={f.label} on={filter === f.id} onPress={() => { tap(); setFilter(f.id); }} />
            ))}
          </ScrollView>
          {launchView && banner ? (<>
            {launchPlayers.length === 0 && <Mono size={9.5} tone="faint">Nobody in this launch matches that.</Mono>}
            {launchPlayers.slice(0, 120).map((x) => launchRow(x))}
            {banner.tone === 'open' && <Mono size={8.5} tone="faint">Orders are sealed: nobody sees yours. Price is the opening price.</Mono>}
          </>) : (<>
          {deep && deep.length === 0 && <Mono size={9.5} tone="faint">No college QB, RB, WR or TE matches that.</Mono>}
          {addList.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: t.bd }}>
              <View style={{ width: 26 }} />
              {head('PLAYER', 'name', undefined, 'left')}
              {head('PRICE', 'price', W.price, 'right')}
              {head('TO MAX', 'lead', W.bar)}
              {head('YOU', 'mine', W.you)}
              {head('OWN', 'owners', W.own)}
              {head('', null, W.buy)}
            </View>
          )}
          {market && addList.length === 0 && !(deep && deep.length === 0) && <Mono size={9.5} tone="faint">Nobody matches that filter.</Mono>}
          {addList.slice(0, shown).map((l) => investRow(l))}
          {(() => { const f = marketFooter(Math.min(shown, addList.length), addList.length, fetched, deep ? Infinity : limit); return f ? <Mono size={9} tone="faint" style={{ textAlign: 'center', paddingVertical: 8 }}>{f}</Mono> : null; })()}
          </>)}
        </>)}
  </>);
  // THE HEADER (v0.576.0, founder: "less tall. No wall of text, just a small
  // info chip."): the book on one line, the rules behind the ⓘ, and a lock
  // or freeze only when one applies — state, not explanation.
  const header = (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono size={9.5} weight="700" tone="you" style={{ flex: 1 }}>{subtitle}</Mono>
        <InfoChip title="How the devy market works">{devyRulesText(rules, st)}</InfoChip>
      </View>
      {(st?.locked || st?.frozen || st?.current === false) && <Mono size={9} tone="warn">{st?.current === false ? 'Last season’s league — read only.' : lockLine(st)}</Mono>}
    </View>
  );
  // ── THE POP-UPS (v0.579.0): who owns him, and the purchase sheet ──
  const ownLine = openOwners ? addList.find((l) => l.row.slug === openOwners) ?? null : null;
  const tl = trade ? addList.find((l) => l.row.slug === trade.slug) ?? null : null;
  const tMine = tl?.held?.holders.find((h) => h.roster_id === myRoster);
  const tp = tl && trade ? tradePreview({ mode: trade.mode, n: trade.n, cur: tl.mine, cost: Number(tMine?.cost ?? 0), price: tl.price, cash: book.cash, rules }) : null;
  const ownersList = (l: MarketLine) => (
    <View style={{ gap: 4 }}>
      {l.owners.length === 0 && <Mono size={9.5} tone="faint">Nobody holds shares in him yet.</Mono>}
      {l.owners.map((o) => (
        <View key={o.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: 11, color: o.mine ? t.you : t.text, fontWeight: o.right ? '700' : '400' }}>{o.right ? '★ ' : ''}{o.team}</Text>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: t.dim, width: 46, textAlign: 'right' }}>{o.shares} sh</Text>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: t.dim, width: 64, textAlign: 'right' }}>{fmtPts(o.cost)} in</Text>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: o.progress >= 1 ? t.opp : t.faint, width: 42, textAlign: 'right' }}>{Math.round(o.progress * 100)}%</Text>
        </View>
      ))}
      <Mono size={8.5} tone="faint" style={{ lineHeight: 12 }}>% = how close a stake is to maxing ({rules.max} shares or {rules.max_spend} points). First to 100% holds his right.</Mono>
    </View>
  );
  const stat = (k: string, v: string, tone: 'text' | 'you' | 'opp' = 'text') => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Mono size={8} tone="faint" weight="700" track={0.12}>{k}</Mono>
      <Text style={{ fontFamily: MONO, fontSize: 14, fontWeight: '800', color: tone === 'you' ? t.you : tone === 'opp' ? t.opp : t.text, marginTop: 2 }}>{v}</Text>
    </View>
  );
  const popups = (<>
    <Overlay visible={!!ownLine} title={ownLine ? `${ownLine.row.name} · owners` : 'Owners'} onClose={() => setOpenOwners(null)}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>{ownLine && ownersList(ownLine)}</ScrollView>
    </Overlay>
    <Overlay visible={!!tl && !!trade} title={tl ? tl.row.name : 'Buy shares'} subtitle={tl ? marketSubline(tl.row) : undefined} onClose={() => setTrade(null)}>
      {tl && trade && tp && (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.bd, paddingVertical: 8 }}>
            {stat('PRICE', fmtPts(tl.price))}
            {stat('YOU HOLD', `${tl.mine} sh`, tl.mine ? 'you' : 'text')}
            {stat('CASH', fmtPts(book.cash))}
            {stat('LEADER', tl.lead >= 1 ? 'OWNED' : `${Math.round(tl.lead * 100)}%`, tl.leadMine ? 'you' : tl.right ? 'opp' : 'text')}
          </View>
          {tl.mine > 0 && (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Chip label="BUY" on={trade.mode === 'buy'} onPress={() => { tap(); setTrade({ ...trade, mode: 'buy', n: 1 }); }} />
              <Chip label="SELL" on={trade.mode === 'sell'} onPress={() => { tap(); setTrade({ ...trade, mode: 'sell', n: 1 }); }} />
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
            <Chip label="−" disabled={trade.n <= 1} onPress={() => { tap(); setTrade({ ...trade, n: Math.max(1, trade.n - 1) }); }} />
            <Text style={{ minWidth: 70, textAlign: 'center', fontFamily: MONO, fontSize: 26, fontWeight: '800', color: t.text }}>{tp.n}</Text>
            <Chip label="+" disabled={tp.n >= (trade.mode === 'buy' ? Math.max(1, maxBuy(tl.mine, Number(tMine?.cost ?? 0), tl.price, rules.max, rules.max_spend)) : tl.mine)}
              onPress={() => { tap(); setTrade({ ...trade, n: tp.n + 1 }); }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
            {[1, 5, 10].map((k) => <Chip key={k} label={`${k}`} on={tp.n === k} onPress={() => { tap(); setTrade({ ...trade, n: k }); }} />)}
            {trade.mode === 'buy'
              ? <Chip label={`MAX ${tp.maxN}`} disabled={tp.maxN < 1} onPress={() => { tap(); setTrade({ ...trade, n: Math.max(1, tp.maxN) }); }} />
              : <Chip label={`ALL ${tl.mine}`} onPress={() => { tap(); setTrade({ ...trade, n: tl.mine }); }} />}
          </View>
          <View style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 8, padding: 10, gap: 4 }}>
            <Mono size={10.5} weight="700">{trade.mode === 'buy' ? `Cost ${fmtPts(tp.amount)} · cash after ${fmtPts(tp.cashAfter)}` : `You get ${fmtPts(tp.amount)} · cash after ${fmtPts(tp.cashAfter)}`}</Mono>
            <Mono size={10} tone="dim">{`Your stake: ${tl.mine} → ${tp.sharesAfter} sh · ${fmtPts(tp.costAfter)} in · ${Math.round(tp.progressAfter * 100)}% to max`}</Mono>
            {tp.maxes && <Mono size={10} tone="you" weight="700">{tl.right && !tl.right.mine ? `★ This maxes your stake — but ${tl.right.team} already holds his right.` : '★ This maxes your stake. First to max holds his right.'}</Mono>}
            {tp.capped && <Mono size={9.5} tone="warn">Paid at the {rules.payout_cap}× cap on what you put in, not today's full price.</Mono>}
            {!!tp.why && <Mono size={9.5} tone="opp">{tp.why}</Mono>}
          </View>
          <PrimaryButton label={busy ? 'WORKING…' : trade.mode === 'buy' ? `BUY ${tp.n} · ${fmtPts(tp.amount)}` : `SELL ${tp.n} · +${fmtPts(tp.amount)}`}
            disabled={busy || !tp.ok || locked}
            onPress={() => { void set(tl.row.slug, trade.mode === 'buy' ? tl.mine + tp.n : tl.mine - tp.n).then((ok) => { if (ok) setTrade(null); }); }} />
          {locked && <Mono size={9.5} tone="warn">{lockLine(st)}</Mono>}
          {!!msg && msg.startsWith('✗') && <Mono size={9.5} tone="opp">{msg}</Mono>}
          <View style={{ gap: 6 }}>
            <Mono size={8.5} tone="faint" weight="700" track={0.12}>OWNERS</Mono>
            {ownersList(tl)}
          </View>
        </ScrollView>
      )}
    </Overlay>
  </>);
  if (inline) {
    return (
      <View style={{ gap: 8 }}>
        {header}
        {body}
        {popups}
      </View>
    );
  }
  return (
    <Overlay visible={visible} title="Devy market" onClose={onClose ?? (() => {})}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100} onScroll={(e) => { if (isNearEnd(e)) more(); }}>
        {header}
        {body}
      </ScrollView>
      {popups}
    </Overlay>
  );
}

