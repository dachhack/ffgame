import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher } from '../app/ui';
import { liveConfigured } from '../data/supabaseClient';
import {
  sendMagicLink, verifyEmailOtp, signInPassword, signUpPassword, sendPasswordReset, updatePassword,
  getSession, onAuth, signOut, ensureAppUser,
  previewLeague, redeemPreview, redeemInvite, myEnrollments,
  startCommishVerify, confirmCommishVerify, isAdmin, commishOverview,
  type Enrollment, type LeaguePreview, type PreviewRedeem,
} from '../data/liveApi';
import { LivePicks } from './LivePicks';
import { LiveBoard } from './LiveBoard';
import { AdminPage } from './AdminPage';
import { CommishDash } from './CommishDash';
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
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!liveConfigured) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); });
    return onAuth((s, ev) => { setSession(s); if (ev === 'PASSWORD_RECOVERY') setRecovery(true); });
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
            : recovery ? <SetPassword onDone={() => setRecovery(false)} />
            : !session ? <AuthForm />
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

type AuthMode = 'signin' | 'signup' | 'forgot' | 'magic';

function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const reset = () => { setErr(null); setInfo(null); };
  const go = (m: AuthMode) => { setMode(m); setSent(false); reset(); };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); reset();
    try { await fn(); } catch (x) { setErr(x instanceof Error ? x.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };
  const submit = () => {
    if (!email.trim()) return;
    if (mode === 'signin') return run(() => signInPassword(email, password));
    if (mode === 'signup') return run(async () => { const r = await signUpPassword(email, password); if (r.needsConfirm) setInfo('Account created — check your email to confirm, then sign in.'); });
    if (mode === 'forgot') return run(async () => { await sendPasswordReset(email); setInfo('If that email has an account, a reset link is on its way.'); });
    return run(async () => { await sendMagicLink(email); setSent(true); });
  };
  const verify = () => run(() => verifyEmailOtp(email, token));

  // magic-link sent → OTP entry
  if (mode === 'magic' && sent) return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Check your email</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5 }}>
        Sent to <span style={{ color: 'var(--text)' }}>{email.trim()}</span>. Tap the link — or enter the 6-digit code:
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={token} autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          onChange={(e) => { setToken(e.target.value.replace(/\D/g, '')); reset(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') verify(); }}
          placeholder="123456" style={{ ...input, letterSpacing: '0.3em', textAlign: 'center' }} />
        <button onClick={verify} disabled={busy || token.length < 6} className="mono" style={{ ...btn, opacity: busy || token.length < 6 ? 0.6 : 1 }}>{busy ? '…' : 'VERIFY'}</button>
      </div>
      {err && <div className="mono" style={errStyle}>{err}</div>}
      <button onClick={() => go('signin')} className="mono" style={{ ...linkBtn, marginTop: 12 }}>← back</button>
    </div>
  );

  const title = mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset password' : mode === 'magic' ? 'Email me a sign-in link' : 'Sign in';
  const cta = mode === 'signup' ? 'CREATE ACCOUNT' : mode === 'forgot' ? 'SEND RESET LINK' : mode === 'magic' ? 'SEND LINK →' : 'SIGN IN';
  const showPw = mode === 'signin' || mode === 'signup';

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>
          {mode === 'signin' ? <>The <span style={{ color: 'var(--you)' }}>live H2H</span> pilot.</> : title}
        </div>
        {mode === 'signin' && <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 10 }}>Sign in to set your lineup and watch it play live.</div>}
      </div>
      <div style={card}>
        <label className="mono" style={label}>EMAIL</label>
        <input value={email} autoFocus type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => { setEmail(e.target.value); reset(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !showPw) submit(); }}
          placeholder="you@example.com" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7 }} />
        {showPw && (
          <>
            <label className="mono" style={{ ...label, display: 'block', marginTop: 12 }}>PASSWORD</label>
            <input value={password} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              onChange={(e) => { setPassword(e.target.value); reset(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder={mode === 'signup' ? 'at least 6 characters' : '••••••••'} style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7 }} />
          </>
        )}
        <button onClick={submit} disabled={busy || !email.trim() || (showPw && password.length < 6)} className="mono"
          style={{ ...btn, width: '100%', padding: '11px 0', marginTop: 14, opacity: busy || !email.trim() || (showPw && password.length < 6) ? 0.6 : 1 }}>{busy ? '…' : cta}</button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
        {info && <div className="mono" style={{ ...errStyle, color: 'var(--you)' }}>{info}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          {mode === 'signin' && <button onClick={() => go('signup')} className="mono" style={linkBtn}>create account</button>}
          {mode === 'signin' && <button onClick={() => go('forgot')} className="mono" style={linkBtn}>forgot password?</button>}
          {mode !== 'signin' && <button onClick={() => go('signin')} className="mono" style={linkBtn}>← sign in</button>}
          {mode !== 'magic' && <button onClick={() => go('magic')} className="mono" style={linkBtn}>email me a link instead</button>}
        </div>
      </div>
    </>
  );
}

function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (pw.length < 6) { setErr('At least 6 characters.'); return; }
    setBusy(true); setErr(null);
    try { await updatePassword(pw); setDone(true); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not update.'); }
    finally { setBusy(false); }
  };
  return (
    <div style={card}>
      <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{done ? 'Password updated' : 'Set a new password'}</div>
      {done ? (
        <>
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10 }}>You’re signed in.</div>
          <button onClick={onDone} className="mono" style={{ ...btn, width: '100%', padding: '11px 0', marginTop: 14 }}>CONTINUE</button>
        </>
      ) : (
        <>
          <input value={pw} type="password" autoFocus autoComplete="new-password" onChange={(e) => { setPw(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }} placeholder="new password" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 12 }} />
          <button onClick={save} disabled={busy} className="mono" style={{ ...btn, width: '100%', padding: '11px 0', marginTop: 12, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : 'SAVE PASSWORD'}</button>
          {err && <div className="mono" style={errStyle}>{err}</div>}
        </>
      )}
    </div>
  );
}

