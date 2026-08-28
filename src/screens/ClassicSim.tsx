// CLASSIC SIM — a scrubbable playtest of classic mode on a baked 2025 week.
//
// Founder: "how can I play test classic mode? Can we use 2025 data to sim a
// week?" The drip board has had a scrubbable 2025 demo (DemoBoard) since the
// start; classic only had ClassicDemo, a static scoring-comparison. This is the
// missing piece: the same real 2025 week (DEMO_WEEK), scored under CLASSIC
// rules, driven by a clock you can drag or play — so you watch a classic
// lineup accrue play by play, with the shared field visuals + box score
// scrubbing alongside it.
//
// Hidden by design: reached only from the super-admin panel or #/classic-sim.
// (v0.367.1: this screen briefly doubled as the classic board's WEEK 0 under
// league rules; the founder retired that door — "reuse the actual matchup
// board for the sim so I know everything works as is" — so the REHEARSAL strip
// on ClassicBoard now drives the worker sim on the real board, and this stays
// what it started as: a client-side scoring-shape comparison on demo teams.)
// Nothing here touches the server — it reads the baked play cache the drip demo
// already loads and re-scores it with `classicPointsFrom`, clock-filtered, so
// the sim can never disagree with the real board about what a week was worth.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { classicSlots, classicPoints, classicPointsFrom, bestballFillBy, type ClassicPick, type ClassicSlotDef } from '@drip/core/engine/classic';
import { projectedPoints } from '@drip/core/engine/projScoring';
import { playsForPlayer } from '@drip/core/engine/sim';
import { teamRoster, getTeam, gameForTeam, YOU_TEAM_ID } from '@drip/core/data/league';
import { shortName } from '@drip/core/data/players';
import { DEMO_WEEK } from '@drip/core/config';
import { loadRealWeek } from '@drip/core/data/realPbp';
import { loadGameFeedWeek, gameFeedFor } from '@drip/core/data/gameFeed';
import { FieldView } from '../app/FieldView';
import { PosPill, PlayerImg } from '../app/ui';
import { openPlayerCard } from '../app/playerCard';
import type { Player } from '@drip/core/types';

// Regulation caps at 55:00 (matches the engine's GAME_SECONDS); OT plays reach
// past it, so the real ceiling is read from the week's plays and this is only
// the floor when a week somehow has none.
const REG_SECONDS = 3300;
const TICK_MS = 350;      // playback cadence
const STEP = 75;          // game-seconds advanced per tick (~full game in ~13s)

const PPR_STEPS: { v: number; label: string }[] = [
  { v: 0, label: 'Standard' }, { v: 0.5, label: 'Half-PPR' }, { v: 1, label: 'Full PPR' },
];

/** Quarter + game-clock-remaining label for an elapsed-seconds position. */
function qClock(sec: number): string {
  const q = Math.min(5, Math.floor(sec / 900) + 1);
  const r = Math.max(0, 900 - (sec % 900));
  return `${q > 4 ? 'OT' : `Q${q}`} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`;
}

type Row = { def: ClassicSlotDef; player: Player | null };

