import { useEffect, useMemo, useState } from 'react';
import { commishOverview, leagueLastSeen, seenAgoLabel, leagueLiveBuffs, setLeagueLiveBuffs, leagueGameMode, setLeagueGameMode, setLeagueGolf, setLeagueClassicScoring, setLeagueClassicSlots, setLeagueRosterShape, setLeaguePoolFilter, type AdminLeague, type LeagueSeenRow } from '@drip/core/data/liveApi';
import { classicSlots, slotSpecLabel, CLASSIC_SCORING_SECTIONS, CLASSIC_SCORING_FIELDS, DEFAULT_CLASSIC_SCORING, type SlotSpec } from '@drip/core/engine/classic';
import { NFL_DIVISIONS } from '@drip/core/data/kdst';
import { teamLogo } from '@drip/core/data/media';
import { leagueScoringGet, commishDeleteLeague, friendlyError, setLeagueName, setLeagueAvatar } from '@drip/core/data/liveApi';
import { Avatar } from '../app/ui';
import { AvatarPicker } from '../app/AvatarPicker';
import { parseScoring, type LeagueScoring } from '@drip/core/engine/leagueScoring';

// The builder's position chips (0163) — base positions only; combos are made by
// lighting several chips on one spot.
const BUILDER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'] as const;
import { LeagueRow, type LeagueTab } from './AdminPage';
import { card, linkBtn, mono, Muted, errMsg, RADIUS, TabBar, inp, btn } from './adminUi';
import { ScoringEditor } from '../app/commishKit';
import { notifyLeagueSettingsChanged } from '@drip/core/data/rosterBus';
import { rosterRules, setTaxiRules, setIrRules, playerFlags } from '@drip/core/data/liveApi';

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
      {/* NO TOP BACK LINK (v0.296.4, founder: "we don't need this extra all
          leagues link below the leagues and matchup chip"). Two other ways out
          already sit above it — the shell header's ← my leagues, which is on
          every view but home, and the league strip's 🏠 LEAGUE chip — so this
          was a third door in the same square inch of screen. The one at the
          FOOT of the page stays: after scrolling a console this long, the way
          out is genuinely far away. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="grotesk" style={{ fontSize: 19.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div className="mono" style={{ ...mono, fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>
            Commissioner tools — invite players, seed coin, sync the season, run the live weeks.
          </div>
        </div>
        <button onClick={load} className="mono" style={{ ...linkBtn, flexShrink: 0 }}>↻ refresh</button>
      </div>

      {err && <div className="mono" style={{ ...mono, fontSize: 13, color: 'var(--opp)', marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-word' }}>⚠ {err}</div>}
      {shown === null ? <div style={card}><Muted text="Loading…" /></div>
        : shown.length === 0 ? (
          <div style={card}>
            <div className="mono" style={{ ...mono, fontSize: 13, color: 'var(--faint)', lineHeight: 1.5 }}>None yet. Verify ownership via “I’m the commissioner,” and ask the admin to import the league if it isn’t listed.</div>
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
            <LeagueRow l={l} reload={load} admin={false} mine defaultTab={defaultTab ?? 'members'} openSection={!!defaultTab}
              collapsible={shown.length > 1} defaultOpen={i === 0}
              panels={{
                mode: <><LeagueIdentityPanel leagueId={l.league_id} name={l.name} avatar={l.avatar_url} reload={load} /><LeagueSettings leagueId={l.league_id} view="mode" /></>,
                lineup: <LeagueSettings leagueId={l.league_id} view="lineup" />,
                scoring: <LeagueSettings leagueId={l.league_id} view="scoring" />,
                activity: <LastSeenPanel leagueId={l.league_id} />,
                buffs: <LiveBuffsPanel leagueId={l.league_id} />,
                delete: <DeleteLeaguePanel leagueId={l.league_id} name={l.name} seats={l.rosters} onDeleted={load} />,
              }} />
          </div>
        ))}

      <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', margin: '10px 4px', lineHeight: 1.5 }}>
        Share the invite link with your players, see who’s joined, sync each week’s matchups, and run the live windows — all for the leagues you commission.
      </div>
      <div style={{ textAlign: 'center', marginTop: 6 }}><button onClick={onBack} className="mono" style={linkBtn}>← all leagues</button></div>
    </div>
  );
}


// ── League identity (v0.356.10) ──────────────────────────────────────────────
// The league's name and crest, editable where the founder says they belong:
// the commissioner's console, not a member's team page (which carried both
// since 0187 — TeamManage is bare of league controls now). Same RPCs, same
// guards — set_league_name / set_league_avatar re-check the whistle.
function LeagueIdentityPanel({ leagueId, name, avatar, reload }: {
  leagueId: string; name: string; avatar?: string | null; reload: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);   // non-null ⇒ renaming
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) reload(); else setNote(friendlyError(r.error ?? 'failed'));
    } catch (e) { setNote(errMsg(e, 'failed')); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <button onClick={() => setPicking(true)} title="change the league crest" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }}>
        <Avatar name={name} accent="var(--warn)" src={avatar} size={46} />
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)' }}>LEAGUE NAME &amp; CREST</div>
        {draft === null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            <button onClick={() => setDraft(name)} title="rename the league" className="mono" style={linkBtn}>✎</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <input value={draft} autoFocus maxLength={60} placeholder="league name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim().length >= 2) { void run(() => setLeagueName(leagueId, draft)); setDraft(null); }
                if (e.key === 'Escape') setDraft(null);
              }}
              style={{ ...inp, fontSize: 13, flex: 1, minWidth: 160 }} />
            <button onClick={() => { if (draft.trim().length >= 2) void run(() => setLeagueName(leagueId, draft)); setDraft(null); }}
              disabled={busy || draft.trim().length < 2} className="mono" style={btn(true)}>SAVE</button>
            <button onClick={() => setDraft(null)} className="mono" style={linkBtn}>cancel</button>
            <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', flexBasis: '100%' }}>
              2–60 characters — everyone in the league sees it.
            </span>
          </div>
        )}
        {note && <div className="mono" style={{ fontSize: 11, color: 'var(--opp)', marginTop: 4 }}>⚠ {note}</div>}
      </div>
      {picking && (
        <AvatarPicker title="Pick the league crest"
          onPick={(url) => { setPicking(false); void run(() => setLeagueAvatar(leagueId, url)); }}
          onClose={() => setPicking(false)} />
      )}
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
      <div className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>👁 LAST OPENED · who's been in the league</div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {err && <div className="mono" style={{ fontSize: 12.5, color: 'var(--opp)' }}>⚠ {err}</div>}
        {!err && rows === null && <Muted text="Loading…" />}
        {rows?.length === 0 && <Muted text="No members yet." />}
        {rows?.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: tone(m.last_at), flexShrink: 0 }}>{seenAgoLabel(m.last_at)}</span>
          </div>
        ))}
        <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
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
// v0.300.0: the filter also carries FLAGS — the commissioner's own labels as a
// condition on who may stand in the spot.
type SpotDraft = { pos: string[]; bb?: boolean; label: string; fTeams: string; fMin: string; fMax: string; fFlags: string[]; zero: string };
const toSpotDraft = (x: SlotSpec): SpotDraft => ({
  pos: [...x.pos], bb: !!x.bb, label: x.label ?? '',
  fTeams: (x.teams ?? []).join(', '),
  fMin: x.min_exp != null ? String(x.min_exp) : '',
  fMax: x.max_exp != null ? String(x.max_exp) : '',
  fFlags: [...(x.flags ?? [])],
  zero: x.zero_pts != null ? String(x.zero_pts) : '',
});
const fromSpotDraft = (s: SpotDraft): SlotSpec => {
  const teams = s.fTeams.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const mn = s.fMin.trim() === '' ? null : Number(s.fMin);
  const mx = s.fMax.trim() === '' ? null : Number(s.fMax);
  return {
    pos: s.pos, bb: s.bb,
    ...(s.label.trim() ? { label: s.label.trim() } : {}),
    ...(teams.length ? { teams } : {}),
    ...(mn != null && Number.isFinite(mn) ? { min_exp: mn } : {}),
    ...(mx != null && Number.isFinite(mx) ? { max_exp: mx } : {}),
    ...(s.fFlags.length ? { flags: s.fFlags } : {}),
    // The zero-fill rule (0200). Never sent on a best-ball spot — the server
    // refuses the pair, and the toggle below can't produce it either.
    ...(!s.bb && s.zero.trim() !== '' && Number.isFinite(Number(s.zero)) ? { zero_pts: Number(s.zero) } : {}),
  };
};
const spotHasFlt = (s: SpotDraft) => !!(s.fTeams.trim() || s.fMin.trim() || s.fMax.trim() || s.fFlags.length);

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
const teamList = (s: string) => s.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
const toggleTeam = (s: string, tm: string) => {
  const list = teamList(s);
  return (list.includes(tm) ? list.filter((x) => x !== tm) : [...list, tm]).join(', ');
};
/** The 32 teams laid out the way the league is actually organised (v0.216.1):
 *  AFC beside NFC, four divisions each, every chip carrying its logo. A flat
 *  alphabetical run of abbreviations only works if you already know all 32; by
 *  division you find a team the way you think about one — and the division
 *  label is itself a button, so "the whole NFC West" is one click. */
function TeamChips({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const on = new Set(teamList(value));
  const setMany = (codes: string[], turnOn: boolean) => {
    const cur = teamList(value).filter((c) => turnOn || !codes.includes(c));
    onChange((turnOn ? [...new Set([...cur, ...codes])] : cur).join(', '));
  };
  return (
    <div style={{ flexBasis: '100%', marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '10px 18px' }}>
      {(['AFC', 'NFC'] as const).map((conf) => (
        <div key={conf} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)' }}>{conf}</div>
          {NFL_DIVISIONS.filter((d) => d.conf === conf).map((d) => {
            const codes = d.teams.map((t) => t.toUpperCase());
            const allOn = codes.every((c) => on.has(c));
            return (
              <div key={d.div} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <button disabled={disabled} onClick={() => setMany(codes, !allOn)}
                  title={`${allOn ? 'clear' : 'select'} all of ${conf} ${d.div}`}
                  className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: allOn ? 'var(--you)' : 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', width: 52, textAlign: 'left', padding: 0 }}>
                  {d.div.toUpperCase()}
                </button>
                {d.teams.map((code) => {
                  const tm = code.toUpperCase();
                  const lit = on.has(tm);
                  const logo = teamLogo(code);
                  return (
                    <button key={tm} disabled={disabled} onClick={() => onChange(toggleTeam(value, tm))} className="mono"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, padding: '2px 6px 2px 3px', borderRadius: RADIUS, cursor: 'pointer',
                        color: lit ? 'var(--on-accent)' : 'var(--dim)', background: lit ? 'var(--you)' : 'var(--bg)',
                        border: `1px solid ${lit ? 'var(--you)' : 'var(--bd)'}`, opacity: disabled ? 0.5 : 1 }}>
                      {/* teamLogo() is null in mark-free mode (trademarks
                          suppressed) and the chip falls back to the abbr; a
                          load failure collapses the same way. */}
                      {logo && <img src={logo} alt="" width={15} height={15} style={{ display: 'block', flexShrink: 0 }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                      {tm}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
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
  // GOLF (v0.303.0): null until the mode load lands, so neither button lights
  // up on a guess.
  const [golf, setGolf] = useState<boolean | null>(null);
  const saveGolf = async (on: boolean) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueGolf(leagueId, on);
      if (r.ok) { setGolf(r.golf === true); setNote(on ? '✓ golf mode on — lowest total wins' : '✓ golf mode off'); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  // The roster POSITION BUILDER (0163, founder's sketch): draft rows edited
  // locally, one SAVE writes the whole spec. Initialized from the stored spec,
  // or derived from the 0161 counts + best-ball names so a legacy league's
  // first SAVE migrates it to the builder model losslessly.
  const [spots, setSpots] = useState<SpotDraft[] | null>(null);
  const [spotsDirty, setSpotsDirty] = useState(false);
  // The league's flag vocabulary (v0.300.0) — the labels a spot filter may
  // require. Empty in a league that has flagged nobody, and the row hides.
  const [flagLabels, setFlagLabels] = useState<string[]>([]);
  useEffect(() => {
    playerFlags(leagueId).then((rows) => {
      if (Array.isArray(rows)) setFlagLabels([...new Set(rows.map((r) => (r.label ?? '').trim()).filter(Boolean))].sort());
    }).catch(() => {});
  }, [leagueId]);
  // Which spot's PER-SLOT filter editor (0172) is open.
  const [fltOpen, setFltOpen] = useState<number | null>(null);
  // Which SCORING tab is showing (v0.213.0), and the drip-side adjustments
  // that the ADJUSTMENTS tab edits (loaded lazily — only that tab needs them).
  const [scTab, setScTab] = useState('passing');
  // Which preset is armed for its confirming second click (v0.213.1).
  const [armed, setArmed] = useState<string | null>(null);
  // Drag-to-reorder (0174): the index being dragged. Safe because the spec is
  // an ordered array whose slot names generate positionally AND freezes at the
  // draft — so a reorder can never reshuffle rows that already exist.
  const [drag, setDrag] = useState<number | null>(null);
  const moveSpot = (from: number, to: number) => {
    if (from === to || to < 0) return;
    setSpots((cur) => {
      if (!cur || to >= cur.length) return cur;
      const next = cur.slice();
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
    setSpotsDirty(true);
  };
  const [adjust, setAdjust] = useState<LeagueScoring | null>(null);
  useEffect(() => {
    if (view !== 'scoring' || adjust) return;
    leagueScoringGet(leagueId).then((r) => { if (r && r.ok) setAdjust(parseScoring(r)); }).catch(() => {});
  }, [view, leagueId, adjust]);
  // BENCH/TAXI/IR (0164) — with the derived draft-rounds readout.
  const [shape, setShape] = useState<{ bench: number; taxi: number; ir: number }>({ bench: 6, taxi: 0, ir: 0 });
  // The draft's own window (0064, widened to 99 in 0192). Roster size IS the
  // round count, so this is the ceiling on starters + bench + taxi + IR.
  const MAX_ROUNDS = 99;
  // THE TAXI SQUAD'S OWN RULES (0196): who may ride it, and whether it shuts at
  // the season's first kickoff. Loaded here because they live beside the SIZE,
  // which is the number right above them.
  const [taxi, setTaxi] = useState<{ maxExp: number | null; lock: boolean; lockedNow: boolean } | null>(null);
  // WHO MAY GO ON IR (0198) — the commissioner's own list of designations,
  // read from the same call. Default is IR/O, the pair 0164 hardcoded.
  const [irTags, setIrTags] = useState<string[] | null>(null);
  const loadTaxi = () => {
    rosterRules(leagueId).then((r) => {
      if (!r.ok) return;
      setTaxi({ maxExp: r.taxi_max_exp ?? null, lock: r.taxi_lock !== false, lockedNow: !!r.taxi_locked_now });
      setIrTags(r.ir_tags?.length ? r.ir_tags : ['IR', 'O']);
    }).catch(() => {});
  };
  useEffect(loadTaxi, [leagueId]);
  const saveTaxi = async (maxExp: number | null, lock: boolean | null) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setTaxiRules(leagueId, maxExp, lock);
      if (r.ok) { setTaxi({ maxExp: r.max_exp ?? null, lock: r.lock !== false, lockedNow: !!r.locked_now }); setNote('✓ taxi rules saved'); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  /** Toggle one designation in or out of the IR list. The server refuses an
   *  empty list, so the last one standing can't be turned off — the button
   *  says so rather than sending a call that will bounce. */
  const toggleIrTag = async (tag: string) => {
    if (busy || !irTags) return;
    const on = irTags.includes(tag);
    if (on && irTags.length === 1) { setNote('IR needs at least one designation — an IR spot nobody can qualify for is a spot to remove.'); return; }
    const next = on ? irTags.filter((x) => x !== tag) : [...irTags, tag];
    setBusy(true); setNote(null);
    try {
      const r = await setIrRules(leagueId, next);
      if (r.ok) { setIrTags(r.tags?.length ? r.tags : next); setNote('✓ IR eligibility saved'); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
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
    leagueGameMode(leagueId).then((r) => { if (r.ok) { setMode(r.mode ?? 'drip'); setPpr(Number(r.ppr ?? 1)); setClassicOk(r.classic_ok === true); setGolf(r.golf === true); scInit(r.scoring ?? {});
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
      // The ROSTER RULES panel prints a roster size DERIVED from these spots
      // (v0.297.1) — it re-reads on this notice instead of showing what it read
      // on mount.
      if (r.ok) { setSpots(r.slots ? r.slots.map(toSpotDraft) : spots); setSpotsDirty(false); setRounds(r.rounds ?? null); setNote('✓ lineup saved'); notifyLeagueSettingsChanged(leagueId); }
      else setNote(r.error ?? 'failed');
    } finally { setBusy(false); }
  };
  const saveShape = async (next: { bench: number; taxi: number; ir: number }) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueRosterShape(leagueId, next.bench, next.taxi, next.ir);
      if (r.ok) { setShape(r.shape ?? next); setRounds(r.rounds ?? null); setNote('✓ roster shape saved'); notifyLeagueSettingsChanged(leagueId); }
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
  // A LIT position chip wears that position's colour (v0.216.1) — the same
  // --pos-* palette the draft board's PosPill uses, so QB reads as QB
  // everywhere instead of "selected" reading as one undifferentiated accent.
  // Unlit stays neutral so the spot's actual eligibility is what stands out.
  const posChip = (p: string, on: boolean): React.CSSProperties => ({
    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', borderRadius: RADIUS,
    padding: '3px 7px', cursor: 'pointer',
    color: on ? `var(--pos-${p}-fg)` : 'var(--dim)',
    background: on ? `var(--pos-${p}-bg)` : 'var(--bg)',
    border: `1px solid ${on ? `var(--pos-${p}-bd)` : 'var(--bd)'}`,
    opacity: busy ? 0.5 : 1,
  });
  // Square controls (v0.213.0) — see adminUi's RADIUS note.
  const pill = (on: boolean): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 700, borderRadius: RADIUS, padding: '6px 13px', cursor: 'pointer',
    color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)',
    border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, opacity: busy || mode === null ? 0.5 : 1,
  });
  return (
    <div style={{ marginTop: 12 }}>
      {view === 'mode' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>🎮 GAME MODE</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
            DRIP is the full game — metrics, windows, power-ups. CLASSIC is traditional fantasy: standard scoring, one weekly QB/RB/RB/WR/WR/TE/FLEX/K/DEF lineup, no bonuses or power-ups. Locks once the draft starts.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => void set('drip')} disabled={busy || mode === null} className="mono" style={pill(mode === 'drip')}>DRIP</button>
          {(classicOk || mode === 'classic')
            ? <button onClick={() => void set('classic')} disabled={busy || mode === null} className="mono" style={pill(mode === 'classic')}>CLASSIC</button>
            : <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', alignSelf: 'center' }}>CLASSIC not unlocked</span>}
        </div>
      </div>
      )}
      {/* The RECEPTIONS pills used to live here (v0.213.1: removed). PPR is a
          scoring decision, so it rides the SCORING page's presets now — this
          tab is just "which game are we playing". */}
      {view === 'mode' && mode === 'classic' && (<>
        {/* ── GOLF MODE (v0.303.0) ──────────────────────────────────────────
            One setting that inverts who wins. It belongs beside GAME MODE
            rather than under SCORING because it doesn't change a single
            scoring value — a touchdown is worth exactly what the catalog says.
            It changes which end of the leaderboard you are aiming at, which is
            a fact about the GAME. Frozen at the draft for the same reason the
            game mode is: you draft a golf league inside out. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>⛳ GOLF MODE</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
              The LOWEST weekly total wins the matchup — standings, tiebreaks and playoffs all read the other way. Nothing about scoring changes: a touchdown is worth what your catalog says. Pairs with the ⛳ zero-fill on each starting spot under ⚖ TEAMS &amp; ROSTERS, which makes an empty spot the worst thing that can happen to you rather than the best. Locks once the draft starts.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => void saveGolf(false)} disabled={busy || golf === null} className="mono" style={pill(golf === false)}>HIGH WINS</button>
            <button onClick={() => void saveGolf(true)} disabled={busy || golf === null} className="mono" style={pill(golf === true)}>⛳ LOW WINS</button>
          </div>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          Receptions, bonuses and every other value live under ⚖ SCORING — start from a preset there, then tune anything.
        </div>
      </>)}
      {/* A drip league has no classic lineup or scoring to set — say so rather
          than render an empty pane. */}
      {view !== 'mode' && mode === 'drip' && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.6 }}>
          This is a DRIP league — {view === 'lineup' ? 'lineups are the drip windows' : 'scoring is the drip engine'}, so there's nothing to set here.
          Switch to CLASSIC under GAME MODE to shape a traditional {view === 'lineup' ? 'starting lineup' : 'scoring catalog'}.
        </div>
      )}
      {view === 'lineup' && mode === 'classic' && spots && (() => {
        // starters + the three stashes: what the draft's rounds will be.
        const shapeTotal = spots.length + shape.bench + shape.taxi + shape.ir;
        return (
        <div style={{ marginTop: 10 }}>
          {/* The roster POSITION BUILDER (0163, the founder's sketch): each row is
              one starting spot — its own eligible-position set, its own best-ball
              flag — plus ADD. Bench = draft rounds − starters (league creation). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 700 }}>🧩 ROSTER BUILDER · {spots.length} STARTING SPOTS</span>
            {spotsDirty && <button onClick={() => void saveSpots()} disabled={busy} className="mono" style={{ ...pill(true), padding: '4px 12px' }}>SAVE LINEUP</button>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
            {spots.map((sp, i) => (
              <div key={i} data-spot={i}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', border: `1px solid ${drag === i ? 'var(--you)' : 'var(--bd)'}`, borderRadius: RADIUS, padding: '5px 8px', opacity: drag === i ? 0.55 : 1, background: drag === i ? 'var(--bg)' : undefined }}>
                {/* DRAG HANDLE, ON POINTER EVENTS (v0.297.1). It was HTML5 drag
                    — `draggable` + dragstart/drop — which a touch screen never
                    fires: the finger scrolled the page instead, and once the
                    panel became a scrolling SHEET (v0.296.3) that was all it
                    could look like ("the spots don't drag and drop anymore, the
                    window just scrolls"). Pointer events cover mouse, pen and
                    touch in one path; `touchAction: none` on the handle is what
                    stops the browser claiming the gesture for a scroll, and
                    pointer capture keeps the moves coming to this element even
                    when the finger leaves it.
                    The list reorders LIVE under the finger, so there is no drop
                    target to aim at — where the row is IS the answer. Keyboard
                    ↑/↓ stays for anyone driving this without a pointer. */}
                <button title="drag to reorder · or focus and press ↑ / ↓"
                  onPointerDown={(e) => {
                    if (busy) return;
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDrag(i);
                  }}
                  onPointerMove={(e) => {
                    if (drag == null) return;
                    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-spot]');
                    const to = el ? Number((el as HTMLElement).dataset.spot) : NaN;
                    if (Number.isInteger(to) && to !== drag) { moveSpot(drag, to); setDrag(to); }
                  }}
                  onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDrag(null); }}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') { e.preventDefault(); moveSpot(i, i - 1); }
                    if (e.key === 'ArrowDown') { e.preventDefault(); moveSpot(i, i + 1); }
                  }}
                  className="mono" aria-label={`reorder spot ${i + 1}`}
                  style={{ background: 'none', border: 'none', color: drag === i ? 'var(--you)' : 'var(--faint)', cursor: busy ? 'default' : 'grab', fontSize: 15, padding: '2px 4px', lineHeight: 1, touchAction: 'none' }}>⠿</button>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', width: 22 }}>{i + 1}</span>
                {builderPos.map((p) => {
                  const on = sp.pos.includes(p);
                  return (
                    <button key={p} disabled={busy}
                      onClick={() => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, pos: on ? x.pos.filter((q) => q !== p) : [...x.pos, p] })); setSpotsDirty(true); }}
                      className="mono" style={posChip(p, on)}>{p}</button>
                  );
                })}
                <input value={sp.label}
                  onChange={(e) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, label: e.target.value.slice(0, 24) })); setSpotsDirty(true); }}
                  placeholder={slotSpecLabel(sp.pos)} maxLength={24}
                  title="name this spot — e.g. Only NFC Players. Naming it doesn't change who may fill it; the chips and 🔎 filter do that."
                  className="mono" style={{ fontFamily: 'inherit', fontSize: 11, padding: '3px 6px', background: 'var(--bg)', color: sp.label ? 'var(--text)' : 'var(--faint)', border: `1px solid ${sp.label ? 'var(--bd)' : 'transparent'}`, borderRadius: RADIUS, flex: 1, minWidth: 90, textAlign: 'right' }} />
                <button disabled={busy} title="Best ball: this spot fills itself with the top scorer"
                  onClick={() => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, bb: !x.bb, zero: x.bb ? x.zero : '' })); setSpotsDirty(true); }}
                  className="mono" style={{ ...pill(!!sp.bb), padding: '3px 8px', fontSize: 11 }}>🎯 BB</button>
                {/* THE ZERO-FILL RULE (v0.303.0): what this spot banks when it
                    is empty, or when whoever stands in it scores nothing.
                    Greyed out on a best-ball spot — that spot fills itself, so
                    "unfilled" is not a state it has, and the server refuses the
                    pair rather than storing half of it. */}
                <span title={sp.bb ? "a best-ball spot fills itself — it is never unfilled, so it can't carry this rule"
                  : 'ZERO-FILL: points this spot banks if it is empty, or if its player scores nothing. Blank = off.'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, opacity: sp.bb ? 0.35 : 1 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>⛳</span>
                  <input value={sp.zero} disabled={busy || !!sp.bb} inputMode="numeric" placeholder="—" maxLength={3}
                    onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 3); setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, zero: v })); setSpotsDirty(true); }}
                    className="mono" style={{ fontFamily: 'inherit', fontSize: 11, width: 34, textAlign: 'center', padding: '3px 4px', background: 'var(--bg)', color: sp.zero ? 'var(--warn)' : 'var(--faint)', border: `1px solid ${sp.zero ? 'var(--warn)' : 'var(--bd)'}`, borderRadius: RADIUS }} />
                </span>
                <button disabled={busy} title="Per-spot player filter: only these teams / this tenure window / these flagged players may fill the spot"
                  onClick={() => setFltOpen((cur) => cur === i ? null : i)}
                  className="mono" style={{ ...pill(spotHasFlt(sp)), padding: '3px 8px', fontSize: 11 }}>🔎</button>
                <button disabled={busy || spots.length <= 1} title="Remove this spot"
                  onClick={() => { setSpots((cur) => cur!.filter((_, j) => j !== i)); setSpotsDirty(true); }}
                  className="mono" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--opp)', fontSize: 13.5, padding: '0 3px' }}>✕</button>
                {/* PER-SLOT FILTER (0172): who may FILL this spot — teams and/or a
                    tenure window (0 = rookie). Never shrinks the draft pool. */}
                {fltOpen === i && (
                  <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <input value={sp.fTeams} onChange={(e) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fTeams: e.target.value })); setSpotsDirty(true); }}
                      placeholder="teams (e.g. KC, SF) — empty = all"
                      className="mono" style={{ fontFamily: 'inherit', fontSize: 12, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, flex: '1 1 160px' }} />
                    <input value={sp.fMin} onChange={(e) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fMin: e.target.value })); setSpotsDirty(true); }}
                      placeholder="min yrs" inputMode="numeric"
                      className="mono" style={{ fontFamily: 'inherit', fontSize: 12, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 68 }} />
                    <input value={sp.fMax} onChange={(e) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fMax: e.target.value })); setSpotsDirty(true); }}
                      placeholder="max yrs" inputMode="numeric"
                      className="mono" style={{ fontFamily: 'inherit', fontSize: 12, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 68 }} />
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>rookies only → max 0 · SAVE LINEUP applies</span>
                    {/* FLAGS AS A CONDITION (v0.300.0, founder: "allow flags as
                        a condition for position filters"). Only shown once the
                        league has flags to pick — an empty row would read like
                        a broken control. */}
                    {flagLabels.length > 0 && (
                      <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>⚑ FLAGGED</span>
                        {flagLabels.map((fl) => {
                          const on = sp.fFlags.some((x) => x.toLowerCase() === fl.toLowerCase());
                          return (
                            <button key={fl} disabled={busy}
                              onClick={() => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fFlags: on ? x.fFlags.filter((y) => y.toLowerCase() !== fl.toLowerCase()) : [...x.fFlags, fl] })); setSpotsDirty(true); }}
                              className="mono" style={{ ...pill(on), padding: '3px 8px', fontSize: 11 }}>{fl}</button>
                          );
                        })}
                        {sp.fFlags.length > 0 && <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>only a flagged player may fill this spot</span>}
                      </div>
                    )}
                    <TeamChips value={sp.fTeams} disabled={busy}
                      onChange={(next) => { setSpots((cur) => cur!.map((x, j) => j !== i ? x : { ...x, fTeams: next })); setSpotsDirty(true); }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <button disabled={busy || spots.length >= 20}
              onClick={() => { setSpots((cur) => [...cur!, { pos: ['RB', 'WR', 'TE'], label: '', fTeams: '', fMin: '', fMax: '', fFlags: [], zero: '' }]); setSpotsDirty(true); }}
              className="mono" style={{ ...pill(false), padding: '4px 14px' }}>＋ ADD SPOT</button>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.5 }}>
              ⠿ drag (or focus + ↑/↓) to reorder · name a spot anything you like — the name is a label, the chips and 🔎 decide who may fill it · 🎯 BB spots fill themselves with the top scorer · ⛳ is the ZERO-FILL: points the spot banks if it's empty or its player scores nothing (blank = off; not available on a BB spot) · 🔎 limits who may fill the spot (teams / tenure / a commissioner flag — an RB spot for rookies only, or a spot only your franchise tag may stand in) · tenure filters need a pool re-seed so player experience is loaded · locks once the draft starts (after that you may only remove spots from the end — the escape hatch for a lineup bigger than the draft).
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            {/* THE TOTAL IS THE CEILING (0192). Each box used to stop at its own
                number — bench 20, taxi 8, IR 8 — which is why a deep dynasty
                ran out of room with rounds to spare. The draft's 5–99 window is
                the only real limit, so the ＋ stops when the SUM would leave
                it. */}
            {([['BENCH', 'bench'], ['TAXI', 'taxi'], ['IR', 'ir']] as const).map(([label, key]) => (
              <span key={key} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '4px 8px' }}>
                {label}
                <button onClick={() => void saveShape({ ...shape, [key]: Math.max(0, shape[key] - 1) })} disabled={busy || shape[key] === 0} className="mono" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12.5 }}>−</button>
                <span style={{ minWidth: 12, textAlign: 'center', color: 'var(--you)' }}>{shape[key]}</span>
                <button onClick={() => void saveShape({ ...shape, [key]: shape[key] + 1 })} disabled={busy || shapeTotal >= MAX_ROUNDS} className="mono" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12.5 }}>＋</button>
              </span>
            ))}
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--you)' }}>
              {/* TWO NUMBERS SINCE 0193: the roster is what a team may HOLD,
                  the draft is what it FILLS. IR spots are the difference —
                  you stash into them in November, you don't draft into them. */}
              ROSTER = {rounds ?? shapeTotal} · DRAFT = {(rounds ?? shapeTotal) - shape.ir} ROUNDS{shape.ir > 0 ? ` (IR isn't drafted)` : ''}{shapeTotal >= MAX_ROUNDS ? ` · ${MAX_ROUNDS} IS THE MAX` : ''}

            {/* SPOTS CANNOT OUTRUN THE DRAFT (v0.233.0). Adding starting spots
                does not lengthen a draft that already has its rounds, so a
                league can end up with more spots than players — 13 spots and a
                12-round draft means nobody can field a legal lineup, and
                nothing said so until someone opened their empty last slot on
                game day. The number was already on screen; what was missing
                was the comparison. */}
            {rounds != null && spots.length > rounds && (
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--warn, #c66)', marginTop: 6, lineHeight: 1.5 }}>
                ⚠ {spots.length} starting spots but only {rounds} draft rounds — every team finishes {spots.length - rounds} player{spots.length - rounds === 1 ? '' : 's'} short of a legal lineup. Remove {spots.length - rounds} spot{spots.length - rounds === 1 ? '' : 's'}, or raise the roster size before the draft.
              </div>
            )}            </span>
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5 }}>
            You draft starters + bench + taxi, then stash. IR spots are extra room and are NOT drafted — you stash an injured player there in November, so they add to the roster without adding draft rounds. IR takes a real injury designation only; taxi and IR players can't be started.
          </div>

          {/* ── WHO MAY GO ON IR (0198) ──────────────────────────────────────
              Founder: "only injured guys can be put on IR (commish chooses
              eligible tags)". 0164 hardcoded IR/Out, which is one league's
              answer — some run season-ending IR only, some let Doubtful ride.
              The vocabulary is the injury report's own and nothing else. */}
          {shape.ir > 0 && irTags && (
            <div style={{ marginTop: 10, border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '8px 10px' }}>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>🏥 IR ELIGIBILITY · which designations may be stashed</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
                {([['IR', 'IR (season-ending)'], ['O', 'OUT'], ['D', 'DOUBTFUL'], ['Q', 'QUESTIONABLE']] as const).map(([tag, label]) => (
                  <button key={tag} onClick={() => void toggleIrTag(tag)} disabled={busy} className="mono"
                    style={pill(irTags.includes(tag))}>{label}</button>
                ))}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
                A player with none of these — including a healthy one — can't be put on IR by anyone, YOU included: this is a fact about the player, not a deadline. A player already stashed stays put when you narrow the list; he just can't go back on once he's off.
              </div>
            </div>
          )}

          {/* ── THE TAXI SQUAD'S RULES (0196) ────────────────────────────────
              Who may ride it and when it shuts. Beside the SIZE, because a
              taxi squad is those three facts and nothing else — and unlike the
              shape, these move at ANY time: a commissioner reopening the taxi
              in November is answering a November question. */}
          {shape.taxi > 0 && taxi && (
            <div style={{ marginTop: 10, border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '8px 10px' }}>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>🚕 TAXI SQUAD · who may ride it, and when it shuts</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>TENURE</span>
                {([[null, 'ANYONE'], [0, 'ROOKIES'], [1, '≤ 1 YR'], [2, '≤ 2 YRS'], [3, '≤ 3 YRS']] as const).map(([v, label]) => (
                  <button key={label} onClick={() => void saveTaxi(v ?? -1, null)} disabled={busy} className="mono"
                    style={pill(taxi.maxExp === v)}>{label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>LOCK</span>
                <button onClick={() => void saveTaxi(null, true)} disabled={busy} className="mono" style={pill(taxi.lock)}>AT WEEK 1 KICKOFF</button>
                <button onClick={() => void saveTaxi(null, false)} disabled={busy} className="mono" style={pill(!taxi.lock)}>NEVER</button>
                {taxi.lockedNow && <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--warn)' }}>🔒 LOCKED NOW</span>}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
                A locked taxi squad refuses new arrivals; taking a player OFF it is always allowed, and YOU can move players either way at any time. A player whose experience Sleeper doesn't know can't prove he qualifies, so a tenure rule excludes him.
              </div>
            </div>
          )}
          {extraPos.length > 0 && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--you)', marginTop: 4 }}>
              UNLOCKED FOR THIS LEAGUE: {extraPos.join(' · ')} — after changing spots or filters, hit ↻ REFRESH PLAYER POOL (league page) so the draft pool matches.
            </div>
          )}
          {/* PLAYER FILTERS (0171): who is ALLOWED in this league's pool — a team
              whitelist and/or a tenure window (0 = rookie). Applies when the pool
              is (re)seeded; locks at the draft like everything else. */}
          <div style={{ marginTop: 10, border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '8px 10px' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 700 }}>🔎 PLAYER FILTERS · who's allowed in the pool</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <input value={fltTeams} onChange={(e) => setFltTeams(e.target.value)} placeholder="teams (e.g. KC, SF, BUF) — empty = all"
                className="mono" style={{ fontFamily: 'inherit', fontSize: 12.5, padding: '5px 7px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, flex: '1 1 220px' }} />
              <input value={fltMin} onChange={(e) => setFltMin(e.target.value)} placeholder="min yrs" inputMode="numeric"
                className="mono" style={{ fontFamily: 'inherit', fontSize: 12.5, padding: '5px 7px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 74 }} />
              <input value={fltMax} onChange={(e) => setFltMax(e.target.value)} placeholder="max yrs" inputMode="numeric"
                className="mono" style={{ fontFamily: 'inherit', fontSize: 12.5, padding: '5px 7px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: RADIUS, width: 74 }} />
              <button onClick={() => void saveFilter()} disabled={busy} className="mono" style={pill(true)}>SAVE FILTER</button>
              <button onClick={() => void saveFilter(true)} disabled={busy} className="mono" style={pill(false)}>CLEAR</button>
              <TeamChips value={fltTeams} disabled={busy} onChange={setFltTeams} />
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5 }}>
              Rookies only → max 0. Vets with 8+ years → min 8. One-team league → list the team. Players whose tenure Sleeper doesn't know are excluded while a tenure filter is set. Filters bite when the pool is (re)seeded — pre-draft only.
            </div>
          </div>
        </div>
        );
      })()}
      {view === 'scoring' && (
        <div>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>
            ⚖ SCORING <span style={{ fontWeight: 400 }}>every value is yours to set · changed values light up</span>
          </div>
          {/* PRESETS (v0.213.1): the recognised starting points, so a standard
              league is one click instead of 155 decisions. Each one resets the
              catalog and applies its own deltas, and carries the receptions
              setting that used to be a separate control on GAME MODE. */}
          {mode === 'classic' && (
            <div style={{ marginTop: 8, border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>START FROM</span>
                {SCORING_PRESETS.map((p) => (
                  <button key={p.id} onClick={() => void applyPreset(p)} disabled={busy} title={p.hint}
                    className="mono" style={{ ...pill(armed === p.id), padding: '4px 11px' }}>
                    {armed === p.id ? `CONFIRM ${p.label}` : p.label}
                  </button>
                ))}
                <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 'auto' }}>
                  RECEPTIONS: <span style={{ color: 'var(--you)', fontWeight: 700 }}>{ppr === 1 ? 'FULL PPR' : ppr === 0.5 ? '½ PPR' : 'NON-PPR'}</span>
                </span>
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5, lineHeight: 1.5 }}>
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
                  <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)', marginBottom: 4 }}>{sec.section}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))', gap: 6 }}>
                    {sec.fields.map((f) => {
                      const changed = Number(scDraft[f.key]) !== DEFAULT_CLASSIC_SCORING[f.key];
                      return (
                        <label key={f.key} className="mono" style={{ fontSize: 10, fontWeight: 700, color: changed ? 'var(--you)' : 'var(--faint)', display: 'grid', gap: 3 }}>
                          {f.label}{f.perYard ? ' /YD' : ''}
                          <input value={scDraft[f.key] ?? ''} inputMode="decimal"
                            onChange={(e) => setScDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                            style={{ fontFamily: 'inherit', fontSize: 13.5, padding: '5px 6px', background: 'var(--bg)', color: 'var(--text)', border: `1px solid ${changed ? 'var(--you)' : 'var(--bd)'}`, borderRadius: RADIUS, width: '100%', boxSizing: 'border-box' }} />
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
            : <div className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>Loading…</div>}
        </div>
      )}
      {note && <div className="mono" style={{ fontSize: 11.5, color: note.startsWith('✓') ? 'var(--faint)' : 'var(--warn, #c66)', marginTop: 8 }}>{note}</div>}
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
        <div className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>◈ REAL-TIME POWER-UPS</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
          The armed live buffs — overtime, momentum, amps, counters. Off blocks new arms league-wide; already-armed buffs stay reclaimable.
        </div>
      </div>
      <button onClick={() => void flip()} disabled={on === null || busy} className="mono"
        style={{ fontSize: 12.5, fontWeight: 700, borderRadius: RADIUS, padding: '7px 16px', cursor: 'pointer', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, opacity: on === null || busy ? 0.5 : 1, flexShrink: 0 }}>
        {on === null ? '…' : on ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

/** ── ✕ DELETE LEAGUE (0188) ──────────────────────────────────────────────
 *
 *  The commissioner's own way out. `admin_delete_league` has existed since 0044
 *  with the comment "commissioners cannot nuke a league"; 0188 is the deliberate
 *  loosening of that, and it pays for it with a TYPED CONFIRMATION rather than a
 *  second click. A two-click confirm is right for a drop — one player, one seat,
 *  recoverable by re-adding him. This ends a league for everybody in it, and the
 *  cascade takes the matchups, rosters, wallets and register with it. Typing the
 *  name is the only friction proportional to that.
 *
 *  The rule itself is server-side (case and inner whitespace forgiving); this
 *  panel only declines to send an obviously-empty one, so there is one place
 *  where "is this confirmed" is decided. */
function DeleteLeaguePanel({ leagueId, name, seats, onDeleted }: {
  leagueId: string; name: string; seats: number; onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (busy || !typed.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await commishDeleteLeague(leagueId, typed);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'that didn’t work')); return; }
      onDeleted();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: '1px solid var(--opp)', borderRadius: 8, padding: 14, marginTop: 10 }}>
      <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--opp)' }}>THIS CANNOT BE UNDONE</div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', lineHeight: 1.6, marginTop: 8 }}>
        Deleting “{name}” removes it for everyone in it — {seats} seat{seats === 1 ? '' : 's'} — along with every roster,
        matchup, lineup, wallet and transaction it holds. There is no restore.
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 10 }}>Type the league name to confirm: {name}</div>
      <input value={typed} onChange={(ev) => setTyped(ev.target.value)} placeholder={name} className="mono"
        style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--text)', fontSize: 11, padding: '9px 10px', outline: 'none' }} />
      {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginTop: 8, lineHeight: 1.5 }}>{err}</div>}
      <button onClick={go} disabled={busy || !typed.trim()} className="mono"
        style={{ width: '100%', marginTop: 10, background: 'none', border: '1px solid var(--opp)', borderRadius: 6, padding: '10px 0',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--opp)',
          cursor: busy || !typed.trim() ? 'default' : 'pointer', opacity: busy || !typed.trim() ? 0.4 : 1 }}>
        {busy ? 'DELETING…' : '✕ DELETE THIS LEAGUE FOREVER'}
      </button>
    </div>
  );
}
