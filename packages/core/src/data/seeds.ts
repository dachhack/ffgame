// THE COMMISSIONER SEEDS THE BRACKET (0359), the part both consoles share.
// The order a console starts from, whether it is the commissioner's own, and
// the ↑↓ move. The server decides the rest (generate_playoffs_bracket).

/** Where the seeding list starts: the bracket's seeds if one is built (so the
 *  list shows what is actually in play), else the league's own order. Every
 *  other team follows, in the league's order, so nobody drops off the list. */
export function seedStart(defaults: number[], current: number[] | null | undefined, all: number[] = []): number[] {
  const head = current?.length ? current : defaults;
  const out = [...head];
  for (const r of [...defaults, ...all]) if (!out.includes(r)) out.push(r);
  return out;
}

/** Is the top `n` the commissioner's order rather than the league's? Below
 *  the cut the order is the consolation ladder's business, not the seeds'. */
export function seedsCustom(order: number[], defaults: number[], n: number): boolean {
  return order.slice(0, n).join(',') !== defaults.slice(0, n).join(',');
}

export function moveSeed(order: number[], i: number, dir: -1 | 1): number[] {
  const j = i + dir;
  if (j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
