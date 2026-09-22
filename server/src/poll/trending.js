// WHAT THE WIRE IS DOING (0340) — Sleeper's trending adds and drops.
//
// Founder: "We can pull trending from sleeper. That's not one espn or stathead
// has." Both halves are true. Sleeper publishes, anonymously and with no key,
// how many of its leagues added or dropped each player over a rolling window.
// It is millions of real managers acting rather than anybody's model, and it
// is the one thing neither of our other sources carries: ESPN gives ownership
// PERCENT, which is a level, and StatHead's bakes are weekly.
//
// A level says who is owned. This says who is being grabbed this morning,
// which is the question a waiver wire is actually for.
//
// TWO ENDPOINTS, ONE ROW. Adds and drops are served separately and a player
// can be high in both — that is churn, not a signal, and a screen that shows
// only adds would read it as a recommendation. So they are merged here and the
// board carries both.
import { db } from '../supabase.js';

const BASE = process.env.SLEEPER_BASE || 'https://api.sleeper.app/v1';
const trendUrl = (kind, hours, limit) =>
  `${BASE}/players/nfl/trending/${kind}?lookback_hours=${hours}&limit=${limit}`;

/** A defense trends under its TEAM abbreviation ('TB'), not a numeric id —
 *  Sleeper keys team defenses that way everywhere. Ours are `<team>-dst`, so
 *  those rows place themselves without troubling the player index. */
const TEAM_ID = /^[A-Z]{2,3}$/;

/** Merge the two feeds into the rows `upsert_trend_board` wants.
 *
 *  Exported for scripts/check-trending.mjs: the merge and the id rule are the
 *  parts worth pinning, and neither needs a network to assert. */
export function trendRows(adds, drops, playerIndex) {
  const by = new Map();
  const place = (id) => {
    if (TEAM_ID.test(id)) return `${id.toLowerCase()}-dst`;
    // Id-first, like every other board: a player the index cannot place is
    // still written, with a null slug, so the next index refresh claims him
    // rather than the row being dropped and the count lost.
    return playerIndex?.sleeper(id)?.slug ?? null;
  };
  const take = (feed, key) => {
    for (const r of Array.isArray(feed) ? feed : []) {
      const id = r?.player_id == null ? '' : String(r.player_id);
      const n = Number(r?.count);
      if (!id || !Number.isFinite(n) || n <= 0) continue;
      const row = by.get(id) ?? { sleeper_id: id, slug: place(id), adds: 0, drops: 0, source: 'sleeper' };
      row[key] = n;
      by.set(id, row);
    }
  };
  take(adds, 'adds');
  take(drops, 'drops');
  return [...by.values()];
}

// HOURLY, and the window is 24 hours. The source recomputes continuously, so
// the cost of polling slower is a "trending now" column that is not now —
// which is the whole claim the column makes. One ~8KB fetch an hour, twice.
const EVERY_MS = Number(process.env.TREND_POLL_MS || 3600000);
const HOURS = Number(process.env.TREND_HOURS || 24);
const LIMIT = Number(process.env.TREND_LIMIT || 200);
let last = 0;

export async function sweepTrending(playerIndex, log = () => {}) {
  if (Date.now() - last < EVERY_MS) return { rows: 0 };
  last = Date.now();
  let adds, drops;
  try {
    const grab = async (kind) => {
      const res = await fetch(trendUrl(kind, HOURS, LIMIT), { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`trending ${kind} ${res.status}`);
      return res.json();
    };
    // Both or neither: half a board would prune the other half's rows, since
    // the upsert treats anything older than this pull's stamp as gone.
    [adds, drops] = await Promise.all([grab('add'), grab('drop')]);
  } catch (e) { log('trending', e.message); return { rows: 0, error: e.message }; }

  const rows = trendRows(adds, drops, playerIndex);
  if (!rows.length) return { rows: 0, skipped: 'nothing trending' };
  const { data, error } = await db().rpc('upsert_trend_board', {
    p_rows: rows, p_fetched_at: new Date().toISOString(), p_hours: HOURS,
  });
  if (error) { log('trending upsert', error.message); return { rows: 0, error: error.message }; }
  const placed = rows.filter((r) => r.slug).length;
  return { rows: Number(data?.rows ?? 0), pruned: Number(data?.pruned ?? 0), seen: rows.length, placed, hours: HOURS };
}
