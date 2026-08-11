// One reader for `sleeper_lineup.starters_json`.
//
// That column is a JSON blob written by whichever sync produced it, and it has
// TWO historical shapes:
//
//   ESPN    { slug, full, pos }
//   Sleeper { player_slug, sleeper_id, pos }      ← no `slug`, no `full`
//
// Every consumer has to know that. `buildLiveLeague` did; `myPool` did not, and
// read `p.slug` only — so for a Sleeper-synced league every entry looked
// slug-less. First that surfaced as a crash (`slugMeta(undefined)`), and the
// fix for the crash was a filter that dropped slug-less entries, which turned
// the crash into an empty roster: the board reported "0 eligible" on every
// window for a league whose lineup was sitting right there in the table.
//
// Both readings were symptoms of the same thing — two shapes and no shared
// reader. This is the shared reader. New shapes get handled here once rather
// than at each call site, and a caller cannot forget a field it never knew
// about.
import { slugMeta } from './slugMeta';

/** Every shape `starters_json` has ever been written in. */
export interface PoolEntry {
  slug?: string | null;
  player_slug?: string | null;
  sleeper_id?: string | null;
  full?: string | null;
  pos?: string | null;
  team?: string | null;
  nflTeam?: string | null;
}

/** The player's slug, whichever key the writer used. '' when there isn't one —
 *  an entry with no slug cannot be slate-gated, sealed or scored. */
export const entrySlug = (p: PoolEntry): string => p?.slug || p?.player_slug || '';

/** The entry's real NFL team, if the row carries one. Kept separate from the
 *  slug so callers that resolve teams their own way (liveBoard falls back to the
 *  stats DB by name) can layer on top. */
export const entryTeam = (p: PoolEntry): string => p?.team || p?.nflTeam || '';

/** A `{ slug, full, pos }` view of a row, with the slug-less entries dropped.
 *
 *  `full` and `pos` are only ever displayed or grouped by, so they get derived
 *  defaults rather than costing the user a pickable player: a Sleeper row
 *  carries no `full`, and "josh-allen" → "josh allen" beats showing nothing. */
export function readPool(raw: unknown): { slug: string; full: string; pos: string }[] {
  const rows = Array.isArray(raw) ? (raw as PoolEntry[]) : [];
  const out: { slug: string; full: string; pos: string }[] = [];
  for (const p of rows) {
    const slug = entrySlug(p);
    if (!slug) continue;
    out.push({
      slug,
      full: p.full || slug.replace(/-/g, ' '),
      pos: p.pos || slugMeta(slug).pos,
    });
  }
  return out;
}
