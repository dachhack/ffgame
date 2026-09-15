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
import { PlayReader, type ReaderState } from '@drip/core/data/playReader';
import { spokenDown } from '@drip/core/data/spokenPlay';
import { gameNameResolver } from '@drip/core/engine/gameNames';
import { useTheme, MONO, alpha, fs } from '../theme.native';
import { Overlay } from './Overlay';
import { appVoice, listVoices, chosenVoice, chooseVoice, type VoiceOption } from './voice';

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
  const over = !!last && (feed?.st ? feed.st === 'post' : last.c >= 3300);

  // Names (v0.389.1): the box score knows who "J.Brissett" is, and it grows
  // as the game does — resolved through a ref so the reader always reads the
  // freshest roster without being rebuilt.
  const nameOf = useRef(gameNameResolver(week, home, away));
  useEffect(() => { nameOf.current = gameNameResolver(week, home, away); }, [week, home, away]);
  // The reader lives for the sheet's life; a new game (or close) retires it.
  const [rs, setRs] = useState<ReaderState>({ mode: 'idle', cursor: 0, speaking: false, finished: false });
  const reader = useRef<PlayReader | null>(null);
  useEffect(() => {
    if (!visible) return;
    const r = new PlayReader(appVoice, { home, away, nameOf: (a) => nameOf.current(a) }, setRs);
    reader.current = r;
    return () => { r.stop(); reader.current = null; };
  }, [visible, home, away]);
  // Every tick / feed change: anything new past the cursor gets said.
  useEffect(() => { reader.current?.update(plays, over); }, [plays, over]);

  // Newest at the bottom, kept in view unless the reader is walking the past.
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (rs.mode !== 'catchup') scroller.current?.scrollToEnd({ animated: true });
  }, [plays.length, rs.mode]);

  // VOICE (v0.389.1): every English voice the phone has, best first; ★ marks
  // the engine's enhanced (network) ones. The pick sticks.
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(() => chosenVoice());
  useEffect(() => { if (visible) listVoices().then(setVoices).catch(() => setVoices([])); }, [visible]);
  const pickVoice = (id: string) => { chooseVoice(id); setVoiceId(id); reader.current?.stop(); appVoice.speak(`${away} at ${home}. Ready when you are.`, () => {}); };
  const btn = (label: string, on: boolean, onPress: () => void, tone: string) => (
    <Pressable onPress={onPress}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth,
        borderColor: on ? tone : t.bd, backgroundColor: on ? alpha(tone, 0.16) : t.bg }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(10.5), fontWeight: '700', letterSpacing: 1, color: on ? tone : t.text }}>{label}</Text>
    </Pressable>
  );
  const speakingIdx = rs.speaking ? rs.cursor - 1 : -1;

  return (
    <Overlay visible={visible} title={`≣ ${away} @ ${home}`}
      subtitle={last ? `${away} ${last.as} · ${home} ${last.hs} · ${over ? 'FINAL' : fmtQClock(last.c)} · ${plays.length} PLAYS` : 'NO PLAYS YET'}
      onClose={onClose}>
      {/* THE VOICE BAR — above the list so a thumb finds it without scrolling
          past a whole game. */}
      <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 12, marginTop: 10 }}>
        {btn('▶ CATCH UP', rs.mode === 'catchup', () => reader.current?.catchUp(plays, over), t.you)}
        {btn(over ? '● FINAL' : '● LIVE', rs.mode === 'live', () => reader.current?.live(plays, over), t.opp)}
        {btn('■ STOP', false, () => reader.current?.stop(), t.text)}
      </View>
      <Text style={{ fontFamily: MONO, fontSize: fs(8.5), color: t.faint, textAlign: 'center', marginTop: 6, marginHorizontal: 12, letterSpacing: 0.5 }}>
        {rs.mode === 'catchup' ? `READING FROM THE TOP · ${Math.min(rs.cursor, plays.length)}/${plays.length}${over ? '' : ' · GOES LIVE WHEN CAUGHT UP'}`
          : rs.mode === 'live' ? (rs.speaking ? 'READING THE LATEST PLAY' : over ? 'THAT’S THE FINAL' : 'LIVE · WAITING FOR THE NEXT PLAY')
          : 'CATCH UP reads the game from the top · LIVE reads each play as it lands'}
      </Text>

      {voices.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingTop: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', letterSpacing: 1, color: t.faint, alignSelf: 'center' }}>VOICE</Text>
          {voices.map((v) => {
            const on = (voiceId ?? voices[0]?.id) === v.id;
            return (
              <Pressable key={v.id} onPress={() => pickVoice(v.id)}
                style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: on ? alpha(t.you, 0.14) : t.bg }}>
                <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '700', color: on ? t.you : t.dim }}>{v.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
        {plays.length === 0 && <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.faint, textAlign: 'center' }}>— no plays yet —</Text>}
        {plays.map((p, i) => {
          const dd = spokenDown(p);
          const lit = i === speakingIdx;
          return (
            <Pressable key={p.pid ?? `${p.c}-${i}`}
              onLongPress={() => { reader.current?.stop(); appVoice.speak(`${dd ? dd + '. ' : ''}${p.txt}`, () => {}); }}
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
