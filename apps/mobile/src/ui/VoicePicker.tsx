// 🔊 PLAY-BY-PLAY VOICE — the picker, in Settings (v0.389.2).
//
// Founder: "Let's have the voice selection in the options gear." It sat in
// the play-by-play sheet for one release; a voice is a preference, not a
// per-game control, so it lives with the theme and the card deck. Every
// English voice the phone has, best first (★ = the engine's enhanced,
// network voices); a tap greets in that voice so you hear it before you
// commit, and the pick sticks across games.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { appVoice, listVoices, chosenVoice, chooseVoice, type VoiceOption } from './voice';

export function VoicePicker() {
  const t = useTheme();
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(() => chosenVoice());
  useEffect(() => { listVoices().then(setVoices).catch(() => setVoices([])); }, []);
  const pick = (id: string) => { chooseVoice(id); setVoiceId(id); appVoice.stop(); appVoice.speak('First and ten. Ready when you are.', () => {}); };
  return (
    <View style={{ gap: 8 }}>
      <Mono size={8.5} weight="700" track={0.16} tone="faint">PLAY-BY-PLAY VOICE</Mono>
      <Mono size={9} tone="faint">Reads a game&rsquo;s plays to you from ≣ PLAY BY PLAY on any field. ★ = your phone&rsquo;s enhanced voices. Tap one to hear it; more can be installed under your phone&rsquo;s text-to-speech settings.</Mono>
      {voices == null
        ? <Mono size={9} tone="faint">Looking for voices…</Mono>
        : voices.length === 0
          ? <Mono size={9} tone="faint">No English voice installed — the system default will read.</Mono>
          : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {voices.map((v) => {
                const on = (voiceId ?? voices[0]?.id) === v.id;
                return (
                  <Pressable key={v.id} onPress={() => pick(v.id)}
                    style={{ paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? t.sh : 'transparent',
                      borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd }}>
                    <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: on ? t.you : t.dim }}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
    </View>
  );
}
