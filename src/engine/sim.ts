import type { Player, PlayerStats, Pos, PbpEvent, SlotResolution, EffectType } from '../types';
import { hashStr } from '../data/players';
import { metricById } from '../data/metrics';
import { realPbpFor, type RealPlayKind } from '../data/realPbp';

// ─────────────────────────────────────────────────────────────────────────
// Deterministic simulation. Everything is seeded off (playerId, week) so a
// given matchup always plays out identically — no server, no randomness at
// runtime. Real 2025 season totals set each player's baseline; weekly
// variance gives boom/bust texture; metric effects (NUKE / ERASE / HOT
// STREAK) resolve over a merged play-by-play timeline.
//
// Simplifications for the demo (documented honestly):
//   • Field General (QB MULTIPLIER) scores a light direct drip instead of a
//     true cross-slot window multiplier — keeps each slot self-contained.
//   • RATE RESET / CLOCK STOP / COMPRESSION render as flavor badges plus a
//     mild denial rather than full mechanical models.
// NUKE, ERASE and HOT STREAK are modeled for real.
// ─────────────────────────────────────────────────────────────────────────

const GAME_SECONDS = 3300; // clock caps at 55:00, matching the prototype

/** mulberry32 PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WeekLine {
  passYds: number; passTds: number;
  carries: number; rushYds: number; rushTds: number;
  targets: number; receptions: number; recYds: number; recTds: number;
}

/** Sample a small count from an expected per-game rate. */
function sampleCount(expected: number, r: () => number): number {
  // simple thinned Poisson-ish: each "slot" hits with prob
  let n = 0;
  let p = expected;
  while (p > 0) {
    if (r() < Math.min(1, p)) n++;
    p -= 1;
  }
  return n;
}

/** Per-week box line for a player, from season averages + seeded variance. */
export function weekLine(p: Player, week: number): WeekLine {
  const s: PlayerStats = p.stats;
  const g = Math.max(1, s.games);
  const r = rng(hashStr(`${p.id}|wk${week}`));
  // volume multiplier: centered ~1, occasional boom/bust
  const v = 0.55 + r() * 1.0 + (r() < 0.12 ? 0.35 : 0); // ~0.55..1.9
  const yv = (base: number) => Math.round((base / g) * v);
  return {
    passYds: yv(s.passYds),
    passTds: sampleCount((s.passTds / g) * v, r),
    carries: yv(s.carries),
    rushYds: yv(s.rushYds),
    rushTds: sampleCount((s.rushTds / g) * v, r),
    targets: yv(s.targets),
    receptions: Math.min(yv(s.receptions), yv(s.targets)),
    recYds: yv(s.recYds),
    recTds: sampleCount((s.recTds / g) * v, r),
  };
}

/** Projected fantasy-ish weekly points (used for default lineup ranking). */
export function projectedPoints(p: Player, week: number): number {
  const l = weekLine(p, week);
  return (
    l.passYds * 0.04 + l.passTds * 4 +
    l.rushYds * 0.1 + l.rushTds * 6 +
    l.recYds * 0.1 + l.recTds * 6 + l.receptions * 1 +
    l.rushYds * 0 // noop, keeps formatting
  );
}

interface RawPlay {
  clock: number;
  kind: RealPlayKind;
  yards: number;
  td: boolean;
  catch: boolean;   // a reception happened
  target: boolean;  // the player was targeted
}

function spreadClocks(n: number, r: () => number): number[] {
  const cs: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = (GAME_SECONDS * (i + 0.5)) / n;
    cs.push(Math.round(Math.max(60, Math.min(GAME_SECONDS - 30, base + (r() - 0.5) * (GAME_SECONDS / n) * 0.8))));
  }
  return cs.sort((a, b) => a - b);
}

