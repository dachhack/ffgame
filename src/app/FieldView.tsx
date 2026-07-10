// FieldView — the Sleeper-style live field visual for one NFL game: a drive
// chart with the ball marker, first-down line, last-play arc, down & distance
// chip and the play text, all driven by the SAME feed clock as the rest of the
// live board (plays with c <= clock are visible; the latest one is rendered).
// Data comes from the per-game feed (src/data/gameFeed.ts) baked/polled from
// ESPN — the engine's RealPlay data has no field position, this is a parallel
// read-only track for the visual only.
//
// Three exports: FieldView (one team's game), SlotFieldViews (a slot's one-or-
// two games, collapsible), FieldBoard (full-screen grid of EVERY slotted game,
// with plays tinted by whose roster made them — you vs opponent).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gameFeedFor, loadGameFeedWeek, type GamePlay, type TeamGameFeed } from '../data/gameFeed';
import { isPreseasonWeek, preseasonWeekNum } from '../data/nflSlate';
import { teamLogo } from '../data/media';
import { useIsMobile } from './ui';

// Geometry (SVG user units). The 100-yd field spans FX..FX+FW; EZ = end zone.
const W = 400, H = 130, EZ = 26, FX = EZ, FW = W - 2 * EZ, TOP = 12, BOT = H - 16;
const ORD = ['', '1st', '2nd', '3rd', '4th'];

// Which roster a play belongs to — 'you' tints the visual green-side (--you),
// 'their' red-side (--opp), 'both' (turnovers, tackles on your runner) amber.
export type PlaySide = 'you' | 'their' | 'both';

const fmtQClock = (c: number): string => {
  if (c >= 3600) { const rem = 600 - ((c - 3600) % 600); return `OT ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`; }
  const q = Math.floor(c / 900) + 1; const rem = 900 - (c % 900);
  return `Q${q} ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
};

/** "at LAR 30"-style spot text from yards-to-endzone + the two teams. */
const spotText = (yte: number, tm: string, away: string, home: string): string => {
  if (yte === 50) return 'at 50';
  const opp = tm === away ? home : away;
  return yte > 50 ? `at ${tm} ${100 - yte}` : `at ${opp} ${yte}`;
};

/** Lazy-load a week's game feeds; returns a counter that bumps once they land
 *  (usable as a memo dep to recompute when the fetch resolves). */
function useGameFeedWeek(week: number): number {
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    let live = true;
    loadGameFeedWeek(week).then(() => { if (live) setLoaded((n) => n + 1); });
    return () => { live = false; };
  }, [week]);
  return loaded;
}

/** Collapsible shell for the slot-row fields — a slim FIELD chip when closed. */
function FieldCollapse({ children }: { children: ReactNode }) {
  const [openF, setOpenF] = useState(true);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <button onClick={() => setOpenF((o) => !o)} className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: openF ? 'var(--you)' : 'var(--faint)', background: 'var(--surface)', border: `1px solid ${openF ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 3, padding: '2px 6px' }}>
          ⬢ FIELD {openF ? '▴' : '▾'}
        </button>
      </div>
      {openF && children}
    </div>
  );
}

export function FieldView({ week, team, clock, collapsible }: { week: number; team?: string | null; clock: number; collapsible?: boolean }) {
  useGameFeedWeek(week);
  const feed = gameFeedFor(week, team);
  if (!feed) return null;
  const field = <Field feed={feed} clock={clock} />;
  return collapsible ? <FieldCollapse>{field}</FieldCollapse> : field;
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
  return (
    <FieldCollapse>
      {you && their && you.key === their.key
        ? <Field feed={you} clock={Math.max(youClock, theirClock)} />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile || !you || !their ? '1fr' : '1fr 1fr', gap: 6 }}>
            {you && <Field feed={you} clock={youClock} />}
            {their && <Field feed={their} clock={theirClock} />}
          </div>
        )}
    </FieldCollapse>
  );
}

// ── The full-screen "all games" board ────────────────────────────────────────
// Nothing but fields: every NFL game with a slotted player, one drive chart
// each, plays tinted by OUTCOME — the pids each side actually banked points or
// fired an effect on (computed by the caller from the slot event logs), not
// mere participation. Entries carry each slotted player's team, the feed clock
// its side is sampled at (mirrors the slot rows), and those outcome pids.
export interface FieldBoardEntry { playerId: string; team?: string | null; side: 'you' | 'their'; clock: number; pids?: number[]; }

