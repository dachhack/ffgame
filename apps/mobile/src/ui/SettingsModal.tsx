// Settings — the gear, matching the web's SiteSettings.
//
// Same six themes and same ten card decks, under the same names, because they
// are the same product and a player who picks "Night Rider" on the web should
// find it here. The tokens are literally shared (@drip/core/theme); the decks
// are the same art, bundled under assets/cardbacks (as WebP since v0.502.0).
//
// The card skin was already half-wired before this existed: cards.tsx reads
// `gc-cardskin` out of storage on every render and picks a back from it. Nothing
// in the app ever WROTE that key, so every deck but the default was unreachable.
// This is the writer.
//
// The demo board (a scripted 2025 week) lived in here until v0.502.0, when the
// 2025 bake left the app with it.

import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { THEMES, type ThemeName, useTheme, MONO, alpha } from '../theme.native';
import { Mono } from './prims';
import { VoicePicker } from './VoicePicker';
import { DevyValues } from './DevyValues';
import { rehearsalToolsOn, setRehearsalTools } from '@drip/core/data/rehearsalTools';
import { Ev, track } from '@drip/core/analytics';
import { useEffect, useState } from 'react';
import { myPushTokens, setPushPrefs, myLeagueChatPush, setLeagueChatPush, pushTest, myPushLog, pushLogStatus, friendlyError, getSession, deleteMyAccount, type PushLogRow } from '@drip/core/data/liveApi';
import { registerForPush, registeredPushToken } from './push';
import { tap } from './feedback';
import { Overlay } from './Overlay';
import { allWidgetLeagues, widgetHiddenLeagues, setWidgetHiddenLeagues, type WidgetLeague } from '@drip/core/data/widgetFeed';
import { refreshMatchupWidgets } from '../widget/widgetTask';
import { refreshExtraWidgets } from '../widget/extraTasks';
import { fieldsPick, setFieldsPick, FIELDS_SPORTS, FIELDS_PENDING, sportTeamsOf, type FieldsPick } from '@drip/core/data/fieldsPick';
import { sportGamesBetween, type SportGameRow } from '@drip/core/data/liveApi';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { currentSeason, addDays } from '@drip/core/sports/league';
import { sportToday } from '@drip/core/sports/slate';
import { Chip } from './prims';
import { CARD_BACKS, CARD_SIZES, type CardSkin, type CardSize } from './cards';

