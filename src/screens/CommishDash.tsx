import { useEffect, useMemo, useState } from 'react';
import { commishOverview, leagueLastSeen, seenAgoLabel, leagueLiveBuffs, setLeagueLiveBuffs, leagueGameMode, setLeagueGameMode, setLeagueClassicScoring, setLeagueClassicSlots, setLeagueRosterShape, setLeaguePoolFilter, type AdminLeague, type LeagueSeenRow } from '@drip/core/data/liveApi';
import { classicSlots, slotSpecLabel, CLASSIC_SCORING_SECTIONS, CLASSIC_SCORING_FIELDS, DEFAULT_CLASSIC_SCORING, type SlotSpec } from '@drip/core/engine/classic';
import { NFL_CODES } from '@drip/core/data/kdst';
import { leagueScoringGet } from '@drip/core/data/liveApi';
import { parseScoring, type LeagueScoring } from '@drip/core/engine/leagueScoring';

// The builder's position chips (0163) — base positions only; combos are made by
// lighting several chips on one spot.
const BUILDER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'] as const;
import { LeagueRow, type LeagueTab } from './AdminPage';
import { card, linkBtn, mono, Muted, errMsg, RADIUS, TabBar } from './adminUi';
import { ScoringEditor } from '../app/commishKit';

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
            {/* v0.212.0: the settings/activity/power-up panels are DESTINATIONS
                in the league card's own nav now, not cards stacked underneath
                it. Injection (rather than AdminPage importing them) keeps the
                admin console free of commissioner-only surfaces and avoids an
                import cycle — LeagueRow lives in AdminPage, which this file
                imports. */}
            <LeagueRow l={l} reload={load} admin={false} mine defaultTab={defaultTab ?? 'members'}
              collapsible={shown.length > 1} defaultOpen={i === 0}
              panels={{
                mode: <LeagueSettings leagueId={l.league_id} view="mode" />,
                lineup: <LeagueSettings leagueId={l.league_id} view="lineup" />,
                scoring: <LeagueSettings leagueId={l.league_id} view="scoring" />,
                activity: <LastSeenPanel leagueId={l.league_id} />,
                buffs: <LiveBuffsPanel leagueId={l.league_id} />,
              }} />
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
// v0.212.0: its own ACTIVITY destination, so it loads on arrival — the
// collapse existed only because this was a card in a stack.
export function LastSeenPanel({ leagueId }: { leagueId: string }) {
  const [rows, setRows] = useState<LeagueSeenRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    leagueLastSeen(leagueId)
      .then((r) => { if (r.ok && r.members) setRows(r.members); else setErr(r.error ?? 'load failed'); })
      .catch((e) => setErr(errMsg(e, 'load failed')));
  }, [leagueId]);
  const tone = (lastAt: string | null): string => {
    if (!lastAt) return 'var(--opp)';
    const d = Date.now() - Date.parse(lastAt);
    return d < 24 * 3600_000 ? 'var(--you)' : d < 4 * 24 * 3600_000 ? 'var(--text)' : 'var(--warn)';
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>👁 LAST OPENED · who's been in the league</div>
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
    </div>
  );
}


// ── real-time power-ups switch (0155) ────────────────────────────────────────
// Normie mode (0157): DRIP ⇄ CLASSIC, plus the PPR knob while classic. Frozen
// once the draft starts — the server refuses and the card says why. CLASSIC
// only appears where the founder has flagged it available (0158).
// A builder spot's local draft row: pos/bb plus the PER-SLOT player filter
// (0172) as raw input strings, so partial typing never fights the keyboard.
type SpotDraft = { pos: string[]; bb?: boolean; fTeams: string; fMin: string; fMax: string };
const toSpotDraft = (x: SlotSpec): SpotDraft => ({
  pos: [...x.pos], bb: !!x.bb,
  fTeams: (x.teams ?? []).join(', '),
  fMin: x.min_exp != null ? String(x.min_exp) : '',
  fMax: x.max_exp != null ? String(x.max_exp) : '',
});
const fromSpotDraft = (s: SpotDraft): SlotSpec => {
  const teams = s.fTeams.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const mn = s.fMin.trim() === '' ? null : Number(s.fMin);
  const mx = s.fMax.trim() === '' ? null : Number(s.fMax);
  return {
    pos: s.pos, bb: s.bb,
    ...(teams.length ? { teams } : {}),
    ...(mn != null && Number.isFinite(mn) ? { min_exp: mn } : {}),
    ...(mx != null && Number.isFinite(mx) ? { max_exp: mx } : {}),
  };
};
const spotHasFlt = (s: SpotDraft) => !!(s.fTeams.trim() || s.fMin.trim() || s.fMax.trim());

