// The Window Pot — chips on the felt for any window the two of you agree to
// play for. Spec: docs/window-pot.md. Migration 0106 is the authority; nothing
// here decides anything, it only shows the pot and offers the moves.
//
// Wagering is OPT-IN and happens BEFORE picks lock, which is why the chip lives
// on the window section itself rather than the battle bar: the whole ladder is
// played during setup, while both lineups are still sealed, and it closes the
// instant that window's picks do.
//
// v1 renders on the LIVE board only (`liveCtx` non-null) — the demo/sim boards
// never mount it. A league with `pot_ante = 0` gets `{ off: true }` from
// pot_state and everything below returns null, so the feature leaves no trace
// until the flag is flipped.
//
// One poll for the whole matchup: every window's chip subscribes to the shared
// store below rather than each fetching its own pot_state. The poll also calls
// pot_sweep — any-member-advances, exactly like draft_tick — so a manager with
// the board open closes their own pots at the deadline even between worker
// ticks.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ModalBackdrop } from '../app/ui';
import { DripCoin } from '../app/gameIcons';
import { potState, potSweep, potAnte, potAct, friendlyError, type PotState, type PotWindow, type PotActionResult } from '../data/liveApi';

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
    // Advance first, then read — so a pot that just hit its deadline shows as
    // closed in the very same poll instead of a beat later. A sweep failure is
    // never fatal to the read (the worker sweeps too).
    await potSweep(mid).catch(() => {});
    const pot = await potState(mid);
    if (snap.matchupId === mid) set({ pot, error: null });
  } catch (e) {
    if (snap.matchupId === mid) set({ error: friendlyError(e) });
  } finally { pulling = false; }
}

/** Re-read immediately (after one of your own moves lands). */
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

