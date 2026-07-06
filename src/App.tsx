import { useEffect, lazy, Suspense } from 'react';
import { useStore } from './app/store';
import { THEMES, themeVars } from './theme';
import { Splash } from './screens/Splash';
import { RequestCodeFab } from './screens/RequestCode';
import { DEMO_WEEK } from './config';

// Route screens are code-split: only the active screen's chunk loads, keeping the
// splash/landing payload small. Splash + the request-code FAB stay eager (they're
// the first paint and a persistent overlay). Components are named exports, so map
// each to a default for React.lazy.
const LeagueHub = lazy(() => import('./screens/LeagueHub').then((m) => ({ default: m.LeagueHub })));
const LeagueOverview = lazy(() => import('./screens/LeagueOverview').then((m) => ({ default: m.LeagueOverview })));
const Matchup = lazy(() => import('./screens/Matchup').then((m) => ({ default: m.Matchup })));
const MatchupFinal = lazy(() => import('./screens/MatchupFinal').then((m) => ({ default: m.MatchupFinal })));
const Leagues = lazy(() => import('./screens/Leagues').then((m) => ({ default: m.Leagues })));
const SleeperLeague = lazy(() => import('./screens/SleeperLeague').then((m) => ({ default: m.SleeperLeague })));
const LiveOnboard = lazy(() => import('./screens/LiveOnboard').then((m) => ({ default: m.LiveOnboard })));
const GuidedDemo = lazy(() => import('./screens/GuidedDemo').then((m) => ({ default: m.GuidedDemo })));

export function App() {
  const { theme, route, youTeamId, navigate } = useStore();
  const vars = themeVars(THEMES[theme]) as Record<string, string>;
  const light = theme === 'daylight' || theme === 'arctic';

  useEffect(() => {
    document.body.style.background = THEMES[theme].bg;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  }, [theme, light]);

  // Deep link: ?live=1 enters Live mode; ?code=XXXX (a commissioner's share link)
  // is stashed so it survives the magic-link round trip and pre-fills the join form.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('live') === '1') {
      const code = p.get('code');
      if (code) { try { localStorage.setItem('dripInviteCode', code.toUpperCase()); } catch { /* ignore */ } }
      navigate({ name: 'live' });
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
        {route.name === 'splash' && <Splash />}
        {route.name === 'live' && <LiveOnboard />}
        {route.name === 'demo' && (route.view === 'board'
          ? <Matchup key="demo-board" week={DEMO_WEEK} initialPhase="setup" demo />
          : <GuidedDemo />)}
        {route.name === 'leagues' && <Leagues />}
        {route.name === 'sleeperLeague' && <SleeperLeague key={route.leagueId} leagueId={route.leagueId} leagueName={route.leagueName} />}
        {route.name === 'hub' && <LeagueHub />}
        {route.name === 'league' && <LeagueOverview />}
        {route.name === 'matchup' && <Matchup key={`m${route.week}-${youTeamId}`} week={route.week} initialPhase={route.phase} />}
        {route.name === 'final' && <MatchupFinal key={`f${route.week}-${youTeamId}`} week={route.week} />}
      </Suspense>
      {/* Persistent "out" across the funnel — request a pilot code for your league.
          Hidden inside the live pilot itself (you're already in). */}
      {route.name !== 'live' && <RequestCodeFab />}
    </div>
  );
}
