// The commissioner kit's board-side surface (0141): the league-note banner and
// the two editors behind it.
//
// Edited ON THE BOARD, deliberately: the commissioner who needs these lives on
// the live board mid-slate, and a note that requires a trip to the admin
// dashboard is a note that doesn't get written. Members see the banner only
// while a note stands; the commissioner always sees a slim affordance so the
// tools are findable when there's nothing to say yet.
//
// Flag search runs over the baked Sleeper directory (PLAYER_BIO, ~5.3k active
// players incl. rookies) rather than a league pool — Sleeper leagues have no
// pool table client-side, and the commissioner may need to flag a player who
// isn't on any roster yet. Names are prettified slugs; close enough to find
// anyone, and the flag renders with the real name wherever the player appears.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { setLeagueNote, setPlayerFlag, setPlayerFlagsBulk, playerFlags, leagueNote, leagueScoringGet, leagueScoringSet, friendlyError, type PlayerFlagRow, type FlagRulesRaw } from '@drip/core/data/liveApi';
import { SCORING_BOUNDS, DEFAULT_SCORING, scoringIsDefault, scoringLabel, scopedRuleLabel, parseScoring, type LeagueScoring, type ScopedBonus } from '@drip/core/engine/leagueScoring';
import { PLAYER_BIO } from '@drip/core/data/playerBio';
import { headshot } from '@drip/core/data/media';
import { ModalBackdrop, Img } from './ui';

const FLAG_PURPLE = '#A87BD8';
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, width: '100%', maxWidth: 420, maxHeight: '80vh', overflowY: 'auto', boxSizing: 'border-box' };
const input: React.CSSProperties = { fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 5, padding: '9px 11px', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 5, padding: '9px 14px', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { ...btn, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer', padding: '2px 4px' };

const prettify = (slug: string) =>
  slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

// Directory-filter axes for bulk flagging + scoped bonuses (0145): position
// and team straight off the bio bake, tenure from accrued seasons.
const FILTER_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const TENURES = [
  { id: 'rookie', label: 'ROOKIES' },
  { id: 'y2_3', label: '2ND–3RD YR' },
  { id: 'vet4', label: 'VETS 4+' },
] as const;
const ALL_TEAMS: string[] = [...new Set(Object.values(PLAYER_BIO).map((b) => b.team).filter((t): t is string => !!t))].sort();
const tenureMatch = (exp: number | undefined, ten: string): boolean => {
  if (exp == null) return false;
  if (ten === 'rookie') return exp === 0;
  if (ten === 'y2_3') return exp >= 1 && exp <= 2;
  return exp >= 3;
};

/** The banner + its editors. Renders nothing off the live board; renders
 *  nothing for members while no note stands. */
export function CommishNoteBanner() {
  const { liveCtx, liveNote, liveScoring, reloadCommish } = useStore();
  const [noteOpen, setNoteOpen] = useState(false);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  if (!liveCtx || !liveNote) return null;
  const { text, canEdit } = liveNote;
  const scoringOn = liveScoring != null && !scoringIsDefault(liveScoring);
  if (!text && !canEdit && !scoringOn) return null;
  return (
    <>
      <div className="mono" style={{ marginTop: 7, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 10.5, lineHeight: 1.5, color: 'var(--text)', background: `color-mix(in srgb, ${FLAG_PURPLE} 10%, var(--surface))`, border: `1px solid ${FLAG_PURPLE}`, borderRadius: 6, padding: '7px 11px' }}>
        <span style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: 9, color: FLAG_PURPLE, flex: 'none' }}>⚑ LEAGUE NOTE</span>
        {text
          ? <span style={{ minWidth: 0, flex: '1 1 200px', whiteSpace: 'pre-wrap' }}>{text}</span>
          : <span style={{ color: 'var(--faint)', flex: '1 1 200px' }}>{canEdit ? 'nothing posted — say something to the league' : ''}</span>}
        {/* Non-default scoring is ALWAYS visible to every member — nobody
            should discover a turnover penalty from a score dropping. */}
        {scoringOn && (
          <span title="commissioner scoring adjustments in force — every matchup in this league scores with these"
            style={{ flex: 'none', fontWeight: 700, fontSize: 9.5, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '2px 7px' }}>
            ⚖ {scoringLabel(liveScoring)}
          </span>
        )}
        {canEdit && (
          <span style={{ display: 'inline-flex', gap: 6, flex: 'none', marginLeft: 'auto' }}>
            <button onClick={() => setNoteOpen(true)} className="mono" style={linkBtn}>✎ {text ? 'edit' : 'write'}</button>
            <button onClick={() => setFlagsOpen(true)} className="mono" style={linkBtn}>⚑ player flags</button>
            <button onClick={() => setScoringOpen(true)} className="mono" style={linkBtn}>⚖ scoring</button>
          </span>
        )}
      </div>
      {noteOpen && (
        <NoteEditor leagueId={liveCtx.leagueId} initial={text ?? ''}
          onDone={() => { setNoteOpen(false); void reloadCommish(); }}
          onClose={() => setNoteOpen(false)} />
      )}
      {flagsOpen && (
        <FlagsEditor leagueId={liveCtx.leagueId}
          onChanged={() => void reloadCommish()}
          onClose={() => setFlagsOpen(false)} />
      )}
      {scoringOpen && liveScoring && (
        <ScoringEditor leagueId={liveCtx.leagueId} initial={liveScoring}
          onDone={() => { setScoringOpen(false); void reloadCommish(); }}
          onClose={() => setScoringOpen(false)} />
      )}
    </>
  );
}

