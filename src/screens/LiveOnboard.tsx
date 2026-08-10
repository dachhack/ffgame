import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings, VersionTag, Img } from '../app/ui';
import { liveConfigured } from '@drip/core/data/liveConfig';
import {
  sendMagicLink, verifyEmailOtp, signInWithProvider, signInPassword, signUpPassword, sendPasswordReset, updatePassword,
  getSession, onAuth, signOut, ensureAppUser,
  previewLeague, redeemPreview, redeemInvite, joinLeague, nativeJoin, joinPod, joinWeekly, joinDfs, createDfsLeague, redeemSoloPass, myFeatures, myEnrollments, myLinkedSleeper, claimMyRosters,
  redeemCommish, isAdmin, commishOverview, adminUserCommishLeagues, adminUserFeatures, friendlyError, deleteMockDraft,
  myMatchup, matchupTeams, leagueResults, defaultOpenWeek,
  type Enrollment, type LeaguePreview, type PreviewRedeem, type LiveMatchup, type TeamInfo, type AdminLeague, type MatchupResult,
} from '@drip/core/data/liveApi';
import { buildDripTestLeague } from '@drip/core/data/dripTest';
import { track, Ev } from '@drip/core/analytics';
import { buildLiveLeague } from '@drip/core/data/liveBoard';
import { PRESEASON_BASE, isPreseasonWeek, preseasonWeekNum, weekLabel, clearRuntimeSlate } from '@drip/core/data/nflSlate';
import { LiveBoard } from './LiveBoard';
import { GameIcon, BRAND_MARK } from '../app/gameIcons';
import { AdminPage, type LeagueTab } from './AdminPage';
import { CommishDash } from './CommishDash';
import { NativeCreate, DraftRoom, TeamManage } from './NativeLeague';
import { RequestCodeModal } from './RequestCode';
import { PodBuilder } from './PodBuilder';
import { markBootSessionChecked } from './DemoBoard';
import type { Session } from '@supabase/supabase-js';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const card2: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: 16 };
const label: React.CSSProperties = { fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 };
const input: React.CSSProperties = { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '10px 12px', outline: 'none' };
const btn: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '0 16px', cursor: 'pointer', whiteSpace: 'nowrap' };
const errStyle: React.CSSProperties = { fontSize: 10.5, color: 'var(--opp)', marginTop: 9, lineHeight: 1.4 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const providerBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '11px 0', cursor: 'pointer' };
// Flip on once the provider is configured in Supabase → Auth → Providers.
const SHOW_GOOGLE = true;
const SHOW_APPLE = false;

// Official Google "G" mark (4-color), per their sign-in branding guidelines.
function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

type OnboardView = 'home' | 'commish' | 'commishdash' | 'picks' | 'board' | 'admin' | 'add' | 'join' | 'results' | 'create' | 'draft' | 'team' | 'podbuild' | 'dfsjoin' | 'dfscreate' | 'solopass';

