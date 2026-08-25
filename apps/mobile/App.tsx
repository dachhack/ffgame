// App root: theme, safe areas, and the session gate.
//
// Routing is a single piece of state rather than a navigator. Three screens,
// one of which is a modal-ish gate, and the only transition is
// leagues → lineup → back. @react-navigation was removed when it turned out to
// be shipping a native library nothing imported; bring it back when there is a
// real stack (a tab bar, deep links into a screen, a back gesture that has to
// feel native) rather than to model one push.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuth, signOut, leagueTouch, nativeTeamState } from '@drip/core/data/liveApi';
import { Ev, identify, track } from '@drip/core/analytics';
import { APP_VERSION } from '@drip/core/version';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { THEMES, ThemeCtx, loadTheme, saveTheme, isLight, MONO, alpha, type Theme } from './src/theme.native';
import { ScrollChromeCtx, useScrollChromeDriver } from './src/ui/scrollChrome';
import { SettingsModal } from './src/ui/SettingsModal';
import { PlayerCardHost, setCardLeague } from './src/ui/PlayerCardSheet';
import { loadCardSkin, saveCardSkin, loadCardSize, saveCardSize, type CardSkin, type CardSize } from './src/ui/cards';
import { Leagues } from './src/screens/Leagues';
import { isAdmin } from '@drip/core/data/liveApi';
import { LivePicks } from './src/screens/LivePicks';
import { DemoBoard } from './src/screens/DemoBoard';
import { CommishTools } from './src/screens/CommishTools';
import { ChatScreen } from './src/ui/Chat';
import { LeagueHome } from './src/screens/LeagueHome';
import { ChatChipDot } from './src/ui/unread';
import { registerForPush } from './src/ui/push';
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
  /** This account commissions the league → the league menu offers its ⚑
   *  Commissioner tile. Display only; every RPC behind those tools re-checks
   *  commissionership server-side. */
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
  /** Whose session `open` belongs to — see the onAuth handler. A ref, not
   *  state: it guards an event handler and must never schedule a render. */
  const authUser = useRef<string | null>(null);
  // A one-shot destination for ⚑ COMMISSIONER: creating a league lands on
  // 🧩 ROSTER (v0.296.6). Cleared on the way out so the next visit gets the
  // map, which is where a commissioner who did NOT just create a league wants
  // to start.
  const [toolsSection, setToolsSection] = useState<string | null>(null);
  // Bumped when a board join lands a new seat — remounts Leagues so the fresh
  // league is there when the user backs out of the board.
  const [leaguesEpoch, setLeaguesEpoch] = useState(0);
  const [view, setView] = useState<'home' | 'picks' | 'demo' | 'admin' | 'draft' | 'team' | 'chat' | 'commishtools' | 'board'>('picks');
  // League-home SHOP tile (0182): bumping this opens the shop on the board.
  const [shopSignal, setShopSignal] = useState(0);
  // Whether the open league's draft is done — the ⛏ DRAFT chip leaves the strip
  // once the draft completes (the room stays reachable from the league menu).
  // Defaults false so the chip shows until the answer lands: a live draft with
  // no way in would be worse than a finished one briefly showing.
  const [draftDone, setDraftDone] = useState(false);
  // LinkedIn chrome (v0.356.0, founder: "their menu at the bottom ... hides
  // down when you scroll the page down but comes back up again when you
  // scroll up. The top folds up too"): one driver for the whole shell.
  // League screens feed it scroll events via useLeagueScroll(); `shift`
  // (0 = chrome home, 1 = folded) drives the header fold above and the room
  // bar's duck below. Every room change brings the chrome home.
  const chromeDrv = useScrollChromeDriver();
  const [topH, setTopH] = useState(0);
  // Deep links out of 👥 Teams & rosters (v0.356.3, founder: "allow you to
  // message that member or initiate a trade"): a one-shot DM target for the
  // chat room and a one-shot trade partner for MY TEAM. Each clears when its
  // room is left, so revisiting the room later doesn't replay the jump.
  const [chatDm, setChatDm] = useState<{ peerId: string; peer: string } | null>(null);
  const [tradePartner, setTradePartner] = useState<number | null>(null);
  useEffect(() => { if (view !== 'chat') setChatDm(null); }, [view]);
  useEffect(() => { if (view !== 'team') setTradePartner(null); }, [view]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { chromeDrv.reset(); }, [view, open?.leagueId]);

  // The player card's league context (v0.282.0) — set here because `open` IS
  // "which league is on screen", and cleared with it so a card opened from the
  // leagues list never claims the last league's owner. Native only: the owner
  // and register panels are native-league facts.
  useEffect(() => {
    setCardLeague(open?.native ? open.leagueId : null);
  }, [open?.leagueId, open?.native]);

  useEffect(() => {
    setDraftDone(false);
    if (!open?.native) return;
    let dead = false;
    nativeTeamState(open.leagueId)
      .then((r) => { if (!dead && r.draft_status === 'complete') setDraftDone(true); })
      .catch(() => {});
    return () => { dead = true; };
  }, [open?.leagueId, open?.native]);

  useEffect(() => {
    if (!liveConfigured()) { setReady(true); return; }
    getSession().then((s) => { authUser.current = s?.user.id ?? null; setSession(s); setReady(true); }).catch(() => setReady(true));
    // Covers sign-out, token refresh and the sign-in this app performs.
    //
    // ONLY A REAL SIGN-OUT CLOSES THE LEAGUE (v0.344.4). This used to clear
    // `open` on ANY null session, and the SDK hands one over for reasons that
    // are not a sign-out — an INITIAL_SESSION before storage has answered, a
    // token refresh that momentarily has nothing to hand back. The session
    // itself was always restored a frame later, so the app stayed signed in
    // and the only lasting effect was the cleared league: you were reading
    // your matchup and the board became the leagues list, which is exactly
    // what the founder hit reaching for pull-to-refresh. The event name says
    // which of those it was, and `onAuth` has always passed it.
    const un = onAuth((s, event) => {
      // A DIFFERENT account signing in must not inherit the open league — that
      // is the one case the old null check was quietly covering.
      if (s && authUser.current && s.user.id !== authUser.current) setOpen(null);
      if (s) authUser.current = s.user.id;
      setSession(s);
      if (event === 'SIGNED_OUT') { authUser.current = null; setOpen(null); }
    });
    return () => { un?.(); };
  }, []);

  // Re-resolved on every session change, and cleared on sign-out — an admin
  // entry left behind after someone else signs in on the same phone would be
  // confusing even though the RPCs would refuse them.
  useEffect(() => {
    if (!session) { setAdmin(false); return; }
    isAdmin().then((v) => setAdmin(!!v)).catch(() => setAdmin(false));
  }, [session]);

  // Push registration (0150): once signed in, ask permission and register the
  // device token. No-ops in builds without Firebase config, and when denied.
  useEffect(() => {
    if (session) void registerForPush();
  }, [session?.user.id]);

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
        {/* THE FOLDING TOP (v0.356.0): brand bar + league title slide away
            together as a league screen scrolls down, and return on any
            scroll up — the negative marginBottom pulls the content up in
            step, so the fold is a slide, not a hole. Outside a league (and
            on screens that never scroll) nothing drives the shift, so the
            header simply stands. */}
        <Animated.View
          onLayout={(e) => setTopH(Math.round(e.nativeEvent.layout.height))}
          style={{
            zIndex: 2,
            opacity: chromeDrv.shift.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.2, 0] }),
            transform: [{ translateY: chromeDrv.shift.interpolate({ inputRange: [0, 1], outputRange: [0, -Math.max(1, topH)] }) }],
            marginBottom: chromeDrv.shift.interpolate({ inputRange: [0, 1], outputRange: [0, -Math.max(1, topH)] }),
          }}>
        {/* Brand bar — the web's persistent header: who you are, where you are,
            and the way back out. Version is shown because playtesters are
            running sideloaded builds and "which one have you got" is otherwise
            unanswerable. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.bd }}>
          {/* THE BRAND IS THE CENTER (v0.356.2, founder: "put drip fantasy
              and the version in the center of the top and my leagues chip on
              the left without the arrow") — the wordmark sits absolutely
              centered on the screen (pointerEvents off so it never eats a
              tap), with the exit chip on the left and the gear on the right. */}
          {open && (
            <Pressable
              // Resets the view too, so the button lands where its label says.
              // Closing only the league would leave you sitting in Admin with
              // no league open — "my leagues" that doesn't show your leagues.
              onPress={() => { setOpen(null); setView('picks'); }}
              hitSlop={8}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.you, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 1 }}
            >
              <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: theme.you }}>my leagues</Text>
            </Pressable>
          )}

          <View style={{ flex: 1 }} />

          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', letterSpacing: 1.4, color: theme.text }}>DRIP FANTASY</Text>
            <Text style={{ fontFamily: MONO, fontSize: 8, color: theme.faint }}>{APP_VERSION}</Text>
          </View>

          <Pressable
            onPress={() => setSettingsOpen(true)}
            hitSlop={10}
            accessibilityLabel="Settings"
            style={{ width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.bd, backgroundColor: theme.surface }}
          >
            <Text style={{ fontSize: 15, color: theme.dim }}>⚙</Text>
          </Pressable>
        </View>

        {/* THE LEAGUE'S OWN HEADER (founder): the name reads as a title and
            the room chips share its row, instead of a 9.5pt line of dim mono
            with a separate strip under it. The row WRAPS — four chips and a
            long league name will not fit a phone's width, and wrapping the
            chips under the title is the graceful half of that; the title
            itself shrinks to one line rather than pushing them off.
            THE CHIPS GET THEIR OWN ROW (v0.287.0, founder: "pin the top chips
            to the row under the league name"). They used to SHARE the title's
            row and wrap when they ran out of width, which meant the split
            landed wherever the league's name happened to end — "Super Cool
            League of Players" left 🏠 LEAGUE stranded up top with MATCHUP /
            MY TEAM / 💬 beneath it, and a shorter name put three up and one
            down. Two rows, always: the name is a header and the chips are the
            navigation under it, and neither moves when the name changes.
            Signed out of a league there is nothing to title, so the email
            keeps its quiet line.

            Native leagues carry their whole season in-app — matchup, draft
            room, waivers — so they get the full set. Platform leagues only
            earn management tabs when you commission them (rosters/waivers stay
            on Sleeper) — but CHAT (0147) is for every member of any league, so
            an open league always has chips: a play-only platform league shows
            ▦ MATCHUP + 💬. The strip still renders over the commish tools —
            you just reach them from the league menu now. */}
        {!open && (
          <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9.5, color: theme.faint, paddingHorizontal: 14, paddingTop: 8 }}>
            {session.user.email}
          </Text>
        )}
        {open && (
          <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '700', color: theme.text, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 }}>
            {open.name}
          </Text>
        )}
        </Animated.View>
        {/* The room strip moved to the BOTTOM (v0.356.0, founder: "I like how
            linkedin has their menu at the bottom") — see LeagueBottomBar
            after the view switch. NO ⚑ COMMISH there (founder): the league
            menu carries the Commissioner tile, and the bar is for rooms
            every open league has; the commishtools VIEW stays reachable. */}

        {/* The gear's destinations come FIRST, and deliberately are not nested
            under an open league.

            They used to be — the whole `view` switch sat inside `open ? … :
            <Leagues/>` — which made every one of them a dead tap from the
            leagues list. `open` is null there, so tapping Admin set `view` and
            the tree went on rendering <Leagues/>: no navigation, no error,
            nothing. It went unnoticed because it only broke once the leagues
            list became the landing screen; before that a league was always open
            by the time you could reach the gear. */}
        <ScrollChromeCtx.Provider value={chromeDrv.handlers}>
        {view === 'admin' ? (
          <View style={{ flex: 1 }}><Admin onBack={() => setView('picks')} /></View>
        ) : view === 'board' ? (
          <View style={{ flex: 1 }}>
            <Recruit onBack={() => setView('picks')} onJoined={() => setLeaguesEpoch((n) => n + 1)}
              // Created a league → its ⚑ COMMISSIONER tools, open on 🧩 ROSTER.
              onCreated={(leagueId, name, rosterId) => {
                setLeaguesEpoch((n) => n + 1);
                setOpen({ leagueId, rosterId, name, native: true, commish: true, pickUserId: undefined });
                setToolsSection('lineup');
                setView('commishtools');
              }} />
          </View>
        ) : view === 'draft' && open?.native ? (
          // A seatless commissioner has no MATCHUP to go back to — back means
          // leaving the league, not landing on a lineup that doesn't exist.
          <View style={{ flex: 1 }}><Draft leagueId={open.leagueId} onBack={() => { if (open.rosterId == null) setOpen(null); setView('home'); }} /></View>
        ) : view === 'team' && open?.native ? (
          <View style={{ flex: 1 }}><Team leagueId={open.leagueId} tradePartner={tradePartner} onBack={() => { if (open.rosterId == null) setOpen(null); setView('home'); }} onDraft={() => setView('draft')} /></View>
        ) : view === 'chat' && open ? (
          <View style={{ flex: 1 }}><ChatScreen key={`chat-${open.leagueId}-${chatDm?.peerId ?? ''}`} leagueId={open.leagueId} initialDm={chatDm} /></View>
        ) : view === 'commishtools' && open ? (
          <View style={{ flex: 1 }}><CommishTools key={`tools-${open.leagueId}-${toolsSection ?? ''}`}
            leagueId={open.leagueId} native={open.native} rosterId={open.rosterId} initialSection={toolsSection}
            // A seatless commissioner has nowhere else in the league to land —
            // back means back to the leagues list.
            onBack={() => { setToolsSection(null); if (open.rosterId == null) { setOpen(null); setView('picks'); } else setView('home'); }}
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
        ) : view === 'home' && open ? (
          <View style={{ flex: 1 }}>
            <LeagueHome leagueId={open.leagueId} teamName={undefined}
              rosterId={open.rosterId} native={open.native} commish={!!open.commish}
              onGo={(room) => setView(room)}
              onMessage={(peerId, peer) => { setChatDm({ peerId, peer }); setView('chat'); }}
              onTrade={(rid) => { setTradePartner(rid); setView('team'); }}
              onShop={() => { setShopSignal((n) => n + 1); setView('picks'); }}
              onBack={() => setOpen(null)} />
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
              onBack={() => setView('home')}
              openShopSignal={shopSignal}
            />
          </View>
        ) : (
          <Leagues
            key={leaguesEpoch}
            userId={session.user.id}
            onBoard={() => setView('board')}
            onOpen={(leagueId, rosterId, name, native, commish, pickUserId, landing) => {
              // `live: true` unconditionally: the native app has no sim leagues
              // to open, so this is the same activation step the web reports
              // for a live league and lands in the same funnel.
              track(Ev.leagueOpened, { live: true });
              // Presence (0151): the commissioner's last-seen list. Fire and
              // forget — an outsider's touch is a server-side no-op.
              void leagueTouch(leagueId).catch(() => {});
              // No seat → no lineup: a seatless commissioner lands on
              // management, not on a MATCHUP tab that cannot render.
              setView(rosterId == null ? 'commishtools' : (landing ?? 'home'));
              setOpen({ leagueId, rosterId, name, native, commish, pickUserId });
            }}
          />
        )}
        </ScrollChromeCtx.Provider>
        {/* THE ROOM BAR (v0.356.0): the league's rooms along the bottom,
            LinkedIn-style — it ducks out of the way as a screen scrolls
            down and returns the moment you pull up. Absolute over the
            content (screens reserve bottom padding for it), so its coming
            and going never reflows what you're reading. */}
        {open && (view === 'home' || view === 'picks' || view === 'draft' || view === 'team' || view === 'chat' || view === 'commishtools') && (
          <LeagueBottomBar theme={theme} shift={chromeDrv.shift} active={view} leagueId={open.leagueId}
            onGo={(id) => setView(id)}
            items={([
              ['home', '🏠', 'LEAGUE', true],                            // the hub (0182)
              ['picks', '▦', 'MATCHUP', open.rosterId != null],          // no seat → no lineup
              ['draft', '⛏', 'DRAFT', open.native && !draftDone],        // native-only; leaves once drafted
              ['team', '⇄', 'MY TEAM', open.native && open.rosterId != null],
              ['chat', '💬', 'CHAT', true],
            ] as const)
              .filter(([, , , show]) => show)
              .map(([id, icon, label]) => [id, icon, label] as ['home' | 'picks' | 'draft' | 'team' | 'chat', string, string])} />
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

/** The room bar (v0.356.0, founder: "I like how linkedin has their menu at
 *  the bottom") — the strip that lived under the league title, rebuilt as a
 *  bottom bar: icon over label, one column per room, the active room in the
 *  theme's `you`. `shift` (the shell's chrome fold) ducks it below the safe
 *  area on scroll-down and brings it home on scroll-up. */
const BAR_H = 50;
function LeagueBottomBar({ theme, shift, items, active, leagueId, onGo }: {
  theme: Theme;
  shift: Animated.Value;
  items: ['home' | 'picks' | 'draft' | 'team' | 'chat', string, string][];
  active: string;
  leagueId: string;
  onGo: (id: 'home' | 'picks' | 'draft' | 'team' | 'chat') => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row',
      backgroundColor: theme.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.bd,
      paddingTop: 4, paddingBottom: Math.max(insets.bottom, 6),
      transform: [{ translateY: shift.interpolate({ inputRange: [0, 1], outputRange: [0, BAR_H + insets.bottom + 12] }) }],
    }}>
      {/* Bigger items in the same rail (v0.356.3, founder: "make the bottom
          menu items larger (but don't make the rail any taller) and colored
          in each theme stand out") — the padding the icons grew into came
          out of the rail's own, and the ACTIVE room sits on a pill of the
          theme's accent so every theme carries its own color. */}
      {items.map(([id, icon, label]) => {
        const on = active === id;
        return (
          <Pressable key={id} onPress={() => onGo(id)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ alignItems: 'center', gap: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 2, backgroundColor: on ? alpha(theme.you, 16) : 'transparent' }}>
              <View>
                <Text style={{ fontSize: 19, lineHeight: 23, opacity: on ? 1 : 0.6 }}>{icon}</Text>
                {id === 'chat' && <ChatChipDot leagueId={leagueId} active={active === 'chat'} />}
              </View>
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, color: on ? theme.you : theme.dim }}>{label}</Text>
            </View>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}
