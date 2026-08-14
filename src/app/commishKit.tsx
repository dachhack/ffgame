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
import { setLeagueNote, setPlayerFlag, playerFlags, leagueScoringSet, friendlyError, type PlayerFlagRow } from '@drip/core/data/liveApi';
import { SCORING_BOUNDS, DEFAULT_SCORING, scoringIsDefault, scoringLabel, type LeagueScoring } from '@drip/core/engine/leagueScoring';
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

function ScoringEditor({ leagueId, initial, onDone, onClose }: {
  leagueId: string; initial: LeagueScoring; onDone: () => void; onClose: () => void;
}) {
  const [td, setTd] = useState(initial.tdBonus);
  const [yd, setYd] = useState(initial.ydMult);
  const [to, setTo] = useState(initial.toPenalty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (tdV: number, ydV: number, toV: number) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await leagueScoringSet(leagueId, tdV, Math.round(ydV * 10) / 10, toV);
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
        {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => save(td, yd, to)} disabled={busy} className="mono" style={{ ...btn, flex: 1, opacity: busy ? 0.5 : 1 }}>SAVE</button>
          <button onClick={() => save(DEFAULT_SCORING.tdBonus, DEFAULT_SCORING.ydMult, DEFAULT_SCORING.toPenalty)} disabled={busy} className="mono" style={{ ...ghostBtn }}>RESET TO BASE</button>
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

function FlagsEditor({ leagueId, onChanged, onClose }: {
  leagueId: string; onChanged: () => void; onClose: () => void;
}) {
  const [rows, setRows] = useState<PlayerFlagRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // slug being labeled (new or re-label) + the draft text
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  const load = () => playerFlags(leagueId).then((r) => { if (Array.isArray(r)) setRows(r); }).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return Object.keys(PLAYER_BIO).filter((s) => s.replace(/-/g, ' ').includes(needle)).slice(0, 12);
  }, [q]);

  const save = async (slug: string, label: string | null) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await setPlayerFlag(leagueId, slug, label);
      if (!r.ok) { setErr(friendlyError(r.error ?? 'Could not save the flag.')); return; }
      setLabelFor(null); setLabelDraft(''); setQ('');
      await load(); onChanged();
    } catch (x) { setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const labelInput = (slug: string) => (
    <span style={{ display: 'inline-flex', gap: 6, flex: '1 1 160px' }}>
      <input value={labelDraft} autoFocus maxLength={40} onChange={(e) => setLabelDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && labelDraft.trim()) void save(slug, labelDraft); if (e.key === 'Escape') setLabelFor(null); }}
        placeholder="keeper · out for season · ineligible…" style={{ ...input, padding: '5px 8px', fontSize: 11 }} />
      <button onClick={() => labelDraft.trim() && void save(slug, labelDraft)} disabled={busy || !labelDraft.trim()}
        className="mono" style={{ ...btn, padding: '5px 10px', fontSize: 9 }}>SET</button>
    </span>
  );

  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>⚑ Player flags</div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 4, lineHeight: 1.5 }}>
          A short label pinned on a player, shown to the whole league wherever he appears — “keeper”, “out for season”, “ruled ineligible”.
        </div>
        {err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8 }}>{err}</div>}

        {/* standing flags */}
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginTop: 12 }}>CURRENT FLAGS</div>
        {rows == null && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>Loading…</div>}
        {rows?.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>None yet.</div>}
        {rows?.map((f) => (
          <div key={f.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>
            <Img src={headshot(f.slug)} size={22} radius={11} fallback={<span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>?</span>} />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 'none' }}>{prettify(f.slug)}</span>
            {labelFor === f.slug
              ? labelInput(f.slug)
              : <>
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: FLAG_PURPLE, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⚑ {f.label}</span>
                  <button onClick={() => { setLabelFor(f.slug); setLabelDraft(f.label); }} className="mono" style={linkBtn}>✎</button>
                  <button onClick={() => void save(f.slug, null)} disabled={busy} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>✕</button>
                </>}
          </div>
        ))}

        {/* add: search the directory */}
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginTop: 14 }}>FLAG A PLAYER</div>
        <input value={q} onChange={(e) => { setQ(e.target.value); setLabelFor(null); }} placeholder="search any NFL player…" style={{ ...input, marginTop: 6 }} />
        {matches.map((slug) => (
          <div key={slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
            <Img src={headshot(slug)} size={22} radius={11} fallback={<span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>?</span>} />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: labelFor === slug ? 'none' : 1 }}>{prettify(slug)}</span>
            {labelFor === slug
              ? labelInput(slug)
              : <button onClick={() => { setLabelFor(slug); setLabelDraft(''); }} className="mono" style={{ ...ghostBtn, padding: '4px 9px', fontSize: 9 }}>⚑ FLAG</button>}
          </div>
        ))}
        {q.trim().length >= 2 && matches.length === 0 && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>No player matches that.</div>
        )}
        <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={onClose} className="mono" style={linkBtn}>done</button></div>
      </div>
    </ModalBackdrop>
  );
}
