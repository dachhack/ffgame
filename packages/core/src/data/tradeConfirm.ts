// THE OFFER, READ BACK (v0.584.0) — founder: "When you propose a trade, you
// should see a full summary to confirm before the final send."
//
// Every offer, two-team or more, is a set of LEGS: each seat and what it
// sends, every asset addressed to the seat that receives it (the shape
// propose_multi_trade takes, and twoSeatDevyLegs builds for a two-team offer).
// Read back as what EACH TEAM GETS, the summary is complete without repeating
// itself: every asset in the deal is exactly one team's "gets". The proposer
// reads first ("YOU GET").

export interface ConfirmLeg {
  roster: number;
  send?: { slug: string; to: number }[];
  send_picks?: { season: string; round: number; orig: number; to: number; kind?: string }[];
  send_faab?: { to: number; amount: number }[];
  send_cap?: { to: number; amount: number }[];
  send_shares?: { slug: string; shares: number; to: number }[];
  send_devy_cash?: { to: number; amount: number }[];
}

export interface ConfirmTeam {
  roster: number;
  /** "YOU GET" or "Team Name GETS". */
  title: string;
  mine: boolean;
  /** One line per asset, each saying where it comes from. */
  gets: string[];
}

export function tradeConfirm(legs: ConfirmLeg[], o: {
  me: number;
  teamName: (rid: number) => string;
  /** A player's name (and contract terms, where the league has them). */
  player: (slug: string) => string;
  /** A pick's label, given the seat sending it. */
  pick: (p: { season: string; round: number; orig: number; kind?: string }, holder: number) => string;
  /** A devy player's name, for shares. */
  shareName?: (slug: string) => string;
  /** Salary a sender keeps paying, by player (0219). */
  retain?: Record<string, number>;
}): ConfirmTeam[] {
  const seats = legs.map((l) => l.roster);
  const from = (rid: number) => (rid === o.me ? 'from you' : `from ${o.teamName(rid)}`);
  const money = (n: number) => `$${Math.round(n * 100) / 100}`;
  return seats.map((rid) => {
    const gets: string[] = [];
    for (const l of legs) {
      if (l.roster === rid) continue;
      const src = from(l.roster);
      for (const x of l.send ?? []) if (x.to === rid) {
        const kept = o.retain?.[x.slug];
        gets.push(`${o.player(x.slug)} ${src}${kept ? ` (${l.roster === o.me ? 'you keep' : 'they keep'} paying ${money(kept)} of his salary)` : ''}`);
      }
      for (const p of l.send_picks ?? []) if (p.to === rid) gets.push(`${o.pick(p, l.roster)} ${src}`);
      for (const f of l.send_faab ?? []) if (f.to === rid && f.amount > 0) gets.push(`${money(f.amount)} FAAB ${src}`);
      for (const c of l.send_cap ?? []) if (c.to === rid && c.amount > 0) gets.push(`${money(c.amount)} cap room ${src}`);
      for (const s of l.send_shares ?? []) if (s.to === rid && s.shares > 0) {
        gets.push(`${s.shares} devy share${s.shares === 1 ? '' : 's'} of ${o.shareName?.(s.slug) ?? s.slug} ${src}`);
      }
      for (const c of l.send_devy_cash ?? []) if (c.to === rid && c.amount > 0) gets.push(`${(Math.round(c.amount * 100) / 100).toFixed(2)} devy cash ${src}`);
    }
    const mine = rid === o.me;
    return { roster: rid, mine, title: mine ? 'YOU GET' : `${o.teamName(rid).toUpperCase()} GETS`, gets };
  });
}

/** How long the offer stands, in words, for the read-back. */
export function expiryLine(hours: number | null, leagueDays: number | null | undefined): string {
  if (hours === -1) return 'Stands until answered (no time limit)';
  if (hours == null) return leagueDays ? `Stands ${leagueDays} day${leagueDays === 1 ? '' : 's'} (the league's default)` : 'Stands until answered';
  return `Stands ${hours < 24 ? `${hours} hours` : `${hours / 24} day${hours === 24 ? '' : 's'}`}`;
}

/** What happens when it's accepted, by the league's review rule. */
export function reviewLine(review: string | null | undefined): string {
  return review === 'commish' ? 'If accepted, the commissioner rules on it before it goes through.'
    : review === 'league' ? 'If accepted, the league can vote to veto it before it goes through.'
    : 'If accepted, it goes through immediately.';
}