/** The same three tools, as a DASHBOARD panel (founder's ask: the board
 *  banner stays, but the commissioner's desk gets them too). Self-loading by
 *  leagueId — no live board or store required, so CommishDash / AdminPage can
 *  mount it for any league. Edits here reach open boards on their next poll. */
export function CommishToolsPanel({ leagueId }: { leagueId: string }) {
  const [note, setNote] = useState<{ text: string | null; canEdit: boolean } | null>(null);
  const [scoring, setScoring] = useState<LeagueScoring | null>(null);
  const [flags, setFlags] = useState<PlayerFlagRow[] | null>(null);
  const [openTool, setOpenTool] = useState<null | 'note' | 'flags' | 'scoring'>(null);
  const load = async () => {
    const [n, f, sc] = await Promise.all([
      leagueNote(leagueId).catch(() => null),
      playerFlags(leagueId).catch(() => null),
      leagueScoringGet(leagueId).catch(() => null),
    ]);
    if (n && n.ok) setNote({ text: n.text ?? null, canEdit: !!n.can_edit });
    if (Array.isArray(f)) setFlags(f);
    if (sc && sc.ok) setScoring(parseScoring(sc));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const section: React.CSSProperties = { border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };
  const sHdr: React.CSSProperties = { fontSize: 9, letterSpacing: '0.12em', color: FLAG_PURPLE, fontWeight: 700, flex: 'none' };
  const editBtn = (tool: 'note' | 'flags' | 'scoring', label: string) => (
    <button onClick={() => setOpenTool(tool)} className="mono" style={{ ...ghostBtn, padding: '5px 10px', fontSize: 9, marginLeft: 'auto', flex: 'none' }}>{label}</button>
  );
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5 }}>
        The commissioner's kit — the same tools as the live board's ⚑ banner. Everything here is league-visible; scoring and flag rules apply from the worker's next tick.
      </div>
      <div style={section}>
        <span className="mono" style={sHdr}>⚑ LEAGUE NOTE</span>
        <span className="mono" style={{ fontSize: 10.5, color: note?.text ? 'var(--text)' : 'var(--faint)', flex: '1 1 200px', minWidth: 0, whiteSpace: 'pre-wrap' }}>
          {note == null ? 'loading…' : note.text ?? 'nothing posted'}
        </span>
        {editBtn('note', note?.text ? '✎ EDIT' : '✎ WRITE')}
      </div>
      <div style={section}>
        <span className="mono" style={sHdr}>⚑ PLAYER FLAGS</span>
        <span className="mono" style={{ fontSize: 10.5, color: flags?.length ? 'var(--text)' : 'var(--faint)', flex: '1 1 200px', minWidth: 0 }}>
          {flags == null ? 'loading…'
            : flags.length === 0 ? 'none'
            : flags.slice(0, 4).map((f) => `${prettify(f.slug)} (${f.label}${ruleGlyphs(f.rules) ? ` ${ruleGlyphs(f.rules)}` : ''})`).join(' · ') + (flags.length > 4 ? ` · +${flags.length - 4} more` : '')}
        </span>
        {editBtn('flags', '⚑ MANAGE')}
      </div>
      <div style={section}>
        <span className="mono" style={sHdr}>⚖ SCORING</span>
        <span className="mono" style={{ fontSize: 10.5, color: scoring && !scoringIsDefault(scoring) ? 'var(--warn)' : 'var(--faint)', flex: '1 1 200px', minWidth: 0 }}>
          {scoring == null ? 'loading…' : scoringIsDefault(scoring) ? 'base rules — no adjustments' : scoringLabel(scoring)}
        </span>
        {editBtn('scoring', '⚖ ADJUST')}
      </div>
      {openTool === 'note' && note && (
        <NoteEditor leagueId={leagueId} initial={note.text ?? ''}
          onDone={() => { setOpenTool(null); void load(); }} onClose={() => setOpenTool(null)} />
      )}
      {openTool === 'flags' && (
        <FlagsEditor leagueId={leagueId} onChanged={() => void load()} onClose={() => { setOpenTool(null); void load(); }} />
      )}
      {openTool === 'scoring' && scoring && (
        <ScoringEditor leagueId={leagueId} initial={scoring}
          onDone={() => { setOpenTool(null); void load(); }} onClose={() => setOpenTool(null)} />
      )}
    </div>
  );
}

