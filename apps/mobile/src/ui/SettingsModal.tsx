// Settings — the gear, matching the web's SiteSettings.
//
// Same six themes and same ten card decks, under the same names, because they
// are the same product and a player who picks "Night Rider" on the web should
// find it here. The tokens are literally shared (@drip/core/theme); the decks
// are the same .jpg art, bundled under assets/cardbacks.
//
// The card skin was already half-wired before this existed: cards.tsx reads
// `gc-cardskin` out of storage on every render and picks a back from it. Nothing
// in the app ever WROTE that key, so every deck but the default was unreachable.
// This is the writer.
//
// The demo lives in here rather than on a tab. It is a founder's tool — a
// scripted 2025 week for showing the game to someone — and a permanent third of
// the tab bar is a lot of screen to spend on a button one person presses.

import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { THEMES, type ThemeName, useTheme, MONO, alpha } from '../theme.native';
import { Mono } from './prims';
import { Ev, track } from '@drip/core/analytics';
import { useEffect, useState } from 'react';
import { myPushTokens, setPushPrefs } from '@drip/core/data/liveApi';
import { registerForPush, registeredPushToken } from './push';
import { Overlay } from './Overlay';
import { CARD_BACKS, CARD_SIZES, type CardSkin, type CardSize } from './cards';

/** Theme ids with the web's display names. Order matches the web menu. */
const THEME_OPTS: { id: ThemeName; name: string }[] = [
  { id: 'neon', name: 'Drip' },
  { id: 'slate', name: 'Night Rider' },
  { id: 'dusk', name: 'Deep Thoughts' },
  { id: 'prime', name: 'All Gold' },
  { id: 'daylight', name: 'Feeling Lucky' },
  { id: 'arctic', name: 'Arctic Journey' },
];

/** Nine decks, not the web's ten. `emerald` is a generated SVG weave on the web
 *  with no file to bundle, so on native it falls through to playbook — and a
 *  picker that offers a deck and then hands you a different one is worse than a
 *  picker with one fewer deck. Add it here the day there's art for it. */
const SKIN_OPTS: { id: CardSkin; name: string }[] = [
  { id: 'playbook', name: 'Playbook' },
  { id: 'blitz', name: 'Blitz' },
  { id: 'rivalry', name: 'Rivalry' },
  { id: 'allstar', name: 'All-Star' },
  { id: 'heritage', name: 'Heritage' },
  { id: 'gilded', name: 'Gilded' },
  { id: 'cosmic', name: 'Cosmic' },
  { id: 'fireworks', name: 'Fireworks' },
  { id: 'battalion', name: 'Battalion' },
];

