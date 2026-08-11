// The Power-Up Shop.
//
// Ported from the web's ShopModal (LeagueOverview.tsx). Same catalogue, same
// categories, same affordability rules — all of it read from
// @drip/core/data/powerups, so a price change or a new power-up appears here
// with no edit.
//
// Buying goes through `wallet_buy_powerup`, the server RPC the web's live board
// uses. The balance it returns is authoritative; nothing is deducted locally.
// That matters on practice weeks, where the server deliberately charges nothing
// — a client-side ledger would show coin draining that the server never took.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { POWERUPS, POWERUP_CATEGORIES, powerupCategory } from '@drip/core/data/powerups';
import { myInventory, walletBuyPowerup } from '@drip/core/data/liveApi';
import { useTheme, MONO, alpha } from '../theme.native';
import { Display, Mono } from './prims';

export function ShopModal({ visible, matchupId, balance, practice, onClose, onChanged }: {
  visible: boolean;
  matchupId: string;
  balance: number;
  /** Preseason board weeks charge nothing (migration 0110), so the copy must
   *  not imply the season wallet moves. */
  practice?: boolean;
  onClose: () => void;
  /** Fired after a successful buy with the server's new balance, so the caller
   *  can re-read its own wallet rather than guessing. */
  onChanged: (balance: number) => void;
}) {
  const t = useTheme();
  const [tab, setTab] = useState<string>('all');
  const [owned, setOwned] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    myInventory(matchupId).then((inv) => setOwned(inv ?? {})).catch(() => {});
  }, [visible, matchupId]);

  const shown = POWERUPS.filter((p) => tab === 'all' || powerupCategory(p) === tab);

  const buy = async (id: string, price: number) => {
    if (busy) return;
    if (balance < price) { setErr(`Not enough coin — need ◈${price}.`); return; }
    setBusy(id); setErr(null);
    try {
      const r = await walletBuyPowerup(matchupId, id);
      if (r?.ok) {
        setFlash(id);
        setTimeout(() => setFlash((f) => (f === id ? null : f)), 700);
        onChanged(Number(r.balance ?? balance));
        myInventory(matchupId).then((inv) => setOwned(inv ?? {})).catch(() => {});
      } else {
        setErr(r?.error ?? 'Could not buy that power-up.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not buy that power-up.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Display size={20}>Power-Up Shop</Display>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ fontSize: 20, color: t.dim }}>✕</Text></Pressable>
          </View>
          <Mono size={10} tone="faint" style={{ marginTop: 6 }}>
            {practice
              ? `◈ ${Math.round(balance)} PRACTICE COIN · 🏈 this week’s practice budget — your season wallet is untouched`
              : `◈ ${Math.round(balance)} DRIP COIN · +5 per signature play`}
          </Mono>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, padding: 12 }}>
          {[{ id: 'all', label: 'All' }, ...POWERUP_CATEGORIES].map((c) => {
            const on = tab === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setTab(c.id)}
                style={{
                  borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
                  backgroundColor: on ? t.warn : t.surface,
                  borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.warn : t.bd,
                }}
              >
                <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: on ? t.onAccent : t.dim }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!!err && <Mono size={10.5} tone="opp" style={{ paddingHorizontal: 14, paddingBottom: 6 }}>{err}</Mono>}

        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
          {shown.map((p) => {
            const have = owned[p.id] ?? 0;
            const afford = balance >= p.price;
            const timing = p.kind === 'metric' ? 'METRIC · 1 WK' : p.timing === 'pre' ? 'PRE-MATCH' : 'REAL-TIME';
            const lit = flash === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => buy(p.id, p.price)}
                disabled={!!busy}
                style={{
                  width: '48%',
                  backgroundColor: lit ? alpha(t.you, 14) : '#241E15',
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: lit ? t.you : '#3A3122',
                  borderRadius: 10, padding: 12, gap: 7,
                  opacity: afford ? 1 : 0.55,
                }}
              >
                <View style={{ alignSelf: 'center', backgroundColor: '#3A3122', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color: '#D8C08A' }}>{timing}</Text>
                </View>

                <Text style={{ fontSize: 22, textAlign: 'center' }}>{p.icon}</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#F0E6CC', textAlign: 'center' }}>{p.name.toUpperCase()}</Text>
                <Text numberOfLines={4} style={{ fontSize: 10.5, color: '#B3A88C', textAlign: 'center', lineHeight: 15 }}>{p.blurb}</Text>

                {have > 0 && <Mono size={9} tone="you" weight="700" style={{ textAlign: 'center' }}>OWNED ×{have}</Mono>}
                {!afford && <Mono size={9} tone="faint" style={{ textAlign: 'center' }}>↳ need ◈{p.price}</Mono>}

                <View style={{ alignSelf: 'center', marginTop: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: '#4A3F2A', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 6, minWidth: 78, alignItems: 'center' }}>
                  {busy === p.id
                    ? <ActivityIndicator size="small" color={t.you} />
                    : <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: afford ? '#F0E6CC' : '#8A7F66' }}>◈ {p.price}</Text>}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