/** Theme ids with the web's display names. Order matches the web menu. */
const THEME_OPTS: { id: ThemeName; name: string }[] = [
  { id: 'neon', name: 'Drip' },
  { id: 'slate', name: 'Night Rider' },
  { id: 'dusk', name: 'Deep Thoughts' },
  { id: 'prime', name: 'All Gold' },
  { id: 'daylight', name: 'Feeling Lucky' },
  { id: 'arctic', name: 'Arctic Journey' },
  // Colorblind-accessible pair (v0.379.0): blue-vs-orange instead of
  // green-vs-red, luminance-separated — dark and light.
  { id: 'clarity', name: 'True Colors' },
  { id: 'lumen', name: 'Plain Sight' },
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

export function SettingsModal({ visible, theme, skin, cardSize, version, isAdmin, onTheme, onSkin, onCardSize, onAdmin, onSignOut, onWhatsNew, behind = 0, onClose }: {
  visible: boolean;
  theme: ThemeName;
  skin: CardSkin;
  cardSize: CardSize;
  version: string;
  /** Opens What's New (v0.393.0); `behind` is how many app updates are newer than this build. */
  onWhatsNew?: () => void;
  behind?: number;
  /** Resolved from is_admin(). Only decides whether the entry is SHOWN — the
   *  RPCs behind it are the real gate, as they are on the web. */
  isAdmin?: boolean;
  onTheme: (t: ThemeName) => void;
  onSkin: (s: CardSkin) => void;
  onCardSize: (s: CardSize) => void;
  onAdmin: () => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  // THE GEAR IS A MENU NOW (v0.487.0). Founder: "the app settings menu. It's
  // huge. Can we make a tiny pop-up when you hit the gear that allows you to
  // pick categories then options?" Every option used to be on one scroll —
  // notifications, a push log, eight themes, three sizes, nine decks, a voice
  // list — so finding one meant scrolling past all the others. The sheet opens
  // on a short list of categories, each showing what it is set to; a tap opens
  // just that category's options, ‹ goes back. The options themselves are the
  // same controls as before, moved, not rebuilt.
  const [section, setSection] = useState<Section | null>(null);
  // Every open starts at the menu — reopening onto a sub-page you left an hour
  // ago is a surprise, not a convenience.
  useEffect(() => { if (visible) setSection(null); }, [visible]);
  const themeName = THEME_OPTS.find((o) => o.id === theme)?.name ?? theme;
  const skinName = SKIN_OPTS.find((o) => o.id === skin)?.name ?? skin;
  const sizeName = CARD_SIZES.find((o) => o.id === cardSize)?.name ?? cardSize;
  const sections: { id: Section; icon: string; name: string; value: string }[] = [
    { id: 'notifications', icon: '🔔', name: 'Notifications', value: 'alerts, test push, recent pushes' },
    { id: 'theme', icon: '🎨', name: 'Color theme', value: themeName },
    { id: 'cards', icon: '🃏', name: 'Cards', value: `${sizeName} · ${skinName}` },
    { id: 'voice', icon: '🔊', name: 'Play-by-play voice', value: 'the voice that reads plays aloud' },
    // v0.601.0: StatHead-based devy values, 1QB and SF, for every player.
    { id: 'devy', icon: '🎓', name: 'Devy values', value: '1QB & SF, refreshed with each StatHead board' },
    // A home-screen widget is Android's (react-native-android-widget).
    ...(Platform.OS === 'android' ? [{ id: 'widget' as Section, icon: '📱', name: 'Home-screen widget', value: 'leagues · fields across sports' }] : []),
    ...(isAdmin ? [{ id: 'rehearsal' as Section, icon: '🧪', name: 'Rehearsal tools', value: 'sim strip on test boards' }] : []),
    // 0422: the way out — delete the account from the app (Apple 5.1.1(v)).
    { id: 'account', icon: '🗑', name: 'Account', value: 'delete my account' },
  ];
  const current = sections.find((x) => x.id === section);
  return (
    <Overlay visible={visible} title={current ? current.name : 'Settings'} subtitle={`DRIP FANTASY ${version.toUpperCase()}`} onClose={onClose}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: section ? 18 : 8 }}>
        {section ? (
          <>
            <Pressable hitSlop={8} onPress={() => { tap(); setSection(null); }} style={{ alignSelf: 'flex-start' }}>
              <Mono size={10} weight="700" tone="dim" track={0.08}>‹ ALL SETTINGS</Mono>
            </Pressable>
            {section === 'notifications' && <PushPrefs />}
            {section === 'theme' && (
              <View style={{ gap: 8 }}>
                <Mono size={8.5} weight="700" track={0.16} tone="faint">COLOR THEME</Mono>
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

            )}
            {section === 'cards' && (
              <View style={{ gap: 18 }}>
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

              </View>
            )}
            {section === 'voice' && <VoicePicker />}
            {section === 'devy' && <DevyValues />}
            {section === 'account' && <DeleteAccount onDeleted={() => { onClose(); onSignOut(); }} />}
            {section === 'widget' && <><WidgetLeaguesPicker /><FieldsPicker /></>}
            {section === 'rehearsal' && isAdmin && <RehearsalToggle />}
          </>
        ) : (
          <>
            {sections.map((x) => (
              <Pressable key={x.id} onPress={() => { tap(); setSection(x.id); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{x.icon}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{x.name}</Text>
                  <Mono size={9} tone="faint">{x.value}</Mono>
                </View>
                <Text style={{ fontSize: 18, color: t.faint }}>›</Text>
              </Pressable>
            ))}
            {/* The one-tap actions: no options behind them, so no › and no
                second line — they only need to be findable, not described. */}
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 4, paddingTop: 2 }}>
              {isAdmin && <ActionRow icon="◆" label="Admin" onPress={() => { onClose(); onAdmin(); }} />}
              {onWhatsNew && (
                <ActionRow icon="🆕" label="What's new" onPress={() => { onClose(); onWhatsNew(); }}
                  hint={behind > 0 ? `${behind} behind — update` : version} strong={behind > 0} />
              )}
              <ActionRow icon="⎋" label="Sign out" onPress={() => { onClose(); onSignOut(); }} />
            </View>
          </>
        )}
      </ScrollView>
    </Overlay>
  );
}

