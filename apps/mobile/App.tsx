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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuth, signOut } from '@drip/core/data/liveApi';
import { APP_VERSION } from '@drip/core/version';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { THEMES, ThemeCtx, loadTheme, isLight, MONO } from './src/theme.native';
import { Leagues } from './src/screens/Leagues';
import { LivePicks } from './src/screens/LivePicks';
import { LiveBoard } from './src/screens/LiveBoard';
import { DemoBoard } from './src/screens/DemoBoard';
import { SignIn } from './src/screens/SignIn';
import { ErrorBoundary } from './src/ui/ErrorBoundary';

interface OpenLeague { leagueId: string; rosterId: number; name: string }

export function App() {
  const [themeName] = useState(loadTheme);
  const theme = THEMES[themeName];
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<OpenLeague | null>(null);
  const [view, setView] = useState<'picks' | 'board' | 'demo'>('picks');

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
        {/* Brand bar — the web's persistent header: who you are, where you are,
            and the way back out. Version is shown because playtesters are
            running sideloaded builds and "which one have you got" is otherwise
            unanswerable. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.bd }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', letterSpacing: 1.4, color: theme.text }}>DRIP FANTASY</Text>
            <Text style={{ fontFamily: MONO, fontSize: 8, color: theme.faint }}>{APP_VERSION}</Text>
          </View>

          {open && (
            <Pressable
              onPress={() => setOpen(null)}
              hitSlop={8}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 1 }}
            >
              <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: theme.you }}>← my leagues</Text>
            </Pressable>
          )}

          <View style={{ flex: 1 }} />

          <Pressable onPress={() => { void signOut(); }} hitSlop={10}>
            <Text style={{ fontFamily: MONO, fontSize: 9, color: theme.dim }}>sign out</Text>
          </Pressable>
        </View>

        <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9.5, color: open ? theme.dim : theme.faint, paddingHorizontal: 14, paddingTop: 8 }}>
          {open ? open.name : session.user.email}
        </Text>

        {open ? (
          <View style={{ flex: 1 }}>
            {/* Picks vs board. Two tabs, so a segmented control rather than a
                navigator — and both keep their own data, so switching is free. */}
            {/* Three tabs, and DEMO is deliberately visible rather than hidden
                behind a gesture: it exists to be reached in front of an
                audience. It renders the live board's own components against a
                scripted window and labels itself as not-your-matchup. */}
            <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
              {(['picks', 'board', 'demo'] as const).map((tab) => {
                const on = view === tab;
                return (
                  <Pressable
                    key={tab}
                    onPress={() => setView(tab)}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 6,
                      backgroundColor: on ? theme.you : theme.surface,
                      borderWidth: StyleSheet.hairlineWidth, borderColor: on ? theme.you : theme.bd,
                    }}
                  >
                    <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: on ? theme.onAccent : theme.dim }}>
                      {tab === 'picks' ? 'SET LINEUP' : tab === 'board' ? 'LIVE BOARD' : 'DEMO'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {view === 'demo' ? (
              <DemoBoard />
            ) : view === 'picks' ? (
              <LivePicks
                // Remounts when you switch leagues, so no state leaks between them.
                key={`picks-${open.leagueId}-${open.rosterId}`}
                userId={session.user.id}
                leagueId={open.leagueId}
                rosterId={open.rosterId}
                onBack={() => setOpen(null)}
              />
            ) : (
              <LiveBoard
                key={`board-${open.leagueId}-${open.rosterId}`}
                userId={session.user.id}
                leagueId={open.leagueId}
                rosterId={open.rosterId}
                onBack={() => setOpen(null)}
              />
            )}
          </View>
        ) : (
          <Leagues
            userId={session.user.id}
            onOpen={(leagueId, rosterId, name) => { setView('picks'); setOpen({ leagueId, rosterId, name }); }}
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
