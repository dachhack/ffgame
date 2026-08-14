// Player choice for a slot — a floating card over the board, matching the web.
//
// The list version this replaces was legible but wrong in kind: on the web this
// is a GRID of mini player cards, because you pick a face, not a row of text.
// The search box and position filters are the difference between usable and
// not — this window's pool ran to 340 players in a preseason league and 1024 in
// the roster panel.
//
// Deliberately absent: the "all games (N)" and "all teams (N)" dropdowns. They
// want a real dropdown component, and position + search already cut the list
// hard. Worth adding when someone actually needs to filter by kickoff.
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { headshot, teamLogo } from '@drip/core/data/media';
import type { Player } from '@drip/core/types';
import type { PoolGroup } from '@drip/core/data/poolEntry';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';
import { GROUP_TABS, groupTag } from './rosterGroup';
import { openPlayerCard } from './PlayerCardSheet';
import { flagFor } from '@drip/core/data/commish';
import { injuryFor } from '@drip/core/data/injuries';

const POS_TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

export function PlayerPicker({ visible, windowLabel, players, currentId, week, userId, groupOf, gated, onGated, onPick, onRemove, onClose }: {
  visible: boolean;
  windowLabel?: string;
  players: Player[];
  currentId?: string;
  /** The week being filled — scopes the injury report to the week it speaks for.
   *  This is the surface where the designation actually changes a decision: it
   *  is the last thing a manager sees before committing a player to a slot. */
  week: number;
  /** Signed-in account — lights the ★ on the ⓘ player card. */
  userId?: string;
  /** Which part of the roster a player sits on, when the caller knows. */
  groupOf?: (playerId: string) => PoolGroup;
  gated?: (p: Player) => boolean;
  onGated?: (p: Player) => void;
  onPick: (id: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<string>('ALL');
  const [grp, setGrp] = useState<PoolGroup | 'ALL'>('ALL');

  // Same reasoning as the roster panel: no chips unless there is something for
  // them to separate.
  const hasGroups = useMemo(
    () => !!groupOf && players.some((p) => groupOf(p.id) !== 'start'),
    [players, groupOf],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players.filter((p) => {
      if (pos !== 'ALL' && p.pos !== pos) return false;
      if (grp !== 'ALL' && (groupOf?.(p.id) ?? 'start') !== grp) return false;
      if (!needle) return true;
      return p.full.toLowerCase().includes(needle) || (p.team ?? '').toLowerCase().includes(needle);
    });
  }, [players, q, pos, grp, groupOf]);

  return (
    <Overlay
      visible={visible}
      title={`${windowLabel ?? 'Slot'} · Pick a player`}
      subtitle="YOUR PLAYERS WHOSE GAME FALLS IN THIS WINDOW"
      onClose={onClose}
      footer={currentId ? (
        <Pressable
          onPress={onRemove}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.opp, borderStyle: 'dashed', borderRadius: 8, paddingVertical: 13, alignItems: 'center' }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: t.opp }}>✕  REMOVE FROM SPOT</Text>
        </Pressable>
      ) : undefined}
    >
      <View style={{ padding: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="search players…"
          placeholderTextColor={t.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            fontFamily: MONO, fontSize: 14, color: t.text, backgroundColor: t.bg,
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8,
            paddingHorizontal: 12, paddingVertical: 10,
          }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {POS_TABS.map((tab) => {
            const on = pos === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => setPos(tab)}
                style={{
                  borderRadius: 7, paddingHorizontal: 13, paddingVertical: 7,
                  backgroundColor: on ? t.you : t.bg,
                  borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
                }}
              >
                <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: on ? t.onAccent : t.dim }}>{tab}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {hasGroups && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {GROUP_TABS.map((tab) => {
              const on = grp === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setGrp(tab.id)}
                  style={{
                    borderRadius: 7, paddingHorizontal: 11, paddingVertical: 6,
                    backgroundColor: on ? t.sh : 'transparent',
                    borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
                  }}
                >
                  <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: on ? t.you : t.faint }}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <Mono size={10} tone="faint">{shown.length} player{shown.length === 1 ? '' : 's'}</Mono>
      </View>

      {/* Bounded like every other sheet body. Unbounded, a 342-player
          preseason window sized this grid past Overlay's cap, and a card that
          overflows its cap clips — so the pool simply ended partway down with
          no way to reach the rest. */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
        {shown.map((p) => (
          <MiniPlayerCard
            key={p.id}
            player={p}
            current={p.id === currentId}
            group={groupOf?.(p.id) ?? 'start'}
            injury={injuryFor(week, p.id)}
            onInfo={() => openPlayerCard({ slug: p.id, name: p.full ?? p.name, pos: p.pos, team: p.team, week, userId })}
            gated={gated?.(p) ?? false}
            onPress={() => (gated?.(p) ? onGated?.(p) : onPick(p.id))}
          />
        ))}
        {!shown.length && (
          <Mono size={10.5} tone="dim" style={{ padding: 8 }}>
            {players.length
              ? 'No players match that filter.'
              : 'No eligible players for this window — everyone on your roster is on a bye or plays in another window.'}
          </Mono>
        )}
      </ScrollView>
    </Overlay>
  );
}

/** A dealt mini card: position badge, team crest, headshot, name. Same cream
 *  stock as the board's cards so the picker reads as the same deck. */
function MiniPlayerCard({ player, current, group, injury, gated, onPress, onInfo }: {
  player: Player; current: boolean; group: PoolGroup; injury: string | null; gated: boolean; onPress: () => void; onInfo?: () => void;
}) {
  const t = useTheme();
  const pc = t.pos[player.pos as keyof typeof t.pos] ?? { bg: t.sh, fg: t.dim, bd: t.bd };
  const photo = headshot(player.id);
  const logo = teamLogo(player.team);
  const src = photo ?? logo;
  const tag = groupTag(group);
  const tagFg = group === 'ir' ? '#A3401F' : group === 'taxi' ? '#5B6B2E' : '#8A7C55';
  // Card-local injury palette, for the same reason the group tag has one: the
  // shared hues are tuned to sit on a themed background, and this card is cream
  // stock in both themes — the Questionable yellow in particular washes out on
  // it. Same hue family, darkened until it holds on cream, same severity order.
  const injFg = injury === 'O' ? '#C42A38' : injury === 'IR' ? '#8E1F31' : injury === 'D' ? '#B2551A' : '#8A6A28';

  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '31.5%',
        backgroundColor: '#F4EDDA',
        borderWidth: current ? 2 : StyleSheet.hairlineWidth,
        borderColor: current ? '#E0B24E' : '#D8C9A4',
        borderRadius: 8, padding: 6, gap: 5, alignItems: 'center',
        opacity: gated ? 0.5 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignSelf: 'stretch', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ backgroundColor: pc.bg, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: pc.fg }}>{player.pos}</Text>
        </View>
        {/* Deliberately NOT the shared GroupBadge: that one is drawn in theme
            colours, and this card is cream stock in both themes — t.dim on
            cream is unreadable in dark mode. Same tags, card-local palette. */}
        {tag ? (
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: tagFg, borderRadius: 3, paddingHorizontal: 3 }}>
            <Text style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: '700', color: tagFg }}>{tag}</Text>
          </View>
        ) : null}
        {injury ? (
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: injFg, borderRadius: 3, paddingHorizontal: 3 }}>
            <Text style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: '700', color: injFg }}>{injury}</Text>
          </View>
        ) : null}
        {flagFor(player.id) ? (
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: '#7B5AA6', borderRadius: 3, paddingHorizontal: 3, maxWidth: 64 }}>
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: '700', color: '#7B5AA6' }}>⚑ {flagFor(player.id)}</Text>
          </View>
        ) : null}
        {onInfo && (
          <Pressable onPress={onInfo} hitSlop={8} style={{ width: 15, height: 15, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#8A7C55', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: '#8A7C55' }}>i</Text>
          </Pressable>
        )}
        {!!logo
          ? <Image source={{ uri: logo }} style={{ width: 13, height: 13 }} resizeMode="contain" />
          : <Text style={{ fontFamily: MONO, fontSize: 8, color: '#6B6047' }}>{player.team}</Text>}
      </View>

      <View style={{ width: '100%', aspectRatio: 1, borderRadius: 6, borderWidth: 1.5, borderColor: pc.fg, backgroundColor: '#EDE4CB', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {src
          ? <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode={photo ? 'cover' : 'contain'} />
          : <Text style={{ fontFamily: MONO, fontSize: 14, color: '#6B6047' }}>{player.pos}</Text>}
      </View>

      <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: '800', color: '#201C12', textAlign: 'center' }}>{player.name}</Text>
      {current && <Mono size={8} weight="700" style={{ color: '#8A6A28' }}>CURRENT ✓</Mono>}
      {gated && <Text style={{ fontSize: 10 }}>🔒</Text>}
    </Pressable>
  );
}
