// THE WEEKLY REPORT (v0.391.0) — one per league per week, posted into the
// league chat by the worker the moment the week closes, opened from a link
// on that message.
//
// Founder: "Can we get a weekly report for each league in the chat? Weekly
// report posts with a link you can click to open the report in a pop up."
//
// Everything about the report is decided HERE, from plain rows, so the worker
// (which writes it), the checks (which pin it) and both hosts (which read it)
// agree on one shape. The worker stores the built payload in `league_report`
// and the chat message only carries the week; the pop-up fetches the payload
// and renders `reportSections`.
import { stripSlugTag } from './slugMeta';

export type ReportFormat = 'standard' | 'guillotine' | 'vampire';
export interface ReportTeam { roster: number; name: string; score: number }
export interface ReportGame { home: ReportTeam; away: ReportTeam; margin: number }
export interface ReportStanding { roster: number; name: string; w: number; l: number; t: number; pf: number; pa: number }
export interface ReportMvp { slug: string; name: string; team: string; score: number; metric: string | null }
export interface ReportBite { vampire: string; victim: string; take: string; give: string }
export interface WeekReport {
  v: 1;
  week: number;
  league: string;
  format: ReportFormat;
  headline: string;
  results: ReportGame[];
  standings: ReportStanding[];
  top?: ReportTeam;
  low?: ReportTeam;
  closest?: ReportGame;
  blowout?: ReportGame;
  mvp?: ReportMvp;
  /** Guillotine: the seat the week chopped (lowest score). */
  eliminated?: ReportTeam;
  /** Vampire: the bites the week executed. */
  bites?: ReportBite[];
}

export interface ReportMatchupRow {
  week: number;
  home_roster_id: number;
  away_roster_id: number;
  home_final: number | string | null;
  away_final: number | string | null;
}
export interface ReportSlotRow {
  /** The matchup the row belongs to (its home/away rosters resolve the side). */
  home_roster_id: number;
  away_roster_id: number;
  side: 'home' | 'away' | string;
  slug: string;
  score: number | string | null;
  metric?: string | null;
}
export interface WeekReportInput {
  week: number;
  league: string;
  format?: string | null;
  /** roster id → team name. Unknown rosters read "Roster N". */
  names: Record<number, string> | Map<number, string>;
  /** Every FINAL matchup of the season so far (this week included); the
   *  standings are the whole season, the results are this week's. */
  matchups: ReportMatchupRow[];
  /** This week's per-slot scores (matchup_state.slot_scores, flattened). */
  slots?: ReportSlotRow[];
  eliminated?: number[];
  bites?: { vampire: number; victim: number; take: string; give: string }[];
}

const r1 = (n: unknown): number => Math.round((Number(n) || 0) * 10) / 10;
const fmt = (n: number): string => n.toFixed(1);
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** A slug as a name: `josh-allen` → "Josh Allen"; `bal-dst` → "BAL D/ST". */
export function slugPretty(slug: string): string {
  if (slug.endsWith('-dst')) return `${slug.slice(0, -4).toUpperCase()} D/ST`;
  if (slug.endsWith('-k') && !slug.slice(0, -2).includes('-')) return `${slug.slice(0, -2).toUpperCase()} K`;
  return stripSlugTag(slug).split('-').filter(Boolean).map(cap).join(' ');
}

const nameOf = (names: WeekReportInput['names'], roster: number): string => {
  const n = names instanceof Map ? names.get(roster) : names[roster];
  return (n && String(n).trim()) || `Roster ${roster}`;
};

