import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings } from '../app/ui';
import { getProvider } from '../data/providers';
import { prefetchPlayerDirectory } from '../data/sleeperPlayers';
import { getSession } from '../data/liveApi';
import { RequestCodeModal } from './RequestCode';

export function Splash() {
  const { navigate, setSleeperUser, sleeperUser, exitSimLeague } = useStore();
  const [name, setName] = useState(sleeperUser?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [requesting, setRequesting] = useState(false);
  useEffect(() => { getSession().then((s) => setSignedIn(!!s)).catch(() => {}); }, []);
  // When the Sleeper user is cleared (e.g. on sign-out) while Splash is already
  // mounted, reset the pre-filled username so it doesn't linger as an example.
  useEffect(() => { if (!sleeperUser) setName(''); }, [sleeperUser]);

  const submit = async () => {
    const u = name.trim();
    if (!u || busy) return;
    setBusy(true); setErr(null);
    try {
      const user = await getProvider().resolveUser(u);
      if (!user) { setErr(`No Sleeper user “${u}”. Check the spelling.`); setBusy(false); return; }
      setSleeperUser(user);
      prefetchPlayerDirectory(); // ~5MB directory downloads while they browse leagues
      navigate({ name: 'leagues' });
    } catch {
      setErr('Could not reach Sleeper. Check your connection and try again.');
      setBusy(false);
    }
  };

  const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}>◈ DRIP FANTASY</span>
          {sleeperUser && <button onClick={() => navigate({ name: 'leagues' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← {sleeperUser.displayName}’s leagues</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SiteSettings />
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div className="grotesk" style={{ fontSize: 'clamp(20px, 6vw, 30px)', whiteSpace: 'nowrap', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>
              Add some <span style={{ color: 'var(--you)' }}>Drip</span> to your league.
            </div>
            <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
              Real-time fantasy of hidden picks and live effects. Drop in your Sleeper league and watch a week play out — in seconds.
            </div>
          </div>

          {/* One funnel: 1) learn (watch the demo) → 2) personalize (your league)
              → 3) fallback (sample league). Avoids three co-equal "demo" CTAs. */}

          {/* ── 1. Learn — watch the 60-second demo (primary) ────────────────── */}
          <button onClick={() => { exitSimLeague(); navigate({ name: 'demo' }); }} className="mono" style={{ width: '100%', fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 8, padding: '15px 0', cursor: 'pointer' }}>
            ▶  Watch the 60-second demo
          </button>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>A full week of hidden picks + live effects, scored off real plays — in 60 seconds.</div>

          {/* ── 2. Personalize — run it with your own Sleeper league ──────────── */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18, marginTop: 18 }}>
            <label className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 }}>RUN IT WITH YOUR LEAGUE</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="your Sleeper username"
                spellCheck={false} autoCapitalize="none" autoCorrect="off"
                style={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none' }}
              />
              <button onClick={submit} disabled={busy || !name.trim()} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '0 18px', cursor: busy ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {busy ? '…' : 'LOAD →'}
              </button>
            </div>
            {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 }}>{err}</div>}
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>Sleeper public API — username only, never a password.</div>
            <div style={{ borderTop: '1px solid var(--bd)', marginTop: 14, paddingTop: 12, textAlign: 'center', display: 'flex', flexWrap: 'wrap', gap: '4px 14px', justifyContent: 'center' }}>
              <button onClick={() => navigate({ name: 'connect', provider: 'espn' })} className="mono" style={{ ...linkBtn, color: 'var(--dim)' }}>On ESPN? →</button>
              <button onClick={() => navigate({ name: 'connect', provider: 'fleaflicker' })} className="mono" style={{ ...linkBtn, color: 'var(--dim)' }}>On Fleaflicker? →</button>
              <button onClick={() => navigate({ name: 'connect', provider: 'mfl' })} className="mono" style={{ ...linkBtn, color: 'var(--dim)' }}>On MFL? →</button>
            </div>
          </div>

          {/* ── 3. Fallback — no Sleeper account → browse a sample league ─────── */}
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button onClick={() => { exitSimLeague(); navigate({ name: 'hub' }); }} className="mono" style={{ ...linkBtn, color: 'var(--dim)' }}>No Sleeper account? Browse a sample league →</button>
          </div>

          {/* ── Pilot (invited players) — compact, secondary ─────────────────── */}
          <div style={{ borderTop: '1px solid var(--bd)', marginTop: 22, paddingTop: 16, textAlign: 'center' }}>
            {signedIn ? (
              <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}>↩ Continue to your live league →</button>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}>◈ Already invited? Sign in</button>
                <span style={{ color: 'var(--faint)' }}>·</span>
                <button onClick={() => setRequesting(true)} className="mono" style={{ ...linkBtn, color: 'var(--faint)' }}>get a league code</button>
              </span>
            )}
          </div>
        </div>
      </main>

      {requesting && <RequestCodeModal initialSleeper={sleeperUser?.username ?? ''} onClose={() => setRequesting(false)} />}
    </div>
  );
}
