// 🔊 PLAY-BY-PLAY VOICE — a dropdown, in Settings (v0.390.1).
//
// Founder: "Let's have the voice selection in the options gear" (v0.389.2),
// then "a drop down". One field showing the voice in use; tapping it opens a
// sheet listing every English voice the phone has, best first (★ = the
// engine's enhanced, network voices). Picking one greets in it so you hear
// it before you commit, and the pick sticks across games.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';
import { appVoice, listVoices, chosenVoice, chooseVoice, type VoiceOption } from './voice';

export function VoicePicker() {
  const t = useTheme();
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(() => chosenVoice());
  const [open, setOpen] = useState(false);
  useEffect(() => { listVoices().then(setVoices).catch(() => setVoices([])); }, []);
  const current = voices?.find((v) => v.id === (voiceId ?? voices[0]?.id)) ?? null;
  const pick = (id: string) => {
    chooseVoice(id); setVoiceId(id); setOpen(false);
    appVoice.stop(); appVoice.speak('First and ten. Ready when you are.', () => {});
  };
  return (
    <View style={{ gap: 8 }}>
      <Mono size={8.5} weight="700" track={0.16} tone="faint">PLAY-BY-PLAY VOICE</Mono>
      <Mono size={9} tone="faint">Reads a game&rsquo;s plays to you from ≣ PLAY BY PLAY on any field. ★ = your phone&rsquo;s enhanced voices; more can be installed under your phone&rsquo;s text-to-speech settings.</Mono>
      <Pressable onPress={() => voices && voices.length > 0 && setOpen(true)} disabled={!voices || voices.length === 0}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10,
          borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, backgroundColor: t.bg }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: voices?.length ? t.text : t.faint }}>
          {voices == null ? 'Looking for voices…' : voices.length === 0 ? 'System default (no English voice installed)' : current?.label ?? 'System default'}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: t.dim }}>▾</Text>
      </Pressable>
      <Overlay visible={open} title="Play-by-play voice" subtitle="TAP ONE TO HEAR IT · ★ ENHANCED" onClose={() => setOpen(false)}>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
          {(voices ?? []).map((v) => {
            const on = v.id === (voiceId ?? voices?.[0]?.id);
            return (
              <Pressable key={v.id} onPress={() => pick(v.id)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 11,
                  borderRadius: 7, borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: on ? t.sh : 'transparent' }}>
                <Text style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: on ? t.you : t.text }}>{v.label}</Text>
                {on && <Text style={{ fontFamily: MONO, fontSize: 11, color: t.you }}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </Overlay>
    </View>
  );
}
