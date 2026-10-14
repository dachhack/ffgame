// RELEGATION (0502): the words both apps use for a ladder's settings, and the
// one-line read of who's moving. The ⓘ text lives here so web and phone say
// the same thing.
import type { LadderMethod, LadderRosterMode, LadderState, LadderTier } from './liveApi';

export const LADDER_METHODS: { id: LadderMethod; label: string; info: string }[] = [
  { id: 'standings', label: 'RECORD', info: 'Final regular-season standings: the best records go up, the worst go down.' },
  { id: 'points', label: 'POINTS', info: 'Total points scored all season: the most go up, the fewest go down (the reverse in a lower-wins league).' },
  { id: 'playoffs', label: 'PLAYOFFS', info: 'Playoff result: the champion first, then the runner-up, then the consolation games’ final order. Relegation reads the same order from the bottom.' },
  { id: 'promotion_playoff', label: 'PROMO PLAYOFF', info: 'The best records go up automatically; the last promotion spot goes to the best playoff finish among the rest. Relegation is by record.' },
];

export const LADDER_ROSTER_MODES: { id: LadderRosterMode; label: string; info: string }[] = [
  { id: 'seat', label: 'TAKE THE SEAT', info: 'A team that moves takes over the seat it moves into — that seat’s keepers, roster and picks.' },
  { id: 'roster', label: 'TAKE YOUR ROSTER', info: 'A team that moves brings its kept players along. One the new league has no copy left of stays behind, and the move says so.' },
  { id: 'redraft', label: 'REDRAFT', info: 'Only managers move. A team that moves starts its new league with an empty roster and drafts it.' },
];

export const ladderMethodLabel = (m: LadderMethod | null | undefined) => LADDER_METHODS.find((x) => x.id === m)?.label ?? '—';
export const ladderRosterLabel = (m: LadderRosterMode | null | undefined) => LADDER_ROSTER_MODES.find((x) => x.id === m)?.label ?? '—';

/** The settings help, in one sheet. */
export const LADDER_INFO = 'Linked leagues as tiers, tier 1 on top. When the season ends the commissioner rolls the whole ladder over at once: every tier moves to next season, the bottom teams of each tier drop a tier and the top teams of the tier below take their seats.\n\n'
  + LADDER_METHODS.map((m) => `${m.label} — ${m.info}`).join('\n')
  + '\n\n' + LADDER_ROSTER_MODES.map((m) => `${m.label} — ${m.info}`).join('\n');

const nameOf = (t: LadderTier, rid: number) => t.names?.[String(rid)] ?? `Team ${rid}`;

/** "↑ Aces, Bolts · ↓ Comets" — who moves from this tier if the season ended now. */
export function tierMovesLine(t: LadderTier): string {
  const up = t.up.map((r) => nameOf(t, r)), down = t.down.map((r) => nameOf(t, r));
  return [up.length ? `↑ ${up.join(', ')}` : null, down.length ? `↓ ${down.join(', ')}` : null].filter(Boolean).join(' · ');
}

/** Where a seat in MY tier is headed: 'up', 'down' or null. */
export function seatMove(st: LadderState | null | undefined, rosterId: number | null | undefined): 'up' | 'down' | null {
  if (!st?.tiers || rosterId == null) return null;
  const mine = st.tiers.find((t) => t.mine);
  if (!mine) return null;
  return mine.up.includes(rosterId) ? 'up' : mine.down.includes(rosterId) ? 'down' : null;
}

/** Last rollover's moves, one line: "2026: Aces ↑ 1 · Comets ↓ 2". */
export function lastMovesLine(st: LadderState | null | undefined): string | null {
  const h = st?.history ?? [];
  if (!h.length) return null;
  return `${h[0].season}: ` + h.map((m) => `${m.team ?? 'a team'} ${m.direction === 'up' ? '↑' : '↓'} ${m.to_tier}`).join(' · ');
}
