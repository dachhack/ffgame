// How a roster group is shown wherever a player is listed.
//
// The pool used to be Sleeper's STARTERS and nothing else, so every player in
// it was interchangeable and needed no label. It is now the manager's whole
// roster — starters, bench, IR, taxi — which makes "where is this player
// actually sitting" a real question you can get wrong: fielding a taxi rookie
// or a player on IR is a different decision from fielding your RB1, and the
// list gives no other clue.
//
// Starters get NO badge on purpose. They are the overwhelming majority and the
// unmarked default; badging them would put a label on every row and make the
// three that matter harder to spot, not easier.
import { StyleSheet, Text, View } from 'react-native';
import type { PoolGroup } from '@drip/core/data/poolEntry';
import { useTheme, MONO } from '../theme.native';

/** Filter-chip order and wording. 'start' is included here because as a FILTER
 *  "starters only" is a thing you want; as a badge it isn't. */
export const GROUP_TABS: { id: PoolGroup | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'ALL' },
  { id: 'start', label: 'STARTERS' },
  { id: 'bench', label: 'BENCH' },
  { id: 'ir', label: 'IR' },
  { id: 'taxi', label: 'TAXI' },
];

/** Short badge text, or '' for the unmarked default. */
export const groupTag = (g: PoolGroup): string =>
  g === 'bench' ? 'BN' : g === 'ir' ? 'IR' : g === 'taxi' ? 'TX' : '';

export function GroupBadge({ group, size = 8 }: { group: PoolGroup; size?: number }) {
  const t = useTheme();
  const tag = groupTag(group);
  if (!tag) return null;
  // IR reads as a warning because an injured player may not take a snap; taxi
  // is merely unusual; bench is ordinary and stays quiet.
  const fg = group === 'ir' ? t.warn : group === 'taxi' ? t.you : t.dim;
  return (
    <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: fg, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: size, fontWeight: '700', color: fg }}>{tag}</Text>
    </View>
  );
}