function ScoringEditor({ leagueId, initial, onDone, onClose }: {
  leagueId: string; initial: LeagueScoring; onDone: () => void; onClose: () => void;
}) {
  const [td, setTd] = useState(initial.tdBonus);
  const [yd, setYd] = useState(initial.ydMult);
  const [to, setTo] = useState(initial.toPenalty);
  const [scoped, setScoped] = useState<ScopedBonus[]>(initial.scoped ?? []);
  // draft rule being built in the ADD row
  const [dPos, setDPos] = useState<Set<string>>(new Set());
  const [dTeam, setDTeam] = useState('ALL');
  const [dTen, setDTen] = useState('ALL');
  const [dMult, setDMult] = useState(1);
  const [dPts, setDPts] = useState(0);
  const [dTd, setDTd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toWire = (r: ScopedBonus) => ({
    ...(r.pos?.length ? { pos: r.pos } : {}),
    ...(r.team?.length ? { team: r.team } : {}),
    ...(r.tenure ? { tenure: r.tenure } : {}),
    ...(r.bonusMult != null ? { bonus_mult: r.bonusMult } : {}),
    ...(r.bonusPts != null ? { bonus_pts: r.bonusPts } : {}),
    ...(r.tdBonus != null ? { td_bonus: r.tdBonus } : {}),
  });
  const addRule = () => {
    if (dMult === 1 && dPts === 0 && dTd === 0) { setErr('Give the rule a value — a multiplier, flat points, or a TD bonus.'); return; }
    if (scoped.length >= 12) { setErr('At most 12 scoped rules.'); return; }
    setErr(null);
    setScoped([...scoped, {
      ...(dPos.size ? { pos: [...dPos] } : {}),
      ...(dTeam !== 'ALL' ? { team: [dTeam] } : {}),
      ...(dTen !== 'ALL' ? { tenure: dTen as ScopedBonus['tenure'] } : {}),
      ...(dMult !== 1 ? { bonusMult: dMult } : {}),
      ...(dPts !== 0 ? { bonusPts: dPts } : {}),
      ...(dTd !== 0 ? { tdBonus: dTd } : {}),
    }]);
    setDPos(new Set()); setDTeam('ALL'); setDTen('ALL'); setDMult(1); setDPts(0); setDTd(0);
  };
  const save = async (tdV: number, ydV: number, toV: number, scopedV: ScopedBonus[] = scoped) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await leagueScoringSet(leagueId, tdV, Math.round(ydV * 10) / 10, toV, scopedV.map(toWire));
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not save.')); return; }
      onDone();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const stepper = (label: string, hint: string, v: number, set: (n: number) => void,
    b: { min: number; max: number; step: number }, fmt: (n: number) => string) => (
    <div style={{ marginTop: 12 }}>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <button onClick={() => set(Math.round(Math.max(b.min, v - b.step) * 10) / 10)} className="mono" style={{ ...ghostBtn, padding: '6px 12px' }}>−</button>
        <span className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', minWidth: 52, textAlign: 'center' }}>{fmt(v)}</span>
        <button onClick={() => set(Math.round(Math.min(b.max, v + b.step) * 10) / 10)} className="mono" style={{ ...ghostBtn, padding: '6px 12px' }}>＋</button>
        <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.4, flex: 1 }}>{hint}</span>
      </div>
    </div>
  );
  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>⚖ League scoring</div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 4, lineHeight: 1.5 }}>
          Adjustments layer on the base game — the metric catalog stays as written; these apply on top, to every matchup in this league. Every member sees them on their board. Changing them mid-week changes how the current week scores from the next tick.
        </div>
        {stepper('TD BONUS', 'extra points on every touchdown your players score (defensive TDs included)', td, setTd, SCORING_BOUNDS.tdBonus, (n) => `${n > 0 ? '+' : ''}${n}`)}
        {stepper('YARDAGE MULTIPLIER', 'scales all per-yard scoring AND drip-rate growth', yd, setYd, SCORING_BOUNDS.ydMult, (n) => `×${n}`)}
        {stepper('TURNOVER PENALTY', 'points removed from a player’s own bank on an INT thrown / fumble lost (never below zero)', to, setTo, SCORING_BOUNDS.toPenalty, (n) => (n === 0 ? 'off' : `−${n}`))}

        {/* SCOPED BONUSES (0145): the founder's "team, position, tenure"
            filters — rules that pay only players matching the scope. */}
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginTop: 16, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>SCOPED BONUSES</div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
          Bonuses for players matching a position / team / tenure scope. Rules stack — multipliers multiply, points sum.
        </div>
        {scoped.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 700, flex: 1, minWidth: 0 }}>⚖ {scopedRuleLabel(r)}</span>
            <button onClick={() => setScoped(scoped.filter((_, j) => j !== i))} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          {FILTER_POS.map((p) => {
            const on = dPos.has(p);
            return (
              <button key={p} onClick={() => setDPos((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; })} className="mono"
                style={{ fontSize: 8.5, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 8px', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}` }}>{p}</button>
            );
          })}
          <select value={dTeam} onChange={(e) => setDTeam(e.target.value)} className="mono"
            style={{ fontSize: 9.5, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 5, padding: '3px 6px' }}>
            <option value="ALL">ANY TEAM</option>
            {ALL_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {TENURES.map((t) => (
            <button key={t.id} onClick={() => setDTen(dTen === t.id ? 'ALL' : t.id)} className="mono"
              style={{ fontSize: 8.5, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 8px', color: dTen === t.id ? 'var(--on-accent)' : 'var(--dim)', background: dTen === t.id ? 'var(--warn)' : 'var(--bg)', border: `1px solid ${dTen === t.id ? 'var(--warn)' : 'var(--bd)'}` }}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>
          <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>PTS ×</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setDMult(Math.round(Math.max(0.5, dMult - 0.1) * 10) / 10)} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>−</button>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, minWidth: 30, textAlign: 'center', color: dMult !== 1 ? 'var(--warn)' : 'var(--dim)' }}>×{dMult}</span>
            <button onClick={() => setDMult(Math.round(Math.min(3, dMult + 0.1) * 10) / 10)} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>＋</button>
          </span>
          <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>BONUS</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setDPts(Math.max(-10, dPts - 1))} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>−</button>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, minWidth: 26, textAlign: 'center', color: dPts !== 0 ? 'var(--warn)' : 'var(--dim)' }}>{dPts > 0 ? '+' : ''}{dPts}</span>
            <button onClick={() => setDPts(Math.min(10, dPts + 1))} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>＋</button>
          </span>
          <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>TD</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setDTd(Math.max(-3, dTd - 1))} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>−</button>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, minWidth: 26, textAlign: 'center', color: dTd !== 0 ? 'var(--warn)' : 'var(--dim)' }}>{dTd > 0 ? '+' : ''}{dTd}</span>
            <button onClick={() => setDTd(Math.min(6, dTd + 1))} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>＋</button>
          </span>
          <button onClick={addRule} className="mono" style={{ ...ghostBtn, padding: '4px 10px', fontSize: 9 }}>＋ ADD RULE</button>
        </div>

        {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => save(td, yd, to)} disabled={busy} className="mono" style={{ ...btn, flex: 1, opacity: busy ? 0.5 : 1 }}>SAVE</button>
          <button onClick={() => save(DEFAULT_SCORING.tdBonus, DEFAULT_SCORING.ydMult, DEFAULT_SCORING.toPenalty, [])} disabled={busy} className="mono" style={{ ...ghostBtn }}>RESET TO BASE</button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}><button onClick={onClose} className="mono" style={linkBtn}>cancel</button></div>
      </div>
    </ModalBackdrop>
  );
}

