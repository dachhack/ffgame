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
import { Display, Mono, PosPill } from './prims';

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
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {/* Your spot */}
      {player ? (
        <View style={{
          flex: 1, backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
          borderLeftWidth: 3, borderLeftColor: t.you, borderRadius: 4, padding: 10, gap: 7,
        }}>
          <Pressable onPress={lockPlayer ? undefined : onOpenPicker} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <PosPill pos={player.pos} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontWeight: '700', color: t.text }}>{player.name}</Text>
            </View>
            <Mono size={8.5} tone="faint" track={0.06}>{player.team || '—'}</Mono>
          </Pressable>

          {metric ? (
            <Pressable onPress={lockPlayer ? undefined : () => setMetricOpen(true)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ backgroundColor: alpha(t.fx[metric.fx] ?? t.you, 14), borderWidth: StyleSheet.hairlineWidth, borderColor: alpha(t.fx[metric.fx] ?? t.you, 45), borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.fx[metric.fx] ?? t.you }}>{metric.tag}</Text>
                </View>
                <Mono size={9} tone="mid" style={{ flex: 1 }}>{metric.name}</Mono>
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={lockPlayer ? undefined : () => setMetricOpen(true)}>
              <Mono size={8.5} tone="warn" weight="700" track={0.1}>SEAL A METRIC →</Mono>
            </Pressable>
          )}

          {!lockPlayer && (
            <Pressable onPress={onClearSlot} hitSlop={8} style={{ position: 'absolute', top: 6, right: 8 }}>
              <Text style={{ fontFamily: MONO, fontSize: 11, color: t.opp }}>✕</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Pressable
          onPress={lockPlayer ? undefined : onOpenPicker}
          style={{
            flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderStyle: 'dashed',
            borderRadius: 4, padding: 10, minHeight: 74, alignItems: 'center', justifyContent: 'center',
            opacity: lockPlayer ? 0.5 : 1,
          }}
        >
          <Mono size={9.5} tone="faint" track={0.1}>{lockPlayer ? 'EMPTY' : '+ PICK A PLAYER'}</Mono>
        </Pressable>
      )}

      {/* Opponent: face-down until its window kicks off. Rendered here rather
          than by the caller so the two cards share a row height. */}
      <View style={{
        flex: 1, backgroundColor: t.sh, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
        borderLeftWidth: 3, borderLeftColor: t.opp, borderRadius: 4, padding: 10,
        alignItems: 'center', justifyContent: 'center', minHeight: 74,
      }}>
        <Mono size={9.5} tone="faint" track={0.12}>SEALED</Mono>
      </View>

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