/** Turn a week line into discrete plays for a player. */
function buildPlays(p: Player, l: WeekLine, week: number): RawPlay[] {
  const r = rng(hashStr(`${p.id}|plays${week}`));
  const plays: RawPlay[] = [];

  if (p.pos === 'QB') {
    const n = Math.max(5, Math.min(12, Math.round(l.passYds / 26)));
    const clocks = spreadClocks(n, r);
    let remaining = l.passYds;
    let tdsLeft = l.passTds;
    for (let i = 0; i < n; i++) {
      const share = i === n - 1 ? remaining : Math.round((remaining / (n - i)) * (0.6 + r() * 0.8));
      remaining = Math.max(0, remaining - share);
      const td = tdsLeft > 0 && (r() < tdsLeft / (n - i));
      if (td) tdsLeft--;
      plays.push({ clock: clocks[i], kind: 'pass', yards: share, td, catch: false, target: false });
    }
    // QB scrambles
    if (l.rushYds > 15) {
      const rn = Math.min(3, Math.max(1, Math.round(l.rushYds / 30)));
      const rc = spreadClocks(rn, r);
      let rem = l.rushYds; let rtd = l.rushTds;
      for (let i = 0; i < rn; i++) {
        const y = i === rn - 1 ? rem : Math.round(rem / (rn - i));
        rem = Math.max(0, rem - y);
        const td = rtd > 0 && r() < 0.5; if (td) rtd--;
        plays.push({ clock: rc[i], kind: 'rush', yards: y, td, catch: false, target: false });
      }
    }
  } else if (p.pos === 'RB') {
    const carryChunks = Math.max(3, Math.min(8, Math.round(l.carries / 4)));
    const cc = spreadClocks(carryChunks, r);
    let rem = l.rushYds; let rtd = l.rushTds;
    for (let i = 0; i < carryChunks; i++) {
      const y = i === carryChunks - 1 ? rem : Math.round((rem / (carryChunks - i)) * (0.5 + r()));
      rem = Math.max(0, rem - y);
      const td = rtd > 0 && r() < rtd / (carryChunks - i); if (td) rtd--;
      plays.push({ clock: cc[i], kind: 'rush', yards: y, td, catch: false, target: false });
    }
    // receptions
    const rec = l.receptions;
    if (rec > 0) {
      const rcc = spreadClocks(rec, r);
      let remr = l.recYds; let rectd = l.recTds;
      for (let i = 0; i < rec; i++) {
        const y = i === rec - 1 ? remr : Math.round(remr / (rec - i));
        remr = Math.max(0, remr - y);
        const td = rectd > 0 && r() < 0.4; if (td) rectd--;
        plays.push({ clock: rcc[i], kind: 'rec', yards: y, td, catch: true, target: true });
      }
    }
  } else if (p.pos === 'K') {
    // Fallback only (real weeks supply actual kicks): a few FGs + XPs.
    for (const c of spreadClocks(3, r)) plays.push({ clock: c, kind: 'fg', yards: 28 + Math.round(r() * 27), td: false, catch: false, target: false });
    for (const c of spreadClocks(2, r)) plays.push({ clock: c, kind: 'xp', yards: 0, td: false, catch: false, target: false });
  } else if (p.pos === 'DEF') {
    // Fallback only: a couple sacks and a takeaway.
    for (const c of spreadClocks(2, r)) plays.push({ clock: c, kind: 'sack', yards: 0, td: false, catch: false, target: false });
    if (r() < 0.6) plays.push({ clock: spreadClocks(1, r)[0], kind: 'int', yards: 0, td: false, catch: false, target: false });
  } else {
    // WR / TE / other receivers
    const rec = Math.max(1, l.receptions);
    const rcc = spreadClocks(rec, r);
    let remr = l.recYds; let rectd = l.recTds;
    for (let i = 0; i < rec; i++) {
      const y = i === rec - 1 ? remr : Math.round((remr / (rec - i)) * (0.5 + r()));
      remr = Math.max(0, remr - y);
      const td = rectd > 0 && r() < rectd / (rec - i); if (td) rectd--;
      plays.push({ clock: rcc[i], kind: 'rec', yards: Math.max(0, y), td, catch: true, target: true });
    }
    // incompletions (targets without a catch)
    const incompletions = Math.max(0, l.targets - rec);
    if (incompletions > 0) {
      const ic = spreadClocks(incompletions, r);
      for (let i = 0; i < incompletions; i++) {
        plays.push({ clock: ic[i], kind: 'incomplete', yards: 0, td: false, catch: false, target: true });
      }
    }
  }
  return plays.sort((a, b) => a.clock - b.clock);
}

