// ▶ SIM STRIP (0251) — the dress rehearsal's steering wheel, on the board.
//
// Founder: "Can we make this all playable from the matchup board in the test
// league?" Rendered only on a live board whose league is in 🧪 LIVE TEST, and
// only for a super-admin — the gate is the SERVER's (sim_run_state answers
// 'forbidden' to everyone else), so the strip probes once and vanishes for
// non-admins rather than trusting any client-side role flag.
//
// ▶ arms a sim_run for the week on screen; the WORKER's sweep does the actual
// driving (drips baked plays into live_play, resolves, finalizes), so this
// strip is a remote control, not an engine — close the tab mid-game and the
// rehearsal keeps playing. ⏹ is the CLI's reset: the week back to scheduled,
// picks unlocked, SIM rows gone.
import { useEffect, useRef, useState } from 'react';
import { adminSimStart, adminSimReset, simRunState, type SimRun } from '@drip/core/data/liveApi';
import { APP_VERSION } from '@drip/core/version';

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** `onChanged` fires after a successful ▶/⏹ so the host board can refetch its
 *  live data NOW instead of on its next poll tick — a reset that leaves stale
 *  scores up for a minute reads as a reset that didn't work (founder). */
export function SimStrip({ leagueId, week, onChanged }: { leagueId: string; week: number; onChanged?: () => void }) {
  // null = probing, false = not an admin (render nothing), SimRun|'idle' = show.
  const [state, setState] = useState<SimRun | 'idle' | false | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = async () => {
    const r = await simRunState(leagueId).catch(() => null);
    if (!alive.current) return;
    if (!r?.ok) { setState(false); return; }  // forbidden → not an admin → no strip
    setState(r.run ?? 'idle');
  };
  useEffect(() => {
    alive.current = true;
    refresh();
    const t = window.setInterval(refresh, 10_000);
    return () => { alive.current = false; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  if (state === null || state === false) return null;
  const run = state === 'idle' ? null : state;

  const start = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await adminSimStart(leagueId, week).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setErr(r?.error ?? 'failed'); return; }
    onChanged?.();
    refresh();
  };
  const reset = async () => {
    if (busy) return;
    if (!window.confirm(`Reset the sim'd week ${run?.week ?? week}? Matchups back to scheduled, picks unlocked, SIM feed cleared.`)) return;
    setBusy(true); setErr(null);
    const r = await adminSimReset(leagueId, run?.week ?? week).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setErr(r?.error ?? 'failed'); return; }
    onChanged?.();
    refresh();
  };

  const btn = (accent: string): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: accent, background: 'var(--surface)',
    border: `1px solid ${accent}`, borderRadius: 4, padding: '5px 9px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
  });

  return (
    <div className="mono" style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--dim)', background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: '1px dashed var(--warn)', borderRadius: 6, padding: '6px 10px' }}>
      <span style={{ fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)' }}>🧪 REHEARSAL · {APP_VERSION}</span>
      {run ? (
        <span>
          week {run.week} · {run.status === 'running'
            // Percent over feed-clock time (founder): a minute count means
            // nothing without the feed's length. pct is null for one worker
            // tick at the start of a run — the clock covers that gap.
            ? <>LIVE · feed {run.pct != null ? `${run.pct}%` : `at ${fmtClock(Number(run.clock))}`} · {run.speed}× — the worker is driving; watch the windows</>
            : 'DONE — the week resolved to FINAL through the live path'}
        </span>
      ) : (
        <span>replay a baked 2025 week through the real pipeline, onto this board</span>
      )}
      {!run && <button onClick={start} disabled={busy} style={btn('var(--you)')}>▶ SIM WEEK {week}</button>}
      {run && <button onClick={reset} disabled={busy} style={btn('var(--opp)')}>⏹ RESET WEEK {run.week}</button>}
      {err && <span style={{ color: 'var(--opp)' }}>⚠ {err}</span>}
    </div>
  );
}
