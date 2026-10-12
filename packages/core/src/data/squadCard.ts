// THE SQUAD CARD (v0.676.0). HANDOFF's sixth not-done item, its last part:
// "sharing a squad card after squads unseal." Once the week's first game has
// kicked off a squad is public, and a member wants to show it off — to the
// league chat, a group text, a timeline. One pure function makes the text;
// the web shares it through the share sheet (or the clipboard), the phone
// through its own. Nothing here is sent anywhere by itself.
import type { ClassicSlotDef } from '../engine/classic';
import { CONTEST_EMOJI, contestScoreWord, type ContestKind } from '../engine/contest';

export interface SquadCardInput {
  league: string; week: number; contest: ContestKind;
  /** The Bullseye variant (v0.683.0): a one-team-total squad is so many points OFF, not a ring. */ variant?: string | null;
  /** 'live' while games are on, 'final' after, null before kickoff (the card says "squad set"). */
  status: 'live' | 'final' | null;
  slots: ClassicSlotDef[]; labels: Record<string, string>;
  picks: Record<string, string | null>;
  nameOf: (slug: string) => string;
  /** A spot's points so far, or null before its game. */
  scoreOf: (slot: string) => number | null;
  /** The squad's score by the contest's rule (ring or points), or null. */
  total: number | null;
  rank?: number | null; entries?: number | null;
  opponent?: { team: string | null; score: number | null } | null;
  /** The invite link, when the sharer has it. */
  link?: string | null;
}
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/** The card's text, line by line. */
export function squadCardText(o: SquadCardInput): string {
  const head = `${CONTEST_EMOJI[o.contest]} ${o.league} · Week ${o.week}${o.status === 'final' ? ' · FINAL' : o.status === 'live' ? ' · LIVE' : ' · squad set'}`;
  const rows = o.slots.map((d) => {
    const slug = o.picks[d.slot];
    const sc = slug ? o.scoreOf(d.slot) : null;
    return `${o.labels[d.slot] ?? d.slot}: ${slug ? o.nameOf(slug) : '—'}${sc != null ? ` ${r1(sc)}` : ''}`;
  });
  const word = contestScoreWord(o.contest, o.variant);
  const total1 = o.contest === 'bullseye' ? (o.variant === 'total' ? 'Distance' : 'Ring') : 'Total';
  const tally = o.total != null
    ? `${total1} ${r1(o.total)} ${word}${o.rank != null && o.entries ? ` · ${ord(o.rank)} of ${o.entries}` : ''}`
    : null;
  const opp = o.opponent
    ? `vs ${o.opponent.team ?? 'opponent'}${o.opponent.score != null ? ` ${r1(o.opponent.score)}` : ''}${o.total != null && o.opponent.score != null && o.status === 'final'
        ? (o.total === o.opponent.score ? ' — a tie' : (o.contest === 'golf' ? o.total < o.opponent.score : o.total > o.opponent.score) ? ' — won' : ' — lost') : ''}`
    : null;
  return [head, ...rows, tally, opp, o.link ? `Join: ${o.link}` : null].filter((x): x is string => !!x).join('\n');
}
