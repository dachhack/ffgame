// THE ADP BOARD, REFRESHED BY THE WORKER (0334).
//
// Founder, reading the first rebake since August: "these look like post week
// one ADPs?" — then: "automate the weekly ADP refresh in the worker." This is
// that, and the honest scope of it.
//
// WHAT THIS IS NOT. It does not rebake `adp2026.ts`. The consensus blend that
// file holds (FantasyPros + Sleeper + FFC, freshness-weighted) is computed
// inside StatHead's MCP tool and published nowhere, so no worker can fetch it;
// pretending otherwise would mean re-implementing somebody else's model and
// quietly disagreeing with it. The bake stays the fallback and stays a
// deliberate, reviewed act.
//
// WHAT IT IS. One of that blend's inputs IS published, daily, keyed by sleeper
// id: `sleeper-adp-<season>.json` — Sleeper's own draft rooms. It is a real
// market, it is the market closest to this app's own pool, and it carries a
// separate number for each FORMAT: ppr, half, standard, 2QB and dynasty.
//
// The format is the part worth having. Until now a superflex league read a
// 1QB ADP off the bake, because a bake has one column; `_league_adp_format`
// now hands each league the market it actually plays.
//
// ID-FIRST, like everything else here: rows carry `sleeper_id` and the slug is
// resolved through the worker's player index. A row we cannot place is written
// with a null slug rather than guessed at by name — the board is keyed by the
// source's id, so the next index refresh can still claim it.
import { db } from '../supabase.js';

const SH_BASE = process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead';
const SH_REF = process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd';
const adpUrl = (season) => `${SH_BASE}/${SH_REF}/public/data/sleeper-adp-${season}.json`;

/** The feed's rows in the shape upsert_adp_board wants. A player with no
 *  redraft price at all is skipped — the dynasty-only rows are 2,000 of the
 *  2,877 and none of them is a draft board. */
export function adpRows(feed, playerIndex) {
  const rows = [];
  for (const p of feed?.players ?? []) {
    const sid = p?.sleeper_id;
    if (!sid) continue;
    const ppr = Number(p.adp_ppr);
    const half = Number(p.adp_half_ppr);
    const std = Number(p.adp_std);
    const sf = Number(p.adp_2qb);
    const dyn = Number(p.adp_dynasty_ppr);
    const num = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null);
    if (![ppr, half, std, sf].some((v) => Number.isFinite(v) && v > 0)) continue;
    rows.push({
      sleeper_id: String(sid),
      slug: playerIndex?.sleeper(String(sid))?.slug ?? null,
      adp_ppr: num(ppr), adp_half: num(half), adp_std: num(std),
      adp_2qb: num(sf), adp_dyn: num(dyn),
      source: 'sleeper',
    });
  }
  return rows;
}

// DAILY, not weekly. The ask was "the weekly refresh" — the thing a person was
// doing by hand — and the source rebuilds daily, so polling weekly would ship
// a number staler than the one available. One 320KB fetch a day is cheaper
// than remembering.
const EVERY_MS = Number(process.env.ADP_POLL_MS || 86400000);
const CHUNK = 900;
let last = 0;

export async function sweepAdp(season, playerIndex, log = () => {}) {
  if (Date.now() - last < EVERY_MS) return { rows: 0 };
  last = Date.now();
  let feed;
  try {
    const res = await fetch(adpUrl(season), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`adp board ${res.status}`);
    feed = await res.json();
  } catch (e) { log('adp', e.message); return { rows: 0, error: e.message }; }

  const rows = adpRows(feed, playerIndex);
  if (!rows.length) return { rows: 0, skipped: 'nothing priced' };
  let wrote = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await db().rpc('upsert_adp_board', {
      p_rows: rows.slice(i, i + CHUNK),
      p_fetched_at: feed.fetchedAt ?? null,
      // Prune on the LAST chunk only — see the migration: pruning earlier
      // would delete the players the next chunk is about to write.
      p_prune: i + CHUNK >= rows.length,
    });
    if (error) { log('adp upsert', error.message); return { rows: wrote, error: error.message }; }
    wrote += Number(data?.rows ?? 0);
  }
  const placed = rows.filter((r) => r.slug).length;
  return { rows: wrote, priced: rows.length, placed, fetchedAt: feed.fetchedAt ?? null };
}
