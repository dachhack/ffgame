import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings } from '../app/ui';
import { getProvider, type ProviderLeague } from '../data/providers';
import { yahooConfigured, yahooConnected, startYahooAuth, yahooDisconnect } from '../data/providers/yahooClient';

// Yahoo connect: the only OAuth provider. Sign in with Yahoo (redirect), then
// pick from the user's leagues. Token handling lives in yahooClient; the OAuth
// callback (?code) is exchanged in App.tsx before this screen mounts.
export function YahooConnect() {
  const { navigate, loadSimLeague } = useStore();
  const [leagues, setLeagues] = useState<ProviderLeague[] | null>(null);
  const [addKdst, setAddKdst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const connected = yahooConnected();

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    getProvider('yahoo').getLeagues({ provider: 'yahoo', userId: 'me', username: 'me', displayName: 'Yahoo', avatar: null })
      .then((ls) => { if (alive) setLeagues(ls); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Could not load your Yahoo leagues.'); });
    return () => { alive = false; };
  }, [connected]);

  const run = async (lg: ProviderLeague) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const { built, youTeamId } = await getProvider('yahoo').buildLeague(lg.leagueId, '', setNote, { addKdst });
      loadSimLeague(built, youTeamId);
      navigate({ name: 'hub' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load that Yahoo league.');
      setBusy(false);
    }
  };

  const wrap = (kids: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', padding: '6px 9px', borderRadius: 4, cursor: 'pointer' }}>← BACK</button>
          <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Connect a Yahoo league</span>
        </div>
        <SiteSettings />
      </header>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: 460 }}>{kids}</div>
      </main>
    </div>
  );

  if (!yahooConfigured) return wrap(
    <div className="mono" style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 }}>
      Yahoo sign-in isn’t configured for this site yet. It needs a registered Yahoo app
      (<b>VITE_YAHOO_CLIENT_ID</b> in the build) and the <b>yahoo-oauth</b> Edge Function
      with the app’s client id/secret.
    </div>,
  );

  if (!connected) return wrap(
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: 18, textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 14 }}>Sign in with Yahoo to load one of your real Yahoo Fantasy leagues.</div>
      <button onClick={startYahooAuth} className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '12px 22px', cursor: 'pointer' }}>Sign in with Yahoo →</button>
      <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 14 }}>Fantasy data provided by Yahoo Fantasy.</div>
    </div>,
  );

  return wrap(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <button type="button" onClick={() => setAddKdst((v) => !v)} disabled={busy} className="mono" title="Adds a real K and DST to any team missing one." style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', padding: 0, cursor: busy ? 'default' : 'pointer', color: 'var(--dim)' }}>
          <span style={{ width: 30, height: 17, borderRadius: 999, background: addKdst ? 'var(--you)' : 'var(--bd)', position: 'relative', flex: 'none' }}>
            <span style={{ position: 'absolute', top: 2, left: addKdst ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: 'var(--on-accent)' }} />
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: addKdst ? 'var(--text)' : 'var(--dim)' }}>ADD K &amp; DST</span>
        </button>
        <button onClick={() => { yahooDisconnect(); navigate({ name: 'splash' }); }} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer' }}>sign out</button>
      </div>

      {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', lineHeight: 1.4 }}>{err}</div>}
      {busy && <div className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>{note || 'Building…'}</div>}
      {!leagues && !err && <div className="mono" style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.08em' }}>LOADING YOUR LEAGUES…</div>}
      {leagues && leagues.length === 0 && <div className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>No NFL leagues found on this Yahoo account.</div>}
      {leagues?.map((lg) => (
        <button key={lg.leagueId} onClick={() => run(lg)} disabled={busy} style={{ textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 6, padding: 14, cursor: busy ? 'default' : 'pointer' }}>
          <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{lg.name}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 3 }}>YAHOO · {lg.leagueId}</div>
        </button>
      ))}
    </div>,
  );
}
