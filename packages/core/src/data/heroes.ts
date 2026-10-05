// HEROES & VILLAINS (v0.632.0) — who to root for this week, across every league.
//
// Founder: "Let's make a heroes and villains feature on the your leagues
// page. It lists the key players for your matchups and how many matchups
// they are in for you. Heroes and players you should be rooting for and
// Villains players you are rooting against. It should also have suggestions
// for your quad box for game windows with multiple games and a list of key
// games for your matchups."
//
// Pure: the leagues page already holds every league's snapshot (the glance,
// core widgetFeed), and since v0.632.0 a snapshot carries both lineups
// (`sides`). This folds them: a HERO is a man starting for me, counted once
// per matchup he starts in; a VILLAIN starts against me, counted the same
// way; a man on both sides of my week is CONFLICTED and listed on both with
// the other count beside him. A KEY GAME is one with heroes or villains in
// it, ranked by how many of my matchups it touches (its stake). A QUAD BOX
// is a window with several games, with the four that carry the most stake
// — the four screens to put up.
//
// The NFL week only: a daily-sport league's board weeks (301+) carry their
// own slates, and their matchups are a different product (SportWeekPanel).
import type { WidgetSnapshot, SidePlayer } from './widgetFeed';
import { nflGameForTeam, windowForTeam, windowsForWeek, gamesInWindow } from './nflSlate';
import { normTeam } from './slugMeta';
import { SPORT_WEEK_BASE } from '../sports/league';

export interface StakeLeague { leagueId: string; leagueName: string; opponent: string }
export interface StakePlayer {
  slug: string; name: string; pos: string | null; team: string | null;
  /** My matchups he starts FOR me in, and AGAINST me in. */
  heroIn: StakeLeague[]; villainIn: StakeLeague[];
  /** The larger of the two counts — the list's order. */
  count: number;
  status: 'pre' | 'live' | 'final';
  pts: number | null; proj: number | null;
  /** The game he plays in this week, as `AWAY@HOME`, or null (bye, unknown team). */
  game: string | null;
}
export interface KeyGame {
  key: string; away: string; home: string; win: string | null; kickoff: number | null;
  heroes: StakePlayer[]; villains: StakePlayer[];
  /** Matchups touched: every hero count plus every villain count. */
  stake: number;
  /** The leagues this game matters to, by name, once each. */
  leagues: string[];
  status: 'pre' | 'live' | 'final';
}
export interface QuadBox {
  win: string; label: string;
  /** The four screens: the window's games by stake, then kickoff. */
  games: KeyGame[];
  /** Games in the window beyond the four. */
  others: number;
}
export interface HeroesVillains {
  week: number | null;
  heroes: StakePlayer[]; villains: StakePlayer[]; conflicted: StakePlayer[];
  games: KeyGame[]; quads: QuadBox[];
  /** Opponents' drip slots still sealed — villains yet to be revealed. */
  sealed: number;
  /** Leagues folded in (NFL leagues with a readable matchup this week). */
  leagues: number;
}

const rank = { live: 0, pre: 1, final: 2 } as const;
const gameKey = (week: number, team: string | null): string | null => {
  const g = nflGameForTeam(week, team);
  return g ? `${normTeam(g.away)}@${normTeam(g.home)}` : null;
};
const statusOf = (xs: { status: 'pre' | 'live' | 'final' }[]): 'pre' | 'live' | 'final' =>
  xs.some((x) => x.status === 'live') ? 'live' : xs.length && xs.every((x) => x.status === 'final') ? 'final' : 'pre';

/** The week the page folds: the one most of the NFL snapshots are on. */
export function heroesWeek(snaps: WidgetSnapshot[]): number | null {
  const n = new Map<number, number>();
  for (const s of snaps) if (s.sides && s.week < SPORT_WEEK_BASE) n.set(s.week, (n.get(s.week) ?? 0) + 1);
  let best: number | null = null, bestN = 0;
  for (const [w, c] of n) if (c > bestN || (c === bestN && best != null && w > best)) { best = w; bestN = c; }
  return best;
}

