// ★ sort/filter over a player list, driven by the account's favorite stars
// (0139 — the same stars the player card sets). 'first' floats starred players
// to the top of whatever order the list already has; 'only' hides everyone
// else. Distinct from the draft queue's ☆ (a per-draft ranked wishlist):
// favorites follow the ACCOUNT across every league and both hosts.
// Web sibling lives in src/screens/NativeLeague.tsx.
export type StarMode = 'off' | 'first' | 'only';

export function starApply<T>(list: T[], mode: StarMode, favs: Set<string>, slugOf: (x: T) => string): T[] {
  if (mode === 'only') return list.filter((x) => favs.has(slugOf(x)));
  if (mode === 'first') return list.slice().sort((a, b) => (favs.has(slugOf(b)) ? 1 : 0) - (favs.has(slugOf(a)) ? 1 : 0));
  return list;
}

export const STAR_GOLD = '#E8B23A';
