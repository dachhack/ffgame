import { useEffect, useState } from 'react';
import { commishOverview, leagueLastSeen, seenAgoLabel, leagueLiveBuffs, setLeagueLiveBuffs, leagueGameMode, setLeagueGameMode, setLeagueClassicScoring, setLeagueClassicSlots, setLeagueRosterShape, type AdminLeague, type LeagueSeenRow } from '@drip/core/data/liveApi';
import { classicSlots, slotSpecLabel, CLASSIC_SCORING_SECTIONS, CLASSIC_SCORING_FIELDS, DEFAULT_CLASSIC_SCORING, type SlotSpec } from '@drip/core/engine/classic';

// The builder's position chips (0163) — base positions only; combos are made by
// lighting several chips on one spot.
const BUILDER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'] as const;
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
  // The roster POSITION BUILDER (0163, founder's sketch): draft rows edited
  // locally, one SAVE writes the whole spec. Initialized from the stored spec,
  // or derived from the 0161 counts + best-ball names so a legacy league's
  // first SAVE migrates it to the builder model losslessly.
  const [spots, setSpots] = useState<SlotSpec[] | null>(null);
  const [spotsDirty, setSpotsDirty] = useState(false);
  // BENCH/TAXI/IR (0164) — with the derived draft-rounds readout.
  const [shape, setShape] = useState<{ bench: number; taxi: number; ir: number }>({ bench: 6, taxi: 0, ir: 0 });
  const [rounds, setRounds] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Full classic scoring (0160): drafts are strings so partial typing never
  // fights the keyboard; parse + diff against the engine defaults on save.
  const [scOpen, setScOpen] = useState(false);
  const [scDraft, setScDraft] = useState<Record<string, string>>({});
  const scInit = (over: Record<string, number>) => {
    const d: Record<string, string> = {};
    for (const f of CLASSIC_SCORING_FIELDS) d[f.key] = String(over[f.key] ?? DEFAULT_CLASSIC_SCORING[f.key]);
    setScDraft(d);
  };
  useEffect(() => {
    leagueGameMode(leagueId).then((r) => { if (r.ok) { setMode(r.mode ?? 'drip'); setPpr(Number(r.ppr ?? 1)); setClassicOk(r.classic_ok === true); scInit(r.scoring ?? {});
      const legacy = classicSlots(r.roster && Object.keys(r.roster).length ? r.roster : null);
      setSpots(r.slots?.length
        ? r.slots.map((x) => ({ pos: [...x.pos], bb: !!x.bb }))
        : legacy.map((d) => ({ pos: [...d.pos], bb: (r.bestball ?? []).includes(d.slot) })));
      setSpotsDirty(false);
      if (r.shape) setShape({ bench: r.shape.bench ?? 6, taxi: r.shape.taxi ?? 0, ir: r.shape.ir ?? 0 });
      setRounds(r.rounds ?? null); } }).catch(() => {});
  }, [leagueId]);
  const saveScoring = async (reset = false) => {
    if (busy) return;
    setBusy(true); setNote(null);
    const over: Record<string, number> = {};
    if (!reset) {
      for (const f of CLASSIC_SCORING_FIELDS) {
        const v = Number(scDraft[f.key]);
        if (Number.isFinite(v) && v !== DEFAULT_CLASSIC_SCORING[f.key]) over[f.key] = v;
      }
    }
    try {
      const r = await setLeagueClassicScoring(leagueId, over);
      if (r.ok) { scInit(r.scoring ?? {}); setNote('✓ scoring saved'); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  const saveSpots = async () => {
    if (busy || !spots || !spots.length) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueClassicSlots(leagueId, spots);
      if (r.ok) { setSpots((r.slots ?? spots).map((x) => ({ pos: [...x.pos], bb: !!x.bb }))); setSpotsDirty(false); setNote('✓ lineup saved'); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  const saveShape = async (next: { bench: number; taxi: number; ir: number }) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueRosterShape(leagueId, next.bench, next.taxi, next.ir);
      if (r.ok) { setShape(r.shape ?? next); setRounds(r.rounds ?? null); setNote('✓ roster shape saved'); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
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
      {mode === 'classic' && spots && (
        <div style={{ marginTop: 10 }}>
          {/* The roster POSITION BUILDER (0163, the founder's sketch): each row is
              one starting spot — its own eligible-position set, its own best-ball
              flag — plus ADD. Bench = draft rounds − starters (league creation). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', fontWeight: 700 }}>🧩 ROSTER BUILDER · {spots.length} STARTING SPOTS</span>
            {spotsDirty && <button onClick={() => void saveSpots()} disabled={busy} className="mono" style={{ ...pill(true), padding: '4px 12px' }}>SAVE LINEUP</button>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
            {spots.map((sp, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', border: '1px solid var(--bd)', borderRadius: 6, padding: '5px 8px' }}>
                <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--dim)', width: 22 }}>{i + 1}</span>
                {BUILDER_POSITIONS.map((p) => {
                  const on = sp.pos.includes(p);
                  return (
                    <button key={p} disabled={busy}
                      onClick={() => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, pos: on ? x.pos.filter((q) => q !== p) : [...x.pos, p] })); setSpotsDirty(true); }}
                      className="mono" style={{ ...pill(on), padding: '3px 7px', fontSize: 8.5 }}>{p}</button>
                  );
                })}
                <span className="mono" style={{ flex: 1, minWidth: 60, fontSize: 8, color: 'var(--faint)', textAlign: 'right' }}>{slotSpecLabel(sp.pos)}</span>
                <button disabled={busy} title="Best ball: this spot fills itself with the top scorer"
                  onClick={() => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, bb: !x.bb })); setSpotsDirty(true); }}
                  className="mono" style={{ ...pill(!!sp.bb), padding: '3px 8px', fontSize: 8.5 }}>🎯 BB</button>
                <button disabled={busy || spots.length <= 1} title="Remove this spot"
                  onClick={() => { setSpots((cur) => cur!.filter((_, j) => j !== i)); setSpotsDirty(true); }}
                  className="mono" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--opp)', fontSize: 11, padding: '0 3px' }}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <button disabled={busy || spots.length >= 20}
              onClick={() => { setSpots((cur) => [...cur!, { pos: ['RB', 'WR', 'TE'] }]); setSpotsDirty(true); }}
              className="mono" style={{ ...pill(false), padding: '4px 14px' }}>＋ ADD SPOT</button>
            <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', lineHeight: 1.5 }}>
              Any position combination per spot · 🎯 BB spots fill themselves with the top scorer · locks once the draft starts.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            {([['BENCH', 'bench', 20], ['TAXI', 'taxi', 8], ['IR', 'ir', 8]] as const).map(([label, key, max]) => (
              <span key={key} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 8.5, fontWeight: 700, color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: 6, padding: '4px 8px' }}>
                {label}
                <button onClick={() => void saveShape({ ...shape, [key]: Math.max(0, shape[key] - 1) })} disabled={busy || shape[key] === 0} className="mono" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 10 }}>−</button>
                <span style={{ minWidth: 12, textAlign: 'center', color: 'var(--you)' }}>{shape[key]}</span>
                <button onClick={() => void saveShape({ ...shape, [key]: Math.min(max, shape[key] + 1) })} disabled={busy || shape[key] >= max} className="mono" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 10 }}>＋</button>
              </span>
            ))}
            <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--you)' }}>
              DRAFT = {rounds ?? spots.length + shape.bench + shape.taxi + shape.ir} ROUNDS
            </span>
          </div>
          <div className="mono" style={{ fontSize: 8, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5 }}>
            You draft the whole roster (starters + bench + taxi + IR), then stash. IR takes a real IR/Out designation only; taxi and IR players can't be started.
          </div>
        </div>
      )}
      {mode === 'classic' && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setScOpen((o) => !o)} className="mono"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 8.5, fontWeight: 700, color: 'var(--faint)' }}>
            ⚖ SCORING {scOpen ? '▾' : '▸'} <span style={{ fontWeight: 400 }}>every value is yours to set</span>
          </button>
          {scOpen && (
            <>
              {CLASSIC_SCORING_SECTIONS.map((sec) => (
                <div key={sec.section} style={{ marginTop: 8 }}>
                  <div className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)', marginBottom: 4 }}>{sec.section}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
                    {sec.fields.map((f) => {
                      const changed = Number(scDraft[f.key]) !== DEFAULT_CLASSIC_SCORING[f.key];
                      return (
                        <label key={f.key} className="mono" style={{ fontSize: 7.5, fontWeight: 700, color: changed ? 'var(--you)' : 'var(--faint)', display: 'grid', gap: 3 }}>
                          {f.label}{f.perYard ? ' /YD' : ''}
                          <input value={scDraft[f.key] ?? ''} inputMode="decimal"
                            onChange={(e) => setScDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                            style={{ fontFamily: 'inherit', fontSize: 11, padding: '5px 6px', background: 'var(--bg)', color: 'var(--text)', border: `1px solid ${changed ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 5, width: '100%', boxSizing: 'border-box' }} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => void saveScoring()} disabled={busy} className="mono" style={pill(true)}>SAVE SCORING</button>
                <button onClick={() => void saveScoring(true)} disabled={busy} className="mono" style={pill(false)}>RESET TO STANDARD</button>
              </div>
            </>
          )}
        </div>
      )}
      {note && <div className="mono" style={{ fontSize: 9, color: note.startsWith('✓') ? 'var(--faint)' : 'var(--warn, #c66)', marginTop: 8 }}>{note}</div>}
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
