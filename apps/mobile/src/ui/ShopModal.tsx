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
//
// Rendered in `Overlay`, like every other modal here. It was the last holdout on
// `presentationStyle="pageSheet"` — the full-screen iOS idiom Overlay's own note
// says this product isn't. Two things went wrong with it on a phone: the sheet
// took the entire screen with the board gone behind it, and its header drew
// UNDER the status bar, putting the ✕ beneath the clock and battery where the
// system eats the tap. That is the "doesn't close" — there was no backdrop to
// tap either, so the only way out was the button that couldn't be pressed.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { POWERUPS, POWERUP_CATEGORIES, powerupCategory } from '@drip/core/data/powerups';
import { myInventory, walletBuyPowerup } from '@drip/core/data/liveApi';
import { Ev, track } from '@drip/core/analytics';
import { useTheme, MONO, alpha } from '../theme.native';
import { Mono } from './prims';
import { commit } from './feedback';
import { Overlay } from './Overlay';

export function ShopModal({ visible, matchupId, balance, practice, unlockLocked, onClose, onChanged }: {
  visible: boolean;
  matchupId: string;
  balance: number;
  /** Preseason board weeks run the throwaway practice purse (0115), so the copy
   *  must not imply the season wallet moves. */
  practice?: boolean;
  /** ── Metric unlocks (kind: 'metric') ──────────────────────────────────────
   *  Plain cards since 0256 ("purchase goes to your power up hand"): the shop
   *  sells them through wallet_buy_powerup into the week's inventory like any
   *  other power-up — no auto-arm, nothing expires. USING one happens in the
   *  metric picker (LivePicks pickMetricWithCard), behind a confirm, where
   *  arm_unlock consumes the owned card. */
  /** Premium-gated on a free matchup. Shown as a locked tile rather than left
   *  tappable: the board owns the "upgrade to arm this" error, and from inside
   *  the shop that message would be posted behind the modal where nobody sees
   *  it. Better to not offer the tap. */
  unlockLocked: (id: string) => boolean;
  onClose: () => void;
  /** Fired after a successful buy with the server's new balance AND the freshly
   *  re-read inventory.
   *
   *  The inventory is not a convenience. This used to report the balance only,
   *  and the shop refreshed its own `owned` map privately — so after a purchase
   *  the shop said OWNED ×1 while the board's hand, reading the parent's copy
   *  loaded once on mount, stayed empty. Coin left the wallet, the item existed
   *  server-side, and the card the player paid for was nowhere on screen. Handing
   *  the fresh map up makes the two views incapable of disagreeing, and costs no
   *  extra round trip: the shop already had to fetch it. */
  onChanged: (balance: number, inventory: Record<string, number>) => void;
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
        commit();
        // After the server said yes, never before: a rejected buy that still
        // reported would inflate the engagement metric with purchases that
        // never happened. `practice` rides along because a preseason board
        // charges nothing (0110) and those buys aren't real spend.
        track(Ev.powerupBought, { id, price, practice: !!practice });
        setFlash(id);
        setTimeout(() => setFlash((f) => (f === id ? null : f)), 700);
        // Re-read BEFORE reporting up, so the caller gets the post-purchase
        // inventory rather than being told a balance and left to find out about
        // the item on its own. On a failed read, fall back to an optimistic
        // bump: the buy succeeded, so the item is owned whatever the re-read did.
        const inv = await myInventory(matchupId).catch(() => ({ ...owned, [id]: (owned[id] ?? 0) + 1 }));
        setOwned(inv ?? {});
        onChanged(Number(r.balance ?? balance), inv ?? {});
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
    <Overlay
      visible={visible}
      title="Power-Up Shop"
      subtitle={practice
        ? `◈ ${Math.round(balance)} PRACTICE COIN · 🏈 THIS WEEK’S PRACTICE BUDGET — YOUR SEASON WALLET IS UNTOUCHED`
        : `◈ ${Math.round(balance)} DRIP COIN · +5 PER SIGNATURE PLAY`}
      onClose={onClose}
    >
      <View style={{ flexShrink: 1, minHeight: 0 }}>
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

        {/* Shrinks to whatever the sheet has left — see the note in Overlay.
            Left to size itself the wrapped grid would push the ✕ off the top. */}
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
          {shown.map((p) => {
            // Metric unlocks are plain cards (0256): bought into the hand like
            // everything else, used later from the metric picker.
            const isUnlock = p.kind === 'metric';
            const gated = isUnlock && unlockLocked(p.id);
            const have = owned[p.id] ?? 0;
            const afford = balance >= p.price;
            const timing = isUnlock ? 'METRIC' : p.timing === 'pre' ? 'PRE-MATCH' : 'REAL-TIME';
            const lit = flash === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => buy(p.id, p.price)}
                disabled={!!busy || gated || !afford}
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
                {isUnlock && <Mono size={8.5} tone="faint" style={{ textAlign: 'center' }}>to your hand — use it from a slot&rsquo;s metric picker</Mono>}
                {!afford && !gated && <Mono size={9} tone="faint" style={{ textAlign: 'center' }}>↳ need ◈{p.price}</Mono>}

                <View style={{ alignSelf: 'center', marginTop: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: '#4A3F2A', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 6, minWidth: 78, alignItems: 'center' }}>
                  {busy === p.id
                    ? <ActivityIndicator size="small" color={t.you} />
                    : <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: afford && !gated ? '#F0E6CC' : '#8A7F66' }}>
                        {gated ? '🔒 PREMIUM' : `◈ ${p.price}`}
                      </Text>}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Overlay>
  );
}
