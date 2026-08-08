// The Window Pot — chips on the felt for every game window.
// Spec: docs/window-pot.md. Migration 0106 is the authority; nothing here
// decides anything, it only shows the pot and offers the three moves.
//
// v1 renders on the LIVE board only (`liveCtx` non-null) — the demo/sim boards
// never mount it. A league with `pot_ante = 0` gets `{ off: true }` from
// pot_state, and every component below returns null, so the feature leaves no
// trace until the flag is flipped.
//
// One poll for the whole matchup: all five window bars subscribe to the shared
// store below rather than each fetching its own pot_state. The poll also calls
// pot_sweep — any-member-advances, exactly like draft_tick — so a manager with
// the board open expires their own clocks and settles their own windows even
// between worker ticks.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ModalBackdrop } from '../app/ui';
import { DripCoin } from '../app/gameIcons';
import { potState, potSweep, potRaise, potRespond, setPotAutoCall, friendlyError, type PotState, type PotWindow } from '../data/liveApi';

const POLL_MS = 20_000;

// ── shared store ─────────────────────────────────────────────────────────────

interface Snap { matchupId: string | null; pot: PotState | null; error: string | null }
let snap: Snap = { matchupId: null, pot: null, error: null };
const subs = new Set<() => void>();
const set = (patch: Partial<Snap>) => { snap = { ...snap, ...patch }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

let refs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let pulling = false;

async function pull() {
  const mid = snap.matchupId;
  if (!mid || pulling) return;
  pulling = true;
  try {
    // Advance first, then read — so a clock that just expired shows as resolved
    // in the very same poll instead of a beat later. A sweep failure is never
    // fatal to the read (the worker sweeps too).
    await potSweep(mid).catch(() => {});
    const pot = await potState(mid);
    if (snap.matchupId === mid) set({ pot, error: null });
  } catch (e) {
    if (snap.matchupId === mid) set({ error: friendlyError(e) });
  } finally { pulling = false; }
}

/** Re-read immediately (after one of your own actions lands). */
export const refreshPot = () => { void pull(); };

/** The matchup's pot state, or null when there is none to show (no live
 *  matchup, league flag off, or the first poll hasn't landed). */
export function usePot(matchupId: string | null): PotState | null {
  const s = useSyncExternalStore(subscribe, () => snap);
  useEffect(() => {
    if (!matchupId) return;
    if (snap.matchupId !== matchupId) set({ matchupId, pot: null, error: null });
    refs++;
    if (!timer) timer = setInterval(() => { void pull(); }, POLL_MS);
    void pull();
    return () => {
      refs--;
      if (refs <= 0 && timer) { clearInterval(timer); timer = null; refs = 0; }
    };
  }, [matchupId]);
  if (!matchupId || s.matchupId !== matchupId) return null;
  return s.pot && !s.pot.off ? s.pot : null;
}

// ── formatting ───────────────────────────────────────────────────────────────

/** "1h 52m" / "8m" / "now" — how long until a response clock runs out. Quiet
 *  hours are baked into the deadline server-side, so this is honest arithmetic
 *  on a real timestamp, not a countdown that lies overnight. */
export function untilLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const KIND_VERB: Record<string, string> = {
  ante: 'anted', raise: 'raised', call: 'called', fold: 'folded',
  auto_call: 'auto-called', auto_fold: 'timed out', settle: 'took the pot', refund: 'was refunded',
};

/** A pot action as a duel-feed line: "They raised ◎15 on SNF". */
export function potLogLine(a: PotWindow['log'][number], winLabel: string): string {
  const who = a.side === 'you' ? 'You' : a.side === 'them' ? 'They' : '';
  const verb = KIND_VERB[a.kind] ?? a.kind;
  const amt = a.amount > 0 ? ` ◎${a.amount}` : '';
  if (a.kind === 'settle') return `${who || 'Nobody'} took the ◎${a.amount} pot on ${winLabel}`;
  if (!who) return `Pot ${verb}${amt} on ${winLabel}`;
  return `${who} ${verb}${amt} on ${winLabel}`;
}

/** The settled pot, said out loud — sits next to the ★ window + bonus equation. */
export function potOutcomeLine(w: PotWindow): string | null {
  if (w.state === 'open') return null;
  const took = w.matched;
  if (w.state === 'folded_them') return `POT ◎${took} → taken (they folded)`;
  if (w.state === 'folded_you') return `POT ◎${took} → conceded (you folded)`;
  if (w.state === 'split') return `POT ◎${took} → split, dead even`;
  if (w.winner === 'you') return `POT ◎${took} → taken`;
  if (w.winner === 'them') return `POT ◎${took} → theirs`;
  return `POT ◎${took} → settled`;
}

// ── the chip ─────────────────────────────────────────────────────────────────

/** The pot chip on a window's battle bar. Tapping opens the action sheet. */
export function WindowPotChip({ pot, matchupId, win, winLabel, leagueId, cards }: {
  pot: PotState; matchupId: string; win: string; winLabel: string; leagueId: string | null; cards?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const w = pot.windows.find((x) => x.win === win);
  if (!w) return null;

  const owed = w.pending?.by === 'them';           // they raised — the ball is yours
  const waiting = w.pending?.by === 'you';
  const settled = w.state !== 'open';
  const outcome = potOutcomeLine(w);
  // The duel-feed line: the newest move that wasn't just the automatic ante —
  // amounts are the signal, so raises and folds are public by design.
  const last = [...w.log].reverse().find((a) => a.kind !== 'ante') ?? null;

  // Card theme: a physical felt chip (ridged rim, inner ring) instead of a pill.
  const chipArt = cards
    ? {
      background: 'radial-gradient(circle at 50% 38%, #b4362f 0%, #8f2721 60%, #6d1c18 100%)',
      border: '2px dashed color-mix(in srgb, #ffffff 62%, transparent)',
      boxShadow: '0 1px 0 rgba(0,0,0,.45), inset 0 0 0 3px rgba(0,0,0,.18)',
      color: '#fff2e8',
    }
    : { background: 'var(--surface)', border: '1px solid var(--bd)', color: 'var(--text)' };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mono"
        title={settled ? (outcome ?? '') : 'Ante, raise, call — the window pot'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'space-between',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: cards ? 999 : 5,
          padding: cards ? '6px 12px' : '5px 9px', marginBottom: 6, cursor: 'pointer', ...chipArt,
          ...(owed ? { borderColor: 'var(--warn)', boxShadow: '0 0 12px color-mix(in srgb, var(--warn) 45%, transparent)', animation: 'bpulse 1.6s ease infinite' } : {}),
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <DripCoin size={11} /> POT ◎{w.pot}
          {w.you_in !== w.them_in && !settled && (
            <span style={{ opacity: 0.7 }}>· matched ◎{w.matched}</span>
          )}
        </span>
        <span style={{ opacity: owed ? 1 : 0.75, color: owed ? 'var(--warn)' : undefined }}>
          {settled ? (outcome ?? 'SETTLED')
            : owed ? `THEY RAISED ◎${w.pending!.amount} · ${untilLabel(w.pending!.deadline)} TO ANSWER →`
              : waiting ? `YOUR ◎${w.pending!.amount} IS OUT THERE`
                : w.street === 'closed' ? 'BETTING CLOSED' : 'BLIND STREET →'}
        </span>
      </button>
      {last && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.03em', marginTop: -3, marginBottom: 6,
          color: last.side === 'you' ? 'var(--you)' : last.side === 'them' ? 'var(--opp)' : 'var(--faint)' }}>
          {potLogLine(last, winLabel)}
        </div>
      )}
      {open && (
        <PotSheet pot={pot} matchupId={matchupId} w={w} winLabel={winLabel} leagueId={leagueId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// ── the action sheet ─────────────────────────────────────────────────────────

function PotSheet({ pot, matchupId, w, winLabel, leagueId, onClose }: {
  pot: PotState; matchupId: string; w: PotWindow; winLabel: string; leagueId: string | null; onClose: () => void;
}) {
  const eff = w.effective_stack;
  // The slider steps in ◎5 (the min raise) but its TOP is always the effective
  // stack itself, even when that isn't a round number — "raise all-in ◎12" has
  // to be reachable (S6).
  const snapAmt = (v: number) => {
    if (eff <= 0) return 0;
    if (v >= eff) return eff;
    return Math.min(eff, Math.max(pot.min_raise, Math.round(v / pot.min_raise) * pot.min_raise));
  };
  const [amount, setAmount] = useState(() => snapAmt(pot.min_raise));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [policy, setPolicy] = useState(pot.my_auto_call);

  // The slider stops at the effective stack and never explains why in numbers —
  // "table stakes" is the whole tooltip. Neither bank is disclosed (S6).
  useEffect(() => { setAmount((a) => snapAmt(a)); }, [eff]);   // eslint-disable-line react-hooks/exhaustive-deps

  const canBet = w.state === 'open' && w.street !== 'closed' && pot.both_live;
  const owed = w.pending?.by === 'them';
  const cutoffPassed = !!w.cutoff_at && Date.parse(w.cutoff_at) <= Date.now();

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; re_raise?: boolean; auto_called?: boolean }>, done?: string) => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fn();
      if (!r.ok) { setErr(r.error ?? 'That move was refused.'); return; }
      setNote(r.auto_called ? 'Their standing policy covered it — matched instantly.' : done ?? null);
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); refreshPot(); }
  };

  const savePolicy = async (v: number) => {
    setPolicy(v);
    if (!leagueId) return;
    await setPotAutoCall(leagueId, v).catch(() => {});
    refreshPot();
  };

  const btn = (bg: string) => ({
    flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)',
    background: bg, border: `1px solid ${bg}`, borderRadius: 5, padding: '9px 8px',
    cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
  });

  return (
    <ModalBackdrop onClick={onClose} zIndex={74} padTop={40}>
      <div onClick={(e) => e.stopPropagation()} className="mono" style={{ width: 'min(420px, 94vw)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>
            WINDOW POT · {winLabel.toUpperCase()}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 15, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="grotesk" style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>◎{w.pot}</span>
          <div style={{ fontSize: 9, lineHeight: 1.6, color: 'var(--dim)' }}>
            <div>you ◎{w.you_in} · them ◎{w.them_in}</div>
            {/* The matched-only rule, said plainly, at the exact moment it matters. */}
            <div style={{ color: 'var(--faint)' }}>
              ◎{w.matched} is matched — anything above it comes back to whoever bet it
            </div>
          </div>
        </div>

        <div style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--faint)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>STREET · {w.street === 'closed' ? 'CLOSED' : w.street.toUpperCase()}</span>
          {w.pending && <span style={{ color: 'var(--warn)' }}>CLOCK · {untilLabel(w.pending.deadline)}</span>}
          {!w.pending && w.state === 'open' && w.cutoff_at && !cutoffPassed && (
            <span>RAISES CLOSE IN {untilLabel(w.cutoff_at)}</span>
          )}
          <span>RAISES LEFT · {w.raises_left}</span>
        </div>

        {!pot.both_live && (
          <Notice tone="dim">Ante only — the other seat has no manager on it, so raising is off. You can’t farm an empty chair.</Notice>
        )}
        {w.state !== 'open' && <Notice tone="warn">{potOutcomeLine(w)}</Notice>}
        {err && <Notice tone="bad">{err}</Notice>}
        {note && <Notice tone="good">{note}</Notice>}

        {owed && w.state === 'open' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} style={btn('var(--you)')}
              onClick={() => run(() => potRespond(matchupId, w.win, 'call'), `Called ◎${w.pending!.amount}.`)}>
              CALL ◎{w.pending!.amount}
            </button>
            <button disabled={busy} style={btn('var(--opp)')}
              onClick={() => run(() => potRespond(matchupId, w.win, 'fold'), 'Folded — your window still scores normally.')}>
              FOLD
            </button>
          </div>
        )}

        {canBet && eff > 0 && w.raises_left > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 9, color: 'var(--faint)', letterSpacing: '0.06em' }}>
              <span>{owed ? 'RE-RAISE' : 'RAISE'}</span>
              <span title="Table stakes — you can only bet what the shorter stack can call.">
                MAX ◎{eff} · TABLE STAKES
              </span>
            </div>
            <input
              type="range" min={Math.min(pot.min_raise, eff)} max={Math.max(eff, 1)} step={1} value={amount} disabled={busy}
              onChange={(e) => setAmount(snapAmt(Number(e.target.value)))}
              style={{ width: '100%', accentColor: 'var(--warn)' }}
            />
            <button disabled={busy || amount < 1} style={btn('var(--warn)')}
              onClick={() => run(() => (owed
                ? potRespond(matchupId, w.win, 'raise', amount)
                : potRaise(matchupId, w.win, amount)), `Raised ◎${amount}.`)}>
              {owed ? `CALL ◎${w.pending!.amount} + RAISE ◎${amount}` : `RAISE ◎${amount}`}
            </button>
            {amount === eff && eff % pot.min_raise !== 0 && (
              <div style={{ fontSize: 8.5, color: 'var(--faint)' }}>All-in — the most the shorter stack can call.</div>
            )}
            {cutoffPassed && (
              <div style={{ fontSize: 8.5, color: 'var(--faint)' }}>
                Inside the last-raise cutoff: only a raise their standing policy already covers can be opened.
              </div>
            )}
          </div>
        )}
        {canBet && eff === 0 && (
          <Notice tone="dim">No raise is offerable here — table stakes (the shorter stack, or the pot cap).</Notice>
        )}

        {/* The standing policy — a hidden number, same idea as a slow-auction max
            bid: it answers for you while you're asleep and the opponent never
            sees it. Per WINDOW, not per raise. */}
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 9, color: 'var(--faint)', letterSpacing: '0.06em' }}>
            <span>STANDING POLICY · HIDDEN</span>
            <span>◎{policy} PER WINDOW</span>
          </div>
          <input
            type="range" min={0} max={pot.side_cap} step={5} value={policy}
            onChange={(e) => { void savePolicy(Number(e.target.value)); }}
            style={{ width: '100%', accentColor: 'var(--you)' }}
          />
          <div style={{ fontSize: 8.5, color: 'var(--faint)', lineHeight: 1.5 }}>
            Auto-call raises up to this much per window. ◎{w.policy_left} of it is still available on {winLabel}.
            Anything above it prompts you and starts a clock — which skips overnight hours, so nothing expires while you sleep.
          </div>
        </div>

        {w.log.length > 0 && (
          <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto' }}>
            {w.log.map((a) => (
              <div key={a.seq} style={{ fontSize: 9, color: a.side === 'you' ? 'var(--you)' : a.side === 'them' ? 'var(--opp)' : 'var(--faint)' }}>
                {potLogLine(a, winLabel)}
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 8.5, color: 'var(--faint)', lineHeight: 1.5 }}>
          Coin in, coin out — a pot only ever moves drip-coin. Folding concedes coin, never points:
          your window scores exactly the same either way.
        </div>
      </div>
    </ModalBackdrop>
  );
}

function Notice({ tone, children }: { tone: 'good' | 'bad' | 'warn' | 'dim'; children: ReactNode }) {
  const c = tone === 'good' ? 'var(--you)' : tone === 'bad' ? 'var(--opp)' : tone === 'warn' ? 'var(--warn)' : 'var(--dim)';
  return (
    <div style={{ fontSize: 9, lineHeight: 1.5, color: c, background: 'var(--bg)', border: `1px solid ${c}`, borderRadius: 4, padding: '6px 8px' }}>
      {children}
    </div>
  );
}
