import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { Brand, ThemeSwitcher, PosPill } from '../app/ui';
import { getTeam, gameForTeam } from '../data/league';
import { buildMatchup, defaultLineup, slotKey } from '../engine/matchup';
import { REAL_WEEKS, loadRealWeek, isRealWeekLoaded } from '../data/realPbp';
import { metricById } from '../data/metrics';
import { DEMO_WEEK } from '../config';

const YOU = 'happy-campers';

export function MatchupFinal({ week }: { week: number }) {
  const { navigate } = useStore();
  const oppId = gameForTeam(YOU, week)?.oppId ?? 'rock-tunnel';
  const opp = getTeam(oppId)!;
  const you = getTeam(YOU)!;

  const [ready, setReady] = useState(() => !REAL_WEEKS.has(week) || isRealWeekLoaded(week));
  useEffect(() => {
    if (!REAL_WEEKS.has(week) || isRealWeekLoaded(week)) { setReady(true); return; }
    setReady(false);
    let alive = true;
    loadRealWeek(week).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [week]);

  const youPicks = useMemo(() => defaultLineup(YOU, week), [week, ready]);
  const oppPicks = useMemo(() => defaultLineup(oppId, week), [oppId, week, ready]);
  const m = useMemo(() => buildMatchup(YOU, oppId, week, youPicks, oppPicks), [oppId, week, youPicks, oppPicks, ready]);

  const won = m.youFinal >= m.theirFinal;
  const margin = Math.abs(m.youFinal - m.theirFinal).toFixed(1);

  let slotsW = 0, slotsL = 0, slotsT = 0, effects = 0;
  for (const w of m.windows) for (const s of w.slots) {
    if (!s.you || !s.their) continue;
    if (s.youFinal > s.theirFinal) slotsW++; else if (s.youFinal < s.theirFinal) slotsL++; else slotsT++;
    effects += s.events.filter((e) => e.effect && (e.effect.type === 'nuke' || e.effect.type === 'erase')).length;
  }

  const nextWeek = Math.min(14, week + 1);
  const nextOppId = gameForTeam(YOU, nextWeek)?.oppId;
  const nextOpp = nextOppId ? getTeam(nextOppId) : null;

  if (!ready) {
    return (
      <div className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, color: 'var(--dim)', fontSize: 12, letterSpacing: '0.08em' }}>
        LOADING WEEK {week}…
      </div>
    );
  }

  return (
    <>
      <header style={{ height: 60, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', position: 'sticky', top: 0, zIndex: 40, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Brand onClick={() => navigate({ name: 'league' })} />
          <ThemeSwitcher />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--dim)' }}>WEEK {week} FINAL</span>
        </div>
        <button onClick={() => navigate({ name: 'league' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', padding: '6px 9px', borderRadius: 4 }}>← LEAGUE</button>
      </header>

      <main style={{ flex: 1, overflow: 'auto', padding: '22px 18px 60px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          {/* hero */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: `4px solid ${won ? 'var(--you)' : 'var(--opp)'}`, borderRadius: 6, padding: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', color: won ? 'var(--you)' : 'var(--opp)' }}>{won ? '★ VICTORY' : 'DEFEAT'}</span>
              {m.real && <span className="mono" title="Resolved off real 2025 NFL play-by-play" style={{ marginLeft: 10, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--you)', border: '1px solid var(--you)', borderRadius: 3, padding: '3px 6px' }}>● REAL PBP</span>}
              <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginTop: 8 }}>
                {won ? `You took Week ${week} by ${margin}` : `Dropped Week ${week} by ${margin}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>
                {slotsW} slots won · {slotsL} lost · {effects} nukes &amp; erasures fired across the five windows.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="grotesk" style={{ fontSize: 54, fontWeight: 700, color: 'var(--you)', lineHeight: 1 }}>{m.youFinal.toFixed(1)}</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.1em', marginTop: 4 }}>{you.name.toUpperCase()}</div>
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>VS</span>
              <div style={{ textAlign: 'center' }}>
                <div className="grotesk" style={{ fontSize: 54, fontWeight: 700, color: 'var(--opp)', lineHeight: 1 }}>{m.theirFinal.toFixed(1)}</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.1em', marginTop: 4 }}>{opp.name.slice(0, 16).toUpperCase()}</div>
              </div>
            </div>
          </div>

          {/* window strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 16 }}>
            {m.windows.map((w) => {
              let y = 0, t = 0;
              for (const s of w.slots) { y += s.youFinal; t += s.theirFinal; }
              const wWon = y > t, even = Math.abs(y - t) < 0.1;
              const c = even ? 'var(--dim)' : wWon ? 'var(--you)' : 'var(--opp)';
              return (
                <div key={w.window.id} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderTop: `3px solid ${c}`, borderRadius: 5, padding: 14 }}>
                  <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{w.window.label}</div>
                  <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>
                    <span style={{ color: 'var(--you)' }}>{y.toFixed(1)}</span>
                    <span style={{ color: 'var(--faint)', fontSize: 12 }}> · </span>
                    <span style={{ color: 'var(--opp)' }}>{t.toFixed(1)}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: c, marginTop: 6 }}>{even ? 'EVEN' : wWon ? 'WON' : 'LOST'} · {w.window.slots} SLOT{w.window.slots > 1 ? 'S' : ''}</div>
                </div>
              );
            })}
          </div>

          {/* every slot */}
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--faint)', margin: '22px 0 10px' }}>EVERY SLOT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {m.windows.flatMap((w) => w.slots.map((s) => {
              const key = slotKey(w.window.id, s.slotIndex);
              if (!s.you || !s.their) return null;
              const sw = s.youFinal > s.theirFinal, tie = Math.abs(s.youFinal - s.theirFinal) < 0.1;
              const c = tie ? 'var(--dim)' : sw ? 'var(--you)' : 'var(--opp)';
              const yMet = metricById(s.you.player.pos, s.you.metricId);
              const tMet = metricById(s.their.player.pos, s.their.metricId);
              return (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 60px 64px 60px 1fr', gap: 8, alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '9px 12px' }}>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.08em' }}>{w.window.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <PosPill pos={s.you.player.pos} />
                    <div style={{ minWidth: 0 }}>
                      <div className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.you.player.name}</div>
                      <div className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{yMet?.name}</div>
                    </div>
                  </div>
                  <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--you)', textAlign: 'right' }}>{s.youFinal.toFixed(1)}</span>
                  <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: c, padding: '3px 5px', borderRadius: 3, textAlign: 'center' }}>{tie ? 'TIE' : sw ? 'WON' : 'LOST'}</span>
                  <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--opp)', textAlign: 'left' }}>{s.theirFinal.toFixed(1)}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, justifyContent: 'flex-end' }}>
                    <div style={{ minWidth: 0, textAlign: 'right' }}>
                      <div className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.their.player.name}</div>
                      <div className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{tMet?.name}</div>
                    </div>
                    <PosPill pos={s.their.player.pos} />
                  </div>
                </div>
              );
            }))}
          </div>

          {/* next up */}
          {nextOpp && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--warn)', borderRadius: 6, padding: 18, marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--faint)' }}>NEXT UP · WEEK {nextWeek}</div>
                <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>vs {nextOpp.name}</div>
              </div>
              <button onClick={() => navigate({ name: 'matchup', week: nextWeek, phase: 'setup' })} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4 }}>
                SET WEEK {nextWeek} →
              </button>
            </div>
          )}
          <div style={{ height: 30 }} />
          <div className="mono" style={{ textAlign: 'center', fontSize: 10, color: 'var(--faint)' }}>
            Drip League FF · {opp.name} matchup · simulated from real 2025 stats · DEMO_WEEK {DEMO_WEEK}
          </div>
        </div>
      </main>
    </>
  );
}