export function SettingsModal({ visible, theme, skin, cardSize, version, isAdmin, onTheme, onSkin, onCardSize, onDemo, onAdmin, onSignOut, onClose }: {
  visible: boolean;
  theme: ThemeName;
  skin: CardSkin;
  cardSize: CardSize;
  version: string;
  /** Resolved from is_admin(). Only decides whether the entry is SHOWN — the
   *  RPCs behind it are the real gate, as they are on the web. */
  isAdmin?: boolean;
  onTheme: (t: ThemeName) => void;
  onSkin: (s: CardSkin) => void;
  onCardSize: (s: CardSize) => void;
  onDemo: () => void;
  onAdmin: () => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Overlay visible={visible} title="Settings" subtitle={`DRIP FANTASY ${version.toUpperCase()}`} onClose={onClose}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: 18 }}>
        <PushPrefs />

        <View style={{ gap: 8 }}>
          <Mono size={8.5} weight="700" track={0.16} tone="faint">COLOUR THEME</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {THEME_OPTS.map((o) => {
              const on = theme === o.id;
              // Each swatch is painted in ITS OWN theme's colours, not the
              // active one — you pick a theme by seeing it, and a row of
              // identically-tinted chips tells you nothing about what you'd get.
              const th = THEMES[o.id];
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onTheme(o.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 7,
                    borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8,
                    backgroundColor: th.bg,
                    borderWidth: on ? 2 : StyleSheet.hairlineWidth,
                    borderColor: on ? t.you : t.bd,
                  }}
                >
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: th.you }} />
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: th.opp, marginLeft: -3 }} />
                  </View>
                  <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: th.text }}>{o.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Mono size={8.5} weight="700" track={0.16} tone="faint">CARD SIZE</Mono>
          <Mono size={9} tone="faint">On the setup board. Smaller fits a whole window on screen; larger is easier to read and to hit.</Mono>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {CARD_SIZES.map((o) => {
              const on = cardSize === o.id;
              // A proportional swatch, so the choice is visible rather than a
              // word you have to close the sheet to evaluate. Same 2.5:3.5 as
              // the real card; the widths are the real caps, quartered.
              const w = Math.round((o.w ?? 152) / 4);
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onCardSize(o.id)}
                  style={{
                    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 9,
                    borderRadius: 7, backgroundColor: on ? t.sh : 'transparent',
                    borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
                  }}
                >
                  <View style={{ height: 40, justifyContent: 'flex-end' }}>
                    <View style={{ width: w, aspectRatio: 0.714, borderRadius: 3, backgroundColor: on ? t.you : t.bd }} />
                  </View>
                  <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: on ? t.you : t.faint }}>{o.name.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Mono size={8.5} weight="700" track={0.16} tone="faint">CARD DECK</Mono>
          <Mono size={9} tone="faint">The back your opponent&rsquo;s sealed cards show until kickoff.</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SKIN_OPTS.map((o) => {
              const on = skin === o.id;
              const art = CARD_BACKS[o.id];
              return (
                <Pressable key={o.id} onPress={() => onSkin(o.id)} style={{ width: 62, gap: 4 }}>
                  <View
                    style={{
                      width: 62, height: 84, borderRadius: 6, overflow: 'hidden',
                      backgroundColor: '#1A2740',
                      borderWidth: on ? 2 : StyleSheet.hairlineWidth,
                      borderColor: on ? t.you : t.bd,
                    }}
                  >
                    {art ? <Image source={art} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: '700', textAlign: 'center', color: on ? t.you : t.faint }}>
                    {o.name.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 14 }}>
          <Mono size={8.5} weight="700" track={0.16} tone="faint">MORE</Mono>
          {/* No Commissioner entry here anymore: commissioner tools are the
              ⚑ COMMISH tab inside each league you run — where the league is,
              not in a global menu that then asks which league you meant. */}
          {isAdmin && (
            <Pressable
              onPress={() => { onClose(); onAdmin(); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 11 }}
            >
              <Text style={{ fontSize: 16 }}>◆</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: t.text }}>Admin</Text>
                <Mono size={9} tone="faint">Health, leagues, code requests, audit.</Mono>
              </View>
            </Pressable>
          )}
          <Pressable
            onPress={() => { onClose(); onDemo(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 11 }}
          >
            <Text style={{ fontSize: 16 }}>▶</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.text }}>Demo board</Text>
              <Mono size={9} tone="faint">A real 2025 week, replayed. Not your matchup.</Mono>
            </View>
          </Pressable>
          <Pressable
            onPress={() => { onClose(); onSignOut(); }}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 11, alignItems: 'center' }}
          >
            <Mono size={11} weight="700" tone="dim" track={0.06}>SIGN OUT</Mono>
          </Pressable>
        </View>
      </ScrollView>
    </Overlay>
  );
}


// ── Push notification prefs (0150) ──────────────────────────────────────────
// Per-device mutes for the four push kinds; the toggles bite the token this
// device registered this session. Without one (permission denied, or a build
// with no Firebase config) the section offers a single ENABLE button.
const PUSH_KINDS: { key: string; label: string }[] = [
  { key: 'lineup', label: '⚠ lineup locks soon' },
  { key: 'chat', label: '💬 mentions & DMs' },
  { key: 'trades', label: '⇄ trade offers' },
  { key: 'waivers', label: '✚ waiver results' },
  { key: 'draft', label: '⛏ draft alerts' },
];

export function PushPrefs() {
  const t = useTheme();
  const [token, setToken] = useState<string | null>(registeredPushToken());
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    myPushTokens().then((rows) => {
      const mine = rows.find((r) => r.token === token);
      if (mine) setPrefs(mine.prefs ?? {});
    }).catch(() => {});
  }, [token]);
  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try { if (await registerForPush()) setToken(registeredPushToken()); }
    finally { setBusy(false); }
  };
  const toggle = (key: string) => {
    if (!token) return;
    const next = { ...prefs, [key]: prefs[key] === false };
    setPrefs(next);
    track(Ev.pushPrefSet, { kind: key, muted: next[key] === false });
    void setPushPrefs(token, next).catch(() => {});
  };
  return (
    <View style={{ gap: 8 }}>
      <Mono size={8.5} weight="700" track={0.16} tone="faint">NOTIFICATIONS</Mono>
      {!token ? (
        <Pressable onPress={() => void enable()} disabled={busy}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingVertical: 9, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.you }}>🔔 ENABLE PUSH NOTIFICATIONS</Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {PUSH_KINDS.map((k) => {
            const on = prefs[k.key] !== false;
            return (
              <Pressable key={k.key} onPress={() => toggle(k.key)}
                style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: on ? alpha(t.you, 12) : t.surface }}>
                <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: on ? t.you : t.dim }}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
