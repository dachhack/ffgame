// FieldView — the Sleeper-style live field visual for one NFL game: a drive
// chart with the ball marker, first-down line, last-play arc, down & distance
// chip and the play text, all driven by the SAME feed clock as the rest of the
// live board (plays with c <= clock are visible; the latest one is rendered).
// Data comes from the per-game feed (src/data/gameFeed.ts) baked/polled from
// ESPN — the engine's RealPlay data has no field position, this is a parallel
// read-only track for the visual only.
import { useEffect, useMemo, useState } from 'react';
import { gameFeedFor, loadGameFeedWeek, type GamePlay, type TeamGameFeed } from '../data/gameFeed';
import { teamLogo } from '../data/media';
import { useIsMobile } from './ui';

// Geometry (SVG user units). The 100-yd field spans FX..FX+FW; EZ = end zone.
const W = 400, H = 130, EZ = 26, FX = EZ, FW = W - 2 * EZ, TOP = 12, BOT = H - 16;
const ORD = ['', '1st', '2nd', '3rd', '4th'];

const fmtQClock = (c: number): string => {
  if (c >= 3600) { const rem = 600 - ((c - 3600) % 600); return `OT ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`; }
  const q = Math.floor(c / 900) + 1; const rem = 900 - (c % 900);
  return `Q${q} ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
};

/** "@ LAR 30"-style spot text from yards-to-endzone + the two teams. */
const spotText = (yte: number, tm: string, away: string, home: string): string => {
  if (yte === 50) return 'at 50';
  const opp = tm === away ? home : away;
  return yte > 50 ? `at ${tm} ${100 - yte}` : `at ${opp} ${yte}`;
};

/** Lazy-load a week's game feeds; returns a bump that flips once loaded. */
function useGameFeedWeek(week: number): void {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    let live = true;
    loadGameFeedWeek(week).then(() => { if (live) setLoaded((n) => n + 1); });
    return () => { live = false; };
  }, [week]);
}

export function FieldView({ week, team, clock }: { week: number; team?: string | null; clock: number }) {
  useGameFeedWeek(week);
  const feed = gameFeedFor(week, team);
  if (!feed) return null;
  return <Field feed={feed} clock={clock} />;
}

/** Both sides of a slot: ONE field when the two players share an NFL game,
 *  else side-by-side (stacked on mobile). Renders nothing with no feed. */
export function SlotFieldViews({ week, youTeam, theirTeam, youClock, theirClock }: {
  week: number; youTeam?: string | null; theirTeam?: string | null; youClock: number; theirClock: number;
}) {
  useGameFeedWeek(week);
  const isMobile = useIsMobile();
  const you = gameFeedFor(week, youTeam);
  const their = gameFeedFor(week, theirTeam);
  if (!you && !their) return null;
  if (you && their && you.key === their.key) return <Field feed={you} clock={Math.max(youClock, theirClock)} />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile || !you || !their ? '1fr' : '1fr 1fr', gap: 6 }}>
      {you && <Field feed={you} clock={youClock} />}
      {their && <Field feed={their} clock={theirClock} />}
    </div>
  );
}

function Field({ feed, clock }: { feed: TeamGameFeed; clock: number }) {
  const { away, home, plays } = feed;
  // Latest play at/under the feed clock = the play being shown; the next one
  // (regardless of clock) carries the authoritative resulting down & spot.
  const idx = useMemo(() => {
    let i = -1;
    for (let j = 0; j < plays.length; j++) { if (plays[j].c <= clock) i = j; else break; }
    return i;
  }, [plays, clock]);
  const cur: GamePlay | null = idx >= 0 ? plays[idx] : null;
  const nxt: GamePlay | null = idx + 1 < plays.length ? plays[idx + 1] : null;
  const over = cur != null && !nxt; // final play shown

  // x position of a yards-to-endzone spot for a possession team. The away team
  // always attacks right, home attacks left, so the spot is continuous across
  // possession changes (a punt lands where the return starts).
  const xOf = (yte: number, tm: string) => FX + ((tm === away ? 100 - yte : yte) / 100) * FW;

  // Ball spot after the current play: the next play's start situation when we
  // have it (authoritative — penalties, spots), else the current play's end.
  const ballTm = nxt ? nxt.tm : cur ? (cur.tm2 ?? cur.tm) : null;
  const ballX = nxt ? xOf(nxt.yl, nxt.tm) : cur ? xOf(cur.yl2, cur.tm2 ?? cur.tm) : null;
  const attacksRight = ballTm === away;
  // First-down target line (only when a normal down is coming up).
  const fdX = nxt && nxt.dn > 0 && nxt.dist > 0 && nxt.dist < nxt.yl
    ? xOf(nxt.yl - nxt.dist, nxt.tm) : null;

  const isPassy = cur ? /Pass|Interception|Punt|Kickoff|Field Goal/.test(cur.ty) : false;
  const arc = cur && cur.yl !== cur.yl2 ? {
    x1: xOf(cur.yl, cur.tm), x2: xOf(cur.yl2, cur.tm2 ?? cur.tm),
    color: cur.sc ? 'var(--warn)' : cur.to ? 'var(--fx-nuke)' : 'var(--dimstrong)',
  } : null;
  const midY = (TOP + BOT) / 2;

  const situation = over ? 'FINAL'
    : !cur ? 'AWAITING KICKOFF'
    : nxt && nxt.dn > 0 ? `${ORD[nxt.dn].toUpperCase()} & ${nxt.dist} · ${spotText(nxt.yl, nxt.tm, away, home).toUpperCase()}`
    : (cur.sc ? (/TOUCHDOWN/i.test(cur.txt) ? 'TOUCHDOWN' : 'SCORE') : (nxt ? nxt.ty.toUpperCase() : ''));
  const score = cur ? { a: cur.as, h: cur.hs } : { a: 0, h: 0 };

  const logo = ballTm ? teamLogo(ballTm) : null;
  const yardNums = [10, 20, 30, 40, 50, 40, 30, 20, 10];

  return (
    <div style={{ marginTop: 5, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '6px 8px 7px' }}>
      {/* score + clock strip */}
      <div className="mono" style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'baseline', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', marginBottom: 3 }}>
        <span style={{ color: ballTm === away ? 'var(--text)' : 'var(--dim)' }}>{away} {score.a}</span>
        <span style={{ color: 'var(--faint)', fontWeight: 400 }}>{over ? 'FINAL' : fmtQClock(Math.max(clock, cur?.c ?? 0))}</span>
        <span style={{ color: ballTm === home ? 'var(--text)' : 'var(--dim)' }}>{score.h} {home}</span>
      </div>
      {/* the field, with a light perspective tilt */}
      <div style={{ perspective: 560 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', transform: 'rotateX(20deg)', transformOrigin: '50% 100%' }}>
          {/* turf + end zones */}
          <rect x={FX} y={TOP} width={FW} height={BOT - TOP} fill="color-mix(in srgb, var(--you) 5%, var(--surface))" />
          <rect x={0} y={TOP} width={EZ} height={BOT - TOP} fill="color-mix(in srgb, var(--dim) 16%, var(--surface))" />
          <rect x={W - EZ} y={TOP} width={EZ} height={BOT - TOP} fill="color-mix(in srgb, var(--dim) 16%, var(--surface))" />
          <text x={EZ / 2} y={midY} fill="var(--dim)" fontSize={9} fontWeight={700} textAnchor="middle" transform={`rotate(-90 ${EZ / 2} ${midY})`} style={{ letterSpacing: '0.2em' }}>{away}</text>
          <text x={W - EZ / 2} y={midY} fill="var(--dim)" fontSize={9} fontWeight={700} textAnchor="middle" transform={`rotate(90 ${W - EZ / 2} ${midY})`} style={{ letterSpacing: '0.2em' }}>{home}</text>
          {/* yard lines + numbers */}
          {Array.from({ length: 21 }, (_, i) => (
            <line key={i} x1={FX + (i / 20) * FW} y1={TOP} x2={FX + (i / 20) * FW} y2={BOT}
              stroke={i % 2 ? 'color-mix(in srgb, var(--bd) 55%, transparent)' : 'var(--bd)'} strokeWidth={i === 0 || i === 20 ? 1.6 : 0.7} />
          ))}
          {yardNums.map((n, i) => (
            <text key={i} x={FX + ((i + 1) / 10) * FW} y={BOT - 4} fill="var(--faint)" fontSize={6.5} textAnchor="middle" className="mono">{n}</text>
          ))}
          {/* first-down line */}
          {!over && fdX != null && <line x1={fdX} y1={TOP} x2={fdX} y2={BOT} stroke="var(--warn)" strokeWidth={1.4} opacity={0.9} />}
          {/* last-play arc (re-mounts per play → draw animation) */}
          {arc && (
            <path key={cur!.pid ?? cur!.c} d={isPassy
              ? `M ${arc.x1} ${midY} Q ${(arc.x1 + arc.x2) / 2} ${TOP - 6} ${arc.x2} ${midY}`
              : `M ${arc.x1} ${midY} L ${arc.x2} ${midY}`}
              fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round"
              pathLength={1} strokeDasharray={1} style={{ animation: 'fvdraw .55s ease both' }} />
          )}
          {/* line of scrimmage + ball marker (transitions to each new spot) */}
          {ballX != null && !over && (
            <g style={{ transform: `translateX(${ballX}px)`, transition: 'transform .55s ease' }}>
              <line x1={0} y1={TOP} x2={0} y2={BOT} stroke="var(--dimstrong)" strokeWidth={1.1} />
              {/* abbr badge always drawn; the logo (when available) covers it */}
              <circle cx={0} cy={midY} r={8.5} fill="var(--surface)" stroke="var(--dimstrong)" strokeWidth={1} />
              <text x={0} y={midY + 2.5} fill="var(--text)" fontSize={6} fontWeight={700} textAnchor="middle" className="mono">{ballTm}</text>
              {logo && <image href={logo} x={-9} y={midY - 9} width={18} height={18} style={cur?.sc ? { animation: 'bpulse 1s ease 2' } : undefined} />}
              {/* drive direction */}
              <text x={attacksRight ? 13 : -13} y={midY + 2.5} fill="var(--faint)" fontSize={7} textAnchor="middle">{attacksRight ? '▶' : '◀'}</text>
            </g>
          )}
        </svg>
      </div>
      {/* situation chip + play text */}
      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: cur?.sc ? 'var(--warn)' : 'var(--you)', border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 7px', background: 'var(--surface)' }}>{situation}</span>
      </div>
      {cur && (
        <div style={{ fontSize: 10.5, lineHeight: 1.35, color: 'var(--text)', textAlign: 'center', marginTop: 4, overflowWrap: 'anywhere' }} key={cur.pid ?? cur.c} className="fv-txt">
          {cur.txt}
        </div>
      )}
    </div>
  );
}