// ── The scoring page's tabs (v0.213.0) ──────────────────────────────────────
// 14 catalog sections in one endless column made "find the IDP knobs" a scroll
// hunt, so they're bucketed into six tabs by what part of the game they score,
// plus ADJUSTMENTS — the drip-side league scoring that used to live in the
// commish kit. Sections are matched BY NAME with a fallback bucket, so a
// section added to the core catalog still shows up (under MORE) instead of
// silently vanishing from the editor.
const SCORING_TABS: { id: string; label: string; sections: string[] }[] = [
  // Offense splits one-per-skill (founder's call) — a QB's knobs and a WR's
  // knobs are different jobs and were sharing a tab.
  { id: 'passing', label: 'PASSING', sections: ['PASSING'] },
  { id: 'receiving', label: 'RECEIVING', sections: ['RECEIVING'] },
  { id: 'rushing', label: 'RUSHING', sections: ['RUSHING'] },
  // What's left of offense: the cross-skill totals and the per-position
  // first-down bonuses, neither of which belongs under a single skill.
  { id: 'offother', label: 'OTHER', sections: ['COMBINED RUSH + REC', 'FIRST DOWNS BY POSITION'] },
  { id: 'turnovers', label: 'TURNOVERS', sections: ['TURNOVERS & RETURNS', 'SPECIAL TEAMS PLAYER'] },
  { id: 'kicking', label: 'KICKING', sections: ['KICKING', 'PUNTING'] },
  { id: 'defense', label: 'DEFENSE', sections: ['TEAM DEFENSE', 'POINTS ALLOWED', 'YARDAGE ALLOWED'] },
  { id: 'idp', label: 'IDP', sections: ['IDP'] },
  { id: 'coach', label: 'HEAD COACH', sections: ['HEAD COACH'] },
];
const KNOWN_SECTIONS = new Set(SCORING_TABS.flatMap((t) => t.sections));

// ── Scoring presets (v0.213.1) ──────────────────────────────────────────────
// The starting points every commissioner recognises, so nobody has to build a
// standard league out of 155 individual knobs. A preset is a RESET plus its
// own deltas: applying one returns the whole catalog to engine defaults and
// then sets `over`, so the result is exactly the named system and never a
// half-merge with whatever was there before. `ppr` rides along because
// receptions are a league setting (set_league_game_mode), not a catalog key.
const SCORING_PRESETS: { id: string; label: string; hint: string; ppr: number; over: Record<string, number> }[] = [
  { id: 'std', label: 'STANDARD', hint: 'no points per catch — the classic scoring most old leagues grew up on', ppr: 0, over: {} },
  { id: 'half', label: '½ PPR', hint: 'half a point per catch — the modern middle ground', ppr: 0.5, over: {} },
  { id: 'full', label: 'FULL PPR', hint: 'a point per catch — the Sleeper/ESPN default', ppr: 1, over: {} },
  { id: 'tep', label: 'TE PREMIUM', hint: 'full PPR plus an extra ½ point on every tight-end catch', ppr: 1, over: { teRec: 0.5 } },
];

// Team-acronym helper (founder ask): a tappable 32-team grid under every teams
// input, kept in SYNC with the free-text field — a chip toggles its code in or
// out of the comma list, and hand-typed codes light their chips.
const ALL_TEAMS = NFL_CODES.map((c) => c.toUpperCase());
const teamList = (s: string) => s.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
const toggleTeam = (s: string, tm: string) => {
  const list = teamList(s);
  return (list.includes(tm) ? list.filter((x) => x !== tm) : [...list, tm]).join(', ');
};
function TeamChips({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const on = new Set(teamList(value));
  return (
    <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
      {ALL_TEAMS.map((tm) => (
        <button key={tm} disabled={disabled} onClick={() => onChange(toggleTeam(value, tm))} className="mono"
          style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: RADIUS, cursor: 'pointer',
            color: on.has(tm) ? 'var(--on-accent)' : 'var(--dim)', background: on.has(tm) ? 'var(--you)' : 'var(--bg)',
            border: `1px solid ${on.has(tm) ? 'var(--you)' : 'var(--bd)'}`, opacity: disabled ? 0.5 : 1 }}>{tm}</button>
      ))}
    </div>
  );
}