// Effect family of a metric → how it scores a single play and what it does.
function scorePlay(play: RawPlay, pos: Pos, metricId: string, hot: boolean): number {
  if (pos === 'QB') {
    if (metricId === 'fg') return play.kind === 'pass' ? play.yards * 0.03 : play.kind === 'rush' ? play.yards * 0.1 : 0;
    if (metricId === 'pass') return play.kind === 'pass' ? play.yards * 0.04 + (play.td ? 4 : 0) : 0;
    if (metricId === 'rush') return play.kind === 'rush' ? play.yards * 0.1 + (play.td ? 6 : 0) : 0;
  }
  if (pos === 'RB') {
    if (metricId === 'rush') return play.kind === 'rush' ? play.yards * 0.1 + (play.td ? 6 : 0) : 0;
    if (metricId === 'rec') return play.catch ? 1 : 0;
    if (metricId === 'td') return play.td ? 6 : 0; // NUKE
  }
  if (pos === 'WR') {
    if (metricId === 'recyd') return play.catch ? play.yards * 0.1 * (hot ? 2 : 1) : 0;
    if (metricId === 'rec') return play.catch ? 1 : 0;
    if (metricId === 'tgt') return play.target ? 0.5 : 0;
    if (metricId === 'td') return play.td ? 6 : 0;
  }
  if (pos === 'TE') {
    if (metricId === 'tgt') return play.target ? 1 : 0;
    if (metricId === 'rec') return play.catch ? 1.5 : 0;
    if (metricId === 'td') return play.td ? 8 : 0; // NUKE
  }
  if (pos === 'K') {
    // 'neg' (SHUTDOWN) scores 0 directly — it's a pure effect. 'banker' scores
    // FG by distance + XP (the XP→TD bonus is applied as flavor, not here).
    if (metricId === 'neg') return 0;
    if (play.kind === 'fg') return play.yards < 40 ? 3 : play.yards < 50 ? 4 : 5;
    if (play.kind === 'xp') return 1;
    return 0;
  }
  if (pos === 'DEF') {
    // 'suppress' (HALVING) scores 0 directly. 'earn' is flat: sk1 / int3 / fr2,
    // plus def/ST TD 6 and safety 2.
    if (metricId === 'suppress') return 0;
    if (play.kind === 'sack') return 1;
    if (play.kind === 'int') return 3;
    if (play.kind === 'fumrec') return 2;
    if (play.kind === 'dst_td') return 6;
    if (play.kind === 'safety') return 2;
    return 0;
  }
  // fallback flat
  return play.catch ? play.yards * 0.1 + (play.td ? 6 : 0) : (play.kind === 'rush' ? play.yards * 0.1 + (play.td ? 6 : 0) : 0);
}

type Family = 'nuke' | 'erase' | 'streak' | 'mult' | 'compression' | 'reset' | 'stop' | 'flat';
function familyOf(pos: Pos, metricId: string): Family {
  const m = metricById(pos, metricId);
  if (!m) return 'flat';
  if (m.fx === 'nuke') return 'nuke';
  if (m.fx === 'erase') return 'erase';
  if (m.fx === 'streak') return 'streak';
  if (m.fx === 'mult') return 'mult';
  if (m.fx === 'compression') return 'compression';
  if (m.fx === 'reset') return 'reset';
  if (m.fx === 'stop') return 'stop';
  return 'flat';
}

interface SideState {
  bank: number;
  hist: { clock: number; pts: number }[];
  streak: number;
  hot: boolean;
  kicks: number;   // made kicks (for K neg shutdown)
  dead: boolean;   // negated by an opponent K-neg shutdown → scores 0
}

interface MergedPlay extends RawPlay {
  side: 'you' | 'their';
}

const TEAM_ABBR = (p: Player) => p.team || 'NFL';

