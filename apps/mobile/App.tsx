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
import * as SplashScreen from 'expo-splash-screen';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuth, signOut } from '@drip/core/data/liveApi';
import { Ev, identify, track } from '@drip/core/analytics';
import { APP_VERSION } from '@drip/core/version';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { THEMES, ThemeCtx, loadTheme, saveTheme, isLight, MONO, alpha } from './src/theme.native';
import { SettingsModal } from './src/ui/SettingsModal';
import { PlayerCardHost } from './src/ui/PlayerCardSheet';
import { loadCardSkin, saveCardSkin, loadCardSize, saveCardSize, type CardSkin, type CardSize } from './src/ui/cards';
import { Leagues } from './src/screens/Leagues';
import { isAdmin } from '@drip/core/data/liveApi';
import { LivePicks } from './src/screens/LivePicks';
import { DemoBoard } from './src/screens/DemoBoard';
import { CommishTools } from './src/screens/CommishTools';
import { ChatScreen } from './src/ui/Chat';
import { Admin } from './src/screens/Admin';
import { Draft } from './src/screens/Draft';
import { Team } from './src/screens/Team';
import { Recruit } from './src/screens/Recruit';
import { SignIn } from './src/screens/SignIn';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { BrandLoading } from './src/ui/BrandLoading';

// Hold the native splash past the first frame. Without this it hides as soon as
// React mounts, which is BEFORE getSession() answers — so the launch read splash
// → spinner → app, with the spinner being the longest part. Now the brand plate
// stays up until there is something real to show.
//
// Module scope is the documented place for it: an effect runs after the first
// render, by which point the splash is already gone.
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Never let the splash outlive this, whatever happens to the session call. A
 *  slow launch is a nuisance; an app that appears not to start at all is a bug
 *  report. `ready` is set on every path today including the failure ones — this
 *  is for the path nobody thought of. */
const SPLASH_MAX_MS = 4000;

interface OpenLeague {
  leagueId: string;
  /** null = commissioner without a team: management only, no MATCHUP tab —
   *  there is no lineup to set for a seat that doesn't exist. */
  rosterId: number | null;
  name: string;
  /** The app_user_id sealed picks are written AS (0125): the seat OWNER's id.
   *  Differs from the session user exactly when this seat is co-managed. */
  pickUserId?: string;
  /** Native leagues get the DRAFT / MY TEAM tabs — draft rooms and waivers are
   *  meaningless for a league whose rosters live on Sleeper/ESPN. */
  native: boolean;
  /** This account commissions the league → the ⚑ COMMISH tab renders. Display
   *  only; every RPC behind that tab re-checks commissionership server-side. */
  commish?: boolean;
}

