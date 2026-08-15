import { useEffect, useState } from 'react';
import { commishOverview, leagueLastSeen, seenAgoLabel, leagueLiveBuffs, setLeagueLiveBuffs, leagueGameMode, setLeagueGameMode, type AdminLeague, type LeagueSeenRow } from '@drip/core/data/liveApi';
import { LeagueRow, type LeagueTab } from './AdminPage';
import { card, linkBtn, mono, Muted, errMsg } from './adminUi';

// Commissioner dashboard — one tabbed management card (LeagueRow) per league you
// run. Opened from a league card's "manage" (focusId → just that league), as
// the landing screen for commish-only accounts (all your leagues), or right
// after creating a league (defaultTab 'draft' → land on the draft room).
export function CommishDash({ onBack, focusId, defaultTab }: {
  onBack: () => void; focusId?: string | null; defaultTab?: LeagueTab;
}) {
  const [leagues, setLeagues] = useState<AdminLeague[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Keep already-loaded leagues on a failed refresh; surface the real error.
  const load = async () => {
    try { setLeagues(await commishOverview()); setErr(null); }
    catch (e) { setErr(errMsg(e, 'Load failed.')); setLeagues((cur) => cur ?? []); }
  };
  useEffect(() => { load(); }, []);

  const shown = focusId && leagues ? leagues.filter((l) => l.league_id === focusId) : leagues;
  const title = focusId ? (shown?.[0]?.name ?? 'League') : '⚑ My leagues';

  return (
    <div className="mgmt">
      <button onClick={onBack} className="mono" style={{ ...linkBtn, color: 'var(--you)', marginBottom: 10 }}>← all leagues</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div className="mono" style={{ ...mono, fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>
            Commissioner tools — invite players, seed coin, sync the season, run the live weeks.
          </div>
        </div>
        <button onClick={load} className="mono" style={{ ...linkBtn, flexShrink: 0 }}>↻ refresh</button>
      </div>

      {err && <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--opp)', marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-word' }}>⚠ {err}</div>}
      {shown === null ? <div style={card}><Muted text="Loading…" /></div>
        : shown.length === 0 ? (
          <div style={card}>
            <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>None yet. Verify ownership via “I’m the commissioner,” and ask the admin to import the league if it isn’t listed.</div>
          </div>
        )
        : shown.map((l, i) => (
          // With several leagues, cards collapse to just their header (first one
          // starts open) so the list stays scannable; a lone/focused league is
          // always expanded.
          <div key={l.league_id}>
            <LeagueRow l={l} reload={load} admin={false} mine defaultTab={defaultTab ?? 'members'}
              collapsible={shown.length > 1} defaultOpen={i === 0} />
            <LastSeenCard leagueId={l.league_id} />
            <GameModeCard leagueId={l.league_id} />
            <LiveBuffsCard leagueId={l.league_id} />
          </div>
        ))}

      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', margin: '10px 4px', lineHeight: 1.5 }}>
        Share the invite link with your players, see who’s joined, sync each week’s matchups, and run the live windows — all for the leagues you commission.
      </div>
      <div style={{ textAlign: 'center', marginTop: 6 }}><button onClick={onBack} className="mono" style={linkBtn}>← all leagues</button></div>
    </div>
  );
}


// ── Last opened (0151) ───────────────────────────────────────────────────────
// The commissioner's "is anyone actually here?" — every member with when they
// last OPENED the league (the hub or the board; badge polls don't count).
// Collapsed by default; loads on first expand.
function LastSeenCard({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LeagueSeenRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || rows !== null) return;
    leagueLastSeen(leagueId)
      .then((r) => { if (r.ok && r.members) setRows(r.members); else setErr(r.error ?? 'load failed'); })
      .catch((e) => setErr(errMsg(e, 'load failed')));
  }, [open, rows, leagueId]);
  const tone = (lastAt: string | null): string => {
    if (!lastAt) return 'var(--opp)';
    const d = Date.now() - Date.parse(lastAt);
    return d < 24 * 3600_000 ? 'var(--you)' : d < 4 * 24 * 3600_000 ? 'var(--text)' : 'var(--warn)';
  };
  return (
    <div style={{ ...card, marginTop: 8 }}>
      <button onClick={() => setOpen((o) => !o)} className="mono"
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>👁 LAST OPENED · who's been in the league</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--dim)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)' }}>⚠ {err}</div>}
          {!err && rows === null && <Muted text="Loading…" />}
          {rows?.length === 0 && <Muted text="No members yet." />}
          {rows?.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: tone(m.last_at), flexShrink: 0 }}>{seenAgoLabel(m.last_at)}</span>
            </div>
          ))}
          <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
            When each member last opened this league — on the web or the app. "Never" means they've claimed a seat but not been in yet.
          </div>
        </div>
      )}
    </div>
  );
}