function NoteEditor({ leagueId, initial, onDone, onClose }: {
  leagueId: string; initial: string; onDone: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (text: string | null) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await setLeagueNote(leagueId, text);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not save the note.')); return; }
      onDone();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>⚑ League note</div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 4, lineHeight: 1.5 }}>
          One standing announcement, shown to every member on their board. Saving replaces the old note.
        </div>
        <textarea value={draft} autoFocus maxLength={500} rows={4} onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Practice week is open — set your boards by Friday 6PM ET."
          style={{ ...input, marginTop: 10, resize: 'vertical', fontFamily: 'inherit' }} />
        {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => save(draft)} disabled={busy || !draft.trim()} className="mono" style={{ ...btn, flex: 1, opacity: busy || !draft.trim() ? 0.5 : 1 }}>SAVE NOTE</button>
          {initial && <button onClick={() => save(null)} disabled={busy} className="mono" style={{ ...ghostBtn, color: 'var(--opp)' }}>CLEAR</button>}
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}><button onClick={onClose} className="mono" style={linkBtn}>cancel</button></div>
      </div>
    </ModalBackdrop>
  );
}

// Rule controls shared by single-flag and bulk editing (0144): five toggle
// chips + the two bonus steppers. Rules LAYER like everything commish —
// the server sanitizes again, this just mirrors its bounds.
const RULE_DEFS: { key: keyof FlagRulesRaw; label: string; hint: string }[] = [
  { key: 'no_trade', label: '🚫⇄ trade', hint: 'cannot be traded' },
  { key: 'no_add', label: '🚫＋ add', hint: 'cannot be added / claimed' },
  { key: 'no_start', label: '🚫▶ start', hint: 'cannot be fielded' },
  { key: 'no_powerups', label: '🚫◈ powerups', hint: 'no powerup may target his slot' },
  { key: 'immune', label: '🛡 immune', hint: 'opponent attacks cannot touch him' },
];
export const ruleGlyphs = (r?: FlagRulesRaw | null): string => {
  if (!r) return '';
  const g: string[] = [];
  if (r.no_trade) g.push('🚫⇄'); if (r.no_add) g.push('🚫＋'); if (r.no_start) g.push('🚫▶');
  if (r.no_powerups) g.push('🚫◈'); if (r.immune) g.push('🛡');
  if (r.bonus_mult != null && r.bonus_mult !== 1) g.push(`×${r.bonus_mult}`);
  if (r.bonus_pts != null && r.bonus_pts !== 0) g.push(`${r.bonus_pts > 0 ? '+' : ''}${r.bonus_pts}`);
  return g.join(' ');
};

