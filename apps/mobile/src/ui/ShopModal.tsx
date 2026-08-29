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

export function ShopModal({ visible, matchupId, balance, practice, unlocks, comboQty, unlockBusy, unlockLocked, armsClosed, onToggleUnlock, onDisarmCombo, onClose, onChanged }: {
  visible: boolean;
  matchupId: string;
  balance: number;
  /** Preseason board weeks charge nothing (migration 0110), so the copy must
   *  not imply the season wallet moves. */
  practice?: boolean;
  /** ── Metric unlocks (kind: 'metric') ──────────────────────────────────────
   *  These do NOT go through wallet_buy_powerup and they never enter the hand.
   *  They are a different server mechanism: arm_unlock spends the wallet and
   *  arms the unlock in one call, and the metric picker gates on `unlocks`.
   *  A card in the hand arms into `buffs`, which the picker never reads.
   *
   *  So a metric unlock bought into inventory was unusable — the coin left, a
   *  card appeared, playing it consumed the card and unlocked nothing. That is
   *  the "bought a power-up, applied it, and it's gone". They buy-and-arm in
   *  place here instead, which is what the board's chip row did before it was
   *  folded into the shop. */
  unlocks: Set<string>;
  /** Combo Drip is one slot PER purchase, so it has a count rather than a
   *  boolean and its tile always offers another. */
  comboQty: number;
  unlockBusy: string | null;
  /** Premium-gated on a free matchup. Shown as a locked tile rather than left
   *  tappable: the board owns the "upgrade to arm this" error, and from inside
   *  the shop that message would be posted behind the modal where nobody sees
   *  it. Better to not offer the tap. */
  unlockLocked: (id: string) => boolean;
  /** The week has started — arms are closed. */
  armsClosed?: boolean;
  onToggleUnlock: (id: string) => void;
  onDisarmCombo: () => void;
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
            // A metric unlock is armed here, not owned. Combo Drip stays
            // buyable while armed — each purchase is another slot.
            const isUnlock = p.kind === 'metric';
            const combo = p.id === 'unlock-combo-drip';
            const armed = isUnlock && (combo ? comboQty > 0 : unlocks.has(p.id));
            const gated = isUnlock && !armed && unlockLocked(p.id);
            const have = owned[p.id] ?? 0;
            const afford = (armed && !combo) || balance >= p.price;
            const timing = isUnlock ? 'METRIC · 1 WK' : p.timing === 'pre' ? 'PRE-MATCH' : 'REAL-TIME';
            const lit = flash === p.id || armed;
            return (
              <Pressable
                key={p.id}
                onPress={() => (isUnlock ? onToggleUnlock(p.id) : buy(p.id, p.price))}
                disabled={!!busy || (isUnlock && (!!unlockBusy || gated || !afford))}
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

                {/* ARMED, not OWNED — an unlock never becomes a card, so
                    "owned" would be promising a hand you'll never be dealt. */}
                {armed && <Mono size={9} tone="you" weight="700" style={{ textAlign: 'center' }}>{combo ? `ARMED ×${comboQty}` : 'ARMED'}</Mono>}
                {!isUnlock && have > 0 && <Mono size={9} tone="you" weight="700" style={{ textAlign: 'center' }}>OWNED ×{have}</Mono>}
                {!afford && !gated && <Mono size={9} tone="faint" style={{ textAlign: 'center' }}>↳ need ◈{p.price}</Mono>}

                <View style={{ alignSelf: 'center', marginTop: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: armed ? t.you : '#4A3F2A', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 6, minWidth: 78, alignItems: 'center' }}>
                  {busy === p.id || unlockBusy === p.id
                    ? <ActivityIndicator size="small" color={t.you} />
                    : <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: armed ? t.you : afford && !gated ? '#F0E6CC' : '#8A7F66' }}>
                        {gated ? '🔒 PREMIUM' : armed && !combo ? '✓ DISARM' : `◈ ${p.price}`}
                      </Text>}
                </View>

                {/* One slot per purchase, so removing one has to be its own
                    control — tapping the tile buys another. */}
                {combo && comboQty > 0 && !armsClosed && (
                  <Pressable
                    onPress={onDisarmCombo}
                    disabled={!!unlockBusy}
                    style={{ alignSelf: 'center', marginTop: 2, paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Mono size={9} tone="faint" weight="700">➖ REMOVE ONE</Mono>
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Overlay>
  );
}