export function LiveOnboard() {
  const { navigate, route, viewAs, setViewAs } = useStore();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [pendingCommish, setPendingCommish] = useState<string | null>(null);
  // Honor the gear menu's "Super admin" deep link (view:'admin'); a commissioner
  // invite link is handled by the auto-claim effect below.
  const [view, setView] = useState<OnboardView>(() => (route.name === 'live' && route.view === 'admin' ? 'admin' : 'home'));

  useEffect(() => {
    if (!liveConfigured()) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); });
    return onAuth((s, ev) => { setSession(s); if (ev === 'PASSWORD_RECOVERY') setRecovery(true); });
  }, []);
  // Remember that this is a live (signed-in) user so the app boots straight to
  // their leagues next time, skipping the demo funnel. Only an explicit sign-out
  // clears it (see the sign-out button), so an expired session still lands here to
  // re-authenticate rather than dropping back to the marketing splash.
  useEffect(() => { if (session) { try { localStorage.setItem('dripLive', '1'); } catch { /* ignore */ } } }, [session]);
  useEffect(() => {
    if (!session) { setAdmin(false); return; }
    isAdmin().then(setAdmin).catch(() => setAdmin(false));
  }, [session]);
  // Commissioner invite link: once signed in, auto-claim the league from the pending
  // commish code (URL → dripCommishCode) and drop straight into league management —
  // no role chooser, no code re-entry. On failure, fall back to the manual verify
  // form with the code prefilled.
  useEffect(() => {
    if (!session) return;
    let code: string | null = null;
    try { code = localStorage.getItem('dripCommishCode'); localStorage.removeItem('dripCommishCode'); } catch { /* ignore */ }
    if (!code) return;
    setPendingCommish(code); setClaiming(true);
    redeemCommish(code)
      .then((r) => { if (r.ok) { setPendingCommish(null); setView('commishdash'); } else setView('commish'); })
      .catch(() => setView('commish'))
      .finally(() => setClaiming(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Management + in-league play views get real desktop width (their screens
  // lay out side-by-side columns that collapse on phones); onboarding/auth
  // forms stay a comfortable single column.
  const pageMax =
    view === 'admin' || view === 'commishdash' ? 1080
    : view === 'draft' ? 1160
    : view === 'team' ? 940
    : view === 'results' ? 760
    : view === 'create' ? 620
    : view === 'home' ? 960
    : 440;
  const wide = pageMax > 700;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}><GameIcon name={BRAND_MARK} emoji="◈" size="1.4em" /> DRIP FANTASY · LIVE</span>
          {/* Signed in: a shortcut back to your leagues from any sub-view (no need
              for the marketing demo). Signed out: the demo link. */}
          {session
            ? (view !== 'home' && <button onClick={() => setView('home')} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--you) 35%, var(--bd))', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← my leagues</button>)
            : <button onClick={() => navigate({ name: 'demo' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← demo</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <VersionTag />
          {session && <span className="mono" title={session.user.email ?? ''} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--you) 35%, var(--bd))', borderRadius: 4, padding: '5px 9px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◢ {sessionName(session)}</span>}
          {session && <button onClick={() => { try { localStorage.removeItem('dripLive'); } catch { /* ignore */ } signOut(); markBootSessionChecked(); navigate({ name: 'demo' }); }} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>sign out</button>}
          <SiteSettings superAdmin={session && admin ? () => setView('admin') : undefined} />
        </div>
      </header>

      {/* Unmissable while browsing as someone else. Sticky rather than inline:
          the whole point is that it can't scroll away and leave an admin unsure
          whose screen they're looking at. */}
      {viewAs && (
        <div style={{ position: 'sticky', top: 0, zIndex: 60, background: 'var(--warn)', color: '#000', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>👁 BROWSING AS {viewAs.label} — READ ONLY</span>
          <span className="mono" style={{ fontSize: 9, opacity: 0.75 }}>you are still signed in as yourself; nothing can be written in their name</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setViewAs(null)} className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: '#000', background: 'transparent', border: '1px solid rgba(0,0,0,0.45)', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', flexShrink: 0 }}>✕ exit</button>
        </div>
      )}

      <main style={{ flex: 1, display: 'flex', alignItems: wide ? 'flex-start' : 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: pageMax }}>
          {!liveConfigured() ? <NotConfigured />
            : !ready ? <Muted text="Loading…" />
            : recovery ? <SetPassword onDone={() => setRecovery(false)} />
            : !session ? <AuthForm />
            : claiming ? <Muted text="Setting up your league…" />
            : <Enroll session={session} view={view} setView={setView} commishCode={pendingCommish} admin={admin} />}
        </div>
      </main>
    </div>
  );
}

/** A friendly display name for the header chip: the chosen display name, else the
 *  local part of the email. */
function sessionName(session: Session): string {
  const dn = (session.user.user_metadata?.display_name as string | undefined)?.trim();
  if (dn) return dn;
  const email = session.user.email ?? '';
  return email.includes('@') ? email.split('@')[0] : (email || 'you');
}

function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>{text}</div>;
}

// A stable per-team key (a commissioner can hold several rosters in one league,
// so league_id alone isn't unique across enrollment cards).
const enrollKey = (e: Enrollment) => `${e.league_id}:${e.sleeper_roster_id}`;

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
  const { navigate } = useStore();
  // Framing from the invite link (persisted by App.tsx). A commissioner who
  // clicked ?commish=… should see league-setup copy, not the player pitch — so
  // signing in doesn't feel like a gate. Read-only; the code is consumed later.
  const inviteContext: 'commish' | 'player' | null = (() => {
    try {
      if (localStorage.getItem('dripCommishCode')) return 'commish';
      if (localStorage.getItem('dripInviteCode')) return 'player';
      if (localStorage.getItem('dripDfsCode')) return 'player'; // DFS link → same "join your league" framing
    } catch { /* ignore */ }
    return null;
  })();
  const commishCtx = inviteContext === 'commish';
  const playerCtx = inviteContext === 'player';
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [signupPending, setSignupPending] = useState(false); // awaiting email confirmation
  const reset = () => { setErr(null); setInfo(null); setSignupPending(false); };
  const go = (m: AuthMode) => { setMode(m); setSent(false); reset(); };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); reset();
    try { await fn(); } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const submit = () => {
    if (!email.trim()) return;
    if (mode === 'signin') return run(() => signInPassword(email, password));
    if (mode === 'signup') return run(async () => { const r = await signUpPassword(email, password); if (r.needsConfirm) { setInfo('Account created — check your email to confirm, then sign in.'); setSignupPending(true); } });
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
      {info && <div className="mono" style={{ ...errStyle, color: 'var(--you)' }}>{info}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 8 }}>
        <button onClick={() => go('signin')} className="mono" style={linkBtn}>← back</button>
        <button onClick={() => run(async () => { await sendMagicLink(email); setToken(''); setInfo('New code sent.'); })} disabled={busy} className="mono" style={{ ...linkBtn, opacity: busy ? 0.6 : 1 }}>resend code</button>
      </div>
    </div>
  );

  const title = mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset password' : mode === 'magic' ? 'Email me a sign-in link' : 'Sign in';
  const cta = mode === 'signup' ? 'CREATE ACCOUNT' : mode === 'forgot' ? 'SEND RESET LINK' : mode === 'magic' ? 'SEND LINK →' : 'SIGN IN';
  const showPw = mode === 'signin' || mode === 'signup';

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>
          {mode !== 'signin' ? title
            : commishCtx ? <>Set up your <span style={{ color: 'var(--you)' }}>league</span>.</>
            : playerCtx ? <>Join your <span style={{ color: 'var(--you)' }}>league</span>.</>
            : <>Set your lineup. <span style={{ color: 'var(--you)' }}>Watch it fight live.</span></>}
        </div>
        {mode === 'signin' && <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 10 }}>
          {commishCtx ? 'Sign in to claim and manage your league.'
            : playerCtx ? 'Sign in to claim your team and set your lineup.'
            : 'Sign in to play your week live — drips, nukes and reveals on real NFL games.'}
        </div>}
        {/* Invite expectations belong ABOVE the form, not in the fine print below
            it — an un-invited visitor shouldn't discover the wall after typing a
            password. */}
        {mode === 'signin' && !commishCtx && !playerCtx && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
            The live game is invite-only for now — you’ll need an <span style={{ color: 'var(--dim)' }}>invite code</span>.{' '}
            <button onClick={() => navigate({ name: 'demo' })} className="mono" style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, fontWeight: 700, color: 'var(--you)', cursor: 'pointer', textDecoration: 'underline' }}>
              No invite yet? Play the demo &amp; request one →
            </button>
          </div>
        )}
      </div>
      <div style={card}>
        {showPw && (SHOW_GOOGLE || SHOW_APPLE) && (
          <div style={{ marginBottom: 14 }}>
            {SHOW_GOOGLE && <button onClick={() => run(() => signInWithProvider('google'))} className="mono" style={providerBtn}><GoogleG /> Continue with Google</button>}
            {SHOW_APPLE && <button onClick={() => run(() => signInWithProvider('apple'))} className="mono" style={{ ...providerBtn, marginTop: 8 }}>Continue with Apple</button>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 2px' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>or with email</span>
              <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
            </div>
          </div>
        )}
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
              placeholder={mode === 'signup' ? 'at least 6 characters' : 'your password'} style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7 }} />
          </>
        )}
        <button onClick={submit} disabled={busy || !email.trim() || (showPw && password.length < 6)} className="mono"
          style={{ ...btn, width: '100%', padding: '11px 0', marginTop: 14, opacity: busy || !email.trim() || (showPw && password.length < 6) ? 0.6 : 1 }}>{busy ? '…' : cta}</button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
        {info && <div className="mono" style={{ ...errStyle, color: 'var(--you)' }}>{info}</div>}
        {signupPending && (
          // Didn't get the confirmation email? A magic link both confirms the
          // address and signs them in, so it doubles as a resend + a way through.
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <button onClick={() => run(async () => { await sendMagicLink(email); setMode('magic'); setSent(true); })} disabled={busy} className="mono" style={{ ...linkBtn, opacity: busy ? 0.6 : 1 }}>
              Didn’t get it? Email me a sign-in link →
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          {mode === 'signin' && <button onClick={() => go('signup')} className="mono" style={linkBtn}>create account</button>}
          {mode === 'signin' && <button onClick={() => go('forgot')} className="mono" style={linkBtn}>forgot password?</button>}
          {mode !== 'signin' && <button onClick={() => go('signin')} className="mono" style={linkBtn}>← sign in</button>}
          {mode !== 'magic' && <button onClick={() => go('magic')} className="mono" style={linkBtn}>email me a link instead</button>}
        </div>
        {showPw && (
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 14, lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
            {commishCtx
              ? <>Signing in claims this league from your invite — then you’ll manage rosters, invites and weekly matchups.</>
              : <>To join a league you’ll also need your <span style={{ color: 'var(--dim)' }}>invite code</span> (from your commissioner) and your <span style={{ color: 'var(--dim)' }}>Sleeper username</span>.</>}
          </div>
        )}
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
    catch (x) { setErr(friendlyError(x)); }
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

// Per-league matchup snapshot for the home cards: the next matchup + both teams' identity.
interface MatchupCard { matchup: LiveMatchup; teams: Record<number, TeamInfo>; }

function Enroll({ session, view, setView, commishCode, admin }: { session: Session; view: OnboardView; setView: (v: OnboardView) => void; commishCode?: string | null; admin?: boolean }) {
  // Super-admin support mode: every read below resolves against this user
  // instead of the signed-in one, and the write CTAs are hidden.
  const { viewAs } = useStore();
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [commishLeagues, setCommishLeagues] = useState<AdminLeague[]>([]);
  const [commishLoaded, setCommishLoaded] = useState(false);
  const [cards, setCards] = useState<Record<string, MatchupCard>>({});
  // A commissioner's share link (?code=…) stashes dripInviteCode and promises
  // "just sign in and confirm — no code to type." Honor that by skipping the
  // role chooser and going straight to the pre-filled redeem form.
  const [choice, setChoice] = useState<'none' | 'player'>(() => {
    try { return localStorage.getItem('dripInviteCode') ? 'player' : 'none'; } catch { return 'none'; }
  });
  // Which league "manage" opened — so the dashboard focuses that one, not all.
  const [manageId, setManageId] = useState<string | null>(null);
  // Which tab the dashboard opens on (fresh league creation lands on DRAFT).
  const [manageTab, setManageTab] = useState<LeagueTab | undefined>(undefined);
  // Which team's live board/picks a card opened (a manager can be in several).
  // week rides along for the pod builder (showdowns pin their contest week).
  const [target, setTarget] = useState<{ leagueId: string; rosterId: number; week?: number; name?: string } | null>(null);
  // "My league isn't in the pilot yet" → the request-a-code capture sheet.
  const [requesting, setRequesting] = useState(false);
  // A commissioner with no seat LANDS on the dashboard; this flips once they ask
  // to leave it, so the player side is reachable instead of being redirected away
  // on every render. Reset by the "⚑ my leagues (commissioner)" link below.
  const [leftDash, setLeftDash] = useState(false);
  // Solo paths: one tap into a season pod (0089) or this week's showdown (0090)
  // — no invite, no Sleeper league. soloBusy remembers WHICH card is working.
  const [soloBusy, setSoloBusy] = useState<'pod' | 'weekly' | null>(null);
  const [soloErr, setSoloErr] = useState<{ mode: 'pod' | 'weekly'; msg: string } | null>(null);
  // Per-account gates (0094): 'solo' shows the standalone cards; 'dfs_commish'
  // shows "start a DFS league". Admins see everything.
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  // Feature flags gate which CTAs render, so a browse-as session must read the
  // VIEWED user's flags — my_features() keys on auth.uid() and would otherwise
  // show them the admin's surface.
  useEffect(() => {
    const p = viewAs ? adminUserFeatures(viewAs.userId) : myFeatures();
    p.then(setFeatures).catch(() => setFeatures({}));
  }, [session.user.id, viewAs?.userId]);
  // Your own super-admin flag must not leak into a browse-as session — it gates
  // CTAs (create a league, solo play) the viewed user may not have.
  const effAdmin = viewAs ? false : !!admin;
  const showSolo = effAdmin || !!features.solo;
  const showDfsCreate = effAdmin || !!features.dfs_commish;
  const commishIds = new Set(commishLeagues.map((l) => l.league_id));
  const isCommish = commishIds.size > 0;

  const refresh = async () => {
    setLoadErr(false);
    let rows: Enrollment[] = [];
    try {
      await ensureAppUser(session);
      // Browsing as someone else (super-admin support): read THEIR enrollments.
      // 0108 widened the SELECT policies for is_admin() so these player-path
      // reads resolve; the write policies are untouched, so nothing below can
      // act in their name. Skip claimMyRosters — that writes, and it would
      // claim pending seats for the ADMIN, not the user being viewed.
      if (!viewAs) await claimMyRosters().catch(() => {});
      rows = await myEnrollments(viewAs?.userId ?? session.user.id); setEnrollments(rows);
    } catch {
      // Don't fake an empty enrollment on failure — that shows an already-enrolled
      // user the "how are you joining?" form. Surface a retry instead (see below).
      // commishLoaded is flipped so the loading gate clears and the error renders.
      setLoadErr(true); setCommishLoaded(true); return;
    }
    // commish_overview() is `where commissioner_id = auth.uid()`, so browsing as
    // someone else has to go through the admin twin or the page fills with the
    // ADMIN's own commissioner cards.
    (viewAs ? adminUserCommishLeagues(viewAs.userId) : commishOverview())
      .then((l) => setCommishLeagues(l ?? [])).catch(() => setCommishLeagues([])).finally(() => setCommishLoaded(true));
    // Each league's next matchup + opponent, for the home cards. Week-less
    // myMatchup returns the LOWEST week (Week 1) — wrong whenever a later week
    // is the live one (preseason weeks sort at 101+), so resolve the board's
    // default-open week first and show THAT matchup.
    for (const e of rows) {
      defaultOpenWeek(e.league_id, e.league?.season ?? '2026', !!e.league?.preseason_at)
        .catch(() => undefined)
        .then((wk) => myMatchup(e.league_id, e.sleeper_roster_id, wk)
          .then((m) => m ?? myMatchup(e.league_id, e.sleeper_roster_id)))
        .then(async (m) => {
        if (!m) return;
        const teams = await matchupTeams(e.league_id, [m.home_roster_id, m.away_roster_id]).catch(() => ({}));
        setCards((c) => ({ ...c, [enrollKey(e)]: { matchup: m, teams } }));
      }).catch(() => {});
    }
  };
  useEffect(() => {
    refresh();
    /* eslint-disable-next-line */
  }, [session.user.id, viewAs?.userId]);

  // Solo pass (0097): the request modal stashes the freshly-minted code before
  // routing here — once signed in, redeem it automatically so solo unlocks
  // without ever showing a code-entry form. On failure, open manual entry
  // prefilled so the code isn't silently lost.
  const [soloPassCode, setSoloPassCode] = useState<string | null>(null);
  useEffect(() => {
    let code: string | null = null;
    try { code = localStorage.getItem('dripSoloPass'); localStorage.removeItem('dripSoloPass'); } catch { /* ignore */ }
    if (!code) return;
    redeemSoloPass(code)
      .then((r) => {
        if (r.ok) { track(Ev.soloPassRedeemed, { via: 'link' }); myFeatures().then(setFeatures).catch(() => {}); }
        else { setSoloPassCode(code); setView('solopass'); }
      })
      .catch(() => { setSoloPassCode(code); setView('solopass'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  // DFS invite link (?dfs=CODE → dripDfsCode): once signed in, auto-join the
  // league — the link is the whole flow, no chooser card for normal users.
  // On failure, open the manual join form with the code prefilled.
  const [dfsCode, setDfsCode] = useState<string | null>(null);
  useEffect(() => {
    let code: string | null = null;
    try { code = localStorage.getItem('dripDfsCode'); localStorage.removeItem('dripDfsCode'); } catch { /* ignore */ }
    if (!code) return;
    joinDfs(code)
      .then((r) => {
        if (r.ok) { track(Ev.dfsJoined, { already: !!r.already, via: 'link' }); refresh(); setView('home'); }
        else { setDfsCode(code); setView('dfsjoin'); }
      })
      .catch(() => { setDfsCode(code); setView('dfsjoin'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  const playSolo = async (mode: 'pod' | 'weekly') => {
    if (soloBusy) return;
    setSoloBusy(mode); setSoloErr(null);
    try {
      const r = mode === 'weekly' ? await joinWeekly() : await joinPod();
      if (!r.ok) { setSoloErr({ mode, msg: friendlyError(r.error ?? 'Couldn’t seat you — try again.') }); return; }
      if (mode === 'weekly') track(Ev.weeklyJoined, { already: !!r.already, week: (r as { week?: number }).week });
      else track(Ev.podJoined, { already: !!r.already });
      await refresh();
      setView('home');
    } catch (x) { setSoloErr({ mode, msg: friendlyError(x) }); }
    finally { setSoloBusy(null); }
  };

  if (view === 'commish') return <CommishVerify initialCode={commishCode ?? undefined} onBack={() => { setView('home'); refresh(); }} />;
  if (view === 'commishdash') return <CommishDash focusId={manageId} defaultTab={manageTab} onBack={() => { setManageId(null); setManageTab(undefined); setView('home'); }} />;
  // Add another league from My Leagues: fork by role (join with an invite code, or
  // claim with a commish code), then return home refreshed.
  if (view === 'add') return (
    <>
      {/* "Start a fresh league" needs the founder-granted 'native' flag (0095;
          admins always pass — the create RPC enforces the same gate server-side). */}
      <RoleChooser onPlayer={() => setView('join')} onCreate={effAdmin || !!features.native ? () => setView('create') : undefined} onCommish={() => setView('commish')} onRequest={() => setRequesting(true)} onSolo={showSolo ? () => playSolo('pod') : undefined} onWeekly={showSolo ? () => playSolo('weekly') : undefined} onDfsJoin={showSolo || showDfsCreate ? () => setView('dfsjoin') : undefined} onDfsCreate={showDfsCreate ? () => setView('dfscreate') : undefined} onSoloPass={!showSolo ? () => setView('solopass') : undefined} soloBusy={soloBusy} soloErr={soloErr} />
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={() => setView('home')} className="mono" style={linkBtn}>← back</button></div>
      {requesting && <RequestCodeModal initialPlatform="" onClose={() => setRequesting(false)} />}
    </>
  );
  // Native leagues: create in-app → draft room → team management.
  if (view === 'create') return (
    <NativeCreate
      onDone={(leagueId, rosterId) => { setTarget({ leagueId, rosterId }); refresh(); setView('draft'); }}
      onLeague={(leagueId) => { setManageId(leagueId); setManageTab('draft'); refresh(); setView('commishdash'); }}
      onBack={() => setView('home')} />
  );
  if (view === 'draft' && target) return (
    <DraftRoom leagueId={target.leagueId} onBack={() => { setView('home'); refresh(); }} onTeam={() => setView('team')} />
  );
  if (view === 'team' && target) return (
    <TeamManage leagueId={target.leagueId} onBack={() => { setView('home'); refresh(); }} onDraft={() => setView('draft')} />
  );
  if (view === 'join') return (
    <>
      <RedeemForm userId={session.user.id} onJoined={() => { setView('home'); refresh(); }} />
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={() => setView('home')} className="mono" style={linkBtn}>← back</button></div>
    </>
  );
  if (view === 'dfsjoin') return <DfsJoinForm initialCode={dfsCode ?? undefined} onJoined={() => { setDfsCode(null); setView('home'); refresh(); }} onBack={() => { setDfsCode(null); setView('home'); }} />;
  if (view === 'solopass') return <SoloPassForm initialCode={soloPassCode ?? undefined} onRedeemed={() => { setSoloPassCode(null); myFeatures().then(setFeatures).catch(() => {}); setView('home'); }} onBack={() => { setSoloPassCode(null); setView('home'); }} />;
  if (view === 'dfscreate') return <DfsCreateForm onDone={() => { setView('home'); refresh(); }} onBack={() => setView('home')} />;
  if (view === 'podbuild' && target) return (
    <PodBuilder leagueId={target.leagueId} rosterId={target.rosterId} week={target.week} leagueName={target.name}
      onBack={() => { setView('home'); refresh(); }} />
  );
  if (view === 'board') return <LiveBoard userId={session.user.id} leagueId={target?.leagueId} rosterId={target?.rosterId} onBack={() => setView('home')} />;
  if (view === 'results' && target) return <LeagueResults leagueId={target.leagueId} onBack={() => setView('home')} />;
  if (view === 'admin') return <AdminPage onBack={() => setView('home')} />;
  // Only a first-load failure blanks the screen; a background refresh failure keeps
  // whatever we already showed. Retry rather than mislead an enrolled user.
  if (loadErr && enrollments === null) return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Muted text="Couldn’t load your leagues." />
      <button onClick={refresh} className="mono" style={{ marginTop: 12, background: 'none', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', cursor: 'pointer' }}>↻ retry</button>
    </div>
  );
  if (enrollments === null || !commishLoaded) return <Muted text="Loading your leagues…" />;

  // A signed-in commissioner with no player roster of their own LANDS on league
  // management instead of the "how are you joining?" chooser — but it's a
  // landing, not a lock. This used to return CommishDash unconditionally from
  // the 'home' render, so its own "← all leagues" (which sets view to 'home')
  // re-rendered the very same redirect: a dead button, and no way to reach the
  // player side at all. `leftDash` remembers that they asked to leave.
  // Not while browsing as someone: CommishDash reads commish_overview() itself,
  // so it would show the admin's own leagues under the viewed user's banner.
  if (enrollments.length === 0 && isCommish && !viewAs && !leftDash) {
    return <CommishDash onBack={() => setLeftDash(true)} />;
  }

  // Browsing as someone with no leagues: the role chooser below is entirely
  // write actions (join, create, redeem a solo pass) and every one of them would
  // run as the ADMIN, not the viewed user. Report the empty state instead.
  if (enrollments.length === 0 && viewAs) return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Muted text={`${viewAs.label} is not enrolled in any league and commissions none — this is the whole of what they see.`} />
    </div>
  );

  // Genuinely new (no leagues at all) → fork by role.
  if (enrollments.length === 0) return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      {choice === 'none'
        ? <RoleChooser onPlayer={() => setChoice('player')} onCreate={effAdmin || !!features.native ? () => setView('create') : undefined} onCommish={() => setView('commish')} onRequest={() => setRequesting(true)} onSolo={showSolo ? () => playSolo('pod') : undefined} onWeekly={showSolo ? () => playSolo('weekly') : undefined} onDfsJoin={showSolo || showDfsCreate ? () => setView('dfsjoin') : undefined} onDfsCreate={showDfsCreate ? () => setView('dfscreate') : undefined} onSoloPass={!showSolo ? () => setView('solopass') : undefined} soloBusy={soloBusy} soloErr={soloErr} />
        : <RedeemForm userId={session.user.id} onJoined={refresh} />}
      <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {choice === 'player' && <button onClick={() => setView('commish')} className="mono" style={linkBtn}>← I actually run this league</button>}
        {/* The only route back to the dashboard for a commissioner who holds no
            seat: with no enrollments there's no league card to carry a "manage"
            button, so without this the player side is a one-way door. */}
        {isCommish && <button onClick={() => setLeftDash(false)} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>⚑ my leagues (commissioner)</button>}
      </div>
      {requesting && <RequestCodeModal initialPlatform="" onClose={() => setRequesting(false)} />}
    </div>
  );

  // While browsing as someone else, the screens that WRITE are refused rather
  // than opened. The database already stops anything landing in their name
  // (every write policy is `app_user_id = auth.uid()`), but an admin poking the
  // board would still create sealed_pick rows under their own id on a matchup
  // they aren't in — junk, and confusing to debug later. Read-only screens
  // (scores, the commish dashboard) stay reachable.
  const guard = (fn: () => void) => () => {
    if (viewAs) { alert(`Read-only: you're browsing as ${viewAs.label}. Exit view-as to use this.`); return; }
    fn();
  };

  return (
    <LeagueHome
      enrollments={enrollments}
      commishLeagues={commishLeagues}
      cards={cards}
      commishIds={commishIds}
      userId={viewAs?.userId ?? session.user.id}
      onBoard={(leagueId, rosterId) => guard(() => { setTarget({ leagueId, rosterId }); setView('board'); })()}
      onPodBuild={(leagueId, rosterId, week, name) => guard(() => { setTarget({ leagueId, rosterId, week, name }); setView('podbuild'); })()}
      onResults={(leagueId) => { setTarget({ leagueId, rosterId: 0 }); setView('results'); }}
      onManage={(id) => guard(() => { setManageId(id); setManageTab(undefined); setView('commishdash'); })()}
      onDraft={(leagueId, rosterId) => guard(() => { setTarget({ leagueId, rosterId }); setView('draft'); })()}
      onTeam={(leagueId, rosterId) => guard(() => { setTarget({ leagueId, rosterId }); setView('team'); })()}
      onAdd={guard(() => setView('add'))}
      onDeleted={refresh}
      isCommish={isCommish}
    />
  );
}

// The signed-in home: one card per enrolled league showing your team, this week's
// matchup, a commissioner badge where you run the league, and a big Set-lineup CTA.
function LeagueHome({ enrollments, commishLeagues, cards, commishIds, userId, onBoard, onPodBuild, onResults, onManage, onDraft, onTeam, onAdd, onDeleted, isCommish }: {
  enrollments: Enrollment[]; commishLeagues: AdminLeague[]; cards: Record<string, MatchupCard>; commishIds: Set<string>; userId: string;
  onBoard: (leagueId: string, rosterId: number) => void; onPodBuild: (leagueId: string, rosterId: number, week?: number, name?: string) => void;
  onResults: (leagueId: string) => void; onManage: (leagueId: string) => void;
  onDraft: (leagueId: string, rosterId: number) => void; onTeam: (leagueId: string, rosterId: number) => void; onAdd: () => void;
  onDeleted: () => void; isCommish: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'commish'>('all');
  const enrolledIds = new Set(enrollments.map((e) => e.league_id));
  // Leagues you commission but have no player roster in (no enrollment card).
  const commishOnly = commishLeagues.filter((l) => !enrolledIds.has(l.league_id));
  const enrolledCommish = enrollments.filter((e) => commishIds.has(e.league_id));
  const enrolledPlayer = enrollments.filter((e) => !commishIds.has(e.league_id));
  const total = enrollments.length + commishOnly.length;
  const commishCount = enrolledCommish.length + commishOnly.length;

  const chip = (id: 'all' | 'commish', label: string, n: number) => (
    <button onClick={() => setFilter(id)} className="mono" style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
      color: filter === id ? 'var(--on-accent)' : 'var(--dim)', background: filter === id ? 'var(--you)' : 'var(--surface)',
      border: `1px solid ${filter === id ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 999, padding: '5px 11px',
    }}>{label} <span style={{ opacity: 0.6 }}>{n}</span></button>
  );

  return (
    <>
      {/* brand hero — the QB mark + wordmark, tight to the content below */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 14, margin: '0 0 10px', flexWrap: 'wrap' }}>
        <img src={`${import.meta.env.BASE_URL}brand/hero-mark.png`} alt="" style={{ height: 224, width: 'auto' }} />
        <img src={`${import.meta.env.BASE_URL}brand/hero-wordmark.png`} alt="Drip Fantasy" style={{ height: 69, width: 'auto', marginTop: 8 }} />
      </div>
      <SeasonCountdown />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Your {total === 1 ? 'league' : 'leagues'}</div>
        <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.08em' }}>{total} LEAGUE{total === 1 ? '' : 'S'}</span>
      </div>
      {/* Commish/all filter — only when you run at least one league. */}
      {isCommish && <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>{chip('all', 'ALL', total)}{chip('commish', 'COMMISH', commishCount)}</div>}
      {/* Commissioned leagues on top; players below (hidden under the commish filter). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
        {commishOnly.map((l) => <CommishOnlyCard key={l.league_id} l={l} onManage={() => onManage(l.league_id)} onResults={() => onResults(l.league_id)} />)}
        {enrolledCommish.map((e) => e.league?.is_mock
          ? <MockLeagueCard key={enrollKey(e)} e={e} onDraft={() => onDraft(e.league_id, e.sleeper_roster_id)} onDeleted={onDeleted} />
          : <LeagueCard key={enrollKey(e)} e={e} card={cards[enrollKey(e)]} commish userId={userId} onBoard={() => onBoard(e.league_id, e.sleeper_roster_id)} onPodBuild={() => onPodBuild(e.league_id, e.sleeper_roster_id, e.league?.contest_week ?? cards[enrollKey(e)]?.matchup.week, e.league?.name)} onResults={() => onResults(e.league_id)} onManage={() => onManage(e.league_id)} onDraft={() => onDraft(e.league_id, e.sleeper_roster_id)} onTeam={() => onTeam(e.league_id, e.sleeper_roster_id)} />
        )}
        {filter === 'all' && enrolledPlayer.map((e) => e.league?.is_mock
          ? <MockLeagueCard key={enrollKey(e)} e={e} onDraft={() => onDraft(e.league_id, e.sleeper_roster_id)} onDeleted={onDeleted} />
          : <LeagueCard key={enrollKey(e)} e={e} card={cards[enrollKey(e)]} commish={false} userId={userId} onBoard={() => onBoard(e.league_id, e.sleeper_roster_id)} onPodBuild={() => onPodBuild(e.league_id, e.sleeper_roster_id, e.league?.contest_week ?? cards[enrollKey(e)]?.matchup.week, e.league?.name)} onResults={() => onResults(e.league_id)} onManage={() => onManage(e.league_id)} onDraft={() => onDraft(e.league_id, e.sleeper_roster_id)} onTeam={() => onTeam(e.league_id, e.sleeper_roster_id)} />
        )}
      </div>
      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <button onClick={onAdd} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>＋ add a league</button>
      </div>
    </>
  );
}

// Week 1 of the 2026 NFL season opens WEDNESDAY Sep 9 at 8:20 PM ET (SEA
// hosts the opener; the traditional Thursday slot went to the Melbourne
// game). Lineups lock one hour before the week's first kickoff (see
// nflSlate.ts), so the first pick lock of the season is 7:20 PM ET. The
// banner retires itself once that moment passes.
const SEASON_FIRST_LOCK = new Date('2026-09-09T19:20:00-04:00');

function SeasonCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = SEASON_FIRST_LOCK.getTime() - now;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const segs: [number, string][] = [
    [Math.floor(s / 86400), 'DAYS'],
    [Math.floor((s % 86400) / 3600), 'HRS'],
    [Math.floor((s % 3600) / 60), 'MIN'],
    [s % 60, 'SEC'],
  ];
  const when = SEASON_FIRST_LOCK.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: '14px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 220, flex: '1 1 220px' }}>
        <div className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Drip leagues go live Week 1 of the NFL season</div>
        <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--dim)', marginTop: 5 }}>FIRST PICKS LOCK AT {when.toUpperCase()} ET</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
        {segs.map(([v, l]) => (
          <div key={l} style={{ textAlign: 'center', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 10px 7px', minWidth: 60 }}>
            <div className="grotesk" style={{ fontSize: 28, fontWeight: 700, color: 'var(--you)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{String(v).padStart(2, '0')}</div>
            <div className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--faint)', marginTop: 5 }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// A league you commission but don't play in — no matchup card, just a way in to manage it.
function CommishOnlyCard({ l, onManage, onResults }: { l: AdminLeague; onManage: () => void; onResults: () => void }) {
  // Mirror LeagueCard's anatomy (identity row + status pill, boxed info strip,
  // full-width primary button) so play and commish-only cards read as one family.
  // You don't have a team here, so the info strip shows roster-fill instead of a
  // matchup, and the primary action is "manage" rather than "set lineup".
  const full = l.enrolled >= l.rosters;
  const statusColor = full ? 'var(--you)' : 'var(--warn)';
  return (
    <div style={{ ...card2 }}>
      {/* identity row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* The league crest, with the initial as the fallback — the play card
            above shows it too (next to the league name), so a commissioner sees
            the same art whether or not they hold a roster here. */}
        <Img src={l.avatar_url} size={38} radius={8} alt={l.name}
          fallback={<div className="grotesk" style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15, fontWeight: 700, color: 'var(--you)' }}>{l.name.slice(0, 1).toUpperCase()}</div>} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
            <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', borderRadius: 4, padding: '2px 6px' }}>⚑ COMMISSIONER</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.season} · {l.rosters}-team league</div>
        </div>
        <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '3px 7px', whiteSpace: 'nowrap', flexShrink: 0 }}>{full ? 'READY' : 'SETUP'}</span>
      </div>

      {/* info strip (mirrors LeagueCard's matchup strip) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6 }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--faint)', flexShrink: 0 }}>ROSTERS</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{l.enrolled}/{l.rosters} joined</span>
        <span className="mono" style={{ fontSize: 9, color: full ? 'var(--you)' : 'var(--faint)', flexShrink: 0 }}>{full ? 'all in' : `${l.rosters - l.enrolled} open`}</span>
      </div>

      {/* actions */}
      <button onClick={onManage} className="mono" style={{ width: '100%', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '13px 0', cursor: 'pointer', marginTop: 12, boxShadow: '0 0 18px color-mix(in srgb, var(--you) 22%, transparent)' }}>⚑ manage league</button>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
        <button onClick={onResults} className="mono" style={{ ...linkBtn, color: 'var(--dim)' }}>▦ scores</button>
      </div>
    </div>
  );
}

// A mock draft (0070): a practice room vs the AI. No season behind it, so no
// lineup CTA and no matchup strip — the whole card is "get back in" or "wipe it".
function MockLeagueCard({ e, onDraft, onDeleted }: { e: Enrollment; onDraft: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const del = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await deleteMockDraft(e.league_id);
      if (r.ok) { onDeleted(); return; }
      setErr(friendlyError(r.error ?? 'Could not delete the mock.'));
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...card2, borderLeft: '3px solid var(--warn)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>🤖</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.league?.name ?? 'Mock draft'}</span>
            <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '2px 6px' }}>🤖 MOCK DRAFT</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 3 }}>practice vs the AI · nothing is kept</div>
        </div>
      </div>
      <button onClick={onDraft} className="mono" style={{ width: '100%', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '13px 0', cursor: 'pointer', marginTop: 12, boxShadow: '0 0 18px color-mix(in srgb, var(--you) 22%, transparent)' }}>⛏ ENTER THE DRAFT ROOM</button>
      {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8, lineHeight: 1.4 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
        <button onClick={del} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)', opacity: busy ? 0.6 : 1 }}>🗑 delete this mock</button>
      </div>
    </div>
  );
}

function LeagueCard({ e, card, commish, userId, onBoard, onPodBuild, onResults, onManage, onDraft, onTeam }: {
  e: Enrollment; card?: MatchupCard; commish: boolean; userId: string;
  onBoard: () => void; onPodBuild: () => void; onResults: () => void; onManage: () => void; onDraft: () => void; onTeam: () => void;
}) {
  const { loadSimLeague, navigate, setDemoWeek } = useStore();
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState('');
  const [buildErr, setBuildErr] = useState<string | null>(null);
  // The HERO board: the authentic full board built from this league's REAL rosters
  // (setup/lineup for now; LIVE/FINAL come online when the feed populates). Enters
  // as a live pilot (real sealed picks + opponent reveal) when a matchup exists.
  const playHeroBoard = async () => {
    if (building) return;
    setBuilding(true); setBuildErr(null); setBuildNote('Loading your board…');
    try {
      // Open to the current NFL week (or the next upcoming if none is live) across
      // the league's whole timeline — so a preseason-mode league lands on its next
      // preseason game and rolls into Week 1 once preseason wraps.
      const preseasonOn = !!e.league?.preseason_at;
      const week = await defaultOpenWeek(e.league_id, e.league?.season ?? '2026', preseasonOn)
        .catch(() => (preseasonOn ? PRESEASON_BASE + 1 : 1));
      const m = await myMatchup(e.league_id, e.sleeper_roster_id, week).catch(() => null);
      const { built, youTeamId } = await buildLiveLeague(e.league_id, e.sleeper_roster_id, week);
      const ctx = m ? { matchupId: m.id, userId, leagueId: e.league_id, rosterId: e.sleeper_roster_id, week: m.week } : null;
      loadSimLeague(built, youTeamId, ctx);
      navigate({ name: 'matchup', week, phase: 'setup' });
    } catch {
      setBuildErr('Couldn’t load your board — check your connection and try again.');
      setBuilding(false);
    }
  };
  // The 2025 demo: play the FULL board on last year's play-by-play, built from
  // YOUR league — your real roster + your league's teams as the opponent (its real
  // Week-1 matchup when there is one). Enters the client-only SIM board (ctx null →
  // the playable LOCK-IN / per-window replay, not the real-time live board), so you
  // can run each window on 2025 data. Falls back to the canned demo league if your
  // Week-1 roster isn't synced yet.
  const playFullBoard = async () => {
    if (building) return;
    setBuilding(true); setBuildErr(null); setBuildNote('Loading your board…');
    try {
      const week = 1; // baked 2025 play-by-play exists for weeks 1–14; Week 1 is always synced
      const picked = await (async () => {
        try {
          const live = await buildLiveLeague(e.league_id, e.sleeper_roster_id, week);
          const roster = live.built.league.teams.find((t) => t.id === live.youTeamId)?.roster ?? [];
          if (roster.length) { live.built.league.season = 2025; return live; } // it's a 2025 replay — label + injuries follow
        } catch { /* fall through to the canned demo */ }
        return buildDripTestLeague(e.sleeper_roster_id, setBuildNote);
      })();
      // Drop any live-league slate override so it replays clean baked 2025 windows,
      // and enter the SIM board (ctx null → client-only playback, not the live board).
      clearRuntimeSlate();
      loadSimLeague(picked.built, picked.youTeamId, null);
      setDemoWeek(week);
      navigate({ name: 'matchup', week, phase: 'setup' });
    } catch {
      setBuildErr('Couldn’t load the board — check your connection and try again.');
      setBuilding(false);
    }
  };
  const m = card?.matchup;
  const youAreHome = m ? m.home_roster_id === e.sleeper_roster_id : true;
  const oppRoster = m ? (youAreHome ? m.away_roster_id : m.home_roster_id) : null;
  const opp = m && oppRoster != null ? card?.teams[oppRoster] : null;
  const status = m?.status ?? 'scheduled';
  const live = status === 'live';
  const final = status === 'final';
  // No matchup for this week yet — the platform hasn't published a schedule (a
  // Sleeper league returns no pairings until it drafts). Picks are keyed to a
  // matchup (sealed_pick.matchup_id is NOT NULL), so there is nowhere to store a
  // lineup yet: playHeroBoard would open with ctx null and silently discard
  // everything the manager built. Say "pending" and hold the CTA instead.
  const pending = !m;
  // Preseason PRACTICE (migration 0110): board weeks above PRESEASON_BASE. Drives
  // the badge and turns the meaningless "WK 102" into the board's own "PRE 2".
  const practice = !!m && isPreseasonWeek(m.week);
  const statusColor = live ? '#FF4F62' : final ? 'var(--dim)' : pending ? 'var(--faint)' : 'var(--warn)';
  const statusLabel = live ? '● LIVE' : final ? 'FINAL' : pending ? 'SCHEDULE PENDING' : 'PICKS OPEN';
  return (
    <div style={{ ...card2 }}>
      {/* identity row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {e.avatar_url
          ? <img src={e.avatar_url} alt="" width={38} height={38} style={{ borderRadius: 8, flexShrink: 0 }} />
          : <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--bd)', flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{e.team_name}</span>
            {commish && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', borderRadius: 4, padding: '2px 6px' }}>⚑ COMMISSIONER</span>}
            {e.league?.kind === 'weekly' && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '2px 6px' }}>🏆 WK {e.league.contest_week ?? '—'} SHOWDOWN</span>}
            {e.league?.kind === 'dfs' && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '2px 6px' }}>⚔ DFS LEAGUE</span>}
            {/* Keyed to the week THIS CARD is showing, not to league.preseason_at:
                a practice league rolls into WK 1 while the stamp is still set, and
                badging a real matchup "practice" would be a lie about a game that
                counts. In August the two agree; at the rollover only this is right. */}
            {practice && <span className="mono" title="Preseason practice — a real preseason game on live play-by-play. Nothing carries over: no standings, no seeding, no coin, no power-up inventory." style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', border: '1px solid var(--you)', background: 'color-mix(in srgb, var(--you) 12%, transparent)', borderRadius: 4, padding: '2px 6px' }}>🏈 PRACTICE</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, minWidth: 0 }}>
            {e.league?.avatar_url && <img src={e.league.avatar_url} alt="" width={14} height={14} style={{ borderRadius: 3, flexShrink: 0 }} />}
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.league?.name ?? 'League'} · {e.league?.season ?? ''}</span>
          </div>
        </div>
        <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '3px 7px', whiteSpace: 'nowrap', flexShrink: 0 }}>{statusLabel}</span>
      </div>

      {/* matchup row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6 }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--faint)', flexShrink: 0 }}>
          {m ? weekLabel(m.week) : 'WK —'}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--you)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.team_name}</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', flexShrink: 0 }}>vs</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{opp?.team_name ?? (m ? `Roster ${oppRoster}` : 'schedule pending')}</span>
      </div>
      {e.league?.kind === 'weekly' && <WeeklyCrown leagueId={e.league_id} week={e.league.contest_week} myRoster={e.sleeper_roster_id} />}

      {/* Pods + showdowns: the squad is BUILT under the salary cap (0092), not
          dealt. Stays available through LIVE — players late-swap per game
          (each locks 1h before his own kickoff, 0093) until the week is final. */}
      {(e.league?.kind === 'pod' || e.league?.kind === 'weekly' || e.league?.kind === 'dfs') && !final && (
        <button onClick={onPodBuild} className="mono" style={{ width: '100%', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '13px 0', cursor: 'pointer', marginTop: 12, boxShadow: '0 0 18px color-mix(in srgb, var(--you) 22%, transparent)' }}>{live ? '⛏ LATE-SWAP YOUR SQUAD →' : '⛏ BUILD YOUR SQUAD · $50K CAP →'}</button>
      )}

      {/* actions — default goes to the REAL board for this league's season (the
          live 2026 slate once the week is synced). The 2025 full-board sim is an
          optional "see it play" demo until the season starts. */}
      <button onClick={playHeroBoard} disabled={building || pending} className="mono" style={{ width: '100%', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: pending ? 'var(--dim)' : 'var(--on-accent)', background: pending ? 'var(--bg)' : 'var(--you)', border: pending ? '1px solid var(--bd)' : 'none', borderRadius: 6, padding: '13px 0', cursor: building || pending ? 'default' : 'pointer', marginTop: 12, opacity: building ? 0.7 : 1, boxShadow: pending ? 'none' : '0 0 18px color-mix(in srgb, var(--you) 22%, transparent)' }}>
        {building ? (buildNote || 'LOADING…') : pending ? 'LINEUP OPENS WITH THE SCHEDULE' : <><GameIcon name={BRAND_MARK} emoji="◈" size="1.3em" /> {live || final ? 'GO TO MATCHUP →' : 'SET YOUR LINEUP →'}</>}
      </button>
      {pending && (
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5, textAlign: 'center' }}>
          No opponent yet — {e.league?.provider === 'native' ? 'the schedule is generated once the league drafts' : `${e.league?.provider === 'espn' ? 'ESPN' : 'Sleeper'} publishes pairings once the league drafts`}. Try ▷ demo (2025) meanwhile.
        </div>
      )}
      {buildErr && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8, lineHeight: 1.4 }}>{buildErr}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        {!pending && <button onClick={onBoard} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>◫ live board</button>}
        {e.league?.provider === 'native' && <button onClick={onDraft} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>⛏ draft</button>}
        {e.league?.provider === 'native' && <button onClick={onTeam} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>⇄ team</button>}
        <button onClick={onResults} className="mono" style={{ ...linkBtn, color: 'var(--dim)' }}>▦ scores</button>
        <button onClick={playFullBoard} disabled={building} className="mono" title="try the full board on last year's data" style={{ ...linkBtn, color: 'var(--dim)', opacity: building ? 0.6 : 1 }}>{building ? (buildNote || 'loading…') : '▷ demo (2025)'}</button>
        {commish && <button onClick={onManage} className="mono" style={{ ...linkBtn, color: 'var(--text)' }}>⚑ manage league</button>}
      </div>
    </div>
  );
}

// The showdown's terminal moment (0090): once EVERY matchup of the contest week
// is final, the top total score in the pod takes the crown. Computed from the
// finals any member can read (matchup.home_final/away_final) — no server-side
// standings. Renders nothing until the whole week is in.
function WeeklyCrown({ leagueId, week, myRoster }: { leagueId: string; week?: number | null; myRoster: number }) {
  const [champ, setChamp] = useState<{ rid: number; name: string; pts: number } | null>(null);
  useEffect(() => {
    let ok = true;
    leagueResults(leagueId).then(async (rs) => {
      const wkRows = rs.filter((r) => week == null || r.week === week);
      if (!wkRows.length || wkRows.some((r) => r.status !== 'final' || r.home_final == null || r.away_final == null)) return;
      const pts = new Map<number, number>();
      for (const r of wkRows) { pts.set(r.home_roster_id, Number(r.home_final)); pts.set(r.away_roster_id, Number(r.away_final)); }
      const [rid, top] = [...pts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      const teams = await matchupTeams(leagueId, [rid]).catch(() => ({} as Record<number, TeamInfo>));
      if (ok) setChamp({ rid, name: teams[rid]?.team_name ?? `Roster ${rid}`, pts: top });
    }).catch(() => {});
    return () => { ok = false; };
  }, [leagueId, week]);
  if (!champ) return null;
  const you = champ.rid === myRoster;
  return (
    <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '9px 12px', background: 'color-mix(in srgb, var(--warn) 10%, var(--bg))', border: '1px solid color-mix(in srgb, var(--warn) 45%, var(--bd))', borderRadius: 6 }}>
      <span style={{ fontSize: 13 }}>👑</span>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {you ? 'YOU TOOK THE CROWN' : `CHAMP · ${champ.name.toUpperCase()}`} · {champ.pts.toFixed(1)} PTS
      </span>
    </div>
  );
}

// League-wide scoreboard + standings, from persisted final scores (matchup.home_
// final/away_final, readable by any league member). Per-window detail stays
// participant-only, so the board shows final totals; live/scheduled show a dash.
function LeagueResults({ leagueId, onBack }: { leagueId: string; onBack: () => void }) {
  const [rows, setRows] = useState<MatchupResult[] | null>(null);
  const [teams, setTeams] = useState<Record<number, TeamInfo>>({});
  useEffect(() => {
    let ok = true;
    leagueResults(leagueId).then((rs) => {
      if (!ok) return;
      setRows(rs);
      const ids = Array.from(new Set(rs.flatMap((r) => [r.home_roster_id, r.away_roster_id])));
      if (ids.length) matchupTeams(leagueId, ids).then((t) => { if (ok) setTeams(t); }).catch(() => {});
    }).catch(() => setRows([]));
    return () => { ok = false; };
  }, [leagueId]);
  const name = (rid: number) => teams[rid]?.team_name ?? `Roster ${rid}`;

  const standings = useMemo(() => {
    const s: Record<number, { rid: number; w: number; l: number; t: number; pf: number }> = {};
    const get = (rid: number) => (s[rid] ??= { rid, w: 0, l: 0, t: 0, pf: 0 });
    for (const r of rows ?? []) {
      // Preseason practice (board weeks 101-103) is throwaway — its results show
      // in the week list below, but never in a record. Mirrors league_standings
      // (migration 0110), which seeds the playoff bracket from the same rule.
      if (isPreseasonWeek(r.week)) continue;
      if (r.status !== 'final' || r.home_final == null || r.away_final == null) continue;
      const h = get(r.home_roster_id), a = get(r.away_roster_id);
      h.pf += Number(r.home_final); a.pf += Number(r.away_final);
      if (r.home_final > r.away_final) { h.w++; a.l++; } else if (r.home_final < r.away_final) { a.w++; h.l++; } else { h.t++; a.t++; }
    }
    return Object.values(s).sort((x, y) => (y.w - x.w) || (y.pf - x.pf));
  }, [rows]);

  const weeks = useMemo(() => {
    const m = new Map<number, MatchupResult[]>();
    for (const r of rows ?? []) { if (!m.has(r.week)) m.set(r.week, []); m.get(r.week)!.push(r); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);

  const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 8 };
  return (
    <div>
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← my leagues</button>
      <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>▦ Scores &amp; results</div>
      {rows === null ? <Muted text="Loading…" />
        : rows.length === 0 ? <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>No matchups scheduled yet — sync the season from Manage.</div>
        : (
          <>
            {standings.some((s) => s.w + s.l + s.t > 0) && (
              <div style={{ ...card, marginBottom: 12 }}>
                <div style={hdr}>STANDINGS</div>
                {standings.map((s, i) => (
                  <div key={s.rid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', width: 16 }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(s.rid)}</span>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{s.w}-{s.l}{s.t ? `-${s.t}` : ''}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', width: 60, textAlign: 'right' }}>{Math.round(s.pf)} PF</span>
                  </div>
                ))}
              </div>
            )}
            {weeks.map(([wk, ms]) => (
              <div key={wk} style={{ ...card, marginBottom: 10 }}>
                <div style={hdr}>
                  {isPreseasonWeek(wk) ? `PRESEASON WK ${preseasonWeekNum(wk)}` : `WEEK ${wk}`}
                  {isPreseasonWeek(wk) && <span style={{ color: 'var(--faint)', fontWeight: 400, letterSpacing: '0.06em' }}> · PRACTICE, DOESN'T COUNT</span>}
                </div>
                {ms.map((r, i) => {
                  const fin = r.status === 'final' && r.home_final != null && r.away_final != null;
                  const homeWon = fin && Number(r.home_final) > Number(r.away_final);
                  const awayWon = fin && Number(r.away_final) > Number(r.home_final);
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i ? '1px solid var(--bd)' : 'none' }}>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: homeWon ? 700 : 400, color: homeWon ? 'var(--you)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{name(r.home_roster_id)}</span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', width: 30, textAlign: 'center' }}>{fin ? Math.round(Number(r.home_final)) : '—'}</span>
                      <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>·</span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', width: 30, textAlign: 'center' }}>{fin ? Math.round(Number(r.away_final)) : '—'}</span>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: awayWon ? 700 : 400, color: awayWon ? 'var(--you)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(r.away_roster_id)}</span>
                      <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: fin ? 'var(--dim)' : r.status === 'live' ? '#FF4F62' : 'var(--faint)', border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>{fin ? 'FINAL' : r.status === 'live' ? 'LIVE' : 'SCHED'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      <div style={{ textAlign: 'center', marginTop: 12 }}><button onClick={onBack} className="mono" style={linkBtn}>← my leagues</button></div>
    </div>
  );
}

function RoleChooser({ onPlayer, onCreate, onCommish, onRequest, onSolo, onWeekly, onDfsJoin, onDfsCreate, onSoloPass, soloBusy, soloErr }: { onPlayer: () => void; onCreate?: () => void; onCommish: () => void; onRequest?: () => void; onSolo?: () => void; onWeekly?: () => void; onDfsJoin?: () => void; onDfsCreate?: () => void; onSoloPass?: () => void; soloBusy?: 'pod' | 'weekly' | null; soloErr?: { mode: 'pod' | 'weekly'; msg: string } | null }) {
  const choice: React.CSSProperties = { width: '100%', textAlign: 'left', fontFamily: 'inherit', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, cursor: 'pointer' };
  // Everyone sees the platform-league paths; everything below the divider only
  // renders because THIS account holds a feature flag (or is admin) — the chip
  // names the flag so the founder can tell at a glance who else would see it.
  const gate = (label: string) => (
    <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', border: '1px dashed var(--bd)', borderRadius: 4, padding: '2px 6px', marginLeft: 8, verticalAlign: 'middle' }}>{label}</span>
  );
  const anyGated = !!(onWeekly || onSolo || onDfsJoin || onDfsCreate || onCreate);
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>You’re signed in.</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>How are you joining the pilot?</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={onPlayer} style={choice}>
          <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--you)' }}>I’m a player →</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>I have a league invite code. Link my Sleeper team and set my lineup.</div>
        </button>
        <button onClick={onCommish} style={choice}>
          <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>I run this league →</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>Verify as commissioner with the code you were given, then share a player invite code with your league.</div>
        </button>
        {onRequest && (
          <button onClick={onRequest} style={choice}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>My league isn’t in the pilot yet →</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>No code? Request one — we’ll set your league up. Sleeper · ESPN · Yahoo · Fleaflicker · MFL.</div>
          </button>
        )}

        {anyGated && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 2px' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
            <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)' }}>VISIBLE TO YOU VIA FEATURE FLAGS</span>
            <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
          </div>
        )}
        {onWeekly && (
          <button onClick={onWeekly} disabled={!!soloBusy} style={{ ...choice, borderLeft: '3px solid var(--warn)', opacity: soloBusy ? 0.6 : 1 }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--warn)' }}>{soloBusy === 'weekly' ? 'Seating you in the showdown…' : '🏆 This week’s showdown →'}{gate('SOLO')}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>One-week contest, no strings. Build a squad under the $50k cap, battle head-to-head this Sunday, top score takes the crown — then it’s over.</div>
            {soloErr?.mode === 'weekly' && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 6, lineHeight: 1.4 }}>{soloErr.msg}</div>}
          </button>
        )}
        {onSolo && (
          <button onClick={onSolo} disabled={!!soloBusy} style={{ ...choice, borderLeft: '3px solid var(--you)', opacity: soloBusy ? 0.6 : 1 }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--you)' }}>{soloBusy === 'pod' ? 'Finding you a pod…' : '🎲 Play solo — join a public pod →'}{gate('SOLO')}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>No league needed. One tap seats you in a 6-team public pod — build a fresh salary-cap squad and battle head-to-head every week, all season.</div>
            {soloErr?.mode === 'pod' && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 6, lineHeight: 1.4 }}>{soloErr.msg}</div>}
          </button>
        )}
        {onDfsJoin && (
          <button onClick={onDfsJoin} style={choice}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>I have a DFS invite →{gate('FALLBACK')}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>Manual code entry — invitees normally just open the commissioner’s link and are seated automatically.</div>
          </button>
        )}
        {onSoloPass && (
          <button onClick={onSoloPass} style={choice}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>I have a solo pass →</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>Redeem the SOLO-XXXXXX pass from the demo to unlock drop-in pods and weekly showdowns.</div>
          </button>
        )}
        {onDfsCreate && (
          <button onClick={onDfsCreate} style={{ ...choice, borderLeft: '3px solid var(--warn)' }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--warn)' }}>🏈 Start a DFS league →{gate('DFS COMMISH')}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>You’re an approved DFS commissioner. Found a private league and share its invite link.</div>
          </button>
        )}
        {onCreate && (
          <button onClick={onCreate} style={{ ...choice, borderLeft: '3px solid var(--you)' }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--you)' }}>Start a fresh league →{gate('NATIVE')}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 5, lineHeight: 1.5 }}>No existing league needed — create one here, invite friends, and draft your teams right in the app.</div>
          </button>
        )}
      </div>
    </>
  );
}

// Redeem a solo pass (0097) — normally auto-redeemed from the request modal's
// stash; this manual form catches a saved/shared code or a failed auto-redeem.
function SoloPassForm({ onRedeemed, onBack, initialCode }: { onRedeemed: () => void; onBack: () => void; initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (busy || !code.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await redeemSoloPass(code);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Couldn’t redeem — check the code.')); return; }
      track(Ev.soloPassRedeemed, { via: 'manual' });
      onRedeemed();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <div style={card}>
        <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Redeem your solo pass</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Enter the SOLO-XXXXXX pass from the demo. It unlocks drop-in pods and weekly showdowns — no league needed.</div>
        <label className="mono" style={{ ...label, display: 'block', marginTop: 14 }}>SOLO PASS</label>
        <input value={code} autoFocus onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          placeholder="SOLO-1A2B3C" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7, letterSpacing: '0.15em' }} />
        <button onClick={go} disabled={busy || !code.trim()} className="mono"
          style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 14, opacity: busy || !code.trim() ? 0.6 : 1 }}>{busy ? '…' : 'UNLOCK SOLO PLAY →'}</button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

// Join a commissioner's DFS league by code (0094). The invite IS the access —
// no feature flag needed on the joiner's account.
function DfsJoinForm({ onJoined, onBack, initialCode }: { onJoined: () => void; onBack: () => void; initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (busy || !code.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await joinDfs(code, team);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Couldn’t join — check the code.')); return; }
      track(Ev.dfsJoined, { already: !!r.already });
      onJoined();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <div style={card}>
        <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Join a DFS league</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Enter the invite code your commissioner shared. You’ll build a salary-cap squad each week and battle head-to-head.</div>
        <label className="mono" style={{ ...label, display: 'block', marginTop: 14 }}>INVITE CODE</label>
        <input value={code} autoFocus onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          placeholder="ABC123" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7, letterSpacing: '0.15em' }} />
        <label className="mono" style={{ ...label, display: 'block', marginTop: 12 }}>TEAM NAME <span style={{ fontWeight: 400 }}>(optional)</span></label>
        <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={30}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          placeholder="The Underdogs" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7 }} />
        <button onClick={go} disabled={busy || !code.trim()} className="mono"
          style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 14, opacity: busy || !code.trim() ? 0.6 : 1 }}>{busy ? '…' : 'JOIN LEAGUE →'}</button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

// Found a private DFS league (0094) — approved commissioners only (server-
// gated too). Shows the invite code once created; seats fill from it.
function DfsCreateForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(6);
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ league?: string; invite_code?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await createDfsLeague(name, teams, team);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Couldn’t create the league.')); return; }
      track(Ev.dfsCreated, { teams });
      setMade({ league: r.league, invite_code: (r as { invite_code?: string }).invite_code });
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  if (made) {
    // One link is the whole join flow: open → sign in → auto-seated (?dfs=CODE
    // is stashed through the auth bounce, same as the commissioner links).
    const joinLink = `${window.location.origin}${window.location.pathname}?live=1&dfs=${made.invite_code}`;
    return (
      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        <div style={card}>
          <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--you)' }}>{made.league} is live.</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Share one link — players open it, sign in, and they’re seated. Unclaimed seats play as AI.</div>
          <button onClick={() => { navigator.clipboard?.writeText(joinLink); setCopied(true); }}
            className="mono" style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 14 }}>{copied ? '✓ invite link copied' : '⛓ Copy invite link'}</button>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
            Code, if you’d rather say it out loud: <span style={{ color: 'var(--text)', fontWeight: 700, letterSpacing: '0.1em' }}>{made.invite_code}</span>
          </div>
          <button onClick={onDone} className="mono" style={{ ...linkBtn, display: 'block', margin: '16px auto 0', color: 'var(--you)' }}>→ to my leagues</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <div style={card}>
        <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Start a DFS league</div>
        <label className="mono" style={{ ...label, display: 'block', marginTop: 14 }}>LEAGUE NAME</label>
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} maxLength={40}
          placeholder="Tuesday Night Degens" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7 }} />
        <label className="mono" style={{ ...label, display: 'block', marginTop: 12 }}>TEAMS</label>
        <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
          {[2, 4, 6, 8, 10, 12].map((n) => (
            <button key={n} onClick={() => setTeams(n)} className="mono" style={{ flex: 1, fontSize: 12, fontWeight: 700, color: teams === n ? 'var(--on-accent)' : 'var(--dim)', background: teams === n ? 'var(--you)' : 'var(--bg)', border: `1px solid ${teams === n ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 5, padding: '9px 0', cursor: 'pointer' }}>{n}</button>
          ))}
        </div>
        <label className="mono" style={{ ...label, display: 'block', marginTop: 12 }}>YOUR TEAM NAME <span style={{ fontWeight: 400 }}>(optional)</span></label>
        <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={30}
          placeholder="Commish’s Crew" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7 }} />
        <button onClick={go} disabled={busy} className="mono"
          style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 14, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : '🏈 CREATE LEAGUE →'}</button>
        {err && <div className="mono" style={errStyle}>{err}</div>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </div>
  );
}

function CommishVerify({ onBack, initialCode }: { onBack: () => void; initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [league, setLeague] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Admin-assigned model: the commish code the admin sent you IS the authorization.
  // Redeem it → become this league's commissioner (any platform, no team-tagging).
  const redeem = async (c0?: string) => {
    const c = (c0 ?? code).trim();
    if (!c || busy) return;
    setBusy(true); setErr(null);
    const r = await redeemCommish(c);
    setBusy(false);
    if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not verify.')); return; }
    setInvite(r.invite_code ?? null); setLeague(r.league ?? '');
    try { localStorage.removeItem('dripCommishCode'); } catch { /* ignore */ }
  };


  if (invite) {
    // One way to invite the league: the join link (no code to type). The raw code
    // stays available as an inline fallback for anyone who'd rather type it.
    const joinLink = `${window.location.origin}${window.location.pathname}?live=1&code=${invite}`;
    return (
      <div style={card}>
        <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--you)' }}>Verified — you’re the commissioner.</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>{league}. Invite your league with one link — players who open it just sign in and confirm, no code to type.</div>
        <button onClick={() => { navigator.clipboard?.writeText(joinLink); setCopied(true); }}
          className="mono" style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 14 }}>{copied ? '✓ invite link copied' : '⛓ Copy invite link'}</button>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
          Prefer a code? Share <span onClick={() => { navigator.clipboard?.writeText(invite); setCodeCopied(true); }} title="click to copy" style={{ color: 'var(--text)', fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer' }}>{codeCopied ? 'copied ✓' : invite}</span> — players enter it on the join screen.
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← done</button></div>
      </div>
    );
  }

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Verify as commissioner</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>Enter the commissioner code you were sent. That claims the league — then you invite your league mates.</div>
      </div>
      <div style={card}>
        <label className="mono" style={label}>COMMISSIONER CODE</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
          <input value={code} autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') redeem(); }}
            placeholder="e.g. 9F3A1C2D" style={{ ...input, letterSpacing: '0.12em' }} />
          <button onClick={() => redeem()} disabled={busy || !code.trim()} className="mono" style={{ ...btn, opacity: busy || !code.trim() ? 0.6 : 1 }}>{busy ? '…' : 'VERIFY'}</button>
        </div>
        {err && <div className="mono" style={errStyle}>{err}</div>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}><button onClick={onBack} className="mono" style={linkBtn}>← back</button></div>
    </>
  );
}

function RedeemForm({ userId, onJoined }: { userId: string; onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [teamName, setTeamName] = useState(''); // native leagues: name your seat
  const [username, setUsername] = useState('');
  const [linked, setLinked] = useState(false); // username came from a prior link
  const [team, setTeam] = useState<PreviewRedeem | null>(null); // confirm step
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askCode, setAskCode] = useState(false); // "don't have a code?" request sheet

  // Returning player: pre-fill the Sleeper username they linked on a prior join
  // so they don't have to type it again (still editable via "not me").
  useEffect(() => {
    let cancelled = false;
    myLinkedSleeper(userId).then((s) => {
      if (cancelled || !s?.username) return;
      setUsername((u) => (u ? u : s.username));
      setLinked(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const find = async (c0?: string) => {
    const c = (c0 ?? code).trim();
    if (!c || busy) return;
    setBusy(true); setErr(null);
    try {
      const p = await previewLeague(c);
      if (!p) setErr('No league found for that code. Double-check it, or — if you run the league — use “verify my league” below.');
      else setPreview(p);
    } catch (x) { setErr(friendlyError(x)); }
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
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not match your account.')); } else setTeam(r);
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const join = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await redeemInvite(code, username);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not join.')); setBusy(false); return; }
      try { localStorage.removeItem('dripInviteCode'); } catch { /* ignore */ }
      onJoined();
    } catch (x) { setErr(friendlyError(x)); setBusy(false); }
  };

  // Native league: the code IS the seat — claim the lowest open roster directly
  // (no external identity to match, no commissioner mapping step).
  const claimSeat = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await nativeJoin(code, teamName || undefined);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not join.')); setBusy(false); return; }
      try { localStorage.removeItem('dripInviteCode'); } catch { /* ignore */ }
      onJoined();
    } catch (x) { setErr(friendlyError(x)); setBusy(false); }
  };

  // Join the pool without picking a team (ESPN/Yahoo/etc., or anyone) — the
  // commissioner assigns you a roster from the joined list. No Sleeper handle.
  const joinPool = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await joinLeague(code);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not join.')); setBusy(false); return; }
      try { localStorage.removeItem('dripInviteCode'); } catch { /* ignore */ }
      onJoined();
    } catch (x) { setErr(friendlyError(x)); setBusy(false); }
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

        {preview && !team && preview.provider === 'native' && (
          <div style={{ marginTop: 14 }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginBottom: 10 }}>
              Joining <span style={{ color: 'var(--text)', fontWeight: 700 }}>{preview.name}</span> · {preview.season} — a Drip-native league. Grab an open seat; no other fantasy app needed.
            </div>
            <label className="mono" style={label}>TEAM NAME (OPTIONAL)</label>
            <input value={teamName} autoFocus maxLength={40} onChange={(e) => { setTeamName(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') claimSeat(); }}
              placeholder="e.g. Hot Streak Heroes" style={{ ...input, width: '100%', boxSizing: 'border-box', marginTop: 7 }} />
            <button onClick={claimSeat} disabled={busy} className="mono" style={{ ...btn, width: '100%', padding: '11px 0', marginTop: 12, opacity: busy ? 0.6 : 1 }}>{busy ? 'JOINING…' : 'CLAIM MY SEAT →'}</button>
          </div>
        )}

        {preview && !team && preview.provider !== 'native' && (
          <div style={{ marginTop: 14 }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', marginBottom: 10 }}>
              Joining <span style={{ color: 'var(--text)', fontWeight: 700 }}>{preview.name}</span> · {preview.season}
            </div>
            <label className="mono" style={label}>SLEEPER USERNAME</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <input value={username} autoFocus={!linked} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => { setUsername(e.target.value); setLinked(false); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
                placeholder="your Sleeper handle" style={input} />
              <button onClick={check} disabled={busy || !username.trim()} className="mono" style={{ ...btn, opacity: busy || !username.trim() ? 0.6 : 1 }}>{busy ? '…' : 'NEXT →'}</button>
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>{linked ? 'Using the Sleeper account you linked before — edit if this league uses a different one.' : 'We match your Sleeper account to your team in this league.'}</div>
            {/* Not on Sleeper (ESPN/Yahoo/etc.)? Join the pool and let the commish
                assign your team — no handle needed. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 10px' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
              <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.08em' }}>NOT ON SLEEPER?</span>
              <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
            </div>
            <button onClick={joinPool} disabled={busy} className="mono" style={{ ...btn, width: '100%', padding: '10px 0', background: 'var(--bg)', color: 'var(--text)', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : 'JOIN & LET THE COMMISH ASSIGN ME'}</button>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5, textAlign: 'center' }}>Your commissioner maps you to your team from the joined list.</div>
          </div>
        )}

        {team && (
          <div style={{ marginTop: 14 }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>You’ll join as</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 12px' }}>
              {team.avatar && <img src={team.avatar} alt="" width={36} height={36} style={{ borderRadius: 7, flexShrink: 0 }} />}
              <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--you)' }}>{team.team}</div>
            </div>
            <button onClick={join} disabled={busy} className="mono" style={{ ...btn, width: '100%', padding: '11px 0', opacity: busy ? 0.6 : 1 }}>{busy ? 'JOINING…' : 'CONFIRM & JOIN'}</button>
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button onClick={() => { setTeam(null); setErr(null); }} className="mono" style={linkBtn}>not me — change username</button>
            </div>
          </div>
        )}
        {err && <div className="mono" style={errStyle}>{err}</div>}
        {!team && (
          <div style={{ textAlign: 'center', marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
            {/* The FAB that requests a code is hidden inside /live, so a user who
                lands here without one would otherwise be stranded. */}
            <button onClick={() => setAskCode(true)} className="mono" style={linkBtn}>Don’t have a code? Request one for your league →</button>
          </div>
        )}
      </div>
      {askCode && <RequestCodeModal initialPlatform="" onClose={() => setAskCode(false)} />}
    </>
  );
}
