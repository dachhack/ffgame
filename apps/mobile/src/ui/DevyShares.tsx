// DEVY SHARES (0387) AND THE MARKET (0388) — the app's sheet.
//
// Every team starts with 100 points to buy shares in college players, at most
// 20 shares in one. A share's price follows how the player is playing (his
// college rank, +1 for a young riser) and how much of the league wants him.
// Buying locks in what you paid; selling, or his turning pro, pays today's
// price (up to 3× what you paid). The first team to 20 shares holds his right
// — failing that, the only team in does, with 5+ — and the right reserves him
// in the rookie draft, at any of the holder's picks.
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View, Pressable } from 'react-native';
import { allotDevyShares, devyMarket, devySharesState, friendlyError, proposeMultiTrade, type DevyMarketRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeClassLabel } from '@drip/core/data/college';
import { openPlayerCard } from './PlayerCardSheet';
import { teamBook, myStake, rightLine, lockLine, stakeLine, fmtPts, maxBuy, marketRowDetail, DEEP_SEARCH_MIN } from '@drip/core/data/devyShares';
import { useTheme, MONO } from '../theme.native';
import { Overlay } from './Overlay';
import { Chip, Mono, PosPill } from './prims';
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
  const [view, setView] = useState<View3>('mine');
  const [market, setMarket] = useState<DevyMarketRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => devySharesState(leagueId).then(setSt).catch(() => {});
  useEffect(() => { if (visible) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [visible, leagueId]);
  useEffect(() => {
    if (visible && view === 'add') devyMarket(leagueId, 1000).then((r) => setMarket(Array.isArray(r) ? r : [])).catch(() => setMarket([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, view, leagueId, st]);
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
  const bySlug = useMemo(() => new Map((st?.players ?? []).map((p) => [p.slug, p])), [st]);
  const mine = (st?.players ?? []).filter((p) => myStake(p, myRoster) > 0);
  // 0396: last season's league row is read-only; the lock and the freeze say so.
  const locked = !!st?.locked || st?.current === false;

  const set = async (slug: string, n: number) => {
    if (myRoster == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await allotDevyShares(leagueId, myRoster, slug, Math.max(0, Math.min(rules.max, n)));
      if (!r.ok) { warn(); setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`); return; }
      commit();
      if (r.spent) setMsg(`✓ bought at ${r.price} a share: −${fmtPts(Number(r.spent))}`);
      else if (r.received) setMsg(`✓ sold at ${r.price} a share: +${fmtPts(Number(r.received))}`);
      await load();
    } catch (e) { warn(); setMsg(`✗ ${friendlyError(e instanceof Error ? e.message : String(e))}`); }
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
          <Mono size={11} weight="700" tone="you">{price}/sh</Mono>
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

  const addList = useMemo(() => {
    if (deep) return deep;
    const needle = q.trim().toLowerCase();
    return (market ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.school ?? '').toLowerCase().includes(needle)).slice(0, 60);
  }, [market, q, deep]);

  const subtitle = myRoster != null ? `CASH ${fmtPts(book.cash)} · STAKES WORTH ${fmtPts(book.value)} · ${book.shares} SHARES` : 'THE LEAGUE’S STAKES';
  const body = (<>
        <Mono size={9.5} tone="dim" style={{ lineHeight: 14 }}>
          {`Buy shares in college players. Prices follow how they're playing, updated weekly in season and frozen from Jan 15 until the next season's first stats. A stake maxes at ${rules.max} shares or ${rules.max_spend} points spent; the first team to max holds his right, or if only one team has ${rules.floor}+ shares and ${rules.min_spend}+ points in, that team does. The right reserves him for you in the rookie draft. When he's drafted into the NFL your shares pay the better of his college price and his draft round (R1 8, R2 6, R3 5, later 2), up to ${rules.payout_cap}× what you paid. Selling pays today's price, up to ${rules.payout_cap}× what you paid; cash tops out at ${rules.cash_cap} from sales. ${lockLine(st)}${st?.frozen ? ' Prices are frozen for the offseason.' : ''}`}
        </Mono>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {(['mine', 'league', 'add', 'trade'] as const).filter((v) => v !== 'trade' || myRoster != null).map((v) => (
            <Chip key={v} label={v === 'mine' ? `MINE (${mine.length})` : v === 'league' ? `LEAGUE (${st?.players?.length ?? 0})` : v === 'add' ? '+ BUY' : '⇄ TRADE'} on={view === v}
              onPress={() => { tap(); setView(v); }} />
          ))}
        </View>
        {!!msg && <Mono size={9.5} tone={msg.startsWith('✗') ? 'opp' : 'you'}>{msg}</Mono>}
        {st && !st.ok && <Mono size={9.5} tone="opp">{st.error ?? 'Couldn’t load the market.'}</Mono>}

        {view === 'mine' && (mine.length
          ? mine.map((p) => playerRow(p, true))
          : <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>No shares yet. Tap + BUY to find a college player before everyone else does.</Mono>)}

        {view === 'league' && ((st?.players ?? []).length
          ? (st?.players ?? []).map((p) => playerRow(p, false))
          : <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Nobody in the league has bought shares yet.</Mono>)}

        {view === 'trade' && myRoster != null && st?.ok && (
          <ShareTradeComposer leagueId={leagueId} st={st} myRoster={myRoster} onSent={(m) => { setMsg(m); setView('mine'); void load(); }} />
        )}

        {view === 'add' && (<>
          <TextInput value={q} onChangeText={setQ} placeholder="Search college players or schools…" placeholderTextColor={t.faint}
            style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.text, fontFamily: MONO, fontSize: 12 }} />
          {!market && <Mono size={9.5} tone="faint">Loading the market…</Mono>}
          {market && market.length === 0 && !deep && <Mono size={9.5} tone="faint">No prices yet: they appear after the first weekly stats update.</Mono>}
          {deep && deep.length === 0 && <Mono size={9.5} tone="faint">No college QB, RB, WR or TE matches that.</Mono>}
          {!deep && <Mono size={9} tone="faint">Type 2+ letters to search every college QB, RB, WR and TE, FCS included. Unpriced players cost 1 point a share.</Mono>}
          {addList.map((r) => {
            const held = bySlug.get(r.slug);
            if (held) return playerRow({ ...held, price: held.price ?? r.price }, true);
            return (
              <View key={r.slug} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <PosPill pos={r.pos} />
                  <Pressable hitSlop={6} style={{ flex: 1 }} onPress={() => { tap(); openPlayerCard({ slug: r.slug, name: r.name, pos: r.pos, team: r.school ?? '', leagueId }); }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: t.text }}>{r.name} <Text style={{ fontSize: 11, color: t.faint }}>ⓘ</Text></Text>
                  </Pressable>
                  <Mono size={11} weight="700" tone="you">{r.price}/sh</Mono>
                </View>
                <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
                  {marketRowDetail(r)} · nobody in yet
                </Mono>
                {myRoster != null && stakeControls(r.slug, 0, r.price, 0, false, true)}
              </View>
            );
          })}
        </>)}
  </>);
  if (inline) {
    return (
      <View style={{ gap: 8 }}>
        <Mono size={9.5} weight="700" tone="you">{subtitle}</Mono>
        {body}
      </View>
    );
  }
  return (
    <Overlay visible={visible} title="Devy market" onClose={onClose ?? (() => {})} subtitle={subtitle}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </Overlay>
  );
}

/** SHARE TRADES (0397): shares and devy cash, both ways, with one other team.
 *  It files through the league's trade system (propose_multi_trade), so it
 *  gets the same answer, commissioner ruling and league vote as any trade;
 *  the other team answers it in the trades list. Players and picks trade in
 *  the trade center; this is for the market. */
function ShareTradeComposer({ leagueId, st, myRoster, onSent }: {
  leagueId: string; st: DevySharesState; myRoster: number; onSent: (msg: string) => void;
}) {
  const t = useTheme();
  const teams = (st.teams ?? []).filter((x) => x.roster_id !== myRoster);
  const [partner, setPartner] = useState<number | null>(teams[0]?.roster_id ?? null);
  const [give, setGive] = useState<Record<string, number>>({});
  const [get, setGet] = useState<Record<string, number>>({});
  const [giveCash, setGiveCash] = useState('');
  const [getCash, setGetCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stakesOf = (rid: number | null) => (st.players ?? [])
    .filter((p) => !p.graduated_to)
    .map((p) => ({ p, h: p.holders.find((h) => h.roster_id === rid) }))
    .filter((x): x is { p: DevySharePlayer; h: NonNullable<typeof x.h> } => !!x.h);
  const stepper = (slug: string, max: number, val: Record<string, number>, setVal: (v: Record<string, number>) => void) => {
    const n = val[slug] ?? 0;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Chip label="−" disabled={n <= 0} onPress={() => { tap(); setVal({ ...val, [slug]: Math.max(0, n - 1) }); }} />
        <Mono size={11} weight="700" tone={n > 0 ? 'you' : 'faint'} style={{ minWidth: 22, textAlign: 'center' }}>{n}</Mono>
        <Chip label="+" disabled={n >= max} onPress={() => { tap(); setVal({ ...val, [slug]: Math.min(max, n + 1) }); }} />
        <Chip label="ALL" dim disabled={n >= max} onPress={() => { tap(); setVal({ ...val, [slug]: max }); }} />
      </View>
    );
  };
  const side = (rid: number | null, val: Record<string, number>, setVal: (v: Record<string, number>) => void, cash: string, setCash: (s: string) => void, label: string) => (
    <View style={{ gap: 6, marginTop: 6 }}>
      <Mono size={9} tone="faint" track={0.12}>{label}</Mono>
      {stakesOf(rid).length === 0 && <Mono size={9.5} tone="faint">No shares.</Mono>}
      {stakesOf(rid).map(({ p, h }) => (
        <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.text }}>{p.name ?? p.slug} <Text style={{ color: t.faint, fontSize: 11 }}>{`${h.shares} held · ${p.price ?? 1}/sh`}</Text></Text>
          {stepper(p.slug, h.shares, val, setVal)}
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Mono size={9} tone="dim">DEVY CASH</Mono>
        <TextInput value={cash} onChangeText={(x) => setCash(x.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={t.faint}
          style={{ minWidth: 64, borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, color: t.text, fontFamily: MONO, fontSize: 12 }} />
        <Mono size={9} tone="faint">{`has ${fmtPts(teamBook(st, rid).cash)}`}</Mono>
      </View>
    </View>
  );
  const legOf = (rid: number, to: number, val: Record<string, number>, cash: string) => ({
    roster: rid,
    send_shares: Object.entries(val).filter(([, n]) => n > 0).map(([slug, n]) => ({ slug, shares: n, to })),
    send_devy_cash: Number(cash) > 0 ? [{ to, amount: Math.round(Number(cash) * 100) / 100 }] : [],
  });
  const propose = async () => {
    if (partner == null) return;
    const a = legOf(myRoster, partner, give, giveCash), b = legOf(partner, myRoster, get, getCash);
    if (!a.send_shares.length && !a.send_devy_cash.length && !b.send_shares.length && !b.send_devy_cash.length) { setErr('Pick something to trade.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await proposeMultiTrade(leagueId, [a, b]);
      if (!r.ok) { warn(); setErr(`✗ ${friendlyError(r.error ?? 'failed')}`); return; }
      commit(); onSent(`✓ offer sent to ${teams.find((x) => x.roster_id === partner)?.team ?? 'them'} — they answer it in the trades list`);
    } catch (e) { warn(); setErr(`✗ ${friendlyError(e instanceof Error ? e.message : String(e))}`); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 6 }}>
      <Mono size={9.5} tone="dim" style={{ lineHeight: 14 }}>
        Trade shares and devy cash with another team. Shares carry what they cost (so the 3× cap goes with them), and a whole maxed stake keeps its place in line for his right. It goes through the league{'\u2019'}s trade review like any trade. Shares trade during the January lock too, but not during a draft.
      </Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {teams.map((x) => <Chip key={x.roster_id} label={x.team} on={partner === x.roster_id} onPress={() => { tap(); setPartner(x.roster_id); setGet({}); setGetCash(''); }} />)}
      </View>
      {side(myRoster, give, setGive, giveCash, setGiveCash, 'YOU SEND')}
      {partner != null && side(partner, get, setGet, getCash, setGetCash, `${teams.find((x) => x.roster_id === partner)?.team ?? 'THEY'} SEND`.toUpperCase())}
      {!!err && <Mono size={9.5} tone="opp">{err}</Mono>}
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        <Chip label={busy ? 'SENDING…' : 'PROPOSE TRADE'} on disabled={busy || partner == null} onPress={() => { tap(); void propose(); }} />
      </View>
    </View>
  );
}
