import { useEffect, lazy, Suspense } from 'react';
import { useStore, PHOTO_SKINS } from './app/store';
import { THEMES, themeVars } from '@drip/core/theme';
import { DemoBoard } from './screens/DemoBoard';
import { yahooExchange } from '@drip/core/data/providers/yahooClient';
import { getSession, hasAuthTokensInUrl, captureAuthUrlError } from '@drip/core/data/liveApi';
import { RequestCodeFab } from './screens/RequestCode';
import { InstallPrompt } from './app/InstallPrompt';
import { PlayerCardHost, setCardLeague } from './app/playerCard';
import { UpdateBanner } from './app/UpdateBanner';
import { DEMO_WEEK } from '@drip/core/config';

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

  // The player card's league context (v0.282.0): the board knows its league
  // through liveCtx, and clearing it on the way out keeps a card opened from
  // the demo or the leagues list from claiming the last league's owner.
  useEffect(() => { setCardLeague(liveCtx?.leagueId ?? null); }, [liveCtx?.leagueId]);

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
    // A FAILED auth return (?error=…&error_code=bad_oauth_state). Handled BEFORE
    // the ?live=1 branch below and outside it, because Supabase's error redirect
    // doesn't necessarily carry our redirectTo query back — so this used to match
    // nothing at all: no cleanup, no message, the raw error left in the address
    // bar and the user dropped on the marketing page wondering what happened.
    // Capture it, scrub the URL, and go where sign-in actually lives so they can
    // read the reason and retry.
    if (captureAuthUrlError()) {
      try { window.history.replaceState({}, '', window.location.pathname + '#/live'); } catch { /* ignore */ }
      navigate({ name: 'live' });
      return;
    }
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
      // A SOLO- pass (0097) rides the same ?code= param but is redeemed by the
      // solo-pass flow, not the league-invite form.
      if (code && /^solo-/i.test(code)) { try { localStorage.setItem('dripSoloPass', code.toUpperCase()); } catch { /* ignore */ } }
      else if (code) { try { localStorage.setItem('dripInviteCode', code.toUpperCase()); } catch { /* ignore */ } }
      // A commissioner invite link (?commish=CODE) → stash the commish code so it
      // survives the magic-link bounce; LiveOnboard opens the claim screen.
      const commish = p.get('commish');
      if (commish) { try { localStorage.setItem('dripCommishCode', commish.toUpperCase()); } catch { /* ignore */ } }
      // A DFS league invite link (?dfs=CODE) → stash; LiveOnboard auto-joins
      // after sign-in (0094 — the link IS the access; no card in the chooser).
      const dfs = p.get('dfs');
      if (dfs) { try { localStorage.setItem('dripDfsCode', dfs.toUpperCase()); } catch { /* ignore */ } }
      const finish = () => {
        navigate({ name: 'live' });
        // Consume the params so a later refresh doesn't teleport back into Live (the
        // route now lives in the hash). Keep the path + the just-set #/live hash.
        try { window.history.replaceState(window.history.state, '', window.location.pathname + '#/live'); } catch { /* ignore */ }
      };
      // An OAuth / magic-link return carries the session in the URL hash
      // (#access_token=…). The Supabase SDK loads lazily and reads the URL only
      // once created — rewriting the URL first would destroy the tokens and bounce
      // the user back to the sign-in form. getSession() awaits the SDK's URL
      // detection, so the tokens are consumed before the hash is replaced.
      if (hasAuthTokensInUrl()) getSession().then(finish, finish);
      else finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Is the request-a-code FAB on screen? It owns the bottom-left corner, so the
  // install banner has to sit above it (see the comment on the FAB below).
  const fab = !['live', 'splash', 'demo', 'matchup', 'final'].includes(route.name) && !liveCtx && !loggedIn;

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
      <UpdateBanner />
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
      {fab && <RequestCodeFab />}
      {/* "Add to home screen" — everywhere except the board and the final, where a
          bottom banner would sit on top of the live playout. Self-gating: renders
          nothing unless the browser can install and the visitor is warmed up. */}
      {!['matchup', 'final'].includes(route.name) && <InstallPrompt raised={fab} />}
      {/* Player card modal — any surface opens it via openPlayerCard() */}
      <PlayerCardHost />
    </div>
  );
}
