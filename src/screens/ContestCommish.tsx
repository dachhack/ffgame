// THE CONTEST CARD, web (v0.664.0) — the commissioner's console destination
// that is a contest league's own: what wins, how it plays, the budget, the
// Bullseye card, the size, the league board. Everything else a contest
// league's commissioner sets — the roster, scoring, the pool filter, seat
// rules, the name, deleting — is the classic console's, unchanged.
import { useEffect, useState, type CSSProperties } from 'react';
import {
  contestLeague, setContestRules, setDfsBullseye, setBullseyeSize, postLeagueListing, closeLeagueListing, leagueListingState,
  isAdmin, myFeatures, bullseyeMaxSeats, friendlyError,
  type ContestInfo, type ContestKind, type ContestFormat,
} from '@drip/core/data/liveApi';
import { CONTEST_WORD, CONTEST_EMOJI } from '@drip/core/engine/contest';

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean, dim = false): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--on-accent, var(--bg))' : dim ? 'var(--faint)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: `1px solid ${on ? 'var(--you)' : 'color-mix(in srgb, var(--you) 45%, var(--bd))'}`, borderRadius: 999, padding: '5px 12px',
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const label: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' };
const input: CSSProperties = { fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const n0 = (n: number) => n.toLocaleString('en-US');
export const CONTEST_BUDGETS = [0, 10000, 20000, 30000, 40000, 50000, 60000, 75000, 100000, 150000, 200000, 500000];   // 0 = NO CAP (0469)
/** The minimum spend (0469): golf's constraint. 0 = none. */
export const CONTEST_MIN_SPENDS = [0, 10000, 20000, 30000, 40000, 45000, 50000, 60000, 75000, 100000];
export const moneyChip = (v: number, none: string) => (v ? `$${Math.round(v / 1000)}k` : none);

export function ContestCommishPanel({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const [b, setB] = useState<ContestInfo | null>(null);
  const [span, setSpan] = useState<'season' | 'week'>('season');
  const [played, setPlayed] = useState(false);
  const [cap, setCap] = useState(32);
  const [size, setSize] = useState(12);
  const [budget, setBudget] = useState(50000);
  const [minSpend, setMinSpend] = useState(0);
  const [radius, setRadius] = useState(10);
  const [listed, setListed] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [dues, setDues] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => contestLeague(leagueId).then((r) => {
    if (!r.ok || !r.bullseye) { setNote(r.error ?? 'Couldn’t read the league.'); return; }
    setB(r.bullseye); setSize(r.bullseye.max_seats); setBudget(r.bullseye.budget); setMinSpend(r.bullseye.min_spend ?? 0); setRadius(r.bullseye.radius);
    setSpan(r.bullseye.span); setPlayed((r.weeks ?? []).length > 0); setListed(!!r.listed);
  }).catch((e) => setNote(friendlyError(e)));
  useEffect(() => {
    void load();
    Promise.all([isAdmin().catch(() => false), myFeatures().catch(() => ({} as Record<string, boolean>))])
      .then(([a, f]) => setCap(bullseyeMaxSeats(!!a, f))).catch(() => {});
    leagueListingState(leagueId).then((s) => { if (s.ok) { setListed(!!s.listed); setBlurb(s.blurb ?? ''); setDues(s.dues ?? ''); } }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);
  const act = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true); setNote(null);
    const r = await p.catch((e) => ({ ok: false, error: friendlyError(e) }));
    setBusy(false);
    setNote(r.ok ? `✓ ${done}` : (r.error ?? 'That didn’t work.'));
    if (r.ok) { await load(); onChanged?.(); }
    return r.ok;
  };
  if (!b) return <div style={{ ...card }}><span className="mono" style={small}>{note ?? 'Loading…'}</span></div>;
  const h2h = b.format === 'h2h';
  const top = h2h ? 32 : cap;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div className="mono" style={label}>WINS BY</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['high', 'golf', 'bullseye'] as ContestKind[]).map((c) => (
            <button key={c} disabled={busy} onClick={() => void act(setContestRules(leagueId, { contest: c }), `now ${CONTEST_WORD[c].toLowerCase()}`)} className="mono" style={chip(b.contest === c)}>{`${CONTEST_EMOJI[c]} ${CONTEST_WORD[c]}`}</button>
          ))}
        </div>
        <div className="mono" style={small}>{b.contest === 'golf' ? 'Lowest score wins. Set each spot’s 0 → penalty on ROSTER so a scoreless player costs something.' : b.contest === 'high' ? 'Highest score wins.' : 'Closest to the week’s card wins; the dart scores each spot.'} Takes effect from the next week; not while a week is being played.</div>
        <div className="mono" style={label}>PLAYS</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['h2h', 'board'] as ContestFormat[]).map((f) => (
            <button key={f} disabled={busy || played} onClick={() => void act(setContestRules(leagueId, { format: f }), f === 'h2h' ? 'head-to-head' : 'leaderboard')} className="mono" style={chip(b.format === f, played && b.format !== f)}>{f === 'h2h' ? 'HEAD-TO-HEAD' : 'LEADERBOARD'}</button>
          ))}
          <span className="mono" style={small}>{played ? 'Set once the league has played a week.' : 'Head-to-head pairs an even number of seats, up to 32; the CPU plays an empty seat.'}</span>
        </div>
        <div className="mono" style={label}>BUDGET</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mono" style={{ ...input, width: 130 }}>
            {[...new Set([...CONTEST_BUDGETS, b.budget])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v ? `$${n0(v)}` : 'NO CAP'}</option>)}
          </select>
          <button disabled={busy || budget === b.budget} onClick={() => void act(setContestRules(leagueId, { budget }), 'budget changed')} className="mono" style={chip(true)}>SET</button>
          <span className="mono" style={small}>per squad, from the next week. Add or remove spots on ROSTER — a bigger squad wants a bigger budget. NO CAP suits Bullseye: the card does the limiting.</span>
        </div>
        <div className="mono" style={label}>MIN SPEND</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={minSpend} onChange={(e) => setMinSpend(Number(e.target.value))} className="mono" style={{ ...input, width: 130 }}>
            {[...new Set([...CONTEST_MIN_SPENDS, b.min_spend ?? 0])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v ? `$${n0(v)}` : 'NONE'}</option>)}
          </select>
          <button disabled={busy || minSpend === (b.min_spend ?? 0)} onClick={() => void act(setContestRules(leagueId, { minSpend }), 'minimum spend changed')} className="mono" style={chip(true)}>SET</button>
          <span className="mono" style={small}>{b.contest === 'golf' ? 'Golf’s real constraint: a squad must spend at least this, so cheap no-names aren’t the whole game.' : 'A floor a squad must spend; mostly for golf.'}</span>
        </div>
        <div className="mono" style={label}>RULED OUT</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button disabled={busy} onClick={() => void act(setContestRules(leagueId, { autoSub: true }), 'auto-sub on')} className="mono" style={chip(!!b.auto_sub)}>SWAP HIM FOR ME</button>
          <button disabled={busy} onClick={() => void act(setContestRules(leagueId, { autoSub: false }), 'auto-sub off')} className="mono" style={chip(!b.auto_sub)}>LEAVE IT TO ME</button>
          <span className="mono" style={small}>Every player locks at his own kickoff, so a ruled-out pick can be swapped until then. SWAP HIM FOR ME puts the best affordable body in his spot in the minutes before his game if nobody has; LEAVE IT TO ME banks the zero.</span>
        </div>
      </div>

      {b.contest === 'bullseye' && (
        <div style={{ ...card, display: 'grid', gap: 10 }}>
          <div className="mono" style={label}>THE CARD</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['slots', 'total'] as const).map((v) => (
              <button key={v} disabled={busy} onClick={() => void act(setDfsBullseye(leagueId, v, radius), 'card changed')} className="mono" style={chip(b.variant === v)}>{v === 'slots' ? 'SLOT TARGETS' : 'ONE TEAM TOTAL'}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={small}>RADIUS (2–50) — points for dead-on, and the zero penalty</span>
            <input type="number" min={2} max={50} value={radius} onChange={(e) => setRadius(Number(e.target.value) || 10)} style={{ ...input, width: 80 }} />
            <button disabled={busy || radius === b.radius} onClick={() => void act(setDfsBullseye(leagueId, b.variant, radius), 'radius changed')} className="mono" style={chip(true)}>SET</button>
          </div>
          <div className="mono" style={small}>Not while a week is being played — change it once that week is final.</div>
        </div>
      )}

      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div className="mono" style={label}>WHO CAN GET IN</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono" style={small}>{h2h ? 'TEAMS (even, 2–32)' : `UP TO (2–${n0(cap)})`}</span>
          <input type="number" min={2} max={top} step={h2h ? 2 : 1} value={size} onChange={(e) => setSize(Number(e.target.value) || 2)} style={{ ...input, width: 110 }} />
          <button disabled={busy || size === b.max_seats} onClick={() => void act(setBullseyeSize(leagueId, size), 'size changed')} className="mono" style={chip(true)}>SET</button>
          <span className="mono" style={small}>{`${n0(b.seats_taken)} in now${h2h ? ' · an added seat plays as the CPU until someone takes it' : ''}`}</span>
        </div>
        <div className="mono" style={label}>THE LEAGUE BOARD</div>
        <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={200} rows={2} placeholder="Blurb (optional)" style={{ ...input, resize: 'vertical' }} />
        <input value={dues} onChange={(e) => setDues(e.target.value)} maxLength={120} placeholder="Dues (optional) — the platform prints it, never collects it" style={input} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => void act(postLeagueListing(leagueId, blurb.trim() || null, dues.trim()), listed ? 'board post updated' : 'posted to the board').then((ok) => { if (ok) setListed(true); })} className="mono" style={chip(true)}>{listed ? 'UPDATE THE POST' : 'POST IT TO THE BOARD'}</button>
          {listed && <button disabled={busy} onClick={() => void act(closeLeagueListing(leagueId), 'taken off the board').then((ok) => { if (ok) setListed(false); })} className="mono" style={chip(false)}>TAKE IT DOWN</button>}
        </div>
        {span === 'week' && <div className="mono" style={small}>A one-week league leaves the board once its week kicks off.</div>}
      </div>
      {note && <div className="mono" style={{ fontSize: 11, color: note.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{note}</div>}
    </div>
  );
}
