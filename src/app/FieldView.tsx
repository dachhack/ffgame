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
import { gameFeedFor, loadGameFeedWeek, type GamePlay, type TeamGameFeed, type ScheduledGame, groupFieldGames, weekBoxGames, latestPlay } from '@drip/core/data/gameFeed';
import { PlayReader, type ReaderState } from '@drip/core/data/playReader';
import { spokenDown } from '@drip/core/data/spokenPlay';
import { webVoice, hasVoice } from './voice';
import { gameNameResolver } from '@drip/core/engine/gameNames';
import { isPreseasonWeek, preseasonWeekNum, kickoffLabel } from '@drip/core/data/nflSlate';
import { teamLogo, headshot } from '@drip/core/data/media';
import { qClock, situationLabel, driveSummary, playNames, ballCarrier } from '@drip/core/data/gameView';
import { clubNick } from '@drip/core/data/spokenPlay';
import { gamePeople, resolveGamebookPerson, type GamePerson } from '@drip/core/engine/gameNames';
import { playPath, arcControlY, playSide, playSideDy } from '@drip/core/engine/playPath';
import { gameBoxScore, boxTabRows, type BoxRow } from '@drip/core/engine/boxScore';
import { projectedBox } from '@drip/core/engine/projectedBox';
import { slugMeta, stripSlugTag, normTeam } from '@drip/core/data/slugMeta';
import { teamColor } from '@drip/core/data/teamColors';
import { useIsMobile, usePullRefresh, ModalBackdrop } from './ui';
import { openPlayerCard } from './playerCard';

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
  const field = <Field feed={feed} clock={clock} week={week} />;
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
        ? <Field feed={you} clock={Math.max(youClock, theirClock)} week={week} />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile || !you || !their ? '1fr' : '1fr 1fr', gap: 6 }}>
            {you && <Field feed={you} clock={youClock} week={week} />}
            {their && <Field feed={their} clock={theirClock} week={week} />}
          </div>
        )}
    </FieldCollapse>
  );
}

// ── The full-screen "all games" board ────────────────────────────────────────
// Nothing but fields: EVERY NFL game on the week's feed, one drive chart each,
// plays tinted by OUTCOME — the pids each side actually banked points or
// fired an effect on (computed by the caller from the slot event logs), not
// mere participation. Entries carry each slotted player's team, the feed clock
// its side is sampled at (mirrors the slot rows), and those outcome pids.
export interface FieldBoardEntry { playerId: string; team?: string | null; side: 'you' | 'their'; clock: number; pids?: number[]; }

