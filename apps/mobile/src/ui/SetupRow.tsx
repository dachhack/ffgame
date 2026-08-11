// The setup slot: your pick on the left, the opponent's sealed card on the
// right, plus the metric-choice modal.
//
// Much smaller than the web's `SetupRow` (boardParts.tsx, ~250 lines) because
// LivePicks uses that component in a degenerate mode — it passes
// `applyMode: null`, `appliedPu: []`, `selected: false`, `hideScout`, and
// no-ops for onDropPlayer/onScout/onApplyToSpot. All the apply-targeting,
// drag-and-drop and scouting machinery in the web version is dead code on this
// screen. Porting it wholesale would have carried ~150 lines of branches that
// can never be taken here. When the live board (which does use apply mode)
// gets ported, this component grows to meet it — not before.
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { METRICS, metricById } from '@drip/core/data/metrics';
import type { Metric, Pick, Player, Pos } from '@drip/core/types';
import { useTheme, MONO, alpha } from '../theme.native';
import { Display, Mono } from './prims';
import { CardFace, CardBack, CardEmpty } from './cards';

export function SetupRow({ pick, resolve, lockPlayer, metricFilter, onOpenPicker, onPickMetric, onClearSlot }: {
  pick?: Pick;
  resolve: (id: string) => Player | undefined;
  lockPlayer?: boolean;
  /** Which metrics this slot may offer — LivePicks filters by armed unlocks. */
  metricFilter?: (m: Metric) => boolean;
  onOpenPicker: () => void;
  onPickMetric: (id: string) => void;
  onClearSlot: () => void;
}) {
  const t = useTheme();
  const player = pick ? resolve(pick.playerId) ?? null : null;
  const metric = player && pick?.metricId ? metricById(player.pos, pick.metricId) : null;
  const [metricOpen, setMetricOpen] = useState(false);

  // A freshly-placed player with no metric opens the picker straight away —
  // same behaviour as the web card, and the reason a slot never sits half-set.
  useEffect(() => {
    if (pick?.playerId && !pick?.metricId && !lockPlayer) setMetricOpen(true);
  }, [pick?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      {/* Your card, then the opponent's face-down one — the pairing IS the
          game's premise, so they sit at matched size on the felt. */}
      {player ? (
        <CardFace
          slug={player.id}
          name={player.name}
          pos={player.pos}
          team={player.team}
          metric={metric?.name ?? null}
          accent={t.you}
          onPress={lockPlayer ? undefined : () => (pick?.metricId ? setMetricOpen(true) : onOpenPicker())}
          onRemove={lockPlayer ? undefined : onClearSlot}
          footer={lockPlayer ? undefined : (
            <>
              <Text onPress={() => setMetricOpen(true)} style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: '#8A6A28' }}>↻ METRIC</Text>
              <Text onPress={onOpenPicker} style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: '#A2422F' }}>⇄ PLAYER</Text>
            </>
          )}
        />
      ) : (
        <CardEmpty label={lockPlayer ? 'EMPTY' : '+ PICK A PLAYER'} onPress={lockPlayer ? undefined : onOpenPicker} />
      )}

      <CardBack />

      <MetricModal
        visible={metricOpen}
        pos={player?.pos ?? null}
        currentId={pick?.metricId ?? null}
        filter={metricFilter}
        onPick={(id) => { onPickMetric(id); setMetricOpen(false); }}
        onClose={() => setMetricOpen(false)}
      />
    </View>
  );
}

/** Metric choice, in its own sheet. The web version does the same rather than
 *  expanding inline — an inline list balloons the card height and drags the
 *  paired sealed card with it. */
function MetricModal({ visible, pos, currentId, filter, onPick, onClose }: {
  visible: boolean; pos: Pos | null; currentId: string | null;
  filter?: (m: Metric) => boolean;
  onPick: (id: string) => void; onClose: () => void;
}) {
  const t = useTheme();
  if (!pos) return null;
  const all = METRICS[pos] ?? [];
  const list = filter ? all.filter(filter) : all;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
          <Display size={16}>Seal a metric</Display>
          <Pressable onPress={onClose} hitSlop={10}><Mono size={11} tone="dim">close</Mono></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          <Mono size={9.5} tone="faint">How this player scores — and the effect it fires. Hidden from your opponent until the window kicks off.</Mono>
          {list.map((m) => {
            const on = m.id === currentId;
            const fx = t.fx[m.fx] ?? t.you;
            return (
              <Pressable
                key={m.id}
                onPress={() => onPick(m.id)}
                style={{
                  backgroundColor: on ? alpha(t.you, 12) : t.surface,
                  borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
                  borderLeftWidth: 3, borderLeftColor: fx,
                  borderRadius: 6, padding: 12, gap: 5,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{m.lock ? '🔓 ' : ''}{m.name}</Text>
                  <View style={{ backgroundColor: alpha(fx, 14), borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: fx }}>{m.tag}</Text>
                  </View>
                  {on && <Mono size={9} tone="you" weight="700">✓ SEALED</Mono>}
                </View>
                <Mono size={9.5} tone="mid">{m.hook}</Mono>
                <Mono size={8.5} tone="faint">{m.sc}</Mono>
              </Pressable>
            );
          })}
          {!list.length && <Mono size={10} tone="dim">No metrics available for this position.</Mono>}
        </ScrollView>
      </View>
    </Modal>
  );
}