// ── real-time power-ups switch (0155) ────────────────────────────────────────
// Normie mode (0157): DRIP ⇄ CLASSIC, plus the PPR knob while classic. Frozen
// once the draft starts — the server refuses and the card says why. CLASSIC
// only appears where the founder has flagged it available (0158).
function GameModeCard({ leagueId }: { leagueId: string }) {
  const [mode, setMode] = useState<'drip' | 'classic' | null>(null);
  const [ppr, setPpr] = useState(1);
  const [classicOk, setClassicOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then((r) => { if (r.ok) { setMode(r.mode ?? 'drip'); setPpr(Number(r.ppr ?? 1)); setClassicOk(r.classic_ok === true); } }).catch(() => {});
  }, [leagueId]);
  const set = async (m: 'drip' | 'classic', p?: number) => {
    if (busy || mode === null) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueGameMode(leagueId, m, p);
      if (r.ok) { setMode(m); if (p != null) setPpr(p); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  const pill = (on: boolean): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '6px 13px', cursor: 'pointer',
    color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)',
    border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, opacity: busy || mode === null ? 0.5 : 1,
  });
  return (
    <div style={{ ...card, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>🎮 GAME MODE</div>
          <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
            DRIP is the full game — metrics, windows, power-ups. CLASSIC is traditional fantasy: standard scoring, one weekly QB/RB/RB/WR/WR/TE/FLEX/K/DEF lineup, no bonuses or power-ups. Locks once the draft starts.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => void set('drip')} disabled={busy || mode === null} className="mono" style={pill(mode === 'drip')}>DRIP</button>
          {(classicOk || mode === 'classic')
            ? <button onClick={() => void set('classic')} disabled={busy || mode === null} className="mono" style={pill(mode === 'classic')}>CLASSIC</button>
            : <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', alignSelf: 'center' }}>CLASSIC not unlocked</span>}
        </div>
      </div>
      {mode === 'classic' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', fontWeight: 700 }}>RECEPTIONS</span>
          {([0, 0.5, 1] as const).map((p) => (
            <button key={p} onClick={() => void set('classic', p)} disabled={busy} className="mono" style={pill(ppr === p)}>
              {p === 0 ? 'NON-PPR' : p === 0.5 ? '½ PPR' : 'FULL PPR'}
            </button>
          ))}
        </div>
      )}
      {note && <div className="mono" style={{ fontSize: 9, color: 'var(--warn, #c66)', marginTop: 8 }}>{note}</div>}
    </div>
  );
}

function LiveBuffsCard({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    leagueLiveBuffs(leagueId).then((r) => { if (r.ok) setOn(r.on !== false); }).catch(() => {});
  }, [leagueId]);
  const flip = async () => {
    if (on === null || busy) return;
    setBusy(true);
    try { const r = await setLeagueLiveBuffs(leagueId, !on); if (r.ok) setOn(!on); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...card, marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>◈ REAL-TIME POWER-UPS</div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
          The armed live buffs — overtime, momentum, amps, counters. Off blocks new arms league-wide; already-armed buffs stay reclaimable.
        </div>
      </div>
      <button onClick={() => void flip()} disabled={on === null || busy} className="mono"
        style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '7px 16px', cursor: 'pointer', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, opacity: on === null || busy ? 0.5 : 1, flexShrink: 0 }}>
        {on === null ? '…' : on ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}
