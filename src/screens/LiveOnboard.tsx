import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher } from '../app/ui';
import { liveConfigured } from '../data/supabaseClient';
import {
  sendMagicLink, getSession, onAuth, signOut, ensureAppUser,
  previewLeague, redeemInvite, myEnrollments,
  startCommishVerify, confirmCommishVerify,
  type Enrollment, type LeaguePreview,
} from '../data/liveApi';
import { LivePicks } from './LivePicks';
import type { Session } from '@supabase/supabase-js';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const label: React.CSSProperties = { fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 };
const input: React.CSSProperties = { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none' };
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '0 16px', cursor: 'pointer', whiteSpace: 'nowrap' };
const errStyle: React.CSSProperties = { fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

export function LiveOnboard() {
  const { navigate } = useStore();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!liveConfigured) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); });
    return onAuth(setSession);
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}>◈ DRIP LEAGUE FF · LIVE</span>
          <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← demo</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {session && <button onClick={() => signOut()} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>sign out</button>}
          <ThemeSwitcher />
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          {!liveConfigured ? <NotConfigured />
            : !ready ? <Muted text="Loading…" />
            : !session ? <SignIn />
            : <Enroll session={session} />}
        </div>
      </main>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>{text}</div>;
}

function NotConfigured() {
  return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Live mode isn’t configured</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
        This build has no <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>. Add them to <code>.env.local</code> and rebuild to enable sign-in + live H2H. The static demo is unaffected.
      </div>
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const e = email.trim();
    if (!e || busy) return;
    setBusy(true); setErr(null);
    try { await sendMagicLink(e); setSent(true); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not send the link.'); }
    finally { setBusy(false); }
  };

  if (sent) return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Check your email</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
        We sent a sign-in link to <span style={{ color: 'var(--text)' }}>{email.trim()}</span>. Open it on this device to continue.
      </div>
    </div>
  );

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>
          Join the <span style={{ color: 'var(--you)' }}>live H2H</span> pilot.
        </div>
        <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
          Sign in with your email — we’ll send a one-tap link. Then enter your league’s invite code.
        </div>
      </div>
      <div style={card}>
        <label className="mono" style={label}>EMAIL</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
          <input value={email} autoFocus type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setEmail(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="you@example.com" style={input} />
          <button onClick={submit} disabled={busy || !email.trim()} className="mono" style={{ ...btn, opacity: busy || !email.trim() ? 0.6 : 1 }}>{busy ? '…' : 'SEND →'}</button>
        </div>
        {err && <div className="mono" style={errStyle}>{err}</div>}
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>No password — a magic link signs you in.</div>
      </div>
    </>
  );
}

function Enroll({ session }: { session: Session }) {
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [view, setView] = useState<'home' | 'commish' | 'picks'>('home');

  const refresh = async () => {
    try { await ensureAppUser(session); setEnrollments(await myEnrollments(session.user.id)); }
    catch { setEnrollments([]); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [session.user.id]);

  if (view === 'commish') return <CommishVerify onBack={() => { setView('home'); refresh(); }} />;
  if (view === 'picks') return <LivePicks userId={session.user.id} onBack={() => setView('home')} />;
  if (enrollments === null) return <Muted text="Loading your leagues…" />;
  return (
    <>
      {enrollments.length > 0 ? <Enrolled enrollments={enrollments} /> : <RedeemForm onJoined={refresh} />}
      <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {enrollments.length > 0 && <button onClick={() => setView('picks')} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>◈ set your lineup →</button>}
        <button onClick={() => setView('commish')} className="mono" style={linkBtn}>I’m the commissioner — verify my league →</button>
      </div>
    </>
  );
}

function CommishVerify({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [league, setLeague] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    if (!code.trim() || !username.trim() || busy) return;
    setBusy(true); setErr(null);
    const r = await startCommishVerify(code, username);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Could not start verification.'); return; }
    setTag(r.tag ?? null); setLeague(r.league ?? '');
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await confirmCommishVerify(code);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Not verified yet.'); return; }
    setInvite(r.invite_code ?? null); setLeague(r.league ?? league);
  };

  if (invite) return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--you)' }}>Verified — you’re the commissioner.</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8 }}>{league}. Share this player invite code with your league:</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <div className="mono" style={{ flex: 1, fontSize: 20, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '12px 14px', textAlign: 'center' }}>{invite}</div>
        <button onClick={() => { navigator.clipboard?.writeText(invite); setCopied(true); }} className="mono" style={{ ...btn, padding: '0 14px' }}>{copied ? 'COPIED' : 'COPY'}</button>
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>You can now remove the tag from your Sleeper team name.</div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← done</button></div>
    </div>
  );

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Verify as commissioner</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Enter the commissioner code you were given, and prove you run the league by tagging your Sleeper team name.</div>
      </div>
      <div style={card}>
        {!tag ? (
          <>
            <label className="mono" style={label}>COMMISSIONER CODE</label>
            <input value={code} autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(null); }}
              placeholder="e.g. 9F3A1C2D" style={{ ...input, letterSpacing: '0.12em', marginTop: 7, width: '100%', boxSizing: 'border-box' }} />
            <label className="mono" style={{ ...label, display: 'block', marginTop: 12 }}>YOUR SLEEPER USERNAME</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input value={username} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => { setUsername(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
                placeholder="your Sleeper handle" style={input} />
              <button onClick={start} disabled={busy || !code.trim() || !username.trim()} className="mono" style={{ ...btn, opacity: busy || !code.trim() || !username.trim() ? 0.6 : 1 }}>{busy ? '…' : 'START'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.6 }}>
              {league && <>Verifying <span style={{ color: 'var(--text)', fontWeight: 700 }}>{league}</span>.<br /></>}
              In Sleeper, add this tag to your team name, then tap Check:
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--you)', background: 'var(--bg)', border: '1px solid var(--you)', borderRadius: 6, padding: '12px 14px', textAlign: 'center', margin: '12px 0' }}>{tag}</div>
            <button onClick={confirm} disabled={busy} className="mono" style={{ ...btn, width: '100%', padding: '11px 0', opacity: busy ? 0.6 : 1 }}>{busy ? 'CHECKING…' : 'CHECK ✓'}</button>
            <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={() => { setTag(null); setErr(null); }} className="mono" style={linkBtn}>start over</button></div>
          </>
        )}
        {err && <div className="mono" style={errStyle}>{err}</div>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </>
  );
}