type Section = 'notifications' | 'theme' | 'cards' | 'voice' | 'devy' | 'widget' | 'rehearsal' | 'account';

/** One compact line in the menu's lower half: an action, not a category. */
/** DELETE MY ACCOUNT (0422). Type the email back to confirm. A commissioner of
 *  a league with other members is refused by name until the league has
 *  another commissioner or is deleted. */
function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const t = useTheme();
  const [email, setEmail] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getSession().then((s) => setEmail(s?.user.email ?? '')).catch(() => setEmail('')); }, []);
  const match = !!email && typed.trim().toLowerCase() === email.trim().toLowerCase();
  const go = async () => {
    if (!match || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await deleteMyAccount(typed);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'could not delete the account')); return; }
      onDeleted();
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ padding: 14, gap: 10 }}>
      <Text style={{ fontSize: 13, lineHeight: 19, color: t.dim }}>
        Your account and its personal details are removed for good. Leagues you played in keep their results, with your seat shown by team name.
        If you commission a league with other members, hand it to someone else or delete it first.
      </Text>
      <Mono size={9} tone="faint" track={0.12}>{email ? `TYPE ${email.toUpperCase()} TO CONFIRM` : 'TYPE YOUR EMAIL TO CONFIRM'}</Mono>
      <TextInput value={typed} onChangeText={(v) => { setTyped(v); setErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
        placeholder={email ?? ''} placeholderTextColor={t.faint}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 9, fontFamily: MONO, fontSize: 14, color: t.text, backgroundColor: t.bg }} />
      <Pressable onPress={() => { tap(); void go(); }} disabled={!match || busy}
        style={{ backgroundColor: t.opp, borderRadius: 7, paddingVertical: 12, alignItems: 'center', opacity: !match || busy ? 0.5 : 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.7, color: '#fff' }}>{busy ? '…' : 'DELETE MY ACCOUNT'}</Text>
      </Pressable>
      {!!err && <Mono size={10.5} tone="opp">{err}</Mono>}
    </View>
  );
}

function ActionRow({ icon, label, hint, strong, onPress }: {
  icon: string; label: string; hint?: string; strong?: boolean; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tap(); onPress(); }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 9 }}>
      <Text style={{ fontSize: 14, width: 22, textAlign: 'center', color: t.dim }}>{icon}</Text>
      <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: strong ? t.you : t.text }}>{label}</Text>
      {!!hint && <Mono size={9} tone={strong ? 'you' : 'faint'}>{hint}</Mono>}
    </Pressable>
  );
}

// 📱 THE WIDGET'S LEAGUES (v0.503.0). Founder: "we also need in the settings,
// the ability for users to pick which leagues show up in the widget." One
// switch per league; ▸ NEXT on the widget then walks only the ones left on.
// What is stored is the HIDDEN list (core widgetFeed), so a league joined
// later shows up without a visit here. The last league on can't be switched
// off — a widget has to show something. Every change repaints the widgets.
function WidgetLeaguesPicker() {
  const t = useTheme();
  const [leagues, setLeagues] = useState<WidgetLeague[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => widgetHiddenLeagues());
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    allWidgetLeagues(true).then((l) => { if (alive) setLeagues(l); }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);
  const shown = (leagues ?? []).filter((l) => !hidden.has(l.id)).length;
  const flip = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else if (shown <= 1) return;
    else next.add(id);
    tap();
    setHidden(next);
    setWidgetHiddenLeagues(next);
    void refreshMatchupWidgets();
  };
  return (
    <View style={{ gap: 8 }}>
      <Mono size={8.5} weight="700" track={0.16} tone="faint">📱 LEAGUES ON THE WIDGET</Mono>
      {err && <Mono size={10} tone="opp">Couldn't load your leagues.</Mono>}
      {!err && leagues === null && <Mono size={10} tone="faint">Loading your leagues…</Mono>}
      {leagues?.length === 0 && <Mono size={10} tone="faint">No leagues yet — join one and it appears here.</Mono>}
      {leagues?.map((l) => {
        const on = !hidden.has(l.id);
        const locked = on && shown <= 1;
        return (
          <Pressable key={l.id} onPress={() => flip(l.id)} disabled={locked}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: on ? alpha(t.you, 8) : 'transparent' }}>
            <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: on ? t.you : t.faint, width: 18 }}>{on ? '✓' : '○'}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: on ? t.text : t.dim }}>{l.name}</Text>
              <Mono size={8.5} tone="faint">{l.gameMode === 'classic' ? 'classic' : 'drip'}{locked ? ' · the widget needs one' : ''}</Mono>
            </View>
          </Pressable>
        );
      })}
      <Mono size={8.5} tone="faint">Applies to every Drip widget on your home screen. ▸ NEXT cycles through the leagues switched on.</Mono>
    </View>
  );
}

