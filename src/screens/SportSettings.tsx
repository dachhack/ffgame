// A SPORT LEAGUE'S SCORING (0400) — the commissioner's page for a daily
// sport, in place of the football catalog: the format (points, categories,
// roto) and the categories while the season has not started; the points
// per stat any time. One SAVE per section; the worker rescores every live
// matchup on its next pass, so a changed knob shows on the board within a
// minute.
import { useEffect, useMemo, useState } from 'react';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { normalizeScoring } from '@drip/core/sports/score';
import { sportSettingsOf, type SportLeagueSettings, type SportFormat } from '@drip/core/sports/league';
import { setSportSettings, friendlyError } from '@drip/core/data/liveApi';

const RADIUS = 8;
const pill = (on: boolean): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
  background: on ? 'color-mix(in srgb, var(--you) 14%, transparent)' : 'transparent', color: on ? 'var(--you)' : 'var(--dim)',
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
});

export function SportSettings({ leagueId, sport, initial, locked }: {
  leagueId: string; sport: Sport; initial: Record<string, unknown> | null | undefined;
  /** The season is under way: format, categories and the calendar are frozen. */
  locked: boolean;
}) {
  const def = SPORTS[sport];
  const [settings, setSettings] = useState<SportLeagueSettings | null>(() => sportSettingsOf({ sport: initial }));
  const [format, setFormat] = useState<SportFormat>(settings?.format ?? 'points');
  const [cats, setCats] = useState<Set<string>>(() => new Set(settings?.categories ?? def.categoriesDefault));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [group, setGroup] = useState<string>(Object.keys(def.groups)[0] ?? 'all');

  useEffect(() => {
    const s = sportSettingsOf({ sport: initial });
    setSettings(s);
    setFormat(s?.format ?? 'points');
    setCats(new Set(s?.categories ?? def.categoriesDefault));
    const sc = normalizeScoring(def, s?.scoring);
    const d: Record<string, string> = {};
    for (const st of def.stats) d[st.id] = String(sc[st.id] ?? 0);
    setDraft(d);
  }, [initial, def]);

  const scoringNow = useMemo(() => normalizeScoring(def, settings?.scoring), [def, settings?.scoring]);
  const stats = def.stats.filter((s) => s.group === group || s.group === 'all');
  const changed = (id: string) => Number(draft[id]) !== (def.scoringDefault[id] ?? 0);
  const dirty = def.stats.some((s) => Number(draft[s.id]) !== (scoringNow[s.id] ?? 0));

  const saveScoring = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const over: Record<string, number> = {};
      for (const s of def.stats) {
        const v = Number(draft[s.id]);
        if (Number.isFinite(v) && v !== (def.scoringDefault[s.id] ?? 0)) over[s.id] = v;
      }
      const r = await setSportSettings(leagueId, { scoring: over });
      if (r.ok) { setSettings(sportSettingsOf({ sport: r.sport })); setNote(`✓ scoring saved — ${Object.keys(over).length} value${Object.keys(over).length === 1 ? '' : 's'} off the ${def.league} default`); }
      else setNote(friendlyError(r.error ?? 'failed'));
    } catch (e) { setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const resetScoring = () => {
    const d: Record<string, string> = {};
    for (const st of def.stats) d[st.id] = String(def.scoringDefault[st.id] ?? 0);
    setDraft(d);
  };
  const saveFormat = async (f: SportFormat, c: Set<string>) => {
    if (busy || locked) return;
    setBusy(true); setNote(null);
    try {
      const r = await setSportSettings(leagueId, { format: f, categories: [...c] });
      if (r.ok) { setSettings(sportSettingsOf({ sport: r.sport })); setFormat(f); setCats(c); setNote(f === 'points' ? '✓ points — weekly totals head-to-head' : f === 'cats' ? `✓ categories — ${c.size} compared each week` : `✓ roto — one season ranking per category (${c.size})`); }
      else setNote(friendlyError(r.error ?? 'failed'));
    } catch (e) { setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const toggleCat = (id: string) => {
    const next = new Set(cats);
    if (next.has(id)) next.delete(id); else next.add(id);
    void saveFormat(format, next);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '10px 12px' }}>
        <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>
          {def.league} FORMAT {locked && <span style={{ fontWeight: 400 }}>· locked once the season is under way</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {(['points', 'cats', 'roto'] as SportFormat[]).map((f) => (
            <button key={f} disabled={busy || locked} onClick={() => void saveFormat(f, cats)} className="mono" style={{ ...pill(format === f), opacity: locked && format !== f ? 0.45 : 1 }}>
              {f === 'points' ? 'POINTS' : f === 'cats' ? 'H2H CATEGORIES' : 'ROTO'}
            </button>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5 }}>
          {format === 'points'
            ? 'Each week is the sum of every locked starter\'s points, head-to-head.'
            : format === 'cats'
              ? 'Each week is won category by category from both sides\' summed lines; ratios (FG%, ERA…) are made from the totals.'
              : 'No weekly winner: every game all season sums into one line per team, each category ranks the league, best of N takes N points.'}
        </div>
        {format !== 'points' && (
          <>
            <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--faint)', marginTop: 10 }}>CATEGORIES · {cats.size} on</div>
            <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
              {def.categories.map((c) => (
                <button key={c.id} disabled={busy || locked} onClick={() => toggleCat(c.id)} className="mono" title={c.label}
                  style={{ ...pill(cats.has(c.id)), padding: '4px 9px', opacity: locked && !cats.has(c.id) ? 0.45 : 1 }}>
                  {c.short}{c.lowerBetter ? ' ↓' : ''}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>POINTS PER STAT <span style={{ fontWeight: 400 }}>· changed values light up</span></div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={resetScoring} disabled={busy} className="mono" style={pill(false)}>{def.league} DEFAULT</button>
            <button onClick={() => void saveScoring()} disabled={busy || !dirty} className="mono" style={{ ...pill(dirty), opacity: dirty ? 1 : 0.5 }}>SAVE</button>
          </div>
        </div>
        {Object.keys(def.groups).length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {Object.keys(def.groups).map((g) => (
              <button key={g} onClick={() => setGroup(g)} className="mono" style={{ ...pill(group === g), padding: '4px 10px' }}>{g.toUpperCase()}S</button>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6, marginTop: 8 }}>
          {stats.map((s) => (
            <label key={s.id} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: changed(s.id) ? 'var(--you)' : 'var(--dim)' }} title={s.label}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.short}{s.derived ? ' *' : ''}</span>
              <input value={draft[s.id] ?? '0'} inputMode="decimal" onChange={(e) => setDraft({ ...draft, [s.id]: e.target.value })}
                style={{ width: 58, padding: '3px 6px', borderRadius: 5, border: `1px solid ${changed(s.id) ? 'var(--you)' : 'var(--bd)'}`, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, textAlign: 'right' }} />
            </label>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          * derived per game (a double-double, a quality start, innings from outs) — a knob on it scores the night it happens. Points apply to every week from the next scoring pass, including the one in progress.
        </div>
      </div>
      {note && <div className="mono" style={{ fontSize: 10.5, color: note.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{note}</div>}
    </div>
  );
}