export function heroesVillains(snaps: WidgetSnapshot[], week: number | null = heroesWeek(snaps)): HeroesVillains {
  const empty: HeroesVillains = { week, heroes: [], villains: [], conflicted: [], games: [], quads: [], sealed: 0, leagues: 0 };
  if (week == null) return empty;
  const used = snaps.filter((s) => s.sides && s.week === week && s.phase !== 'bye' && s.phase !== 'idle');
  const by = new Map<string, StakePlayer>();
  const take = (p: SidePlayer, side: 'hero' | 'villain', s: WidgetSnapshot) => {
    const at = by.get(p.slug) ?? { slug: p.slug, name: p.name, pos: p.pos, team: p.team, heroIn: [], villainIn: [], count: 0, status: p.status, pts: p.pts, proj: p.proj, game: gameKey(week, p.team) };
    const lg: StakeLeague = { leagueId: s.leagueId, leagueName: s.leagueName, opponent: s.them?.name ?? 'Opponent' };
    const list = side === 'hero' ? at.heroIn : at.villainIn;
    if (!list.some((l) => l.leagueId === s.leagueId)) list.push(lg);
    // The fullest picture of him: a live number over a projection, a team
    // and position from whichever league knew them.
    if (at.pts == null && p.pts != null) at.pts = p.pts;
    if (at.proj == null && p.proj != null) at.proj = p.proj;
    if (!at.team && p.team) { at.team = p.team; at.game = gameKey(week, p.team); }
    if (!at.pos && p.pos) at.pos = p.pos;
    if (rank[p.status] < rank[at.status]) at.status = p.status;
    at.count = Math.max(at.heroIn.length, at.villainIn.length);
    by.set(p.slug, at);
  };
  let sealed = 0;
  for (const s of used) {
    for (const p of s.sides!.mine) take(p, 'hero', s);
    for (const p of s.sides!.theirs) take(p, 'villain', s);
    sealed += s.sides!.theirsSealed;
  }
  const order = (a: StakePlayer, b: StakePlayer) => b.count - a.count || (b.proj ?? b.pts ?? 0) - (a.proj ?? a.pts ?? 0) || a.name.localeCompare(b.name);
  const all = [...by.values()];
  const heroes = all.filter((p) => p.heroIn.length).map((p) => ({ ...p, count: p.heroIn.length })).sort(order);
  const villains = all.filter((p) => p.villainIn.length).map((p) => ({ ...p, count: p.villainIn.length })).sort(order);
  const conflicted = all.filter((p) => p.heroIn.length && p.villainIn.length).sort(order);

  // Key games: every game a hero or villain plays in, ranked by stake.
  const games = new Map<string, KeyGame>();
  for (const p of all) {
    if (!p.game) continue;
    const g = nflGameForTeam(week, p.team)!;
    const kg = games.get(p.game) ?? { key: p.game, away: normTeam(g.away), home: normTeam(g.home), win: windowForTeam(week, p.team), kickoff: g.kickoff ?? null, heroes: [], villains: [], stake: 0, leagues: [], status: 'pre' };
    if (p.heroIn.length) kg.heroes.push({ ...p, count: p.heroIn.length });
    if (p.villainIn.length) kg.villains.push({ ...p, count: p.villainIn.length });
    kg.stake += p.heroIn.length + p.villainIn.length;
    for (const l of [...p.heroIn, ...p.villainIn]) if (!kg.leagues.includes(l.leagueName)) kg.leagues.push(l.leagueName);
    games.set(p.game, kg);
  }
  for (const kg of games.values()) {
    kg.heroes.sort(order); kg.villains.sort(order);
    kg.status = statusOf([...kg.heroes, ...kg.villains]);
  }
  const byStake = (a: KeyGame, b: KeyGame) => b.stake - a.stake || (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity) || a.key.localeCompare(b.key);
  const keyGames = [...games.values()].sort(byStake);

  // Quad boxes: windows with several games; the four with the most stake,
  // the rest of the window's games (no stake) filling by kickoff.
  const quads: QuadBox[] = [];
  for (const w of windowsForWeek(week)) {
    const inWin = gamesInWindow(week, w.id);
    if (inWin.length < 2) continue;
    const rows: KeyGame[] = inWin.map((g): KeyGame => {
      const key = `${normTeam(g.away)}@${normTeam(g.home)}`;
      return games.get(key) ?? { key, away: normTeam(g.away), home: normTeam(g.home), win: w.id, kickoff: g.kickoff ?? null, heroes: [], villains: [], stake: 0, leagues: [], status: 'pre' as const };
    }).sort(byStake);
    quads.push({ win: w.id, label: w.label, games: rows.slice(0, 4), others: Math.max(0, rows.length - 4) });
  }
  return { week, heroes, villains, conflicted, games: keyGames, quads, sealed, leagues: used.length };
}
