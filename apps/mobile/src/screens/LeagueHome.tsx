// League home (0182), native — the hub an open league lands on. The web
// LeagueHubPage's sibling: instead of dropping straight onto the matchup
// board, a league opens HERE, and the board / team desk / chat / shop /
// commissioner's tools are each one tile away. The tab strip stays — the hub
// is the 🏠 LEAGUE tab, and the strip is still the fast lane between rooms.
import { Ev, track } from '@drip/core/analytics';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { leagueNote, chatUnread } from '@drip/core/data/liveApi';
import { useTheme, alpha, MONO } from '../theme.native';
import { tap } from '../ui/feedback';
import { Mono } from '../ui/prims';

export type LeagueRoom = 'picks' | 'draft' | 'team' | 'chat' | 'commishtools';

export function LeagueHome({ leagueId, name, teamName, rosterId, native, commish, onGo, onShop, onBack }: {
  leagueId: string;
  name: string;
  teamName?: string | null;
  rosterId: number | null;
  native: boolean;
  commish: boolean;
  onGo: (room: LeagueRoom) => void;
  /** Opens the board with the power-up shop already up. */
  onShop: () => void;
  onBack: () => void;
}) {
  const t = useTheme();
  // The note lives HERE now (0182.1 — off the board, founder's call), so the
  // commissioner's empty-state prompt shows too, not just a standing note.
  const [note, setNote] = useState<{ text: string; canEdit: boolean } | null>(null);
  const [unread, setUnread] = useState<{ n: number; mention: boolean }>({ n: 0, mention: false });
  useEffect(() => {
    leagueNote(leagueId)
      .then((r) => { if (r.ok && (r.text || r.can_edit)) setNote({ text: r.text ?? '', canEdit: !!r.can_edit }); })
      .catch(() => {});
    chatUnread(leagueId)
      .then((r) => { if (r.ok) setUnread({ n: (r.league ?? 0) + (r.dm ?? 0), mention: (r.mention ?? 0) > 0 }); })
      .catch(() => {});
  }, [leagueId]);

  const tile = (icon: string, title: string, sub: string, onPress: () => void, opts?: { accent?: boolean; badge?: string }) => (
    <Pressable key={title} onPress={() => { tap(); onPress(); }} android_ripple={{ color: alpha(t.you, 16) }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
        ...(opts?.accent ? { borderLeftWidth: 3, borderLeftColor: t.you } : {}),
        borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, opacity: pressed ? 0.85 : 1,
      })}>
      <Text style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{icon}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: t.text }}>{title}</Text>
          {!!opts?.badge && (
            <View style={{ backgroundColor: t.you, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.onAccent }}>{opts.badge}</Text>
            </View>
          )}
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 9, color: t.dim, marginTop: 2, lineHeight: 12 }}>{sub}</Text>
      </View>
      <Text style={{ fontFamily: MONO, fontSize: 12, color: t.faint }}>→</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 19, fontWeight: '700', color: t.text }}>{name}</Text>
          {!!teamName && <Mono size={9.5} tone="faint" style={{ marginTop: 2 }}>you are {teamName}{commish ? ' · ⚑ commissioner' : ''}</Mono>}
        </View>
        <Pressable hitSlop={8} onPress={() => { tap(); onBack(); }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.dim }}>← leagues</Text>
        </Pressable>
      </View>

      {!!note && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: alpha('#A87BD8', 10), borderWidth: StyleSheet.hairlineWidth, borderColor: '#A87BD8', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: '#A87BD8', paddingTop: 1 }}>⚑ LEAGUE NOTE</Text>
          {note.text
            ? <Text style={{ flex: 1, fontSize: 11.5, lineHeight: 16, color: t.text }}>{note.text}</Text>
            : <Text style={{ flex: 1, fontFamily: MONO, fontSize: 9.5, lineHeight: 13, color: t.faint }}>nothing posted — say something to the league</Text>}
          {note.canEdit && (
            <Pressable hitSlop={6} onPress={() => { tap(); onGo('commishtools'); }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>✎ {note.text ? 'edit' : 'write'}</Text>
            </Pressable>
          )}
        </View>
      )}

      {rosterId != null && tile('▦', 'My matchup', 'your board — set the lineup, watch it live', () => { track(Ev.hubTileOpened, { tile: 'matchup' }); onGo('picks'); }, { accent: true })}
      {tile('💬', 'Chat', 'league channel · direct messages', () => { track(Ev.hubTileOpened, { tile: 'chat' }); onGo('chat'); },
        unread.n > 0 ? { badge: `${unread.mention ? '@ ' : ''}${unread.n > 99 ? '99+' : unread.n}` } : undefined)}
      {rosterId != null && tile('◈', 'Power-up shop', 'spend drip coin — opens on your board', () => { track(Ev.hubTileOpened, { tile: 'shop' }); onShop(); })}
      {native && rosterId != null && tile('⇄', 'My team', 'waivers · trades · standings · team options', () => { track(Ev.hubTileOpened, { tile: 'team' }); onGo('team'); })}
      {native && tile('⛏', 'Draft room', 'live on draft night, the record after', () => { track(Ev.hubTileOpened, { tile: 'draft' }); onGo('draft'); })}
      {commish && tile('⚑', 'Commissioner', 'seats · rules · kit · scoring', () => { track(Ev.hubTileOpened, { tile: 'commish' }); onGo('commishtools'); }, { accent: true })}
    </ScrollView>
  );
}
