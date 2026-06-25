import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher } from '../app/ui';
import { resolveUser } from '../data/sleeper';
import { prefetchPlayerDirectory } from '../data/sleeperPlayers';
import { getSession } from '../data/liveApi';

export function Splash() {
  const { navigate, setSleeperUser, sleeperUser, exitSimLeague } = useStore();
  const [name, setName] = useState(sleeperUser?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { getSession().then((s) => setSignedIn(!!s)).catch(() => {}); }, []);

  const submit = async () => {
    const u = name.trim();
    if (!u || busy) return;
    setBusy(true); setErr(null);
    try {
      const user = await resolveUser(u);
      if (!user) { setErr(`No Sleeper user “${u}”. Check the spelling.`); setBusy(false); return; }
      setSleeperUser(user);
      // Start the ~5MB player-directory download now so it overlaps with browsing
      // leagues — by the time they hit RUN SIM it's cached and the build is fast.
      prefetchPlayerDirectory();
      navigate({ name: 'leagues' });
    } catch {
      setErr('Could not reach Sleeper. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}>◈ DRIP FANTASY</span>
          {sleeperUser && <button onClick={() => navigate({ name: 'leagues' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← {sleeperUser.displayName}’s leagues</button>}
        </div>
        <ThemeSwitcher />
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div className="grotesk" style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>
              See <span style={{ color: 'var(--you)' }}>your real league</span> play out.
            </div>
            <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
              Drop your Sleeper username — we’ll load your actual 2025 league, your team and your leaguemates, into the drip game in seconds.
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: 18 }}>
            <label className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 }}>SLEEPER USERNAME</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input
                value={name}
                autoFocus
                onChange={(e) => { setName(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="e.g. dachhack"
                spellCheck={false} autoCapitalize="none" autoCorrect="off"
                style={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none' }}
              />
              <button onClick={submit} disabled={busy || !name.trim()} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '0 18px', cursor: busy ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {busy ? '…' : 'LOAD →'}
              </button>
            </div>
            {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 }}>{err}</div>}
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
              Pulled live from Sleeper’s public API. We never see a password — username only.
            </div>
          </div>

          <button onClick={() => { exitSimLeague(); navigate({ name: 'demo' }); }} className="mono" style={{ width: '100%', marginTop: 14, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--you) 45%, var(--bd))', borderRadius: 6, padding: '13px 0', cursor: 'pointer' }}>
            ▶ New here? Watch the 60-second demo
          </button>

          <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => navigate({ name: 'live' })} className="mono" style={{ width: '100%', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '12px 0', cursor: 'pointer' }}>
              {signedIn ? '↩ continue to your live H2H league →' : '◈ Have a pilot invite? Join the live H2H league →'}
            </button>
            <button onClick={() => { exitSimLeague(); navigate({ name: 'hub' }); }} className="mono" style={{ background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', cursor: 'pointer' }}>
              or explore the demo league hands-on →
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
