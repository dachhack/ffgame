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
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { METRICS, metricById } from '@drip/core/data/metrics';
import type { Metric, Pick, Player } from '@drip/core/types';
import { useTheme, MONO, alpha } from '../theme.native';
import { Mono } from './prims';
import { CardFace, CardBack, CardEmpty } from './cards';
import { Overlay } from './Overlay';
import { teamLogo } from '@drip/core/data/media';

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
        player={player}
        currentId={pick?.metricId ?? null}
        filter={metricFilter}
        onPick={(id) => { onPickMetric(id); setMetricOpen(false); }}
        onClose={() => setMetricOpen(false)}
      />
    </View>
  );
}

/** Metric choice — a floating card, matching the web's "Pick how he scores".
 *
 *  Still a separate overlay rather than expanding inline: an inline list
 *  balloons the card height and drags the paired sealed card with it. */
function MetricModal({ visible, player, currentId, filter, onPick, onClose }: {
  visible: boolean; player: Player | null; currentId: string | null;
  filter?: (m: Metric) => boolean;
  onPick: (id: string) => void; onClose: () => void;
}) {
  const t = useTheme();
  const [info, setInfo] = useState<Metric | null>(null);
  if (!player) return null;
  const all = METRICS[player.pos] ?? [];
  const list = filter ? all.filter(filter) : all;
  const logo = teamLogo(player.team);

  return (
    <Overlay
      visible={visible}
      title="Pick how he scores"
      subtitle={`${player.name.toUpperCase()} · ${player.pos} · SEALED FROM YOUR OPPONENT UNTIL KICKOFF`}
      titleLeft={logo ? <Image source={{ uri: logo }} style={{ width: 34, height: 34 }} resizeMode="contain" /> : undefined}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
        {list.map((m) => {
          const on = m.id === currentId;
          const fx = t.fx[m.fx] ?? t.you;
          return (
            <Pressable
              key={m.id}
              onPress={() => onPick(m.id)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: on ? alpha(t.you, 12) : t.bg,
                borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
                borderRadius: 8, padding: 12,
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.text }}>{m.lock ? '🔓 ' : ''}{m.name}</Text>
                  <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: fx, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: fx }}>{m.tag}</Text>
                  </View>
                  {on && <Mono size={9} tone="you" weight="700">✓ SEALED</Mono>}
                </View>
                <Text style={{ fontSize: 12, color: t.mid, lineHeight: 17 }}>{m.hook}</Text>
              </View>
              {/* The web's ⓘ opens the full effect text; the scoring line is the
                  most-asked-for half of it, so it sits behind the same tap. */}
              <Pressable
                onPress={() => setInfo(m)}
                hitSlop={8}
                style={{ width: 30, height: 30, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 13, color: t.dim }}>ⓘ</Text>
              </Pressable>
            </Pressable>
          );
        })}
        {!list.length && <Mono size={10} tone="dim">No metrics available for this position.</Mono>}
      </ScrollView>

      {/* The full effect text, on demand — too long to sit in every row. */}
      <Overlay visible={!!info} title={info?.name ?? ''} subtitle={info?.sc} onClose={() => setInfo(null)}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={{ fontSize: 13, color: t.text, lineHeight: 20 }}>{info?.ef ?? info?.hook}</Text>
        </ScrollView>
      </Overlay>
    </Overlay>
  );
}
