// App root. Still thin: theme context, safe areas, and the session gate around
// the ported screens. Navigation arrives with the third screen; a stack for two
// routes that are really one branch would be scaffolding for its own sake.
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuth, signOut } from '@drip/core/data/liveApi';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { THEMES, ThemeCtx, loadTheme, isLight, MONO } from './src/theme.native';
import { LivePicks } from './src/screens/LivePicks';
import { SignIn } from './src/screens/SignIn';

export function App() {
  const [themeName] = useState(loadTheme);
  const theme = THEMES[themeName];
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!liveConfigured()) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); }).catch(() => setReady(true));
    // Covers sign-out, token refresh and the sign-in this app performs, so the
    // gate below never goes stale.
    const un = onAuth((s) => setSession(s));
    return () => { un?.(); };
  }, []);

  // SignIn calls this once it has a session; onAuth normally fires too, but
  // re-reading makes the handoff independent of subscription timing.
  const refreshSession = useCallback(() => {
    getSession().then(setSession).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeCtx.Provider value={theme}>
        <StatusBar style={isLight(themeName) ? 'dark' : 'light'} />
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'left', 'right']}>
          {!ready ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={theme.you} />
            </View>
          ) : !liveConfigured() ? (
            // Unreachable with the defaults baked into liveConfig.ts; kept for a
            // build that deliberately points at nothing.
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text, textAlign: 'center' }}>Live mode isn’t configured</Text>
              <Text style={{ fontSize: 12, color: theme.dim, textAlign: 'center', lineHeight: 18 }}>
                This build has no Supabase project. See apps/mobile/app.config.js.
              </Text>
            </View>
          ) : !session ? (
            <SignIn onSignedIn={refreshSession} />
          ) : (
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9, color: theme.faint }} numberOfLines={1}>
                  {session.user.email}
                </Text>
                <Pressable onPress={() => { void signOut(); }} hitSlop={10}>
                  <Text style={{ fontFamily: MONO, fontSize: 9, color: theme.dim }}>sign out</Text>
                </Pressable>
              </View>
              <LivePicks userId={session.user.id} onBack={() => {}} />
            </View>
          )}
        </SafeAreaView>
      </ThemeCtx.Provider>
    </SafeAreaProvider>
  );
}
