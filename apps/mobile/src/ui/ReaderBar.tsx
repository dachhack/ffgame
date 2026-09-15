// 🔊 THE READER BAR — CATCH UP · LIVE · STOP for one game (v0.390.2).
//
// Extracted from PlayByPlaySheet so the All fields list can carry it too
// (founder: "have the live play reader work on a field you select"). Owns
// the core PlayReader for the feed it is given; hands the reader's state up
// through `onState` when a host wants to light the row being read. Remount
// (key it by game) to switch games — the old reader stops on unmount.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GamePlay, TeamGameFeed } from '@drip/core/data/gameFeed';
import { PlayReader, type ReaderState } from '@drip/core/data/playReader';
import { gameNameResolver } from '@drip/core/engine/gameNames';
import { useTheme, MONO, alpha, fs } from '../theme.native';
import { appVoice } from './voice';

export const feedOver = (feed: TeamGameFeed | null | undefined): boolean => {
  const plays = feed?.plays ?? [];
  const last = plays.length ? plays[plays.length - 1] : null;
  return !!last && (feed?.st ? feed.st === 'post' : last.c >= 3300);
};

export function ReaderBar({ week, feed, label, onState }: {
  week: number; feed: TeamGameFeed; label?: string; onState?: (rs: ReaderState) => void;
}) {
  const t = useTheme();
  const plays: GamePlay[] = feed.plays;
  const { home, away } = feed;
  const over = feedOver(feed);
  const nameOf = useRef(gameNameResolver(week, home, away));
  useEffect(() => { nameOf.current = gameNameResolver(week, home, away); }, [week, home, away]);
  const [rs, setRs] = useState<ReaderState>({ mode: 'idle', cursor: 0, speaking: false, finished: false });
  const reader = useRef<PlayReader | null>(null);
  useEffect(() => {
    const r = new PlayReader(appVoice, { home, away, nameOf: (a) => nameOf.current(a) }, (s) => { setRs(s); onState?.(s); });
    reader.current = r;
    return () => { r.stop(); reader.current = null; };
  }, [home, away]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reader.current?.update(plays, over); }, [plays, over]);

  const btn = (text: string, on: boolean, onPress: () => void, tone: string) => (
    <Pressable onPress={onPress}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth,
        borderColor: on ? tone : t.bd, backgroundColor: on ? alpha(tone, 0.16) : t.bg }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(10), fontWeight: '700', letterSpacing: 1, color: on ? tone : t.text }}>{text}</Text>
    </Pressable>
  );
  const status = rs.mode === 'catchup' ? `READING FROM THE TOP · ${Math.min(rs.cursor, plays.length)}/${plays.length}${over ? '' : ' · GOES LIVE WHEN CAUGHT UP'}`
    : rs.mode === 'live' ? (rs.speaking ? 'READING THE LATEST PLAY' : over ? 'THAT’S THE FINAL' : 'LIVE · WAITING FOR THE NEXT PLAY')
    : 'CATCH UP reads from the top · LIVE reads each play as it lands · voice: ⚙ Settings';
  return (
    <View style={{ gap: 5 }}>
      {!!label && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 1, color: t.dim, textAlign: 'center' }}>{label}</Text>}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {btn('▶ CATCH UP', rs.mode === 'catchup', () => reader.current?.catchUp(plays, over), t.you)}
        {btn(over ? '● FINAL' : '● LIVE', rs.mode === 'live', () => reader.current?.live(plays, over), t.opp)}
        {btn('■ STOP', false, () => reader.current?.stop(), t.text)}
      </View>
      <Text style={{ fontFamily: MONO, fontSize: fs(8.5), color: t.faint, textAlign: 'center', letterSpacing: 0.5 }}>{status}</Text>
    </View>
  );
}
