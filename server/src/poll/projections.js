// THE WEEK'S NUMBER, AND THE NEWS (0329, re-sourced 0330).
//
// Two polls, both idempotent, both writing through one RPC — but they no
// longer come from the same place, because the two questions do not have the
// same best answer.
//
//   pollWeekProjections — StatHead's per-week split of the SAME season model
//     this app already ranks, drafts and grades with (proj2026.ts). The feed
//     is that season projection spread across the schedule: season PPG ×
//     the opponent's defense-vs-position multiplier × a home/away nudge (or
//     an implied team total where the market has posted one), normalized so
//     the weeks sum back to the season line. We store the MULTIPLIER rather
//     than trusting the points, because the multiplier scales the player's
//     whole stat line — so a league's own season number × mult is that
//     league's own week number, exactly, under any scoring catalog. 0330.
//
//     ESPN IS STILL HERE, as the fallback. It answers for a player StatHead
//     has no line for, and for a day the feed cannot be reached, keyed by
//     athlete id under source 'espn'; the reader prefers StatHead per
//     player and falls back per player.
//
//   pollPlayerNews — the NFL headline feed, kept only where a story is
//     TAGGED with the athletes it is about. An untagged story is a story
//     about the league, not about somebody's flex spot, and this feed exists
//     to answer "why is he questionable". StatHead publishes no news feed,
//     so this half stays ESPN's and is unchanged.
//
// NO NAME MATCHING ANYWHERE IN THIS FILE. StatHead rows are keyed by the
// sleeper id the feed carries (league_pool.sleeper_id, 0205), ESPN rows by
// the athlete id (league_pool.espn_id, 0066). Names drift between sources,
// ids do not, and the one thing worse than no projection is somebody else's.
import { db } from '../supabase.js';
import { setLiveProjRate } from '../../../packages/core/src/engine/projScoring.ts';

// ── StatHead: one public JSON, rebuilt about every two hours ─────────────
// The same file the `stathead` Python client reads (public/data/weekly-
// projections-<season>.json). Plain HTTPS, no key, no vendor SDK in the
// worker — which is why this could replace ESPN without asking anybody for
// an API. Both halves of the URL are env-overridable so a pinned ref can be
// used for a reproducible run.
const SH_BASE = process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead';
const SH_REF = process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd';
const shUrl = (season) => `${SH_BASE}/${SH_REF}/public/data/weekly-projections-${season}.json`;

// One fetch serves every week in a sweep (and the next sweep inside the TTL):
// the file carries all 18 weeks for all ~845 players, so pulling it per week
// would be the same 350 KB three times over for no new information.
const SH_TTL_MS = Number(process.env.STATHEAD_TTL_MS || 1800000);
let shCache = { season: null, at: 0, feed: null };
export async function statheadFeed(season) {
  if (shCache.feed && shCache.season === String(season) && Date.now() - shCache.at < SH_TTL_MS) return shCache.feed;
  const res = await fetch(shUrl(season), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`stathead weekly ${res.status}`);
  const feed = await res.json();
  shCache = { season: String(season), at: Date.now(), feed };
  return feed;
}

/** The feed's rows for one week, in the shape upsert_week_projections wants.
 *  `mult` is week ÷ season rate — the scoring-independent half, and the only
 *  number a custom-scoring league should use. A null week is a bye and is
 *  simply absent; a player the feed has zeroed (IR, practice squad, cut)
 *  comes through at 0 WITH a status, because "he is out" is the answer and
 *  not missing data. */
export function statheadRows(feed, week) {
  const sched = feed?.teamWeeks ?? {};
  const rows = [];
  for (const p of feed?.players ?? []) {
    const sid = p?.sleeper;
    if (!sid) continue;                       // no crosswalk id, no honest join
    const pts = (p.wk ?? [])[Number(week) - 1];
    if (pts == null) continue;                // bye week
    const ppg = Number(p.ppg);
    const game = (sched[p.team] ?? []).find((g) => Number(g.w) === Number(week)) ?? null;
    rows.push({
      key: String(sid), source: 'stathead',
      pts: Math.round(Number(pts) * 100) / 100,
      // A season rate of zero cannot be scaled; such a row carries points
      // only, and a client with its own catalog falls back to them.
      mult: Number.isFinite(ppg) && ppg > 0 ? Math.round((Number(pts) / ppg) * 10000) / 10000 : null,
      opp: game?.opp ?? null,
      home: game?.home ?? null,
      status: p.active === false ? String(p.status || 'OUT') : p.backup ? 'backup' : null,
    });
  }
  return rows;
}

