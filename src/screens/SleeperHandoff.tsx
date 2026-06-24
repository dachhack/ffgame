import { useState } from 'react';
import { useStore } from '../app/store';
import { resolveUser } from '../data/sleeper';
import { prefetchPlayerDirectory } from '../data/sleeperPlayers';

// Inline "play it with YOUR team" capture — dropped onto the demo end-cards at the
// moment of peak intent so a wowed visitor goes straight from the demo into their
// real Sleeper league instead of bouncing back to the splash to hunt for the box.
// Reuses the splash's resolve flow verbatim (resolve → cache user → prefetch the
// player directory → leagues list, which fast-paths a single-league user in).
export function SleeperHandoff({ heading = 'PLAY IT WITH YOUR REAL TEAM' }: { heading?: string }) {
  const { navigate, setSleeperUser, sleeperUser } = useStore();
  const [name, setName] = useState(sleeperUser?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const u = name.trim();
    if (!u || busy) return;
    setBusy(true); setErr(null);
    try {
      const user = await resolveUser(u);
      if (!user) { setErr(`No Sleeper user “${u}”. Check the spelling.`); setBusy(false); return; }
      setSleeperUser(user);
      prefetchPlayerDirectory();
      navigate({ name: 'leagues' });
    } catch {
      setErr('Could not reach Sleeper. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div style={{ textAlign: 'left' }}>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700, marginBottom: 7, textAlign: 'center' }}>{heading}</div>
      <div style={{ display: 'flex', gap: 8 }}>
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
      {err
        ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 }}>{err}</div>
        : <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 9, lineHeight: 1.4, textAlign: 'center' }}>Username only — never a password. Loads your actual 2025 league in seconds.</div>}
    </div>
  );
}
