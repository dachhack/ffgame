import { useEffect, useState } from 'react';
import { requestCode, issueSoloPass } from '../data/liveApi';
import { liveConfigured } from '../data/liveConfig';
import { useStore } from '../app/store';
import { GameIcon, BRAND_MARK } from '../app/gameIcons';
import { track, Ev, attribution } from '../app/analytics';

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
        <GameIcon name={BRAND_MARK} emoji="◈" size="1.3em" /> get an invite
      </button>
      {open && <RequestCodeModal initialPlatform={sleeperUser ? 'Sleeper' : ''} onClose={() => setOpen(false)} />}
    </>
  );
}

// The pilot supports leagues from any of these platforms. 'Solo' is the
// no-league path (the ads sell solo play) — those leads get flagged for the
// solo pods/showdowns rollout instead of a league import.
const SOLO = 'Solo — just me, no league';
const PLATFORMS = ['Sleeper', 'ESPN', 'Yahoo', 'Fleaflicker', 'MFL', SOLO, 'Other'];

// Per-platform help for the "league ID or link" field — where to find it, and an
// example URL, so a requester can hand us exactly what we need to import.
const REF_GUIDE: Record<string, { placeholder: string; hint: string }> = {
  Sleeper: { placeholder: 'sleeper.com/leagues/1234567890…', hint: 'Sleeper app/site → your league → the number in its URL.' },
  ESPN: { placeholder: 'fantasy.espn.com/football/league?leagueId=…', hint: 'Open your league on the web and copy the URL (it has leagueId=).' },
  Yahoo: { placeholder: 'football.fantasysports.yahoo.com/f1/123456', hint: 'Open your league on the web and copy the URL.' },
  Fleaflicker: { placeholder: 'fleaflicker.com/nfl/leagues/123456', hint: 'Open your league and copy the URL.' },
  MFL: { placeholder: 'www55.myfantasyleague.com/2026/home/12345', hint: 'Your league home URL — it has the league ID.' },
  Other: { placeholder: 'a link to your league', hint: 'Paste any link that identifies your league.' },
  '': { placeholder: 'your league URL or ID', hint: 'Pick your platform above and we’ll show where to find this.' },
};

