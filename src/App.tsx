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
import { LiveOnboard } from './screens/LiveOnboard';

export function App() {
  const { theme, route, youTeamId, navigate } = useStore();
  const vars = themeVars(THEMES[theme]) as Record<string, string>;
  const light = theme === 'daylight' || theme === 'arctic';

  useEffect(() => {
    document.body.style.background = THEMES[theme].bg;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  }, [theme, light]);

  // Magic-link return lands at ?live=1 — drop the user back into Live mode.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('live') === '1') navigate({ name: 'live' });
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
      {route.name === 'leagues' && <Leagues />}
      {route.name === 'sleeperLeague' && <SleeperLeague key={route.leagueId} leagueId={route.leagueId} leagueName={route.leagueName} />}
      {route.name === 'hub' && <LeagueHub />}
      {route.name === 'league' && <LeagueOverview />}
      {route.name === 'matchup' && <Matchup key={`m${route.week}-${youTeamId}`} week={route.week} initialPhase={route.phase} />}
      {route.name === 'final' && <MatchupFinal key={`f${route.week}-${youTeamId}`} week={route.week} />}
    </div>
  );
}
