import { useState } from 'react';
import { requestCode } from '../data/liveApi';
import { liveConfigured } from '../data/supabaseClient';
import { useStore } from '../app/store';

// A persistent "out" present across the whole funnel: any visitor — wowed by the
// demo, browsing leagues, mid-sim — can ask us to set their league up in the
// invite-only live pilot. Floats bottom-left; opens a small capture sheet that
// writes to the code_request table (migration 0016) for admin triage.
export function RequestCodeFab() {
  const [open, setOpen] = useState(false);
  const { sleeperUser } = useStore();
  if (!liveConfigured) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="mono" style={fab} title="Request a pilot code for your league">
        ◈ get a league code
      </button>
      {open && <RequestCodeModal initialSleeper={sleeperUser?.username ?? ''} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RequestCodeModal({ initialSleeper, onClose }: { initialSleeper: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [sleeper, setSleeper] = useState(initialSleeper);
  const [league, setLeague] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!email.trim() && !sleeper.trim()) { setErr('Add an email or your Sleeper username so we can reach you.'); return; }
    setBusy(true); setErr(null);
    const r = await requestCode({ email, sleeper, league, note });
    if (r.ok) setDone(true);
    else { setErr(r.error ?? 'Could not send — try again.'); setBusy(false); }
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div className="grotesk" style={{ fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>You’re on the list.</div>
            <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>We’ll set your league up in the pilot and send a code to redeem. Keep playing in the meantime.</div>
            <button onClick={onClose} className="mono" style={{ ...primaryBtn, marginTop: 18 }}>done</button>
          </div>
        ) : (
          <>
            <div className="grotesk" style={{ fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>Get your league in the pilot</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>The live head-to-head pilot is invite-only. Leave a way to reach you and we’ll send a code to bring your league in.</div>
            <Field label="EMAIL">
              <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} type="email" inputMode="email" placeholder="you@example.com"
                spellCheck={false} autoCapitalize="none" autoCorrect="off" style={input} />
            </Field>
            <Field label="SLEEPER USERNAME">
              <input value={sleeper} onChange={(e) => { setSleeper(e.target.value); setErr(null); }} placeholder="your Sleeper handle"
                spellCheck={false} autoCapitalize="none" autoCorrect="off" style={input} />
            </Field>
            <Field label="LEAGUE NAME (OPTIONAL)">
              <input value={league} onChange={(e) => setLeague(e.target.value)} placeholder="e.g. Sunday Scaries Dynasty" style={input} />
            </Field>
            <Field label="ANYTHING ELSE (OPTIONAL)">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="league size, when you play, questions…" rows={2} style={{ ...input, resize: 'vertical' }} />
            </Field>
            {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 4, lineHeight: 1.4 }}>{err}</div>}
            <button onClick={submit} disabled={busy} className="mono" style={{ ...primaryBtn, marginTop: 14, opacity: busy ? 0.6 : 1 }}>{busy ? 'sending…' : 'request a code →'}</button>
            <button onClick={onClose} className="mono" style={cancelBtn}>cancel</button>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.4, textAlign: 'center' }}>We only use this to reach you about the pilot.</div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <label className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 }}>{label}</label>
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  );
}

const fab: React.CSSProperties = {
  position: 'fixed', left: 14, bottom: 14, zIndex: 60,
  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)',
  background: 'color-mix(in srgb, var(--you) 10%, var(--surface))',
  border: '1px solid color-mix(in srgb, var(--you) 45%, var(--bd))', borderRadius: 999,
  padding: '8px 13px', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
};
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 380, background: 'var(--bg)', border: '1px solid var(--bd)',
  borderLeft: '3px solid var(--you)', borderRadius: 10, padding: 20, maxHeight: '90vh', overflow: 'auto',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none',
};
const primaryBtn: React.CSSProperties = {
  width: '100%', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)',
  background: 'var(--you)', border: 'none', borderRadius: 6, padding: '12px 0', cursor: 'pointer',
};
const cancelBtn: React.CSSProperties = {
  width: '100%', background: 'none', border: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--dim)', cursor: 'pointer', marginTop: 10,
};
