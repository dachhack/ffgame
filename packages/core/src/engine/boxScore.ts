// THE GAME'S BOX SCORE (v0.336.0).
//
// Founder: "let's have a small chip at the bottom of the field visual. when you
// click it, you get a pop up with all the players in that game by team and
// their current stat lines."
//
// The field already shows the last play and the game log shows every play. What
// neither answers is the ordinary question you ask while watching — "who is
// actually doing anything out there" — including players nobody in the league
// rosters, which is exactly why it cannot be built from the matchup's picks.
//
// ── IT READS THE SAME NUMBERS THE CARDS DO ─────────────────────────────────
// `statlineFrom` over `realRawPlays`, which is the accumulation the player cards
// and the board already use. A box score that computed its own totals would be
// a second opinion, and the first argument it lost would be about whether the
// board or the box score was lying.
//
// ── EMPTY LINES ARE DROPPED ────────────────────────────────────────────────
// A live week's play table contains every player the poller has ever written a
// row for, and a listing padded with a hundred names at 0-0 is not a box score,
// it is a roster. Only players who have DONE something appear.

import { statlineFrom, realRawPlays, fmtStat, type StatLine } from './sim';
import { realPbpSlugs } from '../data/realPbp';
import { gameFeedFor, allGameFeeds } from '../data/gameFeed';
import { slugMeta, normTeam } from '../data/slugMeta';
import { teamFor } from '../data/playerTeam';
import type { Pos } from '../theme';

export interface BoxRow {
  slug: string;
  pos: Pos;
  team: string;
  /** Already formatted with the shared `fmtStat`, so the box score and the
   *  cards phrase the same numbers the same way. */
  stat: string;
  line: StatLine;
  /** Involvement score. No longer the primary sort (v0.338.3) — it is the
   *  TIEBREAK, and the one that orders defenders, for whom "yards" is not a
   *  measure of anything. Exposed so the assertions can pin the ordering
   *  rather than infer it. */
  weight: number;
  /** SCRIMMAGE yards — passing, rushing and receiving, at full value. The sort
   *  key within a position group.
   *
   *  Two deliberate exclusions. Not `weigh`'s discounted passing: that discount
   *  exists to compare a QB against a RB, and inside a group of QBs it only
   *  distorts the answer. And NOT RETURN YARDS (v0.338.4, founder's call) —
   *  a receiver with 14 receiving and 86 on kick returns is not the best
   *  receiver in the game, and ranking him as one is exactly what a box score
   *  is being read to avoid. Returns still count in `weigh`, so they break
   *  ties and still rank a pure returner ahead of someone who did nothing. */
  yards: number;
  /** Which half of the box score this row belongs to. */
  side: 'off' | 'def';
}

/** The defensive positions. Everything else — including K, P and the returner
 *  slot — sits on the offensive half, which is where a box score reader looks
 *  for them.
 *
 *  NOT `matchupBoard`'s POS_ORDER, which is the closest existing list and
 *  cannot serve: it ranks FB after DB, so it does not encode an offense /
 *  defense split at all. Ordering a lineup and ordering a box score are
 *  different questions and this is the one place that needs the split. */
const DEF_POS = new Set<string>(['DEF', 'DL', 'LB', 'DB']);

/** Reading order within each half. Conventional football order on offense;
 *  the team unit first on defense, then front to back. */
const POS_RANK: Record<string, number> = {
  QB: 0, RB: 1, FB: 2, WR: 3, TE: 4, K: 5, P: 6, RET: 7, HC: 8,
  DEF: 0, DL: 1, LB: 2, DB: 3,
};

/** The box score's yards, exported so the exclusion is assertable rather than
 *  a claim in a comment. */
export const scrimmageYards = (s: StatLine): number => s.passYds + s.rushYds + s.recYds;

export interface GameBox {
  home: BoxRow[];
  away: BoxRow[];
}

/** Total yards from scrimmage + return, plus a heavy nudge for scores. Not a
 *  fantasy projection and deliberately not one: this orders a BOX SCORE, where
 *  the useful answer is "who has the ball been going to", the same in every
 *  league whatever its scoring. */
function weigh(s: StatLine): number {
  const yards = s.passYds * 0.4 + s.rushYds + s.recYds + s.retYds;
  const tds = s.passTds + s.rushTds + s.recTds + s.retTds + s.dtd;
  const def = s.sacks * 12 + s.ints * 20 + s.fumrec * 15 + s.tackles * 2 + s.safety * 20;
  return yards + tds * 25 + def;
}

