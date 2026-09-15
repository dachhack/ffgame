// ≣ PLAY BY PLAY — one game's every play, with a voice (v0.389.0).
//
// Founder, over the All fields sheet: "Let's also have the option to expand
// the play by play for each game and have it read off to you — catch up or
// live." The list is the feed's plays in game order, scoring plays lit,
// newest at the bottom and kept in view; the bar under it is the voice:
//   ▶ CATCH UP — from the top of the game to now, then keeps going live
//   ● LIVE     — the latest play now, then each new one as it lands
//   ■ STOP
// What is SAID and WHEN are core's (spokenPlay / PlayReader) so the web's
// voice says the same words; this sheet is the native shell and the feed
// tick: while it is open it re-reads the game every 3s and hands the reader
// whatever is new.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { gameFeedFor, type GamePlay } from '@drip/core/data/gameFeed';
import type { ReaderState } from '@drip/core/data/playReader';
import { spokenDown } from '@drip/core/data/spokenPlay';
import { useTheme, MONO, alpha, fs } from '../theme.native';
import { Overlay } from './Overlay';
import { appVoice } from './voice';
import { ReaderBar, feedOver } from './ReaderBar';

const fmtQClock = (c: number): string => {
  const q = Math.min(4, Math.floor(c / 900) + 1);
  const left = Math.max(0, q * 900 - c);
  return `Q${q} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
};

export function PlayByPlaySheet({ visible, week, team, onClose }: {
  visible: boolean; week: number; team: string; onClose: () => void;
}) {
  const t = useTheme();
  // The feed, re-read on a tick while open — the parent board's poll writes
  // the module store; this is what makes LIVE follow it without the parent.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, [visible]);
  const feed = useMemo(() => gameFeedFor(week, team), [week, team, tick, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const plays: GamePlay[] = feed?.plays ?? [];
  const home = feed?.home ?? '', away = feed?.away ?? '';
  const last = plays.length ? plays[plays.length - 1] : null;
  const over = feedOver(feed);
  // The reader lives in the bar (v0.390.2); the sheet only lights the row.
  const [rs, setRs] = useState<ReaderState>({ mode: 'idle', cursor: 0, speaking: false, finished: false });

  // Newest at the bottom, kept in view unless the reader is walking the past.
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (rs.mode !== 'catchup') scroller.current?.scrollToEnd({ animated: true });
  }, [plays.length, rs.mode]);

  const speakingIdx = rs.speaking ? rs.cursor - 1 : -1;

  return (
    <Overlay visible={visible} title={`≣ ${away} @ ${home}`}
      subtitle={last ? `${away} ${last.as} · ${home} ${last.hs} · ${over ? 'FINAL' : fmtQClock(last.c)} · ${plays.length} PLAYS` : 'NO PLAYS YET'}
      onClose={onClose}>
      {/* THE VOICE BAR — above the list so a thumb finds it without scrolling
          past a whole game. */}
      <View style={{ marginHorizontal: 12, marginTop: 10 }}>
        {feed && <ReaderBar week={week} feed={feed} onState={setRs} />}
      </View>

      <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
        {plays.length === 0 && <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.faint, textAlign: 'center' }}>— no plays yet —</Text>}
        {plays.map((p, i) => {
          const dd = spokenDown(p);
          const lit = i === speakingIdx;
          return (
            <Pressable key={p.pid ?? `${p.c}-${i}`}
              onLongPress={() => { appVoice.stop(); appVoice.speak(`${dd ? dd + '. ' : ''}${p.txt}`, () => {}); }}
              style={{ paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: alpha(t.bd, 0.5),
                backgroundColor: lit ? alpha(t.you, 0.12) : 'transparent', borderRadius: 4, paddingHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.dim }}>{fmtQClock(p.c)}</Text>
                <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.dimstrong }}>{p.tm}</Text>
                {!!dd && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: t.dim }}>{dd.toUpperCase()}</Text>}
                <View style={{ flex: 1 }} />
                {!!p.sc && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '800', color: t.warn }}>SCORE · {away} {p.as}–{p.hs} {home}</Text>}
                {!!p.to && !p.sc && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '800', color: t.opp }}>TURNOVER</Text>}
                {lit && <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '800', color: t.you }}>🔊</Text>}
              </View>
              <Text style={{ fontSize: fs(11.5), lineHeight: fs(11.5) * 1.35, color: p.sc ? t.text : t.dimstrong }}>{p.txt}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Overlay>
  );
}
