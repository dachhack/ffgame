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
import { normName } from './espnAdapter.mjs';

const ENDPOINT = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';

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
 *  comment, team } } for players `resolveSlug` recognizes (default: by name). */
export function normalizeInjuries(feed, resolveSlug = (n) => normName(n).replace(/\s+/g, '-')) {
  const out = {};
  for (const team of feed?.injuries ?? []) {
    const abbr = team?.team?.abbreviation || team?.abbreviation || '';
    for (const item of team?.injuries ?? []) {
      const status = mapStatus(item);
      if (!status) continue; // skip Active
      const name = item?.athlete?.displayName;
      if (!name) continue;
      const slug = resolveSlug(name);
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
