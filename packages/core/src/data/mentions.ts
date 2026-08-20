// WHO A MESSAGE IS ADDRESSED TO (v0.327.0).
//
// Founder: "does @all work?" It did not, and the way it failed is the reason
// this rule now lives in core with a test around it.
//
// Mentions were derived by matching each member's name against the body:
//
//     members.filter((m) => !m.me && body.includes(`@${m.name}`))
//
// `@all` matched nobody, so the message posted as ordinary text: no mention
// rows, no badges, no red dot for anyone. The sender had every reason to think
// they had just told the league something. A mention that silently reaches
// nobody is worse than no mention feature at all — the entire value of typing
// one is the confidence that it landed.
//
// WHY A WORD BOUNDARY, and why that is the part worth testing: a league with a
// manager called Allen, Allison or Ally would otherwise broadcast to everyone
// every time somebody addressed one of them. `@all` has to mean everybody and
// `@allen` has to mean Allen, and the difference is one lookahead.
//
// Deliberately NOT case-sensitive: people type @All at the start of a sentence.
// Deliberately no `@everyone` / `@channel` aliases — one name for one thing,
// and the composer suggests it, so there is nothing to guess.

/** True when the body addresses the whole league. */
export function mentionsEveryone(body: string): boolean {
  return /@all(?![\w-])/i.test(body ?? '');
}

/** The ids a message should notify, given the league's members.
 *
 *  NEVER THE AUTHOR. `@all` from you must not light your own dot — the thing
 *  the badge means is "somebody wants you", and you already know what you
 *  wrote. The per-name path has always excluded `me`; this keeps the two
 *  branches honest about it in one place. */
export function mentionIds<T extends { id: string; name: string; me?: boolean }>(
  body: string, members: T[],
): string[] {
  const others = (members ?? []).filter((m) => !m.me);
  if (mentionsEveryone(body)) return others.map((m) => m.id);
  return others.filter((m) => m.name && body.includes(`@${m.name}`)).map((m) => m.id);
}
