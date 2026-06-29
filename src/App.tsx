import { useEffect } from 'react';
import { useStore } from './app/store';
import { THEMES, themeVars } from './theme';
import { LeagueHub } from './screens/LeagueHub';
import { LeagueOverview } from './screens/LeagueOverview';
import { Matchup } from './screens/Matchup';
import { MatchupFinal } from './screens/MatchupFinal';
import { Splash } from './screens/Splash';
import { Leagues } from './screens/Leagues';
import { SleeperLeague } from './screens/SleeperLeague';
import { EspnConnect } from './screens/EspnConnect';
import { LiveOnboard } from './screens/LiveOnboard';
import { GuidedDemo } from './screens/GuidedDemo';
import { RequestCodeFab } from './screens/RequestCode';
import { DEMO_WEEK } from './config';

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
      {route.name === 'splash' && <Splash />}
      {route.name === 'live' && <LiveOnboard />}
      {route.name === 'demo' && (route.view === 'board'
        ? <Matchup key="demo-board" week={DEMO_WEEK} initialPhase="setup" demo />
        : <GuidedDemo />)}
      {route.name === 'leagues' && <Leagues />}
      {route.name === 'sleeperLeague' && <SleeperLeague key={route.leagueId} leagueId={route.leagueId} leagueName={route.leagueName} />}
      {route.name === 'espnConnect' && <EspnConnect />}
      {route.name === 'hub' && <LeagueHub />}
      {route.name === 'league' && <LeagueOverview />}
      {route.name === 'matchup' && <Matchup key={`m${route.week}-${youTeamId}`} week={route.week} initialPhase={route.phase} />}
      {route.name === 'final' && <MatchupFinal key={`f${route.week}-${youTeamId}`} week={route.week} />}
      {/* Persistent "out" across the funnel — request a pilot code for your league.
          Hidden inside the live pilot itself (you're already in), and on splash,
          which has its own "request an invite" link (avoid two CTAs for one action). */}
      {route.name !== 'live' && route.name !== 'splash' && <RequestCodeFab />}
    </div>
  );
}