/** True when a line has any counting stat at all. */
export function hasStats(s: StatLine): boolean {
  return weigh(s) !== 0
    || s.carries > 0 || s.targets > 0 || s.rec > 0 || s.fg > 0 || s.xp > 0;
}

/** Everyone with stats in one game, split by team and ordered by involvement.
 *
 *  `clock` is the game-clock position the rest of the screen is showing, so
 *  scrubbing the log scrubs the box score with it rather than always reporting
 *  the present. */
export function gameBoxScore(week: number, home: string, away: string, clock: number): GameBox {
  // BOTH VOCABULARIES, ONE CODE (v0.343.2). `home`/`away` arrive in the FEED's
  // vocabulary (ESPN's: LAR, WSH, JAC) while slugMeta answers in the SLATE's
  // (LA, WAS, JAX) — so a raw compare silently dropped every Rams player from
  // a NO@LAR box score while the Saints column filled normally (the founder's
  // "weird that only saints have stats?" screenshot). normTeam on both sides
  // is the whole fix; an unrecognised code still just never matches.
  const H = normTeam(home ?? ''), A = normTeam(away ?? '');
  const out: GameBox = { home: [], away: [] };
  if (!H || !A) return out;

  // THE GAME'S OWN PLAYS DECIDE MEMBERSHIP (v0.344.1). Team filtering alone
  // trusted slugMeta — the BAKED 2025 tags for anyone no league rosters — so a
  // player who changed teams over the offseason haunted his old team's box
  // score with stats from whatever game he actually played: the founder's
  // NYG@MIA sheet listed 2025 Dolphins ("Zach Wilson and Waddle are not on the
  // dolphins this year") carrying lines from their real 2026 games elsewhere.
  // The game feed carries every play's id, and live plays carry theirs — so a
  // player is in THIS game iff his plays are. The team tag then only picks the
  // COLUMN, and when it names neither team (stale the other way: a new arrival
  // the bake still files elsewhere) the column is derived from the feed too:
  // offensive players appear in their own team's plays, defenders in the
  // opponent's. Data baked before play ids (pid-less) keeps the old team rule.
  //
  // MOST of his plays, not ANY (v0.352.3). `pid` is only unique WITHIN a game
  // — ESPN's live ids happen to be globally unique, but the baked nflverse ids
  // restart every game, so on a baked/sim week "any pid matches" admitted
  // nearly the whole pool (the founder's SEA@TEN sheet listing seventeen QBs a
  // side, Jordan Love among them). A player actually in the game matches ~all
  // of his ids against the feed; a stranger's numeric collisions are a few
  // percent — so the test is a strict majority, decisive on both data shapes
  // without depending on how the ids were minted.
  //
  // …AND THE CLOCK HAS TO AGREE (v0.368.6). The majority rule collapses for a
  // player with ONE play: a pure returner's single small id collides with an
  // early play of every game, 1-of-1 is a majority, and he appears in every
  // box score on the slate with the same line (the founder's "how is Jalen
  // Reagor on two teams?"). A play is this game's only when its id AND its
  // game-clock position both match — the feed's `c` and the play's `clock`
  // come from the same clockOf, so a genuine member matches exactly, while a
  // foreign collision would need the same id at the same second (±3s covers
  // any revision jitter). The column derivation counts only matched plays for
  // the same reason: a collision must not get to steer the column either.
  //
  // ── THE GAME ID IS THE ANSWER WHERE IT EXISTS (v0.369.0) ─────────────────
  // Even (pid, clock) has a degenerate case: the OPENING KICKOFF happens at
  // clock ≈ 0 with the game's first play ids in EVERY game, so a pure kick
  // returner still collided (the founder's "Jonathan Ward still in two
  // places. Don't we have player IDs to use?"). We do: every live_play row
  // carries the game_id it was ingested from, and every game_feed row carries
  // its own — the exact join, now threaded through instead of dropped at the
  // API layer. Where a player's plays name a game the week's feeds know, that
  // IS the membership answer, no heuristics. The pid/clock rules stay as the
  // fallback for data without game ids: the 2025 bakes, and the board sim
  // (whose live_play rows are flat 'SIM' — week-scoped, so they name no feed
  // game and prove nothing either way).
  const feed = gameFeedFor(week, H);
  const feedGid = feed?.gid ?? null;
  const weekGids = new Set<string>();
  for (const f of allGameFeeds(week)) if (f.gid) weekGids.add(f.gid);
  const pidTm = new Map<number, string>();
  const pidClocks = new Map<number, number[]>();
  for (const p of feed?.plays ?? []) {
    if (p.pid == null) continue;
    pidTm.set(p.pid, normTeam(p.tm ?? ''));
    const cs = pidClocks.get(p.pid) ?? [];
    cs.push(p.c);
    pidClocks.set(p.pid, cs);
  }
  const playMatches = (pid: number | null | undefined, clock: number): boolean =>
    pid != null && (pidClocks.get(pid) ?? []).some((c) => Math.abs(c - clock) <= 3);

  for (const slug of realPbpSlugs(week)) {
    const meta = slugMeta(slug);
    // THE COLUMN READS THE CURRENT TEAM, NOT THE 2025 TAG (v0.369.5, founder:
    // "Tua is on the falcons. How hard would it be to actually use a player
    // id?"). slugMeta answers from the baked play stream FIRST — its team is
    // the player's majority 2025 club, kept deliberately so baked plays keep
    // scoring under the possession rules they were written against — which
    // seated an offseason mover in his OLD team's column whenever that team
    // happened to be in the game (Tua, MIA→ATL, in ATL@MIA). The current
    // team already exists id-keyed on this client: the worker diffs Sleeper's
    // directory into player_team_override daily, and the bio bake carries the
    // rest — `teamFor` reads exactly that chain. The baked tag is only the
    // last resort, for a man neither knows.
    const team = normTeam(teamFor(slug) ?? meta.team ?? '');
    const plays = realRawPlays(slug, week);
    if (!plays || !plays.length) continue;
    const line = statlineFrom(plays, clock);
    if (!hasStats(line)) continue;
    const withPid = plays.filter((p) => p.pid != null);
    // true = his plays are in this game; false = provably elsewhere; null = no
    // pid data on one side or the other, membership unknowable → team rule.
    // The GAME-ID join answers first (v0.369.0): a play gid that names any of
    // the week's feed games is decisive evidence, exactly.
    const knownGids = [...new Set(plays.map((p) => p.gid).filter((g): g is string => !!g && weekGids.has(g)))];
    const matchedPlays = withPid.filter((p) => playMatches(p.pid, p.clock));
    const inGame = feedGid && knownGids.length ? knownGids.includes(feedGid)
      : pidTm.size && withPid.length ? matchedPlays.length * 2 > withPid.length : null;
    if (inGame === false) continue;
    if (inGame === null && team !== H && team !== A) continue;
    let pos = (meta.pos ?? 'WR') as Pos;
    // THE UNKNOWN PLAYER'S POSITION COMES FROM HIS STATS (v0.369.3, founder:
    // "some mix up def vs off on Miami"). The bio bake is fantasy-skewed and
    // thin on fringe men, so a corner it has never heard of takes the WR/''
    // default — which filed his tackles on the OFFENSE side of the split and,
    // worse, skipped the defender column flip: an ATL corner tackling on
    // MIA's snaps landed in MIA's column wearing a WR chip. And an unknown
    // QB's line rendered as "0/0 rec · 0 rec yd". For a man NOTHING knows,
    // the line itself says what he is: passing stats make him a QB, a purely
    // defensive line makes him a generic DB — right tab, right column, stats
    // phrased in their own vocabulary. Known players are untouched, so a real
    // WR whose only stat is a tackle keeps the v0.343.2 two-way treatment.
    if (!team && pos === 'WR') {
      if (line.att > 0 || line.passYds !== 0 || line.sacked > 0 || line.passTds > 0 || line.passInts > 0) pos = 'QB';
      else if (defInvolved(line) && !offInvolved(line)) pos = 'DB';
    }
    let col = team === H ? H : team === A ? A : null;
    if (!col) {
      // In the game, but the tag names neither team: majority offense of his
      // MATCHED plays, flipped for defenders (their plays are the opponent's
      // snaps).
      const n = new Map<string, number>();
      for (const p of matchedPlays) { const tm = pidTm.get(p.pid!); if (tm) n.set(tm, (n.get(tm) ?? 0) + 1); }
      const top = [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      if (!top) continue;
      const mine = DEF_POS.has(pos) ? (top === H ? A : top === A ? H : '') : top;
      col = mine === H ? H : mine === A ? A : null;
      if (!col) continue;
    }
    (col === H ? out.home : out.away).push({
      slug, pos, team: col, line, weight: weigh(line), stat: fmtStat(pos, line),
      yards: scrimmageYards(line), side: DEF_POS.has(pos) ? 'def' : 'off',
    });
  }
  out.home.sort(boxRowOrder); out.away.sort(boxRowOrder);
  return out;
}

/** OFFENSE, THEN POSITION, THEN YARDS (v0.338.3, founder's call).
 *
 *  It used to be one flat involvement ranking, which put a 6-tackle linebacker
 *  above a 46-yard receiver and made the list impossible to scan for "how did
 *  the backs do" — the question a box score exists to answer.
 *
 *  `weight` survives as the TIEBREAK, and it is doing real work rather than
 *  padding the chain: every defender has 0 yards, so within LB or DB it is
 *  `weight` that does the whole ordering — tackles, sacks and picks, which is
 *  the only sensible reading of "highest at the top" for a player who gains
 *  none. The slug is last so the order is total and stable.
 *
 *  Exported so it can be asserted on its own: `gameBoxScore` reads a week's
 *  play table through module globals, so pinning the order through it would
 *  mean installing a PBP week to test a comparator. The rule is the part with
 *  judgement in it, and this is the part to assert. */
export const boxRowOrder = (a: BoxRow, b: BoxRow): number =>
    (a.side === b.side ? 0 : a.side === 'off' ? -1 : 1)
    || ((POS_RANK[a.pos] ?? 99) - (POS_RANK[b.pos] ?? 99))
    || (b.yards - a.yards)
    || (b.weight - a.weight)
    || a.slug.localeCompare(b.slug);

// ── THE TAB SPLIT (v0.343.2) ───────────────────────────────────────────────
// Founder: "the box score gets cut off. Let's have a tab for offense and a tab
// for defense. if a player has multiple designations (Travis Hunter) put them
// in both positions."
//
// Membership is decided by the STAT LINE, not the roster tag: a tab shows
// everyone who DID something on that side of the ball. That is what makes the
// two-way case fall out for free — a player with catches and tackles simply
// qualifies for both tabs — and it keeps a tab from padding itself with
// zero lines (a WR whose only stat is a tackle after an interception appears
// under DEFENSE, where his stat is, not under OFFENSE with an 0/0 line).

/** Any offensive, kicking or return involvement. Yardage compares ≠ 0, not
 *  > 0 — a back with three carries for −4 yards is still in the game. */
export const offInvolved = (s: StatLine): boolean =>
  s.carries > 0 || s.targets > 0 || s.rec > 0 || s.fg > 0 || s.xp > 0
  || s.passYds !== 0 || s.rushYds !== 0 || s.recYds !== 0
  || s.passTds > 0 || s.rushTds > 0 || s.recTds > 0
  || s.retYds !== 0 || s.retTds > 0;

/** Any defensive splash. */
export const defInvolved = (s: StatLine): boolean =>
  s.tackles > 0 || s.sacks > 0 || s.ints > 0 || s.fumrec > 0
  || s.dtd > 0 || s.safety > 0;

/** One tab of a team's column: every row involved on that side of the ball.
 *
 *  A row crossing onto the tab OPPOSITE its listed position (the two-way case)
 *  is re-phrased through that side's lens — the defense tab shows the tackles,
 *  not a second copy of the receiving line — and sorts AFTER the tab's native
 *  rows, by involvement: the natives keep `boxRowOrder`'s position-then-yards
 *  reading, and the visitors line up behind them where a reader expects the
 *  odd case to be. Rows are copies; the underlying box is never mutated. */
export function boxTabRows(rows: BoxRow[], tab: 'off' | 'def'): BoxRow[] {
  const involved = tab === 'off' ? offInvolved : defInvolved;
  const native: BoxRow[] = [], visiting: BoxRow[] = [];
  for (const r of rows) {
    // The fallback keeps a row whose line somehow satisfies neither predicate
    // (hasStats admits freak zero-sum yardage lines) on its own side's tab
    // rather than dropping it from both.
    if (!(involved(r.line) || (r.side === tab && !offInvolved(r.line) && !defInvolved(r.line)))) continue;
    if (r.side === tab) { native.push(r); continue; }
    const lens: Pos = tab === 'def' ? 'DB'
      : r.line.carries > 0 && r.line.rec === 0 ? 'RB' : 'WR';
    visiting.push({ ...r, stat: fmtStat(lens, r.line) });
  }
  visiting.sort((a, b) => (b.weight - a.weight) || a.slug.localeCompare(b.slug));
  return [...native, ...visiting];
}
