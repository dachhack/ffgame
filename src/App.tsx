import { useEffect, lazy, Suspense } from 'react';
import { useStore, PHOTO_SKINS } from './app/store';
import { THEMES, themeVars } from './theme';
import { DemoBoard } from './screens/DemoBoard';
import { yahooExchange } from './data/providers/yahooClient';
import { RequestCodeFab } from './screens/RequestCode';
import { DEMO_WEEK } from './config';

// Route screens are code-split: only the active screen's chunk loads, keeping the
// landing payload small. DemoBoard (the landing) + the request-code FAB stay eager
// (first paint / persistent overlay). Components are named exports, so map each to
// a default for React.lazy.
const LeagueHub = lazy(() => import('./screens/LeagueHub').then((m) => ({ default: m.LeagueHub })));
const LeagueOverview = lazy(() => import('./screens/LeagueOverview').then((m) => ({ default: m.LeagueOverview })));
const Matchup = lazy(() => import('./screens/Matchup').then((m) => ({ default: m.Matchup })));
const MatchupFinal = lazy(() => import('./screens/MatchupFinal').then((m) => ({ default: m.MatchupFinal })));
const Leagues = lazy(() => import('./screens/Leagues').then((m) => ({ default: m.Leagues })));
const SleeperLeague = lazy(() => import('./screens/SleeperLeague').then((m) => ({ default: m.SleeperLeague })));
const LiveOnboard = lazy(() => import('./screens/LiveOnboard').then((m) => ({ default: m.LiveOnboard })));
const ProviderConnect = lazy(() => import('./screens/ProviderConnect').then((m) => ({ default: m.ProviderConnect })));
const YahooConnect = lazy(() => import('./screens/YahooConnect').then((m) => ({ default: m.YahooConnect })));

export function App() {
  const { theme, cardSkin, route, youTeamId, navigate, liveCtx } = useStore();
  const vars = themeVars(THEMES[theme]) as Record<string, string>;
  const light = theme === 'daylight' || theme === 'arctic';
  // A signed-in live user already has a league — hide the "request a league code"
  // invite CTA for them (they reached the demo/sim board from their leagues).
  const loggedIn = (() => { try { return localStorage.getItem('dripLive') === '1'; } catch { return false; } })();

  useEffect(() => {
    document.body.style.background = THEMES[theme].bg;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    // Mirror the theme custom properties onto :root so content PORTALED to
    // <body> (modals via ModalBackdrop) inherits --surface/--text/etc. too — the
    // app-root <div> below carries them for the in-tree UI, but a portal escapes it.
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    // CSS-reachable light/dark signal for the card-table theme (cardTable.tsx):
    // its felt + dark-stock cards get a light variant on the light app themes.
    document.documentElement.dataset.cardLight = light ? '1' : '0';
    // The theme NAME too, for per-theme card-table accents (e.g. arctic's
    // card-mode strips go paper gray where daylight's go baize green).
    document.documentElement.dataset.appTheme = theme;
    // Personal card-deck skin (cardTable.tsx reads [data-card-skin] for its felt
    // + sealed card-back colors). Default emerald.
    document.documentElement.dataset.cardSkin = cardSkin;
    // Photo-backed skins get the ribbon/no-gem treatment (cardTable.tsx).
    document.documentElement.dataset.cardPhoto = PHOTO_SKINS.includes(cardSkin) ? '1' : '0';
  }, [theme, light, cardSkin]);

  // Deep link: ?live=1 enters Live mode; ?code=XXXX (a commissioner's share link)
  // is stashed so it survives the magic-link round trip and pre-fills the join form.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // Yahoo OAuth redirect: ?code=…&state=yahoo → exchange for tokens, then land
    // on the Yahoo league picker (strip the query so a refresh doesn't re-run it).
    if (p.get('state') === 'yahoo' && p.get('code')) {
      yahooExchange(p.get('code')!)
        .catch(() => { /* surfaced on the connect screen */ })
        .finally(() => {
          try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ }
          navigate({ name: 'connect', provider: 'yahoo' });
        });
      return;
    }
    if (p.get('live') === '1') {
      const code = p.get('code');
      if (code) { try { localStorage.setItem('dripInviteCode', code.toUpperCase()); } catch { /* ignore */ } }
      // A commissioner invite link (?commish=CODE) → stash the commish code so it
      // survives the magic-link bounce; LiveOnboard opens the claim screen.
      const commish = p.get('commish');
      if (commish) { try { localStorage.setItem('dripCommishCode', commish.toUpperCase()); } catch { /* ignore */ } }
      navigate({ name: 'live' });
      // Consume the params so a later refresh doesn't teleport back into Live (the
      // route now lives in the hash). Keep the path + the just-set #/live hash.
      try { window.history.replaceState(window.history.state, '', window.location.pathname + '#/live'); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        ...(vars as React.CSSProperties),
        colorScheme: light ? 'light' : 'dark',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Suspense fallback={null}>
        {/* 'splash' is retired — legacy navigations land on the demo landing. */}
        {route.name === 'splash' && <DemoBoard />}
        {route.name === 'live' && <LiveOnboard />}
        {route.name === 'demo' && (route.view === 'board'
          ? <Matchup key="demo-board" week={DEMO_WEEK} initialPhase="setup" demo />
          : <DemoBoard />)}
        {route.name === 'leagues' && <Leagues />}
        {route.name === 'sleeperLeague' && <SleeperLeague key={route.leagueId} leagueId={route.leagueId} leagueName={route.leagueName} />}
        {route.name === 'connect' && (route.provider === 'yahoo'
          ? <YahooConnect />
          : <ProviderConnect key={route.provider} provider={route.provider} />)}
        {route.name === 'hub' && <LeagueHub />}
        {route.name === 'league' && <LeagueOverview />}
        {route.name === 'matchup' && <Matchup key={`m${route.week}-${youTeamId}`} week={route.week} initialPhase={route.phase} />}
        {route.name === 'final' && <MatchupFinal key={`f${route.week}-${youTeamId}`} week={route.week} />}
      </Suspense>
      {/* Persistent "out" across the discovery funnel — request a pilot code for
          your league. Hidden inside the live pilot (already in), on splash / the
          demo landing (their own request-a-code CTA), and on the board/final
          screens where its fixed bottom-left corner overlaps the playback and
          lineup controls; also hidden for a signed-in live user. */}
      {!['live', 'splash', 'demo', 'matchup', 'final'].includes(route.name) && !liveCtx && !loggedIn && <RequestCodeFab />}
    </div>
  );
}