// 🧪 REHEARSAL TOOLS (v0.393.5) — admin-only, per device, off by default.
// Founder: "let's get rid of all these rehearsals or make them just for me."
// The sim strip on a LIVE TEST league's board renders only while this is on.
function RehearsalToggle() {
  const t = useTheme();
  const [on, setOn] = useState(rehearsalToolsOn());
  const flip = () => { tap(); setRehearsalTools(!on); setOn(!on); };
  return (
    <View style={{ gap: 8 }}>
      <Mono size={8.5} weight="700" track={0.16} tone="faint">🧪 REHEARSAL TOOLS</Mono>
      <Pressable onPress={flip}
        style={{ alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.warn : t.bd, backgroundColor: on ? alpha(t.warn, 12) : t.surface }}>
        <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: on ? t.warn : t.dim }}>{on ? '✓ SIM STRIP ON BOARDS' : 'SIM STRIP HIDDEN'}</Text>
      </Pressable>
      <Mono size={8.5} tone="faint">This phone only. Shows the ▶ SIM / ⏹ RESET strip on LIVE TEST league boards.</Mono>
    </View>
  );
}

// ── Push notification prefs (0150) ──────────────────────────────────────────
// Per-device mutes for the push kinds; the toggles bite the token this device
// registered this session. Without one (permission denied, or a build with no
// Firebase config) the section offers a single ENABLE button.
//
// `leagueId` (0241) adds the one pref that is NOT per-device: whether you want
// every message from THIS league, or only the mentions and DMs everyone gets.
// Rendered only where a league is open — the gear's copy has no league to ask
// about.
const PUSH_KINDS: { key: string; label: string }[] = [
  { key: 'lineup', label: '⚠ lineup locks soon' },
  { key: 'chat', label: '💬 mentions & DMs' },
  { key: 'trades', label: '⇄ trade offers' },
  { key: 'waivers', label: '✚ waiver results' },
  { key: 'draft', label: 'draft alerts' },
  { key: 'members', label: '⚑ new managers' },
  // 0273: the two format events — the guillotine taking your team, a vampire
  // feeding on you. One key, because a manager who wants one wants the other.
  { key: 'format', label: '🪓 chopped & 🩸 bitten' },
];

