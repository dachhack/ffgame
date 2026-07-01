import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings } from '../app/ui';
import { liveConfigured } from '../data/supabaseClient';
import {
  sendMagicLink, verifyEmailOtp, signInWithProvider, signInPassword, signUpPassword, sendPasswordReset, updatePassword,
  getSession, onAuth, signOut, ensureAppUser,
  previewLeague, redeemPreview, redeemInvite, myEnrollments, myLinkedSleeper, claimMyRosters,
  redeemCommish, isAdmin, commishOverview, friendlyError,
  myMatchup, matchupTeams,
  type Enrollment, type LeaguePreview, type PreviewRedeem, type LiveMatchup, type TeamInfo,
} from '../data/liveApi';
import { DEMO_WEEK } from '../config';
import { buildDripTestLeague } from '../data/dripTest';
import { LivePicks } from './LivePicks';
import { LiveBoard } from './LiveBoard';
import { AdminPage } from './AdminPage';
import { CommishDash } from './CommishDash';
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

type OnboardView = 'home' | 'commish' | 'commishdash' | 'picks' | 'board' | 'admin';

export function LiveOnboard() {
  const { navigate, route } = useStore();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [admin, setAdmin] = useState(false);
  // Honor deep links: the gear menu's "Super admin" (view:'admin'), and a
  // commissioner invite link (?live=1&commish=CODE → dripCommishCode) which opens
  // the commissioner claim screen. Otherwise land on the onboarding home.
  const [view, setView] = useState<OnboardView>(() => {
    if (route.name === 'live' && route.view === 'admin') return 'admin';
    try { if (localStorage.getItem('dripCommishCode')) return 'commish'; } catch { /* ignore */ }
    return 'home';
  });

  useEffect(() => {
    if (!liveConfigured) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); });
    return onAuth((s, ev) => { setSession(s); if (ev === 'PASSWORD_RECOVERY') setRecovery(true); });
  }, []);
  useEffect(() => {
    if (!session) { setAdmin(false); return; }
    isAdmin().then(setAdmin).catch(() => setAdmin(false));
  }, [session]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}>◈ DRIP FANTASY · LIVE</span>
          <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← demo</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {session && <span className="mono" title={session.user.email ?? ''} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--you) 35%, var(--bd))', borderRadius: 4, padding: '5px 9px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◢ {sessionName(session)}</span>}
          {session && <button onClick={() => signOut()} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>sign out</button>}
          <SiteSettings superAdmin={session && admin ? () => setView('admin') : undefined} />
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: view === 'admin' ? 'flex-start' : 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div style={{ width: '100%', maxWidth: view === 'admin' ? 1080 : 440 }}>
          {!liveConfigured ? <NotConfigured />
            : !ready ? <Muted text="Loading…" />
            : recovery ? <SetPassword onDone={() => setRecovery(false)} />
            : !session ? <AuthForm />
            : <Enroll session={session} view={view} setView={setView} />}
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
    try { await fn(); } catch (x) { setErr(friendlyError(x)); }
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
          {mode === 'signin' ? <>The <span style={{ color: 'var(--you)' }}>live H2H</span> pilot.</> : title}
        </div>
        {mode === 'signin' && <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 10 }}>Sign in to set your lineup and watch it play live.</div>}
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
        {showPw && (
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 14, lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
            To join a league you’ll also need your <span style={{ color: 'var(--dim)' }}>invite code</span> (from your commissioner) and your <span style={{ color: 'var(--dim)' }}>Sleeper username</span>.
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

function Enroll({ session, view, setView }: { session: Session; view: OnboardView; setView: (v: OnboardView) => void }) {
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [commishIds, setCommishIds] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<Record<string, MatchupCard>>({});
  const [choice, setChoice] = useState<'none' | 'player'>('none');
  const isCommish = commishIds.size > 0;

  const refresh = async () => {
    let rows: Enrollment[] = [];
    try {
      await ensureAppUser(session);
      // Pick up any rosters an admin/commish pre-assigned to my email (non-Sleeper
      // leagues are enrolled this way, since there's no username to self-claim by).
      await claimMyRosters().catch(() => {});
      rows = await myEnrollments(session.user.id); setEnrollments(rows);
    } catch { setEnrollments([]); }
    commishOverview().then((l) => setCommishIds(new Set((l ?? []).map((x) => x.league_id)))).catch(() => setCommishIds(new Set()));
    // Each league's next matchup + opponent, for the home cards.
    for (const e of rows) {
      myMatchup(e.league_id, e.sleeper_roster_id).then(async (m) => {
        if (!m) return;
        const teams = await matchupTeams(e.league_id, [m.home_roster_id, m.away_roster_id]).catch(() => ({}));
        setCards((c) => ({ ...c, [e.league_id]: { matchup: m, teams } }));
      }).catch(() => {});
    }
  };
  useEffect(() => {
    refresh();
    /* eslint-disable-next-line */
  }, [session.user.id]);

  if (view === 'commish') return <CommishVerify onBack={() => { setView('home'); refresh(); }} />;
  if (view === 'commishdash') return <CommishDash onBack={() => setView('home')} />;
  if (view === 'picks') return <LivePicks userId={session.user.id} onBack={() => setView('home')} />;
  if (view === 'board') return <LiveBoard userId={session.user.id} onBack={() => setView('home')} />;
  if (view === 'admin') return <AdminPage onBack={() => setView('home')} />;
  if (enrollments === null) return <Muted text="Loading your leagues…" />;

  // Not enrolled yet → fork by role instead of defaulting everyone into the player form.
  if (enrollments.length === 0) return (
    <>
      {choice === 'none'
        ? <RoleChooser onPlayer={() => setChoice('player')} onCommish={() => setView('commish')} />
        : <RedeemForm userId={session.user.id} onJoined={refresh} />}
      <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {choice === 'player' && <button onClick={() => setView('commish')} className="mono" style={linkBtn}>← I actually run this league</button>}      </div>
    </>
  );

  return (
    <LeagueHome
      enrollments={enrollments}
      cards={cards}
      commishIds={commishIds}
      userId={session.user.id}
      onPicks={() => setView('picks')}
      onBoard={() => setView('board')}
      onManage={() => setView('commishdash')}
      onVerifyCommish={() => setView('commish')}
      isCommish={isCommish}
    />
  );
}

// The signed-in home: one card per enrolled league showing your team, this week's
// matchup, a commissioner badge where you run the league, and a big Set-lineup CTA.
function LeagueHome({ enrollments, cards, commishIds, userId, onPicks, onBoard, onManage, onVerifyCommish, isCommish }: {
  enrollments: Enrollment[]; cards: Record<string, MatchupCard>; commishIds: Set<string>; userId: string;
  onPicks: () => void; onBoard: () => void; onManage: () => void; onVerifyCommish: () => void; isCommish: boolean;
}) {
  return (
    <>
      <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 14 }}>
        Your {enrollments.length === 1 ? 'league' : 'leagues'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {enrollments.map((e) => (
          <LeagueCard key={e.league_id} e={e} card={cards[e.league_id]} commish={commishIds.has(e.league_id)} userId={userId}
            onPicks={onPicks} onBoard={onBoard} onManage={onManage} />
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        {!isCommish && <button onClick={onVerifyCommish} className="mono" style={linkBtn}>I also run a league — verify as commissioner →</button>}
      </div>
    </>
  );
}

function LeagueCard({ e, card, commish, userId, onPicks, onBoard, onManage }: {
  e: Enrollment; card?: MatchupCard; commish: boolean; userId: string;
  onPicks: () => void; onBoard: () => void; onManage: () => void;
}) {
  const { loadSimLeague, navigate } = useStore();
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState('');
  const [buildErr, setBuildErr] = useState<string | null>(null);
  // The Drip Test League plays on the FULL app board: fetch the real source
  // league, re-skin it, and enter the sim as this user's team.
  const isDripTest = (e.league?.name ?? '').toLowerCase().includes('drip test');
  const playFullBoard = async () => {
    if (building) return;
    setBuilding(true); setBuildErr(null);
    try {
      const [{ built, youTeamId }, m] = await Promise.all([
        buildDripTestLeague(e.sleeper_roster_id, setBuildNote),
        myMatchup(e.league_id, e.sleeper_roster_id).catch(() => null),
      ]);
      // With a real matchup, run as a true pilot board (sealed-pick persistence on,
      // opened on the matchup's week). Without one, fall back to a plain playtest.
      const ctx = m ? { matchupId: m.id, userId, leagueId: e.league_id, rosterId: e.sleeper_roster_id, week: m.week } : null;
      loadSimLeague(built, youTeamId, ctx);
      navigate({ name: 'matchup', week: ctx ? ctx.week : DEMO_WEEK, phase: 'setup' });
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
  const statusColor = live ? '#FF4F62' : final ? 'var(--dim)' : 'var(--warn)';
  const statusLabel = live ? '● LIVE' : final ? 'FINAL' : 'PICKS OPEN';
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
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.league?.name ?? 'League'} · {e.league?.season ?? ''}</div>
        </div>
        <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '3px 7px', whiteSpace: 'nowrap', flexShrink: 0 }}>{statusLabel}</span>
      </div>

      {/* matchup row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6 }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--faint)', flexShrink: 0 }}>WK {m?.week ?? '—'}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--you)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.team_name}</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', flexShrink: 0 }}>vs</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{opp?.team_name ?? (m ? `Roster ${oppRoster}` : 'schedule pending')}</span>
      </div>

      {/* actions */}
      <button onClick={isDripTest ? playFullBoard : onPicks} disabled={building} className="mono" style={{ width: '100%', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '13px 0', cursor: building ? 'default' : 'pointer', marginTop: 12, opacity: building ? 0.7 : 1, boxShadow: '0 0 18px color-mix(in srgb, var(--you) 22%, transparent)' }}>
        {building ? (buildNote || 'LOADING BOARD…') : '◈ SET YOUR LINEUP →'}
      </button>
      {buildErr && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8, lineHeight: 1.4 }}>{buildErr}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 10 }}>
        {!isDripTest && <button onClick={onBoard} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>◫ live board</button>}
        {commish && <button onClick={onManage} className="mono" style={{ ...linkBtn, color: 'var(--text)' }}>⚑ manage league</button>}
      </div>
    </div>
  );
}

