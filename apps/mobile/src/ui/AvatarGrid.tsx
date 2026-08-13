// The avatar picker — the web AvatarPicker's grid, as a bottom sheet.
//
// Same art, same source: DRIP_AVATARS from core, served off the production
// origin, so a crest picked on the phone is pixel-identical on the web. The
// server (set_team_avatar / set_league_avatar, 0066/0071) accepts any URL or
// null; this grid is a curated front door, not a constraint.
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DRIP_AVATARS, dripAvatarUrl } from '@drip/core/data/dripAvatars';
import { useTheme } from '../theme.native';
import { tap } from './feedback';
import { LinkButton, Mono } from './prims';
import { Overlay } from './Overlay';

export function AvatarGrid({ visible, title, current, onPick, onClose }: {
  visible: boolean;
  title: string;
  current?: string | null;
  /** null = clear back to the letter tile. */
  onPick: (url: string | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [broken, setBroken] = useState<Set<string>>(new Set());
  return (
    <Overlay visible={visible} title={title} subtitle="Tap a crest." onClose={onClose}>
      <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DRIP_AVATARS.filter((f) => !broken.has(f)).map((f) => {
            const url = dripAvatarUrl(f);
            const on = current === url;
            return (
              <Pressable key={f} onPress={() => { tap(); onPick(url); }}
                style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: t.bg }}>
                <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover"
                  onError={() => setBroken((b) => new Set(b).add(f))} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ alignItems: 'center', marginTop: 10 }}>
        <LinkButton label="✕ no crest — use the letter tile" onPress={() => onPick(null)} />
      </View>
      {current ? <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>Current art stays until you pick.</Mono> : null}
    </Overlay>
  );
}