/** THE SEASON LINE, out of the same file (0335).
 *
 *  The weekly feed carries every player's season projection beside his weekly
 *  strip — `ppg`, the games he is projected to play, and the rest-of-season
 *  pair — each with a sleeper id. `proj2026.ts` stores a PER-WEEK rate
 *  (ppg × games ÷ 17), so that is the shape stored here: the client takes the
 *  ratio against its own baked rate and applies it to the LEAGUE-SCORED
 *  number, which is the only way to move the level without throwing the
 *  league's own catalog away. */
// ── WHAT HE IS ACTUALLY DOING (v0.519.0) ─────────────────────────────────
// Founder, with a screenshot: "our projections need some work. Coker and
// Golden are really low." Coker had 33.8 and 14.6 and the board said 6.8;
// Golden 15.5 and 9.8 on 18 targets, and the board said 4.4. Two causes:
//
//   1. THE SOURCE IS NOT BLENDING. StatHead documents an in-season blend of
//      each line toward what the player is doing, at games/(games+K), and
//      its feed carries the actuals (`act`) — but its `ppg` does not move:
//      across the 65 players whose first two weeks sat 6+ points off their
//      August rate, the median weight the rate put on them was 0.0. So the
//      blend is done here, with the source's own fitted K per position, the
//      source's ppg as the prior. `act` is null for a game he did not play
//      and a number (0 included) for one he did, so a DNP never drags him.
//      If the feed ever starts carrying its own `inSeasonGames`, it has
//      blended already and this steps aside rather than counting twice.
//
//   2. A SEASON'S INJURIES CHARGED EVERY WEEK. per_week was ppg × gp ÷ 17 —
//      the games haircut, there so a one-game backup's inflated rate lands
//      near zero (see proj2026.ts). For Coker (13 of 17) that took a quarter
//      off every week he is healthy and playing. So an ACTIVE, non-backup
//      player who has been on the field this season is priced at his rate;
//      this week's own risk is his injury designation, which the boards show
//      and the AI prices (slateAwareProj discountRisk). Backups, inactive
//      players and anyone yet to play keep the haircut.
export const BLEND_K = { QB: 5.5, RB: 3.5, WR: 4.5, TE: 5.0 };
const BLEND_K_DEFAULT = 4.5;

/** One feed row's per-game rate, blended toward his 2026 games, and the
 *  share of a week he is expected to be worth it. Pure; exported for the
 *  assertion suite. */
export function inSeasonRate(p) {
  const ppg = Number(p?.ppg);
  if (!Number.isFinite(ppg) || ppg <= 0) return null;
  const played = (Array.isArray(p.act) ? p.act : []).filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
  const k = BLEND_K[p.pos] ?? BLEND_K_DEFAULT;
  const blended = played.length && p.inSeasonGames == null
    ? (k * ppg + played.reduce((a, b) => a + b, 0)) / (k + played.length)
    : ppg;
  const gp = Number.isFinite(Number(p.gp)) ? Number(p.gp) : 17;
  const playing = p.active !== false && !p.backup && played.length > 0;
  const avail = playing ? 1 : Math.min(1, gp / 17);
  return { rate: blended, avail, perWeek: blended * avail, games: played.length };
}

export function seasonRows(feed, playerIndex = null) {
  const rows = [];
  for (const p of feed?.players ?? []) {
    const sid = p?.sleeper;
    const ppg = Number(p?.ppg);
    if (!sid || !Number.isFinite(ppg) || ppg <= 0) continue;
    const gp = Number.isFinite(Number(p.gp)) ? Number(p.gp) : 17;
    const r = inSeasonRate(p);
    rows.push({
      sleeper_id: String(sid),
      // OUR SLUG (v0.456.0). `league_market` keys the map by it; without it
      // the board upserted fine and served an empty map to every screen —
      // the whole projection half of 0335 shipped inert. The audit caught it.
      slug: playerIndex?.sleeper?.(String(sid))?.slug ?? null,
      ppg: Math.round(r.rate * 100) / 100,
      gp: Math.round(gp * 100) / 100,
      per_week: Math.round(r.perWeek * 1000) / 1000,
      ros_ppg: Number.isFinite(Number(p.rosPPG)) ? Math.round(Number(p.rosPPG) * 100) / 100 : null,
      games_left: Number.isFinite(Number(p.gamesRemaining)) ? Number(p.gamesRemaining) : null,
      source: 'stathead',
    });
  }
  return rows;
}