export function ClassicSim() {
  const { navigate } = useStore();
  const [ppr, setPpr] = useState(1);
  const [bestBall, setBestBall] = useState(false);
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState(REG_SECONDS); // start at the final; drag back to replay
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([loadRealWeek(DEMO_WEEK), loadGameFeedWeek(DEMO_WEEK)])
      .then(() => { if (alive) setReady(true); })
      .catch(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const youId = YOU_TEAM_ID;
  const oppId = gameForTeam(youId, DEMO_WEEK)?.oppId ?? null;
  const youTeam = getTeam(youId);
  const oppTeam = oppId ? getTeam(oppId) : undefined;

  const slots = useMemo(() => classicSlots(), []);
  const slotNames = useMemo(() => slots.map((s) => s.slot), [slots]);

  // Each side's lineup — best-ball optimizes on the week's actual points (a
  // fixed, hindsight-perfect lineup we then watch score); otherwise it's the
  // projection fill, i.e. what a manager would have set before kickoff.
  const fillSide = (teamId: string | null): Row[] => {
    if (!teamId || !ready) return slots.map((d) => ({ def: d, player: null }));
    const roster = teamRoster(teamId);
    const valueOf: (p: Player, d: ClassicSlotDef) => number = bestBall
      ? (p) => classicPoints(p, DEMO_WEEK, ppr)
      : (p, d) => projectedPoints(p, d.slot, d.pos);
    const picks: ClassicPick[] = bestballFillBy([], slotNames, roster, slots, valueOf);
    const bySlot = new Map(picks.map((p) => [p.slot, p.player]));
    return slots.map((d) => ({ def: d, player: bySlot.get(d.slot) ?? null }));
  };
  const youRows = useMemo(() => fillSide(youId), [youId, ready, ppr, bestBall]); // eslint-disable-line react-hooks/exhaustive-deps
  const themRows = useMemo(() => fillSide(oppId), [oppId, ready, ppr, bestBall]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every starter's plays, once — the clock filter below runs over these each
  // frame rather than re-reading the cache 18 times a tick.
  const playsBySlug = useMemo(() => {
    const m = new Map<string, ReturnType<typeof playsForPlayer>['plays']>();
    for (const r of [...youRows, ...themRows]) {
      if (!r.player || m.has(r.player.id)) continue;
      m.set(r.player.id, playsForPlayer(r.player, DEMO_WEEK).plays);
    }
    return m;
  }, [youRows, themRows]);

  // The clock ceiling: the latest play among all starters (OT included).
  const maxClock = useMemo(() => {
    let mx = REG_SECONDS;
    for (const plays of playsBySlug.values()) for (const p of plays) if (p.clock > mx) mx = p.clock;
    return mx;
  }, [playsBySlug]);

  const ptsAt = (player: Player | null): number => {
    if (!player) return 0;
    const plays = playsBySlug.get(player.id) ?? [];
    const upto = clock >= maxClock ? plays : plays.filter((p) => p.clock <= clock);
    return classicPointsFrom(upto, player, ppr);
  };

  const sideTotal = (rows: Row[]) => rows.reduce((n, r) => n + ptsAt(r.player), 0);
  const youTotal = sideTotal(youRows);
  const themTotal = sideTotal(themRows);

  // Playback: advance the clock until the last play, then stop.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(() => {
      setClock((c) => { const n = c + STEP; if (n >= maxClock) { setPlaying(false); return maxClock; } return n; });
    }, TICK_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, maxClock]);

  // The distinct NFL games under the starters (both sides), deduped by feed —
  // the fields to draw at the current clock.
  const fieldTeams = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const r of [...youRows, ...themRows]) {
      const tm = r.player?.team; if (!tm) continue;
      const f = gameFeedFor(DEMO_WEEK, tm); if (!f || seen.has(f.key)) continue;
      seen.add(f.key); out.push(tm);
    }
    return out;
  }, [youRows, themRows, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (on: boolean): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '6px 11px', borderRadius: 999,
    cursor: 'pointer', border: `1px solid ${on ? 'var(--warn)' : 'var(--bd)'}`,
    background: on ? 'var(--warn)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--dim)',
  });

  const sideCol = (team: ReturnType<typeof getTeam>, rows: Row[], total: number, tone: 'you' | 'opp') => (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: `var(--${tone})`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team?.name ?? '—'}</span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{total.toFixed(1)}</span>
      </div>
      {rows.map((r) => {
        const p = r.player;
        const pts = ptsAt(p);
        return (
          <div key={r.def.slot} onClick={p ? () => openPlayerCard({ slug: p.id, name: p.name, pos: p.pos, team: p.team ?? '', week: DEMO_WEEK }) : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)', cursor: p ? 'pointer' : 'default' }}>
            <span className="mono" style={{ fontSize: 8, fontWeight: 700, color: 'var(--faint)', width: 30, flex: 'none' }}>{r.def.slot}</span>
            {p ? <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={26} /> : <div style={{ width: 26, height: 26, flex: 'none' }} />}
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p ? shortName(p.id) : <span style={{ color: 'var(--faint)' }}>—</span>}
            </span>
            {p && <PosPill pos={p.pos} />}
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: pts ? 'var(--text)' : 'var(--faint)', width: 42, textAlign: 'right', flex: 'none' }}>{pts.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );

  const atEnd = clock >= maxClock;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="grotesk" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>🧪 Classic Sim</div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', letterSpacing: '0.04em' }}>WEEK {DEMO_WEEK} · 2025 REAL PLAYS · CLASSIC SCORING · PLAYTEST</div>
        </div>
        <button onClick={() => navigate({ name: 'live', view: 'admin' })} className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 11px', cursor: 'pointer' }}>← ADMIN</button>
      </div>

      {/* scoring controls */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {PPR_STEPS.map((s) => <button key={s.v} onClick={() => setPpr(s.v)} className="mono" style={chip(ppr === s.v)}>{s.label}</button>)}
        <span style={{ width: 1, height: 20, background: 'var(--bd)', margin: '0 4px' }} />
        <button onClick={() => setBestBall((b) => !b)} className="mono" style={chip(bestBall)}>{bestBall ? '✓ BEST BALL' : 'BEST BALL'}</button>
        <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.04em' }}>{bestBall ? 'hindsight-perfect lineup' : 'projection lineup (set pre-kick)'}</span>
      </div>

      {!ready ? (
        <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', textAlign: 'center', padding: 40 }}>Loading the 2025 week…</div>
      ) : (
        <>
          {/* score + scrub */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--you)' }}>{youTotal.toFixed(1)}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>{atEnd ? 'FINAL' : qClock(clock)}</span>
              <span className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--opp)' }}>{themTotal.toFixed(1)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => { if (atEnd) setClock(0); setPlaying((p) => !p); }} className="mono"
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '7px 13px', cursor: 'pointer', flex: 'none' }}>
                {playing ? '⏸ PAUSE' : atEnd ? '↻ REPLAY' : '▶ PLAY'}
              </button>
              <input type="range" min={0} max={maxClock} value={clock} onChange={(e) => { setPlaying(false); setClock(Number(e.target.value)); }} style={{ flex: 1, accentColor: 'var(--you)' }} />
              <button onClick={() => { setPlaying(false); setClock(maxClock); }} className="mono" title="Jump to final" style={{ fontSize: 12, color: 'var(--dim)', background: 'none', border: 'none', cursor: 'pointer', flex: 'none' }}>⏭</button>
            </div>
          </div>

          {/* lineups */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {sideCol(youTeam, youRows, youTotal, 'you')}
            {sideCol(oppTeam, themRows, themTotal, 'opp')}
          </div>

          {/* fields — every game with a starter, scrubbing at the current clock */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)' }}>▦ FIELDS · {fieldTeams.length} GAME{fieldTeams.length === 1 ? '' : 'S'}</div>
            {fieldTeams.length === 0
              ? <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>No games on the feed for this week.</div>
              : fieldTeams.map((tm) => <FieldView key={tm} week={DEMO_WEEK} team={tm} clock={clock} collapsible />)}
          </div>
        </>
      )}
    </div>
  );
}
