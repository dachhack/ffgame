// YOUR ROSTER — the collapsible pool panel from the web board.
//
// Not the same thing as the slot picker. The picker answers "who can fill THIS
// slot in THIS window"; this answers "what have I actually got", grouped by the
// window each player's real game falls in. That grouping is the point: it is
// how you see that a window you have to fill has nobody in it, which is exactly
// the confusion the empty preseason pools caused.
//
// Collapsed by default. On a phone this list runs to hundreds of players and
// would otherwise bury the board it sits above.
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { headshot, teamLogo } from '@drip/core/data/media';
import type { GameWindow, Player } from '@drip/core/types';
import type { PoolGroup } from '@drip/core/data/poolEntry';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { GROUP_TABS, GroupBadge, InjuryBadge } from './rosterGroup';
import { openPlayerCard } from './PlayerCardSheet';
import { injuryFor } from '@drip/core/data/injuries';

const POS_TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

export function RosterPanel({ title, players, wins, week, userId, windowOf, groupOf, accent, open: openProp, onToggle }: {
  title: string;
  players: Player[];
  /** The week's windows, in order — the grouping and its labels. */
  wins: GameWindow[];
  /** The week the list is for — scopes the injury report, which only ever
   *  speaks for the week being played. 0 on a board with no week yet. */
  week: number;
  /** Signed-in account — lights the ★ on the player card a row tap opens. */
  userId?: string;
  /** Which window a player's real game falls in ('any' when unresolvable). */
  windowOf: (playerId: string) => string | null;
  /** Which part of the roster a player sits on. Optional: the demo board and
   *  any caller with a synthetic pool has no such distinction to draw. */
  groupOf?: (playerId: string) => PoolGroup;
  accent: string;
  /** Controlled mode. The board opens rosters in a MODAL, so the caller owns
   *  which side is showing and supplies the frame; this renders only the filters
   *  and the list, with no header and no border of its own. Uncontrolled (no
   *  `open`) keeps the self-contained collapsible panel for any other caller. */
  open?: boolean;
  onToggle?: () => void;
}) {
  const t = useTheme();
  const [openSelf, setOpenSelf] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openSelf;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    if (controlled) { onToggle?.(); return; }
    setOpenSelf(v as never);
  };
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<string>('ALL');
  const [grp, setGrp] = useState<PoolGroup | 'ALL'>('ALL');

  // Only offer the group filter when the roster actually HAS non-starters. A
  // league synced before the sync started sending bench/IR/taxi reads as all
  // starters, and showing it a row of chips that can only ever empty the list
  // would be chrome that lies about what is there.
  const hasGroups = useMemo(
    () => !!groupOf && players.some((p) => groupOf(p.id) !== 'start'),
    [players, groupOf],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players.filter((p) => {
      if (pos !== 'ALL' && p.pos !== pos) return false;
      if (grp !== 'ALL' && (groupOf?.(p.id) ?? 'start') !== grp) return false;
      if (!needle) return true;
      return p.full.toLowerCase().includes(needle) || (p.team ?? '').toLowerCase().includes(needle);
    });
  }, [players, q, pos, grp, groupOf]);

  // Grouped by window, in the week's own order. Players whose window can't be
  // resolved land in a trailing bucket rather than vanishing.
  const groups = useMemo(() => {
    const by = new Map<string, Player[]>();
    for (const p of filtered) {
      const w = windowOf(p.id) ?? 'other';
      const key = w === 'any' ? 'other' : w;
      (by.get(key) ?? by.set(key, []).get(key)!).push(p);
    }
    const ordered: { id: string; label: string; players: Player[] }[] = [];
    for (const w of wins) {
      const list = by.get(String(w.id));
      if (list?.length) ordered.push({ id: String(w.id), label: w.label, players: list });
    }
    const rest = by.get('other');
    if (rest?.length) ordered.push({ id: 'other', label: 'NO GAME THIS WEEK', players: rest });
    return ordered;
  }, [filtered, wins, windowOf]);

  // In a sheet every wrapper between the card and the list has to be allowed to
  // shrink, or the chain breaks at the first one that can't and the list
  // overflows again. RN defaults flexShrink to 0 — unlike the web — so this is
  // opt-in at each level, which is also why the filter rows above the list keep
  // their height while only the list gives way.
  return (
    <View style={controlled ? { flexShrink: 1, minHeight: 0 } : { marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: open ? accent : t.bd, borderRadius: 8, overflow: 'hidden', backgroundColor: t.surface }}>
      {!controlled && (
        <Pressable
          onPress={() => setOpen((o) => !o)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 1, color: open ? accent : t.dim }}>
            {open ? '▾' : '▸'}  {title.toUpperCase()}
          </Text>
          <Mono size={10} tone="faint">{players.length}</Mono>
        </Pressable>
      )}

      {open && (
        <View style={controlled ? { flexShrink: 1, minHeight: 0 } : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
          <View style={{ padding: 10, gap: 8 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="search players…"
              placeholderTextColor={t.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                fontFamily: MONO, fontSize: 14, color: t.text, backgroundColor: t.bg,
                borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7,
                paddingHorizontal: 11, paddingVertical: 9,
              }}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
              {POS_TABS.map((tab) => {
                const on = pos === tab;
                return (
                  <Pressable
                    key={tab}
                    onPress={() => setPos(tab)}
                    style={{
                      borderRadius: 6, paddingHorizontal: 11, paddingVertical: 6,
                      backgroundColor: on ? accent : t.bg,
                      borderWidth: StyleSheet.hairlineWidth, borderColor: on ? accent : t.bd,
                    }}
                  >
                    <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: on ? t.onAccent : t.dim }}>{tab}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {hasGroups && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                {GROUP_TABS.map((tab) => {
                  const on = grp === tab.id;
                  return (
                    <Pressable
                      key={tab.id}
                      onPress={() => setGrp(tab.id)}
                      style={{
                        borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5,
                        backgroundColor: on ? t.sh : 'transparent',
                        borderWidth: StyleSheet.hairlineWidth, borderColor: on ? accent : t.bd,
                      }}
                    >
                      <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: on ? accent : t.faint }}>{tab.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <Mono size={9.5} tone="faint">{filtered.length} player{filtered.length === 1 ? '' : 's'}</Mono>
          </View>

          {/* Bounded height: this list can be a thousand rows, and an unbounded
              one would push the board off the screen entirely.
              In a sheet it SHRINKS to what the sheet has left rather than
              measuring anything — see the note in Overlay. Every estimate of
              the chrome above it was wrong in one direction or the other, and
              the last one took the bottom off the footer button. Inline (the
              uncontrolled panel) there is no sheet to shrink against, so that
              case keeps a plain cap. */}
          <ScrollView style={controlled ? { flexShrink: 1 } : { maxHeight: 330 }} nestedScrollEnabled contentContainerStyle={{ paddingBottom: 8 }}>
            {groups.map((g) => (
              <View key={g.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.sh, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Mono size={9.5} weight="700" track={0.1}>{g.label}</Mono>
                  <Mono size={9} tone="faint">{g.players.length}</Mono>
                </View>
                {g.players.map((p) => <RosterRow key={p.id} player={p} group={groupOf?.(p.id) ?? 'start'} week={week} userId={userId} />)}
              </View>
            ))}
            {!groups.length && (
              <Mono size={10.5} tone="dim" style={{ padding: 14 }}>
                {players.length ? 'No players match that filter.' : 'No players on this roster yet.'}
              </Mono>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function RosterRow({ player, group, week, userId }: { player: Player; group: PoolGroup; week: number; userId?: string }) {
  const t = useTheme();
  const pc = t.pos[player.pos as keyof typeof t.pos] ?? { bg: t.sh, fg: t.dim, bd: t.bd };
  const photo = headshot(player.id);
  const logo = teamLogo(player.team);
  return (
    <Pressable
      onPress={() => openPlayerCard({ slug: player.id, name: player.full ?? player.name, pos: player.pos, team: player.team, week: week || undefined, userId })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center' }}>
        {photo
          ? <Image source={{ uri: photo }} style={{ width: 26, height: 26 }} resizeMode="cover" />
          : logo
            ? <Image source={{ uri: logo }} style={{ width: 18, height: 18 }} resizeMode="contain" />
            : <Text style={{ fontFamily: MONO, fontSize: 9, color: t.faint }}>{player.pos}</Text>}
      </View>
      <View style={{ backgroundColor: pc.bg, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: pc.fg }}>{player.pos}</Text>
      </View>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.text }}>{player.full}</Text>
      <InjuryBadge status={injuryFor(week, player.id)} />
      <GroupBadge group={group} />
      <Mono size={9} tone="faint">{player.team}</Mono>
    </Pressable>
  );
}