export function FieldBoard({ week, entries, onClose }: { week: number; entries: FieldBoardEntry[]; onClose: () => void }) {
  const feedLoaded = useGameFeedWeek(week);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Follow mode: when a new play lands on any field, scroll that field into
  // view so you're not hunting up and down the grid. Sticky via localStorage.
  const [follow, setFollow] = useState(() => { try { return localStorage.getItem('dripFieldFollow') === '1'; } catch { return false; } });
  const toggleFollow = () => setFollow((f) => { const n = !f; try { localStorage.setItem('dripFieldFollow', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const lastSeen = useRef<Map<string, number> | null>(null); // game key → visible-play count
  const lastScrollAt = useRef(0);
  const lastTarget = useRef<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null); // brief highlight on the followed card

  // Group entries by NFL game; per game take the furthest clock and build the
  // pid → side index from each slotted player's real plays (pids are unique
  // within a game, and each group only indexes players in that game).
  const games = useMemo(() => {
    const m = new Map<string, { feed: TeamGameFeed; clock: number; you: Set<number>; their: Set<number> }>();
    for (const e of entries) {
      const feed = gameFeedFor(week, e.team);
      if (!feed) continue;
      let g = m.get(feed.key);
      if (!g) { g = { feed, clock: 0, you: new Set(), their: new Set() }; m.set(feed.key, g); }
      g.clock = Math.max(g.clock, e.clock);
      const pids = e.side === 'you' ? g.you : g.their;
      for (const pid of e.pids ?? []) pids.add(pid);
    }
    return [...m.values()];
  }, [entries, week, feedLoaded]);

  // Detect a play landing: per game, count the plays at/under its clock; when
  // that count grows, the newest of those plays just became visible. Scroll to
  // the game with the "biggest" fresh play (a score wins, else the latest by
  // game clock), with a cooldown so a burst of ticks doesn't thrash the page.
  // The first pass only seeds the counts — opening the board never scrolls.
  useEffect(() => {
    const counts = new Map<string, number>();
    for (const g of games) {
      let n = 0;
      for (const p of g.feed.plays) { if (p.c <= g.clock) n++; else break; }
      counts.set(g.feed.key, n);
    }
    const prev = lastSeen.current;
    lastSeen.current = counts;
    if (!prev || !follow) return;
    // Games that just landed a play, scores first (a TD/FG always wins focus);
    // otherwise rotate away from the game we last jumped to, so when several
    // games land plays together the attention cycles instead of pinning to one.
    const landed = games
      .map((g) => ({ key: g.feed.key, n: counts.get(g.feed.key) ?? 0, prev: prev.get(g.feed.key) ?? 0, plays: g.feed.plays }))
      .filter((x) => x.n > x.prev)
      .map((x) => ({ key: x.key, sc: !!x.plays[x.n - 1]?.sc }));
    if (!landed.length || Date.now() - lastScrollAt.current < 1500) return;
    // Round-robin: continue from wherever we last jumped, so every landing
    // field gets visited in turn instead of the grid's first one winning.
    const score = landed.find((x) => x.sc);
    const after = landed.findIndex((x) => x.key === lastTarget.current);
    const target = (score ?? landed[(after + 1) % landed.length]).key;
    lastScrollAt.current = Date.now();
    lastTarget.current = target;
    cardRefs.current.get(target)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusKey(target);
    window.setTimeout(() => setFocusKey((cur) => (cur === target ? null : cur)), 1800);
  }, [games, follow]);

  const dot = (color: string, label: string) => (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />{label}
    </span>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--bg)', overflow: 'auto', padding: '14px 14px 30px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--text)' }}>▦ ALL GAMES · {isPreseasonWeek(week) ? `PRESEASON WK ${preseasonWeekNum(week)}` : `WEEK ${week}`}</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={toggleFollow} className="mono" aria-pressed={follow}
              title="auto-scroll to the field where the newest play just landed"
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: follow ? 'var(--on-accent)' : 'var(--dim)', background: follow ? 'var(--you)' : 'var(--surface)', border: `1px solid ${follow ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '6px 12px' }}>
              {follow ? '◉ FOLLOW: ON' : '○ FOLLOW PLAYS'}
            </button>
            <button onClick={onClose} className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '6px 12px' }}>✕ CLOSE</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
          {dot('var(--you)', 'SCORED FOR YOU')}
          {dot('var(--opp)', 'FOR OPPONENT')}
          {dot('var(--warn)', 'BOTH')}
        </div>
        {games.length === 0 && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.1em', textAlign: 'center', padding: '40px 0' }}>— NO GAME FEEDS FOR THIS WEEK —</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 350px), 1fr))', gap: 10 }}>
          {games.map((g) => (
            <div key={g.feed.key}
              ref={(el) => { if (el) cardRefs.current.set(g.feed.key, el); else cardRefs.current.delete(g.feed.key); }}
              style={{ borderRadius: 6, outline: focusKey === g.feed.key ? '2px solid var(--you)' : '2px solid transparent', outlineOffset: 2, transition: 'outline-color .4s ease' }}>
              <Field feed={g.feed} clock={g.clock} pidSide={(pid) => {
                if (pid == null) return null;
                const y = g.you.has(pid), t = g.their.has(pid);
                return y && t ? 'both' : y ? 'you' : t ? 'their' : null;
              }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ feed, clock, pidSide }: { feed: TeamGameFeed; clock: number; pidSide?: (pid?: number) => PlaySide | null }) {
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
  // Red zone: the upcoming snap is inside the 20 — pulse the attacked end zone.
  const redZone = !over && nxt != null && nxt.dn > 0 && nxt.yl <= 20;

  // Scoring takeover: the TD/FG is chased at the SAME game-clock second by its
  // XP and the ensuing kickoff, so the scoring play is almost never the latest
  // visible play. Take the most recent score within the last 3 plays — it stays
  // up through the special-teams sandwich and drops on the next real snap.
  let si = -1;
  for (let j = idx; j >= 0 && j > idx - 3; j--) if (plays[j].sc && !/Extra Point|Two-Point/i.test(plays[j].ty)) { si = j; break; }
  const takeover: GamePlay | null = si >= 0 ? plays[si] : null;
  // Who scored: the side whose score moved (tm is the OFFENSE at the snap, which
  // is the wrong team on pick-sixes / fumble returns / safeties).
  const scoredTm = takeover
    ? (si > 0 && takeover.as > plays[si - 1].as ? away : si > 0 && takeover.hs > plays[si - 1].hs ? home : takeover.tm)
    : null;

  // Whose roster made the shown play — tints arc, chip, text and card border.
  const side = cur ? pidSide?.(cur.pid) ?? null : null;
  const accent = side === 'you' ? 'var(--you)' : side === 'their' ? 'var(--opp)' : side === 'both' ? 'var(--warn)' : null;

  const isPassy = cur ? /Pass|Interception|Punt|Kickoff|Field Goal/.test(cur.ty) : false;
  const arc = cur && cur.yl !== cur.yl2 ? {
    x1: xOf(cur.yl, cur.tm), x2: xOf(cur.yl2, cur.tm2 ?? cur.tm),
    color: accent ?? (cur.sc ? 'var(--warn)' : cur.to ? 'var(--fx-nuke)' : 'var(--dimstrong)'),
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
    <div style={{ marginTop: 5, background: 'var(--bg)', border: `1px solid ${accent ? `color-mix(in srgb, ${accent} 55%, var(--bd))` : 'var(--bd)'}`, boxShadow: accent ? `0 0 12px color-mix(in srgb, ${accent} 18%, transparent)` : undefined, borderRadius: 4, padding: '6px 8px 7px', transition: 'border-color .3s ease, box-shadow .3s ease' }}>
      {/* score + clock strip */}
      <div className="mono" style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'baseline', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', marginBottom: 3 }}>
        <span style={{ color: ballTm === away ? 'var(--text)' : 'var(--dim)' }}>{away} {score.a}</span>
        <span style={{ color: 'var(--faint)', fontWeight: 400 }}>{over ? 'FINAL' : fmtQClock(Math.max(clock, cur?.c ?? 0))}</span>
        <span style={{ color: ballTm === home ? 'var(--text)' : 'var(--dim)' }}>{score.h} {home}</span>
      </div>
      {/* the field, with a light perspective tilt */}
      <div style={{ perspective: 560, position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', transform: 'rotateX(20deg)', transformOrigin: '50% 100%' }}>
          {/* turf + end zones */}
          <rect x={FX} y={TOP} width={FW} height={BOT - TOP} fill="color-mix(in srgb, var(--you) 5%, var(--surface))" />
          <rect x={0} y={TOP} width={EZ} height={BOT - TOP} fill="color-mix(in srgb, var(--dim) 16%, var(--surface))" />
          <rect x={W - EZ} y={TOP} width={EZ} height={BOT - TOP} fill="color-mix(in srgb, var(--dim) 16%, var(--surface))" />
          {/* red-zone glow on the end zone under attack */}
          {redZone && (
            <rect x={attacksRight ? W - EZ : 0} y={TOP} width={EZ} height={BOT - TOP}
              fill="color-mix(in srgb, var(--fx-nuke) 32%, var(--surface))" style={{ animation: 'bpulse 1.4s ease infinite' }} />
          )}
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
              <line x1={0} y1={TOP} x2={0} y2={BOT} stroke={accent ?? 'var(--dimstrong)'} strokeWidth={1.1} />
              {/* abbr badge always drawn; the logo (when available) covers it */}
              <circle cx={0} cy={midY} r={8.5} fill="var(--surface)" stroke={accent ?? 'var(--dimstrong)'} strokeWidth={1} />
              <text x={0} y={midY + 2.5} fill="var(--text)" fontSize={6} fontWeight={700} textAnchor="middle" className="mono">{ballTm}</text>
              {logo && <image href={logo} x={-9} y={midY - 9} width={18} height={18} style={cur?.sc ? { animation: 'bpulse 1s ease 2' } : undefined} />}
              {/* drive direction */}
              <text x={attacksRight ? 13 : -13} y={midY + 2.5} fill="var(--faint)" fontSize={7} textAnchor="middle">{attacksRight ? '▶' : '◀'}</text>
            </g>
          )}
        </svg>
        {/* scoring-play takeover — pops over the field, holds, fades (pure CSS) */}
        {takeover && (() => {
          const tAccent = pidSide ? (() => {
            const s = pidSide(takeover.pid);
            return s === 'you' ? 'var(--you)' : s === 'their' ? 'var(--opp)' : s === 'both' ? 'var(--warn)' : null;
          })() : null;
          return (
            <div key={`ta${takeover.pid ?? takeover.c}`} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', animation: 'fvtakeover 2.8s ease both' }}>
              <span className="mono" style={{ fontSize: 'clamp(18px, 6vw, 30px)', fontWeight: 800, letterSpacing: '0.18em', color: tAccent ?? 'var(--warn)', textShadow: '0 0 18px color-mix(in srgb, currentColor 60%, transparent), 0 2px 10px rgba(0,0,0,.5)' }}>
                {/TOUCHDOWN/i.test(takeover.txt) ? 'TOUCHDOWN' : takeover.ty.startsWith('Field Goal') ? 'FIELD GOAL' : /SAFETY/.test(takeover.txt) ? 'SAFETY' : 'SCORE'}
              </span>
              <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--text)', textShadow: '0 1px 6px rgba(0,0,0,.6)', marginTop: 2 }}>
                {scoredTm} · {away} {takeover.as} — {takeover.hs} {home}
              </span>
            </div>
          );
        })()}
      </div>
      {/* situation chip + play text */}
      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: accent ?? (cur?.sc ? 'var(--warn)' : 'var(--you)'), border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 7px', background: 'var(--surface)' }}>{situation}</span>
      </div>
      {cur && (
        <div style={{ fontSize: 10.5, lineHeight: 1.35, color: 'var(--text)', textAlign: 'center', marginTop: 4, overflowWrap: 'anywhere' }} key={cur.pid ?? cur.c} className="fv-txt">
          {accent && <span style={{ color: accent }}>● </span>}{cur.txt}
        </div>
      )}
    </div>
  );
}
