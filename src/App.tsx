import { useEffect } from 'react';
import { useStore } from './app/store';
import { THEMES, themeVars } from './theme';
import { LeagueHub } from './screens/LeagueHub';
import { LeagueOverview } from './screens/LeagueOverview';
import { Matchup } from './screens/Matchup';
import { MatchupFinal } from './screens/MatchupFinal';

export function App() {
  const { theme, route, bigText } = useStore();
  const vars = themeVars(THEMES[theme]) as Record<string, string>;
  const light = theme === 'daylight' || theme === 'arctic';

  useEffect(() => {
    document.body.style.background = THEMES[theme].bg;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  }, [theme, light]);

  // Larger-text mode: zoom the whole document (browser-zoom-like — text grows and
  // reflows to fit width, no horizontal overflow, and sticky headers still work).
  useEffect(() => {
    (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = bigText ? '1.2' : '';
  }, [bigText]);

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
      {route.name === 'hub' && <LeagueHub />}
      {route.name === 'league' && <LeagueOverview />}
      {route.name === 'matchup' && <Matchup key={`m${route.week}`} week={route.week} initialPhase={route.phase} />}
      {route.name === 'final' && <MatchupFinal week={route.week} />}
    </div>
  );
}
