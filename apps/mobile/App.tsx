// App root: theme, safe areas, and the session gate.
//
// Routing is a single piece of state rather than a navigator. Three screens,
// one of which is a modal-ish gate, and the only transition is
// leagues → lineup → back. @react-navigation was removed when it turned out to
// be shipping a native library nothing imported; bring it back when there is a
// real stack (a tab bar, deep links into a screen, a back gesture that has to
// feel native) rather than to model one push.
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuth, signOut } from '@drip/core/data/liveApi';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { THEMES, ThemeCtx, loadTheme, isLight, MONO } from './src/theme.native';
import { Leagues } from './src/screens/Leagues';
import { LivePicks } from './src/screens/LivePicks';
import { SignIn } from './src/screens/SignIn';
import { ErrorBoundary } from './src/ui/ErrorBoundary';

interface OpenLeague { leagueId: string; rosterId: number; name: string }

export function App() {
  const [themeName] = useState(loadTheme);
  const theme = THEMES[themeName];
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<OpenLeague | null>(null);

  useEffect(() => {
    if (!liveConfigured()) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); }).catch(() => setReady(true));
    // Covers sign-out, token refresh and the sign-in this app performs.
    const un = onAuth((s) => { setSession(s); if (!s) setOpen(null); });
    return () => { un?.(); };
  }, []);

  const refreshSession = useCallback(() => {
    getSession().then(setSession).catch(() => {});
  }, []);

  const body = () => {
    if (!ready) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.you} />
        </View>
      );
    }
    if (!liveConfigured()) {
      // Unreachable with the defaults baked into liveConfig.ts; kept for a build
      // that deliberately points at nothing.
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text, textAlign: 'center' }}>Live mode isn’t configured</Text>
          <Text style={{ fontSize: 12, color: theme.dim, textAlign: 'center', lineHeight: 18 }}>
            This build has no Supabase project. See apps/mobile/app.config.js.
          </Text>
        </View>
      );
    }
    if (!session) return <SignIn onSignedIn={refreshSession} />;

    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 10 }}>
          {open ? (
            <Pressable onPress={() => setOpen(null)} hitSlop={10} style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: theme.you }}>← {open.name}</Text>
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: 9, color: theme.faint }}>
              {session.user.email}
            </Text>
          )}
          <Pressable onPress={() => { void signOut(); }} hitSlop={10}>
            <Text style={{ fontFamily: MONO, fontSize: 9, color: theme.dim }}>sign out</Text>
          </Pressable>
        </View>

        {open ? (
          <LivePicks
            // Remounts when you switch leagues, so no state leaks between them.
            key={`${open.leagueId}-${open.rosterId}`}
            userId={session.user.id}
            leagueId={open.leagueId}
            rosterId={open.rosterId}
            onBack={() => setOpen(null)}
          />
        ) : (
          <Leagues
            userId={session.user.id}
            onOpen={(leagueId, rosterId, name) => setOpen({ leagueId, rosterId, name })}
          />
        )}
      </View>
    );
  };

  return (
    <SafeAreaProvider>
      <ThemeCtx.Provider value={theme}>
        <StatusBar style={isLight(themeName) ? 'dark' : 'light'} />
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'left', 'right']}>
          <ErrorBoundary>{body()}</ErrorBoundary>
        </SafeAreaView>
      </ThemeCtx.Provider>
    </SafeAreaProvider>
  );
}
