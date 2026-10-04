// DELETE MY ACCOUNT (0422, v0.612.0) — the way out the privacy page promised
// ("we will … delete your account") and Apple requires of the app. Type the
// email back to confirm; a commissioner of a league with other members is
// refused until the league has another commissioner or is deleted, which the
// server says by name. Leagues keep their results with the seat shown by
// team name; the account and its personal details go.
import { useState } from 'react';
import { Sheet } from './ui';
import { deleteMyAccount, friendlyError } from '@drip/core/data/liveApi';

export function DeleteAccountSheet({ email, onClose, onDeleted }: { email: string; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const match = typed.trim().toLowerCase() === email.trim().toLowerCase();
  const go = async () => {
    if (!match || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await deleteMyAccount(typed);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'could not delete the account')); return; }
      onDeleted();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title="Delete my account" subtitle="THIS CANNOT BE UNDONE" max={460} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.55 }}>
        Your account and its personal details are removed for good. Leagues you played in keep their results, with your seat shown by team name.
        If you commission a league with other members, hand it to someone else or delete it first.
      </div>
      <label className="mono" style={{ display: 'block', fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700, marginTop: 16 }}>TYPE {email.toUpperCase()} TO CONFIRM</label>
      <input value={typed} onChange={(e) => { setTyped(e.target.value); setErr(null); }} type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder={email} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none', marginTop: 7 }} />
      <button onClick={go} disabled={!match || busy} className="mono"
        style={{ width: '100%', marginTop: 12, padding: '12px 0', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--opp)', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: !match || busy ? 0.5 : 1 }}>
        {busy ? '…' : 'DELETE MY ACCOUNT'}
      </button>
      {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 }}>{err}</div>}
    </Sheet>
  );
}