export function buildWeekReport(input: WeekReportInput): WeekReport {
  const { week, names } = input;
  const format: ReportFormat = input.format === 'guillotine' || input.format === 'vampire' ? input.format : 'standard';
  const team = (roster: number, score: unknown): ReportTeam => ({ roster, name: nameOf(names, roster), score: r1(score) });

  // This week's results — a seat against itself (a bye row) is not a game.
  const results: ReportGame[] = input.matchups
    .filter((m) => m.week === week && m.home_final != null && m.away_final != null && m.home_roster_id !== m.away_roster_id)
    .map((m) => {
      const home = team(m.home_roster_id, m.home_final), away = team(m.away_roster_id, m.away_final);
      return { home, away, margin: r1(Math.abs(home.score - away.score)) };
    })
    .sort((a, b) => Math.max(b.home.score, b.away.score) - Math.max(a.home.score, a.away.score));

  const scored: ReportTeam[] = results.flatMap((g) => [g.home, g.away]);
  const top = scored.length ? scored.reduce((a, b) => (b.score > a.score ? b : a)) : undefined;
  const low = scored.length ? scored.reduce((a, b) => (b.score < a.score ? b : a)) : undefined;
  const closest = results.length ? results.reduce((a, b) => (b.margin < a.margin ? b : a)) : undefined;
  const blowout = results.length > 1 ? results.reduce((a, b) => (b.margin > a.margin ? b : a)) : undefined;

  // Season standings from every final so far.
  const tbl = new Map<number, ReportStanding>();
  const row = (roster: number) => {
    let s = tbl.get(roster);
    if (!s) { s = { roster, name: nameOf(names, roster), w: 0, l: 0, t: 0, pf: 0, pa: 0 }; tbl.set(roster, s); }
    return s;
  };
  for (const m of input.matchups) {
    if (m.week > week || m.home_final == null || m.away_final == null || m.home_roster_id === m.away_roster_id) continue;
    const h = row(m.home_roster_id), a = row(m.away_roster_id);
    const hs = r1(m.home_final), as = r1(m.away_final);
    h.pf = r1(h.pf + hs); h.pa = r1(h.pa + as); a.pf = r1(a.pf + as); a.pa = r1(a.pa + hs);
    if (hs > as) { h.w++; a.l++; } else if (as > hs) { a.w++; h.l++; } else { h.t++; a.t++; }
  }
  const standings = [...tbl.values()].sort((x, y) => y.w - x.w || x.l - y.l || y.pf - x.pf || x.roster - y.roster);

  // MVP: the week's single best slot, credited to the seat that started him.
  let mvp: ReportMvp | undefined;
  for (const s of input.slots ?? []) {
    const score = r1(s.score);
    if (mvp && score <= mvp.score) continue;
    const roster = s.side === 'away' ? s.away_roster_id : s.home_roster_id;
    mvp = { slug: s.slug, name: slugPretty(s.slug), team: nameOf(names, roster), score, metric: s.metric ?? null };
  }

  const out: WeekReport = { v: 1, week, league: input.league, format, headline: '', results, standings };
  if (top) out.top = top;
  if (low) out.low = low;
  if (closest) out.closest = closest;
  if (blowout && blowout !== closest) out.blowout = blowout;
  if (mvp) out.mvp = mvp;
  if (format === 'guillotine') {
    const chopped = (input.eliminated ?? []).map((r) => scored.find((t) => t.roster === r) ?? team(r, 0));
    if (chopped.length) out.eliminated = chopped[0];
    else if (low) out.eliminated = low;
  }
  if (format === 'vampire' && input.bites?.length) {
    out.bites = input.bites.map((b) => ({
      vampire: nameOf(names, b.vampire), victim: nameOf(names, b.victim),
      take: slugPretty(b.take), give: slugPretty(b.give),
    }));
  }
  out.headline = headlineOf(out);
  return out;
}

/** One line that tells the week: the top score, and the game that was close. */
/** Did anybody score? A league that hasn't drafted stamps every final at 0. */
export function reportHasScores(r: Pick<WeekReport, 'results'>): boolean {
  return r.results.some((g) => g.home.score > 0 || g.away.score > 0);
}

export function headlineOf(r: WeekReport): string {
  if (!r.results.length || !reportHasScores(r)) return `Week ${r.week} closed with no games scored.`;
  const bits: string[] = [];
  if (r.top) bits.push(`${r.top.name} led the week with ${fmt(r.top.score)}`);
  if (r.closest && r.results.length > 1) {
    const [w, l] = r.closest.home.score >= r.closest.away.score ? [r.closest.home, r.closest.away] : [r.closest.away, r.closest.home];
    bits.push(r.closest.margin === 0
      ? `${w.name} and ${l.name} tied at ${fmt(w.score)}`
      : r.closest.margin <= 5
      ? `${w.name} edged ${l.name} by ${fmt(r.closest.margin)}`
      : `${w.name} beat ${l.name} ${fmt(w.score)}–${fmt(l.score)}`);
  }
  if (r.format === 'guillotine' && r.eliminated) bits.push(`${r.eliminated.name} was chopped`);
  return bits.join('. ') + '.';
}

/** The chat line the worker posts. Under 500 characters, always. */
export function reportBody(r: WeekReport): string {
  const mvp = r.mvp ? ` MVP ${r.mvp.name} ${fmt(r.mvp.score)}.` : '';
  return `📋 Week ${r.week} report — ${r.headline}${mvp}`.slice(0, 500);
}

export interface ReportRow { label: string; value: string; sub?: string; hot?: boolean }
export interface ReportSection { title: string; rows: ReportRow[] }

const gameRow = (g: ReportGame): ReportRow => {
  const homeWon = g.home.score > g.away.score, tie = g.home.score === g.away.score;
  return {
    label: `${g.home.name} vs ${g.away.name}`,
    value: `${fmt(g.home.score)}–${fmt(g.away.score)}`,
    sub: tie ? 'Tie' : `${homeWon ? g.home.name : g.away.name} by ${fmt(g.margin)}`,
  };
};

