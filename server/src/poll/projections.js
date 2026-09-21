// THE WEEK'S NUMBER, AND THE NEWS (0329).
//
// Two polls, both from ESPN, both idempotent, both writing through one RPC:
//
//   pollWeekProjections — the fantasy game's own weekly projections
//     (statSourceId 1 = projected, statSplitTypeId 1 = weekly), which is the
//     number every ESPN league sees and the one that MOVES: it knows about
//     the starter who is out, the back-up who has the job, the bye, and the
//     trade on Tuesday. Our baked set (proj2026.ts) knows none of that,
//     because it was computed in August. The raw projected stat line is
//     stored beside the total so a league's own scoring can be applied to it
//     later; the total is what a screen shows today.
//
//   pollPlayerNews — the NFL headline feed, kept only where a story is
//     TAGGED with the athletes it is about. An untagged story is a story
//     about the league, not about somebody's flex spot, and this feed exists
//     to answer "why is he questionable".
//
// KEYED ON THE ESPN ATHLETE ID, which is what league_pool.espn_id holds. No
// name matching anywhere in this file: names drift between sources, ids do
// not, and the one thing worse than no projection is somebody else's.
import { db } from '../supabase.js';

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
 *  that endpoint has always worked. */
async function fetchProjections(season, week, limit = 900) {
  const filter = {
    players: {
      limit,
      sortPercOwned: { sortAsc: false, sortPriority: 1 },
      filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: [`00${season}`, `10${season}`] },
    },
  };
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

/** Pull one week and write it. Returns how many players were stored. */
export async function pollWeekProjections(season, week, log = () => {}) {
  if (!season || !week || week >= 100) return { rows: 0, skipped: 'no week' };
  let feed;
  try { feed = await fetchProjections(season, week); }
  catch (e) { log('projections', e.message); return { rows: 0, error: e.message }; }
  const rows = [];
  for (const entry of feed?.players ?? []) {
    const p = entry?.player;
    if (!p?.id) continue;
    const got = weekLineFor(p, week);
    if (!got || !Number.isFinite(got.pts)) continue;
    rows.push({ espn_id: String(p.id), pts: got.pts, line: got.line, source: 'espn' });
  }
  if (!rows.length) return { rows: 0, skipped: 'nothing projected' };
  const { data, error } = await db().rpc('upsert_week_projections', {
    p_season: String(season), p_week: Number(week), p_rows: rows,
  });
  if (error) { log('projections upsert', error.message); return { rows: 0, error: error.message }; }
  return { rows: Number(data?.rows ?? rows.length) };
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
export async function sweepProjections(season, weeks = [], log = () => {}) {
  if (Date.now() - last < EVERY_MS) return { projections: 0, news: 0 };
  last = Date.now();
  let projections = 0;
  for (const w of new Set(weeks.filter((w) => Number.isInteger(w) && w > 0 && w < 100))) {
    const r = await pollWeekProjections(season, w, log);
    projections += Number(r.rows ?? 0);
  }
  const n = await pollPlayerNews(log);
  return { projections, news: Number(n.rows ?? 0) };
}
