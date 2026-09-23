// ESPN injuries → per-slug live status (the pre-game injury feed).
//
// Managers need fresh injury designations in the lead-up to kickoff — who's
// Out / Doubtful / Questionable, and which way they're trending — BEFORE they
// seal a lineup. That's a live feed, not baked data. ESPN's free injuries
// endpoint carries the official report for all 32 teams with full player names,
// a structured status (Q/D/O/IR), a per-entry designation `date` (freshness /
// trend), return date, and a news comment.
//
// `normalizeInjuries(feed, resolveSlug)` → { [slug]: InjuryRow } for league
// players. Mirrors espnAdapter.mjs: pure, with an injectable slug resolver.
//
// Note: the bulk feed omits athlete ids (athleteId is null), but it gives FULL
// names ("Tip Reiman"), so name→slug matching is reliable here — there's none of
// the first-initial ambiguity that affects play-by-play text. Per-game
// `summary.injuries` carries athlete ids and can cross-check if ever needed.
import { normName, fixTeam } from './espnAdapter.mjs';

const ENDPOINT = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';

// WHAT THE BULK FEED STOPPED SAYING (v0.423.0). By September 2026 the report's
// team entries carry only `{ id, displayName }` — no abbreviation — and its
// athletes carry no `id` at all. Both were the resolver's strongest signals:
// the athlete id is what keeps a designation off a namesake (0200), and the
// team is what settles two live men with one name (v0.345.0). Both are still
// IN the payload, just not where they were: the team's numeric ESPN id is the
// same one the roster poll enumerates, and every athlete's player-card link
// ends in `/id/<espnId>/<slug>`. Read them back out rather than let every row
// fall through to the ranked-name guess.
//
// ESPN's own team ids (1..34, 31/32 unused), verified against the feed's
// displayNames. Codes are the slate's vocabulary (fixTeam: LA, WAS, JAX).
export const ESPN_TEAM_BY_ID = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LA', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};
/** The team code for one of the feed's team entries: its abbreviation when it
 *  has one, else its ESPN id looked up, else ''. */
export function teamAbbrOf(team) {
  const ab = team?.team?.abbreviation || team?.abbreviation;
  if (ab) return fixTeam(String(ab).toUpperCase());
  const id = Number(team?.team?.id ?? team?.id);
  return ESPN_TEAM_BY_ID[id] ?? '';
}
/** The athlete's ESPN id: the field when present, else the number in the
 *  player-card link (`…/player/_/id/4035687/michael-pittman-jr`). */
export function athleteIdOf(athlete) {
  if (athlete?.id != null && athlete.id !== '') return String(athlete.id);
  for (const l of athlete?.links ?? []) {
    const m = /\/id\/(\d+)(?:\/|$)/.exec(String(l?.href ?? ''));
    if (m) return m[1];
  }
  return null;
}

// ESPN status/type → our InjuryStatus ('O' | 'D' | 'Q' | 'IR'); 'Active' ⇒ none.
const STATUS = { O: 'O', D: 'D', Q: 'Q', IR: 'IR' };
export function mapStatus(item) {
  const ab = (item?.type?.abbreviation || '').toUpperCase();
  if (STATUS[ab]) return STATUS[ab];
  const s = (item?.status || '').toLowerCase();
  if (s.includes('injured reserve')) return 'IR';
  if (s.startsWith('out')) return 'O';
  if (s.startsWith('doubt')) return 'D';
  if (s.startsWith('question')) return 'Q';
  return null; // Active / unknown ⇒ no designation
}

/** Normalize the ESPN injuries payload to { slug: { status, date, returnDate,
 *  comment, team } } for players `resolveSlug` recognizes (default: by name).
 *
 *  `keepActive` (v0.489.0) keeps the feed's ~630 ACTIVE entries, as status 'A'.
 *  They were dropped here for as long as ESPN was the only source, and rightly:
 *  a row saying "this man is fine" had nothing to write to a table of
 *  designations. With Sleeper beside it they are the opposite of nothing — a
 *  dated statement of availability is what keeps another feed's stale flag from
 *  benching a player who has been cleared. Off by default, so every existing
 *  caller (the CLI probe, check:injuries) sees the report it always saw. */
export function normalizeInjuries(feed, resolveSlug = (n) => normName(n).replace(/\s+/g, '-'), opts = {}) {
  const { keepActive = false } = opts;
  const out = {};
  for (const team of feed?.injuries ?? []) {
    const abbr = teamAbbrOf(team);
    for (const item of team?.injuries ?? []) {
      const active = (item?.type?.abbreviation || '').toUpperCase() === 'A'
        || (item?.status || '').toLowerCase() === 'active';
      const status = mapStatus(item) ?? (keepActive && active ? 'A' : null);
      if (!status) continue; // Active (unless asked for) / unknown
      const name = item?.athlete?.displayName;
      if (!name) continue;
      // Athlete id first where the resolver understands it (0200), then the
      // TEAM whose section of the report this is (v0.345.0) — for a player
      // Sleeper carries no espn_id for, that is what keeps a designation off a
      // retired namesake. One- and two-arg resolvers ignore the extras.
      const slug = resolveSlug(name, athleteIdOf(item?.athlete), abbr);
      if (!slug) continue; // not a league player we track
      const prev = out[slug];
      const date = item?.date || null;
      // Keep the most recent designation if a player appears twice.
      if (prev && prev.date && date && Date.parse(date) <= Date.parse(prev.date)) continue;
      out[slug] = {
        status,
        date,
        returnDate: item?.details?.returnDate ?? null,
        comment: item?.shortComment ?? null,
        team: abbr,
      };
    }
  }
  return out;
}

/** Fetch the live feed (with retry). Returns { timestamp, injuries }. */
export async function fetchInjuries(tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(ENDPOINT); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error('ESPN injuries fetch failed');
}

// CLI: print current designations for league players (from crosswalk.json).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const crosswalk = JSON.parse(readFileSync(new URL('../pbp/crosswalk.json', import.meta.url)));
  const byName = new Map();
  for (const [slug, info] of Object.entries(crosswalk)) byName.set(normName(info.name), slug);
  const resolveSlug = (name) => byName.get(normName(name)) ?? null;

  const feed = await fetchInjuries();
  const rows = normalizeInjuries(feed, resolveSlug);
  const by = { O: [], D: [], Q: [], IR: [] };
  for (const [slug, r] of Object.entries(rows)) by[r.status].push(slug);
  console.log(`feed timestamp: ${feed.timestamp}`);
  console.log(`league players with a designation: ${Object.keys(rows).length}`);
  for (const k of ['IR', 'O', 'D', 'Q']) console.log(`  ${k}: ${by[k].length}`);
  const sample = Object.entries(rows).slice(0, 8);
  console.log('\nsamples:');
  for (const [slug, r] of sample) console.log(`  ${slug.padEnd(22)} ${r.status}  (${r.date})  ${(r.comment || '').slice(0, 60)}`);
}