export function FieldBoard({ week, entries, scheduled, onClose, onRefresh }: {
  week: number; entries: FieldBoardEntry[]; onClose: () => void;
  /** The week's fixtures (v0.413.0, founder: "on a non-existing feed, just open
   *  the fields with a kick off time and no data"). A feed only exists once a
   *  play has been ingested, so before the first whistle this screen had
   *  nothing on it — on the day a manager is actually choosing a lineup. The
   *  slate seeds a card per game; the feed still wins wherever it exists. */
  scheduled?: ScheduledGame[];
  /** Pull-to-refresh inside the overlay (v0.369.2, founder: "pull down …
   *  all fields should refresh the … fields"). The board that opened this
   *  passes its own live re-poll; without one the gesture stays off. */
  onRefresh?: () => void;
}) {
  const feedLoaded = useGameFeedWeek(week);
  // The overlay is its own scroller (fixed, overflow auto), so the pull reads
  // ITS scrollTop — window.scrollY never moves inside a fixed sheet.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pullArmed = usePullRefresh(() => onRefresh?.(), !!onRefresh, () => scrollRef.current?.scrollTop ?? 0);
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
  // TAP A FIELD TO MAKE IT BIG (v0.388.1, founder: "click a field to make it
  // show up big"). The tapped card spans the whole grid and moves to the top;
  // the rest stay in their tiles below it. Tap again (or another field) to
  // shrink. The field is an SVG with a viewBox, so it simply scales.
  const [bigKey, setBigKey] = useState<string | null>(null);

  // THE GROUPING RULE LIVES IN CORE (v0.340.1): every game on the feed gets a
  // card, entry games are overlaid for tint + slot clock, yours sort first —
  // groupFieldGames carries the full story (and check-field-board pins it
  // directly instead of pinning a reimplementation). feedLoaded is a real
  // dependency: the memo must recompute when the week's feed arrives.
  const games = useMemo(() => groupFieldGames(week, entries, scheduled), [entries, week, feedLoaded, scheduled]);
  const shown = useMemo(() => (bigKey ? [...games].sort((a, b) => (a.feed.key === bigKey ? -1 : b.feed.key === bigKey ? 1 : 0)) : games), [games, bigKey]);
  const readerGame = (bigKey ? games.find((g) => g.feed.key === bigKey) : null) ?? games[0] ?? null;

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
    // overscrollBehaviorY 'contain': reaching this scroller's top must not
    // chain the pull out to the browser's own gesture (a page reload that
    // boots to the default screen — the founder's "kicks you back to your
    // leagues"). The board's own pull-to-refresh handles the intent instead.
    <div ref={scrollRef} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--bg)', overflow: 'auto', overscrollBehaviorY: 'contain', padding: '14px 14px 30px' }}>
      {pullArmed && (
        <div className="mono" style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'var(--surface)', border: '1px solid var(--bdh, var(--bd))', borderRadius: 14, padding: '5px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', boxShadow: '0 6px 18px rgba(0,0,0,0.35)' }}>
          ↻ RELEASE TO REFRESH
        </div>
      )}
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
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--faint)', marginLeft: 'auto' }}>{bigKey ? 'TAP THE BIG FIELD TO SHRINK IT' : 'TAP A FIELD FOR ITS GAME VIEW · THE READER FOLLOWS IT'}</span>
        </div>
        {/* 🔊 THE READER FOLLOWS THE FIELD YOU ENLARGED (v0.390.2, founder):
            bound to the big field, else the first game; keyed so switching
            fields swaps the reader and the old one stops. */}
        {readerGame && (
          <div style={{ border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--surface)', padding: 8, marginBottom: 10 }}>
            <ReaderBar key={readerGame.feed.key} feed={readerGame.feed} week={week}
              label={`🔊 ${readerGame.feed.away} @ ${readerGame.feed.home}${bigKey ? '' : ' · TAP A FIELD TO READ ANOTHER'}`} />
          </div>
        )}
        {games.length === 0 && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.1em', textAlign: 'center', padding: '40px 0' }}>— NO GAMES SCHEDULED FOR THIS WEEK —</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 350px), 1fr))', gap: 10 }}>
          {shown.map((g) => (
            <div key={g.feed.key}
              ref={(el) => { if (el) cardRefs.current.set(g.feed.key, el); else cardRefs.current.delete(g.feed.key); }}
              onClick={(e) => {
                // The card's own controls (↔ flip, BOX SCORE, the box score's
                // close) keep their clicks; anywhere else on the card toggles.
                if ((e.target as HTMLElement).closest('button, a, input')) return;
                setBigKey((k) => (k === g.feed.key ? null : g.feed.key));
              }}
              title={bigKey === g.feed.key ? 'tap to shrink' : 'tap to enlarge'}
              style={{ borderRadius: 6, outline: focusKey === g.feed.key ? '2px solid var(--you)' : '2px solid transparent', outlineOffset: 2, transition: 'outline-color .4s ease', cursor: 'pointer',
                ...(bigKey === g.feed.key ? { gridColumn: '1 / -1', maxWidth: 900, width: '100%', justifySelf: 'center' } : {}) }}>
              {bigKey === g.feed.key
                ? <GameView feed={g.feed} week={week} clock={g.clock} pidSide={(pid) => {
                    if (pid == null) return null;
                    const y = g.you.has(pid), t = g.their.has(pid);
                    return y && t ? 'both' : y ? 'you' : t ? 'their' : null;
                  }} />
                : <Field feed={g.feed} clock={g.clock} week={week} pidSide={(pid) => {
                    if (pid == null) return null;
                    const y = g.you.has(pid), t = g.their.has(pid);
                    return y && t ? 'both' : y ? 'you' : t ? 'their' : null;
                  }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Who has the ball on the shown play — drawn at the spot with his headshot
 *  and name (v0.390.3, Sleeper's K. Walker marker). Null = the plain badge. */
export type Carrier = { slug: string; name: string } | null;

function Field({ feed, clock, week, pidSide, carrierOf }: { feed: TeamGameFeed; clock: number; week: number; pidSide?: (pid?: number) => PlaySide | null; carrierOf?: (p: GamePlay) => Carrier }) {
  const { away, home, plays } = feed;
  // ↔ mirror this game's field to match the viewer's TV broadcast — the feed
  // carries no camera orientation, so the default (away attacks right) is a
  // convention; the flip is remembered per game.
  const [flip, setFlip] = useState(() => { try { return localStorage.getItem(`fvflip:${feed.key}`) === '1'; } catch { return false; } });
  const [boxOpen, setBoxOpen] = useState(false);
  const [pbpOpen, setPbpOpen] = useState(false); // ≣ PLAY BY PLAY panel (v0.389.0)
  const toggleFlip = () => setFlip((f) => { const n = !f; try { localStorage.setItem(`fvflip:${feed.key}`, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const mx = (x: number) => (flip ? W - x : x); // mirror an x coordinate
  // Latest play at/under the feed clock = the play being shown; the next one
  // (regardless of clock) carries the authoritative resulting down & spot.
  const liveIdx = useMemo(() => {
    let i = -1;
    for (let j = 0; j < plays.length; j++) { if (plays[j].c <= clock) i = j; else break; }
    return i;
  }, [plays, clock]);
  // ‹ › STEP THE PLAYS (v0.390.2, founder: "a way to rewind or go forward
  // each play in the field view"). `pin` is an absolute play index; null
  // follows the clock (live). Pinned, the card draws that play exactly as it
  // drew it when it landed and stays there while new plays arrive; › past
  // the last play goes live.
  const [pin, setPin] = useState<number | null>(null);
  const idx = pin != null ? Math.min(pin, plays.length - 1) : liveIdx;
  const stepTo = (i: number) => setPin(i >= plays.length - 1 && i >= liveIdx ? null : Math.max(0, i));
  const cur: GamePlay | null = idx >= 0 ? plays[idx] : null;
  const nxt: GamePlay | null = idx + 1 < plays.length ? plays[idx + 1] : null;
  const carrier: Carrier = cur && carrierOf ? carrierOf(cur) : null;
  const carrierImg = carrier ? headshot(carrier.slug) : null;
  // Final play shown. "No next play yet" alone reads a live halftime as game
  // over — trust the real game state when the live feed carries it, else
  // require the shown play to sit in late Q4 (baked replays always do).
  const over = cur != null && !nxt && (feed.st ? feed.st === 'post' : cur.c >= 3300);

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
  const incomplete = cur ? /Incompletion/.test(cur.ty) : false;
  // Incompletions never move the spot (yl === yl2), so draw a stylized throw:
  // a fixed-depth arc toward the attacked end zone, ending in an ✕.
  const INCOMPLETE_DEPTH = 12;
  const arc = cur && (cur.yl !== cur.yl2 || incomplete) ? {
    x1: mx(xOf(cur.yl, cur.tm)),
    x2: incomplete
      ? mx(xOf(Math.max(0, cur.yl - INCOMPLETE_DEPTH), cur.tm))
      : mx(xOf(cur.yl2, cur.tm2 ?? cur.tm)),
    color: accent ?? (cur.sc ? 'var(--warn)' : cur.to ? 'var(--fx-nuke)' : 'var(--dimstrong)'),
  } : null;
  // Split point: where the ball stopped FLYING and started being CARRIED.
  // Completed pass with YAC → the catch point (air arc, then run-after line).
  // Kick/punt with a return → the field/catch spot (kick arc, then runback
  // line — the returner ends at yl2 having run `ret` yards, so the catch sits
  // ret yards behind it in the return team's coordinates; a catch inside the
  // end zone maps past 100 and renders there naturally).
  // Through playPath (v0.332.0) so the two ports cannot drift on geometry
  // they each used to own a copy of — and so `overlaps`, the property that
  // made a returned kick look like a doubled line, is asserted rather than
  // eyeballed. See engine/playPath.
  // The split point is mirrored exactly as the endpoints are (v0.390.5): the
  // arc's x1/x2 pass through mx(), so xOf here must too, or a ↔-flipped
  // field puts the catch on the wrong side of the snap.
  const { catchX, carrying, overlaps } = playPath(cur, arc?.x1 ?? 0, arc?.x2 ?? 0, (y, tm) => mx(xOf(y, tm)));
  const offLogo = cur ? teamLogo(cur.tm) : null;
  const midY = (TOP + BOT) / 2;
  /** The carried phase rides its own lane just under the flight path — see the
   *  note at the arc. Small enough to read as the same play, big enough that a
   *  runback never lies on top of the kick that produced it. */
  const CARRY_DY = 4;
  // ── THE PLAY GOES WHERE THE TEXT SAYS IT WENT (v0.335.0) ────────────────
  // Founder: "if the play says right or left can we have the play draw on that
  // side of the field?" It does now. The SNAP stays on the centre line — the
  // ball starts between the hashes whatever happens next — and the far end
  // moves to the named side, so the arc leans out and comes down over there.
  //
  // The sign is `playSideDy`'s job because it is the part that gets drawn
  // backwards: "right" is the OFFENSE's right, which is the bottom of the
  // screen only while they are moving right, and mirrors again when the viewer
  // flips the field. `attacksRight` is already the pre-flip direction, so the
  // on-screen one is the same expression the ▶/◀ marker uses.
  const SIDE_LANE = (BOT - TOP) * 0.22;
  const sideDy = playSideDy(playSide(cur?.txt), flip ? !attacksRight : attacksRight, SIDE_LANE);
  const endY = midY + sideDy;
  // ── THE LANE IS FOR DOUBLING BACK, NOT FOR EVERY CARRY (v0.333.0) ────────
  // v0.332.0 put EVERY carried phase on its own lane, which was an
  // over-application of a fix aimed at kick returns. For a pass the run-after
  // continues in the SAME direction and meets the arc end to end — one
  // continuous motion — and dropping it to a second lane split that motion into
  // "a line on the ground and an arch above", which is exactly what the founder
  // then reported. `overlaps` already knew the difference; now it decides.
  const carryY = (overlaps ? midY + CARRY_DY : midY) + sideDy;

  const situation = over ? 'FINAL'
    : !cur ? 'AWAITING KICKOFF'
    : nxt && nxt.dn > 0 ? `${ORD[nxt.dn].toUpperCase()} & ${nxt.dist} · ${spotText(nxt.yl, nxt.tm, away, home).toUpperCase()}`
    : (cur.sc ? (/TOUCHDOWN/i.test(cur.txt) ? 'TOUCHDOWN' : 'SCORE') : (nxt ? nxt.ty.toUpperCase() : ''));
  // Down & distance the CURRENT play was snapped on (dn/dist are pre-snap; the
  // situation chip above shows the RESULTING next snap). Goal-to-go when the
  // sticks reach the goal line. dn 0 = kickoff/PAT — no down to show.
  const curDD = cur && cur.dn > 0 ? `${ORD[cur.dn]} & ${cur.dist >= cur.yl ? 'Goal' : cur.dist}` : null;
  const score = cur ? { a: cur.as, h: cur.hs } : { a: 0, h: 0 };

  const logo = ballTm ? teamLogo(ballTm) : null;
  const yardNums = [10, 20, 30, 40, 50, 40, 30, 20, 10];
  // Brand paint: end zones + possession accents. Mixed toward the surface so
  // both themes keep contrast; text uses each team's own secondary color.
  const awayCol = teamColor(away), homeCol = teamColor(home);
  const ballCol = ballTm ? teamColor(ballTm) : null;
  const ezFill = (tc: ReturnType<typeof teamColor>) => tc ? `color-mix(in srgb, ${tc.c} 72%, var(--surface))` : 'color-mix(in srgb, var(--dim) 16%, var(--surface))';
  const ezText = (tc: ReturnType<typeof teamColor>) => tc ? tc.t : 'var(--dim)';
  const awayLogo = teamLogo(away), homeLogo = teamLogo(home);
  const stripTeam = (abbr: string, lg: string | null, hasBall: boolean) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: hasBall ? 'var(--text)' : 'var(--dim)' }}>
      {lg && <img src={lg} alt="" width={13} height={13} style={{ display: 'block' }} />}
      {abbr}{hasBall && !over ? <span title="has the ball" style={{ fontSize: 8 }}>🏈</span> : null}
    </span>
  );

  return (
    <div style={{ marginTop: 5, background: 'var(--bg)', border: `1px solid ${accent ? `color-mix(in srgb, ${accent} 55%, var(--bd))` : 'var(--bd)'}`, boxShadow: accent ? `0 0 12px color-mix(in srgb, ${accent} 18%, transparent)` : undefined, borderRadius: 4, padding: '6px 8px 7px', transition: 'border-color .3s ease, box-shadow .3s ease' }}>
      {/* score + clock strip — logos + a football on the possession side */}
      <div className="mono" style={{ position: 'relative', display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', marginBottom: 3 }}>
        {stripTeam(away, awayLogo, ballTm === away)}
        <span style={{ color: 'var(--text)' }}>{score.a}</span>
        {/* the LAST PLAY's clock, not the playback clock — the live window clock
            can overshoot the real game (slot bookkeeping past regulation), which
            read a Q4 game as "OT" during the first live-fire. */}
        <span style={{ color: 'var(--faint)', fontWeight: 400 }}>{over ? 'FINAL' : fmtQClock(cur ? cur.c : clock)}</span>
        <span style={{ color: 'var(--text)' }}>{score.h}</span>
        {stripTeam(home, homeLogo, ballTm === home)}
        {/* mirror the field to match your TV broadcast (remembered per game) */}
        <button onClick={toggleFlip} title="flip the field to match your TV" aria-pressed={flip}
          style={{ position: 'absolute', right: 0, top: -2, fontSize: 9, fontWeight: 700, color: flip ? 'var(--you)' : 'var(--faint)', background: 'none', border: `1px solid ${flip ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 3, padding: '1px 5px', cursor: 'pointer', lineHeight: 1.4 }}>↔</button>
      </div>
      {plays.length > 0 && (
        <div className="mono" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 3, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em' }}>
          <button onClick={() => stepTo(idx - 1)} disabled={idx <= 0} title="previous play"
            style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', background: 'none', border: '1px solid var(--bd)', borderRadius: 3, padding: '0 8px', cursor: 'pointer', lineHeight: 1.5, opacity: idx <= 0 ? 0.35 : 1 }}>‹</button>
          <span style={{ color: pin != null ? 'var(--warn)' : 'var(--faint)' }}>{pin != null ? `PLAY ${idx + 1}/${plays.length}` : `LIVE · ${plays.length} PLAYS`}</span>
          <button onClick={() => stepTo(idx + 1)} disabled={pin == null} title="next play"
            style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', background: 'none', border: '1px solid var(--bd)', borderRadius: 3, padding: '0 8px', cursor: 'pointer', lineHeight: 1.5, opacity: pin == null ? 0.35 : 1 }}>›</button>
          {pin != null && (
            <button onClick={() => setPin(null)} title="back to the latest play"
              style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--you)', background: 'none', border: '1px solid var(--you)', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', lineHeight: 1.4 }}>LIVE ▸</button>
          )}
        </div>
      )}
      {/* the field, with a light perspective tilt */}
      <div style={{ perspective: 560, position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', transform: 'rotateX(20deg)', transformOrigin: '50% 100%' }}>
          {/* turf + end zones */}
          <rect x={FX} y={TOP} width={FW} height={BOT - TOP} fill="color-mix(in srgb, var(--you) 5%, var(--surface))" />
          {/* end zones in each team's brand paint (sides swap with ↔ flip) */}
          {(() => {
            const ezAwayX = flip ? W - EZ : 0, ezHomeX = flip ? 0 : W - EZ;
            const label = (x: number, tc: ReturnType<typeof teamColor>, abbr: string) => (
              <text x={x + EZ / 2} y={midY} fill={ezText(tc)} fontSize={9} fontWeight={700} textAnchor="middle"
                transform={`rotate(${x < W / 2 ? -90 : 90} ${x + EZ / 2} ${midY})`} style={{ letterSpacing: '0.2em' }}>{abbr}</text>
            );
            return (
              <>
                <rect x={ezAwayX} y={TOP} width={EZ} height={BOT - TOP} fill={ezFill(awayCol)} />
                <rect x={ezHomeX} y={TOP} width={EZ} height={BOT - TOP} fill={ezFill(homeCol)} />
                {redZone && (
                  <rect x={(flip ? !attacksRight : attacksRight) ? W - EZ : 0} y={TOP} width={EZ} height={BOT - TOP}
                    fill="color-mix(in srgb, var(--fx-nuke) 32%, transparent)" style={{ animation: 'bpulse 1.4s ease infinite' }} />
                )}
                {label(ezAwayX, awayCol, away)}
                {label(ezHomeX, homeCol, home)}
              </>
            );
          })()}
          {/* yard lines + numbers */}
          {Array.from({ length: 21 }, (_, i) => (
            <line key={i} x1={FX + (i / 20) * FW} y1={TOP} x2={FX + (i / 20) * FW} y2={BOT}
              stroke={i % 2 ? 'color-mix(in srgb, var(--bd) 55%, transparent)' : 'var(--bd)'} strokeWidth={i === 0 || i === 20 ? 1.6 : 0.7} />
          ))}
          {yardNums.map((n, i) => (
            <text key={i} x={FX + ((i + 1) / 10) * FW} y={BOT - 4} fill="var(--faint)" fontSize={6.5} textAnchor="middle" className="mono">{n}</text>
          ))}
          {/* first-down line */}
          {!over && fdX != null && <line x1={mx(fdX)} y1={TOP} x2={mx(fdX)} y2={BOT} stroke="var(--warn)" strokeWidth={1.4} opacity={0.9} />}
          {/* last-play arc (re-mounts per play → draw animation). A play splits
              at the catch point: the ball in the AIR rides the centre line, the
              ball being CARRIED rides its own lane just below it, joined by a
              short drop at the catch. The offense logo marks the snap; the play
              ends in a football — or an ✕ for an incompletion.

              ── WHY THE CARRY GETS ITS OWN LANE (v0.332.0) ──────────────────
              Founder, on a punt: "we've got a double line thing going on."
              Both strokes were drawn at midY, which is fine for a pass — the
              run-after continues in the SAME direction, so air and carry meet
              end to end — and wrong for a KICK, where the returner runs back
              the way the ball came. The runback then retraced the flight path
              in the same colour at the same width and y, and read as one line
              drawn twice. Measured against the real geometry (W=400, EZ=26):

                pass + YAC       air 235→287  carry 183→235  meet end to end
                punt + return    air  71→270  carry  71→113  OVERLAP 41.8px
                kickoff + return air  43→252  carry  43→130  OVERLAP 87.0px

              The overlap is not a mistake in the data — the ball really did fly
              out and get run back over the same grass. It is a mistake to draw
              two phases of a play on one line and expect the reader to know
              which is which. */}
          {arc && !over && (
            <g key={cur!.pid ?? cur!.c}>
              <path d={isPassy
                ? `M ${arc.x1} ${midY} Q ${(arc.x1 + (catchX ?? arc.x2)) / 2} ${arcControlY(arc.x1, catchX ?? arc.x2, (midY + endY) / 2, TOP)} ${catchX ?? arc.x2} ${endY}`
                : `M ${arc.x1} ${midY} L ${arc.x2} ${endY}`}
                fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round"
                pathLength={1} strokeDasharray={1} style={{ animation: 'fvdraw .55s ease both' }} />
              {carrying && (
                <path d={overlaps
                  ? `M ${catchX} ${endY} L ${catchX} ${carryY} L ${arc.x2} ${carryY}`
                  : `M ${catchX} ${endY} L ${arc.x2} ${endY}`}
                  fill="none" stroke={arc.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                  pathLength={1} strokeDasharray={1} style={{ animation: 'fvdraw .35s ease .5s both' }} />
              )}
              {offLogo
                ? <image href={offLogo} x={arc.x1 - 5.5} y={midY - 5.5} width={11} height={11} />
                : <circle cx={arc.x1} cy={midY} r={3} fill={arc.color} />}
              {/* The ball ends where the PLAY ended — on the carry lane when the
                  play was carried, or it would float above the runback. */}
              {incomplete
                ? <text x={arc.x2} y={endY + 3} fill="var(--fx-nuke)" fontSize={9} fontWeight={800} textAnchor="middle" style={{ animation: 'fvtxt .3s ease .5s both' }}>✕</text>
                : <text x={arc.x2} y={(carrying ? carryY : endY) + 2.5} fontSize={7} textAnchor="middle" style={{ animation: 'fvtxt .3s ease .5s both' }}>🏈</text>}
            </g>
          )}
          {/* line of scrimmage + ball marker (transitions to each new spot) */}
          {ballX != null && !over && (
            <g style={{ transform: `translateX(${mx(ballX)}px)`, transition: 'transform .55s ease' }}>
              {/* line of scrimmage carries the possession team's color */}
              <line x1={0} y1={TOP} x2={0} y2={BOT} stroke={ballCol?.c ?? accent ?? 'var(--dimstrong)'} strokeWidth={1.4} />
              {/* abbr badge always drawn; the logo (when available) covers it */}
              <circle cx={0} cy={midY} r={10.5} fill={ballCol ? `color-mix(in srgb, ${ballCol.c} 30%, var(--surface))` : 'var(--surface)'} stroke={ballCol?.c ?? accent ?? 'var(--dimstrong)'} strokeWidth={1.4} />
              <text x={0} y={midY + 2.5} fill="var(--text)" fontSize={6} fontWeight={700} textAnchor="middle" className="mono">{ballTm}</text>
              {logo && <image href={logo} x={-10} y={midY - 10} width={20} height={20} style={cur?.sc ? { animation: 'bpulse 1s ease 2' } : undefined} />}
              {/* drive direction in the possession color */}
              {(() => { const right = flip ? !attacksRight : attacksRight; return (
                <text x={right ? 15 : -15} y={midY + 2.5} fill={ballCol?.c ?? 'var(--faint)'} fontSize={8} fontWeight={700} textAnchor="middle">{right ? '▶' : '◀'}</text>
              ); })()}
              {/* the ball carrier, above the spot: headshot in a ring, name under */}
              {carrier && (
                <g>
                  <defs><clipPath id={`fvc-${feed.key}`}><circle cx={0} cy={TOP + 13} r={11} /></clipPath></defs>
                  <circle cx={0} cy={TOP + 13} r={12} fill="var(--surface)" stroke={ballCol?.c ?? 'var(--dimstrong)'} strokeWidth={1.4} />
                  {carrierImg && <image href={carrierImg} x={-11} y={TOP + 2} width={22} height={22} preserveAspectRatio="xMidYMid slice" clipPath={`url(#fvc-${feed.key})`} />}
                  <rect x={-26} y={TOP + 27} width={52} height={9} rx={2} fill="rgba(0,0,0,0.55)" />
                  <text x={0} y={TOP + 34} fill="#fff" fontSize={6.5} fontWeight={700} textAnchor="middle" className="mono">{carrier.name}</text>
                </g>
              )}
            </g>
          )}
        </svg>
        {/* scoring-play takeover — pops over the field, holds, fades (pure CSS) */}
        {takeover && !over && (() => {
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
        {/* ── FINAL banner (v0.342.0) ─────────────────────────────────────
            Founder: "erase the final play from the visual and put a Final
            banner over the game." A finished game's field is a clean pitch —
            no arc, no ball spot, no lingering kneel-down — with the verdict
            stamped across it. The score stays in the strip above; the box
            score below is the post-game artifact worth keeping. */}
        {over && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', background: 'color-mix(in srgb, var(--bg) 35%, transparent)' }}>
            <span className="mono" style={{ fontSize: 'clamp(16px, 5vw, 26px)', fontWeight: 800, letterSpacing: '0.3em', paddingLeft: '0.3em', color: 'var(--text)', textShadow: '0 2px 12px rgba(0,0,0,.55)', border: '1px solid var(--bd)', borderRadius: 5, padding: '3px 14px 3px calc(14px + 0.3em)', background: 'color-mix(in srgb, var(--surface) 82%, transparent)' }}>
              FINAL
            </span>
          </div>
        )}
      </div>
      {/* situation chip + play text */}
      {!over && (
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: accent ?? (cur?.sc ? 'var(--warn)' : 'var(--you)'), border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 7px', background: 'var(--surface)' }}>{situation}</span>
        </div>
      )}
      {cur && !over && (
        <div style={{ fontSize: 10.5, lineHeight: 1.35, color: 'var(--text)', textAlign: 'center', marginTop: 4, overflowWrap: 'anywhere' }} key={cur.pid ?? cur.c} className="fv-txt">
          {accent && <span style={{ color: accent }}>● </span>}
          {curDD && <span className="mono" style={{ fontWeight: 700, fontSize: 9, letterSpacing: '0.06em', color: 'var(--dim)', marginRight: 5 }}>{curDD.toUpperCase()}</span>}
          {cur.txt}
        </div>
      )}
      {/* ── BOX SCORE (v0.336.0) ─────────────────────────────────────────
          Founder: "a small chip at the bottom of the field visual. when you
          click it, you get a pop up with all the players in that game by team
          and their current stat lines."

          EVERYONE in the game, not just the rostered ones — that is the whole
          point, and it is why this cannot be built from the matchup's picks.
          It reads `gameBoxScore`, which accumulates through the same
          `statlineFrom` the cards use, so the popup and the board can never
          disagree about a number.

          It follows the CLOCK, so scrubbing the log scrubs the box score with
          it rather than always reporting the present. */}
      {/* ≣ PLAY BY PLAY beside it (v0.389.0, founder: "expand the play by
          play for each game and have it read off to you — catch up or
          live"): the whole game's plays, inline under the field, with a
          voice. What is said and when is core's (spokenPlay / PlayReader),
          shared with the app; this is the panel and the feed tick. */}
      {/* NOT STARTED (v0.413.0). A card seeded from the slate has no plays and
          nothing to draw on the field, so the time is the whole card — and the
          box score below it is the projected lineup rather than an empty
          sheet. Founder: "just open the fields with a kick off time and no
          data." */}
      {plays.length === 0 && (
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--faint)', textAlign: 'center', marginTop: 4 }}>
          {feed.kickoff ? `KICKS OFF ${kickoffLabel(Date.parse(feed.kickoff))}` : 'NOT STARTED'} · NO PLAYS YET
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 5 }}>
        <button onClick={() => setBoxOpen(true)} className="mono"
          title={`Every player with stats in ${away} @ ${home}`}
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 3, padding: '3px 8px', cursor: 'pointer' }}>
          ▤ BOX SCORE
        </button>
        <button onClick={() => setPbpOpen((v) => !v)} className="mono"
          title={`Every play of ${away} @ ${home}, with a voice`}
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: pbpOpen ? 'var(--you)' : 'var(--dim)', background: 'var(--surface)', border: `1px solid ${pbpOpen ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 3, padding: '3px 8px', cursor: 'pointer' }}>
          ≣ PLAY BY PLAY 🔊 {pbpOpen ? '▴' : '▾'}
        </button>
      </div>
      {pbpOpen && <PlayByPlayPanel feed={feed} week={week} />}
      {boxOpen && <BoxScoreCard week={week} home={home} away={away} clock={pin != null && cur ? cur.c : clock} onClose={() => setBoxOpen(false)} />}
    </div>
  );
}

/** ≣ PLAY BY PLAY — the game's every play, inline, with a voice (v0.389.0).
 *  ▶ CATCH UP reads from the top and keeps going live; ● LIVE reads the latest
 *  play then each new one; ■ STOP. Re-reads the feed every 3s while open so
 *  LIVE follows the poll; the row being read is lit. */
/** Is this game over, by the feed's own state or a late-Q4 last play? */
const feedOver = (feed: TeamGameFeed | null | undefined): boolean => {
  const plays = feed?.plays ?? [];
  const last = plays.length ? plays[plays.length - 1] : null;
  return !!last && (feed?.st ? feed.st === 'post' : last.c >= 3300);
};

/** 🔊 THE READER BAR — CATCH UP · LIVE · STOP for one game (v0.390.2).
 *  Extracted from the panel so the fields board can carry it too (founder:
 *  "have the live play reader work on a field you select"). Owns the core
 *  PlayReader for the feed it is given; `onState` lights a host's row. Key
 *  it by game to switch — the old reader stops on unmount. */
export function ReaderBar({ feed, week, label, onState }: { feed: TeamGameFeed; week: number; label?: string; onState?: (rs: ReaderState) => void }) {
  const { plays, home, away } = feed;
  const over = feedOver(feed);
  const nameOf = useRef(gameNameResolver(week, home, away));
  useEffect(() => { nameOf.current = gameNameResolver(week, home, away); }, [week, home, away]);
  const [rs, setRs] = useState<ReaderState>({ mode: 'idle', cursor: 0, speaking: false, finished: false });
  const reader = useRef<PlayReader | null>(null);
  useEffect(() => {
    const r = new PlayReader(webVoice, { home, away, nameOf: (a) => nameOf.current(a) }, (st) => { setRs(st); onState?.(st); });
    reader.current = r;
    return () => { r.stop(); reader.current = null; };
  }, [home, away]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 3000); return () => clearInterval(id); }, []);
  useEffect(() => { reader.current?.update(plays, over); }, [plays, over, tick]);
  const btn = (text: string, on: boolean, onClick: () => void, tone: string) => (
    <button onClick={onClick} className="mono"
      style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
        color: on ? tone : 'var(--text)', background: on ? `color-mix(in srgb, ${tone} 16%, transparent)` : 'var(--bg)', border: `1px solid ${on ? tone : 'var(--bd)'}` }}>
      {text}
    </button>
  );
  const status = rs.mode === 'catchup' ? `Reading from the top · ${Math.min(rs.cursor, plays.length)}/${plays.length}${over ? '' : ' · goes live when caught up'}`
    : rs.mode === 'live' ? (rs.speaking ? 'Reading the latest play' : over ? 'That’s the final' : 'Live · waiting for the next play')
    : hasVoice() ? 'CATCH UP reads from the top · LIVE reads each play as it lands · voice: ⚙ settings' : 'This browser has no speech engine';
  return (
    <div>
      {label && <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--dim)', textAlign: 'center', marginBottom: 5 }}>{label}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        {btn('▶ CATCH UP', rs.mode === 'catchup', () => reader.current?.catchUp(plays, over), 'var(--you)')}
        {btn(over ? '● FINAL' : '● LIVE', rs.mode === 'live', () => reader.current?.live(plays, over), 'var(--opp)')}
        {btn('■ STOP', false, () => reader.current?.stop(), 'var(--text)')}
      </div>
      <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', textAlign: 'center', marginTop: 5, letterSpacing: '0.04em' }}>{status}</div>
    </div>
  );
}

/** ≣ PLAY BY PLAY — the game's every play, inline, with the reader bar. */
function PlayByPlayPanel({ feed, week }: { feed: TeamGameFeed; week: number }) {
  const { plays, home, away } = feed;
  const [rs, setRs] = useState<ReaderState>({ mode: 'idle', cursor: 0, speaking: false, finished: false });
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el && rs.mode !== 'catchup') el.scrollTop = el.scrollHeight;
  }, [plays.length, rs.mode]);
  const speakingIdx = rs.speaking ? rs.cursor - 1 : -1;
  return (
    <div style={{ marginTop: 8, border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg)', padding: 8 }}>
      <ReaderBar feed={feed} week={week} onState={setRs} />
      <div ref={list} style={{ maxHeight: 280, overflowY: 'auto', marginTop: 6 }}>
        {plays.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', padding: 8 }}>— no plays yet —</div>}
        {plays.map((p, i) => {
          const dd = spokenDown(p);
          const lit = i === speakingIdx;
          return (
            <div key={p.pid ?? `${p.c}-${i}`} title="Double-click to hear this play"
              onDoubleClick={() => { webVoice.stop(); webVoice.speak(`${dd ? dd + '. ' : ''}${p.txt}`, () => {}); }}
              style={{ padding: '5px 4px', borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)', background: lit ? 'color-mix(in srgb, var(--you) 12%, transparent)' : 'transparent', borderRadius: 3 }}>
              <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 8.5, fontWeight: 700, color: 'var(--dim)', marginBottom: 2 }}>
                <span>{fmtQClock(p.c)}</span>
                <span style={{ color: 'var(--dimstrong)' }}>{p.tm}</span>
                {dd && <span>{dd.toUpperCase()}</span>}
                <span style={{ flex: 1 }} />
                {!!p.sc && <span style={{ color: 'var(--warn)', fontWeight: 800 }}>SCORE · {away} {p.as}–{p.hs} {home}</span>}
                {!!p.to && !p.sc && <span style={{ color: 'var(--opp)', fontWeight: 800 }}>TURNOVER</span>}
                {lit && <span style={{ color: 'var(--you)' }}>🔊</span>}
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.35, color: p.sc ? 'var(--text)' : 'var(--dimstrong)', overflowWrap: 'anywhere' }}>{p.txt}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 🏟 THE GAME VIEW — one game, the way Sleeper shows it (v0.390.3).
 *  Founder: "the sleeper field view is pretty good can we emulate this?"
 *  The scoreboard (nicknames, big scores, quarter clock, situation, the
 *  ball on the possession side, club codes faded behind), the LAST PLAY
 *  line, the field with the carrier's headshot at the spot, the drive
 *  line, then LIVE (plays newest first with the people on each and their
 *  lines) and STATS (the box score). The reader bar stays on the board
 *  header, bound to this game. Readings are core's (data/gameView). */
const fullName = (slug: string) => stripSlugTag(slug).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const shortName = (full: string) => { const w = full.split(' '); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(' ')}` : full; };
export function GameView({ feed, week, clock, pidSide }: { feed: TeamGameFeed; week: number; clock: number; pidSide?: (pid?: number) => PlaySide | null }) {
  const { plays, home, away } = feed;
  const last = latestPlay(plays);
  const over = feedOver(feed);
  const live = !over && plays.length > 0 && feed.st !== 'pre';
  const people = useMemo(() => gamePeople(week, home, away), [week, home, away, plays.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useMemo(() => gameBoxScore(week, home, away, Number.MAX_SAFE_INTEGER), [week, home, away, plays.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowOf = useMemo(() => { const m = new Map<string, BoxRow>(); for (const r of [...box.home, ...box.away]) m.set(r.slug, r); return m; }, [box]);
  const personOf = (abbr: string): GamePerson | null => resolveGamebookPerson(people, abbr);
  const carrierOf = (p: GamePlay): Carrier => { const a = ballCarrier(p); const who = a ? personOf(a) : null; return who ? { slug: who.slug, name: shortName(who.full) } : null; };
  const [tab, setTab] = useState<'live' | 'stats'>('live');
  const [statTab, setStatTab] = useState<'off' | 'def'>('off');
  const drive = driveSummary(feed);
  const sit = last ? situationLabel(last, home, away) : null;
  const ballTm = last ? (last.tm2 ?? last.tm) : null;
  const hc = teamColor(home), ac = teamColor(away);
  const teamCol = (abbr: string, score: number | null, right: boolean) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
        {teamLogo(abbr) && <img src={teamLogo(abbr)!} alt="" width={22} height={22} />}
        <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{clubNick(abbr)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span className="mono" style={{ fontSize: 34, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>{score == null ? '–' : score}</span>
        {ballTm === abbr && !over && <span style={{ fontSize: 12 }}>🏈</span>}
      </div>
    </div>
  );
  const tabBtn = (id: 'live' | 'stats', label: string) => (
    <button onClick={() => setTab(id)} className="mono" style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab === id ? 'var(--you)' : 'transparent'}`, padding: '8px 4px', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: tab === id ? 'var(--you)' : 'var(--dim)', cursor: 'pointer' }}>{label}</button>
  );
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 10px 12px' }}>
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 8 }}>
        <span aria-hidden className="mono" style={{ position: 'absolute', left: -8, top: -14, fontSize: 64, fontWeight: 900, color: `color-mix(in srgb, ${ac?.c ?? 'var(--dim)'} 14%, transparent)`, letterSpacing: '-0.04em', pointerEvents: 'none' }}>{away}</span>
        <span aria-hidden className="mono" style={{ position: 'absolute', right: -8, top: -14, fontSize: 64, fontWeight: 900, color: `color-mix(in srgb, ${hc?.c ?? 'var(--dim)'} 14%, transparent)`, letterSpacing: '-0.04em', pointerEvents: 'none' }}>{home}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px' }}>
          {teamCol(away, last ? last.as : null, false)}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 110 }}>
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: 'var(--text)' }}>
              {live && <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--opp)' }} />}
              {over ? 'FINAL' : last ? qClock(last.c) : 'UPCOMING'}
            </span>
            {sit && !over && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>{sit}</span>}
          </div>
          {teamCol(home, last ? last.hs : null, true)}
        </div>
      </div>
      {last && !over && (
        <div style={{ margin: '6px 4px 0', borderLeft: '2px solid var(--opp)', paddingLeft: 8 }}>
          <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)' }}>{live ? '● LIVE · ' : ''}LAST PLAY{sit ? ` · ${sit}` : ''}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.35, marginTop: 2 }}>{last.txt}</div>
        </div>
      )}
      <Field feed={feed} clock={clock} week={week} pidSide={pidSide} carrierOf={carrierOf} />
      {drive && !over && <div className="mono" style={{ fontSize: 9.5, color: 'var(--dimstrong)', textAlign: 'center', marginTop: 4 }}>{drive.text}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 10, borderBottom: '1px solid var(--bd)' }}>
        {tabBtn('live', live ? '● LIVE' : 'PLAYS')}
        {tabBtn('stats', 'STATS')}
      </div>
      {tab === 'live' && (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {plays.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'center', padding: 16 }}>— no plays yet —</div>}
          {[...plays].reverse().map((p, i) => {
            const names = playNames(p.txt).map((a) => personOf(a)).filter((x): x is GamePerson => !!x);
            const s2 = situationLabel(p, home, away);
            return (
              <div key={p.pid ?? `${p.c}-${i}`} title="Double-click to hear this play" onDoubleClick={() => { webVoice.stop(); webVoice.speak(p.txt, () => {}); }}
                style={{ display: 'flex', gap: 8, padding: '10px 4px', borderBottom: '1px solid color-mix(in srgb, var(--bd) 60%, transparent)' }}>
                {teamLogo(p.tm) && <img src={teamLogo(p.tm)!} alt="" width={22} height={22} style={{ marginTop: 2, flex: 'none' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9, fontWeight: 700, color: 'var(--dim)' }}>
                    <span>{s2 ?? p.ty.toUpperCase()}</span><span>{qClock(p.c)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: p.sc ? 800 : 600, color: p.sc ? 'var(--warn)' : 'var(--text)', lineHeight: 1.35, marginTop: 2, overflowWrap: 'anywhere' }}>{p.txt}</span>
                    <span className="mono" style={{ fontSize: 9.5, fontWeight: 800, color: p.sc ? 'var(--warn)' : 'var(--dimstrong)', whiteSpace: 'nowrap' }}>{away} {p.as}–{p.hs} {home}</span>
                  </div>
                  {names.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                      {names.map((who) => {
                        const row = rowOf.get(who.slug);
                        return (
                          <button key={who.slug} onClick={() => openPlayerCard({ slug: who.slug, name: fullName(who.slug), pos: row?.pos ?? '', team: row?.team ?? '', week })} className="mono"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 9.5, fontWeight: 700, color: 'var(--text)' }}>
                            <span style={{ width: 20, height: 20, borderRadius: 10, overflow: 'hidden', background: 'var(--sh)', display: 'inline-block', flex: 'none' }}>
                              {headshot(who.slug) && <img src={headshot(who.slug)!} alt="" width={20} height={20} style={{ objectFit: 'cover' }} />}
                            </span>
                            <span>{shortName(who.full)}</span>
                            {row && <span style={{ color: 'var(--faint)', fontSize: 8.5 }}>{row.pos}</span>}
                            {row && <span style={{ color: 'var(--dim)', fontSize: 8.5, fontWeight: 400 }}>· {row.stat}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'stats' && (
        <div>
          <div style={{ display: 'flex', gap: 6, margin: '10px 0', padding: 3, borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--bg)' }}>
            {(['off', 'def'] as const).map((id) => (
              <button key={id} onClick={() => setStatTab(id)} className="mono" style={{ flex: 1, padding: '7px 0', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', background: statTab === id ? 'var(--bd)' : 'transparent', color: statTab === id ? 'var(--text)' : 'var(--dim)' }}>{id === 'off' ? 'OFFENSE' : 'DEFENSE'}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {([[away, box.away], [home, box.home]] as const).map(([label, rows]) => (
              <div key={label} style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text)', marginBottom: 5 }}>{label}</div>
                {boxTabRows(rows, statTab).length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>— nothing yet —</div>}
                {boxTabRows(rows, statTab).map((r) => (
                  <div key={r.slug} style={{ padding: '4px 0', borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                      <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)' }}>{r.pos}</span>
                      <button onClick={() => openPlayerCard({ slug: r.slug, name: fullName(r.slug), pos: r.pos, team: label, week })} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', textAlign: 'left' }}>{fullName(r.slug)}</button>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--dimstrong)' }}>{r.stat}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A slug as a readable name. Local rather than imported: ClassicBoard's copy
 *  leans on its own `shortName`, and a box-score row has room for the full one. */
function boxName(slug: string): string {
  if (slug.endsWith('-dst')) return `${slugMeta(slug).team} D/ST`;
  if (slug.endsWith('-k')) return `${slugMeta(slug).team} K`;
  return stripSlugTag(slug).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** All of a game's players and their lines, by team (v0.336.0). */
function BoxScoreCard({ week, home, away, clock, onClose }: {
  week: number; home: string; away: string; clock: number; onClose: () => void;
}) {
  // ── EVERY GAME, ONE SHEET (v0.369.7, founder: "make the box score have all
  // the games. list all the games at the top and you can horizontal scroll
  // through them.") — the sheet opens on the game whose BOX SCORE chip you
  // tapped, and the strip walks the whole slate: red dot live, grey final,
  // plain text upcoming. Selection is local; the field behind doesn't move.
  const originKey = `${normTeam(away)}@${normTeam(home)}`;
  const [sel, setSel] = useState(originKey);
  // `clock` ticks with the opener's poll, which is what refreshes the strip's
  // scores and the rows for every game (the feeds are a module cache).
  const games = useMemo(() => weekBoxGames(week), [week, clock]);
  const cur = games.find((g) => g.key === sel) ?? games.find((g) => g.key === originKey) ?? games[0]
    ?? { key: originKey, away: normTeam(away), home: normTeam(home), kickoff: null, state: 'live' as const, feed: null };
  // The origin game keeps the log's scrub position; every other game shows
  // its latest — a strip you browse is asking "where do things stand".
  const effClock = cur.key === originKey ? clock : Number.MAX_SAFE_INTEGER;
  const box = useMemo(() => gameBoxScore(week, cur.home, cur.away, effClock), [week, cur.home, cur.away, effClock, clock]);
  const last = latestPlay(cur.feed?.plays);
  // BEFORE KICKOFF IT IS A PROJECTION (v0.413.0, founder: "the box score can
  // contain projected starters and fantasy projections until kick off").
  //
  // gameBoxScore accumulates from PLAYS, so a game that has not started has an
  // empty sheet and "— nothing yet —" under both teams, which is true and
  // useless: the hour you most want a box score is the hour before kickoff.
  // Keyed off the game having no plays rather than off its state, because a
  // feed can exist with an empty play list, and either way what we can honestly
  // show is the same.
  const notStarted = !cur.feed || cur.feed.plays.length === 0;
  const proj = useMemo(() => (notStarted ? projectedBox(cur.home, cur.away, week) : null), [notStarted, cur.home, cur.away, week]);
  // OFFENSE / DEFENSE tabs (v0.365.1, founder) — matching the app's box sheet:
  // the single list ran long and "how did the defense do" meant scrolling past
  // every receiver. Membership is core's boxTabRows (stat-driven), so a two-way
  // player appears on BOTH tabs, phrased through each side's lens.
  const [tab, setTab] = useState<'off' | 'def'>('off');
  const col = (label: string, rows: typeof box.home) => {
    const shown = boxTabRows(rows, tab);
    return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)', marginBottom: 5 }}>
        {teamLogo(label) && <img src={teamLogo(label)!} alt="" width={16} height={16} style={{ display: 'block' }} />}{label}
      </div>
      {shown.length === 0
        ? <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>— nothing yet —</div>
        : shown.map((r) => {
          // A name opens the player card (founder: "can we open up player
          // cards by clicking names on the box score?") — except the D/ST
          // and K composites, which are units, not players with cards.
          const carded = !r.slug.endsWith('-dst') && !r.slug.endsWith('-k');
          return (
          <div key={r.slug} style={{ padding: '4px 0', borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: `var(--pos-${r.pos}-fg, var(--faint))`, flex: 'none' }}>{r.pos}</span>
              <span
                onClick={carded ? () => openPlayerCard({ slug: r.slug, name: boxName(r.slug), pos: r.pos, team: label, week }) : undefined}
                role={carded ? 'button' : undefined}
                title={carded ? `${boxName(r.slug)} — player card` : undefined}
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: carded ? 'pointer' : undefined, textDecoration: carded ? 'underline dotted color-mix(in srgb, var(--dim) 55%, transparent)' : undefined, textUnderlineOffset: 3 }}>
                {boxName(r.slug)}
              </span>
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--dimstrong)', lineHeight: 1.35 }}>{r.stat}</div>
          </div>
          );
        })}
    </div>
    );
  };
  /** The same column, before anyone has played: who is expected to start and
   *  what the LEAGUE'S scoring projects them for. Never dressed as a stat
   *  line — the number carries "proj" and the sheet says so above. */
  const projCol = (label: string, rows: NonNullable<typeof proj>['home']) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)', marginBottom: 5 }}>
        {teamLogo(label) && <img src={teamLogo(label)!} alt="" width={16} height={16} style={{ display: 'block' }} />}{label}
      </div>
      {rows.length === 0
        ? <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>— no projections —</div>
        : rows.map((r) => {
          const carded = !r.slug.endsWith('-dst') && !r.slug.endsWith('-k');
          return (
            <div key={r.slug} style={{ display: 'flex', alignItems: 'baseline', gap: 5, padding: '4px 0', borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}>
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: `var(--pos-${r.pos}-fg, var(--faint))`, flex: 'none' }}>{r.pos}</span>
              <span
                onClick={carded ? () => openPlayerCard({ slug: r.slug, name: boxName(r.slug), pos: r.pos, team: label, week }) : undefined}
                role={carded ? 'button' : undefined}
                title={carded ? `${boxName(r.slug)} — player card` : undefined}
                style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: carded ? 'pointer' : undefined, textDecoration: carded ? 'underline dotted color-mix(in srgb, var(--dim) 55%, transparent)' : undefined, textUnderlineOffset: 3 }}>
                {boxName(r.slug)}
              </span>
              {r.injury && (
                <span className="mono" title={r.injury === 'Q' ? 'questionable' : r.injury === 'D' ? 'doubtful' : r.injury}
                  style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 3, padding: '1px 4px', flex: 'none' }}>{r.injury}</span>
              )}
              {/* A rank with no projection is still an answer about who starts; a
                  fabricated 0.0 would not be. */}
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dimstrong)', flex: 'none' }}>{r.proj != null ? r.proj.toFixed(1) : '—'}</span>
            </div>
          );
        })}
    </div>
  );
  const tabBtn = (id: 'off' | 'def', label: string) => (
    <button onClick={() => setTab(id)} className="mono"
      style={{ flex: 1, textAlign: 'center', padding: '7px 0', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: tab === id ? 'var(--text)' : 'var(--dim)', background: tab === id ? 'var(--bd)' : 'transparent' }}>{label}</button>
  );
  return (
    <ModalBackdrop onClick={onClose} zIndex={80}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', minWidth: 0, maxWidth: 560, margin: 'auto 0', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)' }}>▤ BOX SCORES</span>
          <button onClick={onClose} aria-label="close the box score" className="mono"
            style={{ fontSize: 13, color: 'var(--dim)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>✕</button>
        </div>
        {/* The game strip — every game this week, horizontally scrollable.
            Red dot = on now · grey = final · plain = yet to kick. */}
        {games.length > 1 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
            {games.map((g) => (
              <button key={g.key} onClick={() => setSel(g.key)} className="mono"
                style={{
                  flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${g.key === cur.key ? 'var(--you)' : 'var(--bd)'}`,
                  background: g.key === cur.key ? 'color-mix(in srgb, var(--you) 12%, transparent)' : 'var(--bg)',
                  fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
                  color: g.state === 'final' ? 'var(--faint)' : 'var(--text)',
                }}>
                {g.state === 'live' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4F62', flex: 'none' }} />}
                {g.key}
              </button>
            ))}
          </div>
        )}
        {/* The selected game's own line: teams, score, where its clock stands. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginBottom: 10 }}>
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
            {teamLogo(cur.away) && <img src={teamLogo(cur.away)!} alt="" width={16} height={16} style={{ display: 'block' }} />}{cur.away}
          </span>
          {last
            ? <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{last.as} — {last.hs}</span>
            : <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)' }}>@</span>}
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
            {cur.home}{teamLogo(cur.home) && <img src={teamLogo(cur.home)!} alt="" width={16} height={16} style={{ display: 'block' }} />}
          </span>
          <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: cur.state === 'live' ? '#FF4F62' : 'var(--faint)' }}>
            {cur.state === 'final' ? 'FINAL' : cur.state === 'live' ? (last ? fmtQClock(Math.min(last.c, effClock)) : 'LIVE') : cur.kickoff ? kickoffLabel(cur.kickoff) : 'UPCOMING'}
          </span>
        </div>
        {/* Offense / Defense split only where there are stats to split. Before
            kickoff there is one list per side — a projected lineup — and a tab
            bar over it would promise a cut of nothing. */}
        {!notStarted && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, padding: 3, borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--bg)' }}>
            {tabBtn('off', 'OFFENSE')}
            {tabBtn('def', 'DEFENSE')}
          </div>
        )}
        {notStarted && proj && (
          <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', marginBottom: 8, textAlign: 'center' }}>
            ◷ PROJECTED STARTERS · NOT A STAT LINE
          </div>
        )}
        {notStarted && proj
          ? <div style={{ display: 'flex', gap: 14 }}>{projCol(cur.away, proj.away)}{projCol(cur.home, proj.home)}</div>
          : <div style={{ display: 'flex', gap: 14 }}>{col(cur.away, box.away)}{col(cur.home, box.home)}</div>}
        {/* Said plainly: an empty column is a player who has not touched the
            ball, not a player the box score forgot. */}
        <div className="mono" style={{ fontSize: 8, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
          {notStarted
            ? <>the highest-projected man at each spot, scored by THIS league&rsquo;s rules · a projection, not a depth chart · real stats replace it at kickoff</>
            : <>everyone with a stat on this side of the ball · most involved first · two-way players appear on both tabs · follows the log&rsquo;s clock</>}
        </div>
      </div>
    </ModalBackdrop>
  );
}