function playText(p: Player, play: RawPlay): string {
  const t = TEAM_ABBR(p);
  if (play.td) {
    if (play.kind === 'rush') return `${t} TD: ${p.name} ${play.yards}yd rush`;
    if (play.kind === 'rec') return `${t} TD: ${p.name} ${play.yards}yd catch`;
    return `${t} TD: ${p.name} ${play.yards}yd`;
  }
  if (play.kind === 'pass') return `${t}: ${p.name} ${play.yards}yd pass`;
  if (play.kind === 'rush') return `${t}: ${p.name} +${play.yards} rush`;
  if (play.kind === 'rec') return `${t}: ${p.name} +${play.yards} catch`;
  if (play.kind === 'fg') return `${t}: ${p.name} ${play.yards}yd FG good`;
  if (play.kind === 'fgmiss') return `${t}: ${p.name} ${play.yards}yd FG miss`;
  if (play.kind === 'xp') return `${t}: ${p.name} XP good`;
  if (play.kind === 'xpmiss') return `${t}: ${p.name} XP miss`;
  if (play.kind === 'sack') return `${t} D: sack`;
  if (play.kind === 'int') return `${t} D: interception`;
  if (play.kind === 'fumrec') return `${t} D: fumble recovered`;
  if (play.kind === 'dst_td') return `${t} D: TD`;
  if (play.kind === 'safety') return `${t} D: safety`;
  return `${t}: ${p.name} incomplete`;
}

function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

export interface SlotInput {
  player: Player;
  metricId: string;
}

/** Real play-by-play for a player/week, if we've baked it; else null. */
export function realRawPlays(playerId: string, week: number): RawPlay[] | null {
  const ps = realPbpFor(week, playerId);
  if (!ps) return null;
  return ps
    .map((p) => ({ clock: p.c, kind: p.k, yards: p.y, td: !!p.td, catch: !!p.ca, target: !!p.tg }))
    .sort((a, b) => a.clock - b.clock);
}

export function hasRealPbp(playerId: string, week: number): boolean {
  return realRawPlays(playerId, week) !== null;
}

/** Real plays when available, otherwise the deterministic simulation. */
function playsForPlayer(player: Player, week: number): { plays: RawPlay[]; real: boolean } {
  const r = realRawPlays(player.id, week);
  if (r) return { plays: r, real: true };
  return { plays: buildPlays(player, weekLine(player, week), week), real: false };
}

/**
 * Resolve one slot: your player+metric vs their player+metric over a merged
 * play-by-play timeline. Returns the full event feed plus final banks.
 */