// ── THE WORKER READS THE SAME LEVEL THE BOARDS SHOW (v0.519.0) ───────────
// The boards install `proj_board` through league_market; the worker never
// did, so every AI decision — the lineup fill, the waiver sweep, the drop
// rail — ranked on the August bake while the manager's screen showed the
// live number. Installed once per tick from the table this file writes,
// cached so the 25-second tick costs one read every few minutes.
const LIVE_TTL_MS = Number(process.env.PROJ_LIVE_TTL_MS || 600000);
let liveAt = 0;
export async function installLiveProjRate(log = () => {}) {
  if (Date.now() - liveAt < LIVE_TTL_MS) return;
  liveAt = Date.now();
  try {
    const map = {};
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db().from('proj_board')
        .select('slug,sleeper_id,per_week').not('per_week', 'is', null).range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        // Keyed as league_market keys it: our slug, else the sleeper id —
        // and both, so the id fallback in projectedPoints finds him either way.
        const v = Number(r.per_week);
        if (!(v > 0)) continue;
        if (r.slug) map[r.slug] = v;
        if (r.sleeper_id) map[r.sleeper_id] = v;
      }
      if ((data ?? []).length < 1000) break;
    }
    setLiveProjRate(map);
  } catch (e) { log('live projection rate', e.message); }
}

const PROJ_HOST = 'https://lm-api-reads.fantasy.espn.com';
const NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50';

/** The projected stat line, in OUR field names. ESPN's stat ids are stable —
 *  these are the offensive ones that matter, verified against the source's
 *  own scored total by scripts/check-proj-map.mjs. Anything unmapped is
 *  dropped rather than guessed. */
// SKILL POSITIONS ONLY for the raw line. A kicker's projection is made of
// field-goal-by-distance ids and a defense's of points-allowed brackets;
// mapping those would be a second decoding job for two positions whose
// weekly number the source already scores correctly. So K and DST carry the
// TOTAL (which is right) and no line (rather than a wrong one).
const SKILL_POS = new Set([1, 2, 3, 4]);   // QB, RB, WR, TE

const STAT = {
  3: 'paYd', 4: 'paTd', 20: 'paInt', 19: 'pa2p',
  23: 'ruAtt', 24: 'ruYd', 25: 'ruTd', 26: 'ru2p',
  41: 'rec', 42: 'reYd', 43: 'reTd', 44: 're2p', 58: 'tgt',
  53: 'rec', 72: 'fumLost',
};

/** ESPN's kona_player_info, filtered to the top N by ownership — the players
 *  anybody could actually start. The filter goes in a header, which is how
 *  that endpoint has always worked.
 *
 *  NO `filterStatsForTopScoringPeriodIds` (v0.451.0). It was here from the
 *  first version and it is the reason this poller wrote NOTHING: asking for
 *  the top scoring periods returns each player's ACTUAL weekly lines plus one
 *  projected SEASON row, and strips every projected WEEKLY row — the only
 *  rows weekLineFor is looking for. 200 of 200 players carry a week-3
 *  projection without it and 0 of 200 with it. The source audit found this by
 *  comparing ESPN's weekly numbers against StatHead's and getting an empty
 *  set on one side; `npm run validate:proj` never caught it because its own
 *  request (correctly) never had the filter. */
