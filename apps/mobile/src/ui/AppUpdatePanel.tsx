// APP UPDATE, SAID OUT LOUD (v0.655.2). Founder, after "switch away and come
// back" didn't move the label: "It's not working." The update machinery
// (src/updates.ts, ui/OtaReady.tsx) swallows its errors by design, so when
// an over-the-air update doesn't arrive nobody — founder or Claude — can see
// why. This panel in Settings says which code is running (built into the APK,
// or which over-the-air update and when it was published), flags an
// EMERGENCY LAUNCH (expo-updates fell back because the update it had failed
// to start), and gives CHECK FOR UPDATE: check → download → restart, every
// step and every error in words.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { APP_VERSION } from '@drip/core/version';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { tap } from './feedback';

const when = (d: Date | null | undefined) => {
  if (!d || !Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function AppUpdatePanel() {
  const t = useTheme();
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = Updates.isEnabled;
  const running = !enabled ? 'updates are off in this build'
    : Updates.isEmbeddedLaunch ? 'the code built into this install'
    : `update ${String(Updates.updateId ?? '').slice(0, 8)}${Updates.createdAt ? `, published ${when(Updates.createdAt)}` : ''}`;

  const check = async () => {
    if (busy || !enabled) return;
    setBusy(true);
    try {
      setState('Checking…');
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) { setState('✓ You’re on the newest update.'); return; }
      setState('Downloading the new update…');
      const f = await Updates.fetchUpdateAsync();
      if (!f.isNew) { setState('✓ Nothing new to download.'); return; }
      setState('Downloaded — restarting…');
      await Updates.reloadAsync();
    } catch (e) {
      setState(`Couldn’t update: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ paddingVertical: 8, gap: 4 }}>
      <Mono size={9} tone="faint" track={0.1}>APP UPDATE</Mono>
      <Mono size={10} tone="dim">Running {APP_VERSION} · {running}</Mono>
      {enabled && !!Updates.channel && <Mono size={9} tone="faint">channel {Updates.channel} · runtime {String(Updates.runtimeVersion ?? '').slice(0, 8)}</Mono>}
      {enabled && Updates.isEmergencyLaunch && (
        <Mono size={10} tone="opp">⚠ The last downloaded update failed to start, so the app fell back: {Updates.emergencyLaunchReason ?? 'no reason given'}</Mono>
      )}
      {!!state && <Mono size={10} tone={state.startsWith('✓') ? 'you' : state.startsWith('Couldn') ? 'opp' : 'dim'}>{state}</Mono>}
      {enabled && (
        <Pressable onPress={() => { tap(); void check(); }} disabled={busy} accessibilityRole="button"
          style={{ alignSelf: 'flex-start', marginTop: 4, borderRadius: 999, borderWidth: 1, borderColor: t.you, paddingHorizontal: 12, paddingVertical: 6, opacity: busy ? 0.5 : 1 }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: t.you }}>{busy ? 'WORKING…' : '↻ CHECK FOR UPDATE'}</Text>
        </Pressable>
      )}
    </View>
  );
}