/** The pop-up's contents, host-agnostic: sections of label/value rows. */
export function reportSections(r: WeekReport): ReportSection[] {
  const out: ReportSection[] = [];
  const marks: ReportRow[] = [];
  if (r.top) marks.push({ label: 'High score', value: fmt(r.top.score), sub: r.top.name, hot: true });
  if (r.mvp) marks.push({ label: 'MVP', value: fmt(r.mvp.score), sub: `${r.mvp.name} · ${r.mvp.team}${r.mvp.metric ? ` · ${r.mvp.metric}` : ''}` });
  if (r.closest && r.results.length > 1) marks.push({ label: 'Closest game', value: `by ${fmt(r.closest.margin)}`, sub: `${r.closest.home.name} vs ${r.closest.away.name}` });
  if (r.blowout) marks.push({ label: 'Blowout', value: `by ${fmt(r.blowout.margin)}`, sub: `${r.blowout.home.name} vs ${r.blowout.away.name}` });
  if (r.low) marks.push({ label: 'Low score', value: fmt(r.low.score), sub: r.low.name });
  if (marks.length) out.push({ title: 'The week', rows: marks });
  if (r.format === 'guillotine') {
    out.push({ title: 'Guillotine', rows: r.eliminated
      ? [{ label: 'Chopped', value: fmt(r.eliminated.score), sub: r.eliminated.name }]
      : [{ label: 'Chopped', value: '—', sub: 'nobody this week' }] });
  }
  if (r.format === 'vampire') {
    out.push({ title: 'Vampire', rows: r.bites?.length
      ? r.bites.map((b) => ({ label: `${b.vampire} bit ${b.victim}`, value: b.take, sub: `gave back ${b.give}` }))
      : [{ label: 'Bites', value: '—', sub: 'no blood drawn this week' }] });
  }
  if (r.results.length) out.push({ title: 'Results', rows: r.results.map(gameRow) });
  if (r.standings.length) {
    out.push({ title: 'Standings', rows: r.standings.map((s, i) => ({
      label: `${i + 1}. ${s.name}`,
      value: `${s.w}-${s.l}${s.t ? `-${s.t}` : ''}`,
      sub: `${fmt(s.pf)} for · ${fmt(s.pa)} against`,
    })) });
  }
  return out;
}

// ── WHEN THE LEAGUE HEARS IT (v0.457.0) ─────────────────────────────────────
//
// Founder, looking at a week-2 report posted while the Monday game was still
// on: "the reports shouldn't go out until early AM on the day after the week
// closes (Tuesday like 4AM EST)."
//
// So the report is no longer a race with the last whistle. The week's numbers
// have all night to settle — a late stat correction, a game the scoreboard
// was slow to hand over, a final re-stamped once the feed caught up — and the
// league wakes up to one account of the week that is not going to change.
//
// THE RULE IS THE NEXT 4 AM EASTERN AFTER THE LAST GAME COULD HAVE ENDED, not
// "Tuesday": a Monday-night week releases Tuesday morning, a Saturday-ending
// week releases Sunday morning, and week 18 releases the day after whatever
// day it actually finishes on. One rule, no calendar special cases.
//
// EASTERN BY NAME, NOT BY OFFSET. "4AM EST" is 09:00Z in January and 08:00Z in
// September; hard-coding either puts the report an hour wrong for half the
// season, and the half it is wrong for is the half the season is played in.
export const REPORT_TZ = 'America/New_York';
export const REPORT_HOUR_ET = 4;
/** How long after kickoff a game can still be running — the pad between the
 *  last kickoff and "the week is over". Generous on purpose: overrunning into
 *  the 4 AM boundary costs a day, and no NFL game runs four hours. */
export const GAME_RUN_MS = 4 * 60 * 60 * 1000;

interface EtParts { y: number; mo: number; d: number; h: number; mi: number; s: number }
function etParts(ms: number): EtParts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = x.value;
  // hour12:false still renders midnight as 24 in some ICU builds.
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** The instant of an Eastern wall-clock reading. Two passes because the offset
 *  it needs depends on the answer it is computing: the first guess lands
 *  within an hour, which is close enough for the second to read the right side
 *  of a DST change. */
function etWall(y: number, mo: number, d: number, hour: number): number {
  const naive = Date.UTC(y, mo - 1, d, hour);
  const offsetAt = (ms: number) => {
    const p = etParts(ms);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - (ms - (ms % 1000));
  };
  const first = naive - offsetAt(naive);
  return naive - offsetAt(first);
}

/** The first 4 AM Eastern strictly after `afterMs` — when a week whose last
 *  game ended at `afterMs` may be written up. */
export function nextReportRelease(afterMs: number, hour = REPORT_HOUR_ET): number {
  if (!Number.isFinite(afterMs)) return 0;
  const p = etParts(afterMs);
  const today = etWall(p.y, p.mo, p.d, hour);
  if (today > afterMs) return today;
  const next = new Date(Date.UTC(p.y, p.mo - 1, p.d) + 86_400_000);
  return etWall(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour);
}

/** When a week whose last KICKOFF is `lastKickoffMs` may be reported. 0 when
 *  the slate is unknown, which the caller reads as "no gate" rather than
 *  holding a report forever on a missing row. */
export function weekReportRelease(lastKickoffMs: number | null | undefined): number {
  if (lastKickoffMs == null || !Number.isFinite(lastKickoffMs)) return 0;
  return nextReportRelease(lastKickoffMs + GAME_RUN_MS);
}
