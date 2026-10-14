// The setup slot: your pick on the left, the opponent's sealed card on the
// right, plus the metric-choice modal.
//
// Much smaller than the web's `SetupRow` (boardParts.tsx, ~250 lines) because
// LivePicks uses that component in a degenerate mode — it passes
// `applyMode: null`, `appliedPu: []`, `selected: false`, `hideScout`, and
// no-ops for onDropPlayer/onScout/onApplyToSpot. All the apply-targeting,
// drag-and-drop and scouting machinery in the web version is dead code on this
// screen. Porting it wholesale would have carried ~150 lines of branches that
// can never be taken here. When the web board (which does use apply mode)
// gets ported, this component grows to meet it — not before.
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { METRICS, metricById } from '@drip/core/data/metrics';
import type { Metric, Pick, Player } from '@drip/core/types';
import { useTheme, MONO, alpha, fsTight } from '../theme.native';
import { Mono } from './prims';
import { CardFace, CardBack, CardEmpty, CardPhantom, loadCardSize, cs } from './cards';
import { openPlayerCard } from './PlayerCardSheet';
import { Overlay } from './Overlay';
import { teamLogo, headshot } from '@drip/core/data/media';
import { playerHelmetFace } from './HelmetFace';

export function SetupRow({ pick, resolve, lockPlayer, metricFilter, applied, twin, phantom, hydrated = true, idx = 0, onScout, onOpenPicker, onPickMetric, onClearSlot }: {
  pick?: Pick;
  /** Power-ups attached to THIS slot — targeted plays plus armed team buffs
   *  that matter to it (v0.375.1). Worn on the card's shoulder as ONE gold
   *  ⚡ chip that shows each one's ICON (v0.431.0, founder: "if I used
   *  momentum it shouldn't be in my hand anymore. It should show on the
   *  spots though" — a bare count said something was here, not what);
   *  tapping it lists them. No take-backs (founder: "if you use a power up
   *  you can't take it back") — the sheet reads, it never disarms. */
  applied?: { id?: string; icon: string; name: string; blurb: string }[];
  /** TWIN GENERALS pairs this card with another Field General in the same
   *  window (v0.417.0, founder: "I armed twin generals for 1pm but I don't
   *  see it on the cards"). Worn on the card rather than only inside the ⚡
   *  chip, because the whole point is knowing WHICH two are linked, and a
   *  chip you have to tap is not seeing it. */
  twin?: boolean;
  /** A GHOST (or a Bye Steal) holds this otherwise-empty spot (v0.516.0) —
   *  drawn as its own card instead of the blank "+ PICK A PLAYER". */
  phantom?: { icon: string; title: string; sub: string; kind?: 'ghost' | 'bye' } | null;
  /** Deal order within the window. */
  idx?: number;
  /** Opens the opponent's window pool. Absent when there is nothing to scout. */
  onScout?: () => void;
  resolve: (id: string) => Player | undefined;
  lockPlayer?: boolean;
  /** Which metrics this slot may offer — LivePicks filters by armed unlocks. */
  metricFilter?: (m: Metric) => boolean;
  /** False while the board is still loading its saved lineup — see the note on
   *  the auto-open below. Defaults true for callers whose picks are present
   *  from the first render. */
  hydrated?: boolean;
  onOpenPicker: () => void;
  onPickMetric: (id: string) => void;
  onClearSlot: () => void;
}) {
  const t = useTheme();
  const player = pick ? resolve(pick.playerId) ?? null : null;
  const metric = player && pick?.metricId ? metricById(player.pos, pick.metricId) : null;
  const [metricOpen, setMetricOpen] = useState(false);
  const [puOpen, setPuOpen] = useState(false);
  // Read per render, like the deck art — Settings lives above this in the tree,
  // so changing it re-renders the board and the new size lands with it.
  const cardSize = loadCardSize();

  // A freshly-PLACED player with no metric opens the picker, so a slot never
  // sits half-set. Placed, which means the player CHANGED and you changed it —
  // not merely that there is one.
  //
  // Keyed on `pick?.playerId` alone this fires on mount, so a saved lineup
  // holding a player without a metric threw the card up before you had touched
  // anything. A mount-seeded ref fixes that only when the pick is already there
  // at mount; `hydrated` covers the board that renders first and loads after,
  // where the slot goes undefined → someone; and `settled` covers the case
  // where the picks and the hydrated flag arrive in the SAME render, which they
  // do when both setStates land in one batch. All three are needed — see the
  // matching note in the web's boardParts.tsx, which had all three failures.
  const prevPlayerId = useRef(pick?.playerId);
  const settled = useRef(false);
  useEffect(() => {
    const prev = prevPlayerId.current;
    prevPlayerId.current = pick?.playerId;
    if (!hydrated) return;
    if (!settled.current) { settled.current = true; return; }
    if (prev === pick?.playerId) return;
    if (pick?.playerId && !pick?.metricId && !lockPlayer) setMetricOpen(true);
  }, [pick?.playerId, pick?.metricId, lockPlayer, hydrated]);

  // The chip's detail sheet and the metric sheet: the same two overlays
  // whichever way the spot is drawn.
  const sheets = (
    <>
      <Overlay
        visible={puOpen}
        title="Power-ups on this card"
        subtitle={player ? `${player.name.toUpperCase()} · ${player.pos}` : undefined}
        onClose={() => setPuOpen(false)}
      >
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
          {(applied ?? []).map((a, i) => (
            <View key={`${a.name}-${i}`} style={{ flexDirection: 'row', gap: 10, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 12 }}>
              <Text style={{ fontSize: 20 }}>{a.icon}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: t.text }}>{a.name}</Text>
                {!!a.blurb && <Text style={{ fontSize: 12, color: t.mid, lineHeight: 17 }}>{a.blurb}</Text>}
              </View>
            </View>
          ))}
        </ScrollView>
      </Overlay>

      <MetricModal
        visible={metricOpen}
        player={player}
        currentId={pick?.metricId ?? null}
        filter={metricFilter}
        onPick={(id) => { onPickMetric(id); setMetricOpen(false); }}
        onClose={() => setMetricOpen(false)}
      />
    </>
  );

  // NO CARDS (v0.713.6, founder: "Let's add a no cards setting"): the spot as
  // one plain row. Same taps as the card: the name opens the player card, the
  // metric line opens the metric sheet, ⇄ swaps, ✕ clears, and the sealed
  // side scouts.
  if (cardSize === 'none') {
    const face = player
      ? playerHelmetFace(player.id, 36, player.team) ?? (
        <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
          {headshot(player.id)
            ? <Image source={{ uri: headshot(player.id)! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            : <Mono size={8} tone="faint" weight="700">{player.pos}</Mono>}
        </View>)
      : null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, backgroundColor: t.sh }}>
        {player ? (
          <>
            {face}
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Pressable hitSlop={4} style={{ flexShrink: 1 }} onPress={() => openPlayerCard({ slug: player.id, name: player.name, pos: player.pos, team: player.team })}>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{player.name}</Text>
                </Pressable>
                {twin && <Mono size={8.5} weight="700" style={{ color: '#E9B959' }}>🎖️×2</Mono>}
                {!!applied?.length && (
                  <Pressable hitSlop={6} onPress={() => setPuOpen(true)} accessibilityLabel={`${applied.map((a) => a.name).join(', ')} on this spot`}>
                    <Text style={{ fontSize: 11 }}>⚡{applied.slice(0, 3).map((a) => a.icon).join('')}{applied.length > 3 ? `+${applied.length - 3}` : ''}</Text>
                  </Pressable>
                )}
              </View>
              <Mono size={8.5} tone="faint" numberOfLines={1}>{`${player.pos} · ${player.team}`}</Mono>
              <Pressable hitSlop={4} disabled={lockPlayer} onPress={() => setMetricOpen(true)} style={{ alignSelf: 'flex-start' }}>
                <Mono size={9} weight="700" tone={metric ? 'you' : 'warn'} numberOfLines={1}>{metric ? `${metric.name}${lockPlayer ? '' : ' ↻'}` : '+ PICK A METRIC'}</Mono>
              </Pressable>
            </View>
            {!lockPlayer && (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <Pressable hitSlop={6} onPress={onOpenPicker} accessibilityLabel="Swap player" style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
                  <Mono size={11} weight="700" tone="dim">⇄</Mono>
                </Pressable>
                <Pressable hitSlop={6} onPress={onClearSlot} accessibilityLabel="Clear this spot" style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
                  <Mono size={11} weight="700" tone="faint">✕</Mono>
                </Pressable>
              </View>
            )}
          </>
        ) : phantom ? (
          <Pressable disabled={!applied?.length} onPress={() => setPuOpen(true)} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 22 }}>{phantom.icon}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{phantom.title}</Text>
              <Mono size={8.5} tone="faint" numberOfLines={1}>{phantom.sub}</Mono>
            </View>
          </Pressable>
        ) : (
          <Pressable disabled={lockPlayer} onPress={onOpenPicker} style={{ flex: 1, paddingVertical: 10 }}>
            <Mono size={10} weight="700" tone={lockPlayer ? 'faint' : 'you'}>{lockPlayer ? 'EMPTY' : '+ PICK A PLAYER'}</Mono>
          </Pressable>
        )}
        {/* Their side: sealed until kickoff, and the way to scout it. */}
        <Pressable disabled={!onScout} onPress={onScout} hitSlop={4}
          style={{ alignItems: 'center', gap: 1, paddingLeft: 8, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.bd }}>
          <Mono size={8.5} weight="700" tone="opp">🔒 SEALED</Mono>
          {onScout && <Mono size={8.5} weight="700" tone="dim">🔍 SCOUT</Mono>}
        </Pressable>
        {sheets}
      </View>
    );
  }

  // Centred, because at Small and Medium the cards are capped and left to
  // themselves a flex row would push them to the edges with a hole between —
  // the pairing is the point, so they sit together.
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', justifyContent: 'center' }}>
      {/* Your card, then the opponent's face-down one — the pairing IS the
          game's premise, so they sit at matched size on the felt. */}
      {player ? (
        <View>
        <CardFace
          size={cardSize}
          slug={player.id}
          name={player.name}
          pos={player.pos}
          team={player.team}
          metric={metric?.name ?? null}
          accent={t.you}
          idx={idx}
          onPress={lockPlayer ? undefined : () => (pick?.metricId ? setMetricOpen(true) : onOpenPicker())}
          onRemove={lockPlayer ? undefined : onClearSlot}
          // The scale comes from the card, and every label uses it: at Small
          // these were drawn at a fixed 9pt inside a 122pt card and the row ran
          // off both edges (v0.296.1).
          footer={lockPlayer ? undefined : ((sc) => (
            <>
              <Text onPress={() => setMetricOpen(true)} style={{ fontFamily: MONO, fontSize: cs(9, sc), fontWeight: '700', color: '#8A6A28' }}>↻ METRIC</Text>
              <Text onPress={onOpenPicker} style={{ fontFamily: MONO, fontSize: cs(9, sc), fontWeight: '700', color: '#A2422F' }}>⇄ PLAYER</Text>
              {/* ⓘ the card (founder: a name should always reach one). The
                  face's own press is the swap/metric gesture the board was
                  built around, so this is ADDED beside it rather than
                  replacing a motion players already know. */}
              <Text onPress={() => openPlayerCard({ slug: player.id, name: player.name, pos: player.pos, team: player.team })}
                style={{ fontFamily: MONO, fontSize: cs(9, sc), fontWeight: '700', color: '#3C6E57' }}>ⓘ CARD</Text>
            </>
          ))}
        />
        {/* Attached power-ups ride the card's shoulder as ONE gold ⚡N chip —
            a row of pips ran off the card once buffs joined the targeted
            plays. Tapping it lists what's on the card. */}
        {/* 🎖️ TWIN ×2 — the web board's badge, on the app's card. Sits opposite
            the ⚡ chip so the two never collide on a narrow card. */}
        {twin && (
          <View style={{ position: 'absolute', top: -7, right: -5, zIndex: 5, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#241A08', borderWidth: 1.5, borderColor: '#C9A227', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ fontSize: 10 }}>🎖️</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: '#E9B959' }}>TWIN ×2</Text>
          </View>
        )}
        {!!applied?.length && (
          <Pressable onPress={() => setPuOpen(true)} hitSlop={6}
            accessibilityLabel={`${applied.map((a) => a.name).join(', ')} on this card`}
            style={{ position: 'absolute', top: -7, left: -5, zIndex: 5, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#241A08', borderWidth: 1.5, borderColor: '#E9B959', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ fontSize: 11 }}>⚡</Text>
            {/* The icons themselves — 📈 says Momentum where "1" said only
                "something". Three fit a narrow card; past that, a +N. */}
            <Text style={{ fontSize: 11 }}>{applied.slice(0, 3).map((a) => a.icon).join('')}</Text>
            {applied.length > 3 && <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: '#E9B959' }}>+{applied.length - 3}</Text>}
          </Pressable>
        )}
        </View>
      ) : (
        phantom
          // Tapping it says what it is (the same sheet as the ⚡ chip). Not a
          // picker: fielding a player here would stand the phantom down and
          // waste the card (the resolver fills a spot with it only while empty).
          ? <CardPhantom size={cardSize} idx={idx} icon={phantom.icon} title={phantom.title} sub={phantom.sub} kind={phantom.kind} onPress={applied?.length ? () => setPuOpen(true) : undefined} />
          : <CardEmpty size={cardSize} idx={idx} label={lockPlayer ? 'EMPTY' : '+ PICK A PLAYER'} onPress={lockPlayer ? undefined : onOpenPicker} />
      )}

      <CardBack size={cardSize} idx={idx} onPress={onScout} actionLabel={onScout ? '🔍 SCOUT' : undefined} />

      {sheets}
    </View>
  );
}

/** Metric choice — a floating card, matching the web's "Pick how he scores".
 *
 *  Still a separate overlay rather than expanding inline: an inline list
 *  balloons the card height and drags the paired sealed card with it. */
export function MetricModal({ visible, player, currentId, filter, title, subtitle, onPick, onClose }: {
  visible: boolean; player: Player | null; currentId: string | null;
  filter?: (m: Metric) => boolean;
  /** Mulligan (v0.515.0) reuses this sheet with its own words. */
  title?: string; subtitle?: string;
  onPick: (id: string) => void; onClose: () => void;
}) {
  const t = useTheme();
  const [info, setInfo] = useState<Metric | null>(null);
  if (!player) return null;
  const all = METRICS[player.pos] ?? [];
  const list = filter ? all.filter(filter) : all;
  const logo = teamLogo(player.team, { slug: player.id });

  return (
    <Overlay
      visible={visible}
      title={title ?? 'Pick how he scores'}
      subtitle={subtitle ?? `${player.name.toUpperCase()} · ${player.pos} · SEALED FROM YOUR OPPONENT UNTIL KICKOFF`}
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
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: MONO, fontSize: fsTight(8.5), fontWeight: '700', color: fx }}>{m.tag}</Text>
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
