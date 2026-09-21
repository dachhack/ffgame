// THE CROSSWALK (0331) — one player, every id.
//
// StatHead publishes the nflverse-keyed player crosswalk as one public JSON,
// the same file its Python client reads. We take the rows that can still be
// joined to a fantasy roster and publish their ids through the read API, so
// a third party never has to match our spelling of a name against theirs.
//
// WHAT WE KEEP. A row needs a gsis id (the key), one of espn_id / sleeper_id
// (the two columns league_pool holds, and therefore the only way our pool
// can reach it), and a recent season — the file goes back to 2010 and most
// of it is offensive linemen who retired a decade ago. That trims ~12,000
// rows to ~3,000 and the payload to something a poller can send.
//
// CADENCE. Daily is generous: an id is assigned once and never changes. The
// only rows that move are rookies getting their ESPN and Sleeper ids in the
// weeks after a draft, which is exactly the case the roster fallback in the
// upstream file already handles.
import { db } from '../supabase.js';

const XREF_URL = () =>
  `${process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead'}`
  + `/${process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd'}`
  + '/public/data/player-crosswalk.json';

/** The rows worth publishing, in the shape upsert_player_xref wants. */
export function xrefRows(feed, season) {
  const cutoff = Number(season) - 2;
  const out = [];
  for (const p of feed?.players ?? []) {
    if (!p?.gsis_id) continue;
    if (!p.espn_id && !p.sleeper_id) continue;          // our pool cannot reach him
    if (Number(p.latest_season ?? 0) < cutoff) continue; // long gone
    out.push({
      gsis_id: String(p.gsis_id),
      full_name: p.display_name ?? null,
      pos: p.position ?? null,
      sleeper_id: p.sleeper_id ? String(p.sleeper_id) : null,
      espn_id: p.espn_id ? String(p.espn_id) : null,
      pfr_id: p.pfr_id ?? null,
      yahoo_id: p.yahoo_id ? String(p.yahoo_id) : null,
      sportradar_id: p.sportradar_id ?? null,
      pff_id: p.pff_id ? String(p.pff_id) : null,
      rotowire_id: p.rotowire_id ? String(p.rotowire_id) : null,
      fantasy_data_id: p.fantasy_data_id ? String(p.fantasy_data_id) : null,
      esb_id: p.esb_id ?? null,
      latest_season: Number(p.latest_season ?? 0) || null,
    });
  }
  return out;
}

const CHUNK = 500;
const EVERY_MS = Number(process.env.XREF_POLL_MS || 86400000);
let last = 0;

export async function sweepXref(season, log = () => {}) {
  if (Date.now() - last < EVERY_MS) return { rows: 0 };
  last = Date.now();
  let feed;
  try {
    const res = await fetch(XREF_URL(), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`crosswalk ${res.status}`);
    feed = await res.json();
  } catch (e) { log('xref', e.message); return { rows: 0, error: e.message }; }
  const rows = xrefRows(feed, season);
  let wrote = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await db().rpc('upsert_player_xref', { p_rows: rows.slice(i, i + CHUNK) });
    if (error) { log('xref upsert', error.message); return { rows: wrote, error: error.message }; }
    wrote += Number(data?.rows ?? 0);
  }
  return { rows: wrote, seen: rows.length };
}