export function App() {
  const [themeName, setThemeName] = useState(loadTheme);
  const theme = THEMES[themeName];
  // The card deck lives in storage and is read by cards.tsx at render time, so
  // holding it in state here is what makes a change repaint the board — there is
  // nothing to subscribe to on a module-level read.
  const [cardSkin, setCardSkin] = useState<CardSkin>(loadCardSkin);
  // Held here rather than read where it's used, so changing it re-renders the
  // board below and the new size lands without closing and reopening anything.
  const [cardSize, setCardSize] = useState<CardSize>(loadCardSize);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Whether to OFFER the admin entry. The RPCs behind it are the real gate —
  // is_admin() + RLS server-side — exactly as on the web.
  const [admin, setAdmin] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<OpenLeague | null>(null);
  // Bumped when a board join lands a new seat — remounts Leagues so the fresh
  // league is there when the user backs out of the board.
  const [leaguesEpoch, setLeaguesEpoch] = useState(0);
  const [view, setView] = useState<'picks' | 'demo' | 'admin' | 'draft' | 'team' | 'chat' | 'commishtools' | 'board'>('picks');

  useEffect(() => {
    if (!liveConfigured()) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); }).catch(() => setReady(true));
    // Covers sign-out, token refresh and the sign-in this app performs.
    const un = onAuth((s) => { setSession(s); if (!s) setOpen(null); });
    return () => { un?.(); };
  }, []);

  // Re-resolved on every session change, and cleared on sign-out — an admin
  // entry left behind after someone else signs in on the same phone would be
  // confusing even though the RPCs would refuse them.
  useEffect(() => {
    if (!session) { setAdmin(false); return; }
    isAdmin().then((v) => setAdmin(!!v)).catch(() => setAdmin(false));
  }, [session]);

  // Analytics identity. Tying events to the Supabase user id — the same id the
  // web identifies on (LiveOnboard) — is what lets one person be followed across
  // their phone and their browser instead of counting as two. The email rides
  // along as a person trait so PostHog shows a name, not a UUID.
  useEffect(() => {
    if (session?.user.id) identify(session.user.id, session.user.email ? { email: session.user.email } : undefined);
  }, [session?.user.id, session?.user.email]);

  // One `screen_view` per screen, fired from the derived name rather than from
  // each setter — the screen is a function of three pieces of state here, so a
  // setter-side call would miss the transitions nobody remembered to annotate
  // (sign-out, the back-out of a league).
  const screen = !ready ? null : !session ? 'signin' : open ? view : 'leagues';
  useEffect(() => {
    if (screen) track(Ev.screenView, { screen });
  }, [screen]);

  // Hide once there is a screen to hide it FOR — or once the ceiling is hit.
  useEffect(() => {
    if (ready) { SplashScreen.hideAsync().catch(() => {}); return; }
    const timer = setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const refreshSession = useCallback(() => {
    getSession().then(setSession).catch(() => {});
  }, []);

  const body = () => {
    if (!ready) return <BrandLoading />;
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
              // Resets the view too, so the button lands where its label says.
              // Closing only the league would leave you sitting in Admin with
              // no league open — "← my leagues" that doesn't show your leagues.
              onPress={() => { setOpen(null); setView('picks'); }}
              hitSlop={8}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 1 }}
            >
              <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: theme.you }}>← my leagues</Text>
            </Pressable>
          )}

          <View style={{ flex: 1 }} />

          <Pressable
            onPress={() => setSettingsOpen(true)}
            hitSlop={10}
            accessibilityLabel="Settings"
            style={{ width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.bd, backgroundColor: theme.surface }}
          >
            <Text style={{ fontSize: 15, color: theme.dim }}>⚙</Text>
          </Pressable>
        </View>

        <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9.5, color: open ? theme.dim : theme.faint, paddingHorizontal: 14, paddingTop: 8 }}>
          {open ? open.name : session.user.email}
        </Text>

        {/* Native leagues carry their whole season in-app — matchup, draft
            room, waivers — so they get the full tab strip. Platform leagues
            only earn management tabs when you commission them (rosters/waivers
            stay on Sleeper) — but CHAT (0147) is for every member of any
            league, so an open league always has a strip now: a play-only
            platform league shows ▦ MATCHUP + 💬 CHAT. */}
        {open && (view === 'picks' || view === 'draft' || view === 'team' || view === 'chat' || view === 'commishtools') && (
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingTop: 8 }}>
            {([
              ['picks', '▦ MATCHUP', open.rosterId != null],           // no seat → no lineup
              ['draft', '⛏ DRAFT', open.native],                       // draft rooms are native-only
              ['team', '⇄ MY TEAM', open.native && open.rosterId != null],
              ['chat', '💬 CHAT', true],                               // any member, any league kind
              ['commishtools', '⚑ COMMISH', !!open.commish],
            ] as const)
              .filter(([, , show]) => show)
              .map(([id, label]) => (
              <Pressable key={id} onPress={() => setView(id)}
                style={{
                  borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
                  borderColor: view === id ? theme.you : theme.bd,
                  backgroundColor: view === id ? alpha(theme.you, 12) : theme.surface,
                }}>
                <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: view === id ? theme.you : theme.dim }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* The gear's destinations come FIRST, and deliberately are not nested
            under an open league.

            They used to be — the whole `view` switch sat inside `open ? … :
            <Leagues/>` — which made every one of them a dead tap from the
            leagues list. `open` is null there, so tapping Admin set `view` and
            the tree went on rendering <Leagues/>: no navigation, no error,
            nothing. It went unnoticed because it only broke once the leagues
            list became the landing screen; before that a league was always open
            by the time you could reach the gear. */}
        {view === 'admin' ? (
          <View style={{ flex: 1 }}><Admin onBack={() => setView('picks')} /></View>
        ) : view === 'board' ? (
          <View style={{ flex: 1 }}>
            <Recruit onBack={() => setView('picks')} onJoined={() => setLeaguesEpoch((n) => n + 1)} />
          </View>
        ) : view === 'draft' && open?.native ? (
          // A seatless commissioner has no MATCHUP to go back to — back means
          // leaving the league, not landing on a lineup that doesn't exist.
          <View style={{ flex: 1 }}><Draft leagueId={open.leagueId} onBack={() => { if (open.rosterId == null) setOpen(null); setView('picks'); }} /></View>
        ) : view === 'team' && open?.native ? (
          <View style={{ flex: 1 }}><Team leagueId={open.leagueId} onBack={() => { if (open.rosterId == null) setOpen(null); setView('picks'); }} onDraft={() => setView('draft')} /></View>
        ) : view === 'chat' && open ? (
          <View style={{ flex: 1 }}><ChatScreen key={`chat-${open.leagueId}`} leagueId={open.leagueId} /></View>
        ) : view === 'commishtools' && open ? (
          <View style={{ flex: 1 }}><CommishTools leagueId={open.leagueId} native={open.native} rosterId={open.rosterId}
            // A seatless commissioner has nowhere else in the league to land —
            // back means back to the leagues list.
            onBack={() => { setOpen(null); setView('picks'); }}
            // Vacating your own seat invalidates open.rosterId — leave the
            // league view entirely; Leagues remounts with the fresh shape.
            onSelfUnassigned={() => { setOpen(null); setView('picks'); setLeaguesEpoch((n) => n + 1); }} /></View>
        ) : view === 'demo' ? (
          <View style={{ flex: 1 }}>
            <Pressable onPress={() => setView('picks')} hitSlop={8} style={{ alignSelf: 'flex-start', marginHorizontal: 12, marginBottom: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
              {/* Where "back" actually goes depends on whether a league is open,
                  so the label has to say which — otherwise it promises a
                  matchup and delivers the leagues list. */}
              <Text style={{ fontFamily: MONO, fontSize: 10, color: theme.you }}>{open ? '← back to my matchup' : '← back to my leagues'}</Text>
            </Pressable>
            <DemoBoard />
          </View>
        ) : open && open.rosterId != null ? (
          <View style={{ flex: 1 }}>
            <LivePicks
              // Remounts when you switch leagues, so no state leaks between them.
              key={`picks-${open.leagueId}-${open.rosterId}`}
              // Co-managed seat: write picks AS the owner (0125) — the board
              // and resolver read the seat's lineup under that identity.
              userId={open.pickUserId ?? session.user.id}
              leagueId={open.leagueId}
              rosterId={open.rosterId}
              native={open.native}
              onBack={() => setOpen(null)}
            />
          </View>
        ) : (
          <Leagues
            key={leaguesEpoch}
            userId={session.user.id}
            onBoard={() => setView('board')}
            onOpen={(leagueId, rosterId, name, native, commish, pickUserId) => {
              // `live: true` unconditionally: the native app has no sim leagues
              // to open, so this is the same activation step the web reports
              // for a live league and lands in the same funnel.
              track(Ev.leagueOpened, { live: true });
              // No seat → no lineup: a seatless commissioner lands on
              // management, not on a MATCHUP tab that cannot render.
              setView(rosterId == null ? 'commishtools' : 'picks');
              setOpen({ leagueId, rosterId, name, native, commish, pickUserId });
            }}
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
          <PlayerCardHost />
          <SettingsModal
            visible={settingsOpen}
            theme={themeName}
            skin={cardSkin}
            cardSize={cardSize}
            version={APP_VERSION}
            onTheme={(name) => { saveTheme(name); setThemeName(name); }}
            onSkin={(s) => { saveCardSkin(s); setCardSkin(s); }}
            onCardSize={(s) => { saveCardSize(s); setCardSize(s); }}
            isAdmin={admin}
            onDemo={() => setView('demo')}
            onAdmin={() => setView('admin')}
            onSignOut={() => { void signOut(); }}
            onClose={() => setSettingsOpen(false)}
          />
        </SafeAreaView>
      </ThemeCtx.Provider>
    </SafeAreaProvider>
  );
}
