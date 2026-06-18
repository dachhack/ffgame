import { useEffect } from 'react';
import { useStore } from './app/store';
import { THEMES, themeVars } from './theme';
import { LeagueHub } from './screens/LeagueHub';
import { LeagueOverview } from './screens/LeagueOverview';
import { Matchup } from './screens/Matchup';
import { MatchupFinal } from './screens/MatchupFinal';

export function App() {
  const { theme, route } = useStore();
  const vars = themeVars(THEMES[theme]) as Record<string, string>;

  useEffect(() => {
    document.body.style.background = THEMES[theme].bg;
  }, [theme]);

  return (
    <div
      style={{
        ...(vars as React.CSSProperties),
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {route.name === 'hub' && <LeagueHub />}
      {route.name === 'league' && <LeagueOverview />}
      {route.name === 'matchup' && <Matchup key={`m${route.week}`} week={route.week} initialPhase={route.phase} />}
      {route.name === 'final' && <MatchupFinal week={route.week} />}
    </div>
  );
}
