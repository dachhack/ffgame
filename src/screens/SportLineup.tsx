// A SPORT LEAGUE'S LINEUP (0431, 0436) — the commissioner's builder for a
// daily sport: counts per slot type (2 C, 1 G, 2 UTIL…), then each spot as
// built, with what a football spot may carry — 🎯 BEST BALL (the spot fills
// itself each night with the roster's top eligible scorer), a TEAMS scope and
// a ROOKIES scope — plus the bench and IR shelves, until the draft starts.
// One SAVE writes the whole spec through set_sport_lineup; the draft's
// rounds follow (starters + bench + IR).
import { useEffect, useMemo, useState } from 'react';
import { SPORTS, type Sport } from '@drip/core/sports/index';
import { sportRosterSlots, sportRelabelSlots, sportAddSlot, sportRemoveSlot, sportSlotTypeOf, sportSpotScopeLabel, sportHasTenure, type SportSlotSpec } from '@drip/core/sports/league';
import { setSportLineup, setLeagueRosterShape, leaguePool, friendlyError, type GameModeInfo } from '@drip/core/data/liveApi';

const RADIUS = 8;

const specOf = (def: (typeof SPORTS)[Sport], gm: GameModeInfo | null): SportSlotSpec[] => {
  const raw = gm?.slots as (Partial<SportSlotSpec> & { pos: string[] })[] | null | undefined;
  if (!raw?.length) return sportRosterSlots(def);
  return sportRelabelSlots(def, raw.map((s) => ({
    pos: [...(s.pos ?? [])], label: s.label ?? '', ...(s.bb ? { bb: true } : {}),
    ...(s.teams?.length ? { teams: [...s.teams] } : {}), ...(s.min_exp != null ? { min_exp: s.min_exp } : {}), ...(s.max_exp != null ? { max_exp: s.max_exp } : {}),
  })));
};

