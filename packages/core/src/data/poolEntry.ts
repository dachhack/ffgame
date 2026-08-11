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

/** Which part of the manager's roster an entry came from. */
export type PoolGroup = 'start' | 'bench' | 'ir' | 'taxi';

/** Every shape `starters_json` has ever been written in. */
export interface PoolEntry {
  slug?: string | null;
  player_slug?: string | null;
  sleeper_id?: string | null;
  full?: string | null;
  pos?: string | null;
  team?: string | null;
  nflTeam?: string | null;
  grp?: string | null;
}

/** The roster group an entry belongs to, defaulting to 'start'.
 *
 *  The default is not a guess, it's history: every row written before the sync
 *  started tagging groups held ONLY Sleeper's starters, and the preseason pool
 *  is synthetic and wholly playable. So an untagged entry really is a starter,
 *  and a league that hasn't re-synced keeps rendering exactly as it did. */
export const entryGroup = (p: PoolEntry): PoolGroup => {
  const g = String(p?.grp ?? '').toLowerCase();
  return g === 'bench' || g === 'ir' || g === 'taxi' ? g : 'start';
};

/** The player's slug, whichever key the writer used. '' when there isn't one —
 *  an entry with no slug cannot be slate-gated, sealed or scored. */
export const entrySlug = (p: PoolEntry): string => p?.slug || p?.player_slug || '';

/** The entry's real NFL team, if the row carries one. Kept separate from the
 *  slug so callers that resolve teams their own way (liveBoard falls back to the
 *  stats DB by name) can layer on top. */
export const entryTeam = (p: PoolEntry): string => p?.team || p?.nflTeam || '';

/** Just the STARTERS' slugs, in order.
 *
 *  For the server's unenrolled-opponent fallback, which fields an absent
 *  manager's real Sleeper lineup. When the pool widened to the whole roster
 *  (starters + bench + IR + taxi) so a human could field anyone they own, this
 *  fallback would silently have widened with it — an absent manager's "lineup"
 *  would suddenly include their IR stash, which is a change to how games score,
 *  not to what a screen shows. Same rule as before: starters only. */
export function starterSlugs(raw: unknown): string[] {
  const rows = Array.isArray(raw) ? (raw as PoolEntry[]) : [];
  return rows.filter((p) => entryGroup(p) === 'start').map(entrySlug).filter(Boolean);
}

/** A `{ slug, full, pos, grp }` view of a row, with the slug-less entries dropped.
 *
 *  `full` and `pos` are only ever displayed or grouped by, so they get derived
 *  defaults rather than costing the user a pickable player: a Sleeper row
 *  carries no `full`, and "josh-allen" → "josh allen" beats showing nothing. */
export function readPool(raw: unknown): { slug: string; full: string; pos: string; grp: PoolGroup }[] {
  const rows = Array.isArray(raw) ? (raw as PoolEntry[]) : [];
  const out: { slug: string; full: string; pos: string; grp: PoolGroup }[] = [];
  for (const p of rows) {
    const slug = entrySlug(p);
    if (!slug) continue;
    out.push({
      slug,
      full: p.full || slug.replace(/-/g, ' '),
      pos: p.pos || slugMeta(slug).pos,
      grp: entryGroup(p),
    });
  }
  return out;
}
