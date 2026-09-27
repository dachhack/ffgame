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
import { ScrollView, Text, TextInput, View } from 'react-native';
import { allotDevyShares, devyMarket, devySharesState, friendlyError, type DevyMarketRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeClassLabel } from '@drip/core/data/college';
import { teamBook, myStake, rightLine, lockLine, stakeLine, fmtPts } from '@drip/core/data/devyShares';
import { useTheme, MONO } from '../theme.native';
import { Overlay } from './Overlay';
import { Chip, Mono, PosPill } from './prims';
import { tap, commit, warn } from './feedback';

type View3 = 'mine' | 'league' | 'add';

export function DevySharesSheet({ visible, leagueId, myRoster, onClose }: {
  visible: boolean; leagueId: string; myRoster: number | null; onClose: () => void;
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

  const rules = { budget: 100, max: 20, floor: 5, cash_cap: 200, payout_cap: 3, ...(st?.rules ?? {}) };
  const book = teamBook(st, myRoster);
  const bySlug = useMemo(() => new Map((st?.players ?? []).map((p) => [p.slug, p])), [st]);
  const mine = (st?.players ?? []).filter((p) => myStake(p, myRoster) > 0);
  const locked = !!st?.locked;

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

  /** Buy/sell chips; a buy chip shows what it costs at today's price. */
  const stakeControls = (slug: string, cur: number, price: number) => {
    const buy = (k: number) => Math.min(k, rules.max - cur);
    const afford = (k: number) => buy(k) > 0 && buy(k) * price <= book.cash;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {cur > 0 && <Chip label="SELL 5" disabled={busy || locked} onPress={() => { tap(); void set(slug, cur - 5); }} />}
        {cur > 0 && <Chip label="SELL 1" disabled={busy || locked} onPress={() => { tap(); void set(slug, cur - 1); }} />}
        <Chip label={`+1 · ${price}`} disabled={busy || locked || !afford(1)} onPress={() => { tap(); void set(slug, cur + 1); }} />
        <Chip label={`+5 · ${buy(5) * price}`} disabled={busy || locked || !afford(5)} onPress={() => { tap(); void set(slug, cur + 5); }} />
        <Chip label={`TO ${rules.max} · ${buy(rules.max) * price}`} on disabled={busy || locked || !afford(rules.max)} onPress={() => { tap(); void set(slug, rules.max); }} />
        {cur > 0 && <Chip label="SELL ALL" dim disabled={busy || locked} onPress={() => { tap(); void set(slug, 0); }} />}
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
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.text }}>{p.name ?? p.slug}</Text>
          <Mono size={11} weight="700" tone="you">{price}/sh</Mono>
        </View>
        <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
          {[p.school, p.class_year ? collegeClassLabel(p.class_year) : null, p.rank ? `#${p.rank} in college` : 'unranked', p.graduated_to ? 'TURNED PRO' : null].filter(Boolean).join(' · ')}
        </Mono>
        {mineH && <Mono size={10} weight="700" tone={Number(mineH.value) >= Number(mineH.cost) ? 'you' : 'opp'} style={{ marginTop: 3 }}>
          {`YOU: ${cur} shares · ${stakeLine(mineH.cost, mineH.value)}`}
        </Mono>}
        <Mono size={9.5} tone={yours ? 'you' : 'dim'} style={{ marginTop: 3 }}>{rightLine(p, myRoster, rules.floor, rules.max)}</Mono>
        <Mono size={9} tone="faint" style={{ marginTop: 2 }}>{p.holders.map((h) => `${h.team} ${h.shares}`).join(' · ')}</Mono>
        {controls && myRoster != null && !p.graduated_to && stakeControls(p.slug, cur, price)}
      </View>
    );
  };

  const addList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (market ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.school ?? '').toLowerCase().includes(needle)).slice(0, 60);
  }, [market, q]);

  return (
    <Overlay visible={visible} title="Devy market" onClose={onClose}
      subtitle={myRoster != null ? `CASH ${fmtPts(book.cash)} · STAKES WORTH ${fmtPts(book.value)} · ${book.shares} SHARES` : 'THE LEAGUE’S STAKES'}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
        <Mono size={9.5} tone="dim" style={{ lineHeight: 14 }}>
          {`Buy shares in college players, up to ${rules.max} each. Prices follow how they're playing and how much of the league wants them, updated weekly. First to ${rules.max} shares holds a player's right (if you're the only team in, ${rules.floor}+ does), which reserves him for you in the rookie draft. Selling, or his turning pro, pays today's price, up to ${rules.payout_cap}× what you paid. Cash tops out at ${rules.cash_cap}. ${lockLine(st)}`}
        </Mono>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {(['mine', 'league', 'add'] as const).map((v) => (
            <Chip key={v} label={v === 'mine' ? `MINE (${mine.length})` : v === 'league' ? `LEAGUE (${st?.players?.length ?? 0})` : '+ BUY'} on={view === v}
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

        {view === 'add' && (<>
          <TextInput value={q} onChangeText={setQ} placeholder="Search college players or schools…" placeholderTextColor={t.faint}
            style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.text, fontFamily: MONO, fontSize: 12 }} />
          {!market && <Mono size={9.5} tone="faint">Loading the market…</Mono>}
          {market && market.length === 0 && <Mono size={9.5} tone="faint">No prices yet: they appear after the first weekly stats update.</Mono>}
          {addList.map((r) => {
            const held = bySlug.get(r.slug);
            if (held) return playerRow({ ...held, price: held.price ?? r.price }, true);
            return (
              <View key={r.slug} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <PosPill pos={r.pos} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.text }}>{r.name}</Text>
                  <Mono size={11} weight="700" tone="you">{r.price}/sh</Mono>
                </View>
                <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
                  {[r.school, r.class_year ? collegeClassLabel(r.class_year) : null, `#${r.rank} in college`, r.youth ? 'young riser +1' : null].filter(Boolean).join(' · ')} · nobody in yet
                </Mono>
                {myRoster != null && stakeControls(r.slug, 0, r.price)}
              </View>
            );
          })}
        </>)}
      </ScrollView>
    </Overlay>
  );
}
