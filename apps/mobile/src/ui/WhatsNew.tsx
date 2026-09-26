// "YOU ARE N VERSIONS BEHIND" (v0.393.0). Founder: "Can we have an in-app
// check that alerts users if they have an older version — click for change
// log." The banner sits under the header on every screen while this build
// is older than the apk-latest release; tapping it opens What's New — the
// entries between this build and the newest, from the site's changelog.json —
// with the download button. The check runs at launch and whenever the app
// returns to the foreground; either fetch failing just means no banner.
//
// Two facts, two sources, deliberately: the NEWEST APK is what release-apk.yml
// published (manifest.json beside the APK), and WHAT CHANGED is the site's
// changelog (STATUS.md, generated at web build). Web-only entries count for
// the list but not for the number — they are not a reason to reinstall.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { tap } from './feedback';
import { openLink } from './openLink';
import { APP_VERSION } from '@drip/core/version';
import { APK_MANIFEST_URL, APK_ZIP_URL, CHANGELOG_PAGE_URL, CHANGELOG_URL, entriesBehind, versionsBehind, type ApkManifest, type Changelog, type ChangelogEntry } from '@drip/core/data/changelog';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';

const MINE = APP_VERSION.replace(/^v/, '');

export interface UpdateState { latest: string | null; behind: number; entries: ChangelogEntry[]; checked: boolean }

export function useUpdateCheck(): UpdateState & { refresh: () => void } {
  const [st, setSt] = useState<UpdateState>({ latest: null, behind: 0, entries: [], checked: false });
  const busy = useRef(false);
  const refresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    (async () => {
      try {
        const [mRes, cRes] = await Promise.all([
          fetch(`${APK_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' }),
          fetch(`${CHANGELOG_URL}?t=${Date.now()}`, { cache: 'no-store' }),
        ]);
        const manifest = mRes.ok ? (await mRes.json() as ApkManifest) : null;
        const log = cRes.ok ? (await cRes.json() as Changelog) : null;
        const latest = manifest?.version?.replace(/^v/, '') ?? null;
        const entries = log?.entries ?? [];
        setSt({
          latest,
          behind: latest ? versionsBehind(entries, MINE, latest, { appOnly: true }) : 0,
          entries: latest ? entriesBehind(entries, MINE, latest) : [],
          checked: true,
        });
      } catch { setSt((s) => ({ ...s, checked: true })); }
      finally { busy.current = false; }
    })();
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);
  return { ...st, refresh };
}

/** The strip under the header. Renders nothing while current or unchecked. */
export function WhatsNewBanner({ st, onOpen }: { st: UpdateState; onOpen: () => void }) {
  const t = useTheme();
  if (!st.latest || st.behind <= 0) return null;
  return (
    // ABOVE THE FOLDING TOP (v0.556.1, founder: "I am having trouble clicking
    // the you are x versions behind banner"). App.tsx's folding header sits at
    // zIndex 2 and, once a screen scrolls, slides up by its own height at
    // opacity 0 — straight over this strip. Invisible views still take
    // touches, so the banner stopped answering after any scroll. Raised above
    // it (zIndex + elevation, the latter for Android's stacking), the header
    // now folds away underneath instead.
    <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: t.you, zIndex: 10, elevation: 10 }}>
      <Text style={{ fontSize: 12 }}>⬆</Text>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: t.onAccent }}>
        YOU ARE {st.behind} {st.behind === 1 ? 'VERSION' : 'VERSIONS'} BEHIND · v{st.latest} IS OUT
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.onAccent, opacity: 0.85 }}>WHAT'S NEW →</Text>
    </Pressable>
  );
}

/** The sheet: what you'd get by updating, and the button that gets it. */
export function WhatsNewSheet({ visible, st, onClose }: { visible: boolean; st: UpdateState; onClose: () => void }) {
  const t = useTheme();
  const behind = st.latest ? st.behind : 0;
  const sub = st.latest
    ? (behind > 0 ? `THIS BUILD ${APP_VERSION.toUpperCase()} · NEWEST V${st.latest.toUpperCase()}` : `${APP_VERSION.toUpperCase()} · YOU ARE ON THE NEWEST BUILD`)
    : `${APP_VERSION.toUpperCase()}${st.checked ? ' · COULDN’T REACH THE RELEASE' : ' · CHECKING…'}`;
  return (
    <Overlay visible={visible} title="What's new" subtitle={sub} onClose={onClose}
      footer={(
        <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
          {/* v0.410.0: THE ZIP. This button matters most of all — it opens a
              browser ON THE PHONE, which is exactly where a file served as an
              Android package stalls at 100%. Founder, after testing both: "zip
              downloaded fine, make it the default for android." Unzip and tap
              the APK inside. */}
          {behind > 0 && (
            <Pressable onPress={() => { tap(); void openLink(APK_ZIP_URL); }}
              style={({ pressed }) => ({ flex: 1, alignItems: 'center', backgroundColor: t.you, borderRadius: 8, paddingVertical: 11, opacity: pressed ? 0.55 : 1 })}>
              <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: t.onAccent }}>⬇ GET V{st.latest?.toUpperCase()} (ZIP)</Text>
            </Pressable>
          )}
          <Pressable onPress={() => { tap(); void openLink(CHANGELOG_PAGE_URL); }}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingVertical: 11, opacity: pressed ? 0.55 : 1 })}>
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: t.dim }}>FULL LOG ON THE SITE ↗</Text>
          </Pressable>
        </View>
      )}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
        {behind > 0 && (
          <Mono size={9.5} tone="dim">
            {behind} {behind === 1 ? 'update' : 'updates'} for the app since this build. Installing the new APK keeps your sign-in and settings.
          </Mono>
        )}
        {st.entries.length === 0 && (
          <Mono size={9.5} tone="faint">{st.checked ? 'Nothing newer than this build.' : 'Checking…'}</Mono>
        )}
        {st.entries.map((e) => (
          <View key={e.version} style={{ gap: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <Mono size={9} weight="700" tone="you" track={0.08}>v{e.version}</Mono>
              <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: '700', color: t.text }}>{e.title}</Text>
              {e.webOnly && <Mono size={7.5} tone="faint" track={0.1}>WEB ONLY</Mono>}
            </View>
            <Mono size={9.5} tone="dim">{e.notes}</Mono>
          </View>
        ))}
      </ScrollView>
    </Overlay>
  );
}
