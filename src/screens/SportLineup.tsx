// A SPORT LEAGUE'S LINEUP (0403) — the commissioner's builder for a daily
// sport, in counts per slot type (2 C, 1 G, 2 UTIL…) plus the bench and IR
// shelves, until the draft starts. One SAVE writes the whole spec through
// set_sport_lineup; the draft's rounds follow (starters + bench + IR).
import { useEffect, useMemo, useState } from 'react';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { sportRosterSlots, slotCountsOf } from '@drip/core/sports/league';
import { setSportLineup, setLeagueRosterShape, friendlyError, type GameModeInfo } from '@drip/core/data/liveApi';

const RADIUS = 8;

export function SportLineup({ leagueId, sport, gm, locked, onSaved }: {
  leagueId: string; sport: Sport; gm: GameModeInfo | null;
  /** The draft has started: the lineup is frozen. */
  locked: boolean;
  onSaved?: () => void;
}) {
  const def = SPORTS[sport];
  const [counts, setCounts] = useState<Record<string, number>>(() => slotCountsOf(def, gm?.slots ?? null));
  const [bench, setBench] = useState<number>(gm?.shape?.bench ?? def.benchDefault);
  const [ir, setIr] = useState<number>(gm?.shape?.ir ?? def.irDefault);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setCounts(gm?.slots?.length ? slotCountsOf(def, gm.slots) : { ...def.defaultRoster });
    setBench(gm?.shape?.bench ?? def.benchDefault);
    setIr(gm?.shape?.ir ?? def.irDefault);
  }, [gm, def]);

  const starters = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  const custom = Object.keys(counts).filter((k) => !def.slotTypes.some((t) => t.type === k));
  const bump = (type: string, d: number) => setCounts((c) => {
    const n = Math.max(0, Math.min(6, (c[type] ?? 0) + d));
    const next = { ...c, [type]: n };
    if (n === 0) delete next[type];
    return next;
  });

  const save = async () => {
    if (busy || locked) return;
    if (starters < 1 || starters > 20) { setNote('a lineup needs 1–20 starters'); return; }
    setBusy(true); setNote(null);
    try {
      // Known types build from the catalog; a custom set the commissioner saved
      // before rides along as it is.
      const known = Object.fromEntries(Object.entries(counts).filter(([k]) => def.slotTypes.some((t) => t.type === k)));
      const slots = [...sportRosterSlots(def, known), ...custom.flatMap((k) => Array.from({ length: counts[k] }, () => ({ pos: k.split('/'), label: k })))];
      const r = await setSportLineup(leagueId, slots);
      if (!r.ok) { setNote(friendlyError(r.error ?? 'failed')); return; }
      const sh = await setLeagueRosterShape(leagueId, bench, 0, ir, 0, 0);
      if (!sh.ok) { setNote(friendlyError(sh.error ?? 'lineup saved, but the bench/IR did not')); return; }
      // `draft_rounds` is what the draft runs (starters + bench); `rounds` is
      // the roster including the IR shelf, which is stashed into, not drafted.
      setNote(`✓ ${r.starters} starters, ${bench} bench, ${ir} IR — the draft runs ${sh.draft_rounds ?? '?'} rounds`);
      onSaved?.();
    } catch (e) { setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const stepper = (v: number, set: (n: number) => void, min: number, max: number) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => set(Math.max(min, v - 1))} disabled={busy || locked} className="mono" style={btn}>−</button>
      <span className="mono" style={{ minWidth: 18, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v}</span>
      <button onClick={() => set(Math.min(max, v + 1))} disabled={busy || locked} className="mono" style={btn}>＋</button>
    </span>
  );

  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '10px 12px', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>
          {def.league} LINEUP <span style={{ fontWeight: 400 }}>· {starters} starters{locked ? ' · frozen since the draft' : ''}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => { setCounts({ ...def.defaultRoster }); setBench(def.benchDefault); setIr(def.irDefault); }} disabled={busy || locked} className="mono" style={pill(false)}>{def.league} STANDARD</button>
          <button onClick={() => void save()} disabled={busy || locked} className="mono" style={pill(true)}>SAVE</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6 }}>
        {def.slotTypes.map((t) => (
          <div key={t.type} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: (counts[t.type] ?? 0) > 0 ? 'var(--text)' : 'var(--dim)' }}>
            {stepper(counts[t.type] ?? 0, (n) => bump(t.type, n - (counts[t.type] ?? 0)), 0, 6)}
            <span title={t.pos.join(' / ')}>{t.label}</span>
          </div>
        ))}
        {custom.map((k) => (
          <div key={k} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--text)' }}>
            {stepper(counts[k], (n) => bump(k, n - counts[k]), 0, 6)}
            <span>{k} <span style={{ color: 'var(--faint)' }}>(custom)</span></span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--text)' }}>{stepper(bench, setBench, 0, 15)} BENCH</div>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--text)' }}>{stepper(ir, setIr, 0, 6)} IR / IL</div>
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.5 }}>
        Every spot names the positions it accepts (UTIL takes anyone; {def.slotTypes.find((t) => t.pos.length > 1 && t.type !== 'UTIL')?.label ?? 'a flex'} takes {def.slotTypes.find((t) => t.pos.length > 1 && t.type !== 'UTIL')?.pos.join(' or ')}).
        Lineups change any day; a player locks into his spot when his game starts. The draft runs starters + bench rounds; IR spots are stashed into, not drafted.
      </div>
      {note && <div className="mono" style={{ fontSize: 10.5, color: note.startsWith('✓') ? 'var(--you)' : 'var(--opp)' }}>{note}</div>}
    </div>
  );
}

const btn: React.CSSProperties = { background: 'none', border: '1px solid var(--bd)', borderRadius: 5, width: 24, height: 24, fontSize: 13, color: 'var(--dim)', cursor: 'pointer', padding: 0 };
const pill = (on: boolean): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`,
  background: on ? 'color-mix(in srgb, var(--you) 14%, transparent)' : 'transparent', color: on ? 'var(--you)' : 'var(--dim)',
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
});
