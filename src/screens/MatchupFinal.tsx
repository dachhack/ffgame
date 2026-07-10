import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { Brand, SiteSettings, PosPill, useIsMobile } from '../app/ui';
import { getTeam, gameForTeam } from '../data/league';
import { buildMatchup, defaultLineup, aiLineup, slotKey, WINDOW_WIN_BONUS } from '../engine/matchup';
import { REAL_WEEKS, loadRealWeek, isRealWeekLoaded } from '../data/realPbp';
import { metricById } from '../data/metrics';
import { powerupById } from '../data/powerups';
import { slotMoments, topMoments, MOMENT_COLOR, type Moment } from '../engine/moments';
import { fmtClock } from '../engine/sim';
import { PuIcon } from '../app/gameIcons';

export function MatchupFinal({ week }: { week: number }) {
  const { navigate, youTeamId: YOU, applied } = useStore();
  const isMobile = useIsMobile();
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

  // Replay the week exactly as you played it: your fielded lineup + every applied
  // power-up (armed buffs, swaps, backups, extra slots, double-or-nothing, bye
  // steal, EMP), against the AI's defended lineup.
  const aw = applied[week];
  const extraSlots = aw?.extraSlots ?? {};
  const extraKey = JSON.stringify(extraSlots);
  const buffs = aw?.buffs ?? {};
  const armedList = Object.keys(buffs).filter((id) => buffs[id]);
  const youPicks = useMemo(() => ({ ...defaultLineup(YOU, week, extraSlots), ...(aw?.lineup ?? {}) }), [YOU, week, ready, extraKey, aw?.lineup]); // eslint-disable-line react-hooks/exhaustive-deps
  const oppPicks = useMemo(() => aiLineup(oppId, YOU, week, extraSlots), [oppId, week, ready, extraKey]);
  const m = useMemo(() => buildMatchup(YOU, oppId, week, youPicks, oppPicks, extraSlots, aw?.swaps ?? {}, aw?.backups ?? {}, buffs, { doubleOrNothing: aw?.doubleOrNothing, byeSteal: aw?.byeSteal, emp: aw?.emp }), [oppId, week, youPicks, oppPicks, ready, extraKey, aw]); // eslint-disable-line react-hooks/exhaustive-deps

  const won = m.youFinal >= m.theirFinal;
  const margin = Math.abs(m.youFinal - m.theirFinal).toFixed(1);

  // The week's top dramatic beats — same extraction the live board banners use,
  // ranked by magnitude. This is the screenshot: what decided the matchup.
  const moments = useMemo(() => {
    const all: Moment[] = [];
    for (const w of m.windows) {
      let reg = 0;
      for (const s of w.slots) for (const e of s.events) if (e.clock > reg) reg = e.clock;
      for (const s of w.slots) {
        if (!s.you || !s.their) continue;
        all.push(...slotMoments(s.events, { you: s.you.player.name, their: s.their.player.name }, w.window.id, slotKey(w.window.id, s.slotIndex), reg || 3600));
      }
    }
    return topMoments(all, 4);
  }, [m]);
  const winLabelOf = (id: string) => m.windows.find((w) => w.window.id === id)?.window.label ?? id.toUpperCase();

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
      <header style={{ minHeight: 56, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6, padding: '8px 14px', position: 'sticky', top: 0, zIndex: 40, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Brand onClick={() => navigate({ name: 'league' })} />
          <SiteSettings />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--dim)' }}>WEEK {week} FINAL</span>
        </div>
        <button onClick={() => navigate({ name: 'league' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', padding: '6px 9px', borderRadius: 4 }}>← LEAGUE</button>
      </header>

      <main style={{ flex: 1, overflow: 'auto', padding: isMobile ? '14px 10px 48px' : '22px 18px 60px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          {/* hero */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: `4px solid ${won ? 'var(--you)' : 'var(--opp)'}`, borderRadius: 6, padding: isMobile ? 15 : 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: isMobile ? 14 : 20, flexWrap: 'wrap' }}>
            <div>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', color: won ? 'var(--you)' : 'var(--opp)' }}>{won ? '★ VICTORY' : 'DEFEAT'}</span>
              {m.real && <span className="mono" title="Resolved off real 2025 NFL play-by-play" style={{ marginLeft: 10, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--you)', border: '1px solid var(--you)', borderRadius: 3, padding: '3px 6px' }}>● REAL PBP</span>}
              <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginTop: 8 }}>
                {won ? `You took Week ${week} by ${margin}` : `Dropped Week ${week} by ${margin}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>
                {slotsW} slots won · {slotsL} lost · {effects} nukes &amp; erasures fired across the windows.
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4, letterSpacing: '0.04em' }}>
                ⚔ WINDOW BATTLES <span style={{ color: 'var(--you)' }}>{m.youWindowsWon}</span>–<span style={{ color: 'var(--opp)' }}>{m.theirWindowsWon}</span>
                {(m.youWindowsWon > 0 || m.theirWindowsWon > 0) && <span> · +{WINDOW_WIN_BONUS} pts per window won</span>}
              </div>
              {armedList.length > 0 && (
                <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 9, flexWrap: 'wrap' }}>
                  <span style={{ letterSpacing: '0.1em', color: 'var(--faint)', fontWeight: 700 }}>YOU ARMED</span>
                  {armedList.map((id) => { const p = powerupById(id); return p ? (
                    <span key={id} title={p.blurb} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--you)', border: '1px solid color-mix(in srgb, var(--you) 45%, transparent)', background: 'color-mix(in srgb, var(--you) 12%, transparent)', borderRadius: 3, padding: '1px 6px' }}><PuIcon id={p.id} emoji={p.icon} size="1.4em" /> {p.name}</span>
                  ) : null; })}
                </div>
              )}
              {nextOpp && (
                <button onClick={() => navigate({ name: 'matchup', week: nextWeek, phase: 'setup' })} className="mono" style={{ marginTop: 14, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4, cursor: 'pointer' }}>
                  SET WEEK {nextWeek} →
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="grotesk" style={{ fontSize: isMobile ? 40 : 54, fontWeight: 700, color: 'var(--you)', lineHeight: 1 }}>{m.youFinal.toFixed(1)}</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.1em', marginTop: 4 }}>{you.name.toUpperCase()}</div>
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>VS</span>
              <div style={{ textAlign: 'center' }}>
                <div className="grotesk" style={{ fontSize: isMobile ? 40 : 54, fontWeight: 700, color: 'var(--opp)', lineHeight: 1 }}>{m.theirFinal.toFixed(1)}</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.1em', marginTop: 4 }}>{opp.name.slice(0, 16).toUpperCase()}</div>
              </div>
            </div>
          </div>

          {/* the week's top moments */}
          {moments.length > 0 && (
            <>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--faint)', margin: '22px 0 10px' }}>THE MOMENTS</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
                {moments.map((mo, i) => {
                  const accent = mo.side === 'you' ? 'var(--you)' : 'var(--opp)';
                  const fx = MOMENT_COLOR[mo.kind] ?? accent;
                  return (
                    <div key={`${mo.slotKey}|${mo.kind}|${mo.clock}|${i}`} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: `4px solid ${accent}`, borderRadius: 5, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 19, lineHeight: 1.1 }}>{mo.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: fx }}>{mo.title}</span>
                          <span className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--faint)' }}>{winLabelOf(mo.win)} · {fmtClock(mo.clock)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 4, lineHeight: 1.5 }}>{mo.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* window strip — each window is its own battle */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 16 }}>
            {m.windows.map((w) => {
              const b = w.battle;
              const y = b?.youTotal ?? 0, t = b?.theirTotal ?? 0;
              const wWon = b?.winner === 'you', even = !b || b.winner === 'push';
              const c = even ? 'var(--dim)' : wWon ? 'var(--you)' : 'var(--opp)';
              const mvp = b?.mvp;
              return (
                <div key={w.window.id} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderTop: `3px solid ${c}`, borderRadius: 5, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{w.window.label}</div>
                    {b && b.bonus > 0 && <span className="mono" title={`Window won — +${b.bonus} bonus points`} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: c }}>+{b.bonus}</span>}
                  </div>
                  <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>
                    <span style={{ color: 'var(--you)' }}>{y.toFixed(1)}</span>
                    <span style={{ color: 'var(--faint)', fontSize: 12 }}> · </span>
                    <span style={{ color: 'var(--opp)' }}>{t.toFixed(1)}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: c, marginTop: 6 }}>
                    {even ? 'EVEN' : wWon ? '★ WON' : 'LOST'}
                    {b && (b.youSlotsWon > 0 || b.theirSlotsWon > 0) && <span style={{ color: 'var(--faint)' }}> · SLOTS {b.youSlotsWon}–{b.theirSlotsWon}</span>}
                  </div>
                  {mvp && (
                    <div className="mono" title={`Window MVP — top slot score earns +${mvp.coin} drip coin`} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.03em', color: mvp.side === 'you' ? 'var(--you)' : 'var(--opp)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      ⭐ MVP {mvp.name} · {mvp.score.toFixed(1)} <span style={{ color: 'var(--warn)' }}>◈{mvp.coin}</span>
                    </div>
                  )}
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
              // What actually happened on this slot during the sim — the player
              // interactions and power-up effects that moved the score.
              const fx: string[] = [];
              if (s.youSub) fx.push(`⤴ ${s.youSub.name} subbed in (${s.youSub.from.toFixed(1)} → ${s.youSub.score.toFixed(1)})`);
              if (s.youStake) fx.push(s.youStake === 'won' ? '⚖️ Double or Nothing — won ×2' : '⚖️ Double or Nothing — lost → 0');
              if (s.youRivalry) fx.push(`⚔️ Rivalry — siphoned +${s.youRivalry.toFixed(1)} from a same-position rival`);
              if (s.youLeadChange) fx.push(`🔀 Lead Change — seized the lead → +${s.youLeadChange.toFixed(0)}`);
              if (s.youGrudge === 'won') fx.push(`🥊 Grudge Match — won by 10+ → +${(s.youGrudgePts ?? 0).toFixed(0)}`);
              if (s.youGrudge === 'lost') fx.push(`🥊 Grudge Match — lost → ${(s.youGrudgePts ?? 0).toFixed(0)}`);
              if (s.theirJinxed) fx.push('🧿 Jinx — negated their first TD');
              if (s.youClutchStake) fx.push(s.youClutchStake === 'won' ? '🎰 Halftime Gamble — won ×2' : '🎰 Halftime Gamble — lost → 0');
              if (s.youEncore) fx.push('🎬 Encore — a TD banked +12');
              if (s.youCounterWiped) fx.push('🪃 Counter-Wipe — negated a nuke');
              if (s.theirRedHerringFrom != null) fx.push(`🎣 Red Herring — capped rival ${s.theirRedHerringFrom.toFixed(1)} → ${s.theirFinal.toFixed(1)}`);
              if (s.byeStolen) fx.push('🪂 Bye steal');
              if (s.ghostFielded) fx.push('👻 Ghost player');
              if (s.youNegated) fx.push('✕ Negated by opponent K shutdown');
              if (s.youHalvedFrom != null) fx.push(`÷2 Suppressed (from ${s.youHalvedFrom.toFixed(1)})`);
              for (const b of s.youBuffFx ?? []) { const p = powerupById(b.id); if (p) fx.push(`${p.icon} ${p.name} ${b.vsOpp ? '−' : '+'}${b.points.toFixed(1)}`); }
              const badge = <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: c, padding: '3px 6px', borderRadius: 3, textAlign: 'center', flex: 'none' }}>{tie ? 'TIE' : sw ? 'WON' : 'LOST'}</span>;
              const youSide = (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <PosPill pos={s.you.player.pos} />
                  <div style={{ minWidth: 0 }}>
                    <div className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.you.player.name}</div>
                    <div className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{yMet?.name}</div>
                  </div>
                </div>
              );
              const theirSide = (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, justifyContent: isMobile ? 'flex-start' : 'flex-end', flexDirection: isMobile ? 'row' : 'row-reverse' }}>
                  <PosPill pos={s.their.player.pos} />
                  <div style={{ minWidth: 0, textAlign: isMobile ? 'left' : 'right' }}>
                    <div className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.their.player.name}</div>
                    <div className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{tMet?.name}</div>
                  </div>
                </div>
              );
              const fxLine = fx.length > 0 && (
                <div className="mono" style={{ fontSize: 8.5, color: 'var(--you)', letterSpacing: '0.02em', lineHeight: 1.5, display: 'flex', flexWrap: 'wrap', gap: '0 10px' }}>
                  {fx.map((t, i) => <span key={i}>{t}</span>)}
                </div>
              );
              const yScore = <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--you)' }}>{s.youFinal.toFixed(1)}</span>;
              const tScore = <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--opp)' }}>{s.theirFinal.toFixed(1)}</span>;
              if (isMobile) {
                return (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: `3px solid ${c}`, borderRadius: 4, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.08em' }}>{w.window.label}</span>
                      {badge}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{youSide}<span style={{ marginLeft: 'auto' }}>{yScore}</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{theirSide}<span style={{ marginLeft: 'auto' }}>{tScore}</span></div>
                    {fxLine}
                  </div>
                );
              }
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '9px 12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 56px 60px 56px 1fr', gap: 8, alignItems: 'center' }}>
                    <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.08em' }}>{w.window.label}</span>
                    {youSide}
                    <span style={{ textAlign: 'right' }}>{yScore}</span>
                    {badge}
                    <span style={{ textAlign: 'left' }}>{tScore}</span>
                    {theirSide}
                  </div>
                  {fxLine}
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
            Drip Fantasy · {opp.name} matchup · simulated from real 2025 stats · Week {week}
          </div>
        </div>
      </main>
    </>
  );
}
