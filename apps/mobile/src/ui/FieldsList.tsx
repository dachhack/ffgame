// ▦ THE FIELDS, WITH A READER (v0.390.2).
//
// Founder: "Can we have the live play reader work on a field you select?"
// One list for every place the app shows all the week's fields — the
// standalone All fields sheet and both boards' overlays. Tap a field to
// select it (lit border); the reader bar at the top is bound to the
// selected game, and switching games swaps the reader (keyed remount, so
// the old one stops). Each field also steps play by play on its own
// (FieldView ‹ ›), independent of the reader.
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { gameFeedFor } from '@drip/core/data/gameFeed';
import { useTheme } from '../theme.native';
import { Mono } from './prims';
import { FieldView } from './FieldView';
import { ReaderBar } from './ReaderBar';

export interface FieldsListGame { key: string; away: string; home: string; team: string; label?: string }

export function FieldsList({ week, games, empty, extra }: {
  week: number; games: FieldsListGame[]; empty: string;
  /** Per-game extra line (a board's "play log ▸" link), rendered in the header row. */
  extra?: (g: FieldsListGame) => ReactNode;
}) {
  const t = useTheme();
  const [selKey, setSelKey] = useState<string | null>(null);
  // Default to the first game, and never point at a game that has left the list.
  useEffect(() => { if (games.length && !games.some((g) => g.key === selKey)) setSelKey(games[0].key); }, [games, selKey]);
  const sel = games.find((g) => g.key === selKey) ?? games[0] ?? null;
  const selFeed = sel ? gameFeedFor(week, sel.team) : null;
  return (
    <View style={{ gap: 12 }}>
      {sel && selFeed && (
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 10, backgroundColor: t.surface }}>
          <ReaderBar key={sel.key} week={week} feed={selFeed} label={`🔊 ${sel.away} @ ${sel.home} · TAP ANOTHER FIELD TO SWITCH`} />
        </View>
      )}
      {games.length === 0 && <Mono size={10.5} tone="dim" style={{ textAlign: 'center', paddingVertical: 16 }}>{empty}</Mono>}
      {games.map((g) => {
        const on = g.key === sel?.key;
        return (
          <Pressable key={g.key} onPress={() => setSelKey(g.key)}
            style={{ gap: 4, borderRadius: 8, padding: 4, borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? t.you : 'transparent' }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Mono size={9.5} weight="700" track={0.08} tone={on ? 'you' : 'dim'}>{g.away}@{g.home}{g.label ? ` · ${g.label}` : ''}{on ? ' · 🔊' : ''}</Mono>
              {extra?.(g)}
            </View>
            <FieldView week={week} team={g.team} clock={Number.MAX_SAFE_INTEGER} />
          </Pressable>
        );
      })}
    </View>
  );
}