export function resolveSlot(you: SlotInput, their: SlotInput, week: number, gameLabel: string): SlotResolution & { gameLabel: string; real: boolean; maxClock: number; youTds: number; theirTds: number; youBankerXp: number; theirBankerXp: number } {
  const yp = playsForPlayer(you.player, week);
  const tp = playsForPlayer(their.player, week);
  const yPlays = yp.plays;
  const tPlays = tp.plays;
  const real = yp.real || tp.real;
  const merged: MergedPlay[] = [
    ...yPlays.map((p) => ({ ...p, side: 'you' as const })),
    ...tPlays.map((p) => ({ ...p, side: 'their' as const })),
  ].sort((a, b) => a.clock - b.clock);

  const Y: SideState = { bank: 0, hist: [], streak: 0, hot: false, kicks: 0, dead: false };
  const T: SideState = { bank: 0, hist: [], streak: 0, hot: false, kicks: 0, dead: false };
  const youFam = familyOf(you.player.pos, you.metricId);
  const theirFam = familyOf(their.player.pos, their.metricId);

  // TDs and banker-XPs per side, surfaced for the lineup-wide K banker bonus.
  let youTds = 0, theirTds = 0, youBankerXp = 0, theirBankerXp = 0;

  const events: PbpEvent[] = [];

  for (const play of merged) {
    const mine = play.side === 'you' ? Y : T;
    const opp = play.side === 'you' ? T : Y;
    const myFam = play.side === 'you' ? youFam : theirFam;
    const oppFam = play.side === 'you' ? theirFam : youFam;
    const myPlayer = play.side === 'you' ? you : their;

    // base points (hot streak doubling applies to recyd catches). A side
    // negated by a K-neg shutdown scores nothing for the rest of the slot.
    let pts = scorePlay(play, myPlayer.player.pos, myPlayer.metricId, myFam === 'streak' && mine.hot);
    if (mine.dead) pts = 0;

    mine.bank += pts;
    if (pts > 0) mine.hist.push({ clock: play.clock, pts });

    // opponent's streak goes cold when I score
    if (pts > 0 && oppFam === 'streak') { opp.streak = 0; opp.hot = false; }

    // my streak progression
    if (myFam === 'streak') {
      if (play.td) { mine.streak = 3; mine.hot = true; }
      else if (play.catch) { mine.streak += 1; if (mine.streak >= 3) mine.hot = true; }
    }

    // tallies for the K banker lineup-wide bonus
    if (play.td) { if (play.side === 'you') youTds++; else theirTds++; }
    if (myPlayer.player.pos === 'K' && myPlayer.metricId === 'banker' && play.kind === 'xp') {
      if (play.side === 'you') youBankerXp++; else theirBankerXp++;
    }

    let effect: { type: EffectType; text: string } | undefined;

    // K NEG (SHUTDOWN): 6th made kick zeroes the matched opponent and negates
    // the rest of their slot.
    if (myPlayer.player.pos === 'K' && myPlayer.metricId === 'neg' && (play.kind === 'fg' || play.kind === 'xp')) {
      mine.kicks++;
      if (mine.kicks >= 6 && !opp.dead) {
        const wiped = opp.bank;
        opp.bank = 0; opp.hist = []; opp.dead = true;
        effect = { type: 'nuke', text: `✕ SHUTDOWN — negated ${wiped.toFixed(1)}` };
      }
    } else if (myFam === 'nuke' && play.td && opp.bank > 0) {
      const wiped = opp.bank;
      opp.bank = 0; opp.hist = [];
      effect = { type: 'nuke', text: `✕ NUKE — wiped ${wiped.toFixed(1)}` };
    } else if (myFam === 'erase' && play.catch) {
      const windowSecs = myPlayer.player.pos === 'TE' ? (myPlayer.metricId === 'tgt' ? 900 : 600) : 600;
      const cutoff = play.clock - windowSecs;
      let erased = 0;
      opp.hist = opp.hist.filter((h) => {
        if (h.clock >= cutoff) { erased += h.pts; return false; }
        return true;
      });
      if (erased > 0) { opp.bank = Math.max(0, opp.bank - erased); effect = { type: 'erase', text: `ERASE −${erased.toFixed(1)}` }; }
    } else if (myFam === 'reset' && play.catch) {
      // RATE RESET: clip the opponent's most recent contribution (flavor)
      const last = opp.hist[opp.hist.length - 1];
      if (last) { const cut = last.pts * 0.5; opp.bank = Math.max(0, opp.bank - cut); last.pts -= cut; effect = { type: 'reset', text: 'RATE RESET' }; }
    } else if (myFam === 'stop' && play.target && opp.hist.length) {
      effect = { type: 'stop', text: 'CLOCK STOP' };
    }

    // streak badges
    if (!effect && myFam === 'streak') {
      if (play.td) effect = { type: 'streak', text: 'TD → STREAK 2×' };
      else if (mine.hot && play.catch) effect = { type: 'streak', text: 'HOT STREAK · 2×' };
    }
    if (!effect && oppFam === 'streak' && pts > 0) {
      // note when I broke their streak
      effect = { type: 'cold', text: 'STREAK COLD' };
    }

    events.push({
      clock: play.clock,
      side: play.side,
      play: playText(myPlayer.player, play),
      delta: Math.round(pts * 10) / 10,
      youBank: Math.round(Y.bank * 10) / 10,
      theirBank: Math.round(T.bank * 10) / 10,
      effect,
    });
  }

  // DEF SUPPRESS (HALVING): a defense that holds its slot opponent below the
  // threshold halves that opponent's slot score (resolved at game end).
  const SUPPRESS_THRESHOLD = 10;
  if (you.player.pos === 'DEF' && you.metricId === 'suppress' && T.bank > 0 && T.bank < SUPPRESS_THRESHOLD) T.bank = T.bank * 0.5;
  if (their.player.pos === 'DEF' && their.metricId === 'suppress' && Y.bank > 0 && Y.bank < SUPPRESS_THRESHOLD) Y.bank = Y.bank * 0.5;

  const maxClock = events.length ? Math.max(...events.map((e) => e.clock)) : GAME_SECONDS;
  return {
    events,
    youFinal: Math.round(Y.bank * 10) / 10,
    theirFinal: Math.round(T.bank * 10) / 10,
    gameLabel,
    real,
    maxClock,
    youTds, theirTds, youBankerXp, theirBankerXp,
  };
}

export { GAME_SECONDS, fmtClock };
