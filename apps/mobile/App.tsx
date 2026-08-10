// App root. Deliberately thin: this exists to prove the shell — theme context,
// safe areas, session — around the one ported screen. Navigation arrives with
// the second screen; a stack with a single route would be scaffolding for its
// own sake.
import { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuth } from '@drip/core/data/liveApi';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { THEMES, ThemeCtx, loadTheme, isLight } from './src/theme.native';
import { LivePicks } from './src/screens/LivePicks';

export function App() {
  const [themeName] = useState(loadTheme);
  const theme = THEMES[themeName];
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!liveConfigured()) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); }).catch(() => setReady(true));
    const un = onAuth((s) => setSession(s));
    return () => { un?.(); };
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
            <Placeholder
              title="Live mode isn’t configured"
              body="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in app.json → expo.extra, then reload."
            />
          ) : !session ? (
            // Sign-in is LiveOnboard's job on web (1,541 lines). Until that's
            // ported, sign in on the web app — the session is the same account
            // either way, so nothing is lost by doing it there first.
            <Placeholder
              title="Sign in on the web first"
              body="This build ports the picks screen only. Sign in at dripfantasy.com; the onboarding flow lands in the next pass."
            />
          ) : (
            <LivePicks userId={session.user.id} onBack={() => {}} />
          )}
        </SafeAreaView>
      </ThemeCtx.Provider>
    </SafeAreaProvider>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  const theme = THEMES[loadTheme()];
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 12, color: theme.dim, textAlign: 'center', lineHeight: 18 }}>{body}</Text>
    </View>
  );
}
