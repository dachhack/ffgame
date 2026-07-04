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
import { ProviderConnect } from './screens/ProviderConnect';
import { YahooConnect } from './screens/YahooConnect';
import { yahooExchange } from './data/providers/yahooClient';
import { LiveOnboard } from './screens/LiveOnboard';
import { DemoBoard } from './screens/DemoBoard';
import { RequestCodeFab } from './screens/RequestCode';
import { DEMO_WEEK } from './config';

export function App() {
  const { theme, route, youTeamId, navigate, liveCtx } = useStore();
  const vars = themeVars(THEMES[theme]) as Record<string, string>;
  const light = theme === 'daylight' || theme === 'arctic';
  // A signed-in live user already has a league — hide the "request a league code"
  // invite CTA for them (they reached the demo/sim board from their leagues).
  const loggedIn = (() => { try { return localStorage.getItem('dripLive') === '1'; } catch { return false; } })();

  useEffect(() => {
    document.body.style.background = THEMES[theme].bg;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  }, [theme, light]);

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
      {/* Persistent "out" across the funnel — request a pilot code for your league.
          Hidden inside the live pilot itself (you're already in), on the hero board
          (a real pilot matchup), on splash (its own "request an invite" link), and
          on the demo landing (it carries its own request-a-code CTA). */}
      {route.name !== 'live' && route.name !== 'splash' && !(route.name === 'demo' && route.view !== 'board') && !liveCtx && !loggedIn && <RequestCodeFab />}
    </div>
  );
}