/** A flag's label, derived from its rules — so "pick rules, hit FLAG" works
 *  without inventing a name (the second playtest stall on the label field).
 *  Null when there are no rules to name it by: a flag must say or do
 *  SOMETHING, since a label-less save is the delete gesture server-side. */
export const autoLabel = (r?: FlagRulesRaw | null): string | null => {
  if (!r) return null;
  const parts: string[] = [];
  if (r.no_trade) parts.push('no trades'); if (r.no_add) parts.push('no adds'); if (r.no_start) parts.push('no starts');
  if (r.no_powerups) parts.push('no powerups'); if (r.immune) parts.push('immune');
  if (r.bonus_mult != null && r.bonus_mult !== 1) parts.push(`×${r.bonus_mult} pts`);
  if (r.bonus_pts != null && r.bonus_pts !== 0) parts.push(`${r.bonus_pts > 0 ? '+' : ''}${r.bonus_pts} pts`);
  return parts.length ? parts.join(' · ').slice(0, 40) : null;
};

function RuleControls({ draft, set }: { draft: FlagRulesRaw; set: (r: FlagRulesRaw) => void }) {
  const mini = (v: number, dflt: number, min: number, max: number, step: number, key: 'bonus_mult' | 'bonus_pts', fmt: (n: number) => string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button onClick={() => set({ ...draft, [key]: Math.round(Math.max(min, v - step) * 10) / 10 })} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>−</button>
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, minWidth: 30, textAlign: 'center', color: v !== dflt ? 'var(--warn)' : 'var(--dim)' }}>{fmt(v)}</span>
      <button onClick={() => set({ ...draft, [key]: Math.round(Math.min(max, v + step) * 10) / 10 })} className="mono" style={{ ...ghostBtn, padding: '2px 7px', fontSize: 9 }}>＋</button>
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      {RULE_DEFS.map((d) => {
        const on = draft[d.key] === true;
        return (
          <button key={d.key} onClick={() => set({ ...draft, [d.key]: on ? undefined : true })} title={d.hint} className="mono"
            style={{ fontSize: 8.5, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 8px', color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? FLAG_PURPLE : 'var(--bg)', border: `1px solid ${on ? FLAG_PURPLE : 'var(--bd)'}` }}>
            {d.label}
          </button>
        );
      })}
      <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>PTS ×</span>
      {mini(draft.bonus_mult ?? 1, 1, 0.5, 3, 0.1, 'bonus_mult', (n) => `×${n}`)}
      <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>BONUS</span>
      {mini(draft.bonus_pts ?? 0, 0, -10, 10, 1, 'bonus_pts', (n) => `${n > 0 ? '+' : ''}${n}`)}
    </div>
  );
}