export function SportLineup({ leagueId, sport, gm, locked, onSaved }: {
  leagueId: string; sport: Sport; gm: GameModeInfo | null;
  /** The draft has started: the lineup is frozen. */
  locked: boolean;
  onSaved?: () => void;
}) {
  const def = SPORTS[sport];
  const [spots, setSpots] = useState<SportSlotSpec[]>(() => specOf(def, gm));
  const [bench, setBench] = useState<number>(gm?.shape?.bench ?? def.benchDefault);
  const [ir, setIr] = useState<number>(gm?.shape?.ir ?? def.irDefault);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The TEAMS picker: open on one spot at a time; the league's teams come
  // off its pool, read once when the first picker opens.
  const [teamsFor, setTeamsFor] = useState<number | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  useEffect(() => {
    setSpots(specOf(def, gm));
    setBench(gm?.shape?.bench ?? def.benchDefault);
    setIr(gm?.shape?.ir ?? def.irDefault);
  }, [gm, def]);
  useEffect(() => {
    if (teamsFor == null || teams) return;
    leaguePool(leagueId).then((rows) => setTeams([...new Set(rows.map((r) => r.team).filter((t): t is string => !!t))].sort())).catch(() => setTeams([]));
  }, [teamsFor, teams, leagueId]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of spots) { const k = sportSlotTypeOf(def, s.pos)?.type ?? [...new Set(s.pos)].sort().join('/'); out[k] = (out[k] ?? 0) + 1; }
    return out;
  }, [spots, def]);
  const starters = spots.length;
  const bbCount = spots.filter((s) => s.bb).length;
  const custom = Object.keys(counts).filter((k) => !def.slotTypes.some((t) => t.type === k));
  const bump = (type: string, d: number) => {
    if (d > 0 && starters >= 20) return;
    setSpots((cur) => (d > 0 ? sportAddSlot(def, cur, type) : sportRemoveSlot(def, cur, type)));
  };
  const patch = (i: number, p: Partial<SportSlotSpec>) => setSpots((cur) => cur.map((s, j) => {
    if (j !== i) return s;
    const next: SportSlotSpec = { ...s, ...p };
    if (!next.bb) delete next.bb;
    if (!next.teams?.length) delete next.teams;
    if (next.min_exp == null) delete next.min_exp;
    if (next.max_exp == null) delete next.max_exp;
    return next;
  }));
  const allBb = bbCount === starters && starters > 0;

  const save = async () => {
    if (busy || locked) return;
    if (starters < 1 || starters > 20) { setNote('a lineup needs 1–20 starters'); return; }
    setBusy(true); setNote(null);
    try {
      const r = await setSportLineup(leagueId, spots);
      if (!r.ok) { setNote(friendlyError(r.error ?? 'failed')); return; }
      const sh = await setLeagueRosterShape(leagueId, bench, 0, ir, 0, 0);
      if (!sh.ok) { setNote(friendlyError(sh.error ?? 'lineup saved, but the bench/IR did not')); return; }
      // `draft_rounds` is what the draft runs (starters + bench); `rounds` is
      // the roster including the IR shelf, which is stashed into, not drafted.
      setNote(`✓ ${r.starters} starters${r.bestball ? ` (${r.bestball} best ball)` : ''}, ${bench} bench, ${ir} IR — the draft runs ${sh.draft_rounds ?? '?'} rounds`);
      onSaved?.();
    } catch (e) { setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const stepper = (v: number, set: (n: number) => void, min: number, max: number) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => set(Math.max(min, v - 1))} disabled={busy || locked || v <= min} className="mono" style={btn}>−</button>
      <span className="mono" style={{ minWidth: 18, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v}</span>
      <button onClick={() => set(Math.min(max, v + 1))} disabled={busy || locked || v >= max} className="mono" style={btn}>＋</button>
    </span>
  );
  const tiny = (on: boolean, extra?: React.CSSProperties): React.CSSProperties => ({ ...pill(on), padding: '3px 8px', fontSize: 9.5, ...extra });

  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '10px 12px', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>
          {def.league} LINEUP <span style={{ fontWeight: 400 }}>· {starters} starters{bbCount ? ` · ${bbCount} best ball` : ''}{locked ? ' · frozen since the draft' : ''}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => { setSpots(sportRosterSlots(def)); setBench(def.benchDefault); setIr(def.irDefault); }} disabled={busy || locked} className="mono" style={pill(false)}>{def.league} STANDARD</button>
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

      {/* EACH SPOT (0436): best ball and scope live on the spot, as on the football builder. */}
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--faint)' }}>SPOTS</div>
          {!locked && (
            <button onClick={() => setSpots((cur) => cur.map((s) => (allBb ? (({ bb: _bb, ...rest }) => rest)(s) : { ...s, bb: true })))} disabled={busy} className="mono" style={tiny(allBb, { marginLeft: 'auto' })} title="Every spot fills itself each night">
              🎯 {allBb ? 'ALL BEST BALL — ON' : 'ALL BEST BALL'}
            </button>
          )}
        </div>
        {spots.map((s, i) => {
          const scope = sportSpotScopeLabel(s);
          return (
            <div key={i} style={{ display: 'grid', gap: 4, padding: '5px 8px', border: '1px solid var(--bd)', borderRadius: 6, background: s.bb ? 'color-mix(in srgb, var(--you) 6%, transparent)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: s.bb ? 'var(--you)' : 'var(--text)', minWidth: 46 }}>{s.label}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{s.pos.join('/')}{scope ? ` · ${scope}` : ''}</span>
                {!locked && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button onClick={() => patch(i, { bb: !s.bb })} disabled={busy} className="mono" style={tiny(!!s.bb)} title="Fills itself each night with your top eligible scorer">🎯 BEST BALL</button>
                    <button onClick={() => setTeamsFor(teamsFor === i ? null : i)} disabled={busy} className="mono" style={tiny(!!s.teams?.length || teamsFor === i)} title="Only players on these teams">TEAMS{s.teams?.length ? ` · ${s.teams.length}` : ''}</button>
                    {sportHasTenure(sport) && (
                      <button onClick={() => patch(i, { max_exp: s.max_exp === 0 ? null : 0, min_exp: null })} disabled={busy} className="mono" style={tiny(s.max_exp === 0)} title="Only players in their first season">ROOKIES</button>
                    )}
                  </span>
                )}
              </div>
              {teamsFor === i && !locked && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {teams == null ? <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>loading teams…</span>
                    : teams.length === 0 ? <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>no pool yet — seed the player pool first</span>
                    : teams.map((tm) => {
                      const on = !!s.teams?.includes(tm);
                      return <button key={tm} onClick={() => patch(i, { teams: on ? (s.teams ?? []).filter((x) => x !== tm) : [...(s.teams ?? []), tm].slice(0, 8) })} disabled={busy} className="mono" style={tiny(on, { padding: '2px 6px' })}>{tm}</button>;
                    })}
                  {!!s.teams?.length && <button onClick={() => patch(i, { teams: [] })} className="mono" style={tiny(false, { padding: '2px 6px', color: 'var(--opp)' })}>CLEAR</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--text)' }}>{stepper(bench, setBench, 0, 15)} BENCH</div>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--text)' }}>{stepper(ir, setIr, 0, 6)} IR / IL</div>
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.5 }}>
        Every spot names the positions it accepts (UTIL takes anyone; {def.slotTypes.find((t) => t.pos.length > 1 && t.type !== 'UTIL')?.label ?? 'a flex'} takes {def.slotTypes.find((t) => t.pos.length > 1 && t.type !== 'UTIL')?.pos.join(' or ')}).
        Lineups change any day; a player locks into his spot at {def.vocab.start}. A 🎯 best-ball spot is nobody's to set: each night it takes your top scorer among the players who played and fit it — one player, one spot — and the board shows it as the night goes.
        A TEAMS spot takes only those teams' players{sportHasTenure(sport) ? '; a ROOKIES spot only first-year players' : ''}. The draft runs starters + bench rounds; IR spots are stashed into, not drafted.
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