function Enroll({ session }: { session: Session }) {
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [isCommish, setIsCommish] = useState(false);
  const [view, setView] = useState<'home' | 'commish' | 'commishdash' | 'picks' | 'board' | 'admin'>('home');

  const refresh = async () => {
    try { await ensureAppUser(session); setEnrollments(await myEnrollments(session.user.id)); }
    catch { setEnrollments([]); }
    commishOverview().then((l) => setIsCommish((l?.length ?? 0) > 0)).catch(() => setIsCommish(false));
  };
  useEffect(() => {
    refresh();
    isAdmin().then(setAdmin).catch(() => setAdmin(false));
    /* eslint-disable-next-line */
  }, [session.user.id]);

  if (view === 'commish') return <CommishVerify onBack={() => { setView('home'); refresh(); }} />;
  if (view === 'commishdash') return <CommishDash onBack={() => setView('home')} />;
  if (view === 'picks') return <LivePicks userId={session.user.id} onBack={() => setView('home')} />;
  if (view === 'board') return <LiveBoard userId={session.user.id} onBack={() => setView('home')} />;
  if (view === 'admin') return <AdminPage onBack={() => setView('home')} />;
  if (enrollments === null) return <Muted text="Loading your leagues…" />;
  return (
    <>
      {enrollments.length > 0 ? <Enrolled enrollments={enrollments} /> : <RedeemForm onJoined={refresh} />}
      <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {enrollments.length > 0 && <button onClick={() => setView('picks')} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>◈ set your lineup →</button>}
        {enrollments.length > 0 && <button onClick={() => setView('board')} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>◫ live board →</button>}
        {isCommish && <button onClick={() => setView('commishdash')} className="mono" style={{ ...linkBtn, color: 'var(--text)' }}>⚑ manage my league →</button>}
        <button onClick={() => setView('commish')} className="mono" style={linkBtn}>I’m the commissioner — verify my league →</button>
        {admin && <button onClick={() => setView('admin')} className="mono" style={{ ...linkBtn, color: 'var(--text)' }}>⚙ super admin →</button>}
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
      <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?live=1&code=${invite}`); setCopied(true); }}
        className="mono" style={{ ...btn, width: '100%', padding: '10px 0', marginTop: 8, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' }}>
        ⛓ copy one-tap join link
      </button>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>Players who open the link just sign in and confirm — no code to type. You can remove the tag from your Sleeper team name now.</div>
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
  const [team, setTeam] = useState<PreviewRedeem | null>(null); // confirm step
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const find = async (c0?: string) => {
    const c = (c0 ?? code).trim();
    if (!c || busy) return;
    setBusy(true); setErr(null);
    try {
      const p = await previewLeague(c);
      if (!p) setErr('No league found for that code. If you’re the commissioner, use “verify my league” below.');
      else setPreview(p);
    } catch (x) { setErr(x instanceof Error ? x.message : 'Lookup failed.'); }
    finally { setBusy(false); }
  };

  // A commissioner share link pre-fills the code (survives the magic-link bounce).
  useEffect(() => {
    let c: string | null = null;
    try { c = localStorage.getItem('dripInviteCode'); } catch { /* ignore */ }
    if (c) { setCode(c); find(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the Sleeper username → which team you'd join, before committing.
  const check = async () => {
    if (!username.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await redeemPreview(code, username);
      if (!r.ok) { setErr(r.error ?? 'Could not match your account.'); } else setTeam(r);
    } catch (x) { setErr(x instanceof Error ? x.message : 'Lookup failed.'); }
    finally { setBusy(false); }
  };

  const join = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await redeemInvite(code, username);
      if (!r.ok) { setErr(r.error ?? 'Could not join.'); setBusy(false); return; }
      try { localStorage.removeItem('dripInviteCode'); } catch { /* ignore */ }
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
          {!preview && <button onClick={() => find()} disabled={busy || !code.trim()} className="mono" style={{ ...btn, opacity: busy || !code.trim() ? 0.6 : 1 }}>{busy ? '…' : 'FIND'}</button>}
        </div>

        {preview && !team && (
          <div style={{ marginTop: 14 }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginBottom: 10 }}>
              Joining <span style={{ color: 'var(--text)', fontWeight: 700 }}>{preview.name}</span> · {preview.season}
            </div>
            <label className="mono" style={label}>SLEEPER USERNAME</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input value={username} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => { setUsername(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
                placeholder="your Sleeper handle" style={input} />
              <button onClick={check} disabled={busy || !username.trim()} className="mono" style={{ ...btn, opacity: busy || !username.trim() ? 0.6 : 1 }}>{busy ? '…' : 'NEXT →'}</button>
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>We match your Sleeper account to your team in this league.</div>
          </div>
        )}

        {team && (
          <div style={{ marginTop: 14 }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>You’ll join as</div>
            <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--you)', margin: '4px 0 12px' }}>{team.team}</div>
            <button onClick={join} disabled={busy} className="mono" style={{ ...btn, width: '100%', padding: '11px 0', opacity: busy ? 0.6 : 1 }}>{busy ? 'JOINING…' : 'CONFIRM & JOIN'}</button>
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button onClick={() => { setTeam(null); setErr(null); }} className="mono" style={linkBtn}>not me — change username</button>
            </div>
          </div>
        )}
        {err && <div className="mono" style={errStyle}>{err}</div>}
      </div>
    </>
  );
}
