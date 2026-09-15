// THE GAME VIEW'S WORDS (v0.390.3) — founder, over Sleeper's game screen:
// "the sleeper field view is pretty good can we emulate this?" What that
// screen says above and below its field comes from the same play feed we
// already carry; this is the one place those readings are computed, so the
// app's and the web's Game view cannot disagree about a down, a spot or a
// drive. Pure functions over the feed's plays; no fetching.
import type { GamePlay, TeamGameFeed } from './gameFeed';
import { NAME_RE } from './spokenPlay';

const ORD = ['', '1st', '2nd', '3rd', '4th'];

/** Drop the gamebook's jumbo-package preamble — "H.Nourzad and K.Tonga
 *  reported in as eligible." — wherever it sits (v0.390.4): it names
 *  linemen, not the play, and the first name in the text is otherwise read
 *  as the ball carrier. Same rule as the ingest adapter's stripEligible. */
export function stripEligible(text: string): string {
  let s = String(text ?? '');
  for (;;) {
    const i = s.indexOf('reported in as eligible.');
    if (i < 0) return s;
    const head = s.slice(0, i);
    const start = Math.max(head.lastIndexOf('. '), head.lastIndexOf(') ')) + 1;
    s = (s.slice(0, start > 0 ? start + 1 : 0) + s.slice(i + 'reported in as eligible.'.length)).replace(/^\s+|\s+(?=\s)/g, '').trim();
  }
}
const REG = 3600; // four 15-minute quarters of game-elapsed seconds; OT beyond
const OT_LEN = 600; // a 10-minute overtime period

/** "Q2 04:33" from game-elapsed seconds; "OT 07:12" past regulation.
 *  Regulation is 3600s (v0.390.8) — the first cut used the engine's
 *  55-minute "late game" mark and read Q4 5:00 onward as OT (founder:
 *  "It's not OT yet"). */
export function qClock(c: number): string {
  const mmss = (left: number) => `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  if (c >= REG) return `OT ${mmss(Math.max(0, OT_LEN - ((c - REG) % OT_LEN)))}`;
  const q = Math.min(4, Math.floor(c / 900) + 1);
  return `Q${q} ${mmss(Math.max(0, q * 900 - c))}`;
}

/** The ball spot the way a broadcast says it: yards-to-goal from the
 *  possession team's view → "KC 20" (own side), "50", "DEN 35" (their side). */
export function spotLabel(tm: string, yl: number, home: string, away: string): string {
  const opp = tm === home ? away : home;
  if (yl === 50) return '50';
  return yl > 50 ? `${tm} ${100 - yl}` : `${opp} ${yl}`;
}

/** "3rd & 10 · KC 20", "2nd & Goal · DEN 4", or null on a down-less play. */
export function situationLabel(p: Pick<GamePlay, 'dn' | 'dist' | 'yl' | 'tm'>, home: string, away: string): string | null {
  if (!(p.dn > 0)) return null;
  const goal = p.dist >= p.yl;
  return `${ORD[p.dn] ?? `${p.dn}th`} & ${goal ? 'Goal' : p.dist} · ${spotLabel(p.tm, p.yl, home, away)}`;
}

export interface DriveSummary {
  tm: string; from: string; plays: number; cmp: number; att: number; rush: number; yards: number; scored: boolean;
  /** "KC from own 20 · 2 plays · 0/2 pass · 0 yds" */
  text: string;
}
/** The drive the last play belongs to, summed. */
export function driveSummary(feed: Pick<TeamGameFeed, 'plays' | 'home' | 'away'>): DriveSummary | null {
  const plays = feed.plays;
  if (!plays.length) return null;
  const last = plays[plays.length - 1];
  const drive = plays.filter((p) => p.drv === last.drv);
  // Kickoffs open a drive without belonging to it (the kicking team "ran" it).
  const snaps = drive.filter((p) => !/Kickoff/i.test(p.ty));
  const first = snaps[0] ?? drive[0];
  const tm = first.tm;
  const from = first.yl > 50 ? `own ${100 - first.yl}` : first.yl === 50 ? 'the 50' : `the ${tm === feed.home ? feed.away : feed.home} ${first.yl}`;
  const att = snaps.filter((p) => /Pass|Interception|Sack/i.test(p.ty)).length;
  const cmp = snaps.filter((p) => /Pass Reception/i.test(p.ty)).length;
  const rush = snaps.filter((p) => /^Rush/i.test(p.ty)).length;
  const end = last.tm2 && last.tm2 !== tm ? null : last.yl2; // possession flipped → the drive is over where it was
  const yards = end == null ? Math.max(0, first.yl - last.yl) : Math.max(0, first.yl - end);
  const scored = drive.some((p) => !!p.sc);
  const text = `${tm} from ${from} · ${snaps.length} play${snaps.length === 1 ? '' : 's'} · ${cmp}/${att} pass · ${yards} yd${yards === 1 ? '' : 's'}${scored ? ' · SCORED' : ''}`;
  return { tm, from, plays: snaps.length, cmp, att, rush, yards, scored, text };
}

/** Every gamebook name token in a play's text, in order, deduped:
 *  ["J.Brissett", "Mi.Wilson", "D.Jackson"]. */
export function playNames(txt: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(NAME_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripEligible(txt)))) { if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); } }
  return out;
}

/** Who has the ball at the spot: the receiver on a pass ("pass … to X"),
 *  the returner on a kick/punt return, else the first name (the rusher /
 *  passer). Null when the text names nobody. */
export function ballCarrier(p: Pick<GamePlay, 'txt' | 'ty'>): string | null {
  const txt = stripEligible(p.txt);
  const names = playNames(txt);
  if (!names.length) return null;
  const to = txt.match(/\b(?:pass (?:short|deep)? ?(?:left|middle|right)? ?(?:complete )?to|to) ((?:[A-Z][a-z]{0,2})\.(?:St\. )?[A-Z][A-Za-z'’-]+)/);
  if (/Pass/i.test(p.ty) && to && names.includes(to[1])) return to[1];
  const ret = txt.match(/\b((?:[A-Z][a-z]{0,2})\.(?:St\. )?[A-Z][A-Za-z'’-]+) (?:to|returns?|pushed|ran)/);
  if (/Kickoff|Punt/i.test(p.ty) && ret && names.includes(ret[1])) return ret[1];
  return names[0];
}