function FlagsEditor({ leagueId, onChanged, onClose }: {
  leagueId: string; onChanged: () => void; onClose: () => void;
}) {
  const [rows, setRows] = useState<PlayerFlagRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [rulesDraft, setRulesDraft] = useState<FlagRulesRaw>({});
  // BULK (0144): multi-select over the search results, one label + one rule
  // set applied in a single call — the founder's "individually or in bulk
  // with a filter". The filter IS the search box (plus your eyes).
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = () => playerFlags(leagueId).then((r) => { if (Array.isArray(r)) setRows(r); }).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  // Bulk filters (playtest finding): position / team / tenure narrow the
  // directory alongside (or instead of) the search box.
  const [fPos, setFPos] = useState<string>('ALL');
  const [fTeam, setFTeam] = useState<string>('ALL');
  const [fTen, setFTen] = useState<string>('ALL');
  const filtersOn = fPos !== 'ALL' || fTeam !== 'ALL' || fTen !== 'ALL';
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2 && !(bulk && filtersOn)) return [];
    const out: string[] = [];
    for (const [slug, b] of Object.entries(PLAYER_BIO)) {
      if (needle.length >= 2 && !slug.replace(/-/g, ' ').includes(needle)) continue;
      if (bulk) {
        if (fPos !== 'ALL' && b.pos !== fPos) continue;
        if (fTeam !== 'ALL' && b.team !== fTeam) continue;
        if (fTen !== 'ALL' && !tenureMatch(b.exp, fTen)) continue;
      }
      out.push(slug);
      if (out.length >= (bulk ? 500 : 12)) break;
    }
    return out;
  }, [q, bulk, fPos, fTeam, fTen, filtersOn]);

  const save = async (slug: string, label: string | null, rules: FlagRulesRaw = {}) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await setPlayerFlag(leagueId, slug, label, rules);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not save the flag.')); return; }
      setLabelFor(null); setLabelDraft(''); setRulesDraft({}); setQ('');
      await load(); onChanged();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  const saveBulk = async () => {
    if (busy || !selected.size) return;
    // Empty label + rules set → the rules name the flag (autoLabel). Only a
    // flag with nothing to say at all is refused.
    const lbl = labelDraft.trim() || autoLabel(rulesDraft);
    if (!lbl) { setErr('Give the flag a label or a rule — the label is what the league sees on every chip.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await setPlayerFlagsBulk(leagueId, [...selected], lbl, rulesDraft);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not save the flags.')); return; }
      setSelected(new Set()); setLabelDraft(''); setRulesDraft({}); setQ(''); setBulk(false);
      await load(); onChanged();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };
  // BULK REMOVE (playtest ask): the same RPC with a null label — its delete
  // gesture — chunked to the 500-slug cap so "clear all" survives any count.
  const unflag = async (slugs: string[]) => {
    if (busy || !slugs.length) return;
    setBusy(true); setErr(null);
    try {
      for (let i = 0; i < slugs.length; i += 500) {
        const r = await setPlayerFlagsBulk(leagueId, slugs.slice(i, i + 500), null);
        if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not remove the flags.')); return; }
      }
      setSelected(new Set());
      await load(); onChanged();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const labelInput = (slug: string) => {
    const effective = labelDraft.trim() || autoLabel(rulesDraft);
    return (
      <div style={{ flex: '1 1 100%', marginTop: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={labelDraft} autoFocus maxLength={40} onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && effective) void save(slug, effective, rulesDraft); if (e.key === 'Escape') setLabelFor(null); }}
            placeholder="keeper · out for season · ineligible…" style={{ ...input, padding: '5px 8px', fontSize: 11 }} />
          <button onClick={() => effective && void save(slug, effective, rulesDraft)} disabled={busy || !effective}
            className="mono" style={{ ...btn, padding: '5px 10px', fontSize: 9 }}>SET</button>
        </div>
        <RuleControls draft={rulesDraft} set={setRulesDraft} />
      </div>
    );
  };

  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, maxWidth: 470 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', flex: 1 }}>⚑ Player flags</div>
          <button onClick={() => { setBulk((v) => !v); setSelected(new Set()); setLabelFor(null); }} className="mono" style={{ ...ghostBtn, padding: '4px 9px', fontSize: 9, color: bulk ? 'var(--warn)' : 'var(--text)' }}>
            {bulk ? '✓ BULK ON' : '⧉ BULK'}
          </button>
        </div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 4, lineHeight: 1.5 }}>
          A label the whole league sees — and RULES that bite: block trades/adds/starts/powerups, grant immunity, or pay a scoring bonus (docs in the chip tooltips). Rules apply from the next tick.
        </div>
        {/* bulk errors render at the BUTTON, not up here — up here they sit
            scrolled out of view above a 500-row list, and a click that only
            writes an invisible error reads as a dead button. */}
        {!bulk && err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8 }}>{err}</div>}

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700 }}>CURRENT FLAGS</div>
          {(rows?.length ?? 0) > 1 && (
            <button disabled={busy}
              onClick={() => { if (window.confirm(`Remove all ${rows!.length} flags from this league?`)) void unflag(rows!.map((f) => f.slug)); }}
              className="mono" style={{ ...linkBtn, color: 'var(--opp)', marginLeft: 'auto', opacity: busy ? 0.5 : 1 }}>
              ✕ CLEAR ALL {rows!.length}
            </button>
          )}
        </div>
        {rows == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>Loading…</div>}
        {rows?.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>None yet.</div>}
        {rows?.map((f) => (
          <div key={f.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap' }}>
            <Img src={headshot(f.slug)} size={22} radius={11} fallback={<span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>?</span>} />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 'none' }}>{prettify(f.slug)}</span>
            {labelFor === f.slug
              ? labelInput(f.slug)
              : <>
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: FLAG_PURPLE, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⚑ {f.label}{ruleGlyphs(f.rules) ? ` · ${ruleGlyphs(f.rules)}` : ''}</span>
                  <button onClick={() => { setLabelFor(f.slug); setLabelDraft(f.label); setRulesDraft(f.rules ?? {}); }} className="mono" style={linkBtn}>✎</button>
                  <button onClick={() => void save(f.slug, null)} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕</button>
                </>}
          </div>
        ))}

        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginTop: 14 }}>
          {bulk ? `FLAG MANY — ${selected.size} SELECTED` : 'FLAG A PLAYER'}
        </div>
        <input value={q} onChange={(e) => { setQ(e.target.value); if (!bulk) setLabelFor(null); }} placeholder="search any NFL player…" style={{ ...input, marginTop: 6 }} />
        {bulk && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>
            {['ALL', ...FILTER_POS].map((p) => (
              <button key={p} onClick={() => setFPos(p)} className="mono"
                style={{ fontSize: 8.5, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 8px', color: fPos === p ? 'var(--on-accent)' : 'var(--dim)', background: fPos === p ? 'var(--you)' : 'var(--bg)', border: `1px solid ${fPos === p ? 'var(--you)' : 'var(--bd)'}` }}>{p}</button>
            ))}
            <select value={fTeam} onChange={(e) => setFTeam(e.target.value)} className="mono"
              style={{ fontSize: 9.5, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 5, padding: '3px 6px' }}>
              <option value="ALL">ALL TEAMS</option>
              {ALL_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {TENURES.map((t) => (
              <button key={t.id} onClick={() => setFTen(fTen === t.id ? 'ALL' : t.id)} className="mono"
                style={{ fontSize: 8.5, fontWeight: 700, cursor: 'pointer', borderRadius: 999, padding: '3px 8px', color: fTen === t.id ? 'var(--on-accent)' : 'var(--dim)', background: fTen === t.id ? 'var(--warn)' : 'var(--bg)', border: `1px solid ${fTen === t.id ? 'var(--warn)' : 'var(--bd)'}` }}>{t.label}</button>
            ))}
            {matches.length > 0 && (
              <button onClick={() => setSelected(new Set(matches))} className="mono" style={{ ...ghostBtn, padding: '3px 9px', fontSize: 8.5 }}>
                ☑ SELECT ALL {matches.length}
              </button>
            )}
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="mono" style={{ ...linkBtn, fontSize: 8.5 }}>clear</button>
            )}
          </div>
        )}
        {matches.map((slug) => (
          <div key={slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap' }}>
            {bulk && (
              <input type="checkbox" checked={selected.has(slug)}
                onChange={() => setSelected((cur) => { const n = new Set(cur); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; })} />
            )}
            <Img src={headshot(slug)} size={22} radius={11} fallback={<span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>?</span>} />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: !bulk && labelFor === slug ? 'none' : 1 }}>{prettify(slug)}</span>
            {!bulk && (labelFor === slug
              ? labelInput(slug)
              : <button onClick={() => { setLabelFor(slug); setLabelDraft(''); setRulesDraft({}); }} className="mono" style={{ ...ghostBtn, padding: '4px 9px', fontSize: 9 }}>⚑ FLAG</button>)}
          </div>
        ))}
        {q.trim().length >= 2 && matches.length === 0 && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>No player matches that.</div>
        )}
        {bulk && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
            <input value={labelDraft} maxLength={40} onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="label — leave empty and the rules name it…" style={{ ...input, fontSize: 11 }} />
            <RuleControls draft={rulesDraft} set={setRulesDraft} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => void saveBulk()} disabled={busy || !selected.size}
                className="mono" style={{ ...btn, flex: 1, opacity: busy || !selected.size ? 0.5 : 1 }}>
                ⚑ FLAG {selected.size} PLAYER{selected.size === 1 ? '' : 'S'}
              </button>
              <button onClick={() => void unflag([...selected])} disabled={busy || !selected.size}
                title="remove whatever flag each selected player carries"
                className="mono" style={{ ...ghostBtn, color: 'var(--opp)', opacity: busy || !selected.size ? 0.5 : 1 }}>
                ✕ UNFLAG
              </button>
            </div>
            {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 5, lineHeight: 1.4 }}>{err}</div>}
            {!labelDraft.trim() && selected.size > 0 && (
              autoLabel(rulesDraft)
                ? <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 5, lineHeight: 1.4 }}>
                    no label — the flag will read “{autoLabel(rulesDraft)}”
                  </div>
                : <div className="mono" style={{ fontSize: 9, color: 'var(--warn)', marginTop: 5, lineHeight: 1.4 }}>
                    ↑ give it a label or a rule — the label is what the league sees on every flagged player’s chip
                  </div>
            )}
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={onClose} className="mono" style={linkBtn}>done</button></div>
      </div>
    </ModalBackdrop>
  );
}