function RoleChooser({ onPlayer, onCommish }: { onPlayer: () => void; onCommish: () => void }) {
  const choice: React.CSSProperties = { width: '100%', textAlign: 'left', fontFamily: 'inherit', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, cursor: 'pointer' };
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
      </div>
    </>
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

  // A commissioner invite link pre-fills the code (survives the magic-link bounce)
  // and redeems on its own.
  useEffect(() => {
    let c: string | null = initialCode ?? null;
    if (!c) { try { c = localStorage.getItem('dripCommishCode'); } catch { /* ignore */ } }
    if (c) { setCode(c); redeem(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [username, setUsername] = useState('');
  const [linked, setLinked] = useState(false); // username came from a prior link
  const [team, setTeam] = useState<PreviewRedeem | null>(null); // confirm step
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
              <input value={username} autoFocus={!linked} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => { setUsername(e.target.value); setLinked(false); setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
                placeholder="your Sleeper handle" style={input} />
              <button onClick={check} disabled={busy || !username.trim()} className="mono" style={{ ...btn, opacity: busy || !username.trim() ? 0.6 : 1 }}>{busy ? '…' : 'NEXT →'}</button>
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>{linked ? 'Using the Sleeper account you linked before — edit if this league uses a different one.' : 'We match your Sleeper account to your team in this league.'}</div>
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
      </div>
    </>
  );
}