function Enrolled({ enrollments }: { enrollments: Enrollment[] }) {
  return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--you)' }}>You’re in.</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Enrolled in:</div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {enrollments.map((e, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{e.team_name}</div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>{e.league?.name ?? 'League'} · {e.league?.season ?? ''}</div>
            </div>
            <span className="mono" style={{ fontSize: 9, color: 'var(--you)', border: '1px solid var(--you)', borderRadius: 4, padding: '3px 7px' }}>ENROLLED</span>
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 14, lineHeight: 1.5 }}>
        Your weekly matchups appear here once the schedule syncs and games kick off. (Live board — coming in the next slice.)
      </div>
    </div>
  );
}

function RedeemForm({ onJoined }: { onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const find = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setErr(null);
    try {
      const p = await previewLeague(c);
      if (!p) setErr('No league found for that code.'); else setPreview(p);
    } catch (x) { setErr(x instanceof Error ? x.message : 'Lookup failed.'); }
    finally { setBusy(false); }
  };

  const join = async () => {
    if (!username.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await redeemInvite(code, username);
      if (!r.ok) { setErr(r.error ?? 'Could not join.'); setBusy(false); return; }
      onJoined();
    } catch (x) { setErr(x instanceof Error ? x.message : 'Could not join.'); setBusy(false); }
  };

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Enter your league code</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Your commissioner shares this. Then link your Sleeper account to claim your team.</div>
      </div>
      <div style={card}>
        <label className="mono" style={label}>INVITE CODE</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
          <input value={code} autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') find(); }}
            placeholder="e.g. A1B2C3D4" style={{ ...input, letterSpacing: '0.15em', textTransform: 'uppercase' }} />
          {!preview && <button onClick={find} disabled={busy || !code.trim()} className="mono" style={{ ...btn, opacity: busy || !code.trim() ? 0.6 : 1 }}>{busy ? '…' : 'FIND'}</button>}
        </div>

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginBottom: 10 }}>
              Joining <span style={{ color: 'var(--text)', fontWeight: 700 }}>{preview.name}</span> · {preview.season}
            </div>
            <label className="mono" style={label}>SLEEPER USERNAME</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input value={username} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => { setUsername(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
                placeholder="your Sleeper handle" style={input} />
              <button onClick={join} disabled={busy || !username.trim()} className="mono" style={{ ...btn, opacity: busy || !username.trim() ? 0.6 : 1 }}>{busy ? '…' : 'JOIN →'}</button>
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>We match your Sleeper account to your team in this league.</div>
          </div>
        )}
        {err && <div className="mono" style={errStyle}>{err}</div>}
      </div>
    </>
  );
}