export async function fetchProjections(season, week, limit = 900) {
  const filter = { players: { limit, sortPercOwned: { sortAsc: false, sortPriority: 1 } } };
  const res = await fetch(
    `${PROJ_HOST}/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`,
    { headers: { 'x-fantasy-filter': JSON.stringify(filter), accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`espn projections ${res.status}`);
  return await res.json();
}

/** One player's projected line for one week, or null when the source has no
 *  projection for him that week (a bye, or a man nobody has projected).
 *  `line` is null for a kicker or a defense — see SKILL_POS. */
export function weekLineFor(player, week) {
  const row = (player?.stats ?? []).find(
    (s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && Number(s.scoringPeriodId) === Number(week),
  );
  if (!row) return null;
  const skill = SKILL_POS.has(Number(player?.defaultPositionId));
  let line = null;
  if (skill) {
    line = {};
    for (const [id, v] of Object.entries(row.stats ?? {})) {
      const key = STAT[Number(id)];
      if (!key || !Number.isFinite(Number(v))) continue;
      line[key] = Math.round(Number(v) * 1000) / 1000;
    }
  }
  return { pts: Number(row.appliedTotal ?? 0), line };
}

/** Write a batch of rows for one week. */
async function writeWeek(season, week, rows, log) {
  if (!rows.length) return { rows: 0, skipped: 'nothing projected' };
  const { data, error } = await db().rpc('upsert_week_projections', {
    p_season: String(season), p_week: Number(week), p_rows: rows,
  });
  if (error) { log('projections upsert', error.message); return { rows: 0, error: error.message }; }
  return { rows: Number(data?.rows ?? rows.length) };
}

/** Pull one week and write it. Returns how many players were stored, and
 *  from where. BOTH sources are written when both answer: they are keyed
 *  apart (0330) and the reader picks per player, so ESPN keeps covering the
 *  men StatHead has no line for instead of being switched off wholesale. A
 *  failure on either side is logged and the other still lands. */
export async function pollWeekProjections(season, week, log = () => {}) {
  if (!season || !week || week >= 100) return { rows: 0, skipped: 'no week' };
  let stathead = 0;
  try {
    const feed = await statheadFeed(season);
    const rows = statheadRows(feed, week);
    stathead = Number((await writeWeek(season, week, rows, log)).rows ?? 0);
  } catch (e) { log('projections stathead', e.message); }

  let espn = 0; let espnErr = null;
  try {
    const feed = await fetchProjections(season, week);
    const rows = [];
    for (const entry of feed?.players ?? []) {
      const p = entry?.player;
      if (!p?.id) continue;
      const got = weekLineFor(p, week);
      if (!got || !Number.isFinite(got.pts)) continue;
      rows.push({ key: String(p.id), espn_id: String(p.id), pts: got.pts, line: got.line, source: 'espn' });
    }
    espn = Number((await writeWeek(season, week, rows, log)).rows ?? 0);
  } catch (e) { espnErr = e.message; log('projections espn', e.message); }

  if (!stathead && !espn) return { rows: 0, error: espnErr ?? undefined, skipped: espnErr ? undefined : 'nothing projected' };
  return { rows: stathead + espn, stathead, espn };
}

/** The headline feed, kept where it names players. */
export async function pollPlayerNews(log = () => {}) {
  let feed;
  try {
    const res = await fetch(NEWS_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`espn news ${res.status}`);
    feed = await res.json();
  } catch (e) { log('news', e.message); return { rows: 0, error: e.message }; }
  const rows = [];
  for (const a of feed?.articles ?? []) {
    const athletes = (a?.categories ?? [])
      .filter((c) => c?.type === 'athlete' && c?.athleteId)
      .map((c) => String(c.athleteId));
    // A story about nobody in particular is not player news.
    if (!athletes.length || !a?.headline) continue;
    rows.push({
      id: String(a.id ?? a.headline).slice(0, 120),
      at: a.published ?? a.lastModified ?? new Date().toISOString(),
      headline: a.headline,
      summary: a.description ?? '',
      url: a?.links?.web?.href ?? null,
      athletes: [...new Set(athletes)],
      source: 'espn',
    });
  }
  if (!rows.length) return { rows: 0, skipped: 'nothing tagged' };
  const { data, error } = await db().rpc('upsert_player_news', { p_rows: rows });
  if (error) { log('news upsert', error.message); return { rows: 0, error: error.message }; }
  return { rows: Number(data?.rows ?? rows.length) };
}

// Both are cheap and neither is latency-sensitive: a projection that is an
// hour stale is still this week's, and a headline that arrives an hour late
// is still news. Hourly, with the gate here so the caller can stay a
// one-liner.
const EVERY_MS = Number(process.env.PROJ_POLL_MS || 3600000);
let last = 0;
export async function sweepProjections(season, weeks = [], log = () => {}, playerIndex = null) {
  if (Date.now() - last < EVERY_MS) return { projections: 0, news: 0 };
  last = Date.now();
  let projections = 0;
  for (const w of new Set(weeks.filter((w) => Number.isInteger(w) && w > 0 && w < 100))) {
    const r = await pollWeekProjections(season, w, log);
    projections += Number(r.rows ?? 0);
  }
  // THE SEASON BOARD (0335), out of the file the weeks just came from — so
  // this costs a parse, not a fetch. `statheadFeed` is cached for the sweep.
  let season_rows = 0;
  try {
    const feed = await statheadFeed(season);
    const rows = seasonRows(feed, playerIndex);
    for (let i = 0; i < rows.length; i += 900) {
      const { data, error } = await db().rpc('upsert_proj_board', {
        p_rows: rows.slice(i, i + 900),
        p_fetched_at: feed?.baseGeneratedAt ?? feed?.generatedAt ?? null,
        p_prune: i + 900 >= rows.length,
      });
      if (error) { log('season board', error.message); break; }
      season_rows += Number(data?.rows ?? 0);
    }
  } catch (e) { log('season board', e.message); }

  const n = await pollPlayerNews(log);
  return { projections, season: season_rows, news: Number(n.rows ?? 0) };
}
