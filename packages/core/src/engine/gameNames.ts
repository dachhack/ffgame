// WHO "J.Brissett" IS (v0.389.1) — a name resolver for the voice, built from
// the game's own box score: everyone with a stat in this game, by team, which
// is exactly the set of people the gamebook can name. A gamebook token is a
// first-name prefix plus last name; a box-score slug is the whole name. Match
// the last name (letters only, so "St. Brown" meets "st-brown") and the
// prefix against the first name; ONE match is the answer, none or several is
// null and the voice falls back to the last name alone.
import { gameBoxScore } from './boxScore';
import { stripSlugTag } from '../data/slugMeta';
import type { NameOf } from '../data/spokenPlay';

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** The box score's people as spoken names, keyed for matching. */
export function namesFromSlugs(slugs: Iterable<string>): { first: string; lastKey: string; full: string }[] {
  const out: { first: string; lastKey: string; full: string }[] = [];
  for (const slug of slugs) {
    if (slug.endsWith('-dst') || slug.endsWith('-k')) continue;
    const words = stripSlugTag(slug).split('-').filter(Boolean);
    if (words.length < 2) continue;
    out.push({ first: words[0], lastKey: letters(words.slice(1).join('')), full: words.map(cap).join(' ') });
  }
  return out;
}

/** Resolve one gamebook token against a name list. */
export function resolveGamebookName(people: { first: string; lastKey: string; full: string }[], abbr: string): string | null {
  const m = abbr.match(/^([A-Z][a-z]{0,2})\.(.+)$/);
  if (!m) return null;
  const prefix = m[1].toLowerCase(), lastKey = letters(m[2]);
  if (!lastKey) return null;
  const hits = people.filter((p) => p.lastKey.endsWith(lastKey) && p.first.startsWith(prefix));
  return hits.length === 1 ? hits[0].full : null;
}

/** A resolver for one game, read fresh each call so a defender who just made
 *  his first tackle is known by the time his name is spoken. */
export function gameNameResolver(week: number, home: string, away: string): NameOf {
  return (abbr) => {
    const box = gameBoxScore(week, home, away, Number.MAX_SAFE_INTEGER);
    const people = namesFromSlugs([...box.home, ...box.away].map((r) => r.slug));
    return resolveGamebookName(people, abbr);
  };
}
