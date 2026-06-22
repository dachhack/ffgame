// Injury poller: ESPN /nfl/injuries → injury_status. Reuses the normalizer
// (scripts/espn/injuries.mjs). Resolves to the shared slug by FULL name (reliable
// — the bulk feed has no athlete ids but full names, no initials ambiguity).
import { fetchInjuries, normalizeInjuries } from '../../../scripts/espn/injuries.mjs';
import { db } from '../supabase.js';

/** Pull the live report and upsert designations for rostered players. */
export async function pollInjuries(playerIndex) {
  const feed = await fetchInjuries();
  const rows = normalizeInjuries(feed, (name) => playerIndex.slugForName(name));
  const now = new Date().toISOString();
  const records = Object.entries(rows).map(([slug, r]) => ({
    player_slug: slug, status: r.status,
    designation_date: r.date, return_date: r.returnDate, comment: r.comment,
    team: r.team, source: 'espn', updated_at: now,
  }));
  if (records.length) await db().from('injury_status').upsert(records, { onConflict: 'player_slug' });
  return { feedTimestamp: feed.timestamp, count: records.length };
}