/** The league's CLASSIC settings, split into three destinations (v0.212.0).
 *
 *  This used to be one card that did five jobs at once — mode, the lineup
 *  builder, roster shape, pool filters and all 155 scoring knobs — stacked
 *  below the league card's tab bar where nothing could find it. The state and
 *  save paths are unchanged; `view` just picks which section renders, so each
 *  one gets its own nav destination and its own screen. Only the active view
 *  mounts, so a visit loads the mode once and nothing else. */
export function LeagueSettings({ leagueId, view }: { leagueId: string; view: 'mode' | 'lineup' | 'scoring' }) {
  const [mode, setMode] = useState<'drip' | 'classic' | null>(null);
  const [ppr, setPpr] = useState(1);
  const [classicOk, setClassicOk] = useState(false);
  // The roster POSITION BUILDER (0163, founder's sketch): draft rows edited
  // locally, one SAVE writes the whole spec. Initialized from the stored spec,
  // or derived from the 0161 counts + best-ball names so a legacy league's
  // first SAVE migrates it to the builder model losslessly.
  const [spots, setSpots] = useState<SpotDraft[] | null>(null);
  const [spotsDirty, setSpotsDirty] = useState(false);
  // Which spot's PER-SLOT filter editor (0172) is open.
  const [fltOpen, setFltOpen] = useState<number | null>(null);
  // Which SCORING tab is showing (v0.213.0), and the drip-side adjustments
  // that the ADJUSTMENTS tab edits (loaded lazily — only that tab needs them).
  const [scTab, setScTab] = useState('passing');
  // Which preset is armed for its confirming second click (v0.213.1).
  const [armed, setArmed] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<LeagueScoring | null>(null);
  useEffect(() => {
    if (view !== 'scoring' || adjust) return;
    leagueScoringGet(leagueId).then((r) => { if (r && r.ok) setAdjust(parseScoring(r)); }).catch(() => {});
  }, [view, leagueId, adjust]);
  // BENCH/TAXI/IR (0164) — with the derived draft-rounds readout.
  const [shape, setShape] = useState<{ bench: number; taxi: number; ir: number }>({ bench: 6, taxi: 0, ir: 0 });
  const [rounds, setRounds] = useState<number | null>(null);
  // 0171: admin-enabled extra positions + the commissioner's pool filter.
  const [extraPos, setExtraPos] = useState<string[]>([]);
  const [fltTeams, setFltTeams] = useState('');
  const [fltMin, setFltMin] = useState('');
  const [fltMax, setFltMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Full classic scoring (0160): drafts are strings so partial typing never
  // fights the keyboard; parse + diff against the engine defaults on save.
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
        ? r.slots.map(toSpotDraft)
        : legacy.map((d) => toSpotDraft({ pos: [...d.pos], bb: (r.bestball ?? []).includes(d.slot) })));
      setSpotsDirty(false);
      if (r.shape) setShape({ bench: r.shape.bench ?? 6, taxi: r.shape.taxi ?? 0, ir: r.shape.ir ?? 0 });
      setRounds(r.rounds ?? null);
      setExtraPos(r.positions ?? []);
      setFltTeams((r.pool_filter?.teams ?? []).join(', '));
      setFltMin(r.pool_filter?.min_exp != null ? String(r.pool_filter.min_exp) : '');
      setFltMax(r.pool_filter?.max_exp != null ? String(r.pool_filter.max_exp) : ''); } }).catch(() => {});
  }, [leagueId]);
  const saveFilter = async (clear = false) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const teams = fltTeams.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
      const mn = fltMin.trim() === '' ? null : Number(fltMin);
      const mx = fltMax.trim() === '' ? null : Number(fltMax);
      const r = await setLeaguePoolFilter(leagueId, clear || (!teams.length && mn == null && mx == null)
        ? null : { teams: teams.length ? teams : null, min_exp: mn, max_exp: mx });
      if (r.ok) setNote(clear ? '✓ filter cleared — REFRESH PLAYER POOL to re-open the universe' : '✓ filter saved — REFRESH PLAYER POOL to apply it');
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  // The builder's chips: base positions + this league's admin-enabled extras.
  const builderPos = useMemo(() => {
    const out: string[] = BUILDER_POSITIONS.filter((p) => !(['DL', 'LB', 'DB'] as string[]).includes(p) || extraPos.includes('IDP')).slice();
    for (const p of ['FB', 'HC', 'P', 'RET']) if (extraPos.includes(p)) out.push(p);
    return out;
  }, [extraPos]);
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
  // Applying a preset REPLACES every value, so it asks twice: the first click
  // arms the button, the second commits. A stray click can't wipe a catalog
  // someone spent the evening tuning.
  const applyPreset = async (p: typeof SCORING_PRESETS[number]) => {
    if (busy) return;
    if (armed !== p.id) { setArmed(p.id); setNote(`${p.label} replaces every scoring value — click again to confirm`); return; }
    setBusy(true); setArmed(null); setNote(null);
    try {
      const m = await setLeagueGameMode(leagueId, 'classic', p.ppr);
      if (!m.ok) { setNote(m.error ?? 'failed'); return; }
      setPpr(p.ppr);
      const r = await setLeagueClassicScoring(leagueId, p.over);
      if (r.ok) { scInit(r.scoring ?? {}); setNote(`✓ ${p.label} applied`); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  const saveSpots = async () => {
    if (busy || !spots || !spots.length) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueClassicSlots(leagueId, spots.map(fromSpotDraft));
      if (r.ok) { setSpots(r.slots ? r.slots.map(toSpotDraft) : spots); setSpotsDirty(false); setNote('✓ lineup saved'); }
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
  // Square controls (v0.213.0) — see adminUi's RADIUS note.
  const pill = (on: boolean): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, borderRadius: RADIUS, padding: '6px 13px', cursor: 'pointer',
    color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)',
    border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, opacity: busy || mode === null ? 0.5 : 1,
  });
  return (
    <div style={{ marginTop: 12 }}>
      {view === 'mode' && (
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
      )}
      {/* The RECEPTIONS pills used to live here (v0.213.1: removed). PPR is a
          scoring decision, so it rides the SCORING page's presets now — this
          tab is just "which game are we playing". */}
      {view === 'mode' && mode === 'classic' && (
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          Receptions, bonuses and every other value live under ⚖ SCORING — start from a preset there, then tune anything.
        </div>
      )}
      {/* A drip league has no classic lineup or scoring to set — say so rather
          than render an empty pane. */}
      {view !== 'mode' && mode === 'drip' && (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', lineHeight: 1.6 }}>
          This is a DRIP league — {view === 'lineup' ? 'lineups are the drip windows' : 'scoring is the drip engine'}, so there's nothing to set here.
          Switch to CLASSIC under GAME MODE to shape a traditional {view === 'lineup' ? 'starting lineup' : 'scoring catalog'}.
        </div>
      )}
      {view === 'lineup' && mode === 'classic' && spots && (
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
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '5px 8px' }}>
                <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--dim)', width: 22 }}>{i + 1}</span>
                {builderPos.map((p) => {
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
                <button disabled={busy} title="Per-spot player filter: only these teams / this tenure window may fill the spot"
                  onClick={() => setFltOpen((cur) => cur === i ? null : i)}
                  className="mono" style={{ ...pill(spotHasFlt(sp)), padding: '3px 8px', fontSize: 8.5 }}>🔎</button>
                <button disabled={busy || spots.length <= 1} title="Remove this spot"
                  onClick={() => { setSpots((cur) => cur!.filter((_, j) => j !== i)); setSpotsDirty(true); }}
                  className="mono" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--opp)', fontSize: 11, padding: '0 3px' }}>✕</button>
                {/* PER-SLOT FILTER (0172): who may FILL this spot — teams and/or a
                    tenure window (0 = rookie). Never shrinks the draft pool. */}
                {fltOpen === i && (
                  <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <input value={sp.fTeams} onChange={(e) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fTeams: e.target.value })); setSpotsDirty(true); }}
                      placeholder="teams (e.g. KC, SF) — empty = all"
                      className="mono" style={{ fontFamily: 'inherit', fontSize: 9.5, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, flex: '1 1 160px' }} />
                    <input value={sp.fMin} onChange={(e) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fMin: e.target.value })); setSpotsDirty(true); }}
                      placeholder="min yrs" inputMode="numeric"
                      className="mono" style={{ fontFamily: 'inherit', fontSize: 9.5, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 58 }} />
                    <input value={sp.fMax} onChange={(e) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fMax: e.target.value })); setSpotsDirty(true); }}
                      placeholder="max yrs" inputMode="numeric"
                      className="mono" style={{ fontFamily: 'inherit', fontSize: 9.5, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 58 }} />
                    <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>rookies only → max 0 · SAVE LINEUP applies</span>
                    <TeamChips value={sp.fTeams} disabled={busy}
                      onChange={(next) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fTeams: next })); setSpotsDirty(true); }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <button disabled={busy || spots.length >= 20}
              onClick={() => { setSpots((cur) => [...cur!, { pos: ['RB', 'WR', 'TE'], fTeams: '', fMin: '', fMax: '' }]); setSpotsDirty(true); }}
              className="mono" style={{ ...pill(false), padding: '4px 14px' }}>＋ ADD SPOT</button>
            <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', lineHeight: 1.5 }}>
              Any position combination per spot · 🎯 BB spots fill themselves with the top scorer · 🔎 limits who may fill the spot (teams / tenure — an RB spot for rookies only) · tenure filters need a pool re-seed so player experience is loaded · locks once the draft starts.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            {([['BENCH', 'bench', 20], ['TAXI', 'taxi', 8], ['IR', 'ir', 8]] as const).map(([label, key, max]) => (
              <span key={key} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 8.5, fontWeight: 700, color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '4px 8px' }}>
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
          {extraPos.length > 0 && (
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--you)', marginTop: 4 }}>
              UNLOCKED FOR THIS LEAGUE: {extraPos.join(' · ')} — after changing spots or filters, hit ↻ REFRESH PLAYER POOL (league page) so the draft pool matches.
            </div>
          )}
          {/* PLAYER FILTERS (0171): who is ALLOWED in this league's pool — a team
              whitelist and/or a tenure window (0 = rookie). Applies when the pool
              is (re)seeded; locks at the draft like everything else. */}
          <div style={{ marginTop: 10, border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '8px 10px' }}>
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', fontWeight: 700 }}>🔎 PLAYER FILTERS · who's allowed in the pool</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <input value={fltTeams} onChange={(e) => setFltTeams(e.target.value)} placeholder="teams (e.g. KC, SF, BUF) — empty = all"
                className="mono" style={{ fontFamily: 'inherit', fontSize: 10, padding: '5px 7px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, flex: '1 1 220px' }} />
              <input value={fltMin} onChange={(e) => setFltMin(e.target.value)} placeholder="min yrs" inputMode="numeric"
                className="mono" style={{ fontFamily: 'inherit', fontSize: 10, padding: '5px 7px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 64 }} />
              <input value={fltMax} onChange={(e) => setFltMax(e.target.value)} placeholder="max yrs" inputMode="numeric"
                className="mono" style={{ fontFamily: 'inherit', fontSize: 10, padding: '5px 7px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 64 }} />
              <button onClick={() => void saveFilter()} disabled={busy} className="mono" style={pill(true)}>SAVE FILTER</button>
              <button onClick={() => void saveFilter(true)} disabled={busy} className="mono" style={pill(false)}>CLEAR</button>
              <TeamChips value={fltTeams} disabled={busy} onChange={setFltTeams} />
            </div>
            <div className="mono" style={{ fontSize: 8, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5 }}>
              Rookies only → max 0. Vets with 8+ years → min 8. One-team league → list the team. Players whose tenure Sleeper doesn't know are excluded while a tenure filter is set. Filters bite when the pool is (re)seeded — pre-draft only.
            </div>
          </div>
        </div>
      )}
      {view === 'scoring' && (
        <div>
          <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--faint)' }}>
            ⚖ SCORING <span style={{ fontWeight: 400 }}>every value is yours to set · changed values light up</span>
          </div>
          {/* PRESETS (v0.213.1): the recognised starting points, so a standard
              league is one click instead of 155 decisions. Each one resets the
              catalog and applies its own deltas, and carries the receptions
              setting that used to be a separate control on GAME MODE. */}
          {mode === 'classic' && (
            <div style={{ marginTop: 8, border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--faint)' }}>START FROM</span>
                {SCORING_PRESETS.map((p) => (
                  <button key={p.id} onClick={() => void applyPreset(p)} disabled={busy} title={p.hint}
                    className="mono" style={{ ...pill(armed === p.id), padding: '4px 11px' }}>
                    {armed === p.id ? `CONFIRM ${p.label}` : p.label}
                  </button>
                ))}
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginLeft: 'auto' }}>
                  RECEPTIONS: <span style={{ color: 'var(--you)', fontWeight: 700 }}>{ppr === 1 ? 'FULL PPR' : ppr === 0.5 ? '½ PPR' : 'NON-PPR'}</span>
                </span>
              </div>
              <div className="mono" style={{ fontSize: 8, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5 }}>
                A preset RESETS every value to that system, then you tune whatever you like below. Applying one asks twice — it replaces the whole catalog.
              </div>
            </div>
          )}
          {/* Tabs across the top (v0.213.0): six catalog groups + the drip
              ADJUSTMENTS that used to live in the commish kit. A drip league
              only has ADJUSTMENTS to show, so it opens straight on it. */}
          <TabBar
            tabs={[...(mode === 'classic' ? SCORING_TABS.map((t) => ({ id: t.id, label: t.label })) : []),
              // A section the core catalog grows that no bucket claims still
              // gets an editor rather than disappearing.
              ...(mode === 'classic' && CLASSIC_SCORING_SECTIONS.some((s) => !KNOWN_SECTIONS.has(s.section))
                ? [{ id: 'more', label: 'UNGROUPED' }] : []),
              { id: 'adjust', label: 'ADJUSTMENTS' }]}
            active={mode === 'classic' ? scTab : 'adjust'}
            onSelect={setScTab} wrap
            style={{ margin: '8px 0 0' }} />
        </div>
      )}
      {view === 'scoring' && mode === 'classic' && scTab !== 'adjust' && (
        <div>
          <>
              {CLASSIC_SCORING_SECTIONS.filter((sec) =>
                (SCORING_TABS.find((t) => t.id === scTab)?.sections ?? []).includes(sec.section)
                || (scTab === 'more' && !KNOWN_SECTIONS.has(sec.section)),
              ).map((sec) => (
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
                            style={{ fontFamily: 'inherit', fontSize: 11, padding: '5px 6px', background: 'var(--bg)', color: 'var(--text)', border: `1px solid ${changed ? 'var(--you)' : 'var(--bd)'}`, borderRadius: RADIUS, width: '100%', boxSizing: 'border-box' }} />
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
        </div>
      )}
      {/* ADJUSTMENTS (v0.213.0): the drip-side league scoring — TD bonus,
          yardage multiplier, turnover penalty, scoped bonuses — folded in from
          the commish kit. Applies to BOTH modes, which is why it isn't gated
          on classic: a drip league's only scoring controls are these. */}
      {view === 'scoring' && (mode !== 'classic' || scTab === 'adjust') && (
        <div style={{ marginTop: 12 }}>
          {adjust
            ? <ScoringEditor leagueId={leagueId} initial={adjust} inline
                onDone={() => setAdjust(null)} onClose={() => {}} />
            : <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>Loading…</div>}
        </div>
      )}
      {note && <div className="mono" style={{ fontSize: 9, color: note.startsWith('✓') ? 'var(--faint)' : 'var(--warn, #c66)', marginTop: 8 }}>{note}</div>}
    </div>
  );
}

export function LiveBuffsPanel({ leagueId }: { leagueId: string }) {
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
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>◈ REAL-TIME POWER-UPS</div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
          The armed live buffs — overtime, momentum, amps, counters. Off blocks new arms league-wide; already-armed buffs stay reclaimable.
        </div>
      </div>
      <button onClick={() => void flip()} disabled={on === null || busy} className="mono"
        style={{ fontSize: 10, fontWeight: 700, borderRadius: RADIUS, padding: '7px 16px', cursor: 'pointer', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, opacity: on === null || busy ? 0.5 : 1, flexShrink: 0 }}>
        {on === null ? '…' : on ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}