export function PushPrefs({ leagueId }: { leagueId?: string } = {}) {
  const t = useTheme();
  const [token, setToken] = useState<string | null>(registeredPushToken());
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [allChat, setAllChat] = useState<boolean | null>(null);
  useEffect(() => {
    if (!token) return;
    myPushTokens().then((rows) => {
      const mine = rows.find((r) => r.token === token);
      if (mine) setPrefs(mine.prefs ?? {});
    }).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!leagueId) { setAllChat(null); return; }
    let dead = false;
    myLeagueChatPush(leagueId).then((r) => { if (!dead) setAllChat(!!r?.all_messages); }).catch(() => {});
    return () => { dead = true; };
  }, [leagueId]);
  const flipAllChat = () => {
    if (!leagueId || allChat === null) return;
    const next = !allChat;
    setAllChat(next);
    void setLeagueChatPush(leagueId, next).catch(() => setAllChat(!next));
  };
  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try { if (await registerForPush()) setToken(registeredPushToken()); }
    finally { setBusy(false); }
  };
  // A TEST PUSH AND WHAT BECAME OF IT (0276, v0.392.0). Founder: "not coming
  // through even though I have them on." Polled while the section is open so
  // the row flips from queued to delivered (or to why not) in front of you.
  const [log, setLog] = useState<PushLogRow[] | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const loadLog = () => myPushLog().then((r) => setLog(r.ok ? (r.rows ?? []) : [])).catch(() => {});
  useEffect(() => {
    void loadLog();
    const id = setInterval(() => void loadLog(), 8000);
    return () => clearInterval(id);
  }, []);
  const sendTest = async () => {
    tap();
    setTestMsg(null);
    try {
      const r = await pushTest();
      setTestMsg(r.ok ? `Queued for ${r.devices} device${r.devices === 1 ? '' : 's'} — the worker sends within a minute.` : (r.error ?? 'Could not queue a test.'));
    } catch (x) { setTestMsg(friendlyError(x)); }
    void loadLog();
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
      {!!token && leagueId && allChat !== null && (
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10, gap: 5 }}>
          <Pressable onPress={flipAllChat}
            style={{ borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: allChat ? t.you : t.bd, backgroundColor: allChat ? alpha(t.you, 12) : t.surface }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: allChat ? t.you : t.dim }}>
              {allChat ? '✓ EVERY MESSAGE IN THIS LEAGUE' : 'ONLY MENTIONS & DMs IN THIS LEAGUE'}
            </Text>
          </Pressable>
          <Mono size={8.5} tone="faint">
            Per league, not per device — off still pings you for mentions, DMs and polls.
          </Mono>
        </View>
      )}
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10, gap: 6 }}>
        <Pressable onPress={() => void sendTest()}
          style={{ alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, backgroundColor: alpha(t.you, 12) }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>🔔 SEND ME A TEST PUSH</Text>
        </Pressable>
        {!!testMsg && <Mono size={9} tone="dim">{testMsg}</Mono>}
        {log && log.length > 0 && (
          <View>
            <Mono size={8.5} weight="700" track={0.12} tone="faint" style={{ marginBottom: 4 }}>RECENT PUSHES</Mono>
            {log.map((r) => {
              const st = pushLogStatus(r);
              const color = st.tone === 'ok' ? t.you : st.tone === 'bad' ? t.opp : t.warn;
              return (
                <View key={r.id} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                  <Text style={{ fontFamily: MONO, fontSize: 10, color }}>{st.glyph}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.text }}>{r.title}</Text>
                    <Text style={{ fontFamily: MONO, fontSize: 8.5, color }}>{st.text} · {new Date(r.at).toLocaleString()}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {log && log.length === 0 && <Mono size={8.5} tone="faint">Nothing has been queued for you yet.</Mono>}
      </View>
    </View>
  );
}

// ▦ THE FIELDS WIDGET'S GAMES (v0.631.0). Founder: "a fields widget where the
// user can specify the games across multiple sports that display in the
// widget." Which sports the widget lists, and within a daily sport which
// teams to follow and which single games to show; nothing picked within a
// sport is every game of it. Stored once for every fields widget (core
// fieldsPick); every change repaints them. The NFL's own games follow the
// week and the widget's NFL/CFB chip. Soccer waits for its data.
const fmtStart = (iso: string | null) => {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return 'TBD';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(' ', '').replace(/(AM|PM)/, (m) => m[0].toLowerCase());
};
function FieldsPicker() {
  const t = useTheme();
  const [pick, setPick] = useState<FieldsPick>(() => fieldsPick());
  const [slates, setSlates] = useState<Partial<Record<Sport, SportGameRow[] | null>>>({});
  const save = (next: FieldsPick) => { setPick(next); setFieldsPick(next); void refreshExtraWidgets({ fresh: true }); };
  const daily = pick.sports.filter((s) => s !== 'nfl' && !FIELDS_PENDING.has(s));
  // The next week of each picked sport, read once per visit, for the team
  // chips and the game list.
  useEffect(() => {
    let alive = true;
    for (const sp of daily) {
      if (slates[sp] !== undefined) continue;
      setSlates((cur) => ({ ...cur, [sp]: null }));
      const today = sportToday(new Date());
      sportGamesBetween(sp, currentSeason(sp), today, addDays(today, 6))
        .then((rows) => { if (alive) setSlates((cur) => ({ ...cur, [sp]: rows })); })
        .catch(() => { if (alive) setSlates((cur) => ({ ...cur, [sp]: [] })); });
    }
    return () => { alive = false; };
  }, [daily.join(','), slates]);
  const flipSport = (sp: Sport) => {
    const on = pick.sports.includes(sp);
    const sports = on ? pick.sports.filter((x) => x !== sp) : [...pick.sports, sp];
    if (!sports.length) return;
    tap(); save({ ...pick, sports });
  };
  const flipIn = (kind: 'teams' | 'games', sp: Sport, v: string) => {
    const cur = pick[kind][sp] ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    tap(); save({ ...pick, [kind]: { ...pick[kind], [sp]: next } });
  };
  return (
    <View style={{ gap: 8, marginTop: 14 }}>
      <Mono size={8.5} weight="700" track={0.16} tone="faint">▦ FIELDS WIDGET · SPORTS</Mono>
      <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
        {FIELDS_SPORTS.map((sp) => (
          <Chip key={sp} label={FIELDS_PENDING.has(sp) ? `${SPORTS[sp].league} · soon` : SPORTS[sp].league} on={pick.sports.includes(sp)} disabled={FIELDS_PENDING.has(sp)} dim={FIELDS_PENDING.has(sp)}
            onPress={() => flipSport(sp)} />
        ))}
      </View>
      <Mono size={8.5} tone="faint">The widget lists every sport switched on: the NFL week (or college, from the widget's own chip), then each sport's games today and the next two days. Pick teams or single games below to narrow a sport; nothing picked is every game.</Mono>
      {daily.map((sp) => {
        const rows = slates[sp];
        const teams = rows ? sportTeamsOf(rows) : [];
        const picked = pick.teams[sp] ?? [], pickedGames = pick.games[sp] ?? [];
        return (
          <View key={sp} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10, gap: 6 }}>
            <Mono size={9} weight="700" tone="you">{SPORTS[sp].league} · {pickedGames.length ? `${pickedGames.length} game${pickedGames.length === 1 ? '' : 's'} picked` : picked.length ? `${picked.length} team${picked.length === 1 ? '' : 's'} followed` : 'every game'}</Mono>
            {rows === null && <Mono size={8.5} tone="faint">Reading the week's slate…</Mono>}
            {rows && rows.length === 0 && <Mono size={8.5} tone="faint">No games on the slate this week — the sweep fills it daily.</Mono>}
            {teams.length > 0 && (
              <>
                <Mono size={8} tone="faint" track={0.1}>TEAMS TO FOLLOW</Mono>
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                  {teams.map((tm) => <Chip key={tm} label={tm} on={picked.includes(tm)} onPress={() => flipIn('teams', sp, tm)} />)}
                </View>
              </>
            )}
            {rows && rows.length > 0 && (
              <>
                <Mono size={8} tone="faint" track={0.1}>GAMES · NEXT 7 DAYS</Mono>
                {rows.filter((r) => r.status !== 'cancelled').slice(0, 40).map((r) => {
                  const on = pickedGames.includes(r.game_id);
                  return (
                    <Pressable key={r.game_id} onPress={() => flipIn('games', sp, r.game_id)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                      <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: on ? t.you : t.faint, width: 16 }}>{on ? '✓' : '○'}</Text>
                      <Text style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: on ? t.text : t.dim, flex: 1 }}>{r.away} @ {r.home}</Text>
                      <Mono size={8.5} tone="faint">{r.status === 'final' ? 'FINAL' : r.status === 'live' ? 'LIVE' : r.status === 'postponed' ? 'PPD' : fmtStart(r.start_utc)}</Mono>
                    </Pressable>
                  );
                })}
              </>
            )}
            {(picked.length > 0 || pickedGames.length > 0) && (
              <Chip label="SHOW EVERY GAME" on={false} onPress={() => { tap(); save({ ...pick, teams: { ...pick.teams, [sp]: [] }, games: { ...pick.games, [sp]: [] } }); }} />
            )}
          </View>
        );
      })}
    </View>
  );
}