export function RequestCodeModal({ initialPlatform, onClose }: { initialPlatform: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [platform, setPlatform] = useState(initialPlatform);
  const [league, setLeague] = useState('');
  const [leagueRef, setLeagueRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Solo requests mint a pass on the spot (0097): 'code' = instant grant shown
  // in the done screen; 'waitlisted' = this week's cap is spent, lead captured.
  const [soloPass, setSoloPass] = useState<string | null>(null);
  const [waitlisted, setWaitlisted] = useState(false);
  const { navigate } = useStore();
  const guide = REF_GUIDE[platform] ?? REF_GUIDE[''];

  // The demo's conversion funnel: opened → requested (or failed). No PII in
  // events — the email stays in the lead row; attribution rides on every event
  // automatically (analytics.ts) and is stored on the lead for admin triage.
  useEffect(() => { track(Ev.codeRequestOpened, { platform: initialPlatform || null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (busy) return;
    if (!email.trim()) { setErr('Add your email so we can send your code.'); return; }
    setBusy(true); setErr(null);
    // `sleeper` on the API is the generic contact field; we send the platform there.
    const r = await requestCode({ email, sleeper: platform, league, leagueRef, note, attribution: attribution() });
    if (r.ok) {
      track(Ev.codeRequested, { platform: platform || null, has_league_ref: !!leagueRef.trim() });
      // Solo path: mint a capped pass right now — instant gratification instead
      // of "wait for an email". Falls back to the waitlist copy over quota (the
      // lead row above still captures them either way).
      if (platform === SOLO) {
        const p = await issueSoloPass(email).catch(() => null);
        if (p?.ok && p.code) { setSoloPass(p.code); track(Ev.soloPassIssued, { waitlisted: false }); }
        else if (p?.ok && p.waitlisted) { setWaitlisted(true); track(Ev.soloPassIssued, { waitlisted: true }); }
      }
      setDone(true);
    }
    else { track(Ev.codeRequestFailed, { error: (r.error ?? 'unknown').slice(0, 120) }); setErr(r.error ?? 'Could not send — try again.'); setBusy(false); }
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        {done ? (
          soloPass ? (
            // Instant grant — the pass is theirs. One button carries the code
            // through sign-up (stashed, auto-redeemed by LiveOnboard).
            <div style={{ textAlign: 'center' }}>
              <div className="grotesk" style={{ fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>You’re in — here’s your solo pass.</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 10%, transparent)', border: '1px dashed color-mix(in srgb, var(--you) 55%, var(--bd))', borderRadius: 8, padding: '14px 0', marginTop: 14, userSelect: 'all' }}>{soloPass}</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10, lineHeight: 1.55 }}>
                We release a limited number of passes each week — this one’s yours. Tap the button and it redeems automatically when you create your account; solo pods and weekly showdowns unlock instantly. Doing it later? Save the code — it isn’t emailed.
              </div>
              <button
                onClick={() => { try { localStorage.setItem('dripSoloPass', soloPass); } catch { /* ignore */ } onClose(); navigate({ name: 'live' }); }}
                className="mono" style={{ ...primaryBtn, marginTop: 16 }}
              >sign up &amp; redeem →</button>
              <button onClick={onClose} className="mono" style={cancelBtn}>I saved the code — later</button>
            </div>
          ) : (
          <div style={{ textAlign: 'center' }}>
            <div className="grotesk" style={{ fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>{waitlisted ? 'This week’s passes are gone.' : 'You’re on the list.'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
              {waitlisted
                ? 'We release a limited number of solo passes each week and this week’s batch is claimed. You’re first in line for the next drop — we’ll email your pass.'
                : 'We onboard new players every week — invites usually land within a few days. Keep playing the demo in the meantime.'}
            </div>
            <button onClick={onClose} className="mono" style={{ ...primaryBtn, marginTop: 18 }}>done</button>
          </div>
          )
        ) : (
          <>
            <div className="grotesk" style={{ fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>Get in the pilot</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>The live pilot is invite-only, and we onboard new players every week. Your email is all we need — the rest just helps your invite land sooner.</div>
            <Field label="EMAIL">
              <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} type="email" inputMode="email" placeholder="you@example.com"
                spellCheck={false} autoCapitalize="none" autoCorrect="off" style={input} />
            </Field>
            <Field label="HOW DO YOU PLAY?">
              <select value={platform} onChange={(e) => { setPlatform(e.target.value); setErr(null); }} style={input}>
                <option value="">select your platform…</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            {/* League fields only make sense for league requests — the solo path
                (no league to import) skips straight to submit. */}
            {platform !== SOLO && (
              <>
                <Field label="LEAGUE NAME (OPTIONAL)">
                  <input value={league} onChange={(e) => setLeague(e.target.value)} placeholder="e.g. Sunday Scaries Dynasty" style={input} />
                </Field>
                <Field label="LEAGUE ID OR LINK (OPTIONAL)">
                  <input value={leagueRef} onChange={(e) => { setLeagueRef(e.target.value); setErr(null); }} placeholder={guide.placeholder}
                    spellCheck={false} autoCapitalize="none" autoCorrect="off" style={input} />
                  <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 5, lineHeight: 1.4 }}>{guide.hint} It’s what lets us pull your league in — you can also send it later.</div>
                </Field>
              </>
            )}
            {platform === SOLO && (
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 12, lineHeight: 1.5, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px' }}>
                No league needed — solo players get drop-in pods and weekly showdowns against other players. We’ll email your invite as solo seats open.
              </div>
            )}
            <Field label="ANYTHING ELSE (OPTIONAL)">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="league size, when you play, questions…" rows={2} style={{ ...input, resize: 'vertical' }} />
            </Field>
            {err && <div className="mono" style={{ fontSize: 10.5, color: 'var(--opp)', marginTop: 4, lineHeight: 1.4 }}>{err}</div>}
            <button onClick={submit} disabled={busy} className="mono" style={{ ...primaryBtn, marginTop: 14, opacity: busy ? 0.6 : 1 }}>{busy ? 'sending…' : 'request an invite →'}</button>
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
