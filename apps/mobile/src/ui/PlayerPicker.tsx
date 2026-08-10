// Player choice for a slot, as a sheet.
//
// The web version (boardParts.tsx) also renders a card-table variant and a
// headshot grid; both are skin features that follow the card-deck setting,
// which the app doesn't carry yet. This is the list form only.
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Player } from '@drip/core/types';
import { useTheme, alpha } from '../theme.native';
import { Display, Mono, PosPill } from './prims';

export function PlayerPicker({ visible, players, currentId, subtitle, gated, onGated, onPick, onRemove, onClose }: {
  visible: boolean;
  players: Player[];
  currentId?: string;
  subtitle?: string;
  /** True when the player sits behind the premium tier (K/DST/IDP). */
  gated?: (p: Player) => boolean;
  onGated?: (p: Player) => void;
  onPick: (id: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
          <View style={{ flex: 1 }}>
            <Display size={16}>Pick a player</Display>
            {!!subtitle && <Mono size={8.5} tone="faint" track={0.06}>{subtitle}</Mono>}
          </View>
          <Pressable onPress={onClose} hitSlop={10}><Mono size={11} tone="dim">close</Mono></Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {players.map((p) => {
            const isGated = gated?.(p) ?? false;
            const on = p.id === currentId;
            return (
              <Pressable
                key={p.id}
                onPress={() => (isGated ? onGated?.(p) : onPick(p.id))}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 9,
                  backgroundColor: on ? alpha(t.you, 12) : t.surface,
                  borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
                  borderRadius: 6, padding: 12,
                  opacity: isGated ? 0.55 : 1,
                }}
              >
                <PosPill pos={p.pos} />
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: t.text }}>{p.full}</Text>
                <Mono size={9} tone="faint">{p.team || '—'}</Mono>
                {isGated && <Text style={{ fontSize: 11 }}>🔒</Text>}
                {on && <Mono size={9} tone="you" weight="700">✓</Mono>}
              </Pressable>
            );
          })}
          {!players.length && (
            <Mono size={10.5} tone="dim">No eligible players for this window. Everyone on your roster is either on a bye or plays in another window.</Mono>
          )}
        </ScrollView>

        {!!currentId && (
          <View style={{ padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
            <Pressable onPress={onRemove} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Mono size={10.5} tone="opp" weight="700" track={0.06}>REMOVE FROM SLOT</Mono>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
