// "UPDATE READY — TAP TO RESTART" (v0.654.4). Founder: "Do we need a refresh
// button in the app?" Not a general one: the app already checks for an
// over-the-air update at launch and on every return to the foreground
// (src/updates.ts). What it couldn't do was APPLY one on demand — a
// downloaded update waited for five minutes away or a cold start, so after
// "it's fixed, update your app" a player could close and reopen twice and
// still be on the old code. This strip shows only while a downloaded update
// is waiting; a tap restarts into it (about a second of splash).
//
// expo-updates' own state, not ours: isUpdatePending covers the update the
// launch check downloaded as well as the ones updates.ts fetches on a
// foreground. A dev build (updates disabled) never has one pending.
import { Pressable, Text } from 'react-native';
import * as Updates from 'expo-updates';
import { tap } from './feedback';
import { applyOtaUpdate } from '../updates';
import { useTheme, MONO } from '../theme.native';

/** True while an over-the-air update is downloaded and not yet running. */
export function useOtaReady(): boolean {
  return Updates.useUpdates().isUpdatePending;
}

/** The strip under the header. Renders nothing unless an update is waiting. */
export function OtaReadyStrip({ ready }: { ready: boolean }) {
  const t = useTheme();
  if (!ready) return null;
  return (
    // Above the folding header, for the same reason as WhatsNewBanner.
    <Pressable onPress={() => { tap(); applyOtaUpdate(); }} accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: t.you, zIndex: 10, elevation: 10 }}>
      <Text style={{ fontSize: 12 }}>↻</Text>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: t.onAccent }}>
        AN UPDATE IS READY
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.onAccent, opacity: 0.85 }}>TAP TO RESTART →</Text>
    </Pressable>
  );
}