/** "2d 4h" / "3h 12m" / "8m" / "closed" — how long betting stays open. */
export function untilLabel(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return '';
  const ms = (typeof iso === 'number' ? iso : Date.parse(iso)) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'closed';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const KIND_VERB: Record<string, string> = {
  ante: 'put', match: 'matched', check: 'checked', wager: 'wagered',
  call: 'called', fold: 'backed out', settle: 'took the pot', refund: 'came back', void: 'was voided',
};

/** A pot move as a duel-feed line: "They wagered ◎15 on SNF". */
export function potLogLine(a: PotWindow['log'][number], winLabel: string): string {
  const who = a.side === 'you' ? 'You' : a.side === 'them' ? 'They' : '';
  const amt = a.amount > 0 ? ` ◎${a.amount}` : '';
  if (a.kind === 'refund') return `Unmatched${amt} returned on ${winLabel}`;
  if (a.kind === 'void') return `The offer on ${winLabel} voided — nobody matched it`;
  if (a.kind === 'ante') return `${who || 'Someone'} put${amt} up on ${winLabel}`;
  if (a.kind === 'settle') return `${who || 'Nobody'} took the${amt} pot on ${winLabel}`;
  if (a.kind === 'check') return `${who || 'Someone'} checked on ${winLabel}`;
  return `${who || 'Someone'} ${KIND_VERB[a.kind] ?? a.kind}${amt} on ${winLabel}`;
}

/** The closed pot, said out loud — sits next to the ★ window + bonus equation. */
export function potOutcomeLine(w: PotWindow): string | null {
  const ante = Math.max(w.you_ante, w.them_ante);
  switch (w.state) {
    case 'void': return `POT VOID — nobody matched it, ◎${ante} returned`;
    case 'folded_them': return `THEY BACKED OUT → +◎${ante}`;
    case 'folded_you': return `YOU BACKED OUT → −◎${ante}`;
    case 'split': return `POT ◎${w.pot} → split, dead even`;
    case 'settled': return w.winner === 'you' ? `POT ◎${w.pot} → taken` : `POT ◎${w.pot} → theirs`;
    default: return null;
  }
}

const isClosed = (s: PotWindow['state']) =>
  s === 'void' || s === 'folded_you' || s === 'folded_them' || s === 'settled' || s === 'split';

// ── the chip ─────────────────────────────────────────────────────────────────

/** The pot chip for one window. Renders in EVERY phase — the ladder is played
 *  before picks lock — and offers the ◎10 on windows nobody has touched yet. */
export function WindowPotChip({ pot, matchupId, win, winLabel, lockAtMs, cards }: {
  pot: PotState; matchupId: string; win: string; winLabel: string;
  /** When this window's picks lock (kickoff − 1h) — the betting deadline. */
  lockAtMs: number | null;
  cards?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const w = pot.windows.find((x) => x.win === win) ?? null;
  const openable = pot.both_live && lockAtMs != null && Date.now() < lockAtMs;

  // Nothing to show: no pot here, and no way to start one.
  if (!w && !openable) return null;

  // Is the ball in your court? Drives the pulse.
  const yours = w
    ? (w.state === 'offered' && w.leader === 'them') || (w.state === 'live' && w.turn === 'you')
    : false;
  const closed = w ? isClosed(w.state) : false;

  // Card theme: a physical felt chip instead of a pill.
  const chipArt = cards
    ? {
      background: 'radial-gradient(circle at 50% 38%, #b4362f 0%, #8f2721 60%, #6d1c18 100%)',
      border: '2px dashed color-mix(in srgb, #ffffff 62%, transparent)',
      boxShadow: '0 1px 0 rgba(0,0,0,.45), inset 0 0 0 3px rgba(0,0,0,.18)',
      color: '#fff2e8',
    }
    : { background: 'var(--surface)', border: '1px solid var(--bd)', color: 'var(--text)' };

  const status = (): string => {
    if (!w) return `PUT ◎${pot.ante} ON THIS WINDOW →`;
    if (closed) return potOutcomeLine(w) ?? 'CLOSED';
    if (w.state === 'locked') return 'RIDING TO THE FINAL';
    if (w.state === 'offered') {
      return w.leader === 'them'
        ? `THEY PUT ◎${w.them_ante} UP · MATCH IT? →`
        : `◎${w.you_ante} OFFERED · WAITING ON THEM`;
    }
    if (w.turn === 'you') return w.owed > 0 ? `THEY WAGERED ◎${w.owed} · YOUR MOVE →` : 'YOUR MOVE →';
    return 'WITH THEM';
  };

  // The newest move that wasn't the opening ante — amounts are the signal, so
  // wagers and back-outs are public by design.
  const last = w ? [...w.log].reverse().find((a) => a.kind !== 'ante' && a.kind !== 'match') ?? null : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mono"
        title={w ? 'The window pot — ante, wager, call' : `Put ◎${pot.ante} up and see if they take it`}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'space-between',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: cards ? 999 : 5,
          padding: cards ? '6px 12px' : '5px 9px', margin: '2px 0 6px', cursor: 'pointer',
          opacity: w ? 1 : 0.72, ...chipArt,
          ...(yours ? { borderColor: 'var(--warn)', boxShadow: '0 0 12px color-mix(in srgb, var(--warn) 45%, transparent)', animation: 'bpulse 1.6s ease infinite' } : {}),
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <DripCoin size={11} /> {w ? `POT ◎${w.pot}` : 'WINDOW POT'}
        </span>
        <span style={{ opacity: yours ? 1 : 0.75, color: yours ? 'var(--warn)' : undefined }}>{status()}</span>
      </button>
      {last && !closed && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.03em', marginTop: -3, marginBottom: 6,
          color: last.side === 'you' ? 'var(--you)' : last.side === 'them' ? 'var(--opp)' : 'var(--faint)' }}>
          {potLogLine(last, winLabel)}
        </div>
      )}
      {open && (
        <PotSheet pot={pot} matchupId={matchupId} win={win} w={w} winLabel={winLabel}
          lockAtMs={lockAtMs} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// ── the action sheet ─────────────────────────────────────────────────────────

function PotSheet({ pot, matchupId, win, w, winLabel, lockAtMs, onClose }: {
  pot: PotState; matchupId: string; win: string; w: PotWindow | null; winLabel: string;
  lockAtMs: number | null; onClose: () => void;
}) {
  const eff = w?.effective_stack ?? 0;
  // The slider steps in ◎5 but its TOP is always the effective stack itself,
  // even when that isn't a round number — "all-in ◎12" has to be reachable.
  const snapAmt = (v: number) => {
    if (eff <= 0) return 0;
    if (v >= eff) return eff;
    return Math.min(eff, Math.max(pot.min_wager, Math.round(v / pot.min_wager) * pot.min_wager));
  };
  const [amount, setAmount] = useState(() => snapAmt(pot.min_wager));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmFold, setConfirmFold] = useState(false);

  useEffect(() => { setAmount((a) => snapAmt(a)); }, [eff]);   // eslint-disable-line react-hooks/exhaustive-deps

  const bettingOpen = lockAtMs != null && Date.now() < lockAtMs;
  const closed = w ? isClosed(w.state) : false;
  const myTurn = w?.state === 'live' && w.turn === 'you';
  const owed = myTurn ? w!.owed : 0;

  const run = async (fn: () => Promise<PotActionResult>, done?: string) => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fn();
      if (!r.ok) { setErr(r.error ?? 'That move was refused.'); return; }
      setNote(done ?? null);
      setConfirmFold(false);
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); refreshPot(); }
  };

  const btn = (bg: string) => ({
    flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)',
    background: bg, border: `1px solid ${bg}`, borderRadius: 5, padding: '9px 8px',
    cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
  });

  return (
    <ModalBackdrop onClick={onClose} zIndex={74} padTop={40}>
      <div onClick={(e) => e.stopPropagation()} className="mono" style={{ width: 'min(430px, 94vw)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>
            WINDOW POT · {winLabel.toUpperCase()}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 15, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {w ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="grotesk" style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>◎{w.pot}</span>
            <div style={{ fontSize: 9, lineHeight: 1.6, color: 'var(--dim)' }}>
              <div>you ◎{w.you_in} · them ◎{w.them_in}</div>
              <div style={{ color: 'var(--faint)' }}>
                {w.leader === 'you' ? 'you' : 'they'} opened it · ◎{Math.max(w.you_ante, w.them_ante)} ante each
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 10, lineHeight: 1.6, color: 'var(--dim)' }}>
            Nothing riding on {winLabel} yet. Put ◎{pot.ante} up and see whether they take it —
            if they don’t, it voids at picks lock and your coin comes straight back.
          </div>
        )}

        <div style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--faint)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>
            {bettingOpen ? `BETTING CLOSES IN ${untilLabel(lockAtMs)} · WHEN PICKS LOCK` : 'BETTING CLOSED · PICKS ARE LOCKED'}
          </span>
          {w?.state === 'live' && <span>{myTurn ? 'YOUR MOVE' : 'WITH THEM'}</span>}
        </div>

        {!pot.both_live && (
          <Notice tone="dim">There’s no manager on the other seat, so nobody could answer an offer. Nothing to bet here.</Notice>
        )}
        {w?.state === 'locked' && (
          <Notice tone="dim">Frozen at ◎{w.pot} — betting closed when picks locked. It pays out when the window goes final.</Notice>
        )}
        {closed && <Notice tone="warn">{potOutcomeLine(w!)}</Notice>}
        {err && <Notice tone="bad">{err}</Notice>}
        {note && <Notice tone="good">{note}</Notice>}

        {/* ── the ◎10 handshake ── */}
        {!w && pot.both_live && bettingOpen && (
          <button disabled={busy || pot.my_bank < pot.ante} style={btn('var(--warn)')}
            onClick={() => run(() => potAnte(matchupId, win), `◎${pot.ante} is on the table — it’s with them now.`)}>
            {pot.my_bank < pot.ante ? `NOT ENOUGH COIN — NEED ◎${pot.ante}` : `PUT ◎${pot.ante} UP`}
          </button>
        )}
        {w?.state === 'offered' && w.leader === 'them' && bettingOpen && (
          <>
            <button disabled={busy || pot.my_bank < pot.ante} style={btn('var(--warn)')}
              onClick={() => run(() => potAnte(matchupId, win), 'Matched — they open the betting.')}>
              {pot.my_bank < pot.ante ? `NOT ENOUGH COIN — NEED ◎${pot.ante}` : `MATCH ◎${w.them_ante}`}
            </button>
            <div style={{ fontSize: 8.5, color: 'var(--faint)', lineHeight: 1.5 }}>
              Ignoring it is free: an unmatched offer voids at picks lock and their coin goes back to them.
              Match it and they get first action.
            </div>
          </>
        )}
        {w?.state === 'offered' && w.leader === 'you' && (
          <Notice tone="dim">
            Your ◎{w.you_ante} is on the table. If they never match it, it voids at picks lock and comes straight back.
          </Notice>
        )}

        {/* ── your turn ── */}
        {myTurn && bettingOpen && (
          <>
            {owed > 0 ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} style={btn('var(--you)')}
                  onClick={() => run(() => potAct(matchupId, win, 'call'), `Called ◎${owed}.`)}>
                  CALL ◎{owed}
                </button>
                <button disabled={busy} style={btn('var(--opp)')} onClick={() => setConfirmFold(true)}>
                  BACK OUT
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} style={btn('var(--dim)')}
                  onClick={() => run(() => potAct(matchupId, win, 'check'), 'Checked — over to them.')}>
                  CHECK
                </button>
                <button disabled={busy} style={btn('var(--opp)')} onClick={() => setConfirmFold(true)}>
                  BACK OUT
                </button>
              </div>
            )}

            {eff > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 9, color: 'var(--faint)', letterSpacing: '0.06em' }}>
                  <span>{owed > 0 ? 'RAISE' : 'WAGER'}</span>
                  <span title="Table stakes — you can only bet what the shorter stack can cover.">
                    MAX ◎{eff} · TABLE STAKES
                  </span>
                </div>
                <input
                  type="range" min={Math.min(pot.min_wager, eff)} max={Math.max(eff, 1)} step={1} value={amount} disabled={busy}
                  onChange={(e) => setAmount(snapAmt(Number(e.target.value)))}
                  style={{ width: '100%', accentColor: 'var(--warn)' }}
                />
                <button disabled={busy || amount < 1} style={btn('var(--warn)')}
                  onClick={() => run(() => potAct(matchupId, win, owed > 0 ? 'raise' : 'wager', amount),
                    owed > 0 ? `Called ◎${owed} and raised ◎${amount}.` : `Wagered ◎${amount}.`)}>
                  {owed > 0 ? `CALL ◎${owed} + RAISE ◎${amount}` : `WAGER ◎${amount}`}
                </button>
                {amount === eff && eff % pot.min_wager !== 0 && (
                  <div style={{ fontSize: 8.5, color: 'var(--faint)' }}>All-in — the most the shorter stack can cover.</div>
                )}
              </div>
            )}
            {eff === 0 && (
              <Notice tone="dim">Nothing more is offerable here — table stakes (the shorter bank, or the ◎{pot.cap} pot cap).</Notice>
            )}
          </>
        )}
        {w?.state === 'live' && !myTurn && bettingOpen && (
          <Notice tone="dim">Waiting on them. You’ll get the move back as soon as they act.</Notice>
        )}

        {confirmFold && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--opp)', borderRadius: 5, padding: 9 }}>
            <div style={{ fontSize: 9, lineHeight: 1.5, color: 'var(--opp)' }}>
              Back out and you hand them your ◎{w ? Math.max(w.you_ante, w.them_ante) : pot.ante} ante — that’s the whole cost.
              Every chip either of you wagered goes back to whoever bet it. Your lineup still scores this window exactly the same.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} style={btn('var(--opp)')}
                onClick={() => run(() => potAct(matchupId, win, 'fold'), 'Backed out — the pot is theirs.')}>
                YES, BACK OUT
              </button>
              <button disabled={busy} style={btn('var(--dim)')} onClick={() => setConfirmFold(false)}>KEEP PLAYING</button>
            </div>
          </div>
        )}

        {w && w.log.length > 0 && (
          <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto' }}>
            {w.log.map((a) => (
              <div key={a.seq} style={{ fontSize: 9, color: a.side === 'you' ? 'var(--you)' : a.side === 'them' ? 'var(--opp)' : 'var(--faint)' }}>
                {potLogLine(a, winLabel)}
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 8.5, color: 'var(--faint)', lineHeight: 1.5 }}>
          Coin in, coin out — a pot only ever moves drip-coin between the two of you. It never touches points:
          your window scores exactly the same whether you bet on it or not.
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
